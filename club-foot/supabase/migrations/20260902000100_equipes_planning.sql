-- ============================================================================
-- ONZE - EQUIPES, JOUEURS, PLANNING (entrainements + matchs) ET CONVOCATIONS
-- ============================================================================
-- Le lien "parent -> joueur" (player_guardians) est la piece centrale : il
-- permet a un parent de voir le planning, l'administratif et les sondages qui
-- concernent SON enfant, sans lui donner acces au reste du club.
-- ============================================================================

CREATE TYPE public.event_type AS ENUM ('entrainement', 'match', 'tournoi', 'reunion', 'autre');
CREATE TYPE public.event_status AS ENUM ('brouillon', 'publie', 'annule');
CREATE TYPE public.attendance_status AS ENUM ('en_attente', 'present', 'absent', 'incertain');
CREATE TYPE public.player_status AS ENUM ('actif', 'blesse', 'suspendu', 'inactif');

-- ============================================================================
-- EQUIPES
-- ============================================================================

CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- "U11 A", "Seniors 1", "Feminines"
  categorie TEXT,                   -- "U11", "Seniors", "Veterans"
  saison TEXT NOT NULL DEFAULT '2026/2027',
  couleur TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, name, saison)
);

-- Encadrants d'une equipe (un coach peut encadrer plusieurs equipes).
CREATE TABLE public.team_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  fonction TEXT NOT NULL DEFAULT 'coach',   -- coach, adjoint, dirigeant, arbitre
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

-- ============================================================================
-- JOUEURS ET RESPONSABLES LEGAUX
-- ============================================================================
-- user_id est NULLABLE : un enfant n'a pas forcement de compte, il est alors
-- represente uniquement par ses parents (player_guardians).
CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  prenom TEXT NOT NULL,
  nom TEXT NOT NULL,
  date_naissance DATE,
  numero_licence TEXT,
  numero_maillot INTEGER,
  poste TEXT,
  status public.player_status NOT NULL DEFAULT 'actif',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.player_guardians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'parent',   -- parent, tuteur, referent
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_id, user_id)
);

-- Lecture d'une fiche joueur : encadrement du club, le joueur lui-meme,
-- ou l'un de ses responsables legaux.
CREATE OR REPLACE FUNCTION public.can_read_player(_user_id UUID, _player_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.id = _player_id
      AND (
        p.user_id = _user_id
        OR public.is_club_staff(_user_id, p.club_id)
        OR EXISTS (
          SELECT 1 FROM public.player_guardians g
          WHERE g.player_id = p.id AND g.user_id = _user_id
        )
      )
  )
$$;

-- Les joueurs "dont je reponds" : moi-meme + mes enfants. Sert au planning,
-- aux sondages et a la situation administrative.
CREATE OR REPLACE FUNCTION public.my_player_ids(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id FROM public.players p WHERE p.user_id = _user_id
  UNION
  SELECT g.player_id FROM public.player_guardians g WHERE g.user_id = _user_id
$$;

-- Bureau du club auquel appartient un joueur. SECURITY DEFINER pour la meme
-- raison que ci-dessus : cette fonction est appelee par une policy SUR
-- player_guardians, elle ne doit pas rouvrir les policies de players.
CREATE OR REPLACE FUNCTION public.is_bureau_of_player(_user_id UUID, _player_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.id = _player_id AND public.is_club_bureau(_user_id, p.club_id)
  )
$$;

-- Les equipes de mes joueurs. SECURITY DEFINER : appelee depuis une policy SUR
-- players, une sous-requete lisant directement players declencherait
-- "infinite recursion detected in policy" (le SECURITY DEFINER s'execute sous
-- le proprietaire des tables et court-circuite donc la RLS).
CREATE OR REPLACE FUNCTION public.my_team_ids(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT p.team_id
  FROM public.players p
  WHERE p.team_id IS NOT NULL
    AND p.id IN (SELECT public.my_player_ids(_user_id))
$$;

-- ============================================================================
-- PLANNING : entrainements, matchs, reunions
-- ============================================================================

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  type public.event_type NOT NULL DEFAULT 'entrainement',
  titre TEXT NOT NULL,
  description TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  rdv_at TIMESTAMPTZ,               -- heure de rendez-vous (avant le coup d'envoi)
  lieu TEXT,
  adresse TEXT,
  adversaire TEXT,                  -- matchs uniquement
  domicile BOOLEAN,                 -- true = a domicile, false = exterieur
  competition TEXT,                 -- "Championnat D3", "Coupe", "Amical"
  score_club INTEGER,
  score_adversaire INTEGER,
  status public.event_status NOT NULL DEFAULT 'brouillon',
  reponse_attendue BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Convocation + reponse de disponibilite. Une ligne par joueur convoque.
CREATE TABLE public.event_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status public.attendance_status NOT NULL DEFAULT 'en_attente',
  commentaire TEXT,
  responded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(event_id, player_id)
);

-- Horodate la reponse des qu'elle change, cote base : le front n'a pas a y penser.
CREATE OR REPLACE FUNCTION public.stamp_event_response()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.responded_at = now();
    NEW.responded_by = COALESCE(auth.uid(), NEW.responded_by);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_event_response_update
  BEFORE UPDATE ON public.event_responses
  FOR EACH ROW EXECUTE FUNCTION public.stamp_event_response();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON public.players
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Convoque toute l'equipe d'un coup (cree les lignes 'en_attente' manquantes).
CREATE OR REPLACE FUNCTION public.convoquer_equipe(p_event_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event public.events%ROWTYPE;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF v_event.id IS NULL THEN
    RAISE EXCEPTION 'Evenement introuvable';
  END IF;
  IF NOT public.is_club_staff(auth.uid(), v_event.club_id) THEN
    RAISE EXCEPTION 'Permission refusee : reserve a l''encadrement';
  END IF;
  IF v_event.team_id IS NULL THEN
    RAISE EXCEPTION 'Cet evenement n''est rattache a aucune equipe';
  END IF;

  INSERT INTO public.event_responses (event_id, player_id)
  SELECT v_event.id, p.id
  FROM public.players p
  WHERE p.team_id = v_event.team_id
    AND p.status = 'actif'::public.player_status
  ON CONFLICT (event_id, player_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.convoquer_equipe TO authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.teams            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_staff       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_responses  ENABLE ROW LEVEL SECURITY;

-- TEAMS : visibles par tout le club, modifiables par l'encadrement.
CREATE POLICY "teams_select" ON public.teams
  FOR SELECT USING (public.has_club_access(auth.uid(), club_id));
CREATE POLICY "teams_staff_manage" ON public.teams
  FOR ALL USING (public.is_club_staff(auth.uid(), club_id));

CREATE POLICY "team_staff_select" ON public.team_staff
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.teams t
            WHERE t.id = team_staff.team_id AND public.has_club_access(auth.uid(), t.club_id))
  );
CREATE POLICY "team_staff_bureau_manage" ON public.team_staff
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.teams t
            WHERE t.id = team_staff.team_id AND public.is_club_bureau(auth.uid(), t.club_id))
  );

-- PLAYERS : l'encadrement voit tout le club ; un joueur/parent ne voit que sa
-- fiche (ou celle de son enfant) et les coequipiers de son equipe.
CREATE POLICY "players_staff_select" ON public.players
  FOR SELECT USING (public.is_club_staff(auth.uid(), club_id));
CREATE POLICY "players_self_select" ON public.players
  FOR SELECT USING (
    user_id = auth.uid()
    OR id IN (SELECT public.my_player_ids(auth.uid()))
  );
CREATE POLICY "players_teammates_select" ON public.players
  FOR SELECT USING (
    team_id IS NOT NULL
    AND team_id IN (SELECT public.my_team_ids(auth.uid()))
  );
CREATE POLICY "players_staff_manage" ON public.players
  FOR ALL USING (public.is_club_staff(auth.uid(), club_id));

CREATE POLICY "player_guardians_select" ON public.player_guardians
  FOR SELECT USING (user_id = auth.uid() OR public.can_read_player(auth.uid(), player_id));
CREATE POLICY "player_guardians_bureau_manage" ON public.player_guardians
  FOR ALL USING (public.is_bureau_of_player(auth.uid(), player_id));

-- EVENTS : les brouillons restent invisibles aux familles.
CREATE POLICY "events_staff_select" ON public.events
  FOR SELECT USING (public.is_club_staff(auth.uid(), club_id));
CREATE POLICY "events_members_select_published" ON public.events
  FOR SELECT USING (
    status <> 'brouillon'::public.event_status
    AND public.has_club_access(auth.uid(), club_id)
  );
CREATE POLICY "events_staff_manage" ON public.events
  FOR ALL USING (public.is_club_staff(auth.uid(), club_id));

-- EVENT_RESPONSES : l'encadrement voit et gere tout ; le joueur/parent lit les
-- reponses de son equipe (feuille de match) mais ne MODIFIE que les siennes.
CREATE POLICY "event_responses_staff_manage" ON public.event_responses
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.events e
            WHERE e.id = event_responses.event_id AND public.is_club_staff(auth.uid(), e.club_id))
  );
CREATE POLICY "event_responses_select_own" ON public.event_responses
  FOR SELECT USING (player_id IN (SELECT public.my_player_ids(auth.uid())));
CREATE POLICY "event_responses_update_own" ON public.event_responses
  FOR UPDATE USING (player_id IN (SELECT public.my_player_ids(auth.uid())))
  WITH CHECK (player_id IN (SELECT public.my_player_ids(auth.uid())));

-- ============================================================================
-- INDEX
-- ============================================================================

CREATE INDEX idx_teams_club ON public.teams(club_id);
CREATE INDEX idx_players_club ON public.players(club_id);
CREATE INDEX idx_players_team ON public.players(team_id);
CREATE INDEX idx_players_user ON public.players(user_id);
CREATE INDEX idx_player_guardians_user ON public.player_guardians(user_id);
CREATE INDEX idx_player_guardians_player ON public.player_guardians(player_id);
CREATE INDEX idx_events_club_start ON public.events(club_id, starts_at);
CREATE INDEX idx_events_team_start ON public.events(team_id, starts_at);
CREATE INDEX idx_event_responses_event ON public.event_responses(event_id);
CREATE INDEX idx_event_responses_player ON public.event_responses(player_id);
