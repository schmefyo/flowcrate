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

import { radarSets } from "../../src/lib/radar.server.ts";

describe("normal Radar set reads", () => {
  beforeEach(() => {
    cache.mixesdb.mockResolvedValue([]);
    cache.soundcloud.mockResolvedValue([]);
    cache.ra.mockResolvedValue([]);
  });

  it("uses source_set_cache readers without enabling their live missing-row fallback", async () => {
    await expect(radarSets(["Aurora Halal"])).resolves.toEqual([]);
    expect(cache.mixesdb).toHaveBeenCalledWith(["Aurora Halal"], false);
    expect(cache.soundcloud).toHaveBeenCalledWith(["Aurora Halal"], false);
    expect(cache.ra).toHaveBeenCalledWith(["Aurora Halal"], false);
  });
});
