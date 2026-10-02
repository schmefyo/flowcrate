/**
 * Pure planning and merge helpers for revision-aware MixesDB snapshots.
 *
 * This module deliberately has no network or database dependency. The later
 * publisher can only replace a cache payload when `candidate.complete` is true.
 */
import { eventDateFromTitle } from "./set-date.ts";
import {
  MIXESDB_TRACKLIST_PARSER_VERSION,
  mixesdbPageUrl,
  type CachedMdbSet,
  type MdbSet,
} from "./mixesdb-sets.server.ts";

export type MixesdbSyncState = {
  version: 1;
  snapshot: "complete" | "legacy" | "unverified";
  memberCount: number | null;
  lastCompleteAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: "complete" | "partial" | "failed" | null;
  lastAttemptError: string | null;
};

export type MixesdbCategoryMember = { pageId: number; title: string };
export type MixesdbRevisionMetadata = {
  pageId: number;
  revisionId: number;
  revisionAt: string;
};

export type MixesdbHistoryPlan = {
  unchangedPageIds: number[];
  renamedPageIds: number[];
  newPageIds: number[];
  changedPageIds: number[];
  legacyPageIds: number[];
  /** Previously unparsed pages produced before the current parser revision. */
  parserUpgradePageIds: number[];
  /** Existing identified pages that are no longer category members. */
  disappearedPageIds: number[];
  /** Current pages for which no latest revision metadata was supplied. */
  missingRevisionPageIds: number[];
  /** New, changed, or legacy-upgrade pages that must have full content. */
  contentPageIds: number[];
};

export type MixesdbHistoryCandidate = {
  payload: CachedMdbSet[];
  complete: boolean;
  missingContentPageIds: number[];
  state: MixesdbSyncState;
};

function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function cachedPageId(set: CachedMdbSet): number | null {
  return validId(set.pageId) ? set.pageId : null;
}

function cachedRevisionId(set: CachedMdbSet): number | null {
  return validId(set.revisionId) ? set.revisionId : null;
}

/** Existing rows have no sync state and are intentionally legacy/unverified. */
export function legacyMixesdbSyncState(): MixesdbSyncState {
  return {
    version: 1,
    snapshot: "legacy",
    memberCount: null,
    lastCompleteAt: null,
    lastAttemptAt: null,
    lastAttemptStatus: null,
    lastAttemptError: null,
  };
}

/**
 * Compare the full category membership and current revision IDs to a cached
 * payload. Page ID is identity; title is never used to identify v1 records.
 */
export function planMixesdbHistorySync(
  members: MixesdbCategoryMember[],
  revisions: MixesdbRevisionMetadata[],
  existing: CachedMdbSet[],
): MixesdbHistoryPlan {
  const memberById = new Map(members.map((member) => [member.pageId, member]));
  const revisionById = new Map(revisions.map((revision) => [revision.pageId, revision]));
  const existingById = new Map<number, CachedMdbSet>();
  const legacyByTitle = new Map<string, CachedMdbSet[]>();
  for (const set of existing) {
    const pageId = cachedPageId(set);
    if (pageId) existingById.set(pageId, set);
    else legacyByTitle.set(set.title, [...(legacyByTitle.get(set.title) ?? []), set]);
  }

  const plan: MixesdbHistoryPlan = {
    unchangedPageIds: [],
    renamedPageIds: [],
    newPageIds: [],
    changedPageIds: [],
    legacyPageIds: [],
    parserUpgradePageIds: [],
    disappearedPageIds: [],
    missingRevisionPageIds: [],
    contentPageIds: [],
  };

  for (const member of members) {
    const revision = revisionById.get(member.pageId);
    if (!revision) {
      plan.missingRevisionPageIds.push(member.pageId);
      continue;
    }
    const prior = existingById.get(member.pageId);
    if (!prior) {
      // A title match against an old identity-less payload is a legacy upgrade,
      // not title identity. Its page must still be fetched and versioned.
      if (legacyByTitle.has(member.title)) plan.legacyPageIds.push(member.pageId);
      else plan.newPageIds.push(member.pageId);
      plan.contentPageIds.push(member.pageId);
      continue;
    }
    if (cachedRevisionId(prior) === null || typeof prior.revisionAt !== "string") {
      plan.legacyPageIds.push(member.pageId);
      plan.contentPageIds.push(member.pageId);
    } else if (prior.revisionId !== revision.revisionId) {
      plan.changedPageIds.push(member.pageId);
      plan.contentPageIds.push(member.pageId);
    } else if (
      !prior.hasTracklist &&
      prior.tracklistParserVersion !== MIXESDB_TRACKLIST_PARSER_VERSION
    ) {
      // Re-read only formerly unparsed pages after a parser improvement. The
      // new marker prevents legitimate no-tracklist pages from being retried.
      plan.parserUpgradePageIds.push(member.pageId);
      plan.contentPageIds.push(member.pageId);
    } else {
      plan.unchangedPageIds.push(member.pageId);
      if (prior.title !== member.title) plan.renamedPageIds.push(member.pageId);
    }
  }

  for (const pageId of existingById.keys())
    if (!memberById.has(pageId)) plan.disappearedPageIds.push(pageId);
  return plan;
}

function sortSets(sets: CachedMdbSet[]): CachedMdbSet[] {
  return [...sets].sort((a, b) => {
    if (a.date && b.date) return b.date.localeCompare(a.date) || (a.pageId ?? 0) - (b.pageId ?? 0);
    if (a.date) return -1;
    if (b.date) return 1;
    return (a.pageId ?? 0) - (b.pageId ?? 0);
  });
}

/**
 * Merge a fully parsed subset into a candidate full-history payload. A missing
 * required page makes the candidate incomplete; callers must retain the last
 * published payload rather than publishing it.
 */
export function mergeMixesdbHistory(
  dj: string,
  members: MixesdbCategoryMember[],
  revisions: MixesdbRevisionMetadata[],
  existing: CachedMdbSet[],
  plan: MixesdbHistoryPlan,
  parsedByPageId: Map<number, MdbSet>,
  attemptedAt: string,
): MixesdbHistoryCandidate {
  const revisionById = new Map(revisions.map((revision) => [revision.pageId, revision]));
  const memberById = new Map(members.map((member) => [member.pageId, member]));
  const missingContentPageIds = plan.contentPageIds.filter((pageId) => !parsedByPageId.has(pageId));
  const complete = plan.missingRevisionPageIds.length === 0 && missingContentPageIds.length === 0;
  const byPageId = new Map<number, MdbSet>();
  const legacyByTitle = new Map<string, CachedMdbSet[]>();

  for (const oldSet of existing) {
    const pageId = cachedPageId(oldSet);
    if (!pageId)
      legacyByTitle.set(oldSet.title, [...(legacyByTitle.get(oldSet.title) ?? []), oldSet]);
    else if (validId(oldSet.revisionId) && typeof oldSet.revisionAt === "string") {
      byPageId.set(pageId, oldSet as MdbSet);
    }
  }

  // A rename with the same revision is metadata-only: preserve parsed tracks.
  for (const pageId of plan.renamedPageIds) {
    const prior = byPageId.get(pageId);
    const member = memberById.get(pageId);
    const revision = revisionById.get(pageId);
    if (!prior || !member || !revision) continue;
    byPageId.set(pageId, {
      ...prior,
      title: member.title,
      url: mixesdbPageUrl(member.title),
      date: eventDateFromTitle(member.title),
      dj,
      revisionId: revision.revisionId,
      revisionAt: revision.revisionAt,
    });
  }

  for (const [pageId, parsed] of parsedByPageId) {
    byPageId.set(pageId, parsed);
    // Upgrade an identity-less record with the same title exactly once. This
    // avoids a duplicate for legacy cache rows; later snapshots use page IDs.
    const old = legacyByTitle.get(parsed.title);
    if (old?.length) old.shift();
  }

  // Preserve disappeared pages and unmatched legacy records as history. They
  // are deliberately never considered required current pages.
  const preservedLegacy = [...legacyByTitle.values()].flat();
  const payload = sortSets([...byPageId.values(), ...preservedLegacy]);

  return {
    payload,
    complete,
    missingContentPageIds,
    state: {
      version: 1,
      snapshot: complete ? "complete" : "unverified",
      memberCount: members.length,
      lastCompleteAt: complete ? attemptedAt : null,
      lastAttemptAt: attemptedAt,
      lastAttemptStatus: complete ? "complete" : "partial",
      lastAttemptError: complete ? null : "Missing required MixesDB revision or content pages",
    },
  };
}

/** A publisher must retain the last good snapshot whenever a crawl is partial. */
export function authoritativeMixesdbPayload(
  existing: CachedMdbSet[],
  candidate: MixesdbHistoryCandidate,
): CachedMdbSet[] {
  return candidate.complete ? candidate.payload : existing;
}
