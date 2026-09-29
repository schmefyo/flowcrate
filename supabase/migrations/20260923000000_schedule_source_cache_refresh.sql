-- The two Vault secrets are intentionally created outside this migration so
-- credentials never enter source control:
--   source_cache_refresh_url    https://<project-ref>.supabase.co
--   source_cache_refresh_secret the default Supabase secret API key
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'refresh-source-cache-every-12-hours';

select cron.schedule(
  'refresh-source-cache-every-12-hours',
  '0 */12 * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'source_cache_refresh_url')
        || '/functions/v1/refresh-source-cache',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'source_cache_refresh_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- Queue a targeted warm-up after a follow commits. pg_net is asynchronous, and
-- failures to enqueue are deliberately isolated from the user's follow write.
create or replace function public.enqueue_source_cache_warmup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  warm_names jsonb;
begin
  select coalesce(jsonb_agg(name), '[]'::jsonb)
    into warm_names
  from (
    select distinct trim(name) as name
    from unnest(array_append(coalesce(new.aliases, '{}'::text[]), new.name)) as name
    where trim(name) <> ''
  ) as names;

  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'source_cache_refresh_url')
        || '/functions/v1/refresh-source-cache',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'source_cache_refresh_secret')
      ),
      body := jsonb_build_object('names', warm_names),
      timeout_milliseconds := 60000
    );
  exception when others then
    raise warning 'Could not queue source-cache warm-up: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists followed_djs_source_cache_warmup_insert on public.followed_djs;
create trigger followed_djs_source_cache_warmup_insert
after insert on public.followed_djs
for each row execute function public.enqueue_source_cache_warmup();

drop trigger if exists followed_djs_source_cache_warmup_aliases on public.followed_djs;
create trigger followed_djs_source_cache_warmup_aliases
after update of aliases on public.followed_djs
for each row
when (old.aliases is distinct from new.aliases)
execute function public.enqueue_source_cache_warmup();
