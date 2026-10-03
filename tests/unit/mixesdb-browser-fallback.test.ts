import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupMixCountsWithFallback,
  lookupMixesWithFallback,
} from "../../src/lib/mixesdb-browser-fallback.ts";

const request = { data: { artist: "Robert Hood", title: "Lockers" } };
const response = (total = 49) =>
  Response.json({
    query: {
      searchinfo: { totalhits: total },
      search: total ? [{ title: "A set", snippet: "<b>Track</b>" }] : [],
    },
  });
const failedServer = vi.fn(async () => {
  throw new Error("Server rejected");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MixesDB supported browser fallback", () => {
  it("preserves server success without a duplicate provider request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = { hits: [], total: 0, searchUrl: "search" };
    expect(await lookupMixesWithFallback(request, async () => result)).toBe(result);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recovers a rejected server lookup through the public CORS API without credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    const result = await lookupMixesWithFallback(request, failedServer);
    expect(result.total).toBe(49);
    expect(result.hits[0]?.snippet).toBe("Track");
    expect(result.searchUrl).toContain("Robert%20Hood%20Lockers");
    const [url, options] = fetch.mock.calls[0]!;
    expect(new URL(url).searchParams.get("origin")).toBe("*");
    expect(new URL(url).searchParams.get("srlimit")).toBe("12");
    expect(options.credentials).toBe("omit");
    expect(options.headers).toEqual({ accept: "application/json" });
  });

  it("keeps successful counts and retries only failed/missing counts, including real zero", async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(response(0)));
    vi.stubGlobal("fetch", fetch);
    const items = ["known", "failed", "missing"].map((key) => ({ key, ...request.data }));
    const result = await lookupMixCountsWithFallback({ data: { items } }, async () => [
      { key: "known", total: 12, ok: true },
      { key: "failed", total: null, ok: false },
    ]);
    expect(result).toEqual([
      { key: "known", total: 12, ok: true },
      { key: "failed", total: 0, ok: true },
      { key: "missing", total: 0, ok: true },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get("srlimit")).toBe("1");
  });

  it("does not convert malformed/provider failure into zero and stops after two attempts", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(Response.json({ error: { code: "blocked" } })));
    vi.stubGlobal("fetch", fetch);
    const result = await lookupMixCountsWithFallback(
      { data: { items: [{ key: "track", ...request.data }] } },
      failedServer,
    );
    expect(result).toEqual([{ key: "track", total: null, ok: false }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("bounds browser count concurrency to four and retains input order", async () => {
    let active = 0;
    let maximum = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        maximum = Math.max(maximum, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return response();
      }),
    );
    const items = Array.from({ length: 9 }, (_, i) => ({ key: String(i), ...request.data }));
    const result = await lookupMixCountsWithFallback({ data: { items } }, failedServer);
    expect(maximum).toBe(4);
    expect(result.map((item) => item.key)).toEqual(items.map((item) => item.key));
  });
});
