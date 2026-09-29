/**
 * A provider request either completed (including a legitimate empty result)
 * or failed before its result could be trusted. Cache writers must preserve
 * that distinction so an outage never looks like an empty feed.
 */
export type SourceFetchDiagnostics = {
  categoryMembers?: number;
  categoryPages?: number;
  selectedSets?: number;
  setPagesFetched?: number;
  setPagesFailed?: number;
  setsWithTracklists?: number;
  parsedTracks?: number;
};

export type SourceFetchResult<T> =
  | {
      ok: true;
      data: T[];
      classification: "complete" | "confirmed-empty";
      diagnostics?: SourceFetchDiagnostics;
    }
  | {
      ok: false;
      error: string;
      classification: "failed" | "partial" | "suspicious-empty";
      diagnostics?: SourceFetchDiagnostics;
    };

export function sourceFetchSuccess<T>(
  data: T[],
  options: {
    classification?: "complete" | "confirmed-empty";
    diagnostics?: SourceFetchDiagnostics;
  } = {},
): SourceFetchResult<T> {
  return {
    ok: true,
    data,
    classification: options.classification ?? (data.length ? "complete" : "confirmed-empty"),
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  };
}

export function sourceFetchFailure<T>(
  error: unknown,
  options: {
    classification?: "failed" | "partial" | "suspicious-empty";
    diagnostics?: SourceFetchDiagnostics;
  } = {},
): SourceFetchResult<T> {
  return {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    classification: options.classification ?? "failed",
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
  };
}
