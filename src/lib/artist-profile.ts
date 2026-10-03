import { eventDateFromTitle } from "./set-date";

const identityKey = (value: string) => value.trim().toLowerCase();

export function artistIdentity(
  name: string,
  profile?: {
    aliases?: string[] | null;
    scenes?: string[] | null;
    notes?: string | null;
    imageUrl?: string | null;
  } | null,
) {
  const distinct = (values: string[] | null | undefined) => [
    ...new Map(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => [identityKey(value), value]),
    ).values(),
  ];
  return {
    aliases: distinct(profile?.aliases).filter((alias) => identityKey(alias) !== identityKey(name)),
    scenes: distinct(profile?.scenes),
    notes: profile?.notes?.trim() || null,
    imageUrl:
      profile?.imageUrl && /^(https?:\/\/|\/[^/])/i.test(profile.imageUrl)
        ? profile.imageUrl
        : null,
  };
}

export function resolveLocalLabel(
  name: string,
  labels: { id: string; name: string }[],
): string | null {
  const key = identityKey(name);
  if (!key) return null;
  const matches = labels.filter((label) => identityKey(label.name) === key);
  return matches.length === 1 ? matches[0]!.id : null;
}

/** Separate observed tracklist text from explicitly assigned library labels. */
export function artistLabelContext(
  names: string[],
  knownTracks: { label: string | null }[],
  savedTracks: { artist: string; label_id: string | null }[],
  labels: { id: string; name: string }[],
) {
  const known = new Map<string, { name: string; trackCount: number; labelId: string | null }>();
  for (const track of knownTracks) {
    const name = track.label?.trim();
    if (!name) continue;
    const key = identityKey(name);
    const row = known.get(key);
    if (row) row.trackCount++;
    else known.set(key, { name, trackCount: 1, labelId: resolveLocalLabel(name, labels) });
  }
  const artistNames = new Set(names.map(identityKey));
  const localCounts = new Map<string, number>();
  for (const track of savedTracks) {
    if (track.label_id && artistNames.has(identityKey(track.artist))) {
      localCounts.set(track.label_id, (localCounts.get(track.label_id) ?? 0) + 1);
    }
  }
  return {
    known: [...known.values()].sort((a, b) => a.name.localeCompare(b.name)),
    library: labels
      .filter((label) => localCounts.has(label.id))
      .map((label) => ({
        name: label.name,
        labelId: label.id,
        trackCount: localCounts.get(label.id)!,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function artistSetContext(set: {
  title: string;
  date: string | null;
  source: "mixesdb" | "soundcloud" | "ra";
}) {
  const source = { mixesdb: "MixesDB", soundcloud: "SoundCloud", ra: "RA" }[set.source];
  const eventDate = eventDateFromTitle(set.title);
  // Keep partial title dates partial; do not invent January 1 for a year-only title.
  const titleDate = /^(\d{4}(?:-\d{2})?(?:-\d{2})?)(?=\s|$)/.exec(set.title.trim())?.[1];
  if (eventDate) return { source, date: titleDate ?? eventDate, dateLabel: "Set date" };
  if (set.source === "mixesdb" || !set.date || Number.isNaN(Date.parse(set.date)))
    return { source, date: null, dateLabel: null };
  return {
    source,
    date: set.date.slice(0, 10),
    dateLabel: set.source === "soundcloud" ? "Uploaded" : "Published",
  };
}
