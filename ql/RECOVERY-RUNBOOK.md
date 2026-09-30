# QL paired database/photo recovery runbook

Status: **reviewed procedure; only disposable cold recovery is verified** (Phase 1G/1H).
Phase 1I is READY TO CLOSE; production gates remain open. See `PHASE1-READINESS.md`. This document grants no production
access or migration/deployment authorization. Do not run the application against a backup
just to inspect it: `database.js` and `server.js` perform startup migrations.

## 1. Before any future QL migration

1. Obtain separately approved environment, exact release/rollback commits, DB and upload paths,
   operator, maintenance window and acceptable recovery point. Confirm independent isolated
   rehearsal first. Record runtime/dependency versions, SQLite version, schema, migration ledger,
   counts, ownership/relationship baseline and storage configuration. Resolve Phase 1 blockers.
2. Stop ingress and coordinate **all** DB and file writers: website/API processes, admin tools,
   mobile requests/retries, background photo/hash jobs, uploads already in progress, schedulers,
   webhooks, external scripts and cleanup jobs. Drain in-flight operations, then stop workers.
   Readiness means no operation can rename/unlink/write an upload or commit metadata. A SQLite
   transaction alone does not freeze the filesystem. Do not allow requests to resume between
   backing up the database and copying photos. Record how writer exclusion was verified.
3. With writers stopped, finish/rollback active transactions. In a controlled explicit SQLite
   connection, run `PRAGMA wal_checkpoint(TRUNCATE)` and verify a non-busy completed checkpoint;
   close all DB connections. Verify WAL/SHM sidecars are absent or demonstrably empty and no
   process can recreate them. If checkpoint is busy, errors, or sidecars change: STOP.
   **Never unlink active WAL/SHM to free space.** Do not copy only the main DB while committed
   pages remain in WAL. This runbook's verified backup mode is checkpointed, closed, cold copy.
4. Copy the complete closed SQLite DB and complete uploads tree from that same frozen interval
   to a new immutable backup generation. Include unrelated registered assets, not just Piece
   photos. Do not rename files, normalize names, deduplicate, purge or overwrite prior backups.
   Preserve access permissions; reject unexpected symlinks/special files for explicit review.
5. Generate relative-path/size/SHA-256 manifests for original frozen DB and all file bytes;
   verify destination equality and exact path set. Store manifest, schema/row/relationship
   baselines, release IDs and capture details with the backup. Independently protect access to
   account IDs/photos in these operator artifacts. Hash equality proves copying, not that a
   photo is valid. Check image decoding/permissions and document pre-existing content failures.
6. On a separate copy, open SQLite `readonly: true, fileMustExist: true`, enable connection FK
   checks, run `integrity_check` (exactly `ok`), `foreign_key_check` (empty), and
   `auditRelationships(db,{fileInventory})` from `ql/integrity-audit.cjs`. Inventory must come
   from the same stabilized upload snapshot. Record baseline findings; no silent waivers.
   Unavailable schema/preflight, ownership, missing-reference/file or migration drift findings
   block proceeding. Duplicate/unreferenced review findings require explicit classification,
   never automatic repair. Close this inspection connection.
7. Verify prerequisites on the isolated working copy: supported legacy schema and startup
   ordering, FK enforcement ON, complete endpoint/owner columns, expected QL ledger state,
   free disk for working/backup/quarantine copies, clean integrity baseline, and completed
   restore rehearsal. Known old Firing/Tile rebuilds must not run after QL installation unless
   their compatibility has been proved. Legacy migration HTTP routes/scripts are not QL tools.

## 2. Migration and verification gate

Keep writes stopped. Apply only the reviewed explicit `ql/relationships.cjs:migrate(db)`
through an approved isolated runner with an explicit handle. There is no production QL CLI
or startup toggle in Phase 1. Do not improvise one or use `run-migration.js` for QL.

Success requires all of these:

- Additive DDL and ledger committed atomically; checksum/manifest correct; repeat invocation
  reports not applied; no partial QL schema or unexpected legacy rebuild.
- Every pre-existing table/row and identifier remains equal to baseline (excluding only an
  explicitly approved migration delta; Phase 1A has **no** legacy-row delta). User/provider IDs,
  password hashes, entitlement references, manual names/layers, Sale amounts and quantities stay.
- Integrity and FK checks pass. Audit available and clean, or only individually adjudicated
  unchanged non-safety baseline findings. No new invalid owners/endpoints, orphan/duplicate links,
  missing files, stale compatibility links or schema drift. A preflight success is not proof
  that every account deletion path works; test actual deletion on disposable copies only.
- Files have the identical path set/bytes/hash manifest. Validate representative supported
  formats plus suspect files. No migrated image conversion is part of this migration.
- In disposable verification, legacy-only, QL-only, matching pairs and shared multi-Piece Firings
  obey the union contract; unlink clears only its pair; old clients retain legacy projections.
  Create/update/unlink/delete/retry checks reject missing/foreign IDs and preserve other owners.
- Run `node ql/verify-phase1.cjs` using Node 22 and the committed lockfile in an isolated checkout.
  Also run `QL_READINESS_STRICT=1 node --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs`. **Both must pass
  with no unresolved closure blockers.** Phase 1I gates pass; rollout still requires the separately authorized production prerequisites.
- Perform approved startup/restart tests on the migrated disposable copy and rerun audit,
  integrity, relationship snapshots and file manifests. Library-helper success alone is not
  startup compatibility. Validate actual historical schema, representative scale, maintenance
  window and memory limits before any later production migration approval.

## 3. Stop / rollback criteria

Stop immediately for an uncontrolled writer, incomplete checkpoint, snapshot mismatch, missing
backup file, undecodable newly damaged image, unavailable audit/preflight/schema, failed required
test, partial migration, drift, unexpected row/file change, cross-account expansion/mutation,
loss of shared history, changed Sale values, legacy-client incompatibility or excessive runtime/
memory that exceeds the approved window. Preserve logs and evidence; do not auto-repair.

Before migration, a failed backup means **do not migrate**. A rolled-back failed additive DDL
may leave the working copy unchanged: prove equality before deciding restore is unnecessary.
After changed data/schema/files or any uncertain state, restore the paired generation below.
Do not drop QL tables as rollback after QL writes; that discards relationships.
If writes have resumed since the backup, restoring loses those writes: stop ingress again,
quarantine the complete current state and obtain explicit disposition/reconciliation approval
before discarding acknowledged changes. Do not merge files or replay queues blindly.

## 4. Verified restore sequence

1. Keep ingress, jobs, callbacks and automatic restart disabled. Stop all processes and close
   every DB handle. Preserve the failed **whole** DB/sidecar/uploads generation in quarantine
   for investigation. If it cannot checkpoint safely, preserve it as-is; do not delete its WAL.
2. Verify immutable backup hashes before use. Restore into a fresh staging generation, not
   over a running DB. Copy the paired backed-up main database and entire upload tree, then
   verify exact manifests before opening SQLite. Do not overlay photos: remove post-backup
   files from the active generation by replacing the entire tree (keep quarantine separately).
3. Restore the matching application release/configuration to prevent incompatible startup
   migrations. Switch DB and uploads to the same restored generation while processes are stopped.
   Ensure no failed-generation `-wal`, `-shm`, or journal sidecars accompany the restored DB.
   For the verified cold backup, **restore no sidecars**; SQLite may recreate WAL/SHM later.
4. If a future backup intentionally contains non-empty WAL, this cold-copy procedure is not
   sufficient. Keep the matching DB/WAL set intact, never mix generations, and first rehearse
   SQLite recovery of that exact snapshot method in isolation. Do not certify it from the
   current tests. SHM is coordination state, not a substitute for missing WAL.
5. Check permissions/path ownership and readonly-open the restored DB without importing the
   application. Restore relationship/legacy state by restoring the whole database, not by
   hand-rebuilding junctions. For a pre-QL backup, QL objects must be absent; for an approved
   post-QL backup, exact recorded QL objects/ledger/rows must match. Phase 1G byte-exact full-tree
   rehearsal is specifically pre-QL restore; R separately covers migrated DB backup/reopen.

## 5. Post-restore trust gate

- Pre-open DB and uploads byte/path hashes equal the recorded paired generation; deleted
  original files returned, post-backup files absent from active tree. No unexpected symlinks.
- All schema objects and rows match the baseline; `integrity_check=ok`, FK findings empty.
  Exact relationship reads and legacy Firing selection/union equal the recorded baseline.
- Readonly audit with restored inventory equals baseline; no new owner, file, missing-record,
  preflight or schema errors. Confirm protected account boundaries using disposable cloned
  checks, never destructive tests on the restored real environment.
- Required automated regressions and strict readiness gate pass for the intended release in
  isolation. Controlled startup/restart rehearsal does not mutate unintended relationships.
- Smoke-check approved read/manual workflows and image readability in the authorized environment,
  then record operator signoff before resuming writes. Re-enable writers in a controlled order;
  stale queued/offline mutations need disposition before replay. Continue audit/health observation.

## What has actually been verified

`tests/ql-recovery-rehearsal.cjs` runs two fully disposable current/historical fixtures:
writer quiescence → WAL TRUNCATE/close → full DB/uploads copy/hash → explicit migration twice →
mixed operations/audit/corruption detection → whole-tree restore → exact bytes/schema/rows/
legacy reads/audit/FK/integrity → readonly reopen. The images are synthetic byte fixtures,
not image-quality certification. No live writer orchestration, production schema, large-scale
runtime, permissions, live disk recovery, store purchase or device behavior is certified.

## Pre-release expanded disposable procedure (2026-09-30)

The expanded implementation is `rehearsal/README.md` and `rehearsal/run.cjs`. Its Actions artifact
is the evidence for the exact tested commit. It does not authorize any production operation.

1. Create an isolated checkout, install committed dependencies with Node 22/npm ci, generate test
   secrets and synthetic fixtures, enforce loopback/outbound isolation. Empty-start proof launches
   server.js directly without preparatory initDB. For historical QL preparation, run current legacy
   compatibility first, then only the existing migrate(db) helper.
2. Wait for startup photo processing and every verification request; stop the child and all writers.
   WAL TRUNCATE checkpoint must not be busy; close all handles and verify no outstanding sidecars.
3. Capture the complete DB and uploads tree as one cold generation together with matching tracked
   code, lockfile, static files, geodata, seed-blog-drafts.js and explicit Shop original/preview assets.
   Record path/hash/size/permission manifests and schema/index/trigger/row/relationship/ledger baseline.
4. Preserve a failed whole generation in quarantine. Verify the backup manifests, then copy into a
   new clean staging generation. Never initialize a blank DB before restore, overlay uploads, or mix
   WAL/SHM generations. Missing bytes, unexpected paths or permissions fail the manifest gate.
5. Verify exact offline hashes and state, open readonly with fileMustExist, run integrity/FK checks
   and explicit ownership/legacy TEXT Contact/Shop-path audits. Integrity alone is not enough:
   the special-account billing CHECK incompatibility is documented separately in the rehearsal report.
6. Only after acceptance of the offline generation, start the isolated application. Wait for photo
   processing. Compare every schema/row change to the enumerated startup transition; do not label
   documented seeding, tier/referral/store/photo changes as corruption or ignore unexplained drift.
7. Exercise authenticated HTTP and UI reads/media/History/Contact/iCal contracts. Password login
   deliberately updates last_login. Stop, capture, restart and validate; repeat for a second restart.
   Media must remain byte-exact; later startup must reach stable resulting state.
8. Damaged-copy diagnostic launches are explicitly separate from accepted restore generations. Keep
   the clean backup unchanged; restore a new whole generation to recover. Do not self-heal records,
   adopt orphan files, rewrite owners, or repair ledgers automatically.
9. Do not reconnect devices or queues until a separately authorized recovery is accepted. Server
   backup does not include device state; stale same-account operations remain a documented risk.

The Admin demographics defect and newly observed release-asset/billing-constraint blockers are
separate maintenance work. **Do not treat successful test execution as production release approval.**
