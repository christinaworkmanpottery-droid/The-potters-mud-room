# Quantum Leap — start here

Phase 1I safety repairs completed 2026-09-29: **Phase 1 READY TO CLOSE**.
See `PHASE1-READINESS.md` for repair evidence and deferred production gates and `RECOVERY-RUNBOOK.md` for recovery.
See `CHECKPOINT.md`. Runtime changes exist only on the isolated QL branch; nothing deployed.

- `MASTER-PLAN.md`: consolidated approved product scope and working rules.
- `BASELINE.md`: pinned repositories, architecture, reuse decisions, risks and boundaries.
- `CHECKPOINT.md`: verification results, next task and outstanding evidence.
- `RELATIONSHIPS.md`: current data contract, additive schema and next integration gate.
- `relationships.cjs`, `fixtures.cjs`, `verify-phase1.cjs`: isolated foundation and tests.
- `baseline.json`: machine-readable original source references.
- `verify.cjs`: disposable local verification and schema inventory; never opens this checkout's data directory.
- `schema.json`: schema from a newly initialized disposable baseline, NOT production schema/data.

Branch convention: `ql/phase-0-baseline` in both repositories; future approved chunks use `ql/phase-<n>-<short-task>`. Keep production `main`, mobile `master`, Android parity and existing release branches unchanged. No merges to production, Render deploys, Expo updates/builds, store submissions or cloud resource provisioning are part of Phase 0.

## Reproduce

For Phase 1I, run `node ql/verify-phase1.cjs` with Node 22 and the unchanged lockfile.
All established and expanded safety regressions are mandatory, with no TODO waivers.
Run `QL_READINESS_STRICT=1 node --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs`
for the strict closure gate. See `CHECKPOINT.md` for exact counts and CI evidence.
`PHASE1H-READINESS.md` preserves the original blocked audit for historical reference.

Use Node 22 (22.23.3 verified here). In this repository run `npm ci --no-audit --no-fund`, then `node ql/verify.cjs`. This runs the existing website suite with a clean environment and creates a fresh temporary server/database for schema verification. Only with `--write-schema` does it update the committed schema inventory. No customer data or credentials are needed. Do not run `npm start` against a copied production data directory.

For mobile, check out its QL branch, `npm ci --ignore-scripts --no-audit --no-fund`, then `node --test tests/android-parity.mjs tests/android-parity.test.mjs tests/android-billing.cjs tests/device-repairs.cjs`. These use mocks/local source. Do not launch the unchanged mobile app: its API origin is production. Before a runnable QL mobile preview, isolate origin, credentials, local database, app identity and all external effects.

No hosted QL environment has been provisioned. The Phase 0 environment is disposable local verification only, with synthetic fixtures. A separate hosted environment must have its own database/disk/uploads, JWT/admin secrets, test billing/webhooks, notification/email policy and deployment branch. The existing testing Render service is NOT certified as isolated.

## Resume cycle

Read these documents and the latest commits in BOTH repositories. Verify remote refs and dirty files before edits. Work one approved chunk → verify → commit/push → update checkpoint → stop. Record baseline vs current commit, tests, remaining work and exact next action. Put new ideas on the master list; do not silently expand the active phase. Repository checkpoints are the source of truth, not prior chat claims.
