ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS artwork_url text,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS release_year integer,
  ADD COLUMN IF NOT EXISTS genre text,
  ADD COLUMN IF NOT EXISTS mix_name text,
  ADD COLUMN IF NOT EXISTS preview_url text;