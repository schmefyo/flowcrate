ALTER TABLE public.followed_djs
  ADD COLUMN IF NOT EXISTS on_radar boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS scenes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS links_checked_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS followed_djs_updated_at ON public.followed_djs;
CREATE TRIGGER followed_djs_updated_at
  BEFORE UPDATE ON public.followed_djs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.radar_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, cache_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.radar_cache TO authenticated;
GRANT ALL ON public.radar_cache TO service_role;

ALTER TABLE public.radar_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own radar cache" ON public.radar_cache
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER radar_cache_updated_at
  BEFORE UPDATE ON public.radar_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();