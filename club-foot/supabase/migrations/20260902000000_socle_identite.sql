-- ============================================================================
-- ONZE - SOCLE D'IDENTIFICATION (repris de l'architecture Schproutz v3)
-- ============================================================================
-- Meme decoupage que Schproutz :
--   auth.users  ->  public.users     (miroir applicatif + statut)
--                   public.profiles  (identite civile, 1-1)
--                   public.user_roles (role plateforme, N-N)
--   tenant      ->  public.clubs           (= establishments)
--                   public.club_members    (= establishment_members)
--                   public.club_modules    (= establishment_modules)
--                   public.club_invitations(= admin_invitations)
-- Tout l'acces est derive de club_members via des fonctions SECURITY DEFINER,
-- comme has_establishment_access() cote Schproutz.
-- ============================================================================

-- ============================================================================
-- TYPES
-- ============================================================================

-- Role plateforme (independant du club) : qui peut creer/administrer l'outil.
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'membre');

-- Role DANS un club. C'est ce role qui pilote toutes les policies.
--   owner     : createur du club (president), tous les droits
--   dirigeant : bureau / secretaire -> gere licences, cotisations, planning
--   coach     : educateur d'une ou plusieurs equipes -> planning + convocations
--   joueur    : licencie majeur, repond aux convocations et sondages
--   parent    : represente un ou plusieurs joueurs mineurs
CREATE TYPE public.club_role AS ENUM ('owner', 'dirigeant', 'coach', 'joueur', 'parent');

CREATE TYPE public.user_status AS ENUM ('invitation_envoyee', 'actif', 'inactif');
CREATE TYPE public.club_status AS ENUM ('trial', 'active', 'suspended', 'archived');

-- ============================================================================
-- UTILISATEURS
-- ============================================================================

CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  status public.user_status NOT NULL DEFAULT 'invitation_envoyee',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'membre',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
  prenom TEXT,
  nom TEXT,
  telephone TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- CLUBS (tenant)
-- ============================================================================

CREATE TABLE public.clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  numero_affiliation TEXT,          -- numero d'affiliation FFF
  address TEXT,
  phone TEXT,
  email TEXT,
  logo_url TEXT,
  color TEXT DEFAULT '#16A34A',
  saison TEXT NOT NULL DEFAULT '2026/2027',
  status public.club_status NOT NULL DEFAULT 'trial',
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + interval '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.club_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role public.club_role NOT NULL DEFAULT 'joueur',
  is_owner BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, user_id)
);

CREATE TABLE public.club_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,         -- 'planning' | 'sondages' | 'administratif' | 'messagerie'
  enabled BOOLEAN NOT NULL DEFAULT true,
  enabled_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, module_key)
);

-- Invitations : c'est le SEUL chemin d'entree dans un club existant.
CREATE TABLE public.club_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.club_role NOT NULL DEFAULT 'joueur',
  invited_by UUID NOT NULL REFERENCES public.users(id),
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  accepted_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(club_id, email)
);

-- ============================================================================
-- FONCTIONS D'ACCES (SECURITY DEFINER, appelees par TOUTES les policies)
-- ============================================================================

-- Membre du club (n'importe quel role) ou proprietaire.
CREATE OR REPLACE FUNCTION public.has_club_access(_user_id UUID, _club_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_members
    WHERE user_id = _user_id AND club_id = _club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs
    WHERE id = _club_id AND owner_id = _user_id
  )
$$;

-- Role effectif de l'utilisateur dans le club ('owner' si proprietaire).
CREATE OR REPLACE FUNCTION public.club_role_of(_user_id UUID, _club_id UUID)
RETURNS public.club_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.clubs WHERE id = _club_id AND owner_id = _user_id)
      THEN 'owner'::public.club_role
    ELSE (SELECT role FROM public.club_members WHERE user_id = _user_id AND club_id = _club_id)
  END
$$;

-- "Encadrement" = owner | dirigeant | coach. Droit d'ecriture sur le club.
CREATE OR REPLACE FUNCTION public.is_club_staff(_user_id UUID, _club_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.club_role_of(_user_id, _club_id)
         IN ('owner'::public.club_role, 'dirigeant'::public.club_role, 'coach'::public.club_role)
$$;

-- Bureau = owner | dirigeant. Droit sur l'administratif (licences, cotisations).
CREATE OR REPLACE FUNCTION public.is_club_bureau(_user_id UUID, _club_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.club_role_of(_user_id, _club_id)
         IN ('owner'::public.club_role, 'dirigeant'::public.club_role)
$$;

CREATE OR REPLACE FUNCTION public.has_app_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- ============================================================================
-- CREATION DU COMPTE APPLICATIF A L'INSCRIPTION
-- ============================================================================
-- Note : les types sont TOUS qualifies `public.` et search_path est fige.
-- C'est ce qui manquait cote Schproutz et provoquait les "type does not exist"
-- quand le trigger s'executait dans le contexte du schema auth.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _invitation_id UUID;
  _club_id UUID;
  _role TEXT;
  _prenom TEXT;
  _nom TEXT;
  _telephone TEXT;
BEGIN
  _invitation_id := NULLIF(NEW.raw_user_meta_data->>'invitation_id', '')::UUID;
  _club_id       := NULLIF(NEW.raw_user_meta_data->>'club_id', '')::UUID;
  _role          := NULLIF(NEW.raw_user_meta_data->>'role', '');
  _prenom        := NEW.raw_user_meta_data->>'prenom';
  _nom           := NEW.raw_user_meta_data->>'nom';
  _telephone     := NEW.raw_user_meta_data->>'telephone';

  INSERT INTO public.users (id, email, status)
  VALUES (NEW.id, NEW.email, 'actif'::public.user_status);

  INSERT INTO public.profiles (user_id, prenom, nom, telephone)
  VALUES (NEW.id, _prenom, _nom, _telephone);

  IF _invitation_id IS NOT NULL AND _club_id IS NOT NULL THEN
    -- Entree par invitation : membre du club, jamais owner de la plateforme.
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'membre'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    INSERT INTO public.club_members (club_id, user_id, role, is_owner)
    VALUES (_club_id, NEW.id, COALESCE(_role, 'joueur')::public.club_role, false)
    ON CONFLICT (club_id, user_id) DO NOTHING;

    UPDATE public.club_invitations
    SET accepted_at = now()
    WHERE id = _invitation_id AND accepted_at IS NULL;
  ELSE
    -- Inscription libre : futur proprietaire de son propre club.
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'owner'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Filet de securite appele par le front apres signInWithPassword : si le
-- trigger n'a pas pu rattacher l'utilisateur (invitation envoyee APRES la
-- creation du compte, par exemple), on rejoue le rattachement ici.
CREATE OR REPLACE FUNCTION public.accept_club_invitation(p_token UUID)
RETURNS TABLE (club_id UUID, slug TEXT, role public.club_role)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_inv public.club_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifie';
  END IF;

  SELECT u.email INTO v_email FROM public.users u WHERE u.id = v_user_id;

  SELECT * INTO v_inv
  FROM public.club_invitations i
  WHERE i.token = p_token
    AND i.cancelled_at IS NULL
    AND i.expires_at > now();

  IF v_inv.id IS NULL THEN
    RAISE EXCEPTION 'Invitation invalide ou expiree';
  END IF;

  IF lower(trim(v_inv.email)) <> lower(trim(v_email)) THEN
    RAISE EXCEPTION 'Cette invitation ne correspond pas a votre adresse email';
  END IF;

  INSERT INTO public.club_members (club_id, user_id, role, is_owner)
  VALUES (v_inv.club_id, v_user_id, v_inv.role, false)
  ON CONFLICT (club_id, user_id) DO NOTHING;

  UPDATE public.club_invitations
  SET accepted_at = COALESCE(accepted_at, now())
  WHERE id = v_inv.id;

  RETURN QUERY
    SELECT c.id, c.slug, v_inv.role FROM public.clubs c WHERE c.id = v_inv.club_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_club_invitation TO authenticated;

-- Creation d'une invitation (bypass RLS, mais verifie les droits explicitement).
CREATE OR REPLACE FUNCTION public.create_club_invitation(
  p_club_id UUID,
  p_email TEXT,
  p_role public.club_role
)
RETURNS TABLE (id UUID, token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_invitation_id UUID;
  v_token UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifie';
  END IF;

  IF NOT public.is_club_bureau(v_user_id, p_club_id) THEN
    RAISE EXCEPTION 'Permission refusee : reserve au bureau du club';
  END IF;

  INSERT INTO public.club_invitations (club_id, email, role, invited_by)
  VALUES (p_club_id, lower(trim(p_email)), p_role, v_user_id)
  ON CONFLICT (club_id, email) DO UPDATE
    SET role = EXCLUDED.role,
        invited_by = EXCLUDED.invited_by,
        token = gen_random_uuid(),
        expires_at = now() + interval '30 days',
        cancelled_at = NULL,
        accepted_at = NULL
  RETURNING club_invitations.id, club_invitations.token
  INTO v_invitation_id, v_token;

  RETURN QUERY SELECT v_invitation_id, v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_club_invitation TO authenticated;

-- ============================================================================
-- updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_clubs_updated_at BEFORE UPDATE ON public.clubs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clubs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_modules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_invitations  ENABLE ROW LEVEL SECURITY;

-- USERS : soi-meme, ou les autres membres de ses clubs (annuaire).
CREATE POLICY "users_select_self" ON public.users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_select_club_mates" ON public.users
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.club_members mine
      JOIN public.club_members theirs ON theirs.club_id = mine.club_id
      WHERE mine.user_id = auth.uid() AND theirs.user_id = users.id
    )
  );

-- USER_ROLES
CREATE POLICY "user_roles_select_self" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

-- PROFILES : idem users. Les parents/joueurs voient l'encadrement, et
-- l'encadrement voit tout le monde dans son club.
CREATE POLICY "profiles_select_self" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "profiles_select_club_mates" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.club_members mine
      JOIN public.club_members theirs ON theirs.club_id = mine.club_id
      WHERE mine.user_id = auth.uid() AND theirs.user_id = profiles.user_id
    )
  );

-- CLUBS
CREATE POLICY "clubs_owner_all" ON public.clubs
  FOR ALL USING (owner_id = auth.uid());
CREATE POLICY "clubs_members_select" ON public.clubs
  FOR SELECT USING (public.has_club_access(auth.uid(), id));
CREATE POLICY "clubs_bureau_update" ON public.clubs
  FOR UPDATE USING (public.is_club_bureau(auth.uid(), id));

-- CLUB_MEMBERS : chacun lit ses propres adhesions (indispensable au garde de
-- route qui interroge le club ET les adhesions EN PARALLELE) + celles de son club.
CREATE POLICY "club_members_select_self" ON public.club_members
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "club_members_select_same_club" ON public.club_members
  FOR SELECT USING (public.has_club_access(auth.uid(), club_id));
CREATE POLICY "club_members_bureau_manage" ON public.club_members
  FOR ALL USING (public.is_club_bureau(auth.uid(), club_id));

-- CLUB_MODULES
CREATE POLICY "club_modules_select" ON public.club_modules
  FOR SELECT USING (public.has_club_access(auth.uid(), club_id));
CREATE POLICY "club_modules_bureau_manage" ON public.club_modules
  FOR ALL USING (public.is_club_bureau(auth.uid(), club_id));

-- CLUB_INVITATIONS
CREATE POLICY "club_invitations_bureau_manage" ON public.club_invitations
  FOR ALL USING (public.is_club_bureau(auth.uid(), club_id));
CREATE POLICY "club_invitations_select_own" ON public.club_invitations
  FOR SELECT USING (
    lower(email) = lower((SELECT u.email FROM public.users u WHERE u.id = auth.uid()))
  );

-- ============================================================================
-- INDEX
-- ============================================================================

CREATE INDEX idx_users_email ON public.users(email);
CREATE INDEX idx_user_roles_user ON public.user_roles(user_id);
CREATE INDEX idx_profiles_user ON public.profiles(user_id);
CREATE INDEX idx_clubs_owner ON public.clubs(owner_id);
CREATE INDEX idx_clubs_slug ON public.clubs(slug);
CREATE INDEX idx_club_members_club ON public.club_members(club_id);
CREATE INDEX idx_club_members_user ON public.club_members(user_id);
CREATE INDEX idx_club_invitations_token ON public.club_invitations(token);
CREATE INDEX idx_club_invitations_email ON public.club_invitations(email);
