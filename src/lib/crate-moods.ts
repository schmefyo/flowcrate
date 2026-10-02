type CrateMoodSource = {
  mood?: string | null;
  moods?: string[] | null;
};

type CrateEditDraftSource = CrateMoodSource & {
  name: string;
};

/**
 * Normalizes both the new multi-mood column and rows returned before that
 * additive migration has run. An explicit empty array remains empty.
 */
export function crateMoods(crate: CrateMoodSource | null | undefined): string[] {
  if (Array.isArray(crate?.moods)) return crate.moods.filter(Boolean);
  return crate?.mood ? [crate.mood] : [];
}

/** Creates a fresh edit-dialog draft from the values currently saved for a crate. */
export function crateEditDraft(crate: CrateEditDraftSource) {
  return { name: crate.name, moods: crateMoods(crate) };
}
