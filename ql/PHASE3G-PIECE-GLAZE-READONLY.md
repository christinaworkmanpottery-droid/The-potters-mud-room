# Phase 3G — per-layer saved Glaze read-only View

Both branches: `ql/phase-3g-piece-glaze-readonly`.
Exact remote parents: backend `11eda009d13608d1932a835b13452a2f602a1e09`; mobile `cb3731011d7f1e1dbd824c0404d74c480ba32b4d`.

## Preserved data contract

`piece_glazes` remains the sole ordered, row-per-layer model. No schema, endpoint, migration, junction, snapshot, editor, POST/PUT, alias, normalization, deduplication, or backend-runtime changes. A layer's saved ID is necessary but not sufficient for View. Names, brand, recipe, notes, historical text and route snapshots never authorize it.

Each returned layer renders in place, including manual entries, repeated Glaze IDs and nonunique persisted positions. Identity includes both row ID and returned array position plus persisted layer_order. Website retains existing coats/method display; mobile replaces the comma-separated summary with ordered rows including existing descriptive data. Null names use a neutral fallback; blank library names remain blank. Existing owner-filtered SQL COALESCE precedence is unchanged. Manual text remains stored unchanged while valid saved references display live names.

Glaze deletion retains layer rows/IDs, position, coats, method and notes, clears glaze_id and retains nonempty custom_name or copies the deleted name. Existing inconsistent/unsupported-reference 409 safeguards are unchanged. Piece deletion removes layers and preserves library Glazes. Connected History retains its independent current ordering, repeated/manual layers, foreign/dangling exclusion and undated chronology. CSV is unchanged and gains no Glaze fields.

## Website

Each currently verified saved layer gets a compact View. Preflight independently checks owned Glazes then refetches the Piece. Every open/Retry clears prior content and repeats the owned Glaze fetch and Piece/layer confirmation. Requests bind account/token, Piece, row, Glaze, array position, persisted position and generation. Removed/recreated/reordered/reassigned/manualized layers fail generically rather than following a replacement.

The existing Glaze modal renders photos, brand/type, recipe/ingredients, notes, links and child tests. Loading, unavailable, error and Retry are supported. Duplicate/Edit/Add Photo are disabled, nonfocusable, hidden with effective inline display and disconnected handlers; normal library controls are restored in library mode. The existing child-test display contains no editing controls.

Close/replacement/Piece/session invalidation clears top-level media and child-test blobs, image handlers, cache and lightbox. Late downloads are rejected/revoked. Closing returns focus to the originating layer launcher, including after Retry when that launcher remains available.

## Mobile

The ordered Piece layer component requires server-confirmed Piece state, synced identity, connectivity and focus before starting launcher preflight. Local, unsynced, unverified and offline descriptions cannot authorize View. Reconnect re-fetches current Piece/layer state. A sync notification does not promote a local screen.

Navigation sends IDs/positions plus Piece-origin/read-only/session context, never a trusted Glaze object. GlazeDetailScreen independently authorizes the current Glaze list and refetches Piece before rendering. Account/session/Piece/layer/Glaze/position/focus/connectivity changes remount and dispose the prior request generation. Loading, unavailable/error and Retry reuse the existing screen and normal navigation Back to the originating Piece without a new return stack.

Read-only detail exposes no Duplicate/Edit/Delete/Add Photo/reorder/delete-photo controls or editable image component. Mutation handlers are guarded; noneditable GlazePhotoImage handles photos. GlazeClayTests is rendered once (the accidental duplicate was also removed from normal detail). Piece-origin child tests use freshly authorized clay_tests and an isolated display branch with no editor hooks, Clay-library fetch, picker, selection or save/delete setup. Session helpers import from canonical pieceMedia, with runtime coverage.

## Media

Phase 2H/2I protected parent/photo and Glaze/child-test routes, ownership, file checks, revision-aware caches, account/session isolation and stale-download rejection are unchanged. Known-private media never falls back to /uploads. Global /uploads remains unrestricted. Existing mobile cache architecture is preserved.

## Verification

Node 22; repository-declared dependencies and lockfiles unchanged. Disposable local databases and mocked device/media environments only. Local backend source matches the exact Phase 3F remote tree; mobile runtime/test/dependency source matches, while unrelated historical assets/docs are not included in the patch. Remote commits are based directly on the exact parent commits above.

- New backend/web: 46/46.
- Complete backend/QL: 1,146 passing (909 TAP executions + 237 standalone checks).
- New mobile: 50/50; complete mobile: 623/623.
- Shared JavaScript parsing: 152/152.
- Strict Phase 1 gate: 37/37.
- Phase 3A–3F, Phase 2 protected media, Calendar/iCal: PASS.
- Final failures/cancellations/skips/TODOs: 0/0/0/0.
- Exact-head non-deploy Actions SHAs/run IDs are in the completion report.

One historical isolated Glaze-media test harness now loads the existing viewerControl helper, since session cleanup uses that control hardening. Earlier Piece-screen mobile harnesses register the new leaf component; existing assertions remain intact.

## Deferred physical validation

No native builds. Later device checklist: repeated-layer scrolling; View from different layers sharing one Glaze; correct Piece return; Android Back; iOS gesture Back; protected Glaze and child-test photos; offline/Retry/reconnect; account replacement; absence of editable photo gestures/actions. Automated controller, DOM and hook tests do not substitute for physical-device validation.

`events.contact_id` remains a separate pre-release database-initialization maintenance task at unchanged priority; no repair here.

Production untouched: no production access, deployment, migration/backfill, OTA, native builds or store submission.

Recommended next task (not started): **Phase 3H scope/audit only — Phase 3A–3G cross-workflow readiness and closure review**. Audit Piece-origin Pricing, Firing, Test Tile, Sale, Clay and per-layer Glaze workflows together for lifecycle, ownership, read-only/mutation boundaries, media cleanup, offline/reconnect and return behavior; identify any blockers and propose the smallest next slice. No new relationship model, implementation, production access or release action during that audit.
