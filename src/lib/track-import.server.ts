import {
  enrichFromDeezer,
  enrichFromMusicBrainz,
} from "./track-enrich.server";

export type ImportedTrack = {
  title: string;
  artist: string;
  url: string;
  source: string;
  bpm: number | null;
  musicalKey: string | null;
  genre: string | null;
  mixName: string | null;
  artworkUrl: string | null;
  previewUrl: string | null;
  durationMs: number | null;
  releaseYear: number | null;
  labelName: string | null;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function empty(url: string, source: string): ImportedTrack {
  return {
    title: "",
    artist: "",
    url,
    source,
    bpm: null,
    musicalKey: null,
    genre: null,
    mixName: null,
    artworkUrl: null,
    previewUrl: null,
    durationMs: null,
    releaseYear: null,
    labelName: null,
  };
}

function detectSource(host: string): string {
  if (host.includes("spotify")) return "spotify";
  if (host.includes("soundcloud")) return "soundcloud";
  if (host.includes("beatport")) return "beatport";
  if (host.includes("youtube") || host.includes("youtu.be")) return "youtube";
  if (host.includes("bandcamp")) return "bandcamp";
  return "web";
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function meta(html: string, key: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decode(m[1]);
  }
  return null;
}

/** Split "Artist - Title", "Artist – Title" or "Title by Artist" into parts. */
function splitArtistTitle(raw: string): { artist: string; title: string } | null {
  const by = raw.match(/^(.+?)\s+by\s+(.+)$/i);
  if (by?.[1] && by[2]) return { artist: by[2].trim(), title: by[1].trim() };
  const m = raw.split(/\s+[-–—|]\s+/);
  if (m.length >= 2 && m[0] && m[1]) {
    return { artist: m[0].trim(), title: m.slice(1).join(" - ").trim() };
  }
  return null;
}

function cleanTitle(t: string): string {
  return t
    .replace(/\s*\|\s*Music\s*&\s*Downloads on Beatport\s*$/i, "")
    .replace(/\s*\|\s*(Spotify|Beatport|SoundCloud|YouTube).*$/i, "")
    .replace(/\s*[-–]\s*(song and lyrics by.*|YouTube)$/i, "")
    .replace(/\s*\(Official (Music )?Video\)\s*/i, "")
    .replace(/\s*\[Official (Music )?Video\]\s*/i, "")
    .trim();
}

function bpmFrom(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d{2,3})\s*(?:bpm|BPM)/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return n >= 60 && n <= 220 ? n : null;
}

function yearFrom(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(19|20)\d{2}/);
  if (!m?.[0]) return null;
  const n = Number(m[0]);
  return n >= 1900 && n <= 2100 ? n : null;
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 900_000);
  } catch {
    return null;
  }
}

/** Pull the Next.js data blob a lot of music sites embed. */
function nextData(html: string): Record<string, any> | null {
  const m = html.match(
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]) as Record<string, any>;
  } catch {
    return null;
  }
}

function camelot(key: unknown): string | null {
  const k = key as { camelot_number?: number; camelot_letter?: string } | null;
  if (!k?.camelot_number || !k.camelot_letter) return null;
  return `${k.camelot_number}${k.camelot_letter.toUpperCase()}`;
}

/** Beatport blocks direct page fetches from servers, so use the public embed API. */
const BEATPORT_EMBED_CLIENT_ID = "2tiTbKxmQFwnbFjMONU4k7njMRZmV3ZMwRBndiZs";
const BEATPORT_EMBED_CLIENT_SECRET =
  "RDUJyAk4zFEGtQ8rsTmylDSfxmALRNBn3D1BsRr7MKi3oa1TL9Mq9QxqUPK7loiumXolEWbJcWa4IGAhtwnTz1cSXClGJ1tkkNCNWwRwjxIKTZJKOJxbwaNt0Rm3WG0v";

async function beatportToken(): Promise<string | null> {
  try {
    const res = await fetch("https://account.beatport.com/o/token/", {
      method: "POST",
      body: new URLSearchParams({
        client_id: BEATPORT_EMBED_CLIENT_ID,
        client_secret: BEATPORT_EMBED_CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

async function fromBeatport(parsed: URL, out: ImportedTrack): Promise<void> {
  const id = parsed.pathname.match(/\/track\/[^/]+\/(\d+)/)?.[1];
  if (!id) throw new Error("That Beatport link doesn't point at a track");
  const token = await beatportToken();
  if (!token) throw new Error("Beatport wouldn't answer — try again in a moment");
  let track: Record<string, any> | null = null;
  try {
    const res = await fetch(`https://api.beatport.com/v4/catalog/tracks/${id}/`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (res.ok) track = (await res.json()) as Record<string, any>;
  } catch {
    track = null;
  }
  if (!track?.["name"]) return;

  out.title = String(track["name"]);
  const artists = Array.isArray(track["artists"]) ? track["artists"] : [];
  const remixers = Array.isArray(track["remixers"]) ? track["remixers"] : [];
  out.artist = artists.map((a: any) => String(a?.name ?? "")).filter(Boolean).join(", ");
  if (!out.artist) {
    out.artist = remixers.map((a: any) => String(a?.name ?? "")).filter(Boolean).join(", ");
  }
  out.bpm = typeof track["bpm"] === "number" ? track["bpm"] : null;
  out.musicalKey = camelot(track["key"]);
  out.genre = track["genre"]?.name ? String(track["genre"].name) : null;
  out.mixName = track["mix_name"] ? String(track["mix_name"]) : null;
  out.durationMs = typeof track["length_ms"] === "number" ? track["length_ms"] : null;
  out.releaseYear = yearFrom(String(track["publish_date"] ?? track["new_release_date"] ?? ""));
  out.previewUrl = track["sample_url"] ? String(track["sample_url"]) : null;
  const release = track["release"] as Record<string, any> | undefined;
  out.labelName = release?.["label"]?.name ? String(release["label"].name) : null;
  const img = release?.["image"]?.dynamic_uri ?? release?.["image"]?.uri;
  if (img) out.artworkUrl = String(img).replace("{w}", "500").replace("{h}", "500");
}

async function fromSpotify(parsed: URL, out: ImportedTrack): Promise<void> {
  const id = parsed.pathname.match(/\/track\/([A-Za-z0-9]+)/)?.[1];
  if (id) {
    const html = await fetchHtml(`https://open.spotify.com/embed/track/${id}`);
    const data = html ? nextData(html) : null;
    const e = data?.["props"]?.["pageProps"]?.["state"]?.["data"]?.["entity"];
    if (e && typeof e === "object") {
      const ent = e as Record<string, any>;
      out.title = String(ent["name"] ?? ent["title"] ?? "");
      const artists = Array.isArray(ent["artists"]) ? ent["artists"] : [];
      out.artist = artists.map((a: any) => String(a?.name ?? "")).filter(Boolean).join(", ");
      out.durationMs = typeof ent["duration"] === "number" ? ent["duration"] : null;
      out.releaseYear = yearFrom(ent["releaseDate"]?.isoString);
      out.previewUrl = ent["audioPreview"]?.url ? String(ent["audioPreview"].url) : null;
      const images = ent["visualIdentity"]?.image;
      if (Array.isArray(images) && images.length) {
        const best = [...images].sort(
          (a: any, b: any) => (b?.maxWidth ?? 0) - (a?.maxWidth ?? 0),
        )[0];
        if (best?.url) out.artworkUrl = String(best.url);
      }
    }
  }
  if (out.title && out.artist) return;
  const data = await fetchJson(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(out.url)}`,
  );
  const oTitle = typeof data?.["title"] === "string" ? decode(data["title"] as string) : "";
  if (oTitle && !out.title) {
    const split = splitArtistTitle(oTitle);
    out.title = split ? split.title : oTitle;
    if (split && !out.artist) out.artist = split.artist;
  }
  if (!out.artworkUrl && typeof data?.["thumbnail_url"] === "string") {
    out.artworkUrl = data["thumbnail_url"] as string;
  }
}

async function fromSoundcloud(url: string, out: ImportedTrack): Promise<void> {
  const data = await fetchJson(
    `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  );
  const oTitle = typeof data?.["title"] === "string" ? decode(data["title"] as string) : "";
  const author = typeof data?.["author_name"] === "string" ? decode(data["author_name"] as string) : "";
  if (oTitle) {
    const split = splitArtistTitle(oTitle);
    out.title = split ? split.title : oTitle;
    out.artist = split ? split.artist : author;
  }
  if (typeof data?.["thumbnail_url"] === "string") out.artworkUrl = data["thumbnail_url"] as string;

  const html = await fetchHtml(url);
  if (!html) return;
  const blob = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);/)?.[1];
  if (blob) {
    try {
      const arr = JSON.parse(blob) as Array<{ hydratable?: string; data?: Record<string, any> }>;
      const sound = arr.find((x) => x.hydratable === "sound")?.data;
      if (sound) {
        if (!out.title) out.title = String(sound["title"] ?? "");
        if (!out.artist) out.artist = String(sound["user"]?.username ?? "");
        if (typeof sound["duration"] === "number") out.durationMs = sound["duration"];
        if (sound["genre"]) out.genre = String(sound["genre"]);
        out.releaseYear = yearFrom(String(sound["display_date"] ?? sound["created_at"] ?? ""));
        if (sound["artwork_url"]) {
          out.artworkUrl = String(sound["artwork_url"]).replace("-large", "-t500x500");
        }
        if (sound["label_name"]) out.labelName = String(sound["label_name"]);
        if (typeof sound["bpm"] === "number") out.bpm = sound["bpm"];
        if (!out.bpm) out.bpm = bpmFrom(String(sound["description"] ?? ""));
      }
    } catch {
      /* ignore malformed hydration blob */
    }
  }
  if (!out.artworkUrl) out.artworkUrl = meta(html, "og:image");
}

async function fromYoutube(url: string, out: ImportedTrack): Promise<void> {
  const data = await fetchJson(
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
  );
  const oTitle = typeof data?.["title"] === "string" ? decode(data["title"] as string) : "";
  const author = typeof data?.["author_name"] === "string" ? decode(data["author_name"] as string) : "";
  if (oTitle) {
    const split = splitArtistTitle(cleanTitle(oTitle));
    out.title = cleanTitle(split ? split.title : oTitle);
    out.artist = split ? split.artist : author;
  }
  if (typeof data?.["thumbnail_url"] === "string") out.artworkUrl = data["thumbnail_url"] as string;
  out.bpm = bpmFrom(oTitle);

  const html = await fetchHtml(url);
  if (!html) return;
  const secs = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/)?.[1];
  if (secs) out.durationMs = Number(secs) * 1000;
  const published = html.match(/"publishDate"\s*:\s*"([^"]+)"/)?.[1];
  out.releaseYear = yearFrom(published);
  if (!out.bpm) out.bpm = bpmFrom(meta(html, "og:description"));
  const music = html.match(/"Music"[\s\S]{0,400}?"simpleText"\s*:\s*"([^"]+)"/)?.[1];
  if (music && !out.artist) out.artist = decode(music);
}

async function fromGeneric(url: string, out: ImportedTrack): Promise<void> {
  const html = await fetchHtml(url);
  if (!html) return;
  const ogTitle = meta(html, "og:title") ?? meta(html, "twitter:title");
  const ogDesc = meta(html, "og:description") ?? meta(html, "description");
  if (ogTitle) {
    const split = splitArtistTitle(cleanTitle(ogTitle));
    out.title = cleanTitle(split ? split.title : ogTitle);
    if (split) out.artist = split.artist;
  }
  if (!out.artist && ogDesc) {
    const by = ogDesc.match(/by\s+([^,|·]+)/i);
    if (by?.[1]) out.artist = by[1].trim();
  }
  out.artworkUrl = meta(html, "og:image");
  out.bpm = bpmFrom(ogDesc) ?? bpmFrom(ogTitle);
  out.releaseYear = yearFrom(meta(html, "music:release_date") ?? meta(html, "og:release_date"));
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Look the track up on Beatport by artist + title to fill BPM, key, genre, label. */
async function enrichFromBeatport(out: ImportedTrack): Promise<void> {
  if (!out.title || !out.artist) return;
  const token = await beatportToken();
  if (!token) return;
  let results: any[] = [];
  try {
    const res = await fetch(
      `https://api.beatport.com/v4/catalog/search/?type=tracks&per_page=20&q=${encodeURIComponent(
        `${out.artist} ${out.title}`,
      )}`,
      { headers: { authorization: `Bearer ${token}`, accept: "application/json" } },
    );
    if (!res.ok) return;
    const json = (await res.json()) as Record<string, any>;
    results = Array.isArray(json["tracks"]) ? json["tracks"] : [];
  } catch {
    return;
  }
  if (!results.length) return;

  const wantTitle = norm(out.title);
  const wantArtist = norm(out.artist);
  const scored = results
    .map((t) => {
      const name = norm(String(t?.name ?? ""));
      const artists = (Array.isArray(t?.artists) ? t.artists : [])
        .map((a: any) => norm(String(a?.name ?? "")))
        .join(" ");
      let score = 0;
      if (name === wantTitle) score += 3;
      else if (name.includes(wantTitle) || wantTitle.includes(name)) score += 1;
      if (artists.includes(wantArtist) || wantArtist.includes(artists)) score += 3;
      if (typeof t?.bpm === "number" && t.bpm >= 90) score += 0.5;
      return { t, score };
    })
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score);

  const match = scored[0]?.t;
  if (!match) return;

  if (!out.bpm && typeof match["bpm"] === "number") out.bpm = match["bpm"];
  if (!out.musicalKey) out.musicalKey = camelot(match["key"]);
  if (!out.genre && match["genre"]?.name) out.genre = String(match["genre"].name);
  if (!out.mixName && match["mix_name"]) out.mixName = String(match["mix_name"]);
  if (!out.releaseYear) {
    out.releaseYear = yearFrom(String(match["publish_date"] ?? match["new_release_date"] ?? ""));
  }
  const release = match["release"] as Record<string, any> | undefined;
  if (!out.labelName && release?.["label"]?.name) out.labelName = String(release["label"].name);
  if (!out.artworkUrl) {
    const img = release?.["image"]?.dynamic_uri ?? release?.["image"]?.uri;
    if (img) out.artworkUrl = String(img).replace("{w}", "500").replace("{h}", "500");
  }
}

export async function importTrackFromUrl(rawUrl: string): Promise<ImportedTrack> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("That doesn't look like a valid link");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only http(s) links are supported");
  }

  const source = detectSource(parsed.hostname.toLowerCase());
  const out = empty(parsed.toString(), source);

  if (source === "beatport") await fromBeatport(parsed, out);
  else if (source === "spotify") await fromSpotify(parsed, out);
  else if (source === "soundcloud") await fromSoundcloud(out.url, out);
  else if (source === "youtube") await fromYoutube(out.url, out);
  else await fromGeneric(out.url, out);

  if (!out.title && source !== "beatport") await fromGeneric(out.url, out);

  out.title = cleanTitle(out.title);
  out.artist = out.artist.trim();
  if (!out.title) throw new Error("Couldn't read track info from that link — add it manually");

  if (source !== "beatport" && (!out.bpm || !out.musicalKey || !out.genre || !out.labelName)) {
    await enrichFromBeatport(out);
  }

  // Still thin? Widen the net with Deezer (bpm/label/genre) and MusicBrainz (label/year).
  if (!out.bpm || !out.genre || !out.labelName || !out.releaseYear) {
    await enrichFromDeezer(out);
  }
  if (!out.labelName || !out.releaseYear || !out.genre) {
    await enrichFromMusicBrainz(out);
  }
  return out;
}



/** Enrich a track we only know by artist + title (e.g. added from a MixesDB tracklist). */
export async function enrichTrackByName(
  artist: string,
  title: string,
): Promise<ImportedTrack> {
  const out = empty("", "");
  out.title = cleanTitle(title.trim());
  out.artist = artist.trim();
  if (!out.title || !out.artist) throw new Error("Need both an artist and a title");

  await enrichFromBeatport(out);
  if (!out.bpm || !out.genre || !out.labelName || !out.releaseYear || !out.previewUrl) {
    await enrichFromDeezer(out);
  }
  if (!out.labelName || !out.releaseYear || !out.genre) {
    await enrichFromMusicBrainz(out);
  }
  return out;
}
