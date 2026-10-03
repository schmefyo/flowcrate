export type MixHit = {
  title: string;
  url: string;
  snippet: string;
};

const API = "https://www.mixesdb.com/w/api.php";
const REQUEST_TIMEOUT_MS = 8_000;

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Search MixesDB tracklists for a given artist + title. */
export async function findMixesForTrack(
  artist: string,
  title: string,
): Promise<{ hits: MixHit[]; total: number; searchUrl: string }> {
  const clean = (s: string) =>
    s
      .replace(/\(.*?\)|\[.*?\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const query = `${clean(artist)} ${clean(title)}`.trim();
  const searchUrl = `https://www.mixesdb.com/w/index.php?search=${encodeURIComponent(query)}`;
  if (!query) return { hits: [], total: 0, searchUrl };

  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "12",
    srnamespace: "0",
    format: "json",
    origin: "*",
  });

  let json: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now();
    let stage = "fetch";
    let status: number | null = null;
    let responseType = "unknown";
    try {
      const res = await fetch(`${API}?${params.toString()}`, {
        headers: {
          accept: "application/json",
          "user-agent": "FlowCrate/1.0 (track lookup)",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = res.status;
      const contentType = res.headers.get("content-type") ?? "";
      responseType = contentType.includes("json")
        ? "json"
        : contentType.includes("html")
          ? "html"
          : "other";
      stage = "http";
      if (!res.ok) throw new Error(`MixesDB returned ${res.status}`);
      stage = "json";
      json = (await res.json()) as Record<string, any>;
      break;
    } catch (error) {
      // Deliberately omit query, URLs, response bodies, and raw error messages.
      const errorName = error instanceof Error ? error.name : "UnknownError";
      const failure =
        errorName === "TimeoutError" || errorName === "AbortError"
          ? "timeout"
          : stage === "http"
            ? "http"
            : stage === "json"
              ? "invalid-json"
              : "network";
      console.warn("[mixesdb-track-search] request failed", {
        attempt: attempt + 1,
        failure,
        status,
        responseType,
        durationMs: Date.now() - startedAt,
        willRetry: attempt === 0,
      });
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!json) throw new Error("MixesDB didn't answer — try again in a moment");

  const results = Array.isArray(json?.["query"]?.["search"]) ? json["query"]["search"] : [];
  const total = Number(json?.["query"]?.["searchinfo"]?.["totalhits"] ?? results.length);

  const hits: MixHit[] = results.map((r: any) => ({
    title: String(r?.title ?? ""),
    url: `https://www.mixesdb.com/w/${encodeURIComponent(String(r?.title ?? "").replace(/ /g, "_"))}`,
    snippet: stripHtml(String(r?.snippet ?? "")),
  }));

  return { hits, total, searchUrl };
}
