-- Keep the legacy single mood column intact while moving crates to the same
-- multi-mood representation already used by tracks.
ALTER TABLE public.crates
  ADD COLUMN IF NOT EXISTS moods text[] NOT NULL DEFAULT '{}';

-- Preserve every existing crate mood in the new collection.
UPDATE public.crates
SET moods = ARRAY[mood]
WHERE mood IS NOT NULL
  AND cardinality(moods) = 0;

-- Keep the existing mood manager's rename/remove behavior consistent for
-- multi-mood crates as well as the legacy column.
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

  UPDATE public.crates
     SET mood = CASE WHEN mood = old_name THEN new_name ELSE mood END,
         moods = array_replace(moods, old_name, new_name)
   WHERE user_id = auth.uid() AND (mood = old_name OR old_name = ANY(moods));
END;
$$;

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

  UPDATE public.crates
     SET mood = CASE WHEN mood = old_name THEN NULL ELSE mood END,
         moods = array_remove(moods, old_name)
   WHERE user_id = auth.uid() AND (mood = old_name OR old_name = ANY(moods));
END;
$$;
