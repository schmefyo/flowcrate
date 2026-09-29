CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile" ON public.profiles FOR ALL TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'label',
  city TEXT,
  country TEXT,
  website TEXT,
  notes TEXT,
  following BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.labels TO authenticated;
GRANT ALL ON public.labels TO service_role;
ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own labels" ON public.labels FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER labels_updated_at BEFORE UPDATE ON public.labels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX labels_user_idx ON public.labels(user_id);

CREATE TABLE public.tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  label_id UUID REFERENCES public.labels ON DELETE SET NULL,
  url TEXT,
  bpm INTEGER,
  musical_key TEXT,
  moods TEXT[] NOT NULL DEFAULT '{}',
  rating SMALLINT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tracks TO authenticated;
GRANT ALL ON public.tracks TO service_role;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tracks" ON public.tracks FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER tracks_updated_at BEFORE UPDATE ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX tracks_user_idx ON public.tracks(user_id);

CREATE TABLE public.crates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  mood TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crates TO authenticated;
GRANT ALL ON public.crates TO service_role;
ALTER TABLE public.crates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own crates" ON public.crates FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER crates_updated_at BEFORE UPDATE ON public.crates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX crates_user_idx ON public.crates(user_id);

CREATE TABLE public.crate_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  crate_id UUID NOT NULL REFERENCES public.crates ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES public.tracks ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (crate_id, track_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crate_tracks TO authenticated;
GRANT ALL ON public.crate_tracks TO service_role;
ALTER TABLE public.crate_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own crate tracks" ON public.crate_tracks FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX crate_tracks_crate_idx ON public.crate_tracks(crate_id);