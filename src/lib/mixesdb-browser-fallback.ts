import { findMixesForTrack } from "./mixesdb-track-search";
import type { MixCount } from "./mix-count.server";

type SearchRequest = { data: { artist: string; title: string } };
type SearchResult = Awaited<ReturnType<typeof findMixesForTrack>>;
type CountItem = { key: string; artist: string; title: string };
type CountRequest = { data: { items: CountItem[] } };

/** Public, unauthenticated CORS fallback; never sends Flowcrate credentials. */
export async function lookupMixesWithFallback(
  request: SearchRequest,
  lookup: (request: SearchRequest) => Promise<SearchResult>,
): Promise<SearchResult> {
  try {
    return await lookup(request);
  } catch {
    return findMixesForTrack(request.data.artist, request.data.title);
  }
}

/** Retry only unresolved counts, with the existing four-request concurrency bound. */
export async function lookupMixCountsWithFallback(
  request: CountRequest,
  lookup: (request: CountRequest) => Promise<MixCount[]>,
): Promise<MixCount[]> {
  let results: MixCount[];
  try {
    results = await lookup(request);
  } catch {
    results = [];
  }
  const successful = new Map(
    results.filter((result) => result.ok).map((result) => [result.key, result]),
  );
  const output: MixCount[] = new Array(request.data.items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, output.length) }, async () => {
      while (cursor < output.length) {
        const index = cursor++;
        const item = request.data.items[index]!;
        const known = successful.get(item.key);
        if (known) {
          output[index] = known;
          continue;
        }
        try {
          const { total } = await findMixesForTrack(item.artist, item.title, { limit: 1 });
          output[index] = { key: item.key, total, ok: true };
        } catch {
          output[index] = { key: item.key, total: null, ok: false };
        }
      }
    }),
  );
  return output;
}
