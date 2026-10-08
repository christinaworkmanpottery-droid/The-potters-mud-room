# Phase 2T — Global /uploads restriction-readiness closure audit

Base checkpoint: backend 84668d37aa02106157cfa0501f64803ed1d968d0 and mobile cf5a67b393655f2094ea9b59827252cd21cf4c37. Branch: ql/phase-2t-upload-readiness in both repositories.

Phase 2T is audit/readiness/closure planning only. It does not restrict /uploads, inspect production data, deploy, migrate/backfill records, rewrite filenames, perform OTA/native builds, submit to stores, or auto-classify historical media.

## Decision

GLOBAL /uploads IS NOT READY FOR RESTRICTION.

PHASE 2 IS NOT READY TO CLOSE.

The current-source gap is real, not merely old-client compatibility. Reachable website/shared-mobile Piece edge surfaces still construct /uploads URLs for media that may be private. The website public Glaze Combo renderer/share URL also still consumes global static delivery instead of the existing explicit public combo-photo route.

## Phase 2F comparison

Phase 2F found global static consumers across Pieces, Clay, Glazes, Glaze/Clay Tests, Test Tiles, Glaze Combos, Firings, Pricing, Sales, Projects, Events, Profile/avatar, Forum and Shop.

Since then, category-specific protected/public-aware delivery has been implemented for Clay, Glaze library, Glaze/Clay Tests, Test Tiles, Glaze Combos, Firings, Pricing, Sales, Projects, Events, Profile/avatar, Forum and Shop. Piece detail/history is protected for explicit private Piece media. Shop catalog images/sample are explicit public delivery and paid originals are purchase-authorized. Forum remains authenticated.

## Remaining current-source /uploads consumers that block restriction

- Website Piece cards/dashboard/list/equivalent Piece-card surfaces: direct /uploads filename rendering without visibility-aware protected delivery.
- Website Photo Lookup thumbnails: direct /uploads rendering for matches from the signed-in user's library.
- Shared mobile Home Piece thumbnails: direct /uploads rendering.
- Shared mobile Photo Lookup thumbnails: direct /uploads rendering.
- Shared mobile Reorder Photos filename fallback: direct /uploads rendering.
- Shared mobile public Gallery: direct /uploads rendering; public Piece media needs an explicit record-aware public route before restriction.
- Website public Glaze Combo page and Pinterest media URL: direct /uploads rendering even though an explicit public combo-photo route already exists.

These are reachable current-source paths and therefore are blockers.

## Remaining static uses that are compatibility-relevant but not current private blockers by themselves

- Explicit legacy-ambiguous fallback branches in Piece, Clay, Glaze, Glaze/Clay Test, Test Tile, Combo, Firing, Pricing, Sales, Projects, Events, Profile/avatar and Forum helpers.
- Checked-in compiled Expo/web compatibility bundles retained intentionally.
- Already-released iOS/Android clients that construct /uploads URLs.
- Previously copied, bookmarked, cached, emailed, or externally shared /uploads links.
- Tests, fixtures and documentation that intentionally mention /uploads.
- The Express global static middleware itself, intentionally unchanged in Phase 2T.

## Final media-access matrix

| Category | Current contract | Website | Shared mobile | Static exposure | Source-ready |
|---|---|---|---|---|---|
| Pieces | authenticated Piece-scoped private detail/history; explicit public/legacy still static-compatible | private detail protected; cards + Photo Lookup still static | detail/component protected; Home + Photo Lookup + Reorder still static; Gallery static | current + legacy | NO |
| Clay | owner-protected record/photo route | protected-aware | protected-aware | legacy-ambiguous only | YES |
| Glaze library | owner-protected glaze photo route | protected-aware | protected-aware | legacy-ambiguous only | YES |
| Glaze/Clay Tests | owner-protected glaze/test route | protected-aware | protected-aware | legacy-ambiguous only | YES |
| Test Tiles | owner-protected tile/slot route | protected-aware | protected-aware | legacy-ambiguous only | YES |
| Glaze Combos | owner-protected private route + explicit public combo-photo route | private protected; public page/share still static | protected/public-aware | website public + legacy | NO |
| Firings | owner-protected firing-photo route | protected-aware | protected-aware | legacy-ambiguous only | YES |
| Pricing | owner-protected pricing-media route | protected-aware | protected-aware | legacy-ambiguous only | YES |
| Sales | owner-protected sale-media route | protected-aware | protected-aware | legacy compatibility only | YES |
| Projects | owner-protected project-photo route | protected-aware | protected-aware | legacy-ambiguous only | YES |
| Events | authenticated owner event-photo route | protected-aware for known-private | protected-aware | legacy-ambiguous only | YES for known-private |
| Profile/avatar | owner/community protected routes + explicit public avatar contexts | context-aware | context-aware | legacy-ambiguous only | YES |
| Forum images/videos | authenticated post/reply media + authenticated streaming/player | authenticated | authenticated | legacy-ambiguous only | YES |
| Shop | active catalog image public route; merchant-private image route; exact completed-purchase download; explicit public sample | public/private-aware | public/private-aware | released-client/historical links only | YES |

Known-private protected failures must not fall back to /uploads. Existing category regressions enforce that for completed slices; the Piece blockers above are direct static consumers rather than protected-failure fallbacks.

## Public-media preservation

Future restriction must preserve public media through explicit record-aware routes.

- Public Piece Gallery: NOT YET COMPLETE in current source; explicit public Piece-photo delivery is still required.
- Public Glaze Combos: explicit public route exists, but website public renderer/Pinterest share must adopt it.
- Public Profile/avatar contexts: explicit public routes exist for directory/featured/review/piece/combo contexts.
- Shop catalog images: explicit active-product public image route exists.
- Shop public sample: /shop/mud-log-preview.pdf remains explicitly public.
- Forum media remains authenticated.
- Event images remain authenticated for known-private records; no public Event publication contract is invented.

## Released-client compatibility blockers

Current-source readiness and production rollout readiness are separate.

Even after Phase 2U closes current source, production restriction remains blocked until old clients are retired or safely bridged:
- production iOS releases with direct static URL construction;
- production Android releases with direct static URL construction;
- checked-in old Expo/web bundles retained for compatibility;
- browser/app caches and copied/bookmarked URLs;
- previously shared direct external links.

A filename-only old-client request cannot be safely authorized for private media. Version gating cannot retroactively change already-installed URL construction. A compatibility bridge, if later needed, must be limited to media proven explicitly public from record relationships. Private, ambiguous, orphaned or conflicting files must fail closed.

## Historical/ambiguous media blockers

Without production inspection, schemas/contracts/fixtures show these unresolved classes:
- Piece photos with legacy visibility rather than an explicit present-day public/private decision.
- Historical stored media rows across studio categories whose delivery metadata is absent or legacy-ambiguous.
- Multi-record or multi-slot file references, possibly with conflicting ownership/visibility.
- Orphan files or rows with insufficient record binding.
- Shop originals with null/unbound historical download_filename, generated-original mapping uncertainty, or collisions.

Before any production backfill/reclassification, an authorized dry-run must establish: complete file-to-record reference graph, owners, explicit publication state, conflicting/multi-reference files, orphan status, exact Shop product/order/file mappings, supported client versions/adoption, and external-link retention policy. Backup/restore and rollback validation are prerequisites. Never infer visibility from filename, UUID shape, extension, age or directory location.

## Smallest compatibility strategy

Do not build a broad compatibility architecture in Phase 2T.

After current-source closure, use staged retirement/adoption of old clients first. Only if a bridge is still required, use a narrowly scoped record-aware resolver/allowlist that serves files only when the repository/data can prove an explicitly public relationship. Do not grant filename-only access to private or ambiguous media.

## Rollout plan

1. Phase 2U closes only the current-source Piece/public-edge blockers while leaving global /uploads unchanged.
2. Re-run the complete backend/mobile/protected-media/readiness matrix and native-device validation.
3. Define supported-client minimum versions and adoption/retirement criteria.
4. After backup/restore approval, perform an authorized production reference/metadata dry-run; do not auto-classify ambiguity.
5. If required, add only an explicitly-public compatibility resolver with telemetry.
6. Canary a future restriction with media 404/auth/public-route observability and rapid route-level rollback.
7. Restrict global static delivery only after every final gate below passes.

## Rollback plan

If a future restriction causes authorized private-media failures, public-media regressions, unexpected supported-client breakage, unresolved historical-reference failures, or abnormal media error rates, restore prior /uploads routing immediately without changing stored filenames/data. Keep protected/public routes in place, stop any backfill, preserve logs/metrics, and reconcile the cause before retrying.

## Native-device validation still required

Before production restriction validate supported iOS and Android devices for Piece list/detail/reorder/Photo Lookup/Gallery, all private media categories, Forum image/video seeking/range behavior, Profile/Find a Potter avatars, Shop catalog/sample/download, cache/session replacement/logout, and offline/error behavior. Phase 2T performs no native build.

## Exact restriction criteria

Global /uploads can be disabled/restricted only when:
1. no reachable current website/shared-mobile known-private consumer constructs a static /uploads URL;
2. every intentionally public current surface uses an explicit record-aware public route;
3. protected failures never fall back to static delivery;
4. all supported released clients no longer require anonymous private static URLs, or a narrowly proven safe compatibility policy covers them;
5. historical ambiguous/multi-reference/orphan records have an approved fail-closed or reviewed classification plan;
6. Shop paid originals remain exact-purchase protected and public sample/catalog media remain explicit;
7. Forum media remains authenticated and streaming regressions pass;
8. Find a Potter/public avatar rules and Calendar/iCal regressions pass;
9. complete regression/readiness suites are green with zero unexpected failures/skips/TODOs;
10. backup/restore, canary, observability and rollback prerequisites are approved.

## Exact Phase 2U recommendation

Phase 2U — Piece/public-edge media closure.

Do only:
- website Piece cards/dashboard/list/casualty-equivalent cards and Photo Lookup: visibility-aware protected/public Piece delivery;
- shared mobile Home, Photo Lookup and Reorder Photos: protected/public-aware Piece delivery;
- explicit record-aware public Piece-photo route for Gallery/public Piece contexts, fail-closed for private/ambiguous media;
- shared mobile Gallery adoption of that explicit public Piece route;
- website public Glaze Combo image and Pinterest media URL adoption of the existing explicit public combo-photo route;
- retain /uploads only for deliberate legacy-ambiguous compatibility paths;
- focused regressions for all of the above.

Do not restrict global /uploads, migrate historical data, or begin Phase 3 in Phase 2U.
