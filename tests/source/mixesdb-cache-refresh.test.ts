import { describe, expect, it, vi } from "vitest";
import { refreshMixesdbCache } from "../../src/lib/mixesdb-cache-refresh.ts";
import { createSourceCacheRefreshSummary } from "../../src/lib/source-cache-refresh-core.ts";
import type {
  MdbSet,
  MixesdbCategoryMember,
  MixesdbRevisionMetadata,
} from "../../src/lib/mixesdb-sets.server.ts";

const now = () => new Date("2026-09-26T12:00:00.000Z");
const oldAt = "2026-09-25T00:00:00.000Z";

function member(pageId: number, title = `2024-01-01 - DJ ${pageId}`): MixesdbCategoryMember {
  return { pageId, title };
}
function revision(pageId: number, revisionId = pageId + 100): MixesdbRevisionMetadata {
  return { pageId, revisionId, revisionAt: "2026-09-25T00:00:00Z" };
}
function page(pageId: number, revisionId = pageId + 100, title = member(pageId).title) {
  return {
    pageId,
    revisionId,
    revisionAt: "2026-09-25T00:00:00Z",
    title,
    content: "# Artist - Track",
  };
}
function stored(pageId: number, revisionId = pageId + 100): MdbSet {
  return {
    ...page(pageId, revisionId),
    url: "https://www.mixesdb.com/w/test",
    dj: "DJ",
    date: "2024-01-01",
    tracks: [],
    hasTracklist: false,
  };
}

function setup(rows: any[] = [], members = [member(1)], revisions = [revision(1)]) {
  const writes: any[] = [];
  const attempts: any[] = [];
  const repository = {
    read: vi.fn(async () => rows),
    publish: vi.fn(async (input) => {
      writes.push(input);
      return true;
    }),
    recordAttempt: vi.fn(async (input) => {
      attempts.push(input);
      return true;
    }),
  };
  const fetchers = {
    enumerate: vi.fn(async () => members),
    confirmedEmpty: vi.fn(async () => true),
    revisions: vi.fn(async () => revisions),
    contents: vi.fn(async (ids: number[]) => ({
      pages: ids.map((id) => page(id, revisions.find((r) => r.pageId === id)?.revisionId)),
      failedPageIds: [],
    })),
  };
  return { repository, fetchers, writes, attempts };
}

async function run(setupResult: ReturnType<typeof setup>) {
  const summary = createSourceCacheRefreshSummary();
  await refreshMixesdbCache({
    ...setupResult,
    names: ["DJ"],
    summary,
    freshForMs: 12 * 60 * 60 * 1000,
    concurrency: 2,
    now,
  });
  return summary;
}

describe("revision-aware MixesDB refresh publication", () => {
  it("upgrades a legacy 200-set row to a complete 501-set snapshot", async () => {
    const members = Array.from({ length: 501 }, (_, i) => member(i + 1));
    const row = {
      dj_name: "DJ",
      fetched_at: oldAt,
      payload: Array.from({ length: 200 }, (_, i) => ({
        ...stored(i + 1),
        pageId: undefined,
        revisionId: undefined,
        revisionAt: undefined,
      })),
    };
    const test = setup(
      [row],
      members,
      members.map(({ pageId }) => revision(pageId)),
    );
    await run(test);
    expect(test.writes[0].payload).toHaveLength(501);
    expect(test.writes[0].syncState).toMatchObject({ snapshot: "complete", memberCount: 501 });
    expect(test.fetchers.contents).toHaveBeenCalledTimes(1);
    expect(test.fetchers.contents).toHaveBeenCalledWith(members.map(({ pageId }) => pageId));
  });

  it("reuses unchanged pages and fetches only an edited historical page", async () => {
    const row = {
      dj_name: "DJ",
      fetched_at: oldAt,
      payload: [stored(1), stored(2)],
      sync_state: { version: 1, snapshot: "complete" },
    };
    const test = setup([row], [member(1), member(2)], [revision(1), revision(2, 999)]);
    await run(test);
    expect(test.fetchers.contents).toHaveBeenCalledWith([2]);
    expect(test.writes[0].payload.find((set: MdbSet) => set.pageId === 2)?.revisionId).toBe(999);
  });

  it("publishes a stale complete snapshot without fetching content when every revision is unchanged", async () => {
    const row = {
      dj_name: "DJ",
      fetched_at: oldAt,
      payload: [stored(1), stored(2)],
      sync_state: { version: 1, snapshot: "complete" },
    };
    const test = setup([row], [member(1), member(2)], [revision(1), revision(2)]);
    await run(test);
    expect(test.fetchers.contents).not.toHaveBeenCalled();
    expect(test.writes[0].payload).toHaveLength(2);
  });

  it("preserves payload and fetched_at while recording a partial legacy attempt", async () => {
    const row = { dj_name: "DJ", fetched_at: oldAt, payload: [stored(9)] };
    const test = setup([row], [member(1), member(2)], [revision(1), revision(2)]);
    test.fetchers.contents.mockResolvedValue({ pages: [page(1)], failedPageIds: [2] });
    const summary = await run(test);
    expect(test.writes).toEqual([]);
    expect(test.attempts[0]).toMatchObject({
      expectedFetchedAt: oldAt,
      syncState: { lastAttemptStatus: "partial" },
    });
    expect(summary).toMatchObject({ failed: 1, partial: 1, preserved: 1 });
  });

  it("publishes a confirmed empty cold row but creates nothing after a failed cold crawl", async () => {
    const empty = setup([], [], []);
    await run(empty);
    expect(empty.writes[0]).toMatchObject({
      payload: [],
      expectedExists: false,
      syncState: { snapshot: "complete" },
    });

    const failed = setup();
    failed.fetchers.enumerate.mockRejectedValue(new Error("offline"));
    await run(failed);
    expect(failed.writes).toEqual([]);
    expect(failed.attempts).toEqual([]);
  });

  it("re-reads and retries one optimistic publish conflict, then fails safely on a second conflict", async () => {
    const row = {
      dj_name: "DJ",
      fetched_at: oldAt,
      payload: [stored(1)],
      sync_state: { version: 1, snapshot: "complete" },
    };
    const retry = setup([row]);
    retry.repository.publish.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await run(retry);
    expect(retry.repository.read).toHaveBeenCalledTimes(2);
    expect(retry.repository.publish).toHaveBeenCalledTimes(2);

    const conflict = setup([row]);
    conflict.repository.publish.mockResolvedValue(false);
    const summary = await run(conflict);
    expect(conflict.repository.publish).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ failed: 1, preserved: 1 });
  });
});
