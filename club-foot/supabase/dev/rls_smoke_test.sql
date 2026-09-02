-- ============================================================================
-- Test de fumee des policies RLS (LOCAL, sur un Postgres nu).
-- ============================================================================
-- A rejouer apres toute modification de policy :
--   psql -d onze -v ON_ERROR_STOP=1 \
--     -f supabase/dev/auth_stub.sql \
--     -f supabase/migrations/*.sql (dans l'ordre) \
--     -f supabase/dev/rls_smoke_test.sql
--
-- Chaque verification est un ASSERT : le script echoue au premier ecart. On
-- teste ce qui ferait vraiment mal si ca cassait — un parent qui verrait le
-- dossier de l'enfant du voisin, une famille qui validerait sa propre licence,
-- un parent qui posterait dans les annonces du club.
--
-- Rappel : le proprietaire des tables CONTOURNE la RLS. Les verifications
-- s'executent donc sous le role `authenticated`, comme le fait PostgREST.
-- ============================================================================

\set PRESIDENT '11111111-1111-1111-1111-111111111111'
\set COACH     '22222222-2222-2222-2222-222222222222'
\set PARENT1   '33333333-3333-3333-3333-333333333333'
\set PARENT2   '44444444-4444-4444-4444-444444444444'

-- --- Jeu d'essai (insere en tant que proprietaire, donc hors RLS) -----------
-- L'insertion dans auth.users declenche handle_new_user() : c'est aussi un
-- test du socle d'identification.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (:'PRESIDENT', 'president@club.fr', '{"prenom":"Nadia","nom":"Roux"}'),
  (:'COACH',     'coach@club.fr',     '{"prenom":"Karim","nom":"Benali"}'),
  (:'PARENT1',   'parent1@club.fr',   '{"prenom":"Sophie","nom":"Marchal"}'),
  (:'PARENT2',   'parent2@club.fr',   '{"prenom":"Luc","nom":"Perrin"}');

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.users) = 4, 'le trigger doit creer 4 comptes applicatifs';
  ASSERT (SELECT count(*) FROM public.profiles WHERE prenom IS NOT NULL) = 4,
    'le trigger doit recopier prenom/nom dans les profils';
END $$;

INSERT INTO public.clubs (id, owner_id, name, slug)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', :'PRESIDENT', 'US Rombas', 'us-rombas');

INSERT INTO public.club_members (club_id, user_id, role) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', :'COACH',   'coach'),
  ('aaaaaaaa-0000-0000-0000-000000000001', :'PARENT1', 'parent'),
  ('aaaaaaaa-0000-0000-0000-000000000001', :'PARENT2', 'parent');

INSERT INTO public.teams (id, club_id, name, categorie)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'U11 A', 'U11');

INSERT INTO public.players (id, club_id, team_id, prenom, nom) VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 'Sacha', 'Marchal'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 'Ines', 'Perrin');

INSERT INTO public.player_guardians (player_id, user_id) VALUES
  ('cccccccc-0000-0000-0000-000000000001', :'PARENT1'),
  ('cccccccc-0000-0000-0000-000000000002', :'PARENT2');

INSERT INTO public.events (id, club_id, team_id, type, titre, starts_at, status, created_by) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 'match', 'Match U11', now() + interval '3 days',
   'publie', :'COACH'),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 'entrainement', 'Seance a valider',
   now() + interval '5 days', 'brouillon', :'COACH');

INSERT INTO public.event_responses (event_id, player_id) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001'),
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002');

INSERT INTO public.document_types (id, club_id, cle, label, obligatoire, avec_echeance) VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'licence', 'Licence FFF', true, false),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'certificat_medical', 'Certificat medical', true, true);

INSERT INTO public.player_documents (id, club_id, player_id, document_type_id, status, valid_until) VALUES
  ('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'valide', NULL),
  ('ffffffff-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002', 'valide',
   CURRENT_DATE - 1);

INSERT INTO public.fees (id, club_id, saison, label, montant_cents)
VALUES ('99999999-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '2026/2027', 'Cotisation U11', 12000);

INSERT INTO public.player_fees (club_id, fee_id, player_id, montant_du_cents, montant_paye_cents) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001',
   'cccccccc-0000-0000-0000-000000000001', 12000, 5000);

INSERT INTO public.conversations (id, club_id, type, nom, created_by) VALUES
  ('88888888-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'annonce', 'Annonces US Rombas', :'PRESIDENT'),
  ('88888888-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'equipe', 'U11 A', :'COACH');

INSERT INTO public.conversation_participants (conversation_id, user_id)
SELECT c.id, u.id FROM public.conversations c CROSS JOIN public.users u;

-- ============================================================================
-- 1) Un parent ne voit QUE ce qui le concerne
-- ============================================================================
SET ROLE authenticated;
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.events) = 1,
    'un parent ne doit pas voir les brouillons du coach';

  ASSERT (SELECT count(*) FROM public.event_responses) = 1,
    'un parent ne doit voir que la convocation de SON enfant';

  ASSERT (SELECT count(*) FROM public.situation_administrative(
            'aaaaaaaa-0000-0000-0000-000000000001')) = 1,
    'la situation administrative d un parent se limite a ses licencies';

  ASSERT (SELECT documents_bloquants FROM public.situation_administrative(
            'aaaaaaaa-0000-0000-0000-000000000001')) = 1,
    'un certificat medical perime doit compter comme bloquant';

  ASSERT NOT (SELECT en_regle FROM public.situation_administrative(
            'aaaaaaaa-0000-0000-0000-000000000001')),
    'un dossier avec piece expiree et cotisation partielle n est pas en regle';

  ASSERT (SELECT count(*) FROM public.player_fees) = 1,
    'un parent ne voit que les cotisations de ses licencies';
END $$;

-- ============================================================================
-- 2) Un parent repond pour son enfant, jamais pour un autre
-- ============================================================================
DO $$
DECLARE
  v_maj INTEGER;
BEGIN
  UPDATE public.event_responses SET status = 'present'
  WHERE player_id = 'cccccccc-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_maj = ROW_COUNT;
  ASSERT v_maj = 1, 'un parent doit pouvoir repondre pour son enfant';

  ASSERT (SELECT responded_at FROM public.event_responses
          WHERE player_id = 'cccccccc-0000-0000-0000-000000000001') IS NOT NULL,
    'le trigger doit horodater la reponse';

  UPDATE public.event_responses SET status = 'absent'
  WHERE player_id = 'cccccccc-0000-0000-0000-000000000002';
  GET DIAGNOSTICS v_maj = ROW_COUNT;
  ASSERT v_maj = 0, 'un parent ne doit PAS pouvoir repondre pour l enfant d un autre';
END $$;

-- ============================================================================
-- 3) Une famille ne valide pas son propre dossier
-- ============================================================================
DO $$
DECLARE
  v_maj INTEGER;
BEGIN
  BEGIN
    UPDATE public.player_documents SET status = 'valide'
    WHERE id = 'ffffffff-0000-0000-0000-000000000002';
    GET DIAGNOSTICS v_maj = ROW_COUNT;
    ASSERT v_maj = 0, 'une famille ne doit pas pouvoir valider sa propre piece';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;  -- refus par WITH CHECK : attendu
  END;
END $$;

-- ============================================================================
-- 4) Messagerie : les annonces sont descendantes
-- ============================================================================
DO $$
DECLARE
  v_refuse BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO public.messages (conversation_id, sender_id, contenu)
    VALUES ('88888888-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'Je poste dans les annonces');
  EXCEPTION WHEN insufficient_privilege THEN
    v_refuse := true;
  END;
  ASSERT v_refuse, 'un parent ne doit pas pouvoir ecrire dans le fil d annonces';

  INSERT INTO public.messages (conversation_id, sender_id, contenu)
  VALUES ('88888888-0000-0000-0000-000000000002',
          '33333333-3333-3333-3333-333333333333', 'Je peux emmener 3 enfants');

  ASSERT (SELECT last_message_preview FROM public.conversations
          WHERE id = '88888888-0000-0000-0000-000000000002') = 'Je peux emmener 3 enfants',
    'le trigger doit rafraichir l apercu du dernier message';

  ASSERT (SELECT unread FROM public.unread_counts('aaaaaaaa-0000-0000-0000-000000000001')
          WHERE conversation_id = '88888888-0000-0000-0000-000000000002') = 0,
    'ses propres messages ne comptent pas comme non lus';
END $$;

-- ============================================================================
-- 5) Le coach voit et pilote son equipe
-- ============================================================================
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.events) = 2,
    'le coach doit voir ses brouillons';
  ASSERT (SELECT count(*) FROM public.players) = 2,
    'le coach doit voir tous les joueurs du club';
  ASSERT (SELECT count(*) FROM public.event_responses) = 2,
    'le coach doit voir toute la feuille de presence';

  INSERT INTO public.messages (conversation_id, sender_id, contenu)
  VALUES ('88888888-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222', 'RDV 13h30 au stade');
END $$;

-- Le coach n'est pas le bureau : l'administratif lui reste ferme.
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.situation_administrative(
            'aaaaaaaa-0000-0000-0000-000000000001')) = 0,
    'un coach ne doit pas voir les dossiers administratifs (reserve au bureau)';
END $$;

-- La convocation automatique cree les lignes manquantes.
DO $$
DECLARE
  v_crees INTEGER;
BEGIN
  v_crees := public.convoquer_equipe('dddddddd-0000-0000-0000-000000000002');
  ASSERT v_crees = 2, 'convoquer_equipe doit convoquer les 2 joueurs de l equipe';
END $$;

-- ============================================================================
-- 6) Le bureau voit tout le club
-- ============================================================================
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.situation_administrative(
            'aaaaaaaa-0000-0000-0000-000000000001')) = 2,
    'le president doit voir la situation des 2 licencies';

  UPDATE public.player_documents SET status = 'valide', valid_until = CURRENT_DATE + 300
  WHERE id = 'ffffffff-0000-0000-0000-000000000002';

  ASSERT (SELECT documents_bloquants FROM public.situation_administrative(
            'aaaaaaaa-0000-0000-0000-000000000001')
          WHERE player_id = 'cccccccc-0000-0000-0000-000000000001') = 0,
    'une piece revalidee ne doit plus bloquer';
END $$;

-- ============================================================================
-- 7) Cloisonnement entre clubs
-- ============================================================================
RESET ROLE;
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('55555555-5555-5555-5555-555555555555', 'etranger@ailleurs.fr', '{}');
INSERT INTO public.clubs (id, owner_id, name, slug)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555',
        'FC Ailleurs', 'fc-ailleurs');

SET ROLE authenticated;
SET request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.players) = 0,
    'le president d un autre club ne doit voir aucun joueur d US Rombas';
  ASSERT (SELECT count(*) FROM public.events) = 0,
    'aucun evenement d un club dont on n est pas membre';
  ASSERT (SELECT count(*) FROM public.messages) = 0,
    'aucun message d un fil auquel on ne participe pas';
  ASSERT (SELECT count(*) FROM public.situation_administrative(
            'aaaaaaaa-0000-0000-0000-000000000001')) = 0,
    'aucun dossier administratif d un club etranger';
END $$;

RESET ROLE;
SELECT 'RLS : toutes les verifications passent' AS resultat;
