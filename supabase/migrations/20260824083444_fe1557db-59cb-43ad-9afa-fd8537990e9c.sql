ALTER TABLE public.labels ADD COLUMN IF NOT EXISTS links_checked_at timestamptz;
UPDATE public.labels SET links_checked_at = now() WHERE jsonb_array_length(links) > 0;