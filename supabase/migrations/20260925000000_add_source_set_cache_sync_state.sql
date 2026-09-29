-- MixesDB revision-aware synchronization state. Existing payloads remain
-- untouched; a NULL state is deliberately interpreted as legacy/unverified.
ALTER TABLE public.source_set_cache
  ADD COLUMN IF NOT EXISTS sync_state jsonb;

COMMENT ON COLUMN public.source_set_cache.sync_state IS
  'Optional source synchronization metadata. NULL denotes a legacy/unverified payload.';
