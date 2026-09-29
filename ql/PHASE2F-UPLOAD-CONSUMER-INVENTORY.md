# Phase 2F — Global `/uploads` restriction-readiness audit

Status: **GLOBAL `/uploads` IS NOT READY FOR RESTRICTION.**

This audit is repository-derived from the Phase 2E checkpoint. Phase 2F does not change upload delivery, migrate data, rename files, backfill visibility, or touch production.

## Current global behavior

`server.js` mounts `app.use('/uploads', express.static(UPLOADS_DIR))`. Any existing stored filename is therefore anonymously retrievable if its URL is known. Phase 2D/2E narrowed **private Piece detail** delivery to the authenticated owner-scoped QL route, but the global static mount remains for compatibility.

Piece visibility is the only media classification with an explicit three-state contract:
- `pieces.is_public = 0` → private
- `pieces.is_public = 1` → public
- null/other historical state → legacy-ambiguous

No filename shape, UUID entropy, or extension is used as visibility evidence.

## Stored-media inventory and classification matrix

| # | Media category / storage | Principal consumers | Classification | Why | Restriction blocker |
|---|---|---|---|---|---|
| 1 | Piece photos (`piece_photos.filename`) | Pieces, Piece detail/edit/reorder, Gallery, Photo Lookup, Sales copy-from-Piece | **mixed/context-dependent** | Parent Piece has explicit `is_public`; private/public/legacy-ambiguous all exist | Public + legacy compatibility; older clients; public Gallery; static list/search/edit paths |
| 2 | Clay photos (`clay_photos.filename`) | Clay list/detail/edit | **private/account-owned** | Clay APIs are owner-authenticated; no public flag | No protected media route; web/mobile build static URLs |
| 3 | Glaze photos (`glaze_photos.filename`) | Glaze list/detail/edit | **private/account-owned** | Glaze APIs are owner-authenticated; no public flag on Glaze record | No protected route; static URLs |
| 4 | Glaze/clay test photo (`glaze_clay_tests.photo_filename`) | Glaze test cards/details | **private/account-owned** | Test is reached through owner-scoped Glaze | No protected route; static URLs |
| 5 | Test Tile photos (3 filename slots) | Test Tile list/detail/edit | **private/account-owned** | `test_tiles.user_id` is owner-scoped; no public flag | No protected route; static URLs |
| 6 | Firing photos (`firing_photos.filename`) | Firing list/detail/edit/reorder/history | **private/account-owned** | Parent firing is account-owned; no public flag | No protected route; static URLs |
| 7 | Pricing photo (`pricing_calculations.photo_filename`) | Pricing calculator/history | **private/account-owned** | Pricing records have `user_id`; no public surface | No protected route; static URLs |
| 8 | Sales photo (`sales.image_filename`) | Sales list/detail/edit; Piece-photo copy-on-write | **private/account-owned** | Sales are owner-scoped business records | No protected route; static URLs; copy-on-write lineage |
| 9 | Event photo (`events.image_filename`) | Event list/detail/edit | **mixed/context-dependent** | Event CRUD is owner-authenticated, but anonymous iCal subscription exposes the event record concept; media has no visibility metadata | Missing media visibility contract; old clients; potential share/subscription expectations |
| 10 | Project photos (`project_photos.filename`) | Project detail/edit | **private/account-owned** | Parent Project is owner-scoped; no public flag | No protected route; static URLs |
| 11 | Profile/avatar (`users.avatar_filename`, `profile_photo`) | Profile, Find a Potter, Forum, Gallery attribution, messages/conversations, reviews/comments | **mixed/context-dependent** | User has `is_private` and directory `findable`, but media itself has no visibility metadata; avatar is reused across private and community contexts | Shared filename aliases; public/community attribution; privacy state changes; no media route |
| 12 | Forum photos (`forum_photos.filename`) | Forum posts/replies | **explicitly public/community-facing in product context** | Forum media is rendered to community readers and includes image/video | Must retain community delivery; needs an explicit public-media contract before global static restriction |
| 13 | Glaze Combo photos (2 filename slots) | Private combo editor + shared/community combo + anonymous public share endpoint | **mixed/context-dependent** | `glaze_combos.is_public` / `share_id` explicitly make some combos public while private owner records also use same fields | Needs context-aware public/private delivery; direct share links; social sharing |
| 14 | Merchant product media (`merchant_products.image_filename`, `download_filename`) | Shop/product detail/admin | **explicitly public for product image; mixed for downloadable asset** | Product catalog is public-facing; digital download is an entitlement-bearing asset and must not be inferred public from filename | Public image path + protected download separation required |

### Derived consumer surfaces

The 14 stored-media categories above are consumed by at least these distinct product surfaces: Pieces, Clay, Glazes, Glaze/Clay Tests, Test Tiles, Firings, Pricing, Sales, Events, Projects, Profiles/Avatars, Forum, Glaze Combos, Shop/Products, Gallery, Photo Lookup, Find a Potter/member profiles, and Messages/Conversations. Gallery and Photo Lookup reuse Piece media rather than owning a separate media table.

## Critical code dependencies

Website code directly constructs `/uploads/<filename>` for Piece compatibility paths, Clay, Glazes, glaze/clay tests, Test Tiles, Firings, Sales, Pricing, Glaze Combos, Forum, product images, profiles/avatars, Gallery, community comments/messages and related views.

Shared mobile code directly constructs `${API_BASE_URL}/uploads/<filename>` for Clay, Glazes, Test Tiles, Firings, Pricing, Sales, Gallery, Photo Lookup compatibility paths, Forum, Glaze Combos, profiles/member profiles, Projects, Events and Shop products. Piece list/detail/edit/reorder uses the Phase 2E protected-aware loader when `photoVisibility === 'private'`, while public and legacy-ambiguous Piece media intentionally retain the legacy static path.

## Restriction blockers by type

### Missing visibility metadata
Clay, Glazes, glaze/clay tests, Test Tiles, Firings, Pricing, Sales, Projects and most Event media have no media-level visibility field because they historically behaved as account-owned data behind authenticated JSON APIs while their files were globally static.

Profiles and avatars have user-level privacy/directory flags, not durable media-level publication metadata. Forum and Glaze Combo records have community/public semantics at the parent-content level. Merchant product image and digital download share a storage mechanism despite different access expectations.

### Old-client compatibility
Current shipped website/mobile generations predate a complete protected-media layer. Restricting global static delivery before those clients are retired or bridged would break image rendering. Phase 2E only updated shared Piece-photo loading.

### Public sharing and anonymous pages
Public Piece Gallery and anonymous public Glaze Combo share pages return filenames that current pages turn into static upload URLs. Shop/catalog images also require public rendering. Existing direct legacy URLs may exist outside the app.

### Cached/static URLs and external references
Any copied, bookmarked, messaged, social-shared, email/text, browser-cached, or externally embedded `/uploads/<filename>` URL can remain a compatibility dependency. The repository cannot prove the absence of external references.

### Missing protected routes / ownership linkage
Most private categories have clear ownership through their parent row but no authenticated file-delivery endpoint. A few shared surfaces require parent-context authorization rather than filename-only lookup. Filename-only authorization is unsafe when a filename is referenced by multiple logical records.

### Schema/history ambiguity
Only Piece media currently has an explicit private/public/legacy-ambiguous contract. Historical records in other categories do not record whether a particular file was ever intentionally published or externally shared. Phase 2F therefore does **not** auto-classify or rewrite them.

## Minimum protected-delivery pattern for private categories

For Clay, Glazes, glaze/clay tests, Test Tiles, Firings, Pricing, Sales, Projects, private Event media, private Profile media and private Glaze Combos:

1. Route identity must include the owning logical record and stable media identity when available; do not authorize by filename alone.
2. Require authentication and resolve ownership through the parent row (`user_id` or parent join).
3. Return the same generic 404 for foreign and missing media.
4. Send `Cache-Control: private, no-store` for protected bytes and `X-Content-Type-Options: nosniff`.
5. Keep stored filenames/references unchanged during compatibility phases.
6. Web and shared iOS/Android loaders must choose delivery from explicit metadata, never filename heuristics.
7. Account/logout/session replacement must invalidate private media cache identity; stale account-A downloads must never populate account-B UI.
8. Shared-file ambiguity must fail closed: one filename referenced across ownership boundaries cannot be privately served until disambiguated.
9. For Sales copy-from-Piece and any other copy-on-write paths, authorize the source record, copy bytes to a new owned filename where current behavior requires independence, and preserve cleanup/reference-count safety.
10. Editing protected media must not silently manufacture a durable public URL.

## Truly public media requirements

- **Public Piece Gallery media:** requires anonymous rendering only when Piece visibility is explicitly public. Prefer a distinct public Piece media route keyed by Piece + photo ID.
- **Public Glaze Combo media:** requires anonymous rendering for `is_public=1` / valid share context. Prefer a distinct public Combo media route keyed by share context + photo slot/ID.
- **Forum/community media:** community visibility is intentional, but publication scope should be made explicit before the global mount is removed. A distinct community-media route is preferable.
- **Merchant product images:** public catalog images need anonymous access. Prefer a distinct product-media route or explicit public/CDN path.
- **Digital product download filenames:** must not be treated as public product-image media; entitlement/download handling remains separate.
- **Public-facing avatars:** require an explicit publication rule tied to profile/community context, not a blanket assumption that every avatar filename is public.

A future CDN/signed URL layer is compatible with these rules, but it is not required to start migration. The key prerequisite is explicit public-vs-protected authorization semantics.

## Legacy-ambiguous records

Piece records can explicitly be `legacy-ambiguous` when `is_public` is neither 0 nor 1. They remain on `/uploads` for compatibility today.

Other historical media tables generally lack any visibility column at all. Those rows are not safely classifiable from filename, UUID shape, age, record type alone, or current authentication of the surrounding API.

Before historical migration, each category needs:
- an explicit intended visibility model;
- a deterministic parent/owner linkage;
- evidence for which parent states imply publication;
- a policy for records created by older clients;
- a reversible migration mapping;
- backup/restore verification;
- counts from a production-safe read-only audit before any write;
- an exception bucket for unresolved rows.

No historical reclassification is performed in Phase 2F.

## Readiness conclusion

**GLOBAL `/uploads` IS NOT READY FOR RESTRICTION.**

The smallest next blocker-removal slice is **Phase 2G: protected delivery for Clay media only, web + shared mobile, preserving filenames and global `/uploads` compatibility.** Clay is a contained, clearly account-owned category with straightforward parent ownership and no intentional public surface. Phase 2G should add owner-scoped Clay photo delivery, protected-aware web/mobile Clay loaders, account/session cache safety consistent with Phase 2E, focused regressions, and no global static-route change.

## Phase 2G addendum

The inventory above is the Phase 2F historical baseline. Clay now has owner-protected web/shared-mobile delivery on the isolated Phase 2G branch, with historical visibility still unknown. See `PHASE2G-CLAY-MEDIA.md` for complete mapping, scoped edit isolation and remaining static-URL exposure. Global restriction remains NOT READY. Next implementation slice is Glaze library photos only.
