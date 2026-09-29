# Phase 2G — Clay media only

Base backend: df2a11818417acb04a3237100c283e2d3a9d60c0.
Base mobile: 4eb4481dca4a38ab720621ee0efbdf9b6542338b.
Both branches: ql/phase-2g-clay-media. No production access or deployment.

## Model and classification

Clay media is `clay_photos -> clay_bodies.user_id`. Clay JSON CRUD/list/detail is authenticated and owner-scoped. There is no Clay publication flag, anonymous Clay gallery or explicit public Clay concept. Photo labels (raw/fired/etc.) do not change ownership. Do not infer publication from filenames, UUIDs, age, naming or route shape.

Two separate response fields prevent inventing historical truth:
- `photoVisibility: legacy-ambiguous`: no historical publication assertion; no database mutation.
- `photoDelivery: owner-protected`: current owner-linked Clay responses use authenticated delivery. This is an additive delivery contract, not reclassification of stored visibility.

Older server payloads without the delivery contract retain static compatibility. There is no new public Clay state or publication control. An explicitly public concept must be separately designed before being introduced. Public media in existing other categories is untouched.

Missing owners/orphan rows are not exposed by owner JSON routes. Protected delivery rejects mixed cross-account references, orphan/shared unsupported references, absent files, unsafe paths, symlinks and non-image extensions with generic 404; it never falls back to static after an authorization failure. Same-owner shared references are readable by that owner; editing is record-scoped copy-on-write. Existing global static URLs remain reachable regardless of this new protected delivery policy.

## Surfaces mapped

| Surface | Storage and Phase 2G behavior |
| --- | --- |
| Website Clay cards/detail modal | `clay_photos`; shared protected-aware markup/loader, blobs for thumbnails/full-size lightbox |
| Website compact list | No photo consumer |
| Website create/edit/upload | Text fields and selected file input; no persisted-photo preview to replace; existing manual upload/replacement retained |
| Mobile Clay list/detail | `ClayPhotoImage` / `EditableClayPhoto`; shared iOS/Android |
| Mobile Clay edit/create | Persisted preview separate from user-selected local image; only selection uploads on Save |
| Pieces/Connected History/search | Clay identity/name/attributes, no indirect `clay_photos` byte consumer found |
| Glaze Clay Tests | `glaze_clay_tests.photo_filename`, owned through Glaze; excluded |
| Clay-linked Test Tiles | `test_tiles` photo slots; separate media category, excluded |
| Photo Lookup/Gallery | Piece photos, not Clay photos; unchanged |

## Backend and editing

`GET /api/ql/clay-bodies/:clayId/photos/:photoId` authenticates, joins parent and photo identities against `req.userId`, safely resolves a regular stored image, checks every registered file slot for ownership ambiguity, sends private/no-store and nosniff, and makes foreign/missing media equivalent (`404 {error:"Photo unavailable"}`). Unauthenticated requests receive existing auth 401. No filesystem path is returned.

`POST /api/clay-bodies/:id/photos` retains existing upload/replace semantics. Optional `replacePhotoId` selects exactly one photo within the authenticated Clay. It preserves its ID, label, notes and order, assigns newly uploaded bytes to that reference, and leaves other photos untouched. Deletion/insertion is transactional; physical cleanup occurs after commit and only when unreferenced. Failure preserves prior rows/bytes. Foreign shared old bytes survive replacement. There is no bulk filename rewrite or historical migration. Ordinary user-requested edits still create new files as existing copy-on-write requires.

## Isolation

Web: generation/token capture; abort on view removal, modal close, navigation and auth replacement; revoke object URLs and clear Clay image DOM/lightbox; stale list/image responses discarded; local image failures leave controls available. No protected request falls back to `/uploads`.

Mobile: additive subscriber to Phase 2E session rotation; Piece behavior unchanged. Clay memory cache keys include account, generation, Clay ID, photo ID and filename revision; native cache destinations include per-session nonce and encoded IDs. Logout/replacement deletes tracked files/blobs, including late downloads; partial failures clean up. Hook masks stale identities synchronously before effects, subscribes to same-account session rotation, remounts decoded images/editors, and rejects stale results. Tokens only travel in Authorization headers. Clay editor checks captured generation and saves with parent/photo identity, not filename-only editing. Native crop output is an ordinary local user-selected artifact; crash/OS/editor temporary-file retention is not certified by unit tests.

## Verification

- Complete `node ql/verify-phase1.cjs`: **430 passing executions**, comprising 266 Node test executions and 164 script PASS checks (includes one disposable-baseline integrity smoke; excludes aggregate PASS summaries).
- New Phase 2G backend/web tests: **20/20**, included above.
- Strict readiness: **37/37**, `QL_READINESS_STRICT=1 node --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs`.
- Complete mobile suite: **64/64**, including **14 new Clay regressions** and existing Piece tests.
- Shared JavaScript parse: **117/117**.
- Zero unexpected failures in final runs. Synthetic local databases/files only. Web DOM tests and mocked native file/download tests do not certify real Safari/iOS/Android rendering or crop-tool behavior.
- Exact-head GitHub Actions results are recorded in the completion handoff after push.

## Remaining risk and rollback

Global `/uploads` is unchanged and anonymously serves known Clay filenames; old clients, copied URLs and prior public/browser caches remain outside the new loader's protection. No claim of global Clay confidentiality is made. Historical publication is still unknown. Cross-account collisions fail closed and require a later reviewed remediation, not automatic reclassification. Disk/OS cache deletion cannot guarantee secure erasure. HEIC/HEIF display remains platform-dependent; failures are local. Existing auth-token revocation semantics are unchanged.

Rollback these isolated commits together to restore previous loaders/route contract; no schema migration or filename reversal is needed. Do not deploy this phase as part of rollback. No deployment, data migration/backfill, global routing change, OTA, native build/store submission, Esme, voice, search or redesign occurred.

Exact recommended Phase 2H (not started): protect **Glaze library photos (`glaze_photos`) only** across backend, website and shared mobile using the same owner-delivery/unknown-historical-visibility distinction, scoped edit isolation, collision denial and session protections. Inventory Glaze/clay-test consumers first, but keep `glaze_clay_tests` and all other categories out of that implementation; retain global static compatibility. Verify, commit/push and stop before the following slice.
