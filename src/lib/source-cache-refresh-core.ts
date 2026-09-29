/**
 * Platform-neutral cache refresh policy. The Edge Function supplies Supabase
 * persistence and provider fetchers; deterministic tests supply local fakes.
 */
import type { SourceFetchResult } from "./source-fetch-result.ts";

export type SourceCacheSource = "mixesdb" | "soundcloud" | "ra";
export type SourceCacheRow = { dj_name: string; fetched_at: string | null; payload: unknown };

export type SourceCacheRepository = {
  read(source: SourceCacheSource, names: string[]): Promise<SourceCacheRow[]>;
  upsert(row: {
    source: SourceCacheSource;
    dj_name: string;
    fetched_at: string;
    payload: unknown;
  }): Promise<void>;
};

export type SourceCacheRefreshSummary = {
  candidates: number;
  skipped: number;
  refreshed: number;
  failed: number;
  partial: number;
  preserved: number;
  empty: number;
};

export type SourceCacheRefreshHooks = {
  providerFailed?: (input: {
    source: SourceCacheSource;
    dj: string;
    result: Extract<SourceFetchResult<unknown>, { ok: false }>;
    preserved: boolean;
  }) => void;
  sourceResult?: (input: {
    source: SourceCacheSource;
    dj: string;
    result: Extract<SourceFetchResult<unknown>, { ok: true }>;
    previousPayload: unknown[];
  }) => void;
  preserved?: (input: { source: SourceCacheSource; dj: string; classification: string }) => void;
  refreshFailed?: (input: { source: SourceCacheSource; dj: string; error: unknown }) => void;
};

export function createSourceCacheRefreshSummary(): SourceCacheRefreshSummary {
  return { candidates: 0, skipped: 0, refreshed: 0, failed: 0, partial: 0, preserved: 0, empty: 0 };
}

export function isSourceCacheFresh(
  timestamp: string | null,
  freshForMs: number,
  now = Date.now(),
): boolean {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  const age = now - parsed;
  return Number.isFinite(parsed) && age >= 0 && age <= freshForMs;
}

async function eachBounded<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

export async function refreshSourceCache(input: {
  repository: SourceCacheRepository;
  source: SourceCacheSource;
  names: string[];
  summary: SourceCacheRefreshSummary;
  freshForMs: number;
  concurrency: number;
  forceMixesdb?: boolean;
  now?: () => Date;
  fetchSource: (source: SourceCacheSource, dj: string) => Promise<SourceFetchResult<unknown>>;
  hooks?: SourceCacheRefreshHooks;
}): Promise<void> {
  const {
    repository,
    source,
    names,
    summary,
    freshForMs,
    concurrency,
    forceMixesdb = false,
    now = () => new Date(),
    fetchSource,
    hooks,
  } = input;
  if (!names.length) return;

  const rows = await repository.read(source, names);
  const existing = new Map(rows.map((row) => [row.dj_name, row]));
  const stale = names.filter(
    (name) =>
      (forceMixesdb && source === "mixesdb") ||
      !isSourceCacheFresh(existing.get(name)?.fetched_at ?? null, freshForMs, now().getTime()),
  );
  summary.candidates += names.length;
  summary.skipped += names.length - stale.length;

  await eachBounded(stale, concurrency, async (dj) => {
    const old = existing.get(dj);
    try {
      const result = await fetchSource(source, dj);
      if (!result.ok) {
        summary.failed += 1;
        if (result.classification === "partial") summary.partial += 1;
        if (old) summary.preserved += 1;
        hooks?.providerFailed?.({ source, dj, result, preserved: !!old });
        return;
      }

      const previousPayload = Array.isArray(old?.payload) ? old.payload : [];
      hooks?.sourceResult?.({ source, dj, result, previousPayload });
      // A verified empty category may initialize an empty key, but an outage
      // or later category correction must never erase useful history.
      if (result.classification === "confirmed-empty" && previousPayload.length > 0) {
        summary.preserved += 1;
        hooks?.preserved?.({ source, dj, classification: result.classification });
        return;
      }

      const fetchedAt = now().toISOString();
      await repository.upsert({ source, dj_name: dj, fetched_at: fetchedAt, payload: result.data });
      summary.refreshed += 1;
      if (result.data.length === 0) summary.empty += 1;
    } catch (error) {
      summary.failed += 1;
      hooks?.refreshFailed?.({ source, dj, error });
    }
  });
}
