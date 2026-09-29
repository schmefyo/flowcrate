/**
 * Total MixesDB appearances for a track.
 *
 * Discover/crate counts only say how often a track showed up inside the sets
 * we happened to scan. This asks MixesDB how many pages mention the track at
 * all, which is a decent proxy for "how many mixes is it in overall".
 */

const API = "https://www.mixesdb.com/w/api.php";
const UA = { "user-agent": "FlowCrate/1.0 (mix counts)", accept: "application/json" };

export type MixCount =
  { key: string; total: number; ok: true } | { key: string; total: null; ok: false };

const REQUEST_TIMEOUT_MS = 8_000;

const clean = (s: string) =>
  s
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function countOne(artist: string, title: string): Promise<number> {
  const query = `${clean(artist)} ${clean(title)}`.trim();
  if (!query) return 0;
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "1",
    srnamespace: "0",
    srinfo: "totalhits",
    format: "json",
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${API}?${params.toString()}`, {
        headers: UA,
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`MixesDB returned ${res.status}`);
      const json = (await res.json()) as any;
      const rawTotal = json?.query?.searchinfo?.totalhits;
      if (rawTotal === undefined) throw new Error("Invalid MixesDB count response");
      const total = Number(rawTotal);
      if (!Number.isFinite(total)) throw new Error("Invalid MixesDB count response");
      return total;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MixesDB count request failed");
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try {
          out[i] = await fn(items[i]!);
        } catch {
          out[i] = undefined as unknown as R;
        }
      }
    }),
  );
  return out;
}

export async function mixCountBatch(
  items: { key: string; artist: string; title: string }[],
): Promise<MixCount[]> {
  return mapLimit(items, 4, async (item) => {
    try {
      return { key: item.key, total: await countOne(item.artist, item.title), ok: true };
    } catch {
      return { key: item.key, total: null, ok: false };
    }
  });
}
