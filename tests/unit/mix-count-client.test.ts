import { describe, expect, it } from "vitest";
import {
  mixCountRequest,
  mixCountSuffix,
  shouldRequestMixCount,
} from "../../src/lib/mix-count-client.ts";
import type { MixCount } from "../../src/lib/mix-count.server.ts";

const tracks = Array.from({ length: 75 }, (_, index) => ({
  id: `track-${index + 1}`,
  artist: `Artist ${index + 1}`,
  title: `Track ${index + 1}`,
}));

describe("Tracks MixesDB count contract", () => {
  it("serializes the initial loaded batch in the server function's items envelope", () => {
    expect(mixCountRequest(tracks.slice(0, 50))).toEqual({
      items: tracks.slice(0, 50).map(({ id, artist, title }) => ({ key: id, artist, title })),
    });
  });

  it("keeps later infinite-scroll tracks eligible for the same request contract", () => {
    expect(mixCountRequest(tracks.slice(50))).toEqual({
      items: tracks.slice(50).map(({ id, artist, title }) => ({ key: id, artist, title })),
    });
  });

  it("uses that same contract for the full filtered set behind Most mixes", () => {
    expect(mixCountRequest(tracks).items).toHaveLength(75);
    expect(mixCountRequest(tracks).items[74]).toEqual({
      key: "track-75",
      artist: "Artist 75",
      title: "Track 75",
    });
  });

  it("renders successful nonzero and zero totals without turning an unresolved result into zero", () => {
    const failed: MixCount = { key: "track-1", ok: false, total: null };
    expect(mixCountSuffix(12)).toBe("(12)");
    expect(mixCountSuffix(0)).toBe("(0)");
    expect(mixCountSuffix(failed.ok ? failed.total : undefined)).toBeNull();
  });

  it("does not reschedule resolved counts during a rerender", () => {
    expect(shouldRequestMixCount(undefined)).toBe(true);
    expect(shouldRequestMixCount("pending")).toBe(false);
    expect(shouldRequestMixCount("ok")).toBe(false);
    expect(shouldRequestMixCount("failed")).toBe(false);
    expect(shouldRequestMixCount("failed", true)).toBe(true);
  });
});
