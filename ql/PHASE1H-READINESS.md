# Phase 1H readiness review — 2026-09-29

**Phase 1 is NOT READY TO CLOSE.** This is a source review and disposable-fixture result,
not a finding about customer data. Reviewed starting commit
`9c464a3cecd9d0ff6eb0656a69980e14bfcd7878`, branch `ql/phase-1-relationships`.
No production access, deployment, real migration, runtime repair or Phase 2 implementation.

The protected relationship/deletion services have substantial meaningful coverage. Their
contracts do not cover every existing caller that can read a related record or mutate shared
bytes. The full-system review found the gaps below. Passing the old suite is insufficient.

## Evidence and test notation

Paths below are repository relative; API routes are in `server.js`. Stable route/function
names are used instead of line numbers. Test labels identify the behavior actually asserted.

| Key | Test file | Meaningful evidence |
| --- | --- | --- |
| R | `tests/ql-relationships.cjs` | All three junction kinds; direct SQL/helper ownership; endpoint cascades; idempotency; read filtering; additive DDL/rollback/drift/reopen; manual names |
| D | `tests/ql-deletion.cjs`, `tests/ql-deletion-api.cjs` | Piece/casualty/bulk/Firing lifecycle, account routes, SQL rollback, shared files, cleanup failure, unsafe paths, FK/transaction prerequisites |
| S | `tests/ql-studio-deletion.cjs`, `tests/ql-studio-deletion-api.cjs` | Clay/Glaze/Tile single/bulk/children, historical NOT NULL rejection, preserved manual layers, upload replacement and rollback |
| O | `tests/ql-relationship-safety-api.cjs` | Legacy and migrated ownership-safe writes/serializers/account deletion; 1H adds Piece PUT Clay/Glaze rejection and Sale Piece create/update rejection |
| E | `tests/ql-relationship-service-api.cjs` | Authenticated QL routes, owner spoofing, identical unavailable errors, retries, safe reads, rollback |
| F | `tests/ql-firing-compatibility.cjs`, `tests/ql-firing-compatibility-api.cjs` | Union/dedupe, legacy create/reassign/clear, atomic dual unlink, preservation of additional associations, missing/foreign IDs |
| A | `tests/ql-integrity-audit.cjs` | Deterministic findings, no mutation, readonly bytes, schema/preflight failures, all file slots and corrupt owner/parent chains |
| B | `tests/ql-recovery-rehearsal.cjs` | Current/historical cold backup, hashes, explicit migration, mixed operations, exact restore |
| W | `tests/website-api.cjs`, `tests/website-dom.cjs`, `tests/directory-calendar.cjs` | Existing manual workflows; Sale photos/prices/quantity/restart, community photo slots; not exhaustive lifecycle certification |
| H | `tests/ql-readiness-blockers.cjs` | Executed desired-invariant failures H1–H7, plus passing historical Tile startup rejection/preservation |

## Relationship and caller coverage matrix

| Relationship / path | Responsible code and readers/writers | Evidence / readiness |
| --- | --- | --- |
| Piece ↔ Firing | `ql/relationships.cjs`: `link`, `unlink`, `related`, `firingRelationships`, `readPiece`, `createRelationshipService`; GET/POST/DELETE `/api/ql/pieces/:pieceId/firings` | R/E/F: retries, both endpoints checked, SQL triggers, filtered union, unlink does not delete history. Core ready; H7 startup integration blocks closure. |
| Piece ↔ Test Tile | Same service; `ql_piece_test_tiles`; `/api/ql/pieces/:pieceId/test-tiles` | R/E/S: selected-pair unlink, endpoint cascade only, ownership, corrupt reads. Historical startup preserves relationships by rejecting unsupported rebuild (H7-tile); it is not successful startup certification. |
| Piece ↔ Pricing | Same service; `ql_piece_pricing`; `/api/ql/pieces/:pieceId/pricing` | R/E/D: link/unlink/cascade preserves independent target and amounts. Pricing CRUD owner-scopes rows; H1 shows its file cleanup is unsafe. |
| Piece ↔ Clay | `ownedRelationship`, `validatePieceRelationships`; POST/PUT `/api/pieces`; `readPiece`; GET Piece list/detail, dashboard, casualties, Piece export | O/R/S: create and newly covered PUT reject foreign IDs before replacing history; deletion detaches Clay. Gallery/Photo Lookup exceptions H2. |
| Piece ↔ Glaze | Same validation; `piece_glazes` application rows; POST/PUT Piece; list/detail/dashboard/casualty/readPiece serializers | O/R/S: preserve manual names/layer order/coats/notes; safe joins. Gallery/Photo Lookup exceptions H2. Recipe ingredient replacement is parent-owner guarded but its multi-statement failure atomicity lacks dedicated coverage. |
| Tile ↔ Clay/Glaze | POST/PUT `/api/test-tiles`; GET list/detail; GET `/api/glazes/:id/test-tiles`, `/api/clay-bodies/:id/test-tiles`; `deleteStudioRecord` | O/S: invalid create/update rejected, same-owner reads, fallback labels and history survive parent deletion. Reverse list success is source-reviewed; missing/foreign reverse-route variants have no dedicated API regression. |
| Embedded Glaze Clay tests | GET/POST `/api/glazes/:id/clay-tests`, DELETE `/:testId`; `deleteClayTest`; Glaze serializers | O/S/A: glaze-derived owner; Clay validation; detach/delete semantics. Distinct from Test Tiles; no inferred link. |
| Legacy Firing ↔ Piece | `writeLegacyFiring` wraps POST/PUT `/api/firing-logs`; legacy GET Firing list/detail, Piece detail and two Firing export registrations | F/O: optional legacy selection + explicit QL union, last-write-wins; matching pairs dedupe; old projection stays old projection. `database.js` Firing rebuild is a separate unsafe path (H7). |
| Sale ↔ Piece | `saveSaleRecord`; POST/PUT `/api/sales`; owner-scoped list/export; Piece deletion detaches Sale | W/O/D: cents/quantity/copied photo preserved, foreign Piece rejected on create/update. H4: explicit Sale deletion can partly change Piece. Bulk sale POST creates unlinked manual sales, not relationships. |
| Sale ↔ Contact | `saveSaleRecord` accepts `contactId`; Contact DELETE; audit inspects pointer | H5 confirms missing foreign-contact validation. Contact DELETE leaves a stale pointer (no FK); no focused detach regression. Include in Phase 1I, not a new Contacts feature. |
| Dedicated photos | `piece_photos`, `clay_photos`, `glaze_photos`, `firing_photos`; upload/list/delete routes, reorder/stage/rotation | O/D/S cover owner checks on main parent/upload/delete paths and global shared-file retention. Reorder/stage/rotation owner filters source-reviewed; exhaustive forged-ID and SQL-failure HTTP coverage missing. Rotation stores metadata, not image bytes. |
| Inline/shared photos | `fileSlots`, `hasStoredFileReference`, `cleanupFiles`; Tile edits, Clay replacement, Sale copy, Pricing, global replacement | D/S/A/B prove conservative retention in lifecycle callers. H1/H3/H6 prove bypasses. Inventory coverage is not coverage of every deletion caller. |
| Shared Firings | `deletePiece`, QL FK cascades, Firing union | D/F: preserve shared and last-association history/photos; explicit Firing deletion removes only that Firing's associations. |
| Accounts/isolation | authenticated `req.userId`; `preflightAccountDeletion`; self DELETE `/api/account`, admin DELETE `/api/admin/members/:id` | D/O/A: current-schema graph cleanup, rollback and foreign data/shared bytes retained. Not exhaustive across social/shared account dependencies or historical schemas. H2/H5/H6 defeat an application-wide isolation claim. |
| Legacy/manual records | `readPiece`, old HTTP projections, nullable names/IDs; explicit-only `migrate` | R/F/B preserve IDs, raw manual fields, files and legacy-only links. No name-based inference, no read-time repair/backfill. |
| Raw Materials / recipes | `glaze_chemicals` CRUD, Glaze `glaze_ingredients` child rows | Names/amounts remain manual; no explicit ingredient→inventory relationship exists in Phase 1. Glaze deletion owns recipe children (S). A future link is deferred, not marked complete. |

## Destructive operations: exact current boundary

| Operation | Intentionally removed | Survives / limitations | Evidence |
| --- | --- | --- | --- |
| Piece DELETE | Selected owned Piece, its photo metadata, glaze applications, its QL junctions; candidate unreferenced files after commit | Every Firing (also last association), Firing photos, Tile/Pricing targets, Clay/Glaze libraries and Sales; same-owner legacy Firing/Sale IDs nulled. Cross-owner inbound legacy references reject before mutation. | D/F/R |
| Casualty DELETE | Same Piece lifecycle, not a separate history table | Same preservation. Single casualty uses Piece DELETE; bulk type `casualties` uses `deletePiece`. | D |
| Bulk Piece/casualty DELETE | Each valid selected owned Piece | Per-record transaction, not all-or-nothing batch. Duplicate/missing/foreign IDs contribute zero. One rejected record yields error while others can succeed. | D |
| Clay DELETE / bulk | Clay + Clay photo metadata; safe unreferenced bytes | Piece/Tile/embedded-test references nulled; Tile fallback Clay name retained; Glazes, Firings, Sales and results remain. | S |
| Glaze DELETE / bulk | Glaze + its photos, exclusive ingredients and embedded clay tests | Piece glaze layers become manual with name/coats/order/notes preserved; Tile fallback name retained; Pieces/Tiles/Firings/Clay remain. Incompatible old NOT NULL schema rejects linked deletion. | S |
| Test Tile DELETE / bulk | Tile, inline metadata and that Tile's QL junctions; only unshared files | Pieces, Clay, Glazes, Firings and other Tiles remain; invalid owner/endpoint chains reject. | S/R |
| Firing DELETE / bulk | Selected owned Firing, dedicated photo rows and its QL junctions | All Pieces, other Firings and shared bytes remain. Unlike Piece deletion, this deliberately deletes Firing history. | D/F |
| Direct studio photo DELETE | Selected child metadata after parent-owner check | Parent record and every other reference survive; bytes removed only when no registered slot refers to them. Embedded-test deletion removes only that owned test and eligible photo. | D/S |
| Pricing DELETE / replacement | Owned Pricing; FK removes its QL links | Pieces survive, but pricing-only reference checks can remove bytes referenced elsewhere. Unsafe; H1. | R + H1 |
| Sale DELETE | Sale row; resets linked owned sold Piece to done and clears price/date | Piece and other sales survive, but failure after Piece update leaves partial state (H4). No candidate photo cleanup; orphan bytes can remain. Multiple Sale history semantics are not certified. | H4; W covers saving, not deletion atomicity |
| Account DELETE, self/admin | Transaction removes account-owned studio graph, account's social rows, messages involving account, notifications, contacts/events/projects and other route-listed children, then user; FK cascades apply | Other accounts' independent studio records and shared filenames survive tested fixtures. Social rows dependent on removed posts may intentionally cascade; this is not a promise all other-user community history survives. Preflight rejection/SQL failure rolls back. Candidate cleanup omits some non-studio file slots, so unused bytes may remain. Current successful fixtures do not certify all legacy account schemas. | D/O/A; broader populated shared-social fixtures missing |
| Lifecycle file cleanup | Only safe flat regular unreferenced files after committed metadata | All registered references, even orphan metadata/foreign-owner references, protect bytes. Missing file harmless; symlink/path skipped; cleanup error retains bytes. | D/S/A |
| Other existing cleanup | Pricing; avatar/profile/Event replacement; forum photo DELETE; admin size/video cleanup; global by-filename editor; Project photo DELETE | These do not all use lifecycle cleanup. Avatar/Event/forum can unlink shared bytes; admin size/video cleanup ignores non-forum references; JPEG/PNG editor overwrites shared filename bytes (H6). Project route references undefined `uploadsDir`, catches failure and leaves bytes. Sale/Combo edits check global references but do not share safe-path/serialized cleanup implementation. Must resolve destructive shared-byte bypasses before closure. | H1/H3/H6; other listed paths source-only, focused regressions required in 1I |

## Migration and recovery paths

- `ql/relationships.cjs:migrate`: only explicit additive QL migration. R verifies prerequisites,
  FK enforcement, trigger ownership, ledger/checksum/manifest, transaction rollback and repeat.
  B verifies current and historical fixture migration plus exact cold restore.
- `database.js:initDB`: startup legacy schema initialization/ALTER/backfills and table rebuilds;
  `server.js` also has a nullable `piece_glazes` rebuild. Fresh startup exercised by every API
  fixture; this does not prove upgrades of populated historical databases.
- H7-firing reproduces startup of a pre-lustre schema **after** QL installation: `firing_logs`
  is missing afterward. The untransactional rebuild drops the parent and cannot safely finish
  with installed QL schema dependencies. This supported-input/order hole must fail closed or
  preserve all data before closure. H7-tile proves the analogous old Tile rebuild rejects with
  its relationship rows preserved; operator must resolve prerequisites before enabling QL.
- `run-migration.js`, `migrations/*.sql`, `/api/admin/run-migration`, and
  `/api/admin/run-migration-007` are legacy/manual migration paths, not QL migration runners.
  Old cascade scripts rebuild tables/disable FKs. No QL compatibility certification: prohibit
  them during QL operations; 1I must guard unsafe invocation/order. Never replay them as rollback.
- `/api/emergency/disk-cleanup` contains WAL/SHM and all-upload deletion code, but is registered
  after the catch-all `/api/*` and is currently unreachable. Do not move/enable or use it for
  recovery. Reachable admin disk cleanup already reproduces loss (H3).
- Recovery procedure and its exact tested limits: `RECOVERY-RUNBOOK.md`. No live backup claim.

## Blocking gaps (must resolve before Phase 1 can close)

| ID | Required narrow repair / proof |
| --- | --- |
| H1 | Route Pricing delete/replacement and other reachable unlink bypasses through globally reference-aware, safe-path, post-commit cleanup. Cover same-account and cross-account sharing, failed SQL, missing files, path/symlink rejection. |
| H2 | Owner-scope related Clay/Glaze reads in Gallery and existing Photo Lookup, preserving manual fallbacks and public eligibility. No search upgrade. Also resolve/guard absent `hide_from_photo_search`: baseline Photo Lookup returns 500 without it; H2b adds it only in the synthetic fixture to reach the unsafe serializer. |
| H3 | Make reachable admin size/video cleanup refuse referenced assets and retain DB/file consistency. Audit/guard legacy migration and dormant emergency routes; no deletion of active WAL or blanket uploads. |
| H4 | Make explicit Sale deletion and its Piece-state update atomic. Preserve other sales/history; establish multi-sale survival expectations. |
| H5 | Validate Sale Contact endpoints on create/edit (same generic unavailable response); detach same-owner Sale references on Contact deletion and cover account preflight for invalid pointers. No new Contacts functionality. |
| H6 | Prevent shared-byte overwrite by the by-filename editor: isolate edits to authorized references or reject safely. Include pricing slots and forum parent-chain semantics; no image editor redesign. |
| H7 | Guard historical startup/manual migrations when QL dependencies exist; supported ordering must preserve endpoint rows/photos/junctions or reject before mutation. Repair pre-lustre Firing rebuild; keep old Tile rollback protection. |

H tests execute desired safety assertions. Nine currently fail, explicitly tracked as TODO
only in the broad regression run so remaining established tests still execute. **They are not
passes.** CI additionally runs `QL_READINESS_STRICT=1 node --test tests/ql-readiness-blockers.cjs`,
which disables TODO and fails the closure gate. No existing failed test was weakened.
The passing H7-tile test is an ordinary test in both modes.

## Remaining risk classification

| Risk | Classification | Required disposition |
| --- | --- | --- |
| H1–H7 known safety gaps, unsafe cleanup callers and missing invariant coverage | Must resolve before Phase 1 closes | Narrow Phase 1I below; passing closure gate plus focused bypass/account/migration regression coverage. |
| Coordinated DB/photo writes during live backup/recovery | Must resolve before production migration | Prove all writers drained/stopped, callbacks/queues disabled, DB/uploads captured in one frozen interval; rehearse approved environment procedure. Synthetic quiescence is already proven. |
| Inventory cannot certify image content | Must resolve before production migration | Manifest hashes establish byte identity only; decode/read representative formats and all suspect assets, check permissions/symlinks/path safety, record pre-existing failures and obtain disposition. No automatic image repair. |
| Large-dataset audit memory/time | Must resolve before production migration | Representative synthetic scale/owner/relationship/file counts, memory and timing within a declared maintenance-window budget. Optimize only if measured need. |
| Additional unknown historical schemas | Must resolve before production migration | Authorized schema inventory later; recreate exact relevant variants without customer data, test startup→QL order and full account deletion. Known H7 is a closure blocker now. |
| Stale-client Firing writes without revision conflicts | Safe to defer to later QL phase | Document current last-write-wins; no claim of stale-intent detection. Add revisions before future offline/multi-client QL synchronization promises conflict safety. Existing transactions prevent partial writes only. |
| Mobile cache/account separation, live iOS source mapping, real purchases/devices | Safe to defer to later platform phase | Mandatory before those clients' QL release; no native work or release here. |
| Full recipe editing failure atomicity; exhaustive reorder/stage/rotation and unrelated community lifecycle | Safe to defer where no shared-file/isolation impact | Existing owner guards reviewed; track focused tests when changing these manual workflows. Any discovered shared-data destruction moves to H1/H6. |
| Unreferenced retained non-studio uploads after account deletion | Safe to defer to storage-retention work | Retention is safer than deleting shared bytes; no automatic orphan purge. Do not describe account removal as byte-complete erasure. |
| Ledger and manifest adversarial co-rewriting | Safe to defer | Integrity drift check, not a tamper-proof security attestation. |

## Verification and exact next scope

Final counts and CI result are recorded in `CHECKPOINT.md`. Test names and findings above
are based on this checkout, not earlier completion claims. Coverage holes for Piece PUT and
Sale→Piece create/update were filled without runtime changes; historical Tile startup rejection
also now has regression evidence. Unsafe behavior remains unfixed under the doc/audit/test-only
restriction. No claim that all Phase 1 invariants pass.

**Recommend Phase 1I: close the seven enumerated safety gaps, website service/API and tests only.**
Use the current isolated branch; repair H1–H7 and the explicitly listed equivalent cleanup
bypasses, add focused regressions including legacy/QL modes, shared account dependencies and
migration ordering, remove TODO markers after genuine fixes, rerun full verification and strict
closure gate, repeat readiness decision, commit/push. No UI, new relationships, search features,
Esme, voice, redesign, production access/migration/deployment or real-data repair. Do not start
Phase 2A until Phase 1I proves closure. No Phase 2 scope is authorized by this document.
