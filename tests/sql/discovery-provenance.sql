-- Run with psql -v ON_ERROR_STOP=1 -f tests/sql/discovery-provenance.sql
-- ONLY in a disposable, empty local database, as its owner. Everything rolls back.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TABLE public.tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  artist text NOT NULL, title text NOT NULL,
  preview_url text, artwork_url text, notes text, source text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_tracks ON public.tracks FOR ALL TO authenticated
  USING(auth.uid() = user_id) WITH CHECK(auth.uid() = user_id);
GRANT SELECT, INSERT ON public.tracks TO authenticated;
INSERT INTO auth.users VALUES
  ('00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000002');
-- A legacy saved track must remain untouched by the additive migration.
INSERT INTO public.tracks(user_id, artist, title, notes) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Legacy Artist', 'Legacy Track', 'Keep these notes');
\ir ../../supabase/migrations/20261004000000_add_track_discovery_provenance.sql
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE first jsonb; second jsonb; failed boolean := false;
BEGIN
  ASSERT (SELECT notes FROM public.tracks WHERE artist = 'Legacy Artist') = 'Keep these notes';
  ASSERT (SELECT count(*) FROM public.track_discovery_sources) = 0;
  first := public.save_discovered_track('Artist','Track',
    '[{"dj_name":"Eris Drew","provider":"mixesdb","set_title":"Set A","set_url":"https://example.test/a"}]');
  second := public.save_discovered_track('artist','track',
    '[{"dj_name":"Octo Octa","provider":"mixesdb","set_title":"Set B","set_url":"https://example.test/b"}]');
  PERFORM public.save_discovered_track('Artist','Track',
    '[{"dj_name":"ERIS DREW","provider":"mixesdb","set_title":"Set A","set_url":"https://example.test/a"}]');
  ASSERT first->>'created' = 'true';
  ASSERT second->>'created' = 'false';
  ASSERT first->'track'->>'id' = second->'track'->>'id';
  ASSERT (SELECT count(*) FROM public.tracks) = 2;
  ASSERT (SELECT count(*) FROM public.track_discovery_sources) = 2;
  BEGIN
    PERFORM public.save_discovered_track('Other','Invalid',
      '[{"provider":"invalid","set_title":"Invalid","set_url":"https://example.test/a"}]');
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  ASSERT failed;
  ASSERT (SELECT count(*) FROM public.tracks) = 2;
END;
$$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM public.track_discovery_sources) = 0;
  ASSERT (SELECT count(*) FROM public.tracks) = 0;
END $$;
RESET ROLE;
DO $$ DECLARE failed boolean := false; other_track uuid; BEGIN
  SELECT id INTO other_track FROM public.tracks WHERE artist = 'Artist';
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.track_discovery_sources(user_id, track_id, dj_name, provider, set_title, set_url)
      VALUES ('00000000-0000-0000-0000-000000000002', other_track, 'Fake', 'mixesdb', 'Fake', 'https://example.test/fake');
  EXCEPTION WHEN insufficient_privilege THEN failed := true;
  END;
  ASSERT failed;
END $$;
RESET ROLE;
SELECT 'PASS: legacy preservation, atomic save/reuse, multiple DJs, dedupe, rollback, RLS' AS verification;
ROLLBACK;
