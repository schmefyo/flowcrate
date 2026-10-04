-- Additive, user-owned discovery history. Existing notes are not reliable backfill evidence.
CREATE TABLE public.track_discovery_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES public.tracks(id) ON DELETE CASCADE,
  dj_name text,
  provider text NOT NULL CHECK (provider IN ('mixesdb', 'soundcloud', 'ra')),
  set_title text NOT NULL CHECK (length(btrim(set_title)) > 0),
  set_url text NOT NULL CHECK (set_url ~ '^https?://'),
  set_date text,
  capture_kind text NOT NULL DEFAULT 'saved-result-context' CHECK (capture_kind = 'saved-result-context'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX track_discovery_relationship_idx ON public.track_discovery_sources
  (track_id, provider, set_url, lower(coalesce(dj_name, '')));
CREATE INDEX track_discovery_user_idx ON public.track_discovery_sources(user_id, track_id);
ALTER TABLE public.track_discovery_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own discovery history" ON public.track_discovery_sources FOR ALL TO authenticated
  USING (auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM public.tracks t WHERE t.id = track_id AND t.user_id = auth.uid()
  )) WITH CHECK (auth.uid() = user_id AND EXISTS (
    SELECT 1 FROM public.tracks t WHERE t.id = track_id AND t.user_id = auth.uid()
  ));
GRANT SELECT, INSERT, DELETE ON public.track_discovery_sources TO authenticated;
GRANT ALL ON public.track_discovery_sources TO service_role;

-- A single transaction avoids an orphan track or silently lost provenance on failure.
CREATE FUNCTION public.save_discovered_track(
  p_artist text, p_title text, p_sources jsonb,
  p_preview_url text DEFAULT NULL, p_artwork_url text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_source text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  owner_id uuid := auth.uid();
  saved public.tracks%ROWTYPE;
  created boolean := false;
BEGIN
  IF owner_id IS NULL THEN RAISE EXCEPTION 'You need to be signed in'; END IF;
  IF btrim(p_artist) = '' OR btrim(p_title) = '' OR p_artist IS NULL OR p_title IS NULL THEN
    RAISE EXCEPTION 'Artist and title are required';
  END IF;
  IF jsonb_typeof(p_sources) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid discovery sources'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text || lower(btrim(p_artist)) || '|||' || lower(btrim(p_title)), 0));
  SELECT * INTO saved FROM public.tracks
    WHERE user_id = owner_id AND lower(btrim(artist)) = lower(btrim(p_artist))
      AND lower(btrim(title)) = lower(btrim(p_title)) ORDER BY created_at, id LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.tracks(user_id, artist, title, preview_url, artwork_url, notes, source)
      VALUES(owner_id, btrim(p_artist), btrim(p_title), p_preview_url, p_artwork_url, p_notes, p_source)
      RETURNING * INTO saved;
    created := true;
  END IF;
  INSERT INTO public.track_discovery_sources(user_id, track_id, dj_name, provider, set_title, set_url, set_date)
    SELECT owner_id, saved.id, nullif(btrim(s.dj_name), ''), s.provider, s.set_title, s.set_url, s.set_date
    FROM jsonb_to_recordset(p_sources) AS s(dj_name text, provider text, set_title text, set_url text, set_date text)
    ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('track', to_jsonb(saved), 'created', created);
END;
$$;
REVOKE ALL ON FUNCTION public.save_discovered_track(text, text, jsonb, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_discovered_track(text, text, jsonb, text, text, text, text) TO authenticated;
