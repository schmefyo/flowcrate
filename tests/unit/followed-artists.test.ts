import { describe, expect, it } from "vitest";
import { eligibleFollowedArtists } from "../../src/lib/followed-artists.ts";

describe("eligibleFollowedArtists", () => {
  it("keeps every followed artist eligible, including legacy on_radar=false rows", () => {
    const artists = [
      { name: "Included before", on_radar: true },
      { name: "Legacy excluded row", on_radar: false },
    ];

    expect(eligibleFollowedArtists(artists)).toEqual(artists);
  });
});
