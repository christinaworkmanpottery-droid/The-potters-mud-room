# Phase 1G: read-only integrity audit and disposable recovery rehearsal

`integrity-audit.cjs` exports `auditRelationships(db, { fileInventory })`. It does not
import `database.js`, open an application database, migrate, write, repair, remove files,
or expose an HTTP endpoint. There is no automatic startup invocation. For future operator
inspection, pass an explicitly opened `better-sqlite3` handle with `readonly: true` and
`fileMustExist: true`; enable that connection's `foreign_keys` pragma before calling.
Do not use a write-enabled production application connection. No production inspection
or migration was performed in Phase 1G.

One deferred SQLite read transaction supplies a consistent database snapshot. Optional
`fileInventory` is an array of known flat filenames from a separately stabilized snapshot;
the audit never scans a directory itself. Omit it for metadata-only inspection. The result
states whether inventory was checked. No inventory means no claim that file bytes exist.

The versioned JSON report has migration state, Firing compatibility counts, issue counts
and sorted findings. Findings contain only types, table/row IDs, endpoint IDs, column names,
related duplicate IDs and hashed file tokens. They omit names, email, notes, billing fields,
photo bytes and raw filenames. A token is SHA-256 of the exact filename, so a trusted
operator can match inventory without putting filenames in the report. This is an operator
report covering the supplied database, **not an account-authorized API**; its IDs must not
be published to customers. There are no timestamps or random IDs in audit output.

## Coverage and exact issue types

Covers all three QL junctions; Piece clay/glaze applications; legacy Firing and Sale Piece
links; Sale contact pointers; Test Tile clay/glaze pointers; embedded glaze/clay tests;
glaze ingredients; owners; dedicated Piece/Clay/Glaze/Firing/Project/Forum photo parents;
and every `fileSlots` metadata field used by deletion protection, including pricing,
sales, user avatars, events, community combos and merchant assets. Merchant assets have
no user owner in the existing schema. Free-text materials/ingredients do not imply IDs.

| Issue type | Meaning |
| --- | --- |
| `cross_account_relationship` | Resolved endpoint owners or QL row owner disagree. |
| `missing_record` | Referenced legacy or QL endpoint does not exist. |
| `stale_legacy_relationship` | A non-null legacy endpoint cannot resolve. |
| `stale_ql_relationship` | A QL row has a missing Piece or target. |
| `orphaned_relationship_row` | Junction or child/photo metadata lacks its required parent. |
| `invalid_ownership_chain` | Missing account/parent ownership or inconsistent QL ownership. |
| `invalid_firing_compatibility` | Legacy or QL Firing pair has missing or foreign endpoints. |
| `duplicate_relationship` | Multiple QL rows name the same Piece/target pair, including corrupt owner variants. |
| `duplicate_glaze_application` | Same Piece, glaze/custom name, position, coats and notes repeated; review-only suspicion. |
| `duplicate_photo_reference` | Repeated filename for the same dedicated photo parent; review-only suspicion. |
| `invalid_photo_parent_chain` | Forum photo's post disagrees with its reply's post. |
| `suspicious_file_metadata` | Unsafe/non-flat filename or empty required filename. |
| `missing_file` | Safe metadata filename absent from the supplied inventory. |
| `unreferenced_file` | Inventory entry appears in no registered metadata slot. |
| `ql_schema_drift` | Incomplete/unexpected QL objects or ledger/checksum/manifest mismatch. |
| `schema_unavailable` | Required legacy table/ID/reference column cannot be inspected. |
| `account_deletion_preflight_rejected` | Actual existing SELECT-only account preflight returns 409 for this account. |
| `account_preflight_unavailable` | Preflight cannot run, e.g. disabled foreign keys or unsupported schema; not a clean result. |

One defect may produce several diagnostic types. There is no automatic repair or assertion
that every warning means data should be deleted. Legacy-only, QL-only, matching dual pairs,
additional shared Pieces, historical/manual unlinked records, repeated glazes at different
positions, and shared filenames on different parents are legitimate. A valid legacy Piece A
and QL Piece B are **not** a conflict under Phase 1F. Current data cannot reveal stale-client
intent or tell whether an otherwise valid association was an unintended last-write-wins edit.

The account result reuses `preflightAccountDeletion` without invoking deletion or cleanup.
It reports that preflight's current verdict, not a promise that all downstream account-delete
SQL succeeds on every historical schema. Supporting relationship findings identify the
problem rows. An orphan may be reported even if the current preflight does not reject it.
Migration drift comparison uses the existing migration checksum and stored schema manifest;
it is not an adversarial tamper-proof attestation if both schema and ledger were rewritten.

## Disposable backup/migration/operation/restore test

`tests/ql-recovery-rehearsal.cjs` generates its own temporary root and accepts no external
paths or environment database settings. Both current and historical-schema fixtures run:

1. Generate legacy/manual database rows and actual photo files, including shared references.
2. Capture all table rows, complete SQLite schema objects, user version, relationship reads
   and clean audit. Quiesce the fixture's only connection, checkpoint WAL with TRUNCATE,
   close it, verify no WAL/SHM sidecars, and copy the entire database/uploads directory.
   SHA-256 manifests verify the copy byte-for-byte.
3. Reopen only the working fixture; explicitly run Phase 1A migration twice (apply/idempotent).
   Verify baseline tables/rows unchanged and no audit findings.
4. Exercise QL create/read/unlink, dual-pair dedupe, legacy reassignment, preserved additional
   associations, account-isolation rejection, Piece/Clay/Glaze/Tile/Firing deletion, preserved
   Sale history, shared photos, surviving QL pricing/firing links and untouched other owner.
   New photo bytes are added and old unshared bytes deleted. The audit remains clean.
5. Inject deliberate cross-account QL and missing legacy links plus a removed guard only
   into disposable data. Assert the exact finding counts and non-mutation.
6. Close the working DB. Replace the complete working fixture with the immutable backup.
   Verify byte-for-byte database/files, complete schema/rows, integrity/FKs, legacy reads,
   exact baseline audit, absence of every QL schema artifact, recovery of deleted files and
   removal of files created after backup. Reopen readonly and repeat the audit.

Run everything: `node ql/verify-phase1.cjs` (Node 22). Phase 1A–1F suites are retained.
Focused tests: `node --test tests/ql-integrity-audit.cjs tests/ql-recovery-rehearsal.cjs`.

## Limits / next boundary

- This proves recovery of quiesced synthetic fixtures, not a live Render DB/disk backup.
  Concurrent DB and upload writers need a coordinated snapshot window before production use.
- File inventory verifies reference presence only, not image readability, content authenticity,
  symlinks, permissions, or a path's safety to open. The rehearsal separately hashes real bytes.
- Audit buffers inspected tables in memory. Large-dataset sizing/latency remains unmeasured.
- The fixture models known schema variants, not every customer history. Missing columns and
  preflight errors must be treated as review blockers, never silently accepted as clean.
- No production dataset was examined, and no production corruption is inferred.

Recommended Phase 1H: a **Phase 1 readiness/coverage review and operator recovery runbook**.
Map each relationship/write/delete path to its verification, document the future coordinated
DB/uploads backup and stop/go/rollback criteria, and disposition remaining risks against the
master plan. Keep it documentation/test-only and isolated; no production access, migration
activation, repair, UI, reverse APIs or higher-level QL features. Do not begin Phase 2 until
that gate has an explicit decision. Phase 1H is not implemented here.
