/** Every followed artist participates in the shared discovery surfaces.
 *
 * `on_radar` remains in the database for legacy compatibility, but is no
 * longer an eligibility preference.
 */
export function eligibleFollowedArtists<T>(artists: T[] | null | undefined): T[] {
  return artists ?? [];
}
