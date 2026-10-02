import { describe, expect, it } from "vitest";
import { allNamesFor } from "../../src/lib/artist-name.ts";

describe("allNamesFor", () => {
  it("preserves slash punctuation for exact external-source names", () => {
    expect(allNamesFor({ name: "Ne/Re/A", aliases: [] })).toEqual(["Ne/Re/A"]);
  });
});
