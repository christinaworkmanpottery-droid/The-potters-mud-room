# QL Phase 1H — resumable checkpoint

2026-09-29. Branch `ql/phase-1-relationships`.
Parent checkpoint: `9c464a3cecd9d0ff6eb0656a69980e14bfcd7878` (Phase 1G).

## Decision

**Phase 1 is NOT READY TO CLOSE.** Phase 1H review/runbook/test work is complete.
No runtime source, production data/service/branch, mobile source or deployment changed.
No Phase 2 work begun. No real-data repair or production inspection.

## Deliverables

- `ql/PHASE1-READINESS.md`: relationship/read/write/delete/bulk/account/file/migration
  matrix, evidence references, exact survival semantics, missing coverage, risk dispositions.
- `ql/RECOVERY-RUNBOOK.md`: coordinated writer stop, cold SQLite/WAL and paired uploads
  backup, hashes, prerequisites, stop/rollback criteria, complete restore and trust gate.
- `tests/ql-readiness-blockers.cjs`: nine executed failing desired safety invariants across
  seven blocker groups, plus passing historical Tile startup rejection/preservation.
- Focused passing coverage added for Piece update foreign Clay/Glaze and Sale create/update
  foreign Piece rejection (each executed in legacy and QL modes). No test-count padding.
- CI has a separate strict closure gate. It deliberately reports failure while defects remain;
  TODO labels in the broad suite do not mean safety passed. No existing assertion was weakened.

## Actual final local verification

Node **22.16.0**, unchanged dependency lockfile; disposable data and loopback servers only.

`node ql/verify-phase1.cjs`: **275 passing executions**, **9 known failing TODO executions**,
no unexpected failures. Prior 268 retained; 6 owner-validation executions plus 1 safe historical
Tile rejection added. The separate disposable baseline/schema integrity check also passes.
Count excludes summaries, the baseline diagnostic and TODO tests.

`QL_READINESS_STRICT=1 node --test tests/ql-readiness-blockers.cjs`:
**1 pass, 9 failures, 0 TODO**, nonzero exit. This is the required closure gate, not an optional
warning. Full-suite green alone cannot authorize closure. GitHub Actions runs both commands;
its strict step fails until the repairs pass.

GitHub Actions verified implementation commit `4499fab29e221a7599bf080d312223d04fd9a4b6`:
full verifier **successful**, strict closure gate **failed with the same 9 safety failures**
(1 passing historical Tile check). Overall workflow: **failure**, correctly blocking closure.
Run: https://github.com/christinaworkmanpottery-droid/The-potters-mud-room/actions/runs/36615958639
The subsequent documentation-only checkpoint records this observed result; code/tests unchanged.

## Remaining blocking work / exact Phase 1I

Repair only the enumerated safety gaps and equivalent existing bypasses, website service/API
and focused tests, on this isolated branch:

1. H1: globally reference-aware, safe-path post-commit cleanup for Pricing and other reachable
   shared-file deletion/replacement bypasses (avatar/profile/Event/forum included).
2. H2: owner-filter Gallery and existing Photo Lookup related Clay/Glaze reads; guard the missing
   baseline `hide_from_photo_search` prerequisite without upgrading search functionality.
3. H3: prevent admin size/video cleanup from deleting referenced assets; guard unsafe legacy
   migration order/invocation and keep dormant emergency WAL/upload deletion unreachable.
4. H4: atomic Sale deletion + Piece status change; prove surviving Sale history.
5. H5: Sale Contact same-owner validation, safe Contact detach and invalid-pointer account coverage.
6. H6: shared-image edit isolation (currently an authorized JPEG edit changes another account's
   referenced bytes); include Pricing slots/parent ownership semantics.
7. H7: historical startup/manual migration ordering must preserve or reject before mutation;
   pre-lustre Firing startup after QL currently removes the parent table. Old Tile rejects safely.

Remove TODO only after genuine repairs. Rerun broad suite and strict gate; add focused coverage
for equivalent bypasses, populated shared account dependencies and migration ordering. Repeat
readiness decision, commit/push, verify CI. No UI/new relations/Esme/voice/advanced search/redesign/
community expansion/production access/migration/deployment. Do not begin Phase 2.

## Risk classifications

- **Before Phase 1 closes:** H1–H7 and their safety regression gaps above.
- **Before production migration:** coordinated live DB/photo writer freeze and restore rehearsal;
  image content/path/permission checks beyond inventory; representative large-data audit memory/
  latency; actual authorized historical-schema compatibility. No live claims were made.
- **Later QL phase:** stale-client revision/conflict handling (current last-write-wins documented);
  platform/device/purchase/source mapping gates before native release; non-destructive leftover-file
  retention and unrelated manual workflow coverage. See review for precise boundaries.

Unsafe behavior was identified and preserved as reproducible tests, **not repaired** in this
explicit documentation/audit/test-only chunk. Readiness/coverage overclaims and stale navigation
documentation were corrected. No approval to deploy or work ahead is implied.
