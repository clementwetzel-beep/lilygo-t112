-- ============================================================================
-- ONZE - SITUATION ADMINISTRATIVE (licence, documents, cotisation)
-- ============================================================================
-- Une famille doit pouvoir repondre en un coup d'oeil a : "qu'est-ce qu'il me
-- manque pour que mon enfant joue ?". D'ou un statut par document + un solde
-- de cotisation, agreges par joueur.
-- ============================================================================

CREATE TYPE public.document_status AS ENUM (
  'manquant',    -- rien n'a ete depose
  'en_attente',  -- depose, en attente de validation du bureau
  'valide',
  'refuse',
  'expire'       -- valide mais date de validite depassee (certificat medical)
);

CREATE TYPE public.fee_status AS ENUM ('due', 'partielle', 'payee', 'exoneree');

-- Types de pieces exiges par le club (parametrable : chaque club a ses regles).
CREATE TABLE public.document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  cle TEXT NOT NULL,                 -- 'licence', 'certificat_medical', 'photo', 'autorisation_parentale'
  label TEXT NOT NULL,
  obligatoire BOOLEAN NOT NULL DEFAULT true,
  avec_echeance BOOLEAN NOT NULL DEFAULT false,   -- doit porter une date de validite
  ordre INTEGER NOT NULL DEFAULT 0,
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, cle)
);

CREATE TABLE public.player_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  document_type_id UUID NOT NULL REFERENCES public.document_types(id) ON DELETE CASCADE,
  status public.document_status NOT NULL DEFAULT 'manquant',
  fichier_url TEXT,
  valid_until DATE,
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  motif_refus TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_id, document_type_id)
);

-- Cotisations : un bareme par saison/equipe, puis une ligne par joueur.
CREATE TABLE public.fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  saison TEXT NOT NULL,
  label TEXT NOT NULL,
  montant_cents INTEGER NOT NULL CHECK (montant_cents >= 0),
  echeance DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.player_fees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  fee_id UUID NOT NULL REFERENCES public.fees(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  montant_du_cents INTEGER NOT NULL CHECK (montant_du_cents >= 0),
  montant_paye_cents INTEGER NOT NULL DEFAULT 0 CHECK (montant_paye_cents >= 0),
  status public.fee_status NOT NULL DEFAULT 'due',
  paid_at TIMESTAMPTZ,
  moyen TEXT,                        -- especes, cheque, virement, ancv, pass_sport
  commentaire TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(fee_id, player_id)
);

CREATE TRIGGER update_player_documents_updated_at BEFORE UPDATE ON public.player_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_player_fees_updated_at BEFORE UPDATE ON public.player_fees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Un document valide dont la date est passee bascule en 'expire' a la lecture :
-- on ne depend d'aucun cron pour afficher la bonne situation.
CREATE OR REPLACE FUNCTION public.document_effective_status(
  _status public.document_status,
  _valid_until DATE
)
RETURNS public.document_status
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _status = 'valide'::public.document_status
         AND _valid_until IS NOT NULL
         AND _valid_until < CURRENT_DATE
      THEN 'expire'::public.document_status
    ELSE _status
  END
$$;

-- Situation administrative agregee, par joueur. Le front l'appelle telle
-- quelle pour la page "Administratif" (famille comme bureau).
CREATE OR REPLACE FUNCTION public.situation_administrative(p_club_id UUID)
RETURNS TABLE (
  player_id UUID,
  prenom TEXT,
  nom TEXT,
  team_id UUID,
  documents_requis INTEGER,
  documents_valides INTEGER,
  documents_bloquants INTEGER,
  cotisation_due_cents BIGINT,
  cotisation_payee_cents BIGINT,
  en_regle BOOLEAN
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH visibles AS (
    SELECT p.*
    FROM public.players p
    WHERE p.club_id = p_club_id
      AND (
        public.is_club_bureau(auth.uid(), p_club_id)
        OR p.id IN (SELECT public.my_player_ids(auth.uid()))
      )
  ),
  docs AS (
    SELECT
      v.id AS player_id,
      count(dt.id) FILTER (WHERE dt.obligatoire)::INTEGER AS requis,
      count(pd.id) FILTER (
        WHERE public.document_effective_status(pd.status, pd.valid_until) = 'valide'::public.document_status
      )::INTEGER AS valides,
      count(dt.id) FILTER (
        WHERE dt.obligatoire
          AND COALESCE(
                public.document_effective_status(pd.status, pd.valid_until),
                'manquant'::public.document_status
              ) <> 'valide'::public.document_status
      )::INTEGER AS bloquants
    FROM visibles v
    CROSS JOIN public.document_types dt
    LEFT JOIN public.player_documents pd
      ON pd.player_id = v.id AND pd.document_type_id = dt.id
    WHERE dt.club_id = p_club_id AND dt.actif
    GROUP BY v.id
  ),
  argent AS (
    SELECT
      v.id AS player_id,
      COALESCE(sum(pf.montant_du_cents) FILTER (WHERE pf.status <> 'exoneree'::public.fee_status), 0) AS du,
      COALESCE(sum(pf.montant_paye_cents), 0) AS paye
    FROM visibles v
    LEFT JOIN public.player_fees pf ON pf.player_id = v.id
    GROUP BY v.id
  )
  SELECT
    v.id, v.prenom, v.nom, v.team_id,
    COALESCE(d.requis, 0), COALESCE(d.valides, 0), COALESCE(d.bloquants, 0),
    COALESCE(a.du, 0), COALESCE(a.paye, 0),
    COALESCE(d.bloquants, 0) = 0 AND COALESCE(a.du, 0) <= COALESCE(a.paye, 0)
  FROM visibles v
  LEFT JOIN docs d ON d.player_id = v.id
  LEFT JOIN argent a ON a.player_id = v.id
  ORDER BY v.nom, v.prenom;
$$;

GRANT EXECUTE ON FUNCTION public.situation_administrative TO authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.document_types   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fees             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_fees      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "document_types_select" ON public.document_types
  FOR SELECT USING (public.has_club_access(auth.uid(), club_id));
CREATE POLICY "document_types_bureau_manage" ON public.document_types
  FOR ALL USING (public.is_club_bureau(auth.uid(), club_id));

-- Une famille lit et depose les pieces de SES joueurs ; seul le bureau valide.
CREATE POLICY "player_documents_select_own" ON public.player_documents
  FOR SELECT USING (player_id IN (SELECT public.my_player_ids(auth.uid())));
CREATE POLICY "player_documents_bureau_manage" ON public.player_documents
  FOR ALL USING (public.is_club_bureau(auth.uid(), club_id));
CREATE POLICY "player_documents_insert_own" ON public.player_documents
  FOR INSERT WITH CHECK (
    player_id IN (SELECT public.my_player_ids(auth.uid()))
    AND status = 'en_attente'::public.document_status
  );
CREATE POLICY "player_documents_update_own" ON public.player_documents
  FOR UPDATE USING (
    player_id IN (SELECT public.my_player_ids(auth.uid()))
    AND status <> 'valide'::public.document_status
  )
  WITH CHECK (
    player_id IN (SELECT public.my_player_ids(auth.uid()))
    -- Une famille ne peut pas s'auto-valider : elle repasse en 'en_attente'.
    AND status = 'en_attente'::public.document_status
  );

CREATE POLICY "fees_select" ON public.fees
  FOR SELECT USING (public.has_club_access(auth.uid(), club_id));
CREATE POLICY "fees_bureau_manage" ON public.fees
  FOR ALL USING (public.is_club_bureau(auth.uid(), club_id));

CREATE POLICY "player_fees_select_own" ON public.player_fees
  FOR SELECT USING (player_id IN (SELECT public.my_player_ids(auth.uid())));
CREATE POLICY "player_fees_bureau_manage" ON public.player_fees
  FOR ALL USING (public.is_club_bureau(auth.uid(), club_id));

CREATE INDEX idx_document_types_club ON public.document_types(club_id);
CREATE INDEX idx_player_documents_player ON public.player_documents(player_id);
CREATE INDEX idx_player_documents_club_status ON public.player_documents(club_id, status);
CREATE INDEX idx_fees_club_saison ON public.fees(club_id, saison);
CREATE INDEX idx_player_fees_player ON public.player_fees(player_id);
