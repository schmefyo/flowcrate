/**
 * Ranking helpers for the Discover feed.
 *
 * Raw play counts only measure how many of the DJs you picked played a track.
 * These helpers add the other two dials: how deep a cut it is inside your scan,
 * and how big it is out in the wider world (Deezer popularity).
 */

export type RankRow = {
  key: string;
  plays: number;
  djs: string[];
  slots: { opener: number; peak: number; closer: number };
};

/** A track counts as a deep cut when barely anyone in your scan played it. */
export const DEEP_MAX_PLAYS = 2;

export type Slot = "any" | "opener" | "peak" | "closer";

export function slotCount(row: RankRow, slot: Slot): number {
  if (slot === "any") return 0;
  return row.slots?.[slot] ?? 0;
}

/** Deezer rank runs 0–1,000,000; fans of the release nudge ties apart. */
export function popularityScore(pop?: { rank: number | null; fans: number | null } | null): number {
  if (!pop) return -1;
  const rank = pop.rank ?? 0;
  const fans = pop.fans ?? 0;
  if (!rank && !fans) return -1;
  return rank + Math.log1p(fans) * 1000;
}

export type PopularityTier = "popular" | "mid" | "obscure";

export function popularityTier(score: number): PopularityTier | null {
  if (score < 0) return null;
  if (score >= 400000) return "popular";
  if (score >= 100000) return "mid";
  return "obscure";
}
