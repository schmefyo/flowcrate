/**
 * SoundCloud mixes for the DJs you follow.
 *
 * SoundCloud's public API is closed to new apps, but their web player ships a
 * short-lived `client_id` in the page's hydration blob, and the same `api-v2`
 * endpoints the player uses accept it. We scrape that id, cache it in memory,
 * and re-scrape whenever a call 401s.
 *
 * The array-returning compatibility API remains best-effort for interactive
 * views. Cache writers use the explicit result API below so a failure cannot
 * be mistaken for an empty account.
 */
import {
  sourceFetchFailure,
  sourceFetchSuccess,
  type SourceFetchResult,
} from "./source-fetch-result.ts";

export type ScSet = {
  title: string;
  url: string;
  dj: string;
  /** ISO date the mix was uploaded. */
  date: string | null;
  /** Minutes long — we only keep things long enough to be a mix. */
  minutes: number;
  plays: number;
  likes: number;
  /** Tracklist parsed out of the description, when the uploader wrote one. */
  tracks: { artist: string; title: string }[];
};

const UA = {
  "user-agent": "Mozilla/5.0 (compatible; FlowCrate/1.0)",
  accept: "application/json",
};

/** Anything shorter than this is a single, not a mix. */
const MIN_MIX_MINUTES = 18;
const REQUEST_TIMEOUT_MS = 15_000;

let cachedClientId: { id: string; at: number } | null = null;

async function clientId(force = false): Promise<string> {
  if (!force && cachedClientId && Date.now() - cachedClientId.at < 60 * 60 * 1000)
    return cachedClientId.id;
  try {
    const res = await fetch("https://soundcloud.com/discover", {
      headers: { "user-agent": UA["user-agent"] },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`SoundCloud discovery returned ${res.status}`);
    const html = await res.text();
    // The player hydration blob carries the id the web app itself uses.
    const hydration = html.match(/__sc_hydration\s*=\s*(\[.*?\]);/s);
    if (hydration) {
      try {
        const blob = JSON.parse(hydration[1]!) as { hydratable: string; data: any }[];
        const api = blob.find((e) => e.hydratable === "apiClient");
        if (api?.data?.id) {
          cachedClientId = { id: String(api.data.id), at: Date.now() };
          return cachedClientId.id;
        }
      } catch {
        /* fall through to the script-bundle scan */
      }
    }
    // Fallback: the id also appears inline in the player bundles.
    const inline = html.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{20,})"/);
    if (inline) {
      cachedClientId = { id: inline[1]!, at: Date.now() };
      return cachedClientId.id;
    }
    throw new Error("SoundCloud client id was not found");
  } catch (error) {
    throw error instanceof Error ? error : new Error("SoundCloud client id lookup failed");
  }
}

async function scApi(path: string, params: Record<string, string>): Promise<any> {
  let lastError: Error | null = null;
  for (const force of [false, true]) {
    try {
      const id = await clientId(force);
      const res = await fetch(
        `https://api-v2.soundcloud.com${path}?${new URLSearchParams({ ...params, client_id: id })}`,
        { headers: UA, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (res.status === 401 || res.status === 403) continue; // stale id — re-scrape once
      if (!res.ok) throw new Error(`SoundCloud API returned ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("SoundCloud API request failed");
    }
  }
  throw lastError ?? new Error("SoundCloud API request failed");
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** The SoundCloud account most likely to belong to this DJ, or null. */
async function findUser(name: string): Promise<{ id: number; username: string } | null> {
  const data = await scApi("/search/users", { q: name, limit: "5" });
  const users: any[] = data?.collection ?? [];
  if (!users.length) return null;
  const wanted = norm(name);
  const exact = users.filter((u) => norm(u.username ?? "") === wanted);
  const pool = exact.length ? exact : users.filter((u) => norm(u.username ?? "").includes(wanted));
  if (!pool.length) return null;
  // Among name matches, the biggest account is nearly always the real artist.
  pool.sort((a, b) => (b.followers_count ?? 0) - (a.followers_count ?? 0));
  return { id: pool[0].id, username: pool[0].username };
}

/**
 * Pull an "Artist - Title" tracklist out of a mix description.
 * Uploaders format these loosely, so we only keep lines that clearly split.
 */
export function parseScDescription(
  description: string | null,
): { artist: string; title: string }[] {
  if (!description) return [];
  const out: { artist: string; title: string }[] = [];
  for (const raw of description.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.length > 160) continue;
    // Strip leading indices and timestamps: "01.", "1)", "[00:04:12]", "04:12 -".
    line = line
      .replace(/^[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s*[-–—.)]?\s*/, "")
      .replace(/^\d{1,3}\s*[.)\]-]\s*/, "")
      .trim();
    const split = line.split(/\s+[-–—]\s+/);
    if (split.length < 2) continue;
    const artist = split[0]!.trim().replace(/^[["'(]+|[\]"')]+$/g, "");
    const title = split.slice(1).join(" - ").trim();
    if (!artist || !title) continue;
    if (artist.length > 80 || title.length > 120) continue;
    if (/^(tracklist|track list|w\/|support|follow|buy|download)$/i.test(artist)) continue;
    out.push({ artist, title });
  }
  // A couple of stray "word - word" lines aren't a tracklist.
  return out.length >= 4 ? out : [];
}

/** Recent long-form uploads, including an explicit provider outcome for cache writers. */
export async function soundcloudSetsForResult(
  name: string,
  limit = 20,
): Promise<SourceFetchResult<ScSet>> {
  try {
    const user = await findUser(name);
    if (!user) return sourceFetchSuccess([]);
    const data = await scApi(`/users/${user.id}/tracks`, {
      limit: String(Math.min(limit * 2, 50)),
    });
    if (!Array.isArray(data?.collection)) throw new Error("Invalid SoundCloud tracks response");
    const items: any[] = data.collection;
    return sourceFetchSuccess(
      items
        .filter((t) => (t?.duration ?? 0) >= MIN_MIX_MINUTES * 60 * 1000 && t?.permalink_url)
        .slice(0, limit)
        .map((t) => ({
          title: t.title ?? "Untitled",
          url: t.permalink_url as string,
          dj: name,
          date: t.created_at ? new Date(t.created_at).toISOString() : null,
          minutes: Math.round((t.duration ?? 0) / 60000),
          plays: t.playback_count ?? 0,
          likes: t.likes_count ?? 0,
          tracks: parseScDescription(t.description ?? null),
        })),
    );
  } catch (error) {
    return sourceFetchFailure(error);
  }
}

/** Recent long-form uploads for one DJ. Never throws. */
export async function soundcloudSetsFor(name: string, limit = 20): Promise<ScSet[]> {
  const result = await soundcloudSetsForResult(name, limit);
  return result.ok ? result.data : [];
}
