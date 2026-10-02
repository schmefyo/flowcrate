import { describe, expect, it } from "vitest";
import {
  authoritativeMixesdbPayload,
  mergeMixesdbHistory,
  planMixesdbHistorySync,
  type MixesdbCategoryMember,
  type MixesdbRevisionMetadata,
} from "../../src/lib/mixesdb-history-sync.ts";
import {
  MIXESDB_TRACKLIST_PARSER_VERSION,
  type CachedMdbSet,
  type MdbSet,
} from "../../src/lib/mixesdb-sets.server.ts";

function member(
  pageId: number,
  title = `2024-01-${String((pageId % 28) + 1).padStart(2, "0")} - DJ ${pageId}`,
): MixesdbCategoryMember {
  return { pageId, title };
}

function revision(pageId: number, revisionId = pageId + 1000): MixesdbRevisionMetadata {
  return { pageId, revisionId, revisionAt: "2026-09-25T00:00:00Z" };
}

function set(pageId: number, revisionId = pageId + 1000, title = member(pageId).title): MdbSet {
  return {
    pageId,
    revisionId,
    revisionAt: "2026-09-25T00:00:00Z",
    title,
    url: `https://www.mixesdb.com/w/${encodeURIComponent(title)}`,
    dj: "DJ",
    date: "2024-01-01",
    tracks: [],
    hasTracklist: false,
    tracklistParserVersion: MIXESDB_TRACKLIST_PARSER_VERSION,
  };
}

describe("MixesDB revision-aware history planning", () => {
  it("retains a synthetic 501-member category including continuation-page members", () => {
    const members = Array.from({ length: 501 }, (_, index) => member(index + 1));
    const plan = planMixesdbHistorySync(
      members,
      members.map(({ pageId }) => revision(pageId)),
      [],
    );
    const parsed = new Map(members.map(({ pageId }) => [pageId, set(pageId)]));
    const merged = mergeMixesdbHistory(
      "DJ",
      members,
      members.map(({ pageId }) => revision(pageId)),
      [],
      plan,
      parsed,
      "2026-09-25T00:00:00Z",
    );

    expect(plan.contentPageIds).toHaveLength(501);
    expect(merged.complete).toBe(true);
    expect(merged.payload).toHaveLength(501);
    expect(merged.payload.some((entry) => entry.pageId === 501)).toBe(true);
  });

  it("does not request content for unchanged page IDs and revisions", () => {
    const members = [member(1), member(2)];
    const plan = planMixesdbHistorySync(members, [revision(1), revision(2)], [set(1), set(2)]);
    expect(plan.unchangedPageIds).toEqual([1, 2]);
    expect(plan.contentPageIds).toEqual([]);
  });

  it("requests content only for changed revisions and legacy entries", () => {
    const members = [member(1), member(2), member(3)];
    const legacy: CachedMdbSet = {
      ...set(2),
      pageId: undefined,
      revisionId: undefined,
      revisionAt: undefined,
    };
    const plan = planMixesdbHistorySync(
      members,
      [revision(1), revision(2, 3002), revision(3)],
      [set(1), legacy],
    );
    expect(plan.changedPageIds).toEqual([]);
    expect(plan.legacyPageIds).toEqual([2]);
    expect(plan.newPageIds).toEqual([3]);
    expect(plan.contentPageIds).toEqual([2, 3]);
  });

  it("requests content for only the page whose revision changed", () => {
    const members = [member(1), member(2), member(3)];
    const plan = planMixesdbHistorySync(
      members,
      [revision(1), revision(2, 9002), revision(3)],
      [set(1), set(2), set(3)],
    );
    expect(plan.changedPageIds).toEqual([2]);
    expect(plan.contentPageIds).toEqual([2]);
    expect(plan.unchangedPageIds).toEqual([1, 3]);
  });

  it("updates a same-page rename without fetching content or losing parsed tracks", () => {
    const old = set(1, 1001, "2020-01-01 - Old Title");
    old.tracks = [{ artist: "Artist", title: "Track", label: null }];
    old.hasTracklist = true;
    const renamed = member(1, "2021-02-03 - New Title");
    const plan = planMixesdbHistorySync([renamed], [revision(1, 1001)], [old]);
    const merged = mergeMixesdbHistory(
      "DJ",
      [renamed],
      [revision(1, 1001)],
      [old],
      plan,
      new Map(),
      "2026-09-25T00:00:00Z",
    );
    expect(plan.contentPageIds).toEqual([]);
    expect(merged.complete).toBe(true);
    expect(merged.payload[0]).toMatchObject({
      title: renamed.title,
      date: "2021-02-03",
      tracks: old.tracks,
    });
  });

  it("keeps a same-title new page ID distinct and preserves disappeared history", () => {
    const title = "2020-01-01 - Recreated Set";
    const old = set(1, 1001, title);
    const current = [member(2, title)];
    const plan = planMixesdbHistorySync(current, [revision(2)], [old]);
    const merged = mergeMixesdbHistory(
      "DJ",
      current,
      [revision(2)],
      [old],
      plan,
      new Map([[2, set(2, 1002, title)]]),
      "2026-09-25T00:00:00Z",
    );
    expect(plan.newPageIds).toEqual([2]);
    expect(plan.disappearedPageIds).toEqual([1]);
    expect(merged.payload.map((entry) => entry.pageId).sort()).toEqual([1, 2]);
  });

  it("never publishes an incomplete candidate after required content or revision metadata fails", () => {
    const members = [member(1), member(2)];
    const revisions = [revision(1), revision(2)];
    const plan = planMixesdbHistorySync(members, revisions, []);
    const partial = mergeMixesdbHistory(
      "DJ",
      members,
      revisions,
      [set(9)],
      plan,
      new Map([[1, set(1)]]),
      "2026-09-25T00:00:00Z",
    );
    expect(partial.complete).toBe(false);
    expect(partial.missingContentPageIds).toEqual([2]);
    expect(partial.state.lastAttemptStatus).toBe("partial");
    expect(authoritativeMixesdbPayload([set(9)], partial)).toEqual([set(9)]);

    const metadataMissing = planMixesdbHistorySync(members, [revision(1)], []);
    const failed = mergeMixesdbHistory(
      "DJ",
      members,
      [revision(1)],
      [set(9)],
      metadataMissing,
      new Map([[1, set(1)]]),
      "2026-09-25T00:00:00Z",
    );
    expect(failed.complete).toBe(false);
    expect(failed.payload.some((entry) => entry.pageId === 9)).toBe(true);
  });

  it("uses title-derived event dates, never category membership timestamps", () => {
    const title = "2018-06-07 - DJ at Somewhere";
    const old = set(1, 1001, title);
    const renamed = member(1, "2019-05-04 - DJ at Elsewhere");
    const plan = planMixesdbHistorySync([renamed], [revision(1, 1001)], [old]);
    const merged = mergeMixesdbHistory(
      "DJ",
      [renamed],
      [revision(1, 1001)],
      [old],
      plan,
      new Map(),
      "2026-09-25T00:00:00Z",
    );
    expect(merged.payload[0]?.date).toBe("2019-05-04");
  });
});
