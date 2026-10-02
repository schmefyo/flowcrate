import { describe, expect, it } from "vitest";
import { artistTrackDisplayState } from "../../src/lib/artist-track-state.ts";

describe("artistTrackDisplayState", () => {
  it("keeps a newly saved track visible in New only while marking it Saved", () => {
    const state = artistTrackDisplayState("artist|||track", {
      hideOwned: true,
      owned: new Set(["artist|||track"]),
      justSaved: new Set(["artist|||track"]),
    });

    expect(state).toEqual({ isSaved: true, isVisible: true });
  });

  it("continues to hide previously owned tracks in New only", () => {
    const state = artistTrackDisplayState("artist|||track", {
      hideOwned: true,
      owned: new Set(["artist|||track"]),
      justSaved: new Set<string>(),
    });

    expect(state).toEqual({ isSaved: true, isVisible: false });
  });
});
