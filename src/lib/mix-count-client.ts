/** Client-side contract for the batched MixesDB total-count server function. */
export type MixCountTrack = {
  id: string;
  artist: string;
  title: string;
};

export type MixCountStatus = "pending" | "ok" | "failed" | undefined;

/** Avoid rescheduling counts that are already resolved or still in flight. */
export function shouldRequestMixCount(status: MixCountStatus, retryFailed = false): boolean {
  return status !== "pending" && status !== "ok" && (status !== "failed" || retryFailed);
}

export function mixCountRequest(tracks: MixCountTrack[]) {
  return {
    items: tracks.map((track) => ({
      key: track.id,
      artist: track.artist,
      title: track.title,
    })),
  };
}

/** Keep an unresolved or failed lookup visibly different from a real zero. */
export function mixCountSuffix(total: number | undefined): string | null {
  return typeof total === "number" ? `(${total})` : null;
}
