# Phase 2M — Pricing media only

Bases: backend `2038e2ffb24e22103ddafa0d2f20b7548e360c5b`; shared mobile `43b8f7028a5e72e8bf90dea8901cc6f9c24f83c7`.
Both branches: `ql/phase-2m-pricing-media`.

## Model, ownership and delivery

`pricing_calculations` has a text `id`, required `user_id` referencing `users.id` with account-delete cascade, optional name/description, required inputs/result JSON, one optional `photo_filename`, and creation time. Direct Pricing `user_id` is authoritative. A linked Piece is not the owner or visibility authority. There is no Pricing publication flag, anonymous Pricing-photo endpoint, or intentional public Pricing-photo sharing mechanism in the source.

Owner list/detail/create/update JSON adds `photoDelivery: owner-protected` and `photoVisibility: legacy-ambiguous`. This is a delivery contract, not reclassification of historical photos. No schema, filename, stored reference, or visibility backfill changes.

`GET /api/ql/pricing-calculations/:pricingId/photos/:filename` requires authentication and an exact account/Pricing/stored-photo match. The filename identifies the current single photo and prevents a cached request for replaced pixels from silently addressing a new image. It is not evidence of visibility. Flat regular image files only; traversal, symlinks, absent files and unsupported extensions fail closed. All registered stored-file slots are checked against verified ownership, including collisions with foreign or unresolved references in another media category. Foreign/missing/wrong-photo requests return the same generic 404. Responses are private, no-store, nosniff; errors disclose no filesystem path.

## Complete consumer audit

| Consumer | Phase 2M result |
| --- | --- |
| Website Pricing saved-calculation cards/list | Protected blob images for the explicit owner contract |
| Website reopen/detail/editor | Same protected loader inside the existing calculator; inputs, result, name, notes and manual save remain intact |
| Website create/replacement preview | Local FileReader data URL; delayed reader guarded against session/view changes; cleared on page/session teardown |
| Website save/create/update/delete | Original APIs retained; stale completions cannot populate a replacement session; saved-card images reloaded after changes |
| Mobile PricingCalculatorScreen list | Shared PricingPhotoImage and pricingMedia authenticated loader |
| Mobile reopened detail/editor | Same component for saved image; selected local replacement remains a local preview |
| Mobile create/update/delete | Existing adapter retained with a Pricing-only session guard before photo preparation/token completion and after server completion; pending alerts/deletes cannot target replacement account |
| Connected Piece History | Pricing record/relationship metadata remains read-only; renderer never renders Pricing photos; no new History image UI |
| Piece-linked Pricing | `ql_piece_pricing` verifies same-account Piece and Pricing; relationship unchanged by photo replacement; deletion cascades only the Pricing link |
| Piece cost/pricing panels | Independent numeric cost inputs/results, not consumers of `pricing_calculations.photo_filename` |
| Sale / Piece photo reuse | No active Pricing-photo copy/reuse consumer found; Sale and Piece media unchanged |
| Pricing print/export/PDF/share | No dedicated Pricing photo export/print/share renderer found; server PDF and mobile recordDocuments do not embed Pricing photos; no new feature |
| Generic filename photo editor | Existing reference-aware ownership/copy-on-write behavior retained; its strict gate regressions still run |
| Account removal / shared-file registry | Pricing is already registered for reference checks; account lifecycle unchanged |
| Compiled historical web bundles and older mobile clients | Not rebuilt; static dependency remains and blocks global restriction |

## Client isolation

Website loading captures token plus generation, aborts invalidated views, rejects stale responses, revokes blob URLs, and clears Pricing DOM/state on navigation, logout, session expiry and account replacement. Metadata, save completion, and local-file reads are also guarded. Photo failure remains local; calculator fields/actions still work. Protected failures do not fall back to static delivery. Viewing makes GET requests only.

Mobile cache identity includes session generation/account/Pricing ID/current filename. iOS/Android download to session-specific temporary files with bearer headers; web uses temporary blobs. Credentials are never persisted in image URLs. Logout/account/session replacement clears cached files; stale native downloads are deleted and stale blobs revoked. Hooks immediately suppress old session identities. Fetch/decode failures render a local placeholder. The core request adapter accepts an optional session validator used only by Pricing; existing callers retain their behavior. All earlier-category tests remain unchanged.

## Mutation / cleanup

Pricing create/update keep their full-record manual-save contract. Ownership is checked before replacement; the update is scoped by Pricing ID and user ID. Unrelated fields and links are preserved when replacing a photo with the existing editor payload. Existing single SQL writes commit before file cleanup. Old-file and error-path cleanup uses the cross-category reference registry. SQL failures retain original records/bytes, uncommitted uploads are discarded, cleanup failure leaves unused bytes, and a transport failure after commit cannot delete the committed replacement. Pricing deletion retains referenced shared files and preserves the Piece. No migrations run outside disposable tests.

## Verification

- Focused backend/web: 29 tests (19 backend, 10 DOM).
- Complete backend/QL: 557 passing executions (393 TAP + 164 individual PASS checks).
- Focused mobile: 18 tests; complete mobile: 140/140.
- Shared JavaScript parsing: 125/125.
- Strict Phase 1 readiness: 37/37.
- Zero unexpected failures, cancellations, skips or TODOs required; exact-head GitHub Actions must pass before closure.
- All databases and uploads used for tests are synthetic and disposable.

## Compatibility, risks, rollback and next task

Global `/uploads` is untouched and remains anonymously readable with a known filename. Historical/old-server contracts without owner-protected metadata retain static fallback. Compiled historical web clients and old mobile clients still depend on static delivery; exported/downloaded copies cannot be revoked. Ambiguous cross-account filenames are intentionally denied by the protected route. This phase does not make old static URLs private.

No production data access, deploy, migration/backfill, filename rewrite, OTA, native build, store submission or deferred-category implementation. Code-only rollback to the recorded Phase 2L bases; retain `/uploads` compatibility.

Recommended Phase 2N: **Protect Sales media only (`sales.image_filename`)**, auditing Quick Sale/regular Sale, Piece-derived image reuse and fallback, backend/web/shared mobile, existing History/export/print/share consumers, ownership, session isolation and reference-safe mutation cleanup. Do not change Piece media or Project/Event/Profile/shop media, and do not restrict global `/uploads`. Phase 2N is not started.
