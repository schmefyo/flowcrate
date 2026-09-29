CREATE TABLE public.preview_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  track_key TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, track_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.preview_overrides TO authenticated;
GRANT ALL ON public.preview_overrides TO service_role;
ALTER TABLE public.preview_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own preview overrides" ON public.preview_overrides FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);