/** Helpers for spotting the same artist written slightly differently ("D. Tiffany" vs "D.Tiffany"). */

export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

export type NameGroup<T> = { key: string; primary: T; others: T[] };

/** Group items whose names collapse to the same normalized form. */
export function groupByName<T>(items: T[], getName: (item: T) => string): NameGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = normalizeArtistName(getName(item));
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()].map(([key, list]) => ({
    key,
    // Prefer the longest spelling as the display name (usually the punctuated one).
    primary: [...list].sort((a, b) => getName(b).length - getName(a).length)[0]!,
    others: [...list].sort((a, b) => getName(b).length - getName(a).length).slice(1),
  }));
}

export type AliasRow = { name: string; aliases?: string[] | null };

/** Every MixesDB spelling to scan for a followed artist. */
export function allNamesFor(row: AliasRow): string[] {
  return [...new Set([row.name, ...(row.aliases ?? [])].map((n) => n.trim()).filter(Boolean))];
}

/** Map any spelling (normalized) back to the followed artist's primary name. */
export function canonicalNameMap(rows: AliasRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    for (const name of allNamesFor(row)) map.set(normalizeArtistName(name), row.name);
  }
  return map;
}

export function canonicalName(map: Map<string, string>, name: string): string {
  return map.get(normalizeArtistName(name)) ?? name;
}
