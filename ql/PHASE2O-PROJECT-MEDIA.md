# Phase 2O — Project media only

Bases: backend `56001539fd5a7850bfbd4af1e70305b04498ca6a`; mobile `9c17dbb04e33357216aabdf33f139e78b94d5ce9`. Both branches: `ql/phase-2o-project-media`.

## Model and classification

`project_photos`: `id` primary key, `project_id` required parent FK (delete cascade), `filename`, `original_name`, `sort_order` (historical default 0), `created_at`. Ownership is `project_photos.project_id -> projects.id -> projects.user_id`. No Project publication/share visibility field or intentional anonymous Project-photo delivery exists in active source. Project status, filename, and age convey no publication authority. Authenticated owner responses advertise `photoDelivery: owner-protected`; `photoVisibility: legacy-ambiguous` preserves historical uncertainty. No DB/schema migration, classification backfill, or historical filename rewrite.

## Exact consumers

| Consumer | Phase 2O behavior |
| --- | --- |
| GET /api/projects, GET /api/projects/:id, GET /api/projects/:id/photos | Owner-scoped ordered photo IDs/filenames with delivery contract |
| Website loadProjects card gallery | Each photo fetched through authenticated protected route |
| Website gallery full-size lightbox | Reuses loaded blob; no static protected fallback; stops card click propagation |
| Website editProject/openProjectModal | Existing metadata editor, no persisted-photo preview; guarded asynchronous open |
| Website create preview (previewProjectPhoto) | Local FileReader only; stale preview rejected after session change/modal close |
| Website create/uploadProjectPhotos/deleteProjectPhoto/deleteProject | Existing workflows preserved; photo and whole-record deletion made reference-safe |
| Mobile ProjectsScreen | Existing metadata-only list and text Share All; photo arrays cleared from state on session rotation |
| Mobile ProjectDetailScreen | EditableProjectPhoto ordered gallery; protected pixels also used by existing crop editor; camera/library add; targeted replacement and refetch |
| Mobile AddProjectScreen | Existing local camera/library create preview; no saved-photo preview in metadata editor; stale picker/save continuations rejected |
| Mobile detail Share and Calendar | Text/metadata only; photos omitted, unchanged |
| Existing backend PDF and mobile document utilities | No Project-photo export/print/PDF consumer found; none added |
| Generic filename pixel edit | Existing copy-on-write path retained; ambiguous owned references reject. New mobile Project editor uses explicit parent/photo ID instead |
| Account reset/deletion, reference registry, integrity audit | Existing registry already includes project_photos; unchanged |
| Compiled historical web/mobile clients | Remain legacy static consumers; no rebuild or deploy |

No Project reorder endpoint or UI exists. No active indirect Project-photo renderer in Piece History, other studio categories, public gallery, or shop was found. Shared filename references are handled conservatively even without an intentional reuse feature.

## Protected route and clients

`GET /api/ql/projects/:projectId/photos/:photoId` requires auth, verifies Project owner and exact photo membership, resolves only safe flat regular image files, rejects symlinks/traversal/missing/unsupported files, and fails closed on cross-account or unresolved filename references across the existing registry. Foreign/missing/wrong-parent/wrong-photo responses are equivalent generic 404. Headers are private/no-store and nosniff. No filesystem paths disclosed.

Website per-view AbortController, generation/token guards and request serials prevent stale metadata/images/preview completions. Logout/account replacement/current Project 401 clear DOM, local preview, modal values, lightbox pixels, and blob URLs. Leaving Projects also clears state. Individual failures stay local; metadata/edit controls remain usable. Viewing is GET-only.

Shared iOS/Android `projectMedia` subscribes to the established private-media session lifecycle. Cache identity includes account, session generation/nonce, Project ID, photo ID and current filename; credentials appear only in headers. Logout/session expiry/replacement clears tracked temporary files and blobs. Late downloads are deleted, partial failed files cleaned, stale auth failures ignored by the component, and old-session pixels masked immediately. Project API calls validate session around token lookup, photo preparation and response handling. Prior category loaders and the core API/session helper are unchanged.

## Multi-photo and mutation integrity

Every image is independently addressable by Project plus photo ID. Existing tied sort_order values retain insertion ordering using rowid as the tie-breaker; no historical order values rewritten. New batches append at MAX(sort_order)+1 in request order, atomically. Targeted replacement updates one row in place, retaining its ID, order and creation timestamp; other photo rows and Project metadata remain intact. Multiple files with one replacement target reject.

Photo and Project deletion commit metadata first, then use the existing reference-aware cleanup registry. Shared references (including other accounts/categories) retain physical files. Failed batches/replacements/deletions roll back; uncommitted uploads are cleaned. Transport failure after a successful replacement cannot delete committed bytes. Physical cleanup failure leaves an unused file rather than corrupting a saved record. Foreign mutations are denied.

## Verification

Synthetic/disposable databases and uploads only; Node 22 matches CI.

- New backend/web: 35/35 (23 API/mutation, 12 DOM).
- Complete backend/QL: 628 passing executions (464 TAP + 164 individual PASS checks; summary lines excluded).
- New mobile: 19/19; complete mobile: 180/180.
- Shared JavaScript parsing: 129/129.
- Strict Phase 1 readiness gate: 37/37.
- Zero unexpected failures, cancellations, skips or TODOs in final verification.
- Both exact pushed heads require successful GitHub Actions before closure.

## Boundaries, remaining risk, rollback and next task

Global `/uploads` remains unchanged and anonymously accessible by known URL. Old contracts without owner-protected metadata retain static compatibility; protected-delivery failure never falls back to static. Historical/compiled clients and previously downloaded pixels remain outside revocation. App/OS-generated temporary artifacts cannot be certified securely erased, and a process crash can leave session-specific cache files. Ambiguous filename collisions intentionally fail closed. Historical publication remains unresolved.

Prior completed categories, Events, Profiles/avatars, and merchant/shop media remain unchanged. No production data access, deployment, migration/backfill, mass filename rewrite, OTA, native build, store submission, search, voice, Esme, or interface redesign. Only explicit user-initiated replacement creates a new upload reference.

Rollback is code-only to the recorded Phase 2N bases while retaining static compatibility.

Recommended Phase 2P: **Protect Event media only (`events.image_filename`)**. First audit account ownership and any intentional public/calendar/share semantics. Then protect verified private/account-owned Event reads and existing website/shared iOS/Android consumers, preserving intended publication, historical ambiguity, metadata-only exports, reference-safe mutations and legacy compatibility. Keep Project and all completed categories unchanged; exclude Profiles/avatars/shop and global `/uploads` restriction. No deployment or migration. Phase 2P has not begun.
