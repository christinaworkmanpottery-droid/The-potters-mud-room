# Phase 2L — Firing media only

Base: backend `c511a76aaed721a52ba9f7129c62d2d5abd3b848`, mobile `2ea47b0fbcb0a7695ab7d3b3a7a114efabf6d1ca`.
Branch in both repositories: `ql/phase-2l-firing-media`.

## Audit and contract

`firing_photos` has a text primary key `id`, required `firing_id` referencing `firing_logs.id` with cascade deletion, required `filename`, optional `original_name`, `sort_order` (default zero), and `created_at`. The verified authority is `firing_logs.user_id`, not a linked Piece or filename. Each photo has its own identity. There is no Firing publication flag, public Firing photo route, or intentional anonymous Firing sharing surface in source.

Authenticated owner JSON now advertises `photoDelivery: owner-protected`; `photoVisibility` remains `legacy-ambiguous`. This is current delivery policy, not historical reclassification. No schema migration, reference rewrite, rename, backfill, or inferred publication status.

| Surface | Result |
| --- | --- |
| GET `/api/firing-logs`, `/:id`, `/:id/photos` | Owner-verified metadata, per-photo delivery contract; parent contract on list/detail |
| Website compact list | Metadata only; no image added |
| Website cards | Every image uses Firing ID + photo ID protected loading |
| Website detail/gallery/lightbox | Protected blobs; independent failures; original controls preserved |
| Website existing-photo editor | Protected previews; immediate upload/delete retained; delete completes before refresh |
| Website new-photo preview | Local blobs; revoked on removal, close, navigation, or session teardown |
| Website photo reorder modal | Protected thumbnails with stable photo IDs |
| Website Kiln Journal print | Copies rendered protected blobs, waits for image decode, tracks and closes windows on session cleanup |
| Mobile FiringLogsScreen | Metadata-only list; no image added |
| Mobile FiringDetailScreen | Shared protected editable photos; session-safe metadata completion |
| Mobile AddFiringScreen | Protected existing previews; local new previews; replacement scoped to parent + photo ID |
| Mobile ReorderPhotosScreen | Firing branch uses shared protected component; Piece branch unchanged |
| Mobile print/PDF/share and both server CSV handlers | Metadata only; no photo consumer |
| Connected Piece History and legacy Piece detail Firing section | Firing metadata only; no `firing_photos` query or image UI added |
| Indirect references/cleanup | Piece links, Firing deletion/bulk deletion/account deletion, generic filename editor and global reference registry audited; Phase 1 relationship/deletion behavior retained |
| Compiled historical website app bundles/old clients | Not rebuilt; keep static compatibility; remain part of later global restriction readiness |

## Backend

`GET /api/ql/firing-logs/:firingId/photos/:photoId` requires auth, joins the selected photo to the selected account-owned parent, validates a flat regular stored image file (no symlinks), and checks every known stored-file slot against verified account ownership. Foreign/unknown ownership collisions fail closed, including another category referencing the same filename. Foreign/missing/wrong-parent/unsafe references return the same generic 404. Successful responses use `private, no-store` and `nosniff`; errors reveal no filesystem path.

`POST /api/firing-logs/:id/photos` retains multi-upload and adds optional `replacePhotoId` for exactly one uploaded replacement. The target ID must belong to that Firing. Inserts/replacement commit as one immediate transaction. Replacement retains photo ID, ordering, unrelated photos, and all Firing metadata. Old files are cleaned only after commit with the existing cross-category reference-aware lifecycle. The error path also checks references: even a response failure after commit cannot delete the committed replacement. Cleanup failure retains unused bytes rather than damaging database state.

Reorder requires a complete unique permutation of the Firing's current photo IDs and commits atomically. Duplicate, partial, foreign, and SQL-failure cases leave the order unchanged. The legacy photo-delete denial remains 403 for compatibility; protected *delivery* uses generic 404. Firing deletion and Piece relationship safety remain unchanged.

## Website/mobile isolation

Website loaders capture session token/generation, abort and invalidate old image work, revoke blobs, clear DOM/lightbox/editor/reorder/print surfaces, and guard delayed metadata responses. Failures are per image, with no static fallback for protected photos. Viewing issues GETs only.

Shared mobile `firingMedia.js` uses bearer-authenticated downloads, no credential in persistent URLs, account/session/Firing/photo/filename cache identity, local native files or web blobs, session cleanup, and stale-download rejection for iOS and Android. `FiringPhoto.js` hides stale rendered identities immediately, guards editor saves, handles auth expiry only for the current request, and provides a local image-error placeholder. `EditablePhoto` gains only an optional error callback; existing category behavior is unchanged and covered by the complete suite. The upload adapter now normalizes the server's photo-array response to the one uploaded photo so retry state stores the correct identity.

## Verification and release limits

Focused backend/web: 34 tests (24 backend, 10 DOM). Focused shared mobile: 16 tests. Complete backend/QL: 528 passing executions (364 TAP + 164 individual PASS checks). Complete mobile: 122/122. Shared JS: 123/123. Strict Phase 1 gate: 37/37. Zero unexpected failures/cancellations/skips/TODOs. Exact-head Actions remain required after push. Tests use synthetic disposable databases/files only.

Global `/uploads` is unchanged and publicly reachable when a filename is known. Unknown historical/old-client contracts retain static fallback. Existing compiled clients and already downloaded/exported copies cannot be revoked by this phase. Protected collision handling intentionally denies ambiguous files. These are remaining privacy limitations, not evidence that static URLs are now private.

No production data accessed. No deployment, migration/backfill, OTA, native build, store submission, new History UI, or change to deferred media categories. Rollback is code-only to the two recorded Phase 2K bases; stored references and schema have not changed. Do not restrict `/uploads` during rollback.

Recommended Phase 2M: **Protect Pricing media only (`pricing_calculations.photo_filename`)** across backend, website, shared iOS/Android and any existing Piece History/export consumers; audit ownership, classification, mutation/reference cleanup and legacy fallback. Exclude Sales, Projects, Events, Profiles/avatars, shop media and global `/uploads` restriction. Phase 2M is not started.
