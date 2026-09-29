-- Keep cron requests short enough for the Edge runtime by splitting a global
-- pass into small, staggered shards. Vault values remain dashboard-managed.
create or replace function public.enqueue_source_cache_request(request_body jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  refresh_url text;
  refresh_secret text;
begin
  select decrypted_secret into refresh_url
  from vault.decrypted_secrets
  where name = 'source_cache_refresh_url';

  select decrypted_secret into refresh_secret
  from vault.decrypted_secrets
  where name = 'source_cache_refresh_secret';

  if coalesce(refresh_url, '') = '' or coalesce(refresh_secret, '') = '' then
    raise warning 'Source-cache refresh was not queued because its Vault configuration is missing';
    return;
  end if;

  perform net.http_post(
    url := refresh_url || '/functions/v1/refresh-source-cache',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', refresh_secret),
    body := request_body,
    timeout_milliseconds := 180000
  );
exception when others then
  raise warning 'Could not queue source-cache refresh: %', sqlerrm;
end;
$$;

create or replace function public.enqueue_source_cache_refresh_shard(
  shard_index integer,
  shard_count integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_source_cache_request(
    jsonb_build_object('shard', shard_index, 'shards', shard_count)
  );
end;
$$;

-- Keep the follow write non-blocking while using the corrected request helper.
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

  perform public.enqueue_source_cache_request(jsonb_build_object('names', warm_names));
  return new;
end;
$$;

select cron.unschedule(jobid)
from cron.job
where jobname = 'refresh-source-cache-every-12-hours'
   or jobname like 'refresh-source-cache-every-12-hours-shard-%';

do $$
declare
  shard_index integer;
  shard_count constant integer := 10;
begin
  for shard_index in 0..shard_count - 1 loop
    perform cron.schedule(
      format('refresh-source-cache-every-12-hours-shard-%s', shard_index),
      format('%s 0,12 * * *', shard_index * 3),
      format('select public.enqueue_source_cache_refresh_shard(%s, %s);', shard_index, shard_count)
    );
  end loop;
end;
$$;
