# Quantum Leap checkpoint — Phase 2C

Date: 2026-09-29. Branch: `ql/phase-2c-history-validation`.
Base checkpoint: `7a4a1fb48e695667045d4531b83640904fcdc9ff`.

Phase 2C validates and hardens the read-only website Connected History boundary without adding
relationships, inference, backfill, search, Esme, voice, native QL work, redesign, migration or
deployment.

Browser/device: actual Safari/iPhone execution was unavailable. A Chromium binary existed in the
work environment but could not complete reliable headless rendering, so no real-browser success is
claimed. DOM/CSS validation covers desktop/narrow layout constraints, and an optional exact-renderer
Chromium fixture is repository-tracked for an environment where Chromium can execute reliably.

Narrow repairs: precise status/alert semantics for dynamic History states; descriptive Piece-photo
alt text; visible retry keyboard focus; 44px retry touch height; successful account replacement
clears private History DOM/object URLs before installing the new token. Existing logout/navigation
race protection remains.

Isolation: protected History JSON/photo routes remain owner scoped, private/no-store and generic on
cross-account denial. New tests cover Account B denial after Account A use and successful account
replacement cleanup.

Privacy audit: the pre-existing `/uploads` static mount is unauthenticated. UUID filenames are
high-entropy but known URLs are sufficient to fetch bytes; there is no record ownership/visibility
check and ordinary static caching can extend exposure. Existing website/mobile surfaces depend on
these URLs, so Phase 2C does not perform a broad rewrite. Read `PHOTO-PRIVACY-REMEDIATION.md`.

Verification target: established 380 executions plus 6 new always-on Phase 2C regressions = **386**.
The optional two-viewport Chromium fixture is not counted because this environment cannot reliably
execute Chromium. Strict Phase 1 readiness gate remains **37/37**. Use the exact branch-head Actions
run as final CI truth.

No production access, migration, deployment, production data, or broad photo architecture rewrite.

Exact recommended Phase 2D — not started: implement the first bounded protected-media compatibility
slice for private Piece-detail photos on the isolated website branch, reusing the Phase 2B
owner-scoped delivery pattern while preserving existing stored filenames; add a compatibility
contract for supported mobile clients before disabling any legacy static path. Include private/public
classification, account-switch/cache tests and rollback notes. Do not migrate production, disable
global `/uploads`, or begin native QL UI in that chunk.
