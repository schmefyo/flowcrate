/**
 * MixesDB sets (with tracklists) for a single DJ.
 *
 * The scheduler owns this expensive work. A result is only cacheable when we
 * traversed the category safely and fetched every selected set page.
 */
import { parseTracklist } from "./discover.server.ts";
import { eventDateFromTitle } from "./set-date.ts";
import {
  sourceFetchFailure,
  sourceFetchSuccess,
  type SourceFetchDiagnostics,
  type SourceFetchResult,
} from "./source-fetch-result.ts";

const API = "https://www.mixesdb.com/w/api.php";
const UA = { "user-agent": "FlowCrate/1.0 (dj radar)", accept: "application/json" };
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_ATTEMPTS = 2;
const CATEGORY_PAGE_SIZE = 500;
const SET_PAGE_SIZE = 10;
const REVISION_PAGE_SIZE = 50;
/** Modest provider-safe parallelism for first full-history crawls. */
export const MIXESDB_CONTENT_CONCURRENCY = 4;

export type MdbSet = {
  title: string;
  url: string;
  dj: string;
  /** Event date parsed from the set title, never category-membership time. */
  date: string | null;
  tracks: { artist: string; title: string; label: string | null }[];
  /** False when the page had no parseable tracklist. */
  hasTracklist: boolean;
  /** Stable MediaWiki page identity for revision-aware synchronization. */
  pageId: number;
  /** Latest revision used when this page's content was parsed. */
  revisionId: number;
  /** ISO timestamp of `revisionId`. */
  revisionAt: string;
};

/** Old persisted rows predate page/revision metadata but remain readable. */
export type CachedMdbSet = Omit<MdbSet, "pageId" | "revisionId" | "revisionAt"> &
  Partial<Pick<MdbSet, "pageId" | "revisionId" | "revisionAt">>;

async function api(params: Record<string, string>): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(`${API}?${new URLSearchParams({ ...params, format: "json" })}`, {
        headers: UA,
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`MixesDB returned ${res.status}`);
      const json = (await res.json()) as { error?: { info?: unknown; code?: unknown } };
      if (json.error)
        throw new Error(String(json.error.info ?? json.error.code ?? "MixesDB API error"));
      return json;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < REQUEST_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MixesDB request failed");
}

export function mixesdbPageUrl(title: string): string {
  return `https://www.mixesdb.com/w/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

/**
 * Compatibility limit for direct/interactive fetching only. Revision-aware
 * cache publication never calls this path and retains complete history.
 */
export const MDB_DIRECT_SET_LIMIT = 200;

export type MixesdbCategoryMember = { pageId: number; title: string };
export type MixesdbRevisionMetadata = { pageId: number; revisionId: number; revisionAt: string };
type CategoryMember = { pageid?: unknown; title?: unknown };
type CategoryResponse = {
  query?: { categorymembers?: unknown };
  continue?: { cmcontinue?: unknown };
};
type CategoryInfoResponse = {
  query?: { pages?: Record<string, { missing?: unknown; categoryinfo?: { size?: unknown } }> };
};
type RevisionPage = {
  pageid?: unknown;
  title?: unknown;
  revisions?: { revid?: unknown; timestamp?: unknown; slots?: { main?: { "*"?: unknown } } }[];
};
type RevisionResponse = { query?: { pages?: Record<string, RevisionPage> } };

export async function mixesdbCategoryIsConfirmedEmpty(name: string): Promise<boolean> {
  const json = await api({
    action: "query",
    titles: `Category:${name}`,
    prop: "categoryinfo",
  });
  const pages = Object.values((json as CategoryInfoResponse).query?.pages ?? {});
  const page = pages.find((candidate) => !candidate?.missing);
  return !!page && Number(page?.categoryinfo?.size) === 0;
}

function diagnosticsFor(
  categoryMembers: number,
  categoryPages: number,
  selectedSets: number,
  setPagesFetched = 0,
  setPagesFailed = 0,
  setsWithTracklists = 0,
  parsedTracks = 0,
): SourceFetchDiagnostics {
  return {
    categoryMembers,
    categoryPages,
    selectedSets,
    setPagesFetched,
    setPagesFailed,
    setsWithTracklists,
    parsedTracks,
  };
}

function asPositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

class MixesdbCategoryPaginationError extends Error {
  constructor(
    message: string,
    readonly categoryMembers: number,
    readonly categoryPages: number,
  ) {
    super(message);
  }
}

/** Enumerate every namespace-0 category member. Membership time is ignored. */
export async function enumerateMixesdbCategory(name: string): Promise<MixesdbCategoryMember[]> {
  const members: MixesdbCategoryMember[] = [];
  const seenPageIds = new Set<number>();
  const seenContinuations = new Set<string>();
  let continuation: string | undefined;
  let noProgressPages = 0;
  let categoryPages = 0;

  for (;;) {
    const cm = await api({
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${name}`,
      cmlimit: String(CATEGORY_PAGE_SIZE),
      cmnamespace: "0",
      cmsort: "timestamp",
      cmdir: "desc",
      cmprop: "ids|title",
      ...(continuation ? { cmcontinue: continuation } : {}),
    });
    const pageMembers = (cm as CategoryResponse).query?.categorymembers;
    if (!Array.isArray(pageMembers)) throw new Error("Invalid MixesDB category response");
    categoryPages += 1;
    const before = members.length;
    for (const member of pageMembers as CategoryMember[]) {
      const pageId = asPositiveInteger(member.pageid);
      const title = String(member.title ?? "").trim();
      if (pageId && title && !seenPageIds.has(pageId)) {
        seenPageIds.add(pageId);
        members.push({ pageId, title });
      }
    }
    noProgressPages = members.length === before ? noProgressPages + 1 : 0;
    if (noProgressPages >= 2)
      throw new MixesdbCategoryPaginationError(
        "MixesDB category pagination made no progress",
        members.length,
        categoryPages,
      );
    const next = (cm as CategoryResponse).continue?.cmcontinue;
    if (typeof next !== "string" || !next) return members;
    if (seenContinuations.has(next))
      throw new MixesdbCategoryPaginationError(
        "MixesDB repeated a category pagination token",
        members.length,
        categoryPages,
      );
    seenContinuations.add(next);
    continuation = next;
  }
}

/** Fetch only the current revision identity for category pages, in 50-ID batches. */
export async function fetchMixesdbRevisionMetadata(
  pageIds: number[],
): Promise<MixesdbRevisionMetadata[]> {
  const result: MixesdbRevisionMetadata[] = [];
  for (let i = 0; i < pageIds.length; i += REVISION_PAGE_SIZE) {
    const batch = pageIds.slice(i, i + REVISION_PAGE_SIZE);
    const pagesJson = await api({
      action: "query",
      prop: "revisions",
      pageids: batch.join("|"),
      rvprop: "ids|timestamp",
      ...(batch.length === 1 ? { rvlimit: "1" } : {}),
    });
    for (const page of Object.values((pagesJson as RevisionResponse).query?.pages ?? {})) {
      const pageId = asPositiveInteger(page.pageid);
      const revision = page.revisions?.[0];
      const revisionId = asPositiveInteger(revision?.revid);
      const revisionAt = typeof revision?.timestamp === "string" ? revision.timestamp : null;
      if (pageId && revisionId && revisionAt) result.push({ pageId, revisionId, revisionAt });
    }
  }
  return result;
}

export type MixesdbContentPage = MixesdbRevisionMetadata & { title: string; content: string };
export type MixesdbContentFetch = { pages: MixesdbContentPage[]; failedPageIds: number[] };

/** Fetch wikitext exclusively for the explicitly requested page IDs. */
export async function fetchMixesdbPageContentsResult(
  pageIds: number[],
  concurrency = MIXESDB_CONTENT_CONCURRENCY,
): Promise<MixesdbContentFetch> {
  const result: MixesdbContentPage[] = [];
  const failedPageIds: number[] = [];
  const batches = Array.from({ length: Math.ceil(pageIds.length / SET_PAGE_SIZE) }, (_, index) =>
    pageIds.slice(index * SET_PAGE_SIZE, (index + 1) * SET_PAGE_SIZE),
  );
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      if (!batch) continue;
      try {
        const pagesJson = await api({
          action: "query",
          prop: "revisions",
          pageids: batch.join("|"),
          rvprop: "ids|timestamp|content",
          rvslots: "main",
          ...(batch.length === 1 ? { rvlimit: "1" } : {}),
        });
        const returned = new Set<number>();
        for (const page of Object.values((pagesJson as RevisionResponse).query?.pages ?? {})) {
          const pageId = asPositiveInteger(page.pageid);
          const title = typeof page.title === "string" ? page.title : null;
          const revision = page.revisions?.[0];
          const revisionId = asPositiveInteger(revision?.revid);
          const revisionAt = typeof revision?.timestamp === "string" ? revision.timestamp : null;
          const content = revision?.slots?.main?.["*"];
          if (pageId && title && revisionId && revisionAt && typeof content === "string") {
            returned.add(pageId);
            result.push({ pageId, title, revisionId, revisionAt, content });
          }
        }
        failedPageIds.push(...batch.filter((pageId) => !returned.has(pageId)));
      } catch {
        failedPageIds.push(...batch);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), batches.length) }, worker),
  );
  return { pages: result, failedPageIds };
}

/** Legacy convenience wrapper: require every requested page to be available. */
export async function fetchMixesdbPageContents(pageIds: number[]): Promise<MixesdbContentPage[]> {
  const result = await fetchMixesdbPageContentsResult(pageIds, 1);
  if (result.failedPageIds.length) throw new Error("MixesDB set pages were incomplete");
  return result.pages;
}

/** Build the persisted, versioned set representation from a parsed page. */
export function buildMdbSet(dj: string, page: MixesdbContentPage): MdbSet {
  const tracks = parseTracklist(page.content);
  return {
    title: page.title,
    url: mixesdbPageUrl(page.title),
    dj,
    date: eventDateFromTitle(page.title),
    tracks,
    hasTracklist: tracks.length > 0,
    pageId: page.pageId,
    revisionId: page.revisionId,
    revisionAt: page.revisionAt,
  };
}

/** Recent MixesDB sets for one DJ, with tracklists already parsed. */
export async function mixesdbSetsForResult(
  dj: string,
  limit = MDB_DIRECT_SET_LIMIT,
): Promise<SourceFetchResult<MdbSet>> {
  const name = dj.trim().replace(/^Category:/, "");
  if (!name) return sourceFetchSuccess([], { classification: "confirmed-empty" });

  let members: MixesdbCategoryMember[];

  try {
    members = await enumerateMixesdbCategory(name);
  } catch (error) {
    const partial = /pagination/i.test(error instanceof Error ? error.message : "");
    const categoryError = error instanceof MixesdbCategoryPaginationError ? error : null;
    return sourceFetchFailure(error, {
      ...(partial ? { classification: "partial" as const } : {}),
      diagnostics: diagnosticsFor(
        categoryError?.categoryMembers ?? 0,
        categoryError?.categoryPages ?? 0,
        0,
      ),
    });
  }

  if (!members.length) {
    try {
      if (await mixesdbCategoryIsConfirmedEmpty(name)) {
        return sourceFetchSuccess([], {
          classification: "confirmed-empty",
          diagnostics: diagnosticsFor(0, 1, 0),
        });
      }
    } catch (error) {
      return sourceFetchFailure(error, {
        classification: "suspicious-empty",
        diagnostics: diagnosticsFor(0, 1, 0),
      });
    }
    return sourceFetchFailure("MixesDB returned an unverified empty category", {
      classification: "suspicious-empty",
      diagnostics: diagnosticsFor(0, 1, 0),
    });
  }

  const byTitle = new Map<string, MixesdbCategoryMember>();
  for (const member of members) {
    const title = member.title;
    if (!title || byTitle.has(title)) continue;
    byTitle.set(title, member);
  }

  const selected = [...byTitle.values()]
    .sort((a, b) => {
      const aDate = eventDateFromTitle(a.title);
      const bDate = eventDateFromTitle(b.title);
      if (aDate && bDate) return bDate.localeCompare(aDate) || a.title.localeCompare(b.title);
      if (aDate) return -1;
      if (bDate) return 1;
      return a.title.localeCompare(b.title);
    })
    .slice(0, Math.min(Math.max(limit, 1), MDB_DIRECT_SET_LIMIT));
  const selectedById = new Map(selected.map((set) => [set.pageId, set]));
  const sets: MdbSet[] = [];
  let setPagesFetched = 0;
  let setPagesFailed = 0;

  try {
    const fetched = await fetchMixesdbPageContentsResult(
      selected.map((set) => set.pageId),
      1,
    );
    const pages = fetched.pages;
    const returned = new Set<number>();
    for (const page of pages) {
      if (!selectedById.has(page.pageId)) continue;
      returned.add(page.pageId);
      sets.push(buildMdbSet(name, page));
      setPagesFetched += 1;
    }
    setPagesFailed = selected.filter((set) => !returned.has(set.pageId)).length;
  } catch {
    setPagesFailed = selected.length;
  }

  const setsWithTracklists = sets.filter((set) => set.hasTracklist).length;
  const parsedTracks = sets.reduce((total, set) => total + set.tracks.length, 0);
  const diagnostics = diagnosticsFor(
    byTitle.size,
    Math.ceil(members.length / CATEGORY_PAGE_SIZE),
    selected.length,
    setPagesFetched,
    setPagesFailed,
    setsWithTracklists,
    parsedTracks,
  );
  if (setPagesFailed) {
    return sourceFetchFailure("MixesDB set pages were incomplete", {
      classification: "partial",
      diagnostics,
    });
  }
  return sourceFetchSuccess(sets, { classification: "complete", diagnostics });
}

/** Recent MixesDB sets for one DJ, preserving the app's best-effort API. */
export async function mixesdbSetsFor(dj: string, limit = MDB_DIRECT_SET_LIMIT): Promise<MdbSet[]> {
  const result = await mixesdbSetsForResult(dj, limit);
  return result.ok ? result.data : [];
}
