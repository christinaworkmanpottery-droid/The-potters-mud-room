# Phase 2F — Global `/uploads` migration plan

This plan is deliberately non-executing. Production behavior stays unchanged until every gate is satisfied.

## Rollout sequence

1. **Inventory completion** — keep `PHASE2F-UPLOAD-CONSUMER-INVENTORY.md` current as code changes. New media surfaces must declare storage, owner, and publication semantics.
2. **Visibility-classification readiness** — define explicit private/public/mixed semantics per category. Never infer visibility from filename/UUID. Preserve an unresolved legacy bucket.
3. **Protected delivery for all private categories** — add owner-scoped routes and protected-aware web/mobile loaders category by category. Generic foreign/missing 404, `private, no-store`, nosniff, stable stored references.
4. **Explicit public delivery** — add anonymous routes or explicit public-media paths for public Pieces, public Glaze Combos, Forum/community media, product catalog images, and intentionally public avatars. Do not route public community content through owner-only endpoints.
5. **Old-client compatibility strategy** — identify minimum supported website/iOS/Android versions. Until incompatible clients are retired, either keep a compatibility bridge for their required paths or delay global restriction. Do not assume store adoption.
6. **Historical/ambiguous migration strategy** — run read-only production counts first; design reversible per-category mappings; quarantine unresolved records; never auto-classify from filename entropy or age.
7. **Cache invalidation** — version private-media cache identities; rotate on login/logout/account replacement; invalidate public CDN/browser caches when publication state changes; prevent stale private objects crossing accounts.
8. **Backup/restore prerequisites** — verified database backup plus upload-volume backup/snapshot; tested restore procedure; reference-integrity report; rollback point recorded before any migration or routing change.
9. **Rollout ordering** — private categories one at a time (recommended first: Clay), then mixed/public explicit routes, then old-client bridge/retirement, then historical migration, then a canary restriction of anonymous static access, and only finally global restriction.
10. **Rollback criteria** — immediately reverse a rollout stage for unexplained media 404/401 growth, cross-account exposure, broken public/community media, broken supported old clients, missing files, cache leakage, or reference-integrity drift.
11. **Observability** — per media route: category, authorization outcome, generic-not-found count, client version/platform where available, legacy-static fallback use, public-route hits, and error rate. Never log auth tokens or sensitive file bytes. Track direct `/uploads` requests by category only when classification can be determined safely.
12. **Final restriction gate** — anonymous global `/uploads` may be restricted only when every private category has protected delivery, every intentionally public category has explicit public delivery, supported clients no longer require raw static paths (or a narrowly scoped compatibility bridge exists), ambiguous records have a reviewed disposition, backups/rollback are verified, and canary telemetry shows no unexplained dependency.

## Compatibility principles

- Stored filenames can remain unchanged while delivery routes change.
- A record may move from a static URL to a protected/public route without rewriting its stored filename.
- Filename-only authorization is not sufficient.
- Shared-file references require ambiguity checks; fail closed for protected delivery.
- Copy-on-write remains copy-on-write where records such as Sales intentionally own independent media.
- Publication changes must be reversible and invalidate stale public/private caches.

## Final gate checklist

Do not restrict the global static mount until all are true:
- [ ] Private Piece paths protected on supported web/iOS/Android.
- [ ] Clay protected.
- [ ] Glaze and glaze/clay-test protected.
- [ ] Test Tile protected.
- [ ] Firing protected.
- [ ] Pricing protected.
- [ ] Sales protected, including copy-on-write.
- [ ] Projects protected.
- [ ] Event media has explicit visibility and delivery.
- [ ] Profile/avatar publication semantics explicit.
- [ ] Private Glaze Combo path protected and public Combo path explicit.
- [ ] Forum/community public delivery explicit.
- [ ] Product image public delivery separated from protected digital downloads.
- [ ] Gallery/public Piece delivery explicit.
- [ ] Supported old-client strategy complete.
- [ ] Historical ambiguity audit/migration complete or safely quarantined.
- [ ] Cache invalidation verified.
- [ ] Backup and restore rehearsal passes.
- [ ] Canary observability shows no unexplained static dependency.
- [ ] Rollback rehearsal passes.

Current result: **NOT READY**.
