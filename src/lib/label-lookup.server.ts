/** Resolve real external pages for a label via the MusicBrainz label relations. */
export type ResolvedLink = { key: string; label: string; url: string };

const UA = "FlowCrate/1.0";

const HOSTS: { match: RegExp; key: string; label: string }[] = [
  { match: /discogs\.com/i, key: "discogs", label: "Discogs" },
  { match: /bandcamp\.com/i, key: "bandcamp", label: "Bandcamp" },
  { match: /soundcloud\.com/i, key: "soundcloud", label: "SoundCloud" },
  { match: /(residentadvisor\.net|ra\.co)/i, key: "ra", label: "RA" },
  { match: /beatport\.com/i, key: "beatport", label: "Beatport" },
  { match: /youtube\.com|youtu\.be/i, key: "youtube", label: "YouTube" },
  { match: /instagram\.com/i, key: "instagram", label: "Instagram" },
  { match: /facebook\.com/i, key: "facebook", label: "Facebook" },
  { match: /open\.spotify\.com/i, key: "spotify-page", label: "Spotify" },
  { match: /wikipedia\.org/i, key: "wikipedia", label: "Wikipedia" },
  { match: /rateyourmusic\.com/i, key: "rym", label: "RYM" },
];

async function mb<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function resolveLabelLinks(
  name: string,
): Promise<{ links: ResolvedLink[]; website: string | null }> {
  const query = name.trim();
  if (!query) return { links: [], website: null };

  const search = await mb<{ labels?: { id: string; name: string; score?: number }[] }>(
    `label?query=${encodeURIComponent(query)}&limit=5&fmt=json`,
  );
  const candidate = (search?.labels ?? []).find(
    (l) => l.name.toLowerCase() === query.toLowerCase() || (l.score ?? 0) >= 90,
  );
  if (!candidate) return { links: [], website: null };

  const detail = await mb<{ relations?: { type: string; url?: { resource?: string } }[] }>(
    `label/${candidate.id}?inc=url-rels&fmt=json`,
  );

  const seen = new Set<string>();
  const links: ResolvedLink[] = [];
  let website: string | null = null;

  for (const rel of detail?.relations ?? []) {
    const url = rel.url?.resource;
    if (!url) continue;
    if ((rel.type === "official homepage" || rel.type === "official site") && !website) {
      website = url;
      continue;
    }
    const host = HOSTS.find((h) => h.match.test(url));
    if (!host || seen.has(host.key)) continue;
    seen.add(host.key);
    links.push({ key: host.key, label: host.label, url });
  }

  links.push({
    key: "musicbrainz",
    label: "MusicBrainz",
    url: `https://musicbrainz.org/label/${candidate.id}`,
  });

  return { links, website };
}
