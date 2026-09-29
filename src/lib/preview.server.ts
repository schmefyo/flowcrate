export type PreviewResult = {
  previewUrl: string | null;
  artworkUrl: string | null;
  deezerUrl: string | null;
  matchedArtist: string | null;
  matchedTitle: string | null;
};

const EMPTY: PreviewResult = {
  previewUrl: null,
  artworkUrl: null,
  deezerUrl: null,
  matchedArtist: null,
  matchedTitle: null,
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Find a 30s preview clip for an artist + title using Deezer's public search. */
export async function findPreview(artist: string, title: string): Promise<PreviewResult> {
  const query = `${artist} ${title}`.trim();
  if (!query) return EMPTY;

  let json: any;
  try {
    const res = await fetch(
      `https://api.deezer.com/search?limit=8&q=${encodeURIComponent(query)}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return EMPTY;
    json = await res.json();
  } catch {
    return EMPTY;
  }

  const hits: any[] = Array.isArray(json?.data) ? json.data : [];
  if (!hits.length) return EMPTY;

  const wantArtist = normalize(artist);
  const wantTitle = normalize(title);
  const scored = hits
    .filter((h) => typeof h?.preview === "string" && h.preview)
    .map((h) => {
      const a = normalize(String(h?.artist?.name ?? ""));
      const t = normalize(String(h?.title ?? ""));
      let score = 0;
      if (a && (a === wantArtist || a.includes(wantArtist) || wantArtist.includes(a))) score += 2;
      if (t && (t === wantTitle || t.includes(wantTitle) || wantTitle.includes(t))) score += 2;
      return { h, score };
    })
    .sort((x, y) => y.score - x.score);

  const best = scored[0];
  if (!best || best.score < 2) return EMPTY;
  const h = best.h;

  return {
    previewUrl: String(h.preview),
    artworkUrl: (h?.album?.cover_medium as string) ?? null,
    deezerUrl: (h?.link as string) ?? null,
    matchedArtist: (h?.artist?.name as string) ?? null,
    matchedTitle: (h?.title as string) ?? null,
  };
}

export type YouTubeHit = { videoId: string; videoTitle: string } | null;
const MIXESDB_TIMEOUT_MS = 8_000;

/**
 * MixesDB resolves track links through its own YouTube Data API proxy
 * (api.php?action=youtube_search), which returns real, ranked results —
 * unlike scraping youtube.com/results from a server IP. We reuse it.
 */
export async function findYouTube(artist: string, title: string): Promise<YouTubeHit> {
  const q = `${artist} - ${title}`.trim();
  if (!q) return null;
  let json: any;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(
        `https://www.mixesdb.com/w/api.php?action=youtube_search&format=json&q=${encodeURIComponent(q)}`,
        {
          headers: { accept: "application/json", "user-agent": "FlowCrate/1.0 (dj discovery)" },
          signal: AbortSignal.timeout(MIXESDB_TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`MixesDB returned ${res.status}`);
      json = await res.json();
      break;
    } catch {
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!json) return null;

  const items: any[] = json?.youtube_search?.items ?? [];
  const wantArtist = normalize(artist);
  const wantTitle = normalize(title);

  const scored = items
    .filter((i) => typeof i?.id?.videoId === "string")
    .map((i) => {
      const vt = normalize(String(i?.snippet?.title ?? ""));
      let score = 0;
      if (wantTitle && vt.includes(wantTitle)) score += 2;
      if (wantArtist && vt.includes(wantArtist)) score += 2;
      return { videoId: String(i.id.videoId), videoTitle: String(i?.snippet?.title ?? ""), score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 2) return null;
  return { videoId: best.videoId, videoTitle: best.videoTitle };
}
