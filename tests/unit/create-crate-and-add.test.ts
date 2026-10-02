import { describe, expect, it, vi } from "vitest";
import { createCrateAndAddTrack } from "../../src/lib/create-crate-and-add.ts";

describe("createCrateAndAddTrack", () => {
  it("creates the crate and then adds the active track", async () => {
    const createCrate = vi.fn().mockResolvedValue("crate-1");
    const addTrackToCrate = vi.fn().mockResolvedValue(undefined);
    const removeEmptyCrate = vi.fn();

    await expect(
      createCrateAndAddTrack({ createCrate, addTrackToCrate, removeEmptyCrate }),
    ).resolves.toBe("crate-1");

    expect(createCrate).toHaveBeenCalledOnce();
    expect(addTrackToCrate).toHaveBeenCalledWith("crate-1");
    expect(removeEmptyCrate).not.toHaveBeenCalled();
  });

  it("removes a newly created empty crate when linking the track fails", async () => {
    const linkFailure = new Error("Could not add track");
    const createCrate = vi.fn().mockResolvedValue("crate-1");
    const addTrackToCrate = vi.fn().mockRejectedValue(linkFailure);
    const removeEmptyCrate = vi.fn().mockResolvedValue(undefined);

    await expect(
      createCrateAndAddTrack({ createCrate, addTrackToCrate, removeEmptyCrate }),
    ).rejects.toBe(linkFailure);

    expect(removeEmptyCrate).toHaveBeenCalledOnce();
    expect(removeEmptyCrate).toHaveBeenCalledWith("crate-1");
  });
});
