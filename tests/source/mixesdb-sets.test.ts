import { afterEach, describe, expect, it, vi } from "vitest";
import {
  categoryInfoResponse,
  categoryResponse,
  jsonResponse,
  requestParams,
  revisionPagesResponse,
  revisionsResponse,
} from "../fixtures/mixesdb/mediawiki.ts";
import {
  fetchMixesdbPageContentsResult,
  fetchMixesdbRevisionMetadata,
  mixesdbSetsForResult,
} from "../../src/lib/mixesdb-sets.server.ts";

const tracklist = "# Example Artist - Example Track [Example Label]";

afterEach(() => vi.unstubAllGlobals());

function revisionResponseForPages(pageIds: string, titlesById: Map<number, string>) {
  return jsonResponse(
    revisionPagesResponse(
      pageIds.split("|").map((pageId) => ({
        pageId: Number(pageId),
        title: titlesById.get(Number(pageId)) ?? pageId,
        content: tracklist,
      })),
    ),
  );
}

describe("MixesDB source fetching", () => {
  it("follows category pagination and retains meaningful data after a continuation", async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      title: `2019-01-${String((index % 28) + 1).padStart(2, "0")} - Ben UFO ${index}`,
      pageid: index + 1,
      timestamp: "2026-09-24T00:00:00Z",
    }));
    const laterTitle = "2027-01-01 - Ben UFO after continuation";
    const titlesById = new Map([
      ...firstPage.map((member) => [member.pageid, member.title]),
      [501, laterTitle],
    ]);
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const params = requestParams(input);
      if (params.get("list") === "categorymembers") {
        return params.get("cmcontinue")
          ? jsonResponse(
              categoryResponse([
                { title: laterTitle, pageid: 501, timestamp: "2001-01-01T00:00:00Z" },
              ]),
            )
          : jsonResponse(categoryResponse(firstPage, "next-page"));
      }
      return revisionResponseForPages(params.get("pageids") ?? "", titlesById);
    });
    vi.stubGlobal("fetch", fetch);

    const result = await mixesdbSetsForResult("Ben UFO");

    expect(result).toMatchObject({ ok: true, classification: "complete" });
    if (!result.ok) return;
    expect(result.diagnostics).toMatchObject({
      categoryMembers: 501,
      categoryPages: 2,
      selectedSets: 200,
    });
    expect(result.data.some((set) => set.title === laterTitle && set.date === "2027-01-01")).toBe(
      true,
    );
    expect(
      fetch.mock.calls.filter(([input]) => requestParams(input).get("list") === "categorymembers"),
    ).toHaveLength(2);
  });

  it("reports repeated pagination tokens as an incomplete result", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const params = requestParams(input);
      if (params.get("list") === "categorymembers")
        return jsonResponse(categoryResponse([{ title: "2024-01-01 - Aurora Halal" }], "again"));
      throw new Error("set pages should not be requested after a pagination safety failure");
    });
    vi.stubGlobal("fetch", fetch);

    const result = await mixesdbSetsForResult("Aurora Halal");

    expect(result).toMatchObject({ ok: false, classification: "partial" });
    expect(result.diagnostics).toMatchObject({ categoryMembers: 1, categoryPages: 2 });
  });

  it("parses tracklists, while retaining sets with no parseable tracklist", async () => {
    const titled = "2024-01-01 - Aurora Halal";
    const unparseable = "2023-01-01 - Aurora Halal";
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const params = requestParams(input);
      if (params.get("list") === "categorymembers")
        return jsonResponse(categoryResponse([{ title: titled }, { title: unparseable }]));
      return jsonResponse(
        revisionsResponse({ [titled]: tracklist, [unparseable]: "# ??? - ???\nplain text" }),
      );
    });
    vi.stubGlobal("fetch", fetch);

    const result = await mixesdbSetsForResult("Aurora Halal");

    expect(result).toMatchObject({ ok: true, classification: "complete" });
    if (!result.ok) return;
    expect(result.diagnostics).toMatchObject({
      selectedSets: 2,
      setsWithTracklists: 1,
      parsedTracks: 1,
    });
    expect(result.data.find((set) => set.title === unparseable)).toMatchObject({
      hasTracklist: false,
      tracks: [],
    });
    const contentRequest = fetch.mock.calls.find(
      ([input]) => requestParams(input).get("prop") === "revisions",
    );
    expect(contentRequest).toBeDefined();
    expect(requestParams(contentRequest?.[0]).get("pageids")).toContain("|");
    expect(requestParams(contentRequest?.[0]).get("rvlimit")).toBeNull();
  });

  it("keeps rvlimit only on a one-page content request", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const params = requestParams(input);
      return jsonResponse(
        revisionPagesResponse([
          {
            pageId: Number(params.get("pageids")),
            title: "2024-01-01 - One Page",
            content: tracklist,
          },
        ]),
      );
    });
    vi.stubGlobal("fetch", fetch);

    const result = await fetchMixesdbPageContentsResult([42]);

    expect(result).toMatchObject({
      failedPageIds: [],
      pages: [expect.objectContaining({ pageId: 42 })],
    });
    expect(requestParams(fetch.mock.calls[0]?.[0]).get("rvlimit")).toBe("1");
  });

  it("omits rvlimit for multi-page revision metadata requests", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const params = requestParams(input);
      return jsonResponse(
        revisionPagesResponse(
          (params.get("pageids") ?? "").split("|").map((pageId) => ({
            pageId: Number(pageId),
            title: `2024-01-01 - Metadata ${pageId}`,
            content: "",
          })),
        ),
      );
    });
    vi.stubGlobal("fetch", fetch);

    await expect(fetchMixesdbRevisionMetadata([41, 42])).resolves.toEqual([
      expect.objectContaining({ pageId: 41 }),
      expect.objectContaining({ pageId: 42 }),
    ]);
    expect(requestParams(fetch.mock.calls[0]?.[0]).get("pageids")).toBe("41|42");
    expect(requestParams(fetch.mock.calls[0]?.[0]).get("rvlimit")).toBeNull();
  });

  it("distinguishes a confirmed empty category from an unverified empty response", async () => {
    const confirmedFetch = vi.fn(async (input: RequestInfo | URL) => {
      const params = requestParams(input);
      return params.get("prop") === "categoryinfo"
        ? jsonResponse(categoryInfoResponse(0))
        : jsonResponse(categoryResponse([]));
    });
    vi.stubGlobal("fetch", confirmedFetch);
    await expect(mixesdbSetsForResult("No Sets")).resolves.toMatchObject({
      ok: true,
      classification: "confirmed-empty",
      data: [],
    });

    const suspiciousFetch = vi.fn(async (input: RequestInfo | URL) => {
      const params = requestParams(input);
      return params.get("prop") === "categoryinfo"
        ? jsonResponse({ query: { pages: { "-1": { missing: "" } } } })
        : jsonResponse(categoryResponse([]));
    });
    vi.stubGlobal("fetch", suspiciousFetch);
    await expect(mixesdbSetsForResult("Maybe Sets")).resolves.toMatchObject({
      ok: false,
      classification: "suspicious-empty",
    });
  });

  it("marks a category as partial when a required set page is missing", async () => {
    const first = "2024-01-01 - Aurora Halal";
    const missing = "2023-01-01 - Aurora Halal";
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const params = requestParams(input);
      if (params.get("list") === "categorymembers")
        return jsonResponse(categoryResponse([{ title: first }, { title: missing }]));
      return jsonResponse(revisionsResponse({ [first]: tracklist }));
    });
    vi.stubGlobal("fetch", fetch);

    const result = await mixesdbSetsForResult("Aurora Halal");

    expect(result).toMatchObject({ ok: false, classification: "partial" });
    expect(result.diagnostics).toMatchObject({
      selectedSets: 2,
      setPagesFetched: 1,
      setPagesFailed: 1,
    });
  });

  it("keeps punctuation in Or:la and Ne/Re/A category requests and result attribution", async () => {
    const requestedCategories: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const params = requestParams(input);
      if (params.get("list") === "categorymembers") {
        requestedCategories.push(params.get("cmtitle") ?? "");
        return jsonResponse(
          categoryResponse([
            { title: `2024-01-01 - ${params.get("cmtitle")?.replace("Category:", "")}` },
          ]),
        );
      }
      return jsonResponse(
        revisionsResponse(
          Object.fromEntries(
            (params.get("pageids") ?? "").split("|").map((pageId) => [pageId, "# ??? - ???"]),
          ),
        ),
      );
    });
    vi.stubGlobal("fetch", fetch);

    const [orla, nerea] = await Promise.all([
      mixesdbSetsForResult("Or:la"),
      mixesdbSetsForResult("Ne/Re/A"),
    ]);

    expect(requestedCategories).toEqual(
      expect.arrayContaining(["Category:Or:la", "Category:Ne/Re/A"]),
    );
    expect(orla).toMatchObject({
      ok: true,
      data: [expect.objectContaining({ dj: "Or:la", hasTracklist: false })],
    });
    expect(nerea).toMatchObject({
      ok: true,
      data: [expect.objectContaining({ dj: "Ne/Re/A", hasTracklist: false })],
    });
  });
});
