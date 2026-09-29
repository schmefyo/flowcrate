/** Remembers the Discover page's artist picks and filters between visits. */

export type DiscoverPrefs = {
  picked: string[];
  sort: string;
  /** Set-position filter: "any" | "opener" | "peak" | "closer". */
  slot: string;
};

const KEY = "flowcrate.discover.prefs.v1";

export function loadDiscoverPrefs(): { [K in keyof DiscoverPrefs]?: DiscoverPrefs[K] | undefined } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DiscoverPrefs>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      picked: Array.isArray(parsed.picked)
        ? parsed.picked.filter((n) => typeof n === "string")
        : undefined,
      // "taste" was retired; "plays" merged into "djs" (Most DJ plays).
      sort:
        typeof parsed.sort !== "string" || parsed.sort === "taste"
          ? undefined
          : parsed.sort === "plays"
            ? "djs"
            : parsed.sort,

      slot: typeof parsed.slot === "string" ? parsed.slot : undefined,
    };
  } catch {
    return null;
  }
}


export function saveDiscoverPrefs(prefs: DiscoverPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable — preferences just won't persist */
  }
}
