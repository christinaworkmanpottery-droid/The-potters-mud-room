# Phase 2N — Sales media only

Bases: backend `cc8f98d5fe636b997af65776e840538d9deecac9`; mobile `f0df3f3fbed4f11b5219336c6003d051d2827735`. Branches: `ql/phase-2n-sales-media`.

## Ownership and classification

`sales.image_filename` is one optional file slot. Direct `sales.user_id` is authoritative, independently of `piece_id`, Contact, quantity, date, or transaction workflow. No Sales publication flag or legitimate anonymous Sale-photo mechanism exists in the active source. Owner API responses advertise `photoDelivery: owner-protected`, while `photoVisibility: legacy-ambiguous` records the absence of proven historical publication classification. No historical data or references are rewritten.

`GET /api/ql/sales/:saleId/photos/:filename` authenticates, matches Sale/account/current filename, permits only safely resolved flat regular image files, rejects symlinks and invalid paths, and denies collisions with any foreign/unresolved stored reference in the existing cross-category registry. Foreign/missing/wrong-photo requests have generic equivalent 404 responses. Headers: private, no-store, nosniff. File paths are not disclosed. Ownership never derives from possession of a filename or linked Piece alone.

## Exact active consumer inventory

| Surface | Behavior |
| --- | --- |
| Website Sales list and card modes | Protected Sale blob images |
| Website Sale details | Protected image; metadata/actions survive image failure |
| Website regular Sale create/edit/reopen | Local chosen-file preview; saved Sale image uses protected loader |
| Website Quick Sale / bulk entry | Initially creates image-free Sale rows atomically; normal Sale editor adds/replaces images afterward |
| Website selected Piece preview before save | Existing Piece preview retained; it is not yet `sales.image_filename` and Piece delivery is outside this phase |
| Website photo replacement | Existing multipart Sale save; guarded delayed FileReader and save/list/detail completions |
| Mobile SalesScreen | Shared SalePhotoImage list thumbnails |
| Mobile SaleDetailScreen | Shared SalePhotoImage with local error placeholder |
| Mobile AddSaleScreen individual/edit | Saved image through useSalePhotoUri; local picker/camera/crop preview; one multipart save commits metadata and replacement together |
| Mobile AddSaleScreen market/bulk mode | Same existing image-free batch workflow; resulting Sale edited through individual editor |
| Mobile selected Piece preview | Existing Piece preview retained; copied on backend save |
| Existing mobile photo/receipt input | Same single Sale image slot, protected on reopening; no separate receipt image renderer |
| Standalone POST /api/sales/:id/photo | Legacy-compatible owner-scoped upload/replacement; validation and uncommitted-file cleanup repaired |
| Generic stored-photo edit / account deletion | Existing reference-aware machinery retained, no shared-helper modifications |
| Connected Piece History | Sale metadata only; no Sale images rendered; read-only renderer/service unchanged |
| Website Sales export and mobile ExportActions | Authenticated metadata-only CSV; no image URLs or embedded images |
| PDF/print/share/transaction consumers | No additional active Sales image renderer found in generate-pdf.js or mobile recordDocuments; no new export features |
| Compiled historical website/mobile bundles | Unchanged legacy static consumers; still block global restriction |

## Copy/reference and mutation safety

Current regular create/update copies the selected Piece primary photo to a new unique Sale filename, with an actual same-account Piece check and cross-category ownership/collision verification before copying. Uploaded Sale images are independent files. The current write path does not assign the Piece filename directly. Historical shared references are representable; their prevalence is unknown because production data was not accessed. Both independent copies and direct shared references are covered with synthetic tests.

Sale replace/delete retains any file still referenced by a Piece, Sale, or another registered record. A Sale copy can be replaced without changing Piece bytes. Physical cleanup occurs only after metadata commits; cleanup failure retains unused bytes rather than corrupting records. Response failure after commit cannot delete the committed replacement. Failed metadata/Piece status writes roll back and discard uncommitted uploads/copies. The legacy photo endpoint now discards denied/failed uploads safely. Sale/Contact ownership and Phase 1 rollback checks remain intact. Relinking a Sale restores the previous sold Piece only when its last Sale is removed; foreign Pieces cannot be changed.

Quick Sale and regular Sale are not merged or redesigned. Bulk remains a transaction; regular metadata, linked Piece status, and optional image commit together. Mobile no longer saves metadata then performs a second photo request. The editor's crop is a local replacement pending Save, avoiding generic filename-only mutation of a shared Piece asset. Dismissing a selected preview preserves the existing saved image, as before; no image-delete feature was added.

## Session and image lifecycle

Website uses abortable per-view authenticated fetches, generation/token checks, per-scope request serials, stale response rejection, and blob revocation. Closing/reusing a modal or leaving Sales invalidates its work. Logout, account replacement, and current Sales 401 clear Sales state and previews; an old 401 cannot clear a new session. Viewing sends GETs only and image errors stay local.

Shared iOS/Android temporary file and web blob caches include account/session generation/nonce, Sale ID and current image filename. Bearer credentials are headers, never stored in image URLs. Logout/account replacement/session expiry clears caches; late downloads/blobs are discarded. Hooks immediately hide old-session pixels; list/detail/editor async completions and local picker results are guarded. Sales API operations validate session before and after async photo preparation, token reads and response handling.

## Verification

- New backend/web: 36/36 (24 API/mutation and 12 DOM tests).
- Complete backend/QL: 593 passing executions (429 TAP + 164 individual PASS checks).
- New mobile: 21/21; complete mobile: 161/161.
- Shared JavaScript: 127/127 parse.
- Strict Phase 1 readiness: 37/37.
- Zero unexpected failures, cancellations, skips or TODOs required. CI on both exact heads is required for closure.
- All databases and upload fixtures are synthetic/disposable; no production data access.

## Compatibility, remaining risk, rollback, next phase

Global `/uploads` is unchanged and remains anonymously accessible to anyone possessing an existing URL. Old-server contracts without owner-protected metadata retain static fallback. Protected failures never fall back to static delivery. Historical/compiled clients and pre-save Piece previews remain legacy consumers. Previously downloaded/exported pixels cannot be revoked. Ambiguous collision records intentionally fail closed on the new route. These protections do not revoke old URLs or prove historical visibility.

No deploy, production access, migration/backfill, filename rewrite, OTA, native build or store submission. All prior protected categories and Project/Event/Profile/shop media remain unchanged. Rollback is code-only to the recorded Phase 2M bases; preserve static compatibility.

Recommended Phase 2O: **Protect Project media only (`project_photos` through verified Project/account ownership)**. Audit all Project list/detail/editor/upload/replacement/delete and existing History/export/print/share consumers; add owner-scoped backend delivery and website/shared iOS/Android session-isolated loading with cross-account collision and reference-safe cleanup regressions. Preserve historical ambiguity, all earlier category behavior and global `/uploads`; leave Event/Profile/shop unchanged. Do not deploy or migrate. Phase 2O has not begun.
