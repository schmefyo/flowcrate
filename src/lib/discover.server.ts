import { normalizeArtistName } from "./artist-name.ts";
import { eventDateForSet } from "./set-date.ts";

const API = "https://www.mixesdb.com/w/api.php";
const REQUEST_TIMEOUT_MS = 8_000;

const UA = { "user-agent": "FlowCrate/1.0 (dj discovery)", accept: "application/json" };

async function api(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ ...params, format: "json" })}`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: UA,
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`MixesDB returned ${res.status}`);
      const json = await res.json();
      if (json?.error)
        throw new Error(String(json.error.info ?? json.error.code ?? "MixesDB API error"));
      return json;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("MixesDB request failed");
}

export type DjHit = { name: string; url: string; loose?: boolean };

function catUrl(name: string): string {
  return `https://www.mixesdb.com/w/Category:${encodeURIComponent(name.replace(/ /g, "_"))}`;
}

/** How well an artist name matches the typed query. 0 = no name-level match. */
function nameScore(name: string, query: string): number {
  const n = normalizeArtistName(name);
  const q = normalizeArtistName(query);
  if (!n || !q) return 0;
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.includes(q)) return 60;
  const words = query.split(/\s+/).map(normalizeArtistName).filter(Boolean);
  if (words.length && words.every((w) => n.includes(w))) return 40;
  const hits = words.filter((w) => w.length > 2 && n.includes(w)).length;
  if (hits) return 10 + hits;
  return 0;
}

/** Search MixesDB artist categories (each DJ has a Category page). */
export async function searchDjs(query: string): Promise<DjHit[]> {
  const q = query.trim();
  if (!q) return [];

  const titles = new Set<string>();
  const collect = (json: any, list: "search" | "allpages") => {
    const rows: any[] = json?.query?.[list] ?? [];
    for (const r of rows) {
      const name = String(r?.title ?? "")
        .replace(/^Category:/, "")
        .trim();
      if (name) titles.add(name);
    }
  };

  const queries = [
    api({ action: "query", list: "search", srsearch: q, srnamespace: "14", srlimit: "20" })
      .then((j) => {
        collect(j, "search");
        return true;
      })
      .catch(() => false),
    api({ action: "query", list: "allpages", apnamespace: "14", apprefix: q, aplimit: "20" })
      .then((j) => {
        collect(j, "allpages");
        return true;
      })
      .catch(() => false),
  ];
  const answers = await Promise.all(queries);
  if (!answers.some(Boolean)) throw new Error("MixesDB didn't answer — try again in a moment");
  if (!titles.size) return [];

  const scored = [...titles].map((name) => ({
    name,
    url: catUrl(name),
    score: nameScore(name, q),
  }));
  const strong = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .map(({ name, url }) => ({ name, url }));
  if (strong.length) return strong;

  return scored
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, url }) => ({ name, url, loose: true }));
}

export type FeedTrack = {
  key: string;
  artist: string;
  title: string;
  label: string | null;
  plays: number;
  sets: { title: string; url: string }[];
};

export type Feed = {
  dj: string;
  /** Sets that actually had a parseable tracklist. */
  setsScanned: number;
  /** Sets found on MixesDB for this DJ (many have no tracklist yet). */
  setsFound: number;
  tracks: FeedTrack[];
  djUrl: string;
};

/** The MixesDB portion of a source-set-cache payload. Kept structural here to
 * avoid coupling the interactive artist search module back to the fetcher. */
export type FeedSet = {
  title: string;
  url: string;
  dj: string;
  date: string | null;
  tracks: { artist: string; title: string; label: string | null }[];
};

function setUrl(title: string): string {
  return `https://www.mixesdb.com/w/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

function feedFromSets(dj: string, sets: FeedSet[], setsFound: number): Feed {
  const djUrl = `https://www.mixesdb.com/w/Category:${encodeURIComponent(dj.replace(/ /g, "_"))}`;
  const agg = new Map<string, FeedTrack>();
  let scanned = 0;

  for (const set of sets) {
    const rows = set.tracks
      .map(cleanRow)
      .filter((row): row is FeedSet["tracks"][number] => row !== null);
    if (!rows.length) continue;
    scanned += 1;
    const seen = new Set<string>();
    for (const row of rows) {
      const key = `${row.artist.toLowerCase()}|||${row.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = agg.get(key);
      if (existing) {
        existing.plays += 1;
        if (!existing.label && row.label) existing.label = row.label;
        if (existing.sets.length < 6)
          existing.sets.push({ title: set.title, url: setUrl(set.title) });
      } else {
        agg.set(key, {
          key,
          artist: row.artist,
          title: row.title,
          label: row.label ?? null,
          plays: 1,
          sets: [{ title: set.title, url: setUrl(set.title) }],
        });
      }
    }
  }

  return {
    dj,
    setsScanned: scanned,
    setsFound,
    tracks: [...agg.values()].sort((a, b) => b.plays - a.plays || a.artist.localeCompare(b.artist)),
    djUrl,
  };
}

/** Aggregate an artist's most-played tracks from already fetched MixesDB sets. */
export function djFeedFromSets(
  dj: string,
  setLimit = 20,
  aliases: string[] = [],
  cachedSets: FeedSet[] = [],
): Feed {
  const name = dj.trim().replace(/^Category:/, "");
  if (!name) return feedFromSets(name, [], 0);
  const names = [
    ...new Set([name, ...aliases.map((a) => a.trim().replace(/^Category:/, ""))].filter(Boolean)),
  ];
  const wanted = new Set(names);
  const perName = new Map<string, FeedSet[]>();

  for (const set of cachedSets) {
    if (!wanted.has(set.dj)) continue;
    const list = perName.get(set.dj) ?? [];
    list.push(set);
    perName.set(set.dj, list);
  }

  const limit = setLimit === 0 ? Infinity : Math.max(setLimit, 1);
  const unique = new Map<string, FeedSet>();
  for (const artistName of names) {
    const recent = (perName.get(artistName) ?? [])
      .sort((a, b) => {
        const aDate = eventDateForSet(a);
        const bDate = eventDateForSet(b);
        if (aDate && bDate) return bDate.localeCompare(aDate);
        if (aDate) return -1;
        if (bDate) return 1;
        return a.title.localeCompare(b.title);
      })
      .slice(0, limit);
    for (const set of recent) if (!unique.has(set.title)) unique.set(set.title, set);
  }
  return feedFromSets(name, [...unique.values()], unique.size);
}

const NOISE = /^(\?+|id|unknown|untitled|w\/|-)$/i;

/** Bracketed notes MixesDB editors add that are annotations, not record labels. */
const NOT_A_LABEL =
  /^(excerpt|excerpt only|unreleased|white ?label|promo|dub ?plate|dubplate|forthcoming|unknown|unidentified|id|edit|remix|bootleg|acappella|a ?capp?ella|cut short|short|loop|intro|outro|self ?released|not on label|free ?download|snippet|part \d+|mashup|vinyl only|digital only|reissue|repress|tbc|tba|\?+)$/i;

function cleanLabel(value: string): string | null {
  const v = value.trim();
  if (!v || NOT_A_LABEL.test(v)) return null;
  // e.g. "[Excerpt only, Some Label]" → keep only if there's a real label part
  if (/^\d{1,4}$/.test(v)) return null;
  return v;
}

/** A real name has at least one letter ("#####", "###.1", "???" don't). */
const HAS_LETTER = /[a-z]/i;

/** Leading position/minute markers editors add: "(15)", "[09]", "12.", "3)". */
const LEADING_MARKER = /^(?:[([]\s*\d{1,3}(?:[:.]\d{1,2})?\s*[)\]]|\d{1,3}[.)])\s*/;

function stripMarker(value: string): string {
  return value.replace(LEADING_MARKER, "").trim();
}

export type ParsedRow = { artist: string; title: string; label?: string | null };

/**
 * Normalise one tracklist row and reject junk. Also applied to cached rows so
 * stale scrapes stored before a parser fix don't keep polluting the feeds.
 */
export function cleanRow<T extends ParsedRow>(row: T): T | null {
  const artist = stripMarker(String(row.artist ?? "").trim());
  const title = stripMarker(String(row.title ?? "").trim());
  if (!artist || !title) return null;
  if (NOISE.test(artist) || NOISE.test(title)) return null;
  if (!HAS_LETTER.test(artist) || !HAS_LETTER.test(title)) return null;
  if (artist.length > 120 || title.length > 160) return null;
  return { ...row, artist, title };
}

export function parseTracklist(
  wikitext: string,
): { artist: string; title: string; label: string | null }[] {
  const out: { artist: string; title: string; label: string | null }[] = [];
  for (const raw of wikitext.split("\n")) {
    let line = raw.trim();
    if (!line.startsWith("#")) continue;
    line = line.replace(/^#+\s*/, "");
    // leading timestamp markers like [00], [1?], [00:12], (15), 09.
    line = line.replace(/^\[[0-9?:.]+\]\s*/, "");
    line = stripMarker(line);
    // wiki markup
    line = line
      .replace(/\{\{[^}]*\}\}/g, " ")
      .replace(/'''?/g, "")
      .replace(/<[^>]+>/g, " ")
      .trim();
    line = stripMarker(line);
    if (!line || line.length < 5) continue;

    let label: string | null = null;
    const labelMatch = line.match(/\[([^\][]{2,60})\]\s*$/);
    if (labelMatch) {
      const labelText = labelMatch[1];
      if (labelText) label = cleanLabel(labelText);
      line = line.slice(0, labelMatch.index).trim();
    }

    const sep = line.match(/\s+[–-]\s+/);
    if (!sep || sep.index === undefined) continue;
    const cleaned = cleanRow({
      artist: line.slice(0, sep.index).trim(),
      title: line.slice(sep.index + sep[0].length).trim(),
      label,
    });
    if (!cleaned) continue;
    out.push({ artist: cleaned.artist, title: cleaned.title, label: cleaned.label ?? null });
  }
  return out;
}

/** Aggregate the most-played tracks across a DJ's most recent MixesDB sets. */
export async function djFeed(dj: string, setLimit = 20, aliases: string[] = []): Promise<Feed> {
  const name = dj.trim().replace(/^Category:/, "");
  const djUrl = `https://www.mixesdb.com/w/Category:${encodeURIComponent(name.replace(/ /g, "_"))}`;
  if (!name) return { dj: name, setsScanned: 0, setsFound: 0, tracks: [], djUrl };

  // Merged artists can have several MixesDB spellings — scan every category.
  const names = [
    ...new Set([name, ...aliases.map((a) => a.trim().replace(/^Category:/, ""))].filter(Boolean)),
  ];

  const titleSet = new Set<string>();
  let anyAnswer = false;
  for (const alt of names) {
    let cm: any;
    try {
      cm = await api({
        action: "query",
        list: "categorymembers",
        cmtitle: `Category:${alt}`,
        cmlimit: String(Math.min(Math.max(setLimit, 1), 200)),
        cmnamespace: "0",
        cmsort: "timestamp",
        cmdir: "desc",
      });
      anyAnswer = true;
    } catch {
      continue;
    }
    for (const m of cm?.query?.categorymembers ?? []) titleSet.add(String(m.title));
  }
  if (!anyAnswer) throw new Error("MixesDB didn't answer — try again in a moment");
  const titles: string[] = [...titleSet];
  if (!titles.length) return { dj: name, setsScanned: 0, setsFound: 0, tracks: [], djUrl };

  const agg = new Map<string, FeedTrack>();
  let scanned = 0;

  for (let i = 0; i < titles.length; i += 10) {
    const batch = titles.slice(i, i + 10);
    let pagesJson: any;
    try {
      pagesJson = await api({
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: batch.join("|"),
      });
    } catch {
      continue;
    }
    const pages: any[] = Object.values(pagesJson?.query?.pages ?? {});
    for (const page of pages) {
      const content = page?.revisions?.[0]?.slots?.main?.["*"];
      if (typeof content !== "string") continue;
      const rows = parseTracklist(content);
      if (!rows.length) continue;
      scanned += 1;
      const pageTitle = String(page.title);
      const seen = new Set<string>();
      for (const row of rows) {
        const key = `${row.artist.toLowerCase()}|||${row.title.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = agg.get(key);
        if (existing) {
          existing.plays += 1;
          if (!existing.label && row.label) existing.label = row.label;
          if (existing.sets.length < 6)
            existing.sets.push({ title: pageTitle, url: setUrl(pageTitle) });
        } else {
          agg.set(key, {
            key,
            artist: row.artist,
            title: row.title,
            label: row.label,
            plays: 1,
            sets: [{ title: pageTitle, url: setUrl(pageTitle) }],
          });
        }
      }
    }
  }

  const tracks = [...agg.values()].sort(
    (a, b) => b.plays - a.plays || a.artist.localeCompare(b.artist),
  );

  return { dj: name, setsScanned: scanned, setsFound: titles.length, tracks, djUrl };
}
