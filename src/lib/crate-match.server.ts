import { parseTracklist } from "./discover.server";
import { eventDateFromTitle } from "./set-date";
import { discoverySources, type DiscoverySource } from "./discovery-provenance";

const API = "https://www.mixesdb.com/w/api.php";
const UA = { "user-agent": "FlowCrate/1.0 (crate matching)", accept: "application/json" };
const REQUEST_TIMEOUT_MS = 8_000;

async function api(params: Record<string, string>): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${API}?${new URLSearchParams({ ...params, format: "json" })}`, {
        headers: UA,
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`MixesDB returned ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MixesDB request failed");
}

export type CrateInputTrack = { artist: string; title: string };

export type SimilarSet = {
  title: string;
  url: string;
  date: string | null;
  matches: number;
  matched: string[];
};

export type GapTrack = {
  key: string;
  artist: string;
  title: string;
  label: string | null;
  sets: number;
  examples: { title: string; url: string }[];
  discoverySources?: DiscoverySource[];
};

export type CrateMatchResult = {
  tracksProbed: number;
  setsScanned: number;
  similarSets: SimilarSet[];
  gaps: GapTrack[];
  /** The sets whose tracklists were actually read, so the UI can show them. */
  setsRead: { title: string; url: string }[];
};

const clean = (s: string) =>
  s
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function setUrl(title: string): string {
  return `https://www.mixesdb.com/w/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = await fn(items[i]!);
      } catch {
        out[i] = undefined as unknown as R;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Find MixesDB sets that share the most tracks with a crate, and the tracks that
 * most often appear alongside the crate inside those sets.
 */
export async function crateMatches(
  tracks: CrateInputTrack[],
  opts: { trackLimit?: number; setLimit?: number } = {},
): Promise<CrateMatchResult> {
  const probe = tracks
    .map((t) => ({ artist: clean(t.artist), title: clean(t.title) }))
    .filter((t) => t.artist && t.title)
    .slice(0, Math.min(Math.max(opts.trackLimit ?? 25, 1), 40));

  if (!probe.length)
    return { tracksProbed: 0, setsScanned: 0, similarSets: [], gaps: [], setsRead: [] };

  const owned = new Set(tracks.map((t) => `${norm(t.artist)}|||${norm(t.title)}`));

  // 1. Which sets contain each crate track?
  const hitLists = await mapLimit(probe, 4, async (t) => {
    try {
      const json = await api({
        action: "query",
        list: "search",
        srsearch: `${t.artist} ${t.title}`,
        srlimit: "30",
        srnamespace: "0",
      });
      const results: any[] = json?.query?.search ?? [];
      return {
        ok: true as const,
        track: t,
        titles: results.map((r) => String(r?.title ?? "")).filter(Boolean),
      };
    } catch {
      return { ok: false as const, track: t, titles: [] as string[] };
    }
  });
  if (!hitLists.some((hit) => hit?.ok))
    throw new Error("MixesDB didn't answer — try again in a moment");

  const setHits = new Map<string, Set<string>>();
  for (const hit of hitLists) {
    if (!hit?.ok) continue;
    const label = `${hit.track.artist} — ${hit.track.title}`;
    for (const pageTitle of hit.titles) {
      const bucket = setHits.get(pageTitle) ?? new Set<string>();
      bucket.add(label);
      setHits.set(pageTitle, bucket);
    }
  }

  const similarSets: SimilarSet[] = [...setHits.entries()]
    .map(([title, matched]) => ({
      title,
      url: setUrl(title),
      date: eventDateFromTitle(title),
      matches: matched.size,
      matched: [...matched],
    }))
    .filter((s) => s.matches > 0)
    .sort((a, b) => {
      if (b.matches !== a.matches) return b.matches - a.matches;
      if (a.date && b.date) return b.date.localeCompare(a.date);
      if (a.date) return -1;
      if (b.date) return 1;
      return a.title.localeCompare(b.title);
    })
    .slice(0, 120);

  // 2. Co-occurring tracks inside the closest sets. Multi-match sets are the
  // strongest signal, but we always top up with single-match sets so the
  // recommendations aren't drawn from just one or two mixes.
  const setBudget = Math.min(Math.max(opts.setLimit ?? 60, 1), 90);
  const multi = similarSets.filter((s) => s.matches >= 2);
  const single = similarSets.filter((s) => s.matches < 2);
  const deepen = [...multi, ...single].slice(0, setBudget);

  const agg = new Map<string, GapTrack>();
  const setsRead: { title: string; url: string }[] = [];
  let scanned = 0;

  for (let i = 0; i < deepen.length; i += 10) {
    const batch = deepen.slice(i, i + 10);
    let pagesJson: any;
    try {
      pagesJson = await api({
        action: "query",
        prop: "revisions",
        rvprop: "content",
        rvslots: "main",
        titles: batch.map((s) => s.title).join("|"),
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
      setsRead.push({ title: pageTitle, url: setUrl(pageTitle) });
      const seen = new Set<string>();
      for (const row of rows) {
        const key = `${norm(row.artist)}|||${norm(row.title)}`;
        if (!key.replace(/\|/g, "").trim()) continue;
        if (owned.has(key) || seen.has(key)) continue;
        seen.add(key);
        const existing = agg.get(key);
        if (existing) {
          existing.sets += 1;
          existing.discoverySources?.push(
            ...discoverySources([{ title: pageTitle, url: setUrl(pageTitle) }]),
          );
          if (!existing.label && row.label) existing.label = row.label;
          if (existing.examples.length < 5)
            existing.examples.push({ title: pageTitle, url: setUrl(pageTitle) });
        } else {
          agg.set(key, {
            key,
            artist: row.artist,
            title: row.title,
            label: row.label,
            sets: 1,
            examples: [{ title: pageTitle, url: setUrl(pageTitle) }],
            discoverySources: discoverySources([{ title: pageTitle, url: setUrl(pageTitle) }]),
          });
        }
      }
    }
  }

  const all = [...agg.values()].sort((a, b) => b.sets - a.sets || a.artist.localeCompare(b.artist));
  const repeated = all.filter((g) => g.sets > 1);
  // Repeats are the best signal, but when only a handful of sets were readable
  // almost nothing repeats — fall back to one-off co-plays rather than showing
  // an empty list.
  const gaps = (repeated.length >= 12 ? repeated : all).slice(0, 150);

  return { tracksProbed: probe.length, setsScanned: scanned, similarSets, gaps, setsRead };
}
