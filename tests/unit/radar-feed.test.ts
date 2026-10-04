import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({
  mixesdb: vi.fn(),
  soundcloud: vi.fn(),
  ra: vi.fn(),
}));

vi.mock("../../src/lib/source-cache.server.ts", () => ({
  cachedMixesdbSets: cache.mixesdb,
  cachedSoundcloudSets: cache.soundcloud,
  cachedRaSets: cache.ra,
}));

import { radarFeed } from "../../src/lib/radar.server.ts";

describe("Discover full-history radar feed", () => {
  beforeEach(() => {
    cache.soundcloud.mockResolvedValue([]);
    cache.ra.mockResolvedValue([]);
  });

  it("retains per-set/DJ provenance beyond visible examples and preserves both DJs", async () => {
    cache.mixesdb.mockResolvedValue(
      Array.from({ length: 14 }, (_, index) => ({
        dj: index % 2 ? "Octo Octa" : "Eris Drew",
        title: `2026-01-${String(index + 1).padStart(2, "0")} - Set`,
        url: `https://example.test/${index}`,
        date: null,
        tracks: [{ artist: "Track Artist", title: "Track", label: null }],
      })),
    );
    const track = (await radarFeed(["Eris Drew", "Octo Octa"], 0, 0)).tracks[0]!;
    expect(track.sets).toHaveLength(12);
    expect(track.discoverySources).toHaveLength(14);
    expect(new Set(track.discoverySources?.map((s) => s.dj_name))).toEqual(
      new Set(["Eris Drew", "Octo Octa"]),
    );
  });

  it("uses every cached set after selected artists are merged", async () => {
    const ben = Array.from({ length: 401 }, (_, index) => ({
      dj: "Ben UFO",
      title: `${2000 + index}-01-01 - Ben UFO ${index}`,
      url: `https://example.test/${index}`,
      date: null,
      tracks: [{ artist: "Artist", title: `Track ${index}`, label: null }],
    }));
    const avalon = {
      dj: "Avalon Emerson",
      title: "2500-01-01 - Avalon Emerson",
      url: "https://example.test/avalon",
      date: null,
      tracks: [{ artist: "Artist", title: "Avalon track", label: null }],
    };
    cache.mixesdb.mockImplementation(async (names: string[]) =>
      names.flatMap((name) =>
        name === "Ben UFO" ? ben : name === "Avalon Emerson" ? [avalon] : [],
      ),
    );

    const withAvalon = await radarFeed(["Ben UFO", "Avalon Emerson"], 0, 0);
    const withoutAvalon = await radarFeed(["Ben UFO"], 0, 0);

    expect(withAvalon.setsScanned).toBe(402);
    expect(withoutAvalon.setsScanned).toBe(401);
  });
});
