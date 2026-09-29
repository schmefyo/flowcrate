/**
 * Outside-popularity + genre lookup for Discover rows.
 *
 * MixesDB play counts only say how many of *your* picked DJs played a track.
 * This adds a signal from the wider world: Deezer's popularity `rank` (0–1M)
 * plus the release's genres, with iTunes as a genre fallback when Deezer's
 * album has none.
 */

const UA = { "user-agent": "FlowCrate/1.0 (dj discovery)", accept: "application/json" };

export type Popularity = {
  key: string;
  /** Deezer popularity rank, 0–1,000,000. Null when nothing matched. */
  rank: number | null;
  /** Fans of the release's artist on Deezer, a slower-moving popularity proxy. */
  fans: number | null;
  genres: string[];
  /** Best-matching Deezer track URL, handy for eyeballing a bad match. */
  url: string | null;
};

const EMPTY = (key: string): Popularity => ({ key, rank: null, fans: null, genres: [], url: null });

async function json(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: UA, redirect: "follow" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Loose check that a Deezer hit is actually the track we asked for. */
function matches(hit: any, artist: string, title: string): boolean {
  const a = norm(String(hit?.artist?.name ?? ""));
  const t = norm(String(hit?.title ?? ""));
  const qa = norm(artist);
  const qt = norm(title);
  if (!t || !qt) return false;
  const titleOk = t === qt || t.startsWith(qt) || qt.startsWith(t);
  const artistOk = !qa || a === qa || a.includes(qa) || qa.includes(a);
  return titleOk && artistOk;
}

async function itunesGenre(artist: string, title: string): Promise<string[]> {
  const q = encodeURIComponent(`${artist} ${title}`.trim());
  const data = await json(`https://itunes.apple.com/search?media=music&limit=3&term=${q}`);
  const hit = (data?.results ?? []).find(
    (r: any) => norm(String(r?.trackName ?? "")) === norm(title),
  );
  const genre = hit?.primaryGenreName ?? data?.results?.[0]?.primaryGenreName;
  return typeof genre === "string" && genre ? [genre] : [];
}

async function lookupOne(artist: string, title: string, key: string): Promise<Popularity> {
  const q = encodeURIComponent(`artist:"${artist}" track:"${title}"`);
  let search = await json(`https://api.deezer.com/search?limit=5&q=${q}`);
  if (!search?.data?.length) {
    search = await json(
      `https://api.deezer.com/search?limit=5&q=${encodeURIComponent(`${artist} ${title}`)}`,
    );
  }
  const hits: any[] = search?.data ?? [];
  const hit = hits.find((h) => matches(h, artist, title));
  if (!hit) {
    const genres = await itunesGenre(artist, title);
    return { ...EMPTY(key), genres };
  }

  const out: Popularity = {
    key,
    rank: typeof hit.rank === "number" ? hit.rank : null,
    fans: null,
    genres: [],
    url: typeof hit.link === "string" ? hit.link : null,
  };

  const albumId = hit?.album?.id;
  if (albumId) {
    const album = await json(`https://api.deezer.com/album/${albumId}`);
    const names = (album?.genres?.data ?? [])
      .map((g: any) => String(g?.name ?? "").trim())
      .filter(Boolean);
    out.genres = [...new Set(names as string[])];
    if (typeof album?.fans === "number") out.fans = album.fans;
  }
  if (!out.genres.length) out.genres = await itunesGenre(artist, title);
  return out;
}

/** Resolve popularity for a small batch of rows, a few requests at a time. */
export async function popularityBatch(
  items: { key: string; artist: string; title: string }[],
): Promise<Popularity[]> {
  const out: Popularity[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const slice = items.slice(i, i + CONCURRENCY);
    const done = await Promise.all(
      slice.map((item) =>
        lookupOne(item.artist, item.title, item.key).catch(() => EMPTY(item.key)),
      ),
    );
    out.push(...done);
  }
  return out;
}
