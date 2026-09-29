# Phase 2B — read-only website Piece History

Base: `7ebc4db94c2d42317483c8cdd1470124613e121f` (Phase 2A).
Branch: `ql/phase-2b-piece-history-web`.

## Behavior

The existing `viewPiece` appends Connected History after rendering existing details and
controls. It independently requests `GET /api/ql/pieces/:pieceId/history` through the
existing authenticated API helper. No client relationship discovery, linking, backfill,
reverse API, migration, native work or redesign. Existing manual editing is unchanged.

Groups: Clay; ordered library and manual/custom glaze layers (including coats, application
and notes); Firings; explicitly linked Test Tiles; explicitly linked Pricing calculations;
Sales; Piece photos. Only service-returned entries are displayed. The service timeline is
filtered by record type without sorting or joining; glaze layers and photos retain their
service-supplied dedicated sequence. Shared/dual-source Firings remain deduplicated by the
service. The client never infers sibling Pieces, Tiles or Pricing from similar properties.

Actual supplied dates are displayed verbatim to avoid locale/timezone date shifts. Event
dates are labelled Date; created timestamps are Record added; association timestamps are
Linked. A record lacking its own date remains Undated even if a link date exists. Grouped
chronology is not a fabricated global event timeline. Source IDs/provenance remain in the
service contract; internal legacy/QL terminology is not displayed. Labels are DOM text.

History has its own loading/empty/generic failure states and GET-only retry. A photo failure
has a local fallback. Navigation/logout/new Piece opening discard late responses and revoke
photo object URLs; no persistent history cache is added. Existing Piece details and edits
remain available when history fails. CSS uses existing cards, colors and typography, wrapping
long labels and bounding image widths for narrow screens.

## Owner scoping and photo delivery

The original authenticated service remains authoritative for records and relationship filtering.
The History JSON response is now `private, no-store`. A narrow read-only byte route,
`GET /api/ql/pieces/:pieceId/history/photos/:photoId`, verifies both IDs against the authenticated
owner on the server, validates safe flat/non-symlink stored paths, and rejects filenames with
any reference outside the owner's recognized file slots. Missing/foreign/unsafe bytes get the
same generic 404. Raster formats only, nosniff, private/no-store. This route creates no records,
links or files. Client images use authenticated fetch and temporary blob URLs, not public
filenames or bearer tokens in image URLs. Database snapshots verify read-only behavior.

## Verification

- Established baseline: 342 passes before edits.
- New: 27 DOM/service tests + 11 loopback API checks = 38.
- Complete verifier: 380 passes, 0 failures/skips/TODOs (219 Node test passes + 161 individual
  manual checks; summary lines and disposable schema diagnostic excluded).
- Unchanged strict Phase 1 gate: 37/37, no failures/skips/TODOs.
- New tests exercise complete/mixed/legacy/QL-only data, all seven groups, manual layers,
  shared/multiple Firings, deterministic ordering, unknown dates, relationship-only dates,
  empty/stale/foreign data, safe labels, loading/error/retry/photo errors, preserved details,
  logout/navigation races, object-URL release, API authentication/ID tampering and no mutations.
- Node 22.16.0 with existing compatible local dependencies. Default Node 24 install failed;
  lockfile unchanged. One intermediate full run ended with a runtime library error; full
  rerun completed successfully. CI uses fresh npm ci on Node 22.
- Real browser screenshot attempt blocked by unavailable Chromium and truncated download.
  DOM checks are not a Safari/real-device visual or performance certification.

## Risks and next boundary

The pre-existing `/uploads` static route serves known filenames publicly. This phase does not
change the global upload/gallery/native contract. History uses the new protected route, but
this does not fix the broader existing known-URL access risk. Separately review private/public
file delivery before releasing private connected history. Ambiguous cross-owner shared filenames
are intentionally unavailable; do not repair or relink them automatically.

No actual production schema/data, production access, migration, deployment, or external service
writes were used. All test databases/files are disposable. No Phase 2C implementation begun.

Recommended exact Phase 2C: isolated website release-readiness validation of the existing read-only
Piece History on representative desktop and iPhone Safari widths, with disposable owner-isolation,
rapid navigation/account-switch, slow/offline, legacy/mixed and photo fixtures; inspect actual UI,
accessibility and performance, and document a scoped private/public photo-access remediation plan.
Repair only demonstrated History defects with regressions. No new relationships, inference, native
work, AI, redesign, production access, migration or deployment. Obtain the next assigned chunk first.
