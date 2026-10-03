import { afterEach, describe, expect, it, vi } from "vitest";
import { findMixesForTrack } from "../../src/lib/mixesdb.server.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("live mix-search failure diagnostics", () => {
  it("reports HTTP rejection and bounded retries without logging search or response content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(
      new Response("private response body", {
        status: 403,
        headers: { "content-type": "text/html" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(findMixesForTrack("Private Artist", "Private Title")).rejects.toThrow(
      "MixesDB didn't answer",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][1]).toMatchObject({
      attempt: 1,
      failure: "http",
      status: 403,
      responseType: "html",
      willRetry: true,
    });
    expect(warn.mock.calls[1][1]).toMatchObject({ attempt: 2, willRetry: false });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Private|private/);
  });

  it.each([
    ["timeout", () => Promise.reject(new DOMException("sensitive URL", "TimeoutError"))],
    ["network", () => Promise.reject(new TypeError("sensitive URL"))],
    ["invalid-json", () => Promise.resolve(new Response("not JSON"))],
  ])("distinguishes %s failures without exposing raw errors", async (failure, response) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockImplementation(response));

    await expect(findMixesForTrack("Artist", "Title")).rejects.toThrow();
    expect(warn.mock.calls[0][1]).toMatchObject({ failure });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("sensitive URL");
  });

  it("preserves successful results without failure logging", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          query: { searchinfo: { totalhits: 1 }, search: [{ title: "A set", snippet: "A track" }] },
        }),
      ),
    );
    const result = await findMixesForTrack("Artist", "Title");
    expect(result.total).toBe(1);
    expect(result.hits).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
