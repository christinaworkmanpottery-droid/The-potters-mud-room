# Phase 2C — Piece History validation

Base checkpoint: `7a4a1fb48e695667045d4531b83640904fcdc9ff`.
Branch: `ql/phase-2c-history-validation`.

## Validation actually performed

- Real headless Chromium using the repository's actual `public/app.js` and `public/style.css`,
  at 1280×900 desktop and 390×844 iPhone-like narrow viewport.
- Automated DOM/service and loopback HTTP validation with disposable data/accounts/files.
- Static source audit of website upload delivery and the current mobile repository's direct
  `/uploads/<filename>` dependencies.
- No actual Safari/WebKit or physical iPhone was available. Chromium at an iPhone-like viewport is
  responsive-layout evidence, not Safari certification.

Browser fixtures include long labels, long History, undated records, Clay, manual glaze, Firings,
Test Tiles, Pricing and Sales. They assert no horizontal overflow, History stays within viewport,
headings/groups remain present, long content remains rendered and retry is at least 44px high.
Existing Phase 2B tests retain Piece-detail/edit controls, image behavior and ordering coverage.

## Accessibility / resilience findings and narrow repairs

Phase 2B already used semantic `h2`/group `h3` headings, native lists, a native retry button and
safe text labels. Phase 2C found two narrow gaps: dynamic loading/error/photo states could rely too
heavily on a broad live region, and the small retry button had no History-specific visible
keyboard-focus rule / guaranteed touch height. Phase 2C gives loading/photo placeholders status
semantics, the failure message alert semantics, descriptive Piece-photo alt text, a visible
`:focus-visible` outline, and a 44px minimum retry height. No redesign.

Slow/pending History still leaves Piece details usable. Failed History stays generic and retry is
GET-only/read-only. Failed protected photos remain local `Photo unavailable` failures. Stale
optional records remain filtered by the service. Navigation/logout discard late History responses.

## Session isolation

Phase 2B already cleared History on logout/navigation and ignored responses when the captured token
no longer matched. Phase 2C additionally clears private History DOM/blob URLs immediately before a
successful login response replaces the current token, covering an account replacement without an
explicit logout. Loopback API checks prove Account B receives generic 404 for Account A's History
and protected History photo route. The legacy public static upload route remains separately
reachable and is documented as pre-existing remediation work.

## Public upload privacy result

`/uploads` is an unauthenticated static mount over the shared upload directory. UUID v4 filenames
make blind enumeration impractical but possession of a known filename is enough to retrieve bytes;
there is no owner/record/visibility authorization at that route. Website and supported mobile code
construct these URLs directly across multiple existing photo surfaces, so globally changing the
route now would break compatibility. See `PHOTO-PRIVACY-REMEDIATION.md` for affected patterns,
cache concerns, protected/public media architecture, migration/client strategy, tests and rollout
gate.

No production access, migration, backfill, deployment, relationship editing/inference, search,
Esme, voice, native QL implementation or redesign occurred.
