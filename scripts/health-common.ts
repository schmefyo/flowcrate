import { eventDateForSet } from "../src/lib/set-date.ts";

export const REPRESENTATIVE_ARTISTS = [
  "Ben UFO",
  "D. Tiffany",
  "D.Tiffany",
  "Aurora Halal",
  "Or:la",
  "Ne/Re/A",
  "Powder",
] as const;

export type SetHealth = {
  sets: number;
  newestDate: string | null;
  tracklistedSets: number;
  tracks: number;
};

type PayloadSet = {
  title: string;
  date: string | null;
  tracks: unknown[];
};

function isPayloadSet(value: unknown): value is PayloadSet {
  if (!value || typeof value !== "object") return false;
  const set = value as Record<string, unknown>;
  return (
    typeof set["title"] === "string" &&
    (typeof set["date"] === "string" || set["date"] === null) &&
    Array.isArray(set["tracks"])
  );
}

export function summarizeSets(sets: PayloadSet[]): SetHealth {
  const dates = sets
    .map((set) => eventDateForSet(set))
    .filter((date): date is string => typeof date === "string")
    .sort((a, b) => b.localeCompare(a));
  const tracklistedSets = sets.filter((set) => set.tracks.length > 0).length;
  return {
    sets: sets.length,
    newestDate: dates[0] ?? null,
    tracklistedSets,
    tracks: sets.reduce((total, set) => total + set.tracks.length, 0),
  };
}

export function summarizeCachePayload(payload: unknown): SetHealth | null {
  if (!Array.isArray(payload) || !payload.every(isPayloadSet)) return null;
  return summarizeSets(payload);
}

export function printRows(rows: Record<string, unknown>[]): void {
  console.table(rows);
}
