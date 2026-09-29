import { createClient } from "npm:@supabase/supabase-js@2";
import {
  enumerateMixesdbCategory,
  fetchMixesdbPageContentsResult,
  fetchMixesdbRevisionMetadata,
  mixesdbCategoryIsConfirmedEmpty,
} from "../../../src/lib/mixesdb-sets.server.ts";
import { soundcloudSetsForResult } from "../../../src/lib/soundcloud.server.ts";
import { raSetsForResult } from "../../../src/lib/ra.server.ts";
import type { SourceFetchResult } from "../../../src/lib/source-fetch-result.ts";
import {
  createSourceCacheRefreshSummary,
  refreshSourceCache,
  type SourceCacheSource,
} from "../../../src/lib/source-cache-refresh-core.ts";
import { refreshMixesdbCache } from "../../../src/lib/mixesdb-cache-refresh.ts";

const FRESH_FOR_MS = 12 * 60 * 60 * 1000;
const CONCURRENCY = 2;
const SOURCE_TIMEOUT_MS = 120_000;

type Source = SourceCacheSource;

function defaultSecretKey(): string | null {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}") as Record<
      string,
      unknown
    >;
    return typeof keys.default === "string" && keys.default ? keys.default : null;
  } catch {
    return null;
  }
}

async function withTimeout<T>(work: Promise<T>, source: Source, dj: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${source} timed out for ${dj}`)),
          SOURCE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function fetchSource(source: Source, dj: string): Promise<SourceFetchResult<unknown>> {
  switch (source) {
    case "mixesdb":
      throw new Error("MixesDB uses revision-aware refresh");
    case "soundcloud":
      return withTimeout(soundcloudSetsForResult(dj), source, dj);
    case "ra":
      return withTimeout(raSetsForResult(dj), source, dj);
  }
}

type RefreshRequest = {
  names: string[] | null;
  forceMixesdb: boolean;
  shard: number | null;
  shards: number | null;
};

async function requestedNames(request: Request): Promise<RefreshRequest> {
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== "object") throw new Error("Invalid refresh request");
  const input = body as { names?: unknown; force?: unknown; shard?: unknown; shards?: unknown };
  if (input.names !== undefined && (!Array.isArray(input.names) || input.names.length > 240))
    throw new Error("Invalid warm-up request");
  const shard = Number.isInteger(input.shard) ? Number(input.shard) : null;
  const shards = Number.isInteger(input.shards) ? Number(input.shards) : null;
  if (
    (shard === null) !== (shards === null) ||
    (shard !== null && (!shards || shard < 0 || shard >= shards || shards > 40))
  )
    throw new Error("Invalid refresh shard");
  return {
    names: Array.isArray(input.names)
      ? [
          ...new Set(
            input.names
              .filter((name): name is string => typeof name === "string")
              .map((name) => name.trim().replace(/^Category:/, ""))
              .filter(Boolean),
          ),
        ]
      : null,
    forceMixesdb: input.force === true,
    shard,
    shards,
  };
}

Deno.serve(async (request) => {
  const secretKey = defaultSecretKey();
  const supplied = request.headers.get("apikey");
  if (!secretKey || supplied !== secretKey) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const summary = { ...createSourceCacheRefreshSummary(), elapsedMs: 0 };
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl)
    return Response.json({ error: "Missing Supabase configuration" }, { status: 500 });
  const supabase = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });

  try {
    const refreshRequest = await requestedNames(request);
    let names = refreshRequest.names;
    if (!names) {
      const { data: follows, error } = await supabase.from("followed_djs").select("name, aliases");
      if (error) throw new Error(`Could not read followed DJs: ${error.message}`);
      names = [
        ...new Set(
          (follows ?? [])
            .flatMap((follow) => [follow.name, ...(follow.aliases ?? [])])
            .map((name) => name.trim().replace(/^Category:/, ""))
            .filter(Boolean),
        ),
      ];
    }
    names.sort((a, b) => a.localeCompare(b));
    if (refreshRequest.shard !== null && refreshRequest.shards !== null) {
      names = names.filter((_, index) => index % refreshRequest.shards! === refreshRequest.shard);
    }

    // Sources are independent. Running them together keeps a small cron shard
    // within its HTTP lifetime while each source still has bounded workers.
    const sources: Source[] = refreshRequest.forceMixesdb ? [] : ["soundcloud", "ra"];
    const repository = {
      read: async (source: Source, cacheNames: string[]) => {
        const { data, error } = await supabase
          .from("source_set_cache")
          .select("dj_name, fetched_at, payload")
          .eq("source", source)
          .in("dj_name", cacheNames);
        if (error) throw new Error(`Could not read ${source} cache: ${error.message}`);
        return data ?? [];
      },
      upsert: async (row: {
        source: Source;
        dj_name: string;
        fetched_at: string;
        payload: unknown;
      }) => {
        const { error } = await supabase
          .from("source_set_cache")
          .upsert(row, { onConflict: "source,dj_name" });
        if (error) throw new Error(error.message);
      },
    };
    const mixesdbRepository = {
      read: async (cacheNames: string[]) => {
        const { data, error } = await supabase
          .from("source_set_cache")
          .select("dj_name, fetched_at, payload, sync_state")
          .eq("source", "mixesdb")
          .in("dj_name", cacheNames);
        if (error) throw new Error(`Could not read mixesdb cache: ${error.message}`);
        return data ?? [];
      },
      publish: async (input: {
        dj: string;
        expectedExists: boolean;
        expectedFetchedAt: string | null;
        payload: unknown;
        syncState: unknown;
        fetchedAt: string;
      }) => {
        const { data, error } = await supabase.rpc("publish_mixesdb_snapshot", {
          p_dj_name: input.dj,
          p_expected_exists: input.expectedExists,
          p_expected_fetched_at: input.expectedFetchedAt,
          p_payload: input.payload,
          p_sync_state: input.syncState,
          p_fetched_at: input.fetchedAt,
        });
        if (error) throw new Error(`Could not publish MixesDB snapshot: ${error.message}`);
        return data === true;
      },
      recordAttempt: async (input: {
        dj: string;
        expectedFetchedAt: string | null;
        syncState: unknown;
      }) => {
        const { data, error } = await supabase.rpc("record_mixesdb_sync_attempt", {
          p_dj_name: input.dj,
          p_expected_fetched_at: input.expectedFetchedAt,
          p_sync_state: input.syncState,
        });
        if (error) throw new Error(`Could not record MixesDB attempt: ${error.message}`);
        return data === true;
      },
    };
    await Promise.all([
      refreshMixesdbCache({
        repository: mixesdbRepository,
        fetchers: {
          enumerate: (dj) => withTimeout(enumerateMixesdbCategory(dj), "mixesdb", dj),
          confirmedEmpty: (dj) => withTimeout(mixesdbCategoryIsConfirmedEmpty(dj), "mixesdb", dj),
          revisions: (pageIds) =>
            withTimeout(fetchMixesdbRevisionMetadata(pageIds), "mixesdb", "metadata"),
          contents: (pageIds) =>
            withTimeout(fetchMixesdbPageContentsResult(pageIds), "mixesdb", "content"),
        },
        names,
        summary,
        freshForMs: FRESH_FOR_MS,
        concurrency: CONCURRENCY,
        force: refreshRequest.forceMixesdb,
        onResult: ({ dj, complete, sets, error }) =>
          console.log("mixesdb history refresh", {
            dj,
            complete,
            sets,
            ...(error ? { error } : {}),
          }),
      }),
      ...sources.map((source) =>
        refreshSourceCache({
          repository,
          source,
          names,
          summary,
          freshForMs: FRESH_FOR_MS,
          concurrency: CONCURRENCY,
          forceMixesdb: refreshRequest.forceMixesdb,
          fetchSource,
          hooks: {
            providerFailed: ({ dj, result, preserved }) =>
              console.error("source-cache provider failed", {
                source,
                dj,
                classification: result.classification,
                error: result.error,
                diagnostics: result.diagnostics,
                preserved,
              }),
            sourceResult: () => undefined,
            preserved: ({ dj, classification }) =>
              console.warn("source-cache preserved prior non-empty payload", {
                source,
                dj,
                classification,
              }),
            refreshFailed: ({ dj, error }) =>
              console.error("source-cache refresh failed", {
                source,
                dj,
                error: error instanceof Error ? error.message : String(error),
              }),
          },
        }),
      ),
    ]);
    summary.elapsedMs = Date.now() - started;
    console.log("source-cache refresh complete", summary);
    return Response.json(summary);
  } catch (error) {
    summary.elapsedMs = Date.now() - started;
    console.error("source-cache refresh aborted", {
      ...summary,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ ...summary, error: "Refresh failed" }, { status: 500 });
  }
});
