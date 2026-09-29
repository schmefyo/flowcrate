/**
 * Read access to the source-set cache.
 *
 * The scheduled Supabase Edge Function owns cache population and refreshes.
 * Request handlers only read cache rows. Artist pages may opt into a read-only
 * fallback for genuinely missing rows so a newly followed artist is useful
 * before the first scheduled run.
 */
import { soundcloudSetsFor, type ScSet } from "./soundcloud.server";
import { mixesdbSetsFor, type MdbSet } from "./mixesdb-sets.server";
import { raSetsFor, type RaSet } from "./ra.server";

async function cachedSets<T>(
  source: "soundcloud" | "mixesdb" | "ra",
  names: string[],
  fallbackFetcher?: (name: string) => Promise<T[]>,
): Promise<T[]> {
  if (!names.length) return [];
  let supabaseAdmin;
  try {
    ({ supabaseAdmin } = await import("@/integrations/supabase/client.server"));
  } catch {
    return [];
  }

  const { data } = await supabaseAdmin
    .from("source_set_cache")
    .select("dj_name, payload")
    .eq("source", source)
    .in("dj_name", names);

  const rows = new Map((data ?? []).map((r: any) => [r.dj_name as string, r]));

  const out: T[] = [];
  for (const name of names) {
    const row = rows.get(name);
    if (row?.payload) {
      out.push(...((row.payload as T[]) ?? []));
      continue;
    }
    // Missing is deliberately different from stale: cached data, however old,
    // remains the scheduler's responsibility. The artist page alone can read
    // live data for a cold key without changing the cache.
    if (fallbackFetcher) {
      try {
        out.push(...(await fallbackFetcher(name)));
      } catch {
        /* a missing live source should not break the artist page */
      }
    }
  }
  return out;
}

/** Cached SoundCloud mixes for the given DJs. */
export function cachedSoundcloudSets(names: string[], fallbackMissing = false): Promise<ScSet[]> {
  return cachedSets("soundcloud", names, fallbackMissing ? soundcloudSetsFor : undefined);
}

/** Cached MixesDB sets (with tracklists) for the given DJs. */
export function cachedMixesdbSets(names: string[], fallbackMissing = false): Promise<MdbSet[]> {
  return cachedSets("mixesdb", names, fallbackMissing ? mixesdbSetsFor : undefined);
}

/** Cached Resident Advisor podcasts for the given DJs. */
export function cachedRaSets(names: string[], fallbackMissing = false): Promise<RaSet[]> {
  return cachedSets("ra", names, fallbackMissing ? raSetsFor : undefined);
}
