type ArtistTrackDisplayState = {
  isSaved: boolean;
  isVisible: boolean;
};

/**
 * Keeps a newly saved track in an Artist-page result list while the list is
 * filtered to new tracks, so its action can change to Saved without moving it.
 */
export function artistTrackDisplayState(
  key: string,
  options: {
    hideOwned: boolean;
    owned: ReadonlySet<string>;
    justSaved: ReadonlySet<string>;
  },
): ArtistTrackDisplayState {
  const isSaved = options.owned.has(key);
  return {
    isSaved,
    isVisible: !options.hideOwned || !isSaved || options.justSaved.has(key),
  };
}
