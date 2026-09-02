-- ============================================================================
-- ONZE - SONDAGES (disponibilites, sorties, votes du club)
-- ============================================================================

CREATE TYPE public.poll_status AS ENUM ('brouillon', 'ouvert', 'clos');
CREATE TYPE public.poll_audience AS ENUM ('club', 'equipe', 'encadrement');

CREATE TABLE public.polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,  -- sondage lie a un match
  question TEXT NOT NULL,
  description TEXT,
  audience public.poll_audience NOT NULL DEFAULT 'club',
  choix_multiple BOOLEAN NOT NULL DEFAULT false,
  anonyme BOOLEAN NOT NULL DEFAULT false,
  status public.poll_status NOT NULL DEFAULT 'brouillon',
  closes_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES public.poll_options(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- Un parent de deux licencies vote une fois PAR enfant concerne.
  player_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(option_id, user_id, player_id)
);

CREATE TRIGGER update_polls_updated_at BEFORE UPDATE ON public.polls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Un sondage est-il visible par cet utilisateur ?
CREATE OR REPLACE FUNCTION public.can_see_poll(_user_id UUID, _poll_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.polls p
    WHERE p.id = _poll_id
      AND public.has_club_access(_user_id, p.club_id)
      AND (
        public.is_club_staff(_user_id, p.club_id)
        OR (
          p.status <> 'brouillon'::public.poll_status
          AND (
            p.audience = 'club'::public.poll_audience
            OR (
              p.audience = 'equipe'::public.poll_audience
              AND p.team_id IN (SELECT public.my_team_ids(_user_id))
            )
          )
        )
      )
  )
$$;

-- Depouillement cote serveur : compte les voix sans exposer QUI a vote quand
-- le sondage est anonyme.
CREATE OR REPLACE FUNCTION public.poll_results(p_poll_id UUID)
RETURNS TABLE (option_id UUID, label TEXT, ordre INTEGER, votes BIGINT)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.id, o.label, o.ordre, count(v.id)
  FROM public.poll_options o
  LEFT JOIN public.poll_votes v ON v.option_id = o.id
  WHERE o.poll_id = p_poll_id
    AND public.can_see_poll(auth.uid(), p_poll_id)
  GROUP BY o.id, o.label, o.ordre
  ORDER BY o.ordre, o.label
$$;

GRANT EXECUTE ON FUNCTION public.poll_results TO authenticated;

-- ============================================================================
-- RLS
-- ============================================================================

ALTER TABLE public.polls        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_votes   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "polls_select_visible" ON public.polls
  FOR SELECT USING (public.can_see_poll(auth.uid(), id));
CREATE POLICY "polls_staff_manage" ON public.polls
  FOR ALL USING (public.is_club_staff(auth.uid(), club_id));

CREATE POLICY "poll_options_select" ON public.poll_options
  FOR SELECT USING (public.can_see_poll(auth.uid(), poll_id));
CREATE POLICY "poll_options_staff_manage" ON public.poll_options
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.polls p
            WHERE p.id = poll_options.poll_id AND public.is_club_staff(auth.uid(), p.club_id))
  );

-- Un votant ne lit QUE ses propres bulletins ; les totaux passent par
-- poll_results(). L'encadrement voit le detail sauf si le sondage est anonyme.
CREATE POLICY "poll_votes_select_own" ON public.poll_votes
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "poll_votes_staff_select" ON public.poll_votes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.polls p
            WHERE p.id = poll_votes.poll_id
              AND p.anonyme = false
              AND public.is_club_staff(auth.uid(), p.club_id))
  );
CREATE POLICY "poll_votes_insert_own" ON public.poll_votes
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND (player_id IS NULL OR player_id IN (SELECT public.my_player_ids(auth.uid())))
    AND EXISTS (
      SELECT 1 FROM public.polls p
      WHERE p.id = poll_votes.poll_id
        AND p.status = 'ouvert'::public.poll_status
        AND (p.closes_at IS NULL OR p.closes_at > now())
        AND public.can_see_poll(auth.uid(), p.id)
    )
  );
CREATE POLICY "poll_votes_delete_own" ON public.poll_votes
  FOR DELETE USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.polls p
      WHERE p.id = poll_votes.poll_id
        AND p.status = 'ouvert'::public.poll_status
        AND (p.closes_at IS NULL OR p.closes_at > now())
    )
  );

CREATE INDEX idx_polls_club ON public.polls(club_id);
CREATE INDEX idx_polls_team ON public.polls(team_id);
CREATE INDEX idx_poll_options_poll ON public.poll_options(poll_id);
CREATE INDEX idx_poll_votes_poll ON public.poll_votes(poll_id);
CREATE INDEX idx_poll_votes_user ON public.poll_votes(user_id);
