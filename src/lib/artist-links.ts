/** Outbound links for a DJ / artist. */
export type ArtistLink = { key: string; label: string; url: string };

const enc = encodeURIComponent;

/**
 * Real destinations only: the MixesDB category page, anything we verified and
 * stored from MusicBrainz, plus the Spotify artist search (which returns
 * actual artists rather than an empty page).
 */
export function artistLinks(name: string, mixesdbUrl?: string | null, stored?: unknown): ArtistLink[] {
  const n = name.trim();
  const links: ArtistLink[] = [];

  if (mixesdbUrl) links.push({ key: "mixesdb", label: "MixesDB", url: mixesdbUrl });

  if (Array.isArray(stored)) {
    for (const item of stored) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as ArtistLink).url === "string" &&
        typeof (item as ArtistLink).label === "string"
      ) {
        const l = item as ArtistLink;
        if (!links.some((x) => x.url === l.url)) {
          links.push({ key: l.key ?? l.url, label: l.label, url: l.url });
        }
      }
    }
  }

  if (n) {
    links.push({
      key: "spotify",
      label: "Spotify",
      // Plain path search: the mobile app mangles the /artists suffix the same
      // way it mangles /tracks (it searches for the literal word).
      url: `https://open.spotify.com/search/${enc(n)}`,
    });
  }

  return links;
}
