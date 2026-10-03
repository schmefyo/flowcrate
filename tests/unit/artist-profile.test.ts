import { describe, expect, it } from "vitest";
import {
  artistIdentity,
  artistLabelContext,
  artistSetContext,
  resolveLocalLabel,
} from "../../src/lib/artist-profile";

describe("artist profile identity and local connections", () => {
  it("handles an unfollowed artist with missing optional identity data", () => {
    expect(artistIdentity("Powder")).toEqual({
      aliases: [],
      scenes: [],
      notes: null,
      imageUrl: null,
    });
    expect(artistIdentity("Powder", { aliases: null, scenes: null, notes: " " })).toEqual(
      artistIdentity("Powder"),
    );
  });
  it("deduplicates aliases/scenes without stripping punctuation or display spelling", () => {
    expect(
      artistIdentity("Ne/Re/A", {
        aliases: ["Ne/Re/A", " ne/re/a ", " Nerea ", "NEREA"],
        scenes: [" Berlin ", "berlin"],
        notes: " personal note ",
      }),
    ).toEqual({ aliases: ["NEREA"], scenes: ["berlin"], notes: "personal note", imageUrl: null });
  });
  it("accepts an explicit image asset and otherwise selects the fallback", () => {
    expect(artistIdentity("Powder", { imageUrl: "/artist.jpg" }).imageUrl).toBe("/artist.jpg");
    expect(artistIdentity("Powder", { imageUrl: "https://example.com/artist.jpg" }).imageUrl).toBe(
      "https://example.com/artist.jpg",
    );
    expect(artistIdentity("Powder", { imageUrl: "javascript:invalid" }).imageUrl).toBeNull();
  });
  it("links only unique whole-label matches and rejects guessed/ambiguous identities", () => {
    const labels = [
      { id: "a", name: "Smallville" },
      { id: "b", name: "A/B" },
    ];
    expect(resolveLocalLabel(" smallville ", labels)).toBe("a");
    expect(resolveLocalLabel("AB", labels)).toBeNull();
    expect(resolveLocalLabel("Smallville / Other", labels)).toBeNull();
    expect(resolveLocalLabel("", labels)).toBeNull();
    expect(resolveLocalLabel("Unknown", labels)).toBeNull();
    expect(
      resolveLocalLabel("Smallville", [...labels, { id: "c", name: "SMALLVILLE" }]),
    ).toBeNull();
  });
  it("keeps observed label text separate from explicit saved-track assignments", () => {
    const labels = [
      { id: "a", name: "Local" },
      { id: "b", name: "Assigned" },
    ];
    expect(
      artistLabelContext(
        ["Ne/Re/A", "Nerea"],
        [{ label: "Local" }, { label: " local " }, { label: "Unmatched" }, { label: null }],
        [
          { artist: " ne/re/a ", label_id: "b" },
          { artist: "Nerea", label_id: "b" },
          { artist: "Ne/ReA", label_id: "a" },
          { artist: "Someone else", label_id: "a" },
          { artist: "Nerea", label_id: null },
        ],
        labels,
      ),
    ).toEqual({
      known: [
        { name: "Local", trackCount: 2, labelId: "a" },
        { name: "Unmatched", trackCount: 1, labelId: null },
      ],
      library: [{ name: "Assigned", labelId: "b", trackCount: 2 }],
    });
    expect(artistLabelContext(["Powder"], [], [], [])).toEqual({ known: [], library: [] });
  });
  it("does not link an ambiguous observed label but preserves explicit library IDs", () => {
    const labels = [
      { id: "a", name: "Local" },
      { id: "b", name: "LOCAL" },
    ];
    const result = artistLabelContext(
      ["Powder"],
      [{ label: "Local" }],
      [{ artist: "Powder", label_id: "a" }],
      labels,
    );
    expect(result.known[0]?.labelId).toBeNull();
    expect(result.library[0]?.labelId).toBe("a");
  });
  it("uses title-derived event dates and retains upload/publication provenance", () => {
    expect(
      artistSetContext({ title: "2020-03 - Powder", date: "2026-09-30", source: "mixesdb" }),
    ).toEqual({ source: "MixesDB", date: "2020-03", dateLabel: "Set date" });
    expect(
      artistSetContext({ title: "Undated set", date: "2026-09-30", source: "mixesdb" }).date,
    ).toBeNull();
    expect(
      artistSetContext({ title: "Podcast", date: "2026-09-30T12:00:00Z", source: "soundcloud" }),
    ).toEqual({ source: "SoundCloud", date: "2026-09-30", dateLabel: "Uploaded" });
    expect(artistSetContext({ title: "Podcast", date: "2026-09-30", source: "ra" }).dateLabel).toBe(
      "Published",
    );
    expect(artistSetContext({ title: "Podcast", date: "invalid", source: "ra" }).date).toBeNull();
  });
});
