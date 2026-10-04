import { normalizeArtistName } from "./artist-name";
import { cleanRow } from "./discover.server";
import { eventDateForSet } from "./set-date";
import { cachedMixesdbSets, cachedRaSets, cachedSoundcloudSets } from "./source-cache.server";
import type { MdbSet } from "./mixesdb-sets.server";
import type { ScSet } from "./soundcloud.server";
import type { RaSet } from "./ra.server";
import { discoverySources, type DiscoverySource } from "./discovery-provenance";

/** Where a set (and its tracklist) came from. */
export type SetSource = "mixesdb" | "soundcloud" | "ra";

export type RadarSet = {
  title: string;
  url: string;
  dj: string;
  /** ISO timestamp: when the set landed on MixesDB, or the SoundCloud upload date. */
  date: string | null;
  source: SetSource;
  /** SoundCloud engagement, when we have it. */
  plays?: number;
  likes?: number;
  minutes?: number;
};

/** SoundCloud mixes as radar sets. */
function scToRadarSets(sets: ScSet[]): RadarSet[] {
  return sets.map((s) => ({
    title: s.title,
    url: s.url,
    dj: s.dj,
    date: s.date,
    source: "soundcloud" as const,
    plays: s.plays,
    likes: s.likes,
    minutes: s.minutes,
  }));
}

function raToRadarSets(sets: RaSet[]): RadarSet[] {
  return sets.map((s) => ({
    title: s.title,
    url: s.url,
    dj: s.dj,
    date: s.date,
    source: "ra" as const,
    minutes: s.minutes,
  }));
}

function mdbToRadarSet(s: MdbSet): RadarSet {
  return {
    title: s.title,
    url: s.url,
    dj: s.dj,
    date: s.date,
    source: "mixesdb" as const,
  };
}

export type SetSlots = {
  /** Times this track opened a set (first 15% of the tracklist). */
  opener: number;
  /** Times it landed in the peak-time stretch (50–88% through). */
  peak: number;
  /** Times it closed a set (last 12%). */
  closer: number;
};

export type RadarTrack = {
  key: string;
  artist: string;
  title: string;
  label: string | null;
  /** Total appearances across all followed DJs' scanned sets. */
  plays: number;
  /** Which of your followed DJs played it. */
  djs: string[];
  /** Newest set date this track appeared in. */
  latest: string | null;
  /** Where in a set DJs tend to drop it. */
  slots: SetSlots;
  sets: RadarSet[];
  discoverySources?: DiscoverySource[];
};

export type Radar = {
  djs: string[];
  setsScanned: number;
  tracks: RadarTrack[];
  newSets: RadarSet[];
};

/** Max distinct artists credited on a set before we treat it as a compilation. */
const MAX_SET_ARTISTS = 5;

/**
 * MixesDB titles look like "2024-01-02 - Artist A, Artist B @ Venue".
 * Sets billed to lots of artists (or "VA") pollute the radar, so skip them.
 */
export function isMultiArtistSet(title: string): boolean {
  const head = title.split(" @ ")[0] ?? title;
  const billing = head.replace(/^[^-]*-\s*/, "").trim();
  const artists = billing
    .split(/,|\bb2b\b|\bvs\.?\b|\band\b|&/i)
    .map((a) => a.trim())
    .filter(Boolean);
  if (artists.some((a) => /^(va|v\.a\.|various artists)$/i.test(a))) return true;
  return artists.length > MAX_SET_ARTISTS;
}

function names(djs: string[]): string[] {
  return [...new Set(djs.map((d) => d.trim().replace(/^Category:/, "")).filter(Boolean))];
}

function withinWindow(date: string | null, sinceMonths: number): boolean {
  if (sinceMonths <= 0) return true;
  const cutoff = Date.now() - sinceMonths * 30 * 24 * 60 * 60 * 1000;
  return !date || Date.parse(date) >= cutoff;
}

function normalizeSetTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function physicalSetKey(set: { dj: string; title: string; date?: string | null }): string {
  const dj = normalizeArtistName(set.dj);
  const day = eventDateForSet(set);
  return `${dj}|${day ?? normalizeSetTitle(set.title)}`;
}

/**
 * Aggregate the most-played tracks across every DJ the user follows.
 * Both sources come out of the twice-a-day cache, so this is a fast read.
 * `sinceMonths` limits the scan to sets from that window.
 */
export async function radarFeed(djs: string[], setLimit = 25, sinceMonths = 0): Promise<Radar> {
  const list = names(djs);
  if (!list.length) return { djs: [], setsScanned: 0, tracks: [], newSets: [] };

  const [mdbRaw, scRaw, raRaw] = await Promise.all([
    cachedMixesdbSets(list),
    cachedSoundcloudSets(list),
    cachedRaSets(list),
  ]);

  // A zero limit means every cached set for that artist. Discover uses that
  // full-history mode; other callers retain their bounded defaults.
  const perDjLimit = setLimit === 0 ? Infinity : Math.max(setLimit, 1);
  const perDj = new Map<string, MdbSet[]>();
  for (const s of mdbRaw) {
    if (isMultiArtistSet(s.title) || !withinWindow(eventDateForSet(s), sinceMonths)) continue;
    const arr = perDj.get(s.dj) ?? [];
    arr.push(s);
    perDj.set(s.dj, arr);
  }
  let mdbSets: MdbSet[] = [];
  for (const arr of perDj.values()) {
    arr.sort(
      (a, b) => Date.parse(eventDateForSet(b) ?? "0") - Date.parse(eventDateForSet(a) ?? "0"),
    );
    mdbSets.push(...arr.slice(0, perDjLimit));
  }
  mdbSets.sort(
    (a, b) => Date.parse(eventDateForSet(b) ?? "0") - Date.parse(eventDateForSet(a) ?? "0"),
  );

  // A set can belong to several followed DJs — keep one credit per DJ.
  const credits = new Map<string, { set: MdbSet; djs: string[] }>();
  for (const s of mdbSets) {
    const entryForSet = credits.get(s.title);
    if (!entryForSet) credits.set(s.title, { set: s, djs: [s.dj] });
    else if (!entryForSet.djs.includes(s.dj)) entryForSet.djs.push(s.dj);
  }
  const scoped = [...credits.values()];

  const agg = new Map<string, RadarTrack>();
  let scanned = 0;

  const add = (
    rows: { artist: string; title: string; label?: string | null }[],
    creditSets: RadarSet[],
    playedDate: string | null,
  ) => {
    // Cached scrapes can predate a parser fix, so junk is filtered here too.
    rows = rows
      .map(cleanRow)
      .filter((r): r is { artist: string; title: string; label?: string | null } => !!r);
    if (!rows.length) return;
    scanned += 1;
    const seen = new Set<string>();
    for (const [index, row] of rows.entries()) {
      const key = `${row.artist.toLowerCase()}|||${row.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let entry = agg.get(key);
      if (!entry) {
        entry = {
          key,
          artist: row.artist,
          title: row.title,
          label: row.label ?? null,
          plays: 0,
          djs: [],
          latest: null,
          slots: { opener: 0, peak: 0, closer: 0 },
          sets: [],
          discoverySources: [],
        };
        agg.set(key, entry);
      }
      if (!entry.label && row.label) entry.label = row.label;
      // Where in the set it sat — a one-play closer is a stronger signal than filler.
      const at = (index + 1) / rows.length;
      if (at <= 0.15) entry.slots.opener += 1;
      else if (at >= 0.88) entry.slots.closer += 1;
      else if (at >= 0.5) entry.slots.peak += 1;
      for (const credit of creditSets) {
        entry.discoverySources?.push(...discoverySources([credit]));
        entry.plays += 1;
        if (!entry.djs.includes(credit.dj)) entry.djs.push(credit.dj);
        if (playedDate && (!entry.latest || Date.parse(playedDate) > Date.parse(entry.latest)))
          entry.latest = playedDate;
        if (entry.sets.length < 12) entry.sets.push(credit);
      }
    }
  };

  // The same broadcast often shows up on several sources (a MixesDB page, the
  // NTS/SoundCloud upload, an RA episode). Count each DJ-day once, preferring
  // the source with the most reliable tracklist.
  const seenBroadcast = new Set<string>();
  const firstTime = (dj: string, date: string | null, title: string) => {
    const id = physicalSetKey({ dj, date, title });
    if (seenBroadcast.has(id)) return false;
    seenBroadcast.add(id);
    return true;
  };

  const usedMdb: MdbSet[] = [];
  for (const { set, djs: creditDjs } of scoped) {
    // Prefer the set's own date (from its title) over the date it was uploaded.
    const played = eventDateForSet(set);
    const credits2 = creditDjs.filter((dj) => firstTime(dj, played, set.title));
    if (!credits2.length) continue;
    usedMdb.push(set);
    add(
      set.tracks,
      credits2.map((dj) => ({ ...mdbToRadarSet(set), dj })),
      played,
    );
  }

  // RA podcasts ship a clean tracklist per episode.
  const raSetsList = raRaw.filter((s) => {
    const played = eventDateForSet(s);
    return withinWindow(played, sinceMonths) && firstTime(s.dj, s.date, s.title);
  });
  for (const ep of raSetsList) {
    const played = eventDateForSet(ep);
    add(ep.tracks, [raToRadarSets([ep])[0]!], played);
  }

  // SoundCloud mixes: fresher than MixesDB, and some uploaders post a tracklist
  // in the description, which folds into the same aggregate.
  const scSets = scRaw.filter((s) => {
    const played = eventDateForSet(s);
    return (
      !isMultiArtistSet(s.title) &&
      withinWindow(played, sinceMonths) &&
      firstTime(s.dj, s.date, s.title)
    );
  });
  for (const mix of scSets) {
    const played = eventDateForSet(mix);
    add(mix.tracks, [scToRadarSets([mix])[0]!], played);
  }

  const tracks = [...agg.values()].sort(
    (a, b) => b.djs.length - a.djs.length || b.plays - a.plays || a.artist.localeCompare(b.artist),
  );

  // One row per set in the "new sets" list, even when several follows are credited.
  const seenTitles = new Set<string>();
  const newSets = [
    ...usedMdb.map(mdbToRadarSet),
    ...scToRadarSets(scSets),
    ...raToRadarSets(raSetsList),
  ]
    .sort((a, b) => Date.parse(eventDateForSet(b) ?? "0") - Date.parse(eventDateForSet(a) ?? "0"))
    .filter((s) => {
      const id = physicalSetKey(s);
      if (seenTitles.has(id)) return false;
      seenTitles.add(id);
      return true;
    });

  return { djs: list, setsScanned: scanned, tracks, newSets: newSets.slice(0, 60) };
}

/**
 * Cheap "newest sets" feed: lists recent cached sets for the given DJs without
 * touching any tracklists, so it stays fast for every follow.
 */
export async function radarSets(
  djs: string[],
  setLimit = 25,
  sinceMonths = 0,
  fallbackMissing = false,
): Promise<RadarSet[]> {
  const list = names(djs);
  if (!list.length) return [];

  const [mdbRaw, scRaw, raRaw] = await Promise.all([
    cachedMixesdbSets(list, fallbackMissing),
    cachedSoundcloudSets(list, fallbackMissing),
    cachedRaSets(list, fallbackMissing),
  ]);

  const perDj = new Map<string, MdbSet[]>();
  for (const s of mdbRaw) {
    if (isMultiArtistSet(s.title) || !withinWindow(eventDateForSet(s), sinceMonths)) continue;
    const arr = perDj.get(s.dj) ?? [];
    arr.push(s);
    perDj.set(s.dj, arr);
  }
  const mdb: RadarSet[] = [];
  for (const arr of perDj.values()) {
    arr.sort(
      (a, b) => Date.parse(eventDateForSet(b) ?? "0") - Date.parse(eventDateForSet(a) ?? "0"),
    );
    mdb.push(...arr.slice(0, setLimit).map(mdbToRadarSet));
  }

  const sets = [
    ...mdb,
    ...scToRadarSets(
      scRaw.filter(
        (s) => !isMultiArtistSet(s.title) && withinWindow(eventDateForSet(s), sinceMonths),
      ),
    ),
    ...raToRadarSets(raRaw.filter((s) => withinWindow(eventDateForSet(s), sinceMonths))),
  ];

  sets.sort(
    (a, b) => Date.parse(eventDateForSet(b) ?? "0") - Date.parse(eventDateForSet(a) ?? "0"),
  );

  const seen = new Set<string>();
  return sets.filter((s) => {
    const id = physicalSetKey(s);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
