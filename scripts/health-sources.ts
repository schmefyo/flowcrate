import { MDB_DIRECT_SET_LIMIT, mixesdbSetsForResult } from "../src/lib/mixesdb-sets.server.ts";
import { printRows, REPRESENTATIVE_ARTISTS, summarizeSets } from "./health-common.ts";

type SourceHealthRow = {
  artist: string;
  sets: number | "-";
  "newest date": string;
  "tracklisted sets": number | "-";
  tracks: number | "-";
  status: string;
};

async function main(): Promise<void> {
  const rows: SourceHealthRow[] = [];

  for (const artist of REPRESENTATIVE_ARTISTS) {
    const result = await mixesdbSetsForResult(artist);
    if (!result.ok) {
      rows.push({
        artist,
        sets: "-",
        "newest date": "-",
        "tracklisted sets": "-",
        tracks: "-",
        status: `${result.classification}: ${result.error}`,
      });
      continue;
    }

    const summary = summarizeSets(result.data);
    let status: string = result.classification;
    if (result.classification === "complete" && summary.sets > 0 && summary.tracklistedSets === 0)
      status = "complete-no-tracklists";
    if (artist === "Ben UFO" && summary.sets === MDB_DIRECT_SET_LIMIT)
      status = `${status}; direct-limit-${MDB_DIRECT_SET_LIMIT}-warning`;
    rows.push({
      artist,
      sets: summary.sets,
      "newest date": summary.newestDate ?? "-",
      "tracklisted sets": summary.tracklistedSets,
      tracks: summary.tracks,
      status,
    });
  }

  printRows(rows);
  console.log("Read-only diagnostic: no Supabase connection or write was performed.");
}

await main();
