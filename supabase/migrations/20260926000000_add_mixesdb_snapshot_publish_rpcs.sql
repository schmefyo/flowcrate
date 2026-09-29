-- Conditional publication prevents an older external crawl from replacing a
-- newer snapshot that won the race while the crawl was in progress.
CREATE OR REPLACE FUNCTION public.publish_mixesdb_snapshot(
  p_dj_name text,
  p_expected_exists boolean,
  p_expected_fetched_at timestamptz,
  p_payload jsonb,
  p_sync_state jsonb,
  p_fetched_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed_count integer;
BEGIN
  IF p_expected_exists THEN
    UPDATE public.source_set_cache
       SET payload = p_payload,
           sync_state = p_sync_state,
           fetched_at = p_fetched_at
     WHERE source = 'mixesdb'
       AND dj_name = p_dj_name
       AND fetched_at IS NOT DISTINCT FROM p_expected_fetched_at;
    GET DIAGNOSTICS changed_count = ROW_COUNT;
    RETURN changed_count = 1;
  END IF;

  INSERT INTO public.source_set_cache (source, dj_name, payload, sync_state, fetched_at)
  VALUES ('mixesdb', p_dj_name, p_payload, p_sync_state, p_fetched_at)
  ON CONFLICT (source, dj_name) DO NOTHING;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_mixesdb_sync_attempt(
  p_dj_name text,
  p_expected_fetched_at timestamptz,
  p_sync_state jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  changed_count integer;
BEGIN
  UPDATE public.source_set_cache
     SET sync_state = p_sync_state
   WHERE source = 'mixesdb'
     AND dj_name = p_dj_name
     AND fetched_at IS NOT DISTINCT FROM p_expected_fetched_at;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_mixesdb_snapshot(text, boolean, timestamptz, jsonb, jsonb, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_mixesdb_sync_attempt(text, timestamptz, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_mixesdb_snapshot(text, boolean, timestamptz, jsonb, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_mixesdb_sync_attempt(text, timestamptz, jsonb) TO service_role;
