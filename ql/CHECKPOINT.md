# QL Phase 0 — resumable checkpoint

Date: 2026-09-29. Scope: audit and isolated foundation only. Phase 1 has NOT begun.

## Saved

- Both repositories have `ql/phase-0-baseline`, anchored to the exact references in `baseline.json`.
- Consolidated approved master scope, architecture/reuse map, data relationships, risk register, safe local verification instructions and fresh synthetic schema inventory committed here.
- No existing application runtime file, dependency/lockfile, migration, production branch or service setting changed. No hosted QL environment, store build or deployment created. No customer data copied.
- The private mobile branch's only addition is `QL-PHASE-0.md`. Its checkpoint SHA is recorded below once published.

## Verification

- Website: **31 existing checks passed**, including auth identity on synthetic fixture, sales/quantity/cents, photo create/edit/copy/restart retention, notes, community ownership/duplicate prevention, URL normalization, directory privacy/radius and calendar export/navigation/DOM checks.
- Additional disposable baseline: **61 tables**, SQLite `integrity_check=ok`, empty `foreign_key_check`, zero users, version 47 and unauthenticated `/api/auth/me` rejected with 401. Schema inventory contains no customer rows.
- Mobile: **36 tests passed**, **113 JavaScript source files parsed**. Purchase calls mocked. Audited pinned source via GitHub; no native release build or actual device verification in this chunk.
- Backend dependency install and tests succeeded with **Node 22.23.3**, unchanged lockfile. Default environment Node 24 installation failed; no dependency upgrade used to hide this.
- Render metadata confirmed the live website uses baseline commit `b818122...`, and public version endpoint returned 47. The endpoint's `deployed` field is generated at request time, not a release timestamp.
- Production default/release branches must still match pinned refs when resuming. Only QL branch updates are authorized here.

## Limits / open gates

No live database export or row-by-row audit, production backup/restore rehearsal, complete customer-session test, App Store/EAS build attestation, real Stripe/Apple/Google purchase, native device test or hosted staging isolation test. These remain explicit gates before affected build/release work, not implied passes.

Important risks: startup migrations/tier writes; inconsistent entitlement paths; missing backend `googleapis` dependency; mixed inline/table photo references; ownership checks on future links; unscoped mobile cache/queue; old default mobile branch and unknown installed iOS provenance. See BASELINE.md for evidence and proposed mitigations. No fixes to these existing behaviors were smuggled into Phase 0.

## Exact recommended first Phase 1 chunk (not started)

**Relationship contract and preservation fixtures, centered on Pieces.** Define stable owner-scoped IDs, legacy nullable/name-only cases and proposed additive links for Piece ↔ Clay/Glazes/Firings; map Test Tiles, Raw Materials, Pricing/Sales/Contacts/Events compatibility. Implement synthetic legacy/current fixture builders and preservation/ownership tests, with no production schema application, UI redesign, Esme, voice or AI. Explicitly review migration approach before adding any migration. Resolve iOS binary provenance before changing/releasing shared native behavior; isolate mobile development configuration before launching any QL mobile preview.

Then verify → commit/push → checkpoint → stop for the next approved chunk. Do not interpret this recommendation as authorization.

## Resume references

Website QL checkpoint: the commit containing this file (use `git log -1 -- ql/CHECKPOINT.md`). The machine-readable source pins remain the original pre-QL baselines, not moving branch tips.

Mobile QL checkpoint: `6bbc77a2f33790b44029778ba4f4b39e641c1806` (documentation only).
