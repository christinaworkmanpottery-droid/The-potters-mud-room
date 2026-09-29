# QL Phase 1D — resumable checkpoint

September 29, 2026. Phase 1D implementation is saved on `ql/phase-1-relationships`. Nothing has been deployed; production remains unchanged.

## Changed

- Added owner-scoped relationship validation to legacy/current API writes before saving client-supplied IDs.
- Piece create/edit now validates Clay and Glaze library IDs against the authenticated account while preserving manual/custom glaze layers.
- Firing create/edit validates legacy Piece links.
- Test Tile create/edit validates Clay and Glaze links.
- Glaze embedded clay-test creation validates a supplied Clay ID instead of silently converting a foreign/invalid ID into a manual relationship.
- Piece and Firing photo upload/read paths validate the parent record belongs to the authenticated account.
- Sales already validated Piece ownership on writes; its relationship reads are now owner-scoped.

## Safe reads / compatibility

- Piece, dashboard, casualty, Firing, Sales and Test Tile relationship joins now require matching owners before expanding related records.
- Foreign/stale related IDs do not expose another account's Clay, Glaze, Piece or Firing data.
- Missing related records remain nullable so otherwise valid legacy/manual records load.
- Manual Piece glaze fallback (`custom_name`) remains available when the library Glaze is missing/deleted.
- QL internal readers continue to filter junctions by relationship owner and endpoint owner; focused corrupt-junction coverage was added.
- Existing QL same-owner triggers/helpers remain unchanged and continue protecting Piece↔Firing, Piece↔Test Tile and Piece↔Pricing junctions.

## Account deletion / files

- Account deletion preflight now covers Piece↔Clay, Piece↔Glaze, Test Tile↔Clay/Glaze, Firing↔Piece, Sale↔Piece, embedded Glaze↔Clay tests, and installed QL junctions.
- Cross-account or stale relationship corruption rejects account deletion with 409 before mutations.
- Self-service and admin deletion remain immediate SQLite transactions; SQL failure rolls back the database.
- Phase 1 child photo metadata and Test Tiles are explicitly cleaned with the account.
- Candidate account files are collected before the transaction commits and physically removed only after commit.
- Global stored-file references are rechecked before unlink, so another surviving reference preserves the file; cleanup failure can leave an unused file but cannot roll back/corrupt committed DB state.

## Schema / production boundary

No Phase 1D schema migration, table change, backfill, dependency change, QL activation, production merge, Render deployment, mobile build, or production-data access.

## Tests added

- Added `tests/ql-relationship-safety-api.cjs`, executed by the Phase 1 verifier in legacy and opt-in QL modes.
- Added corrupt/stale QL junction safe-read coverage to `tests/ql-relationships.cjs`.
- Coverage includes same-account creation, cross-account Piece↔Clay/Glaze/Test Tile/Firing attempts, photo-parent attempts, legacy glaze-clay writes, stale/missing reads, safe serializers, valid account deletion, corrupt-account rollback, shared-file preservation, and all prior Phase 1A–1C suites through `ql/verify-phase1.cjs`.
- A branch-only GitHub Actions verifier was added, but GitHub reported no workflow run/status for the branch in this environment. Therefore the new 1D suite has **not been represented as passed** here. The last fully executed checkpoint remains Phase 1C's 168 passing tests. Before starting Phase 1E, run `node ql/verify-phase1.cjs` in the normal repository environment and require exit 0.

## Newly discovered risks

- The repository has no observable GitHub Actions run/status on this branch, so connector-only work cannot certify the Node regression suite.
- SQLite and filesystem commits cannot be atomic; the established policy intentionally favors a harmless unused file over a broken live reference.
- File-reference registry maintenance remains required when future file-bearing columns are introduced.
- Pre-existing non-Phase-1 account/file domains remain outside this relationship-safety chunk.

## Exact recommended Phase 1E task — not started

**Phase 1E — Centralize relationship mutation/read services and expose the minimum authenticated QL relationship API without changing existing client behavior.** Consolidate the now-verified owner-scoped validators/readers so Piece↔Firing, Piece↔Test Tile and Piece↔Pricing links use one service boundary; add authenticated add/remove/list endpoints only where needed for later connected-studio work; preserve legacy fields/read-through/manual fallbacks; keep QL optional and production behavior unchanged; add idempotency, stale-link and rollback tests. Do not begin higher-level connected-studio UI, AI/Esme, search, provenance UX, or deployment in that chunk.
