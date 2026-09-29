# QL Phase 1G — resumable checkpoint

September 29, 2026. Branch `ql/phase-1-relationships`.
Starting checkpoint: `c6c321491bbeb9823f32eae5882bfe3f3359c03f` (Phase 1F).
Nothing deployed. Production data/services/branches and mobile sources untouched.

## Completed

- Read-only deterministic relationship audit: `ql/integrity-audit.cjs`.
- Full coverage, exact finding types, interpretation and limitations: `ql/INTEGRITY-AUDIT.md`.
- Legacy/QL/shared/manual states classified under the existing Phase 1F union policy.
- Missing/cross-account endpoints, stale links, duplicate/orphan rows, invalid owner/photo
  chains, file metadata/inventory findings, migration drift and actual account preflight verdicts.
- No repair, backfill, UI, startup hook, production database access or migration activation.
- No schema changes. Existing migration SQL/checksum and all Phase 1A–1F behavior preserved.
  The relationship module only adds a frozen export of existing audit metadata.

## Recovery evidence

Two full disposable rehearsals (current and historical schema) passed:
backup → explicit Phase 1A migration → mixed service/deletion operations → audit → restore.
Backup: quiesce the single fixture writer, checkpoint WAL/TRUNCATE, close SQLite, verify
sidecars absent, copy the entire DB/uploads tree and verify SHA-256 manifests.

Mixed operations passed: create/read/unlink; legacy reassignment; Piece/Clay/Glaze/Test Tile/
Firing deletion; shared-photo preservation; foreign-account rejection; surviving relationships.
Normal operations produced zero findings. Deliberate corruption produced exact expected counts.

Restore matched the complete intended baseline: byte-identical database and photo files,
all table rows/schema objects, legacy relationship reads, integrity/FK checks and baseline audit.
No QL objects remained. Post-backup files were removed; deleted originals returned. Readonly
reopening passed. Corruption audits also proved exact database bytes unchanged.

## Verification

`node ql/verify-phase1.cjs`: **268 passing test executions**, zero failures, Node 22.16.0.
This retains the prior 233 plus 33 audit tests and 2 complete recovery rehearsals. The
existing disposable baseline database integrity/schema check also passed.
Implementation commit: `8830ed5a674e0d192cb7887ff6fe917e8aca8dd8`.
GitHub Actions: **successful** for that exact implementation commit (full verifier, Node 22).
https://github.com/christinaworkmanpottery-droid/The-potters-mud-room/actions/runs/36613914143
This documentation-only checkpoint records that verified result; code/tests are unchanged.

## Newly documented risks

- Cold synthetic recovery is not a live Render recovery certification; coordinate DB/uploads
  writers before a future backup. No real customer data was inspected.
- Inventory presence does not verify photo content, permissions, symlinks or safe path opening.
- Audit buffers tables in memory; large-dataset sizing remains unmeasured.
- Valid multi-Piece links cannot reveal stale-client intent; Phase 1F last-write-wins remains.
- Known historical fixtures are not exhaustive. Preflight unavailable/schema findings block
  a clean verdict. Current preflight success does not certify downstream deletion on all schemas.
- Ledger/manifest checks detect drift, not adversarial rewriting of both schema and ledger.

## Exact recommended Phase 1H — not started

**Phase 1 readiness/coverage review and operator recovery runbook.** Map every relationship,
write and delete path to its tests; document coordinated DB/uploads backup, stop/go and rollback
criteria; disposition remaining risks against the master plan; record whether Phase 1 is ready
for a separately approved next phase. Keep documentation/test-only, isolated and resumable.
No production access, opt-in migration activation, repair, deployment, UI, reverse APIs or
higher-level features. Do not start Phase 2 automatically.
