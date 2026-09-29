# Quantum Leap checkpoint — Phase 2B

Date: 2026-09-29. Branch: `ql/phase-2b-piece-history-web`.
Base checkpoint: `7ebc4db94c2d42317483c8cdd1470124613e121f`.

Read-only Connected History added to existing website Piece detail using the Phase 2A endpoint.
Clay, ordered/manual glaze layers, multiple/shared Firings, explicitly linked Test Tiles/Pricing,
Sales and Piece photos displayed. Server chronology/provenance retained, meaningful dates and
labels shown without technical relationship terminology. Empty/loading/error states isolated
from existing details and edits. Server owner checks retained; authenticated scoped photo delivery
added. No mutations, inferred links, backfill or editing controls added to History.

Local complete verification: **380 passes** (342 unchanged baseline + **38 Phase 2B checks**).
Strict Phase 1 gate: **37/37**. Final runs: zero failures, skips or TODOs. Baseline tests unchanged.
GitHub Actions: pending push/verification; use branch HEAD and exact-head workflow as truth.

No production access, migration or deployment. Phase 2C not started.

Read `PHASE2B-HISTORY.md` for contracts, test composition, environment limitations, and risks.
Notably: the old public known-filename upload route remains outside this History integration;
real mobile browser visual verification remains outstanding.

Exact recommended Phase 2C: isolated website History release-readiness validation on desktop and
mobile Safari with disposable accounts/data, including visual/accessibility/performance, account
switch/navigation and slow/offline behavior; scoped private/public photo-access remediation plan.
Only demonstrated History fixes, no new features, production actions, migration or deployment.
