CREATE TABLE public.followed_djs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.followed_djs TO authenticated;
GRANT ALL ON public.followed_djs TO service_role;
ALTER TABLE public.followed_djs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own followed djs" ON public.followed_djs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);