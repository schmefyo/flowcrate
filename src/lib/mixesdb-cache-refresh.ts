/**
 * Revision-aware MixesDB cache publishing. This is platform-neutral so the
 * Edge Function and deterministic tests share exactly the same policy.
 */
import {
  mergeMixesdbHistory,
  planMixesdbHistorySync,
  type MixesdbSyncState,
} from "./mixesdb-history-sync.ts";
import type {
  CachedMdbSet,
  MdbSet,
  MixesdbCategoryMember,
  MixesdbContentFetch,
  MixesdbRevisionMetadata,
} from "./mixesdb-sets.server.ts";
import { buildMdbSet } from "./mixesdb-sets.server.ts";
import { isSourceCacheFresh, type SourceCacheRefreshSummary } from "./source-cache-refresh-core.ts";

export type MixesdbCacheRow = {
  dj_name: string;
  fetched_at: string | null;
  payload: unknown;
  sync_state?: unknown;
};

export type MixesdbCacheRepository = {
  read(names: string[]): Promise<MixesdbCacheRow[]>;
  publish(input: {
    dj: string;
    expectedExists: boolean;
    expectedFetchedAt: string | null;
    payload: CachedMdbSet[];
    syncState: MixesdbSyncState;
    fetchedAt: string;
  }): Promise<boolean>;
  recordAttempt?(input: {
    dj: string;
    expectedFetchedAt: string | null;
    syncState: MixesdbSyncState;
  }): Promise<boolean>;
};

export type MixesdbRefreshFetchers = {
  enumerate(dj: string): Promise<MixesdbCategoryMember[]>;
  confirmedEmpty(dj: string): Promise<boolean>;
  revisions(pageIds: number[]): Promise<MixesdbRevisionMetadata[]>;
  contents(pageIds: number[]): Promise<MixesdbContentFetch>;
};

function asPayload(value: unknown): CachedMdbSet[] {
  return Array.isArray(value) ? (value as CachedMdbSet[]) : [];
}

function priorState(value: unknown): MixesdbSyncState {
  if (!value || typeof value !== "object") return legacyState();
  const state = value as Partial<MixesdbSyncState>;
  if (state.version !== 1 || !["complete", "legacy", "unverified"].includes(String(state.snapshot)))
    return legacyState();
  return {
    version: 1,
    snapshot: state.snapshot as MixesdbSyncState["snapshot"],
    memberCount: typeof state.memberCount === "number" ? state.memberCount : null,
    lastCompleteAt: typeof state.lastCompleteAt === "string" ? state.lastCompleteAt : null,
    lastAttemptAt: typeof state.lastAttemptAt === "string" ? state.lastAttemptAt : null,
    lastAttemptStatus:
      state.lastAttemptStatus === "complete" ||
      state.lastAttemptStatus === "partial" ||
      state.lastAttemptStatus === "failed"
        ? state.lastAttemptStatus
        : null,
    lastAttemptError: typeof state.lastAttemptError === "string" ? state.lastAttemptError : null,
  };
}

function legacyState(): MixesdbSyncState {
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

function attemptState(
  row: MixesdbCacheRow,
  at: string,
  status: "partial" | "failed",
  error: unknown,
) {
  const old = priorState(row.sync_state);
  const safeError = String(error instanceof Error ? error.message : error)
    .replace(/[\r\n]+/g, " ")
    .slice(0, 240);
  return {
    ...old,
    lastAttemptAt: at,
    lastAttemptStatus: status,
    lastAttemptError: safeError || status,
  };
}

function completeState(memberCount: number, at: string): MixesdbSyncState {
  return {
    version: 1,
    snapshot: "complete",
    memberCount,
    lastCompleteAt: at,
    lastAttemptAt: at,
    lastAttemptStatus: "complete",
    lastAttemptError: null,
  };
}

function isComplete(row: MixesdbCacheRow | undefined): boolean {
  return priorState(row?.sync_state).snapshot === "complete";
}

async function eachBounded<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await work(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, worker),
  );
}

type Prepared = {
  members: MixesdbCategoryMember[];
  revisions: MixesdbRevisionMetadata[];
  parsed: Map<number, MdbSet>;
};

async function prepare(dj: string, fetchers: MixesdbRefreshFetchers): Promise<Prepared> {
  const members = await fetchers.enumerate(dj);
  if (!members.length && !(await fetchers.confirmedEmpty(dj)))
    throw new Error("MixesDB returned an unverified empty category");
  const revisions = members.length
    ? await fetchers.revisions(members.map((member) => member.pageId))
    : [];
  const revisionIds = new Set(revisions.map((revision) => revision.pageId));
  const missingMetadata = members.filter((member) => !revisionIds.has(member.pageId));
  if (missingMetadata.length)
    throw new Error(`Missing revision metadata for ${missingMetadata.length} MixesDB pages`);
  return { members, revisions, parsed: new Map() };
}

export async function refreshMixesdbCache(input: {
  repository: MixesdbCacheRepository;
  fetchers: MixesdbRefreshFetchers;
  names: string[];
  summary: SourceCacheRefreshSummary;
  freshForMs: number;
  concurrency: number;
  force?: boolean;
  now?: () => Date;
  onResult?: (input: { dj: string; complete: boolean; sets: number; error?: string }) => void;
}): Promise<void> {
  const {
    repository,
    fetchers,
    names,
    summary,
    freshForMs,
    concurrency,
    force = false,
    now = () => new Date(),
    onResult,
  } = input;
  if (!names.length) return;
  const firstRows = new Map((await repository.read(names)).map((row) => [row.dj_name, row]));
  const candidates = names.filter((name) => {
    const row = firstRows.get(name);
    return (
      force ||
      !isComplete(row) ||
      !isSourceCacheFresh(row?.fetched_at ?? null, freshForMs, now().getTime())
    );
  });
  summary.candidates += names.length;
  summary.skipped += names.length - candidates.length;

  await eachBounded(candidates, concurrency, async (dj) => {
    let row = firstRows.get(dj);
    const at = now().toISOString();
    try {
      const prepared = await prepare(dj, fetchers);
      const publish = async (current: MixesdbCacheRow | undefined): Promise<boolean> => {
        const existing = asPayload(current?.payload);
        const plan = planMixesdbHistorySync(prepared.members, prepared.revisions, existing);
        const neededContent = plan.contentPageIds.filter((pageId) => !prepared.parsed.has(pageId));
        if (neededContent.length) {
          const content = await fetchers.contents(neededContent);
          for (const page of content.pages) prepared.parsed.set(page.pageId, buildMdbSet(dj, page));
          if (content.failedPageIds.length)
            throw new Error(`Missing content for ${content.failedPageIds.length} MixesDB pages`);
        }
        const candidate = mergeMixesdbHistory(
          dj,
          prepared.members,
          prepared.revisions,
          existing,
          plan,
          prepared.parsed,
          at,
        );
        if (!candidate.complete) throw new Error("MixesDB history candidate was incomplete");
        return repository.publish({
          dj,
          expectedExists: !!current,
          expectedFetchedAt: current?.fetched_at ?? null,
          payload: candidate.payload,
          syncState: completeState(prepared.members.length, at),
          fetchedAt: at,
        });
      };

      if (!(await publish(row))) {
        const reread = new Map((await repository.read([dj])).map((next) => [next.dj_name, next]));
        row = reread.get(dj);
        if (!(await publish(row))) throw new Error("MixesDB snapshot publish conflict after retry");
      }
      summary.refreshed += 1;
      if (!prepared.members.length) summary.empty += 1;
      onResult?.({ dj, complete: true, sets: prepared.members.length });
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      const partial = /missing|incomplete|unverified/i.test(message);
      if (partial) summary.partial += 1;
      if (row) {
        summary.preserved += 1;
        await repository.recordAttempt?.({
          dj,
          expectedFetchedAt: row.fetched_at,
          syncState: attemptState(row, at, partial ? "partial" : "failed", message),
        });
      }
      onResult?.({ dj, complete: false, sets: 0, error: message });
    }
  });
}
