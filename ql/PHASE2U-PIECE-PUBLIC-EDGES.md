# Phase 2U — Piece/public-edge media closure

Branch in both repositories: `ql/phase-2u-piece-public-edges`.
Base backend: `d610b9223b43366701fff42912cbf9c61cbdfe6a`.
Base mobile: `a83d6471b28b123e184eb2393302d0df37cb97f5`.

## Decisions

GLOBAL /uploads IS NOT READY FOR RESTRICTION

PHASE 2 IS NOT READY TO CLOSE

The explicitly authorized Phase 2U edges have been remediated. The repeated current-source audit found additional reachable Piece-media consumers missed by Phase 2T. These are active code defects, not merely released-client compatibility. They are outside the enumerated Phase 2U surfaces and are not silently fixed here. Phase 3 has not begun.

## Confirmed runtime paths and changes

| Surface | Runtime path | Phase 2U result |
|---|---|---|
| Website dashboard | loadDashboard → /api/dashboard → recentPieces → pieceCard | visibility metadata; session-guarded results; shared Piece edge hydration |
| Website Piece cards/grid | loadPieces → /api/pieces → pieceCard | explicit private protected; public record-aware; legacy only static |
| Website Piece list | loadPieces → pieceListRow | text-only, no image consumer; session-guarded response |
| Website casualty-equivalent cards | loadCasualties → casualtyCard | shares Piece edge helper; API classification; no direct static image |
| Website Photo Lookup | runVisualSearch → /api/pieces/photo-search → matches | owner-resolved visibility added; matching/scoring unchanged; shared thumbnail loader; stale results rejected |
| Website public Piece Gallery | no independent renderer in public/app.js/index.html | Gallery API is consumed by shared mobile/Expo; checked-in compiled bundles remain legacy |
| Mobile Home | fetchDashboard → getPieces → recentPieces | PiecePhotoImage; session cleanup and stale-response check |
| Mobile Photo Lookup | searchByPhoto → matches → renderResult | PiecePhotoImage; request/session guards and preview/result cleanup |
| Mobile Reorder | PieceDetail route params or legacy pieceId → ReorderPhotosScreen | shared Piece component; fetch owner record when classification missing; no filename fallback; clear photos on session change |
| Mobile Gallery | /api/gallery → card/modal/editable owner preview | public Piece-photo URL from Piece/photo IDs; no static fallback, including edited-photo response |
| Website public Combo | /api/combos/public/:shareId → loadPublicCombo | existing explicit public Combo route only when photoDelivery is public-explicit |
| Pinterest image | loadPublicCombo → media query parameter | same explicit public Combo route; private/legacy cannot create share media URL |

The directly shared Piece helper also moves explicit-public Piece detail images off static URLs. Public but unfinished owner views use the existing authenticated owner history-photo route because they are not eligible for public Gallery delivery. No publication semantics or other category access rules changed.

## Public Piece-photo contract

`GET /api/ql/pieces/:pieceId/photos/:photoId/public`

- Anonymous access requires explicit stored is_public=1 plus the actual Gallery finished-status rule (glaze-fired/done/complete/sold, including existing normalization).
- Photo ID must belong to that Piece. Filename possession alone grants nothing.
- Every registered file slot is scanned; any other reference to the filename fails closed, including same-account/public collisions and cross-category references.
- Existing safeStoredUpload validates one stored basename and a regular nonsymlink file; supported raster types only.
- Private, legacy-ambiguous, unfinished, wrong-parent, missing, unsafe, or conflicting media returns generic 404 without path disclosure.
- nosniff; public max-age=0, must-revalidate, so publication state is rechecked on reuse. Error responses no-store.
- Existing private/history delivery and global /uploads middleware remain unchanged.

Classification remains explicit is_public=0 private; is_public=1 public; otherwise legacy-ambiguous. No filename/UUID heuristic, historical reclassification, or data migration.

## Session isolation

Website edge requests capture token and generation; stale API results cannot render after navigation/login/logout/token replacement. Protected blobs are revoked and image attributes/results cleared. Detached thumbnail nodes cannot receive a late blob. Photo Lookup preview blobs are tracked and cleared.

Shared mobile uses account/session generations, protected download identity, synchronous hook identity masking, mounted-session invalidation, and stale downloaded-file/blob removal. Home and Photo Lookup clear records/results on session changes; Reorder clears previews and fetches missing classification with a generation guard. Protected errors never route to /uploads. iOS/Android share the same service and component; no native build occurred.

## Repeated current-source /uploads audit

### Reachable current-source blockers (not fixed in Phase 2U)

1. Website `public/app.js:onSalePieceSelect`: /api/pieces fills _salePieces; selecting a Piece renders its photo directly into salePhotoPreview. It is a Piece-media preview before the Sale copy exists.
2. Mobile `CasualtiesScreen.js:renderItem`: registered Studio Casualties route consumes /api/casualties; collapsed primary thumbnail and expanded photos construct /uploads even for is_public=0 Pieces.
3. Mobile `AddCasualtyScreen.js`: registered AddCasualty edit route receives a casualty, loads existing photos, and renders direct /uploads previews.
4. Mobile `AddSaleScreen.js:choosePiece`: registered Business AddSale route constructs a Piece image URL; the live piecePhoto Image shows it when no Sale image is selected.

### Legacy-ambiguous compatibility paths

Piece, Clay, Glaze, tests, tiles, Combo, Firing, Pricing, Sales, Project, Event, Profile/avatar, and Forum helpers retain their previously documented explicit compatibility branches. Only legacy-ambiguous Piece media takes the Piece static branch; known-private missing IDs/errors fail closed. Reorder no longer has a filename-only fallback: it retrieves the owner record instead.

Generic EditablePhoto has a static replacement branch for unprotected legacy callers; migrated Piece/Gallery editing marks record-aware delivery so it cannot enter that branch. Remaining Casualty callers above are blockers.

### Non-rendered/dead references

AddEventScreen's initial static-looking `image` string is a presence sentinel on the actual edit navigation path (`EventDetail → AddEvent {event, editing:true}`); EventPhotoImage renders the stored photo. New-photo paths carry local URIs. No Event contract changed.

Photo editor utilities parse historical /uploads filenames; they are not image-delivery URLs. Combo photo-slot string fallback is retained for legacy slot inputs; current record slots use comboPhotoUrl metadata. Historical fix scripts, tests, fixtures, and audit documents are not app runtime consumers.

### Compiled/released clients

Checked-in `public/app/_expo` bundles, released iOS/Android clients, cached pages, and copied historic URLs still require the separately documented rollout/historical strategy. No bundles were regenerated or removed.

### Intentionally public explicit routes

New Piece-photo public route; existing Combo, Profile/avatar public contexts, Shop catalog and sample routes. These are record-aware contracts, not global static bypasses. No Piece Gallery social-share image path was found in current source; no sharing feature added.

## Verification

Focused regressions exercise anonymous public bytes, private/legacy/wrong-parent denial, status rules, collisions, safe files, unpublishing, Gallery identity, owner Photo Lookup matching/metadata, DOM hydration, account switching, stale requests, public Combo/Pinterest rendering, mobile web/native cache cleanup, hook identity, all migrated surface wiring, and unchanged global uploads.

Historical readiness tests that asserted the old Gallery/Combo static behavior were updated to assert the new explicit routes. Glaze/Clay Test protection assertions remain intact; its obsolete deferred-Combo static assertion now checks the retained legacy-only helper.

See final verification checkpoint below. All runtime tests use disposable synthetic databases/files; no production data.

## Exact next recommendation — do not begin automatically

**Phase 2V — Remaining Piece-derived Casualty and sale-preview media closure.**

Migrate only the website onSalePieceSelect preview and shared-mobile Casualties collapsed/expanded thumbnails, AddCasualty existing-photo previews, and AddSale choosePiece preview through the now-established Piece media contract. Preserve Sale copying/ownership, Casualty edit/deletion behavior, and all category boundaries. Add focused account/session/stale-response/legacy/failure regressions. Repeat the complete current-source audit and full verification, then decide Phase 2 closure again. Leave global /uploads and production untouched. Do not start Phase 3.

No deployment, production-data access, migration/backfill, filename rewrite, global uploads restriction, OTA, native build, store submission, Esme, voice, or cross-record search occurred.

## Final local verification checkpoint

- New Phase 2U backend/web regressions: 25/25.
- Complete backend/QL verification: 853 passing (689 TAP + 164 non-TAP checks).
- New Phase 2U mobile regressions: 20/20.
- Complete mobile verification: 301/301.
- Shared JavaScript: 137/137 parsed.
- Strict Phase 1 readiness gate: 37/37.
- Calendar/iCal and prior category contracts: PASS.
- Unexpected failures/skips/TODOs: 0/0/0.
- Native-device/release validation remains a separate rollout requirement; mocked shared-mobile tests are not native builds.
- GitHub Actions must be verified on the exact pushed heads; final response records those run IDs and commits.
