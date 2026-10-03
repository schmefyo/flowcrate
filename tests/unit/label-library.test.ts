import { describe, expect, it } from "vitest";
import {
  deriveLabelLibrary,
  localArtistFollowState,
  readLibraryPages,
  resolveLocalArtist,
} from "../../src/lib/label-library";

describe("label library connections", () => {
  it("offers a follow for a safe unfollowed whole name, preserving punctuation", () => {
    expect(localArtistFollowState(" Angel D'Lite ", [])).toEqual({
      status: "available",
      name: "Angel D'Lite",
    });
    expect(localArtistFollowState("Ne/Re/A", [])).toEqual({ status: "available", name: "Ne/Re/A" });
  });
  it("shows following for a unique whole-name or explicitly stored alias", () => {
    const followed = [{ name: "D. Tiffany", aliases: ["D.Tiffany"] }];
    expect(localArtistFollowState("d.tiffany", followed)).toEqual({
      status: "followed",
      name: "D. Tiffany",
    });
  });
  it("blocks ambiguous credits, duplicate alias matches, and inferred spelling matches", () => {
    for (const credit of [
      "Powder & Ben UFO",
      "Powder / Ben UFO",
      "Powder b2b Ben UFO",
      "Powder feat. Ben UFO",
      "Unknown",
      "Various Artists",
      "",
    ]) {
      expect(localArtistFollowState(credit, [])).toEqual({ status: "ambiguous", name: null });
    }
    expect(localArtistFollowState("D.Tiffany", [{ name: "D. Tiffany" }]).status).toBe("ambiguous");
    expect(
      localArtistFollowState("D.Tiffany", [
        { name: "One", aliases: ["D.Tiffany"] },
        { name: "Two", aliases: ["D.Tiffany"] },
      ]).status,
    ).toBe("ambiguous");
  });
  it("reads later database pages and rejects incomplete reads after an error", async () => {
    const items = [1, 2, 3, 4, 5];
    expect(
      await readLibraryPages(
        async (from, to) => ({ data: items.slice(from, to + 1), error: null }),
        2,
      ),
    ).toEqual(items);
    await expect(
      readLibraryPages(async () => ({ data: null, error: new Error("Unavailable") })),
    ).rejects.toThrow("Unavailable");
  });
  const tracks = [
    { id: "a", label_id: "label", artist: "Powder" },
    { id: "b", label_id: "label", artist: " powder " },
    { id: "c", label_id: "other", artist: "Someone else" },
    { id: "d", label_id: "label", artist: null },
  ];
  it("scopes tracks and distinct artist counts to the selected label", () => {
    const result = deriveLabelLibrary("label", tracks, [], []);
    expect(result.tracks.map((track) => track.id)).toEqual(["a", "b", "d"]);
    expect(result.artists).toEqual([{ name: "Powder", trackCount: 2 }]);
  });
  it("counts unique label tracks per existing crate and ignores unrelated memberships", () => {
    const result = deriveLabelLibrary(
      "label",
      tracks,
      [
        { crate_id: "crate", track_id: "a" },
        { crate_id: "crate", track_id: "a" },
        { crate_id: "crate", track_id: "b" },
        { crate_id: "other", track_id: "c" },
        { crate_id: "deleted", track_id: "a" },
      ],
      [
        { id: "crate", name: "Warm up" },
        { id: "other", name: "Other" },
      ],
    );
    expect(result.crates).toEqual([{ id: "crate", name: "Warm up", trackCount: 2 }]);
  });
  it("handles labels with no tracks and missing artist metadata", () => {
    expect(deriveLabelLibrary("empty", tracks, [], [])).toEqual({
      tracks: [],
      artists: [],
      crates: [],
    });
    expect(
      deriveLabelLibrary("label", [{ id: "a", label_id: "label", artist: null }], [], []).artists,
    ).toEqual([]);
  });
  it("links only unique whole-name or explicit-alias matches, preserving punctuation", () => {
    const followed = [{ name: "D. Tiffany", aliases: ["D.Tiffany"] }, { name: "Ne/Re/A" }];
    expect(resolveLocalArtist(" d.tiffany ", followed)).toBe("D. Tiffany");
    expect(resolveLocalArtist("Ne/Re/A", followed)).toBe("Ne/Re/A");
    expect(resolveLocalArtist("NeReA", followed)).toBeNull();
    expect(resolveLocalArtist("D.Tiffany & Powder", followed)).toBeNull();
    expect(resolveLocalArtist("Unknown", followed)).toBeNull();
    expect(resolveLocalArtist("", followed)).toBeNull();
    expect(resolveLocalArtist("D.Tiffany", [...followed, { name: "D.Tiffany" }])).toBeNull();
  });
});
