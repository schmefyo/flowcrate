CREATE TABLE public.moods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.moods TO authenticated;
GRANT ALL ON public.moods TO service_role;

ALTER TABLE public.moods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own moods" ON public.moods FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_moods_updated_at
  BEFORE UPDATE ON public.moods
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- seed defaults for existing users
INSERT INTO public.moods (user_id, name, position)
SELECT p.id, d.name, d.pos
FROM public.profiles p
CROSS JOIN (VALUES
  ('hypnotic',0),('euphoric',1),('dark',2),('sweaty',3),('tender',4),
  ('peak-time',5),('opener',6),('closer',7),('weird',8)
) AS d(name,pos)
ON CONFLICT (user_id, name) DO NOTHING;

-- seed defaults for new users
CREATE OR REPLACE FUNCTION public.seed_default_moods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.moods (user_id, name, position)
  SELECT NEW.id, d.name, d.pos
  FROM (VALUES
    ('hypnotic',0),('euphoric',1),('dark',2),('sweaty',3),('tender',4),
    ('peak-time',5),('opener',6),('closer',7),('weird',8)
  ) AS d(name,pos)
  ON CONFLICT (user_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_default_moods() FROM public, anon, authenticated;

CREATE TRIGGER seed_moods_on_profile
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_moods();

-- rename a mood everywhere it is used
CREATE OR REPLACE FUNCTION public.rename_mood(old_name text, new_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tracks
     SET moods = array_replace(moods, old_name, new_name)
   WHERE user_id = auth.uid() AND old_name = ANY(moods);
  UPDATE public.crates SET mood = new_name
   WHERE user_id = auth.uid() AND mood = old_name;
END;
$$;

-- remove a mood from tracks/crates after deletion
CREATE OR REPLACE FUNCTION public.detach_mood(old_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  UPDATE public.tracks
     SET moods = array_remove(moods, old_name)
   WHERE user_id = auth.uid() AND old_name = ANY(moods);
  UPDATE public.crates SET mood = NULL
   WHERE user_id = auth.uid() AND mood = old_name;
END;
$$;