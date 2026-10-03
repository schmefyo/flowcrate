import { findMixesForTrack as search } from "./mixesdb-track-search";
export type { MixHit } from "./mixesdb-track-search";

/** Server-first lookup; the UI can use the public CORS API if this host is rejected. */
export async function findMixesForTrack(artist: string, title: string) {
  return search(artist, title, { server: true });
}
