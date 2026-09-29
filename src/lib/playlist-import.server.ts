const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type PlaylistTrack = {
  title: string;
  artist: string;
  url: string;
  source: string;
  durationMs: number | null;
  previewUrl: string | null;
  artworkUrl: string | null;
};

export type ImportedPlaylist = {
  name: string;
  source: string;
  tracks: PlaylistTrack[];
};

function parseSpotifyRef(raw: string): { kind: "playlist" | "album"; id: string } | null {
  const m = raw.match(/(playlist|album)[/:]([A-Za-z0-9]{10,})/);
  if (!m) return null;
  return { kind: m[1] as "playlist" | "album", id: m[2]! };
}

function findJson(html: string): unknown {
  const m =
    html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/) ??
    html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]!);
  } catch {
    return null;
  }
}

type AnyRec = Record<string, unknown>;

function deepFind(node: unknown, key: string): unknown {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFind(item, key);
      if (found) return found;
    }
    return null;
  }
  const rec = node as AnyRec;
  if (key in rec && rec[key]) return rec[key];
  for (const value of Object.values(rec)) {
    const found = deepFind(value, key);
    if (found) return found;
  }
  return null;
}

function coverFrom(entity: unknown): string | null {
  const art = deepFind(entity, "coverArt");
  const sources = art && typeof art === "object" ? (art as AnyRec)["sources"] : null;
  if (Array.isArray(sources) && sources.length) {
    const url = (sources[sources.length - 1] as AnyRec)["url"];
    if (typeof url === "string") return url;
  }
  return null;
}

export async function importPlaylistFromUrl(rawUrl: string): Promise<ImportedPlaylist> {
  const ref = parseSpotifyRef(rawUrl);
  if (!ref) {
    throw new Error(
      "Paste a Spotify playlist or album link (soundcloud playlists aren't supported yet).",
    );
  }

  const res = await fetch(`https://open.spotify.com/embed/${ref.kind}/${ref.id}`, {
    headers: { "user-agent": UA, "accept-language": "en" },
  });
  if (!res.ok) throw new Error("Spotify wouldn't share that playlist — is it public?");
  const html = await res.text();
  const json = findJson(html);
  if (!json) throw new Error("Couldn't read that playlist");

  const list = deepFind(json, "trackList");
  if (!Array.isArray(list) || !list.length) {
    throw new Error("No tracks found in that playlist");
  }

  const nameNode = deepFind(json, "name");
  const name = typeof nameNode === "string" && nameNode ? nameNode : "Spotify playlist";
  const fallbackArt = coverFrom(json);

  const tracks: PlaylistTrack[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as AnyRec;
    const title = typeof rec["title"] === "string" ? rec["title"].trim() : "";
    const artist = typeof rec["subtitle"] === "string" ? rec["subtitle"].trim() : "";
    if (!title) continue;
    const uri = typeof rec["uri"] === "string" ? rec["uri"] : "";
    const id = uri.split(":").pop() ?? "";
    const url = id ? `https://open.spotify.com/track/${id}` : rawUrl;
    if (seen.has(url + title)) continue;
    seen.add(url + title);
    const duration = typeof rec["duration"] === "number" ? rec["duration"] : null;
    const preview = rec["audioPreview"];
    const previewUrl =
      preview && typeof preview === "object" && typeof (preview as AnyRec)["url"] === "string"
        ? ((preview as AnyRec)["url"] as string)
        : null;
    tracks.push({
      title,
      artist,
      url,
      source: "spotify",
      durationMs: duration,
      previewUrl,
      artworkUrl: coverFrom(rec) ?? fallbackArt,
    });
  }

  if (!tracks.length) throw new Error("No tracks found in that playlist");
  return { name, source: "spotify", tracks };
}
