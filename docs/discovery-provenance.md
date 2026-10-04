# Discovery provenance

Apply `20261004000000_add_track_discovery_provenance.sql` **before** deploying the application changes. No migration, refresh, or backfill is automatically invoked by the app.

The additive migration leaves existing tracks and notes untouched. It adds an authenticated, RLS-protected `track_discovery_sources` table and `save_discovered_track` RPC. Saves are atomic: an exact case-insensitive artist/title match reuses an existing user-owned track; otherwise a new track is created. Sources are appended, not replaced. An advisory transaction lock serializes concurrent source-derived saves of the same track; a unique index prevents repeated track/provider/URL/DJ relationships. Existing duplicate library tracks are not merged (the earliest matching row is reused).

Records contain the saved track ID, source provider, source URL, set title, optional DJ name, optional title-derived event date, and first-capture timestamp. `capture_kind = saved-result-context` means the record came from the source context of a result the user saved. It is **not** proof the user listened to every listed set, nor a complete source appearance history. Dates may be partial dates expanded by the existing title-date helper; upload and category-membership dates are not substituted for performance dates.

Discover and Artist aggregation retain source relationships independently of their capped visible example lists. Existing scan/window/deduplication rules still determine which sets contribute. A save captures the current result's contributing sources. Saving context again adds missing relationships without rewriting the track or previous discovery history. Artist `New only` still hides previously owned results; switch to Showing all to attach context to older saved tracks.

Crate Matches preserves contributing set URLs/titles without guessing DJs from titles. Records without a reliable DJ do not create Discovered from options. Radar and the set/mix dialogs currently have no save action; ordinary manual/link/import saves do not invent set provenance.

The Tracks filter uses recorded DJ names, exact case-insensitive whole-name/explicit-alias matching only when uniquely resolved, and OR semantics. It combines with existing search/mood/sorting before the 50-row display batches. Unknown or ambiguous names are kept separate. Unclassified tracks remain visible when no provenance filter is selected.

There is no automatic historical backfill: existing Played by notes and mix_name text do not identify reliable track/set/DJ relationships. Source-cache membership alone establishes an appearance, not historical save origin. Older tracks can acquire context when explicitly encountered and saved again.

Before release: run typecheck, tests, build, and diff checks; apply/verify the migration; deploy the app; smoke-test a new source save, a second-source save, repeated save, and single/multi-artist filtering. Vitest covers aggregation, RPC contract, filtering, and schema safeguards without a new browser framework.

For database behavior, run `psql -v ON_ERROR_STOP=1 -f tests/sql/discovery-provenance.sql` against a **disposable, empty local database** as its owner. The fixture creates minimal auth/track test scaffolding, applies the real migration, verifies legacy preservation, new/existing saves, two-DJ retention, duplicate prevention, transaction rollback, and cross-user isolation, then rolls back. Do not run this fixture against production. These checks were also verified in isolated local PostgreSQL during implementation.
