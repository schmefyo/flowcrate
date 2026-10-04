import type { AliasRow } from "./artist-name.ts";
import { resolveLocalArtist } from "./label-library.ts";
import { eventDateFromTitle } from "./set-date.ts";

export type DiscoverySource = {
  dj_name: string | null;
  provider: "mixesdb" | "soundcloud" | "ra";
  set_title: string;
  set_url: string;
  set_date: string | null;
};
export type DiscoveryRecord = DiscoverySource & { track_id: string };

export function discoverySources(
  sets: {
    title: string;
    url: string;
    dj?: string | undefined;
    source?: DiscoverySource["provider"];
  }[],
  followed: AliasRow[] = [],
): DiscoverySource[] {
  const unique = new Map<string, DiscoverySource>();
  for (const set of sets) {
    if (!set.title.trim() || !/^https?:\/\//i.test(set.url)) continue;
    const dj = set.dj?.trim() || null;
    const source: DiscoverySource = {
      dj_name: dj ? (resolveLocalArtist(dj, followed) ?? dj) : null,
      provider: set.source ?? "mixesdb",
      set_title: set.title,
      set_url: set.url,
      // Never turn upload/category-membership dates into performance dates.
      set_date: eventDateFromTitle(set.title),
    };
    unique.set(
      JSON.stringify([source.provider, source.set_url, source.dj_name?.toLowerCase() ?? ""]),
      source,
    );
  }
  return [...unique.values()];
}

export function discoveryFilterIndex(records: DiscoveryRecord[], followed: AliasRow[] = []) {
  const byArtist = new Map<string, Set<string>>();
  const displayNames = new Map<string, string>();
  for (const record of records) {
    if (!record.dj_name) continue;
    const name = resolveLocalArtist(record.dj_name, followed) ?? record.dj_name.trim();
    if (!name) continue;
    const key = displayNames.get(name.toLowerCase()) ?? name;
    displayNames.set(name.toLowerCase(), key);
    const tracks = byArtist.get(key) ?? new Set<string>();
    tracks.add(record.track_id);
    byArtist.set(key, tracks);
  }
  return byArtist;
}

export function matchesDiscoveryFilter(
  id: string,
  selected: string[],
  index: Map<string, Set<string>>,
) {
  return !selected.length || selected.some((name) => index.get(name)?.has(id));
}
