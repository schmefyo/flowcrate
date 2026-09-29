import { describe, expect, it, vi } from "vitest";
import {
  createSourceCacheRefreshSummary,
  isSourceCacheFresh,
  refreshSourceCache,
  type SourceCacheRow,
} from "../../src/lib/source-cache-refresh-core.ts";
import { sourceFetchFailure, sourceFetchSuccess } from "../../src/lib/source-fetch-result.ts";

const now = () => new Date("2026-09-24T12:00:00.000Z");
const twelveHours = 12 * 60 * 60 * 1000;

function repository(rows: SourceCacheRow[] = []) {
  const writes: unknown[] = [];
  return {
    writes,
    read: vi.fn(async () => rows),
    upsert: vi.fn(async (row) => {
      writes.push(row);
    }),
  };
}

async function refresh(
  repo: ReturnType<typeof repository>,
  result:
    ReturnType<typeof sourceFetchSuccess<unknown>> | ReturnType<typeof sourceFetchFailure<unknown>>,
  names = ["Aurora Halal"],
) {
  const summary = createSourceCacheRefreshSummary();
  await refreshSourceCache({
    repository: repo,
    source: "mixesdb",
    names,
    summary,
    freshForMs: twelveHours,
    concurrency: 2,
    now,
    fetchSource: async () => result,
  });
  return summary;
}

describe("source cache refresh policy", () => {
  it("never replaces a known-good payload after provider failure or partial data", async () => {
    for (const result of [
      sourceFetchFailure("offline"),
      sourceFetchFailure("missing page", { classification: "partial" }),
    ]) {
      const repo = repository([
        {
          dj_name: "Aurora Halal",
          fetched_at: "2026-09-23T00:00:00.000Z",
          payload: [{ title: "known" }],
        },
      ]);
      const summary = await refresh(repo, result);
      expect(repo.upsert).not.toHaveBeenCalled();
      expect(summary).toMatchObject({
        failed: 1,
        preserved: 1,
        partial: result.classification === "partial" ? 1 : 0,
      });
    }
  });

  it("does not create a cold cache row after a failure, but initializes a confirmed empty category", async () => {
    const failed = repository();
    await refresh(failed, sourceFetchFailure("offline"));
    expect(failed.upsert).not.toHaveBeenCalled();

    const empty = repository();
    const summary = await refresh(
      empty,
      sourceFetchSuccess([], { classification: "confirmed-empty" }),
    );
    expect(empty.writes).toEqual([
      expect.objectContaining({
        dj_name: "Aurora Halal",
        payload: [],
        fetched_at: "2026-09-24T12:00:00.000Z",
      }),
    ]);
    expect(summary.empty).toBe(1);
  });

  it("does not let a later confirmed empty result erase known useful history", async () => {
    const repo = repository([
      {
        dj_name: "Aurora Halal",
        fetched_at: "2026-09-23T00:00:00.000Z",
        payload: [{ title: "known" }],
      },
    ]);
    const summary = await refresh(
      repo,
      sourceFetchSuccess([], { classification: "confirmed-empty" }),
    );
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ refreshed: 0, preserved: 1 });
  });

  it("treats missing, malformed, stale, and future fetched_at values as stale", () => {
    const current = now().getTime();
    expect(isSourceCacheFresh(null, twelveHours, current)).toBe(false);
    expect(isSourceCacheFresh("not-a-date", twelveHours, current)).toBe(false);
    expect(isSourceCacheFresh("2026-09-25T12:00:00.000Z", twelveHours, current)).toBe(false);
    expect(isSourceCacheFresh("2026-09-23T23:00:00.000Z", twelveHours, current)).toBe(false);
    expect(isSourceCacheFresh("2026-09-24T11:00:00.000Z", twelveHours, current)).toBe(true);
  });

  it("uses fetched_at rather than the set event date to decide refresh freshness", async () => {
    const repo = repository([
      {
        dj_name: "Powder",
        fetched_at: "2026-09-24T11:00:00.000Z",
        payload: [{ title: "2011-03-04 - Powder", date: "2011-03-04" }],
      },
    ]);
    const summary = await refresh(repo, sourceFetchSuccess([{ title: "new" }]), ["Powder"]);
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ candidates: 1, skipped: 1, refreshed: 0 });
  });
});
