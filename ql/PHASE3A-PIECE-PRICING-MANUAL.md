# Phase 3A — Manual Piece ↔ Pricing

Branch in both repositories: `ql/phase-3a-piece-pricing-manual`.

Base: backend `c30a0ac415e07ae4003834e94b28389252c35ceb`; mobile `5033b46a536352895723103d1a1a93e60736c221`.

## Contract

The existing Phase 1 relationship service remains the only writer. Its new `available()` read reports whether the Phase 1 relationship tables are installed; it never installs or repairs them.

Authenticated relationship GET retains its array body and existing row fields. It adds `X-QL-Relationships-Available: true|false`, exposed through CORS, with `Cache-Control: private, no-store`. A successful list request for an owned Piece returns `[]` plus `true` for an empty installed relationship set, or `[]` plus `false` for a legacy database. Missing headers are treated as unavailable by new clients. Pricing rows retain their historical fields and gain the canonical `inputs`, `result`, `photoDelivery`, and `photoVisibility` fields through the existing `parsePricingCalculation` serializer. The UIs load the existing Pricing detail endpoint for saved calculations.

POST remains `/api/ql/pieces/:pieceId/pricing` with `{ pricingId }`. The existing DELETE contract is `/api/ql/pieces/:pieceId/pricing/:targetId` (the target-bearing route found in the source audit). No competing body-only DELETE route is introduced.

The authenticated server account owns both endpoints. Existing same-owner validation, idempotent insertion/removal, generic errors, deletion lifecycle, IDs, stored calculation content, photos, and unrelated associations remain intact. There are no inferred or repaired links and no copies of calculations.

## Website

Piece detail contains Linked Pricing: loading, empty, unavailable, generic error/retry, saved-calculation selection, explicit Link, View, and Unlink. Already-linked records are excluded from the picker. Saved labels, descriptions, dates, and IDs identify records without any new pricing status.

Successful mutations reload server relationships and replace/reload the Connected History container, invalidating earlier History responses. Requests are bound to the mounted Piece, account, token, and Piece-view generation. An in-flight operation locks further operations. Failures clear actionable state and require a server reload; no optimistic relationship state is created.

Read-only View reuses the existing Price Breakdown markup, extracted into `pricingBreakdownMarkup`, and the Phase 2M protected Pricing photo loader. Stored results are displayed without recalculation. Navigation/session cleanup removes the view and releases protected photo URLs.

## Shared mobile

`LinkedPricing` is mounted inside `PieceDetailScreen`; iOS and Android share its controls. The narrow `piecePricing` controller uses the existing API helper, whose optional response-header return is additive. Each controller confirms the Piece through a server GET before relationship mutations, reads availability, resolves canonical saved calculations, and reloads server state after mutations.

Local-only IDs, missing IDs, unsynchronized records, offline connectivity, unavailable relationship tables, and failed API requests cannot create or queue associations. A synchronized local record may use its explicit `serverId`, which must still be confirmed by the server. Existing local Piece editing is preserved. The route's unsynchronized state remains conservative until that Piece is reopened from synchronized data.

Controls remount on Piece identity, account, session generation, connectivity, or navigation-focus changes. Disposed controllers and changed sessions reject stale responses, including mutations. The existing Piece fetch also receives a response guard. Read-only View reuses the calculator's `PricingBreakdown` component and `PricingPhotoImage`; it never saves or recalculates.

## Verification

- New backend/API: 20 checks, including real Connected History after link/unlink.
- New website DOM: 18 checks, including protected viewer, retry, duplicate action suppression, navigation and account changes during mutations.
- Complete backend/QL expected inventory: 912 passing executions (874 prior + 38 new).
- New mobile: 28 checks; complete mobile: 373/373.
- Shared JavaScript: 139/139 parse.
- Strict Phase 1 readiness: 37/37.
- Phase 2 protected media and Calendar/iCal remain in verification.
- Required completion gate: successful Actions attached to the final commits in both repositories; no unexpected failures, skips, or TODOs.

## Limits and next proposal

No deployment, production-data access, migration/backfill, global `/uploads` restriction, OTA, native build, or store submission is included. Global `/uploads` remains unrestricted. Legacy databases deliberately show unavailable until the separately authorized Phase 1 migration is installed. Missing availability headers also disable new relationship actions. A mutation already accepted by the server may complete after navigation; its old response cannot modify the new screen, and a later reload shows server truth. Physical-device validation remains a later release gate; this phase uses synthetic API, DOM, shared-controller/component, and parsing checks.

Recommended Phase 3B is **scope/audit only** for manual Piece ↔ Test Tile list/select/link/view/unlink on website and shared mobile, reusing the Phase 1 service and Phase 2J media contracts. Audit legacy behavior, ownership, availability, deletion safety, session isolation, and the existing Test Tile viewer before proposing implementation. Exclude automatic selection/inference, reverse editing, Firing/Pricing-to-Sale changes, schema changes, production access, deployment, and builds. Do not begin Phase 3B without separate approval.
