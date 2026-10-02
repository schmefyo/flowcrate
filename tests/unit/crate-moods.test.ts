import { describe, expect, it } from "vitest";
import { crateEditDraft, crateMoods } from "../../src/lib/crate-moods.ts";

describe("crateMoods", () => {
  it("keeps every mood from the new multi-mood crate shape", () => {
    expect(crateMoods({ moods: ["hypnotic", "peak-time"], mood: "hypnotic" })).toEqual([
      "hypnotic",
      "peak-time",
    ]);
  });

  it("preserves a legacy single mood when the new column is missing", () => {
    expect(crateMoods({ mood: "tender" })).toEqual(["tender"]);
  });

  it("handles explicit empty, missing, and null mood values without throwing", () => {
    expect(crateMoods({ moods: [], mood: "legacy value" })).toEqual([]);
    expect(crateMoods({ moods: null, mood: null })).toEqual([]);
    expect(crateMoods(undefined)).toEqual([]);
  });

  it("restores persisted values when an abandoned edit dialog is reopened", () => {
    const persistedCrate = { name: "Late night", moods: ["hypnotic", "warm"] };
    const initialDraft = crateEditDraft(persistedCrate);

    const abandonedDraft = { ...initialDraft, name: "Changed name", moods: ["peak-time"] };
    expect(abandonedDraft).not.toEqual(initialDraft);

    expect(crateEditDraft(persistedCrate)).toEqual({
      name: "Late night",
      moods: ["hypnotic", "warm"],
    });
  });
});
