# QL Phase 1B — resumable checkpoint

September 29, 2026. Phase 1B complete; Phase 1 overall remains in progress.
Branch: `ql/phase-1-relationships`. This checkpoint commit: `git log -1 -- ql/CHECKPOINT.md`.
Parent checkpoint: `e69e0f8df860e2d962fd2ab84848da06e29da783` (Phase 1A; not rebuilt).
Christina authorized this contained change and commit/push to the QL branch, with no deployment.

## Changed / exact behavior

- Added `deletion-lifecycle.cjs` and wired existing single-Piece, bulk Piece/casualty,
  firing-delete and Piece/firing-photo-delete routes to it. API URLs/success shapes unchanged.
- Ownership is checked before any child metadata or file access for deletion. Missing/foreign
  Piece IDs remain successful no-ops; bulk counts only actual owned deletions.
- Piece deletion is an immediate SQLite transaction: remove its photo metadata/glaze layers,
  detach its owned legacy firing/sale links, delete Piece, and let existing foreign keys remove
  its QL firing/test-tile/pricing junctions. Other endpoints and their metadata survive.
- **All firings remain independent history, even after the last associated Piece is deleted.**
  Only `firing_logs.piece_id` becomes NULL when it names the deleted Piece. Surviving QL links,
  firing IDs, notes, dates, results and photo rows/files remain intact. No guessed reassignment.
  This intentionally replaces legacy implicit firing deletion: the current user instruction to
  preserve firing history takes precedence over Phase 1A's tentative legacy-only deletion rule.
  Explicit firing deletion still removes the owned firing, its photo rows and QL junctions;
  it never deletes Pieces. Account deletion still removes that account's firing history.
- Candidate files are checked only after metadata commits. An immediate transaction serializes
  the final global reference check with SQLite writers. Any reference in any account retains
  the file. The registry covers every baseline stored-file column, including previously omitted
  pricing photos, inline slots, avatars and merchant files. Orphan metadata is conservative protection.
- Unreferenced Piece-only files are removed; shared files survive. Direct Piece/firing-photo
  removal follows the same rule. No renaming, copying, blanket orphan sweep or ownership inference
  from filenames. Invalid paths/symlinks are skipped. SQL rollback never removes files; cleanup
  errors retain unused files and log a warning rather than undo committed metadata.
- Existing cross-owner legacy firing/sale references cause deletion to fail before mutations
  (single Piece/account HTTP 409, bulk per-ID error). No automatic history repair. Self/admin
  account cleanup now runs atomically with this preflight; existing account file-retention policy
  remains unchanged (no filesystem sweep).

## Schema / compatibility

No new migration, schema alteration, backfill, package/lockfile change or QL migration activation.
The Phase 1A migration/checksum/manifest remain unchanged. Fresh startup schema still matches all
61 baseline tables. Helper works with/without QL tables and older optional photo columns.
Existing user/provider IDs, accounts, subscriptions, pricing/sale values and mobile source untouched.

## Verification

Node **22.16.0**, unchanged installed dependencies; command: `node ql/verify-phase1.cjs`.
All data and photo files were synthetic and disposable, with clean child-process environments.

**102 passing test executions:**

- 31 existing website regression checks.
- 17 existing Phase 1A relationship/migration tests.
- 15 existing migrated old-client API checks.
- 19 new lifecycle tests: both schemas, shared/last firing associations in both orders,
  shared/Piece-only/cross-account files, metadata preservation, junction cleanup, sale history,
  bad legacy links, rollback, missing files, invalid paths/symlinks, cleanup failure,
  orphan conservatism, all file slots and foreign-key/transaction preconditions.
- 10 new HTTP deletion checks repeated with and without QL migration (20 total): single/repeat,
  bulk/casualties, cross-account IDs, Piece-only/shared photos, direct photo/firing deletes,
  invalid references, account rollback and both self/admin account deletion.

Additional integrity/FK checks and baseline schema comparison passed. No production database,
photos, backup/restore or native/device/store tests performed. Not a production release certification.

## Safety / newly identified risks

- Production `main` remains `b818122c88b8ca037866f2fd35eaa11690759169` on remote inspection.
  No deploy, merge, production data access, hosted preview, billing change or mobile changes.
- Other pre-existing deletion paths remain outside this chunk: bulk Clay/Glaze cleanup can touch
  children before verifying the parent owner; Clay/Glaze/Test Tile and other photo writers/deleters
  still have unconditional unlinks. Do not enable general QL sharing until these are hardened.
  These are source findings, not evidence of customer data loss or a production exploit test.
- Legacy APIs can still accept invalid cross-account relationship IDs. This chunk blocks unsafe
  Piece/account deletion rather than silently repairing such history; write/read ownership validation
  remains an integration gate. Account deletion across other legacy relationship types is not certified.
- File/SQLite operations are not one atomic resource: crash or unlink failure can retain unused
  files. Safe retry/orphan maintenance is deferred. Registry scans favor safety over scale; future
  file-bearing columns must be added. New stale-reference writes after file cleanup are not prevented
  by this lifecycle helper; write-side validation remains needed before expanded sharing.
- Retained firings may continue counting toward the existing firing allowance until explicitly
  deleted. Last-association retention is intentional and applies to legacy per-Piece firings too.
- Phase 0 startup migration, entitlement, mobile cache/account isolation, iOS source mapping and
  production restore gates remain open. Existing dirty checkouts were not changed.

## Exact recommended Phase 1C task — not started

**Extend owner-scoped, shared-photo-safe deletion to Clay, Glazes and Test Tiles, including their
bulk routes.** Verify ownership before touching children, preserve files referenced by surviving
records/accounts, explicitly define relationship cleanup/history retention, add legacy + QL API
regressions and rollback tests, then commit/push/checkpoint. Keep QL migration activation, new public
endpoints, UI, AI/voice, mobile changes and deployment outside that chunk. Obtain the next chunk's
instruction before starting; remaining relationship-write validation stays on the integration backlog.
