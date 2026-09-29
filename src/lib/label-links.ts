/** Outbound links for a label / collective / party. */
export type LabelLink = { key: string; label: string; url: string };

const enc = encodeURIComponent;

/**
 * Only links that lead to a real destination: the label's own website, any
 * verified pages we resolved and stored, plus the Spotify label search
 * (which returns actual tracks rather than an empty results page).
 */
export function labelLinks(
  name: string,
  website?: string | null,
  stored?: unknown,
): LabelLink[] {
  const n = name.trim();
  const links: LabelLink[] = [];

  if (website) {
    const url = /^https?:\/\//i.test(website) ? website : `https://${website}`;
    links.push({ key: "website", label: "Website", url });
  }

  if (Array.isArray(stored)) {
    for (const item of stored) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as LabelLink).url === "string" &&
        typeof (item as LabelLink).label === "string"
      ) {
        const l = item as LabelLink;
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
      url: `https://open.spotify.com/search/${enc(`label:"${n}"`)}/tracks`,
    });
  }

  return links;
}
