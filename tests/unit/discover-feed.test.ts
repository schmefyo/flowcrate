import { describe, expect, it } from "vitest";
import { djFeedFromSets } from "../../src/lib/discover.server.ts";

describe("cached artist feed aggregation", () => {
  it("keeps D. Tiffany aliases and de-duplicates an identical set", () => {
    const feed = djFeedFromSets(
      "D. Tiffany",
      20,
      ["D.Tiffany"],
      [
        {
          title: "2024-02-02 - D. Tiffany",
          url: "https://example.test/one",
          dj: "D. Tiffany",
          date: "2024-02-02",
          tracks: [{ artist: "Artist", title: "Track", label: "Label" }],
        },
        {
          title: "2024-02-02 - D. Tiffany",
          url: "https://example.test/duplicate",
          dj: "D.Tiffany",
          date: "2024-02-02",
          tracks: [{ artist: "Artist", title: "Track", label: "Label" }],
        },
        {
          title: "2024-01-01 - D.Tiffany",
          url: "https://example.test/two",
          dj: "D.Tiffany",
          date: "2024-01-01",
          tracks: [{ artist: "Artist", title: "Track", label: null }],
        },
      ],
    );

    expect(feed.setsFound).toBe(2);
    expect(feed.setsScanned).toBe(2);
    expect(feed.tracks).toEqual([
      expect.objectContaining({ artist: "Artist", title: "Track", plays: 2 }),
    ]);
  });

  it("represents a successful zero-tracklist history without inventing tracks", () => {
    const feed = djFeedFromSets(
      "Ne/Re/A",
      20,
      [],
      [
        {
          title: "2023-06-01 - Ne/Re/A",
          url: "https://example.test",
          dj: "Ne/Re/A",
          date: "2023-06-01",
          tracks: [],
        },
      ],
    );
    expect(feed.setsFound).toBe(1);
    expect(feed.setsScanned).toBe(0);
    expect(feed.tracks).toEqual([]);
  });

  it("uses the complete cached history when the Artist page selects all history", () => {
    const sets = Array.from({ length: 201 }, (_, index) => ({
      title: `2024-01-${String((index % 28) + 1).padStart(2, "0")} - Ben UFO ${index}`,
      url: `https://example.test/${index}`,
      dj: "Ben UFO",
      date: `2024-01-${String((index % 28) + 1).padStart(2, "0")}`,
      tracks: [{ artist: "Artist", title: `Track ${index}`, label: null }],
    }));

    const feed = djFeedFromSets("Ben UFO", 0, [], sets);

    expect(feed.setsFound).toBe(201);
    expect(feed.setsScanned).toBe(201);
    expect(feed.tracks).toHaveLength(201);
  });
});
