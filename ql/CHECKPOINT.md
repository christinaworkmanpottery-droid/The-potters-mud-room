# QL Phase 1E — resumable checkpoint

September 29, 2026. Phase 1E complete on `ql/phase-1-relationships`. Nothing deployed; production unchanged.

## Phase 1D verification gate

The exact Phase 1D checkpoint was verified before Phase 1E. GitHub Actions exposed two genuine blockers that had not been visible in the prior checkpoint:
- The new corrupt-junction test fixture dropped INSERT triggers but not UPDATE triggers, so its intentional stale-row mutation was correctly blocked. Test-only repair: `a8a6566`.
- The Firing detail serializer had one Piece join without the same-owner predicate already used by Firing list reads. Repair: `e202d7e`.

After those repairs, `node ql/verify-phase1.cjs` passed cleanly in GitHub Actions. Phase 1D is confirmed at **195 passing executions** (Phase 1C's 168 + 27 Phase 1D executions: 26 relationship-safety API checks across legacy/QL modes + 1 corrupt-junction reader test).

## Centralized service

`ql/relationships.cjs` is now the single service boundary for Piece↔Firing, Piece↔Test Tile and Piece↔Pricing:
- same-owner Piece/target validation;
- idempotent create;
- owner-scoped remove with target validation;
- safe list/read;
- immediate SQLite transaction handling for mutations;
- generic unavailable-record errors that do not distinguish missing from foreign IDs;
- legacy Firing read-through merged with explicit QL links;
- stale/foreign QL junction targets filtered by owner-scoped joins.

Existing exported `link`/`unlink` behavior now uses the same validation/transaction path. No Phase 1B–1D deletion or file lifecycle behavior was replaced.

## Authenticated relationship API

Added only these authenticated routes:
- `GET|POST /api/ql/pieces/:pieceId/firings`
- `DELETE /api/ql/pieces/:pieceId/firings/:targetId`
- `GET|POST /api/ql/pieces/:pieceId/test-tiles`
- `DELETE /api/ql/pieces/:pieceId/test-tiles/:targetId`
- `GET|POST /api/ql/pieces/:pieceId/pricing`
- `DELETE /api/ql/pieces/:pieceId/pricing/:targetId`

POST bodies accept only the related-record ID (`firingId`, `testTileId`, or `pricingId`). Authorization always uses `req.userId` from authentication; client-supplied user/account/owner IDs are ignored. Missing and foreign records return the same 404 shape. QL relationship tables not installed return 409. Unexpected transactional failures return a generic 500 without record ownership detail.

## Safe reads and compatibility

Reads require an owned Piece, scope expanded targets to the same owner, filter corrupt/stale explicit junctions, and never expand another account's target. Firing lists preserve the legacy direct `firing_logs.piece_id` read-through and deduplicate it against explicit QL links. Existing manual Piece/Test Tile data remains untouched. Existing website/mobile API URLs and response contracts were not changed.

## Schema / migration / production boundary

No schema migration, table change, backfill, dependency change, UI, mobile, Esme/AI, voice, search, redesign, deployment, Render change, or production-data access. Phase 1A remains the only QL relationship migration and remains opt-in.

## Verification

Added `tests/ql-relationship-service-api.cjs` with 9 focused checks covering:
- unauthenticated access;
- create/read/remove for all three relationship types;
- duplicate/idempotent create;
- invalid and foreign IDs;
- cross-account Piece reads;
- ownership spoofing;
- stale/foreign target filtering;
- rollback on injected mutation failure;
- legacy Firing read-through.

The complete `node ql/verify-phase1.cjs` suite passed after implementation. **204 passing executions total** (195 verified Phase 1D + 9 Phase 1E). All prior Phase 1A–1D regression suites remain wired and passing.

## Newly discovered risks

- QL relationship API mutation is intentionally unavailable until the existing Phase 1A relationship tables are installed; this preserves the opt-in/no-startup-migration boundary.
- Legacy Firing direct links and explicit QL links can coexist; reads deduplicate them, but later write UX must define when an old-client `piece_id` edit should also create/remove an explicit link rather than silently changing semantics.
- The service currently exposes Piece-centered reads only. Reverse record-centered relationship APIs are deliberately not added yet.
- GitHub Actions warns that checkout/setup-node v4 actions are being forced from deprecated Node 20 action runtime to Node 24; application verification itself runs Node 22 as configured.

## Exact recommended Phase 1F task — not started

**Phase 1F — Define and verify relationship synchronization/compatibility rules between legacy direct links and the new explicit QL Piece relationships, without adding UI.** Focus on Firing↔Piece first: audit old-client create/edit/remove behavior versus explicit QL links, define one deterministic compatibility policy, centralize any synchronization in the relationship service, prevent duplicate/divergent meaning, preserve historical legacy records, add API/rollback/cross-account tests, and run the full Phase 1 verifier. Do not add reverse APIs, connected-studio UI, Esme/AI, voice, search, redesign, or deployment unless required by that compatibility policy.
