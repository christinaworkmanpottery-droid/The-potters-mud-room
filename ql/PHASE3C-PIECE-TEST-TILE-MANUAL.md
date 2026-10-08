# Phase 3C — Manual Piece ↔ Test Tile and entitlement consistency

Branch in both repositories: `ql/phase-3c-piece-test-tile-manual`.
Authoritative parents: backend `26d5dca580d13141c77ecca37f0850d532852d87`; mobile `078a241394b44649cfbeda3908fcfe2f3d8e30c0`.

## Authorization and canonical data

`hasTestTileEntitlement` checks the authenticated account's current database tier on each protected request. Only stored `starter`, `basic`, `mid`, and `top` qualify. Missing account/tier, unknown tiers, free and database lookup errors fail closed. Token tiers never establish Test Tile entitlement. No billing, Stripe, active-payment or subscription-payment check exists; qualifying complimentary/promo/beta accounts remain entitled.

The same predicate serves standalone list/detail/write/library-filter routes, preview availability, protected three-slot photos, all Piece relationship routes, and Connected History filtering. Bulk Test Tile deletion and the existing generic Test Tile photo replacement path also deny entitlement loss. Locked responses contain only the generic upgrade message and `TEST_TILE_ENTITLEMENT_REQUIRED`, with private/no-store caching.

Relationship precedence is: invalid session 401; missing/foreign Piece 404; established Phase 1 all-table infrastructure unavailable (GET `[]` with availability false; mutations 409); available infrastructure but non-entitled 403; entitled empty/ready. Available GET retains availability true. Hidden associations cannot be unlinked after downgrade. No schema or relationship-service semantic changes were made.

History receives `testTilesAccess: available|locked|unavailable`. Unauthorized/unavailable tiles are excluded before combined timeline construction. No Test Tile IDs, names, relationship timestamps, media, counts or placeholders enter the response; all non-Test-Tile history remains. Existing associations are neither repaired nor deleted and return on fresh authorized re-upgrade.

`serializeTestTile` preserves saved fields and same-owner Clay/Glaze library enrichment across standalone APIs, relationship GET and entitled History. Three photo slots remain in place, with Phase 2J delivery/visibility metadata. Manual names take display precedence over library names. Preview is declared before `/:id` and retains its generic feature/description/available/upgradeMessage shape.

## Website and shared mobile

Piece detail now includes Linked Test Tiles: linked list, eligible saved-tile picker, explicit Link/View/Unlink, loading, empty, locked, unavailable, error and Retry. Labels use existing manual/library names, cone, date and ID; labels are never stored. Already-linked tiles are excluded; tiles linked to other Pieces remain eligible. Mutations reload server relationships; website also replaces/reloads Connected History. No optimistic associations, search, inference or offline queue exists.

Both use the existing Test Tile viewer and renderer. Relationship entry carries ID and read-only context. Fresh authorized detail is authoritative; stale route payloads cannot render. Read-only entry hides/disconnects Edit/Delete and photo replacement. Normal deliberate editing remains available to entitled users. Loading, 403 locked, 404 unavailable, error/Retry and session/view/request guards clear old data. Photos fail independently from text.

Website closes abort detail/media work, revoke protected blob URLs and clear lightbox/content. Entitlement loss clears list, relationship and viewer state and refreshes History. Mobile uses keyed account/session/focus detail screens and a guarded loader. Piece controllers require a fresh server-confirmed saved Piece and available infrastructure; local-only, unsynchronized, offline, stale/foreign Pieces cannot mutate. Focus/connectivity/session changes dispose controllers; no mutation is queued.

A shared mobile authorization-loss signal invalidates Test Tile cached files/download epochs even when account/session does not rotate. Pending downloads cannot repopulate invalidated cache. Linked controls and viewers clear content; list selections and editor photo previews clear on loss. Fresh authorized requests after re-upgrade restore surviving relationships, details and media.

QL-only junction semantics are unchanged: multiple tiles/Piece and multiple Pieces/tile; same-owner validation; idempotent Link retaining 201; first/repeated Unlink true/false while endpoints exist; generic 404 missing/foreign endpoints; endpoint deletion removes junctions while preserving the other record and unrelated associations; stale/foreign reads filter without repair. Existing historical-corruption deletion safeguards remain.

## Verification

Synthetic local databases and loopback servers only; Node 22, matching CI.
- New backend API: 32 passing checks; new website DOM: 20/20; combined 52/52.
- Complete backend/QL: 1,009 passing executions (772 TAP and 237 standalone assertions).
- New mobile regressions: 51/51; complete mobile: 464/464.
- Shared JavaScript parsing: 146/146.
- Strict Phase 1 gate: 37/37.
- Phase 2 protected-media contracts, Phase 3A/3B regressions and Calendar/iCal: PASS.
- Zero unexpected failures, skips or TODOs.

Both existing non-deploy workflows include this branch and new suites. Completion requires successful Actions attached to the exact pushed heads; report those commit/run IDs in the completion message.

## Known limitations and next task

Production is untouched: no production-data access, deployment, migration/backfill, global upload restriction, filename rewrite, OTA, native build or store submission. Physical-device validation remains a later release gate.

A previously known legacy `/uploads` URL may remain independently accessible while global static delivery remains enabled. Phase 3C does not revoke already known/downloaded media. This does not permit any new Test Tile relationship/viewer fallback to `/uploads`: new flows use canonical protected Phase 2J slots. This rollout compatibility limitation does not block Phase 3C completion.

Recommended Phase 3D: **scope/audit only for manual Piece ↔ Sale navigation/relationship management using the existing `sales.piece_id` model**. Audit current cardinality, saved-sale selection, ownership, existing sale editor/viewer reuse, quantities, sold-status/accounting side effects, deletion preservation, protected media and fresh Piece/session guards on website/mobile. Determine whether explicit Link/Unlink can be separated safely from sale creation/accounting. Propose the smallest coherent implementation slice with explicit semantics and regression requirements. No implementation, branch, schema, inferred association, production access or deployment during that audit. Phase 3D has not begun.
