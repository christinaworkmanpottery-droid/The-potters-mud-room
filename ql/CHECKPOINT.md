# Phase 2H — Glaze library photos only

Backend base: 65fa3123c62b47e9973b64e37fb24dee09bc2090.
Mobile base: b7b97529c3faab17764f48159947b4f368157f26.
Both branches: ql/phase-2h-glaze-media. Synthetic local verification only; production untouched.

## Exact model and consumers

`glaze_photos` belongs to `glazes` via `glaze_id`; `glazes.user_id` is authoritative ownership. Photo columns: id, glaze_id, filename, original_name, sort_order, created_at, photo_label, notes. There is no Glaze publication field. Recipe/commercial type and photo labels imply no visibility.

- Authenticated `GET /api/glazes` returns the owner's library, ingredients, ordered library photos and separately nested clay tests. There is no separate Glaze detail JSON endpoint; clients select the record from the list.
- Website `glazeCardView`: library thumbnail gallery, labels/notes and photo-delete controls. `glazeListView` compact mode has no image. `openGlazeViewModal`: library photos and full-size lightbox. Both card and modal also render separate deferred clay-test images.
- Website `openGlazeModal` / `saveGlaze`: manual record fields and optional selected-file upload, no persisted-photo preview. Separate `openGlazePhotoUpload` / `uploadGlazePhotoModal`: selected-file upload with label/notes. Existing workflows preserved.
- Shared mobile `GlazeDetailScreen`: ordered library photos, pixel-edit previews via EditablePhoto/crop tool, add, delete, and reorder. Updated to EditableGlazePhoto and record-scoped save. `GlazesScreen` list and create/edit form have no persisted-photo image consumer; duplicate clears photos. No new thumbnails/UI added.
- Piece glaze selectors/layers, Connected History, Glaze chemistry and manual Glaze metadata consume identity/attributes, not glaze_photos bytes. Piece gallery/lookup consume Piece photos.
- Mutations: POST /api/glazes/:id/photos; PUT /api/glazes/:id/photos/reorder; DELETE /api/glaze-photos/:id; DELETE /api/glazes/:id; bulk record deletion; account deletion/reset; legacy PUT /api/photos/by-filename/:filename. Existing Phase 1 lifecycle and generic filename copy-on-write protections remain intact.

## Classification and backend

Like Clay, current verified owner responses add `photoDelivery: owner-protected` and `photoVisibility: legacy-ambiguous`. Delivery policy is distinct from unknowable historical publication. No historical rows, filenames or visibility are rewritten. Unlike Piece, Glaze has no explicit public state. Payloads without owner-protected delivery retain legacy URLs. Existing public Piece/community behavior stays unchanged. Protected failure never falls back to static.

`GET /api/ql/glazes/:glazeId/photos/:photoId` authenticates, joins parent/photo/owner, resolves only safe regular image files, rejects cross-account filename references across registered media slots, rejects unsafe paths/symlinks, and sends private/no-store plus nosniff. Foreign/missing requests use identical `404 {error: "Photo unavailable"}`; unauthenticated requests retain 401. No filesystem path is returned.

## Website and mobile lifecycle

Website list/modal loaders fetch with Bearer headers and no-store; thumbnails and lightbox use temporary blobs. Auth replacement/logout clears Glaze data and DOM; view/modal closure or navigation aborts pending work and revokes URLs. Generation/token guards reject late image and list responses. Scoped view cleanup preserves Glaze choices needed by other forms. Image failures remain local.

Mobile glazeMedia subscribes to existing Piece session rotation without modifying Piece/Clay loaders. Account/generation/Glaze/photo/filename revision define cache identity. Native destinations include session nonce; credentials appear only in headers. Logout/account replacement/expiry clear tracked native files/web blobs; late and partially failed downloads are discarded. Hooks mask stale identities and remount editors. Current-generation 401 handles session expiry; stale failures cannot expire a newer account. Native/platform-generated temporary artifacts cannot be certified as securely erased.

## Mutation isolation

Optional `replacePhotoId` replaces exactly one owned library photo in an immediate transaction, preserving ID, label, notes, ordering and original creation timestamp. New upload bytes get a new reference; other photos and shared old bytes remain intact. Unlike Clay, ordinary uploads at the tier limit still reject (403), never implicitly replace. Foreign photo IDs/parents reject. Reorder requires an exact unique permutation of owned photo IDs. Delete uses Phase 1 owner-scoped lifecycle. DB work precedes physical reference-checked cleanup; simulated DB failures preserve existing rows/bytes and cleanup failures leave harmless unused files. Legacy filename editing retains its existing copy-on-write and ambiguous-reference conflict behavior.

## Explicit deferred boundary

`glaze_clay_tests.photo_filename` is a separate category even when nested in GET /api/glazes. Its API, website card/detail/test-modal images, and mobile GlazeClayTests continue existing static delivery. No delivery contract is attached to test rows. Test Tiles (`test_tiles` photo slots), community combos (`glaze_combos`), Firing, Pricing, Sales and Project media are unchanged. Shared-file checks deliberately still protect references in these categories; this does not migrate their loaders.

## Verification and limitations

- Complete backend/QL: 461 passing executions (297 Node test executions + 164 individual script PASS checks; aggregate summaries excluded).
- New backend/web: 30/30 (20 backend/isolation, 10 DOM), included in the total.
- Strict Phase 1 gate: 37/37.
- Complete mobile: 79/79; 15 new Glaze regressions.
- Shared JavaScript parse: 119/119.
- Zero unexpected failures in final runs. Exact-head GitHub Actions results are recorded in the final handoff.
- Backend tests use disposable databases/files and actual HTTP routes. Website tests execute actual render/load functions in JSDOM; mobile loaders use mocked native downloads/files. No claim of real-device/Safari/crop-tool validation. No native build was made.

## Remaining risks, rollback and next slice

Global `/uploads` is unchanged: anyone possessing an old Glaze file URL can still retrieve it anonymously. Older clients, copied URLs and prior caches remain outside protected loaders. Historical publication remains unknown. Cross-account filename collisions fail closed and need later reviewed remediation. No global confidentiality/secure-erasure claim. Existing token-revocation semantics and platform-dependent HEIC display are unchanged.

Rollback paired Phase 2H code to its stated bases; no schema/data migration or filename reversal required. Nothing deployed, migrated, backfilled, submitted, built natively or delivered OTA. No Esme, voice, search or redesign.

Exact recommended Phase 2I (not started): audit and protect **Glaze/clay-test photos (`glaze_clay_tests.photo_filename`) only** across its API, website card/detail/test modal and shared mobile GlazeClayTests. Verify ownership through Glaze, use unknown-historical-visibility versus owner-delivery distinction, scoped edits/shared-file protection/session isolation, and keep Test Tiles/community combos and global `/uploads` unchanged. Verify, commit/push, and stop before another category.
