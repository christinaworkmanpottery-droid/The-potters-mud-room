# Phase 0 architecture and preservation audit

Audited September 29, 2026. Source pins are in `baseline.json`. Findings describe inspected code/configuration; live database contents and store releases were not exported or independently verified.

## Production and source mapping

| Component | Verified source/configuration | Boundary |
| --- | --- | --- |
| Website + API | Public `The-potters-mud-room`, main `b818122c88b8ca037866f2fd35eaa11690759169`, package/deploy version 47 | Render confirms this exact live commit; public `/api/version` reports 47 |
| Render production | `the-potters-mud-room`, service `srv-d6it9vpdrdic73emsvjg`, workspace `tea-d6it66sr85hc73c5qs2g` | Auto-deploy from main; previews off; npm install → node server.js |
| Storage | Render 1 GB persistent disk mounted at `/opt/render/project/src/data` | Source uses `data/pottery.db` + `data/uploads`; no production disk accessed |
| Existing test service | `potters-mud-room-testing`, branch `fix/website-master-sept25`, auto-deploy off | No disk shown in service metadata; credentials/data isolation unknown, so not reused for QL |
| Mobile shared source | Private `potters-mudroom-app`, Android parity `14348287af6ad80c2ddcd1287334caa51628d265` | Selected QL source baseline; preserves Sept 26 repairs and versionCode 22 preparation |
| Mobile default | master `193455f4323ed0597c62cee9963d91ccae5d7a24` | Older config: 1.0.3, iOS 20/Android 14. Do not assume default = current production |
| iOS source candidates | Android branch config says iOS 47; its base `066c22a337a90b5b0f2afb1d590efd12ab3eab5e` also says 47; `release/build35` says 35 | No App Store/EAS attestation available here; exact live iOS commit remains unresolved |

## Architecture and reuse

- **Website:** plain browser JavaScript `public/app.js`, `public/index.html`, CSS and `public/website-utils.js`, hash navigation. `PROJECT.md`'s old React description is stale. Separate prebuilt Expo web bundles are also served under `/app` and asset routes; their exact source build provenance is not established.
- **Backend:** Node + Express monolith `server.js`; `database.js` initializes SQLite with better-sqlite3, WAL and foreign keys. Reuse domain CRUD/API contracts, existing IDs and ownership checks, export helpers, directory search/geodata, upload/image processing and established workflows.
- **Mobile:** Expo SDK 54, React 19.1, React Native 0.81.5, React Navigation; most screens/services shared between iOS/Android/web, with platform-specific image editing and Android IAP modules. Reuse rather than rewrite; reconcile release provenance first.
- **Authentication:** bcrypt password hashes, JWT `userId` claims, `users.id` text identifiers (typically UUIDs), API ownership keyed by `user_id`. Website token storage uses `mudlog_token`; mobile uses AsyncStorage `auth_token` and `user_data`. Keep identifiers/hashes/provider associations stable. QL must use separate test secrets and synthetic accounts; changing a secret or environment can invalidate sessions.
- **Entitlements:** Stripe checkout/portal/webhooks, Apple receipt/notification paths, Google purchase verification/notifications, `iap_purchases`, expiry fields and promotional/grandfathered states. `iap.hasPremiumAccess`, route tier checks and billing/status logic do not use one uniform rule today. Reuse provider bindings, but do not infer paid status from a display badge or `starter` alone.
- **Photos:** multer → UUID filenames in uploads; sharp transforms, HEIC replacement, perceptual hash/color signatures, per-domain photo tables and inline photo filename columns. `/uploads` is statically served. Reuse existing paths and metadata; a URL/filename is not an ownership guarantee. Do not rename/copy/delete assets as a side effect of relationship work.
- **Other integrations:** SMTP/newsletter/settings, Expo push tokens, Stripe, Apple/Google stores, OpenAI-backed existing assistant, Google/Apple calendar links and local iCal/PDF/CSV exports. Future Esme should sit behind replaceable interfaces and permission-scoped retrieval; no Esme implementation now.
- **Offline:** Expo SQLite `potters_mudroom.db`, local/server IDs, pending sync queue and connectivity-triggered sync. Current queue/cache tables lack owner/environment columns and logout removes auth storage only. Reuse the useful primitives only after account/environment isolation is designed and tested.

## Existing relationships

| Domain | Existing links and preservation concern |
| --- | --- |
| Pieces | `user_id`, nullable `clay_body_id`; lifecycle/cost/date fields; piece photos and ordered `piece_glazes`; custom glaze names may have no glaze ID |
| Clay/Glazes | Owner-scoped libraries; separate photo tables; `glaze_clay_tests` connects results to glazes/clay while preserving typed clay names |
| Raw Materials | Stored as `glaze_chemicals`; recipe `glaze_ingredients` are typed names/amounts rather than inventory foreign keys. Preserve names and units before proposed links |
| Test Tiles | Owner, optional glaze/clay IDs plus historical names, result fields and three photo slots. No existing direct firing relationship |
| Firings | Owner, optional single `piece_id`, kiln-load text, schedule/results, photos. A multi-piece firing junction is a future proposal, not present |
| Pricing | Owner-scoped `pricing_calculations` with JSON inputs/results and photo; no direct piece link in this schema |
| Sales | Owner, optional piece link, quantity/unit price, buyer/event metadata, image and `contact_id`. Contact link added as TEXT without FK |
| Contacts/Events | Owner-scoped records; event `contact_id` is TEXT without FK; preserve local calendar times/date-only semantics |
| Community | Glaze combos/layers/likes/comments, forum categories/posts/replies/photos, messages, blocks, reports and notifications; preserve private/shared visibility and participants |
| Esme | Existing `ai_usage` and assistant routes are not a QL provenance model. Future retrieval must preserve per-user authorization and source references |

`schema.json` inventories fresh-start columns and foreign keys. It cannot prove that older production databases have exactly that schema.

## Risks and migration gates

1. **Startup is mutating:** scattered ALTER/rebuild/UPDATE operations across database.js and server.js, swallowed migration exceptions in places, photo-signature backfill and account tier adjustments. A server pointed at production data can mutate it before any HTTP request. Never point QL there.
2. **No canonical migration ledger:** standalone historical SQL and run-migration.js coexist with startup changes. Do not replay old SQL on current data. Some rebuild paths can omit later columns/relationships. Rehearse exact legacy schemas with IDs, row counts, FK checks and file checks before any new migration.
3. **Membership consistency:** legacy startup account-specific tier assignments and multiple entitlement interpretations need a separately scoped reconciliation. Do not change current billing during Phase 0. `googleapis` is required lazily by Google verification but absent from backend package/lock declarations; mocked Android tests do not verify a real purchase.
4. **Offline ownership:** no user/environment namespace for cache/queue and no logout cleanup of that SQLite store; can mix account data if blindly reused. QL cannot be launched against current production API from the unchanged mobile branch.
5. **Photo portability/privacy:** database and uploads must be backed up/restored as a consistent pair; WAL-aware backup needed, not just copying an active main DB file. Preserve media filenames and historical replacements. Static upload serving merits a later access-control review before private intelligence/sharing expands.
6. **Relationships are not tenant constraints:** an FK proves the referenced row exists, not that both rows belong to the same user. New relationships require explicit same-owner checks and negative tests. Preserve nullable and historical text cases; no forced matching by names.
7. **Release drift:** default mobile branch is stale, iOS provenance unknown, Android-specific native purchasing exists while shared iap.js is a diagnostic fallback. Do not ship this baseline as an iOS release or claim store parity from source inspection.
8. **Hosting/runtime:** production runtime version not pinned in package.json. Local default Node 24 install failed building better-sqlite3; Node 22.23.3 installed the unchanged lock successfully. Dependency deprecation notices recorded; no upgrades in this chunk. Single disk implies storage/backup/capacity concerns for future scale.
9. **Public repository:** commit architectural documentation and synthetic schema only; never commit credentials, actual customer records, purchase tokens, uploaded photos or raw service logs. Private mobile source remains in its own private repository.

## Change policy

Phase 0 adds only `ql/` tooling/documentation in the website and a QL checkpoint document in mobile. Existing runtime files, dependencies, migrations, app/store IDs, production branches and cloud services remain unchanged. No live account, data, billing or media mutations were performed. Production stability follows from keeping QL code and data paths separate; this audit is not a guarantee that every existing production workflow is defect-free.

Before future migration: verified restore rehearsal; row/ID/owner/photo inventory; add-only compatibility where possible; explicit transaction/versioning; invariant and old-client tests; rollback plan that does not discard writes made after release. No production migration until separately reviewed and authorized.
