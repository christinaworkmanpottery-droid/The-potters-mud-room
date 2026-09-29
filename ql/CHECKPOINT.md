# QL Phase 1C — resumable checkpoint

September 29, 2026. Phase 1C complete; Phase 1 overall remains in progress.
Branch: `ql/phase-1-relationships`. This checkpoint commit: `git log -1 -- ql/CHECKPOINT.md`.
Parent: `c700a19df8da0b5215add48fc7db94b58ceb2fb4` (Phase 1B). Neither 1A nor 1B rebuilt.
Authorized scope: Clay, Glaze and Test Tile deletion safety; commit/push only, no deployment.

## Changes and behavior

- Reused `deletion-lifecycle.cjs`; single and bulk Clay/Glaze/Test Tile routes now share
  owner-first immediate transactions. Missing/foreign single IDs return 404 with no mutations;
  missing/foreign/duplicate bulk IDs count zero. Bulk preserves its existing partial-success
  contract: each ID is atomic, failures enter `errors`, other valid IDs continue.
- Clay: remove only owned Clay and its photo metadata. Detach Piece, standalone Test Tile and
  glaze-embedded clay-test references. Keep Pieces, tests, firing/sale/pricing history, names,
  results and photos. Standalone tiles with no saved clay name receive the deleted Clay's name.
  Pieces have no clay-name snapshot column: their existing nullable link becomes NULL, not a
  fabricated replacement or modification of user notes. No schema added to archive that name.
- Glaze: keep Piece glaze layers with their IDs, coats, application, order and notes; change
  the reference to NULL and retain an existing custom name or snapshot the Glaze name, using
  the existing manual-glaze workflow. Standalone tiles survive with a NULL glaze link and
  preserved/fallback name. Delete only the Glaze's own photos, recipe ingredients and embedded
  `glaze_clay_tests` children. Embedded tests require a parent Glaze and are distinct from
  independent `test_tiles`; their files are candidates for reference-checked cleanup.
- Test Tile: remove only the owned tile, its inline file references and its QL Piece junctions.
  All associated Pieces, Clay, Glazes, firing records/photos and other QL junctions survive.
  No direct tile-to-firing relationship exists; firing_schedule is historical text, unchanged
  on surviving tiles. Combo clay/glaze names and recipe ingredient names are text, not IDs;
  no name-based or JSON-based cascading/inference was introduced.
- Preflight rejects invalid cross-account incoming references, invalid outgoing test references,
  orphan dependent ownership and corrupt QL tile junction ownership (409 single; per-ID bulk
  error). No silent repair of another account. Old NOT NULL glaze-layer schemas reject deletion
  of a used Glaze rather than losing layer history; unused Glazes still delete normally.
- Direct Clay/Glaze photo deletion and embedded clay-test removal use the same commit-first
  global file registry. Clay photo replacement now verifies ownership and atomically replaces
  metadata; failed inserts preserve old rows/files. Test Tile edit photo removal now uses the
  registry instead of an unconditional unlink. Existing API URLs, success shapes, photo limits,
  and entitlement behavior are retained.

## File safety

Only after database commit, recheck candidate filenames across every baseline stored-file slot,
across all accounts, under the existing serialized check. Any surviving reference (including
orphan metadata) retains the file. Only genuinely unreferenced flat upload files are removed;
invalid paths/symlinks are skipped. Failed metadata changes roll back without removing old files.
Cleanup errors retain unused files and warn; they do not undo or corrupt committed metadata.
No blanket orphan sweep, file renames, copies or inference of ownership from filenames.

## Schema and production boundary

No migrations, schema changes, backfills, startup activation, dependency/lockfile, UI, native,
account, billing or subscription changes. Existing Phase 1A migration/checksum unchanged.
Fresh schema still matches 61 baseline tables. Tests are synthetic and disposable, loopback only.
Production `main` verified at `b818122c88b8ca037866f2fd35eaa11690759169`.
No deployment, merge, production data access, hosted preview, mobile build or cloud resources.

## Verification

Node 22.16.0, unchanged installed dependencies. `node ql/verify-phase1.cjs` passed, exit 0.
**168 passing executions:** all 102 Phase 1B checks plus 36 new lifecycle tests and 15 new
HTTP checks run twice (legacy and QL = 30). Includes every requested single/bulk type,
shared/last-reference cleanup, ownership, corrupt relationships, Piece layer/name preservation,
QL junction/firing retention, injected SQL rollback, cleanup failure, old schema rejection,
direct photo deletes, Clay replacement, and Test Tile photo-removal edits.
Baseline schema, integrity and foreign-key checks passed. `git diff --check` and syntax checks passed.
Not a real-device/store or production restore certification.

## Newly discovered risks / remaining gates

- Very old required-glaze-ID schemas cannot retain a detached layer without a migration;
  deletion safely returns 409. No migration is justified for this contained chunk.
- Legacy relationship writers still accept some cross-account IDs; existing bad references
  now intentionally block affected deletions pending review. They are not silently repaired.
- Account-wide deletion remains the Phase 1B implementation: its Piece preflight is verified,
  but Clay/Glaze cross-account cascades in account teardown are not certified by this chunk.
- Other out-of-scope file writers/deleters (e.g. sales, avatars, community) still have independent
  cleanup logic. Global sharing must not be enabled until remaining lifecycle paths are audited.
- Filesystem and SQLite cannot commit atomically: crashes/cleanup failures may leave unused
  files. New stale-reference writes after cleanup remain a write-side integration risk. Registry
  scans favor safety over scale and must track future file-bearing columns.
- All prior Phase 0 platform, entitlement, migration/restore and live iOS source-mapping gates
  remain open. Bulk Test Tile deletion retains the existing auth-only gate while single deletion
  retains starter-tier gating; entitlement harmonization is separate from this safety work.

## Exact recommended Phase 1D task — not started

**Enforce same-owner legacy relationship writes and safe reads for Pieces, Clay, Glazes and
Test Tiles, and extend account-delete preflight to these relationships.** Audit create/update/
import routes for Piece clay/glaze links, embedded glaze-clay tests and standalone tile clay/glaze
links; reject missing/foreign endpoints before mutation, filter unsafe legacy joins, and reject
account deletion if its Clay/Glaze cascades would alter another account. Preserve manual names
and nullable links; do not scrub existing data automatically. Add legacy/QL API rollback and
cross-account tests, run the full suite, commit/push/checkpoint. No new schema, sharing UI,
QL migration activation, mobile changes, AI/voice or deployment. Wait for the next instruction.
