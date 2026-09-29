/**
 * Resident Advisor podcasts for the DJs you follow.
 *
 * RA renders its pages from an embedded Apollo cache, and podcast entries carry
 * a plain-text `tracklist` field. We read the podcast index once per refresh,
 * match episode titles against a followed DJ's name, then pull the tracklist
 * from the matched episode pages.
 *
 * Interactive callers receive best-effort arrays. Cache writers use the
 * explicit result API so an upstream failure is never stored as an empty feed.
 */
import { normalizeArtistName } from "./artist-name.ts";
import {
  sourceFetchFailure,
  sourceFetchSuccess,
  type SourceFetchResult,
} from "./source-fetch-result.ts";

export type RaSet = {
  title: string;
  url: string;
  dj: string;
  /** ISO date the episode was published. */
  date: string | null;
  minutes: number;
  tracks: { artist: string; title: string }[];
};

const UA = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  accept: "text/html",
};
const REQUEST_TIMEOUT_MS = 15_000;

type RaEpisode = { id: string; title: string; date: string | null };

function unescapeJson(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value;
  }
}

function minutesFrom(duration: string | null): number {
  const parts = (duration ?? "").split(":").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return 0;
  return Math.round(parts[0]! * 60 + parts[1]! + parts[2]! / 60);
}

async function html(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: UA,
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Resident Advisor returned ${res.status}`);
  return res.text();
}

/** Recent podcast episodes from RA's index page. */
async function podcastIndex(): Promise<RaEpisode[]> {
  const page = await html("https://ra.co/podcast");
  const out: RaEpisode[] = [];
  const re = /"Podcast:(\d+)":\{[^{}]*?"title":"((?:[^"\\]|\\.)*)"[^{}]*?"date":"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(page))) {
    out.push({
      id: m[1]!,
      title: unescapeJson(m[2]!),
      date: m[3] || null,
    });
  }
  return out;
}

/** Pull the tracklist and length out of a single episode page. */
async function episodeDetail(
  id: string,
): Promise<{ minutes: number; tracks: { artist: string; title: string }[] }> {
  const page = await html(`https://ra.co/podcast/${id}`);
  const dur = new RegExp(`"Podcast:${id}":\\{[\\s\\S]{0,6000}?"duration":"([^"]*)"`).exec(page);
  const m = new RegExp(
    `"Podcast:${id}":\\{[\\s\\S]{0,6000}?"tracklist":"((?:[^"\\\\]|\\\\.)*)"`,
  ).exec(page);
  const minutes = minutesFrom(dur?.[1] ?? null);
  if (!m) return { minutes, tracks: [] };
  const tracks = unescapeJson(m[1]!)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // RA writes "Track title - Artist".
      const idx = line.lastIndexOf(" - ");
      if (idx === -1) return null;
      const title = line.slice(0, idx).trim();
      const artist = line.slice(idx + 3).trim();
      if (!title || !artist || title === "?" || artist === "?") return null;
      return { artist, title };
    })
    .filter((t): t is { artist: string; title: string } => Boolean(t));
  return { minutes, tracks };
}

/** Cap episode page fetches per DJ refresh. */
const MAX_EPISODES_PER_DJ = 4;

/** RA podcasts hosted by the given DJ, with tracklists. */
export async function raSetsForResult(dj: string): Promise<SourceFetchResult<RaSet>> {
  const name = normalizeArtistName(dj);
  // Very short handles match too many episode titles by accident.
  if (name.length < 4) return sourceFetchSuccess([]);
  try {
    const episodes = await podcastIndex();
    const mine = episodes
      .filter((e) => normalizeArtistName(e.title).includes(name))
      .slice(0, MAX_EPISODES_PER_DJ);

    const out: RaSet[] = [];
    for (const ep of mine) {
      const { minutes, tracks } = await episodeDetail(ep.id);
      out.push({
        title: ep.title,
        url: `https://ra.co/podcast/${ep.id}`,
        dj,
        date: ep.date,
        minutes,
        tracks,
      });
    }
    return sourceFetchSuccess(out);
  } catch (error) {
    return sourceFetchFailure(error);
  }
}

/** RA podcasts hosted by the given DJ. Never throws for interactive callers. */
export async function raSetsFor(dj: string): Promise<RaSet[]> {
  const result = await raSetsForResult(dj);
  return result.ok ? result.data : [];
}
