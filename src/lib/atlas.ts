import type { Database } from "@/integrations/supabase/types";

export type LabelRow = Database["public"]["Tables"]["labels"]["Row"];
export type TrackRow = Database["public"]["Tables"]["tracks"]["Row"];
export type CrateRow = Database["public"]["Tables"]["crates"]["Row"];
export type CrateTrackRow = Database["public"]["Tables"]["crate_tracks"]["Row"];

export type TrackWithLabel = TrackRow & { labels: Pick<LabelRow, "id" | "name"> | null };

export const MOODS = [
  "hypnotic",
  "euphoric",
  "dark",
  "sweaty",
  "tender",
  "peak-time",
  "opener",
  "closer",
  "weird",
] as const;

export const KEYS = [
  "1A",
  "2A",
  "3A",
  "4A",
  "5A",
  "6A",
  "7A",
  "8A",
  "9A",
  "10A",
  "11A",
  "12A",
  "1B",
  "2B",
  "3B",
  "4B",
  "5B",
  "6B",
  "7B",
  "8B",
  "9B",
  "10B",
  "11B",
  "12B",
] as const;

export const SOURCES = [
  { value: "spotify", label: "Spotify" },
  { value: "soundcloud", label: "SoundCloud" },
  { value: "beatport", label: "Beatport" },
  { value: "bandcamp", label: "Bandcamp" },
  { value: "youtube", label: "YouTube" },
  { value: "discogs", label: "Discogs" },
  { value: "radio", label: "Radio / mix" },
  { value: "dancefloor", label: "Heard on a dancefloor" },
  { value: "friend", label: "Friend / recommendation" },
  { value: "other", label: "Other" },
] as const;

export function sourceFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes("spotify")) return "spotify";
  if (u.includes("soundcloud")) return "soundcloud";
  if (u.includes("beatport")) return "beatport";
  if (u.includes("bandcamp")) return "bandcamp";
  if (u.includes("youtube") || u.includes("youtu.be")) return "youtube";
  if (u.includes("discogs")) return "discogs";
  return null;
}

export function sourceLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return SOURCES.find((s) => s.value === value)?.label ?? value;
}

export function ratingStars(rating: number | null) {
  if (!rating) return "—";
  return "★".repeat(rating) + "☆".repeat(Math.max(0, 5 - rating));
}
