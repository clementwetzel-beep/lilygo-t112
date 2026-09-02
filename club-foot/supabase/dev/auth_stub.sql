-- ============================================================================
-- Bouchon LOCAL du schema `auth` de Supabase (dev et tests uniquement).
-- ============================================================================
-- Supabase fournit auth.users, auth.uid() et les roles anon/authenticated. Sur
-- un Postgres nu, ce fichier recree le strict minimum pour rejouer les
-- migrations et verifier policies et triggers hors ligne :
--   psql -f supabase/dev/auth_stub.sql -f supabase/migrations/2026...sql ...
-- Il n'est JAMAIS applique au projet Supabase.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sur Supabase, auth.uid() lit le sub du JWT. En local on le simule avec un
-- reglage de session : SET request.jwt.claim.sub = '<uuid>';
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- Supabase ouvre le schema auth (et auth.uid()) aux roles applicatifs : sans
-- ces droits, le trigger stamp_event_response() echouerait en local alors
-- qu'il fonctionne en production.
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT SELECT ON auth.users TO authenticated, service_role;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
