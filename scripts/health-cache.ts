import { isSourceCacheFresh } from "../src/lib/source-cache-refresh-core.ts";
import { supabaseAdmin } from "../src/integrations/supabase/client.server.ts";
import { printRows, REPRESENTATIVE_ARTISTS, summarizeCachePayload } from "./health-common.ts";

const FRESH_FOR_MS = 12 * 60 * 60 * 1000;

type CacheHealthRow = {
  artist: string;
  "cached sets": number | "-";
  "newest date": string;
  "tracklisted sets": number | "-";
  tracks: number | "-";
  fetched_at: string;
  status: string;
};

function freshnessStatus(fetchedAt: string | null): "healthy" | "stale" | "malformed" {
  if (!fetchedAt || !Number.isFinite(Date.parse(fetchedAt))) return "malformed";
  return isSourceCacheFresh(fetchedAt, FRESH_FOR_MS) ? "healthy" : "stale";
}

async function main(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("source_set_cache")
    .select("dj_name, fetched_at, payload")
    .eq("source", "mixesdb")
    .in("dj_name", [...REPRESENTATIVE_ARTISTS]);
  if (error) throw new Error(`Could not read source_set_cache: ${error.message}`);

  const rowsByArtist = new Map((data ?? []).map((row) => [row.dj_name, row]));
  const rows: CacheHealthRow[] = REPRESENTATIVE_ARTISTS.map((artist) => {
    const row = rowsByArtist.get(artist);
    if (!row)
      return {
        artist,
        "cached sets": "-",
        "newest date": "-",
        "tracklisted sets": "-",
        tracks: "-",
        fetched_at: "-",
        status: "missing",
      };

    const fetchedAt = typeof row.fetched_at === "string" ? row.fetched_at : null;
    const freshness = freshnessStatus(fetchedAt);
    const summary = summarizeCachePayload(row.payload);
    if (!summary)
      return {
        artist,
        "cached sets": "-",
        "newest date": "-",
        "tracklisted sets": "-",
        tracks: "-",
        fetched_at: fetchedAt ?? "-",
        status: "malformed",
      };

    const status = [
      freshness === "healthy" && summary.sets === 0 ? "empty" : freshness,
      ...(summary.sets > 0 && summary.tracklistedSets === 0 ? ["no-tracklists"] : []),
    ].join("; ");
    return {
      artist,
      "cached sets": summary.sets,
      "newest date": summary.newestDate ?? "-",
      "tracklisted sets": summary.tracklistedSets,
      tracks: summary.tracks,
      fetched_at: fetchedAt ?? "-",
      status,
    };
  });

  printRows(rows);
  console.log(
    "Read-only diagnostic: selected only the named MixesDB cache rows; no writes were performed.",
  );
}

await main();
