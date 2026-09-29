# QL Phase 1A — resumable checkpoint

September 29, 2026. First Phase 1 foundation chunk complete; Phase 1 overall remains in progress.
Branch: `ql/phase-1-relationships`. Commit: `git log -1 -- ql/CHECKPOINT.md`.

Interrupted work recovered and all 63 test executions rerun successfully.
Christina explicitly approved publishing this checkpoint to
`christinaworkmanpottery-droid/The-potters-mud-room`, branch
`ql/phase-1-relationships`, on September 29. No production deployment is authorized.
Phase 0 preserved at `70c852d366e5ef193a1b3d882964e85628afa800` and its original branch.

## Changed

- Reviewed all nine requested domains and mobile cache/sync; see `RELATIONSHIPS.md`.
- Added Piece–Firing, Piece–Test Tile and Piece–Pricing junctions with stable IDs, foreign keys,
  uniqueness, same-owner triggers, transactional migration ledger and drift checks.
- Added owner-scoped link helpers and legacy-compatible internal reader. Existing clay/glaze,
  photo and sale links reused; raw-material recipes, names and IDs never inferred or rewritten.
- Migration exercised only on synthetic databases. No runtime imports, startup activation,
  existing API response changes or mobile source changes.

## Tests

Node **22.16.0**, unchanged package/lockfile. `node ql/verify-phase1.cjs` passed:

- **31 existing website checks** on the unchanged runtime/schema.
- **17 QL tests**: current/historical fixtures; all 61 original table definitions/rows retained;
  atomic/idempotent migrations, ownership, invalid links, deletion cleanup, nullable/name-only
  records, legacy edits, drift rejection, restart, WAL database backup/restore and photo hashes.
- **15 API checks on migrated synthetic data**: 14 repeated existing API cases plus one old
  Piece create/read/edit/delete compatibility case. Server restart retained QL links.
- Additional fresh-baseline integrity/FK/schema/version/auth checks passed. Twenty synthetic
  photo files/references preserved; user/provider IDs, pricing JSON and sale amounts retained.

**63 passing test executions**, deliberately including baseline/migrated API repetition.
No real production schema/data or backup tested; no native/device/store tests this chunk.
Mobile's previous 36-test result remains Phase 0 evidence, not new Phase 1 validation.

## Safety/source status

Website remote main still `b818122c88b8ca037866f2fd35eaa11690759169` on inspection.
Mobile QL tree still `6bbc77a2f33790b44029778ba4f4b39e641c1806`, inspected read-only.
No deployment, merge, hosted environment, store build, cloud resource, account/billing change,
production data/photo access or customer communication. Older dirty checkouts left untouched.
Original baseline.json is immutable; its authorization field describes Phase 0. This checkpoint
records the user's September 29 Phase 1 authorization and completed work.

## Newly discovered/refined risks

- Legacy Piece-delete/bulk/casualty paths delete a firing outright; shared QL firing records
  need protection before runtime integration. Current app cannot create these QL links.
- Old FK constraints do not ensure same-account clay/glaze joins. The new reader filters
  foreign-owned joins; current APIs have not been expanded/repaired in this chunk.
- Junctions are not immutable archival history; endpoint deletion removes their links.
- Prior startup migration, entitlement, mobile cache isolation, iOS source mapping and production
  restore gates remain open. Historical synthetic variants are not exhaustive compatibility proof.

## Exact next Phase 1B chunk

**Shared-firing-safe lifecycle compatibility in the isolated website branch.** Fixture firings
referenced by legacy `piece_id` and QL junctions; cover single/bulk Piece deletion, casualty
paths, firing deletion and account deletion. Preserve remaining Pieces' firing records/photos,
enforce ownership, define the last-association rule, retain legacy-only behavior. Test, commit,
push and checkpoint. No migration activation, public endpoints, UI, AI, voice, mobile changes
or raw-material linking in that chunk. Full contract in `RELATIONSHIPS.md`.
