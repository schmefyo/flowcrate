import type { AliasRow } from "./artist-name";

// Match whole names/explicit aliases only. Do not guess collaborations or strip punctuation.
export function resolveLocalArtist(name: string, followed: AliasRow[]): string | null {
  const key = name.trim().toLocaleLowerCase();
  if (!key) return null;
  const matches = followed.filter((row) =>
    [row.name, ...(row.aliases ?? [])].some((value) => value.trim().toLocaleLowerCase() === key),
  );
  return matches.length === 1 ? matches[0]!.name : null;
}

/** Read all matching rows without silently accepting the default database row ceiling. */
export async function readLibraryPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

export function deriveLabelLibrary<
  T extends { id: string; label_id: string | null; artist: string | null },
>(
  labelId: string,
  tracks: T[],
  memberships: { crate_id: string; track_id: string }[],
  crates: { id: string; name: string }[],
) {
  const assigned = tracks.filter((track) => track.label_id === labelId);
  const ids = new Set(assigned.map((track) => track.id));
  const artists = new Map<string, { name: string; trackCount: number }>();
  for (const track of assigned) {
    const name = track.artist?.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const existing = artists.get(key);
    if (existing) existing.trackCount++;
    else artists.set(key, { name, trackCount: 1 });
  }
  const byCrate = new Map<string, Set<string>>();
  for (const membership of memberships) {
    if (!ids.has(membership.track_id)) continue;
    const members = byCrate.get(membership.crate_id) ?? new Set<string>();
    members.add(membership.track_id);
    byCrate.set(membership.crate_id, members);
  }
  return {
    tracks: assigned,
    artists: [...artists.values()].sort((a, b) => a.name.localeCompare(b.name)),
    crates: crates
      .filter((crate) => byCrate.has(crate.id))
      .map((crate) => ({
        ...crate,
        trackCount: byCrate.get(crate.id)!.size,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
