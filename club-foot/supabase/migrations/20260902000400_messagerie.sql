-- ============================================================================
-- ONZE - MESSAGERIE INTERNE MULTI-FILS
-- ============================================================================
-- Quatre natures de fils, tous scopes au club :
--   direct   : 1-a-1 (un parent <-> le coach)
--   groupe   : fil libre entre membres choisis (le bureau, les covoiturages)
--   equipe   : fil automatique d'une equipe (tous les joueurs/parents)
--   annonce  : diffusion descendante du club, seule l'encadrement y ecrit
--
-- L'appartenance a un fil passe par une fonction SECURITY DEFINER : une policy
-- qui interrogerait conversation_participants depuis conversation_participants
-- declenche "infinite recursion detected in policy" (piege rencontre sur
-- Schproutz), le SECURITY DEFINER coupe la recursion.
-- ============================================================================

CREATE TYPE public.conversation_type AS ENUM ('direct', 'groupe', 'equipe', 'annonce');

CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  type public.conversation_type NOT NULL DEFAULT 'direct',
  nom TEXT,                                  -- NULL pour les conversations directes
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.conversation_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ,
  muted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, user_id)
);

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  contenu TEXT NOT NULL,
  piece_jointe_url TEXT,
  piece_jointe_nom TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- FONCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_conversation_participant(_user_id UUID, _conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  )
$$;

-- Droit d'ECRIRE dans un fil : participant, et pour les annonces, encadrement.
CREATE OR REPLACE FUNCTION public.can_post_in_conversation(_user_id UUID, _conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = _conversation_id
      AND public.is_conversation_participant(_user_id, c.id)
      AND (
        c.type <> 'annonce'::public.conversation_type
        OR public.is_club_staff(_user_id, c.club_id)
      )
  )
$$;

-- Creation d'un fil + de ses participants en une transaction (une policy
-- INSERT sur conversations ne peut pas verifier des participants qui n'existent
-- pas encore).
CREATE OR REPLACE FUNCTION public.create_conversation(
  p_club_id UUID,
  p_type public.conversation_type,
  p_nom TEXT,
  p_participant_ids UUID[],
  p_team_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_conversation_id UUID;
  v_participant UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifie';
  END IF;

  IF NOT public.has_club_access(v_user_id, p_club_id) THEN
    RAISE EXCEPTION 'Permission refusee : vous n''etes pas membre de ce club';
  END IF;

  -- Les fils descendants (annonce / equipe) sont reserves a l'encadrement.
  IF p_type IN ('annonce'::public.conversation_type, 'equipe'::public.conversation_type)
     AND NOT public.is_club_staff(v_user_id, p_club_id) THEN
    RAISE EXCEPTION 'Permission refusee : reserve a l''encadrement';
  END IF;

  INSERT INTO public.conversations (club_id, team_id, type, nom, created_by)
  VALUES (p_club_id, p_team_id, p_type, p_nom, v_user_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (v_conversation_id, v_user_id)
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  FOREACH v_participant IN ARRAY COALESCE(p_participant_ids, ARRAY[]::UUID[]) LOOP
    -- On n'ajoute que des membres du club : pas de fuite hors du tenant.
    IF public.has_club_access(v_participant, p_club_id) THEN
      INSERT INTO public.conversation_participants (conversation_id, user_id)
      VALUES (v_conversation_id, v_participant)
      ON CONFLICT (conversation_id, user_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_conversation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_conversation TO authenticated;

-- Ajoute (ou remet a jour) tous les membres d'une equipe dans son fil :
-- joueurs majeurs avec compte + responsables legaux + encadrants.
CREATE OR REPLACE FUNCTION public.sync_team_conversation(p_conversation_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id;

  IF v_conv.id IS NULL OR v_conv.team_id IS NULL THEN
    RAISE EXCEPTION 'Fil d''equipe introuvable';
  END IF;
  IF NOT public.is_club_staff(auth.uid(), v_conv.club_id) THEN
    RAISE EXCEPTION 'Permission refusee : reserve a l''encadrement';
  END IF;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT v_conv.id, u.user_id
  FROM (
    SELECT p.user_id FROM public.players p
      WHERE p.team_id = v_conv.team_id AND p.user_id IS NOT NULL
    UNION
    SELECT g.user_id FROM public.player_guardians g
      JOIN public.players p ON p.id = g.player_id
      WHERE p.team_id = v_conv.team_id
    UNION
    SELECT ts.user_id FROM public.team_staff ts WHERE ts.team_id = v_conv.team_id
  ) AS u
  ON CONFLICT (conversation_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_team_conversation TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.conversation_participants
  SET last_read_at = now()
  WHERE conversation_id = p_conversation_id AND user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.mark_conversation_read TO authenticated;

-- Compteur de non-lus par fil, calcule cote serveur (evite de rapatrier tous
-- les messages juste pour afficher une pastille).
CREATE OR REPLACE FUNCTION public.unread_counts(p_club_id UUID)
RETURNS TABLE (conversation_id UUID, unread BIGINT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT cp.conversation_id, count(m.id)
  FROM public.conversation_participants cp
  JOIN public.conversations c ON c.id = cp.conversation_id AND c.club_id = p_club_id
  LEFT JOIN public.messages m
    ON m.conversation_id = cp.conversation_id
   AND m.sender_id <> cp.user_id
   AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
  WHERE cp.user_id = auth.uid()
  GROUP BY cp.conversation_id
$$;

GRANT EXECUTE ON FUNCTION public.unread_counts TO authenticated;

CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(NEW.contenu, 100)
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_new_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.update_conversation_last_message();

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages                  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conversations_select_participant" ON public.conversations
  FOR SELECT USING (public.is_conversation_participant(auth.uid(), id));
CREATE POLICY "conversations_update_participant" ON public.conversations
  FOR UPDATE USING (public.is_conversation_participant(auth.uid(), id));
CREATE POLICY "conversations_staff_manage" ON public.conversations
  FOR ALL USING (public.is_club_staff(auth.uid(), club_id));

CREATE POLICY "participants_select_own" ON public.conversation_participants
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_conversation_participant(auth.uid(), conversation_id)
  );
CREATE POLICY "participants_update_own" ON public.conversation_participants
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "participants_creator_insert" ON public.conversation_participants
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_participants.conversation_id
        AND (c.created_by = auth.uid() OR public.is_club_staff(auth.uid(), c.club_id))
    )
  );

CREATE POLICY "messages_select_participant" ON public.messages
  FOR SELECT USING (public.is_conversation_participant(auth.uid(), conversation_id));
CREATE POLICY "messages_insert_allowed" ON public.messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND public.can_post_in_conversation(auth.uid(), conversation_id)
  );
-- On corrige une faute de frappe, on ne reecrit pas l'histoire des autres.
CREATE POLICY "messages_update_own" ON public.messages
  FOR UPDATE USING (sender_id = auth.uid());

CREATE INDEX idx_conversations_club ON public.conversations(club_id);
CREATE INDEX idx_conversations_last_message ON public.conversations(last_message_at DESC);
CREATE INDEX idx_participants_conversation ON public.conversation_participants(conversation_id);
CREATE INDEX idx_participants_user ON public.conversation_participants(user_id);
CREATE INDEX idx_messages_conversation_created ON public.messages(conversation_id, created_at DESC);
