type CreateCrateAndAddOperations = {
  createCrate: () => Promise<string>;
  addTrackToCrate: (crateId: string) => Promise<void>;
  removeEmptyCrate: (crateId: string) => Promise<void>;
};

/**
 * Creates a crate and links the active track as one UI operation. If linking
 * fails, remove the crate that would otherwise be left empty.
 */
export async function createCrateAndAddTrack({
  createCrate,
  addTrackToCrate,
  removeEmptyCrate,
}: CreateCrateAndAddOperations): Promise<string> {
  const crateId = await createCrate();

  try {
    await addTrackToCrate(crateId);
  } catch (error) {
    try {
      await removeEmptyCrate(crateId);
    } catch {
      // The original link failure is the actionable error for the user.
    }
    throw error;
  }

  return crateId;
}
