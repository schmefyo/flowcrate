import { describe, expect, it } from "vitest";
import {
  discoverySources,
  discoveryFilterIndex,
  matchesDiscoveryFilter,
} from "../../src/lib/discovery-provenance.ts";
import { djFeedFromSets } from "../../src/lib/discover.server.ts";

const set = (dj: string, url = "https://example.test/a", title = "2026-01-02 - Set") => ({
  dj,
  url,
  title,
  source: "mixesdb" as const,
});

describe("discovery context and Tracks filtering", () => {
  it("retains multiple DJs and sets but removes identical relationships", () => {
    const sources = discoverySources([
      set("Eris Drew"),
      set("Octo Octa", "https://example.test/b"),
      set("Eris Drew"),
    ]);
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.dj_name)).toEqual(["Eris Drew", "Octo Octa"]);
    expect(sources[0]?.set_date).toBe("2026-01-02");
  });

  it("uses only uniquely matched whole names/explicit aliases without stripping punctuation", () => {
    const followed = [
      { name: "D. Tiffany", aliases: ["D.Tiffany"] },
      { name: "Ne/Re/A", aliases: [] },
    ];
    expect(
      discoverySources([set("D.Tiffany"), set("Ne/Re/A")], followed).map((s) => s.dj_name),
    ).toEqual(["D. Tiffany", "Ne/Re/A"]);
    expect(discoverySources([set("D Tiffany")], followed)[0]?.dj_name).toBe("D Tiffany");
    const ambiguous = [
      { name: "One", aliases: ["Shared"] },
      { name: "Two", aliases: ["Shared"] },
    ];
    expect(discoverySources([set("Shared")], ambiguous)[0]?.dj_name).toBe("Shared");
  });

  it("does not invent dates or DJs for undated source sets", () => {
    const sources = discoverySources([
      { title: "Radio show", url: "https://example.test", source: "soundcloud" },
    ]);
    expect(sources[0]).toMatchObject({ set_date: null, dj_name: null });
    expect(discoveryFilterIndex(sources.map((s) => ({ ...s, track_id: "track" }))).size).toBe(0);
  });

  it("filters by one DJ or multiple DJs with OR, not by the track artist", () => {
    const records = [
      { ...discoverySources([set("Eris Drew")])[0]!, track_id: "one" },
      { ...discoverySources([set("Octo Octa")])[0]!, track_id: "two" },
    ];
    const index = discoveryFilterIndex(records);
    expect(matchesDiscoveryFilter("one", ["Eris Drew"], index)).toBe(true);
    expect(matchesDiscoveryFilter("two", ["Eris Drew"], index)).toBe(false);
    expect(matchesDiscoveryFilter("two", ["Eris Drew", "Octo Octa"], index)).toBe(true);
    expect(matchesDiscoveryFilter("unclassified", [], index)).toBe(true);
    expect(matchesDiscoveryFilter("unclassified", ["Eris Drew"], index)).toBe(false);
  });

  it("merges safe recorded aliases for filtering without merging ambiguous identities", () => {
    const records = ["D.Tiffany", "D. Tiffany"].map((dj, i) => ({
      ...discoverySources([set(dj)])[0]!,
      track_id: String(i),
    }));
    const index = discoveryFilterIndex(records, [{ name: "D. Tiffany", aliases: ["D.Tiffany"] }]);
    expect([...index.keys()]).toEqual(["D. Tiffany"]);
    expect([...index.get("D. Tiffany")!]).toEqual(["0", "1"]);
  });

  it("keeps Artist provenance beyond the six visible set examples without changing aggregation", () => {
    const sets = Array.from({ length: 14 }, (_, i) => ({
      ...set(
        "Eris Drew",
        `https://example.test/${i}`,
        `2026-01-${String(i + 1).padStart(2, "0")} - Set`,
      ),
      date: null,
      tracks: [{ artist: "Track Artist", title: "Track", label: null }],
    }));
    const track = djFeedFromSets("Eris Drew", 0, [], sets).tracks[0]!;
    expect(track.plays).toBe(14);
    expect(track.sets).toHaveLength(6);
    expect(track.discoverySources).toHaveLength(14);
    expect(track.discoverySources?.every((s) => s.dj_name === "Eris Drew")).toBe(true);
  });
});
