# Phase 1A relationship contract — September 29, 2026

Phase 1B/1C lifecycle update: see `CHECKPOINT.md`. The schema/helper contract below remains intact;
the final Phase 1B proposal below is historical and has now been completed. Piece deletion retains
all firing history, including legacy and last-association firings. Clay/Glaze/Tile deletion now
preserves independent history, detaches same-owner references and checks shared files after commit.
Glaze layers survive as manual entries; see the current checkpoint for old-schema rejection. Runtime deletion guards are now
wired on the isolated branch only; migrations remain explicitly opt-in and nothing is deployed.

Website baseline: `70c852d366e5ef193a1b3d882964e85628afa800`. Reviewed mobile QL tree
`6bbc77a2f33790b44029778ba4f4b39e641c1806`, checkpoint, SQLite cache and sync service.
No application runtime or mobile source changes in this chunk.

## Existing data review

| Domain | Existing structure | Minimum evolution |
| --- | --- | --- |
| Pieces | `pieces.id`, owner, nullable `clay_body_id` | Reuse IDs exactly, including historical non-UUID IDs. |
| Clay | `clay_bodies.id`, owner, clay photos | Keep existing nullable Piece link and typed historical descriptions. Same-owner joins. |
| Glazes | `glazes.id`; ordered `piece_glazes.id` with optional glaze ID/custom name | Preserve layers, coats, notes and ordering. No duplicate junction or name-based linking. |
| Raw Materials | `glaze_chemicals.id`, owner; `glaze_ingredients.id` belongs to glaze | Preserve names/amounts/units. Future explicit ingredient-to-material link must derive owner from glaze and validate inventory owner. No matching/backfill here. |
| Test information | Owner-scoped `test_tiles.id`; separate `glaze_clay_tests.id` inherits glaze owner | Add Piece-to-Test Tile link. Do not conflate test systems. Tile-to-firing and glaze-clay test links deferred. |
| Firings | `firing_logs.id`, owner, optional single `piece_id`, load text | Add explicit multi-piece junction. Read legacy Piece link directly; never infer links from load text. |
| Photos | Piece/clay/glaze/firing photo tables with IDs; inline slots on tiles/tests/pricing/sales | Preserve IDs, filenames, slots and ordering. Inline identity is `(table, record ID, column)`. Filename does not establish ownership. No copying/renaming/deleting files. |
| Pricing | `pricing_calculations.id`, owner, input/result JSON, photo | Add explicit Piece-to-Pricing junction. Multiple estimates allowed; none implicitly accepted/latest. |
| Sales | `sales.id`, owner, optional Piece, quantity/unit price, photo, contact ID | Reuse existing history. No forced Piece for quick sales, amount conversion or inferred pricing. |
| Contacts/Events | Owner IDs and optional contact links | Unchanged. Future joins must verify each record's owner. |
| Accounts/mobile | Existing user/provider IDs; local Piece IDs and `serverId` | No auth/billing/cache/sync changes. Future QL links require server IDs after sync, not unsynced local IDs. |

## Implemented additive schema

| Table | Endpoints | Purpose |
| --- | --- | --- |
| `ql_piece_firings` | `piece_id`, `firing_id` | Many-to-many Piece/firing associations |
| `ql_piece_test_tiles` | `piece_id`, `test_tile_id` | Reference a test result; does not imply a shared firing |
| `ql_piece_pricing` | `piece_id`, `pricing_id` | Reference saved estimates without copying calculations |
| `ql_migrations` | Migration ID, checksum, schema manifest, timestamp | Atomic, repeat-safe migration with drift detection |

Each junction has a new UUID, user ID, timestamp, endpoint foreign keys and unique
`(user_id, piece_id, target_id)` tuple. Insert/update triggers enforce same-owner endpoints.
Parent ownership changes are rejected while links exist. Foreign keys must be ON.
Endpoint deletion cascades junction rows only; unlink never deletes records. This is not an
immutable archive: record deletion and historical retention remain integration decisions.

Migration review: add tables/indexes/triggers only. No existing-table ALTER/rebuild, UPDATE,
backfill, ID reassignment or photo mutation. Preflight endpoint columns, then perform DDL and
ledger write in one immediate transaction. Collisions roll back. Reapplication validates checksum
and schema manifest; drift is rejected rather than silently repaired. Later migrations changing
these objects must explicitly evolve that manifest contract. Never replay old migration SQL.

`migrate(db)` is explicitly invoked with a database handle. No startup import, migration-runner
integration, database-path CLI or runtime enabling toggle exists. Tests use disposable databases.
`link` is idempotent and returns the existing ID on retry. `unlink` removes a selected pair;
for Firings this clears both its explicit QL link and its matching legacy selection atomically.
The owner argument must eventually come from authenticated context, never a request body.

`readPiece` is an internal read model, not an HTTP response replacement. It reads legacy
clay/glazes/photos/sales, combines legacy and QL firings, and reads explicit tile/pricing links.
It works without the migration (new link lists empty). Cross-owner joined records are filtered,
not repaired. Raw Piece fields remain raw; an ID in a legacy field is not certified as a valid link.
No relationship is inferred from a name, timestamp, photo filename or display label.

## Phase 1F: authoritative Firing ↔ Piece compatibility policy

`firing_logs.piece_id` is an **optional legacy single-Piece selection**, not an exclusive
owner and not a complete representation of a multi-Piece firing. The effective relationship
set is the same-owner union of this selection and `ql_piece_firings`. The normalized form
for new QL associations is the explicit junction. Absence of a junction is not a tombstone.
No read writes data, backfills links, elects a primary Piece, or repairs history.

| State/action | Contract |
| --- | --- |
| Legacy only | Remains valid and readable without QL installed. No automatic copy. |
| QL only | Readable through the QL service; legacy selection stays null or keeps its other Piece. |
| Both, same pair | One result per Firing ID. |
| Legacy points to A, QL points to B | A and B are valid additional associations in a many-to-many model, not competing ownership claims. Preserve both; never guess which was intended. |
| Stale/foreign legacy or QL pointer | No expansion of missing/foreign endpoints. No read-time repair. Owned Firing history remains available. |
| QL create | Validate both endpoints against authenticated owner, insert only requested pair, preserve the legacy selection. Repeat returns stable link ID. |
| QL remove | Validate both endpoints, remove requested QL pair AND clear legacy selection only if it is that same pair; one transaction. Return 1 if either representation existed, otherwise 0. Never delete Firing/photos. |
| Legacy create/edit | `writeLegacyFiring` owns one immediate transaction including record persistence. Validate selection; save legacy selection; when QL installed remove the old selected QL pair if selection changed, then idempotently add the new selected pair. Preserve all additional pairs. |
| Legacy clear | Null/empty/omitted `pieceId` retains the existing full-replacement PUT behavior. Remove the old selected pair; do not clear additional QL pairs. |
| Same-selection edit | Add the selected pair if still legacy-only; otherwise keep the existing link ID. Only this deliberately written relationship is normalized. |
| Piece deletion | Existing lifecycle detaches matching legacy selections and cascades only that Piece's junctions. Keep every Firing, including last-association history and its photos. |
| Explicit Firing deletion | Existing owner-scoped lifecycle removes that Firing, its child metadata and junctions; preserve Pieces and shared files. |
| Account deletion | Existing owner/isolation preflight and transactional whole-account deletion remain unchanged. |

The service owns create/remove/synchronization and the common QL firing union reader.
Routes are thin adapters: they supply `req.userId`, server-generated Firing IDs on create,
and callbacks persisting non-relationship fields. Legacy successful response shapes stay
unchanged. Legacy invalid related Piece errors stay `400 Related record unavailable` for
both foreign/missing IDs. QL invalid endpoints remain identical 404s. A legacy PUT to a
foreign/missing Firing now returns the same generic 404 instead of reporting a no-op success.
No schema changes or new migration. Phase 1A installation stays explicit and optional.

### Read/write path audit

- `server.js` POST/PUT `/api/firing-logs`: the only live legacy relationship create/edit
  paths; both now call the service. Website `public/app.js` saves its selected `pieceId`
  through those same endpoints. The existing mobile API contract is unchanged for valid writes.
- Legacy GET `/api/pieces/:id` retains its legacy-selected firing list and date ordering.
  GET `/api/firing-logs`, GET `/api/firing-logs/:id`, and both existing registrations of
  GET `/api/export/firing-logs` retain their legacy selection/projection and owner-scoped
  Piece joins. They do not invent a single selected Piece from multiple QL associations.
- QL GET/POST/DELETE `/api/ql/pieces/:pieceId/firings` use service list/create/remove;
  exported `link`, `unlink`, `readPiece` share the same policy. No reverse API added.
- `deletion-lifecycle.cjs` Piece deletion (single, bulk and casualties) clears legacy
  selections and relies on existing FK junction cascades; explicit single/bulk Firing
  deletion removes history only when the Firing itself was selected for deletion.
  Account deletion paths retain earlier preflight protections. No lifecycle replacement.
- `database.js` historical firing-table rebuild copies existing `piece_id`; it is schema
  compatibility, not a new relationship write path. No migration/startup logic changed.
- Photo routes, exports, admin counts and file-reference operations do not create or
  reassign Firing↔Piece relationships. Tests/fixtures deliberately use raw SQL to model
  old/corrupt states; application writers must use the service.

### Limits and risks

Old clients expose only the legacy selection, not all QL associations. This deliberate
projection preserves their existing interface; full association display is future work.
A stale old-client full PUT can still reselect a Piece after another client unlinks it:
there is no optimistic version token in the existing API. Transactions prevent partial
states, but successive valid writes are last-write-wins, not conflict-detected.
Raw SQL/external writers bypass service synchronization and must not be introduced as
application write paths. Existing corruption is filtered, not globally repaired. The
Phase 1A migration's existing triggers/FKs still protect newly written explicit endpoints.

## Verification and recovery boundary

Run `node ql/verify-phase1.cjs` with Node 22 and the unchanged dependency lockfile. Synthetic
fixtures recreate all 61 baseline tables and two historical variations: required glaze ID and
pre-Underglaze tile constraint. They do not represent every historical production schema.

Tests compare all existing table definitions/rows, exercise cross-account SQL/helper writes,
old-client HTTP workflows, failed-DDL rollback, repeat application, schema drift, restart,
photo filenames/hashes and SQLite WAL backup/restore. Twenty distinct synthetic photo references
cover dedicated tables and inline slots. This is not a production recovery certification.

Before integration, rollback means stop calling helpers and retain additive tables. Dropping
tables after real writes would discard links. Production requires actual schema inventory,
paired WAL-aware database/uploads backup and restore rehearsal, lifecycle review and approval.

## Newly sharpened risks and exact next chunk

1. Old single/bulk Piece-delete and casualty paths delete `firing_logs WHERE piece_id=...`.
   With QL shared firings, that would delete other Pieces' links too. Fix before enabling any
   QL endpoint/UI; preserve firing photos and existing legacy-only behavior. This foundation
   is deliberately not an integration-ready release.
2. Old clay/glaze joins can resolve another owner's records if bad IDs exist. The new reader
   filters them; old public APIs remain unchanged. Audit writes/joins during integration;
   do not silently scrub history. No actual customer corruption was investigated or inferred.
3. Phase 0 mobile cache/queue isolation and live iOS source mapping remain open. No native
   preview or real store purchases were tested here.

**Exact Phase 1B chunk: shared-firing-safe lifecycle compatibility, website only.** Add fixtures
for firings with both legacy Piece references and QL junctions. Cover single/bulk Piece deletion,
casualty actions, firing deletion and account deletion. Adjust those lifecycle paths to preserve
remaining Pieces' firing records/photos, enforce same ownership and define the last-association
rule. Retain legacy-only behavior, test, commit/push and checkpoint. Keep migration activation,
public endpoints, mobile changes, raw-material links, UI, Esme and voice outside that chunk.
