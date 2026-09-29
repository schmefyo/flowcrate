CREATE TABLE public.source_set_cache (
  source TEXT NOT NULL,
  dj_name TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (source, dj_name)
);
GRANT ALL ON public.source_set_cache TO service_role;
ALTER TABLE public.source_set_cache ENABLE ROW LEVEL SECURITY;