# Phase 2V — Casualty and Sale-selection Piece-media closure

Both branches: `ql/phase-2v-casualty-sale-previews`.
Backend base: `800ad591d7d0767b8b2652a148b6b4468d50f09f`.
Mobile base: `66a9ddc839dd1821ac8939f6f1a6632bafe40f18`.
Both Phase 2U GitHub heads and their successful workflow runs (36674308890 / 36674323252) were reconfirmed. The cached mobile source was compared against the remote Git tree and differing source files restored before implementation; the remote parent remains the exact Phase 2U commit.

## Decisions

GLOBAL /uploads IS NOT READY FOR RESTRICTION

PHASE 2 IS NOT READY TO CLOSE

All four authorized Piece-preview bypasses are migrated. The full audit found a separate reachable post-edit bypass in four mobile Test Tile/Glaze Combo editors. It is reproduced by a synthetic runtime test and deliberately left for Phase 2W. No Phase 3 work began.

## Exact paths migrated

| Bypass | Previous path | Phase 2V result |
|---|---|---|
| Website Sale-selection Piece preview | `openSaleModal → /api/pieces → _salePieces → onSalePieceSelect → salePhotoPreview` constructed `/uploads` | Uses `pieceEdgePhotoAttrs` and `loadPieceEdgeMedia`; authenticated private fetch; record-aware public or authenticated owner-history contract; compatibility only for ambiguous classification |
| Mobile Casualties | `getCasualties → renderItem` had a collapsed Image and expanded EditablePhoto array/primary fallback | Collapsed `PiecePhotoImage`; expanded `EditablePiecePhoto`, including primary-only fallback. Separate render branches share `usePiecePhotoUri` and `pieceMedia` |
| Mobile AddCasualty | `route.params.casualty → existingPhotos → EditablePhoto` constructed `/uploads` | Existing stored photos use `EditablePiecePhoto`. New device picks retain local `EditablePhoto uri={p.uri}`; never sent through protected loading |
| Mobile AddSale | `getSalePieces → choosePiece → piecePhoto → Image` stored a static URL | Selection stores complete Piece/photo identity; `PiecePhotoImage` loads it. Removal and image-free replacement clear the prior preview |

Classification is unchanged: explicit 0 private, explicit 1 public-aware, otherwise legacy-ambiguous compatibility. No filename heuristics or historical reclassification. Public-but-unfinished/broken records use the existing authenticated owner-history route; eligible public Pieces use the existing explicit public route.

## Session and selection isolation

- Website selector metadata keeps its existing token/generation/request guard. Account cleanup clears its Piece array, options and preview. The shared Piece edge helper now tracks originating image nodes so the Sale preview scope can abort pending fetches and revoke blobs on selection changes, local-file selection and modal close, without clearing unrelated Piece views. Detached, aborted or old-session responses cannot create visible blobs. Protected failure stays local and never attempts static loading.
- Casualties rejects old-session list responses and clears records/expanded state on replacement. Both rendered branches inherit synchronous hook identity masking and session-scoped cache behavior.
- AddCasualty remounts its form for a different route Piece ID, resetting existing and local photo state. Session notifications drop preview references; picker completions and edited-photo callbacks reject expired sessions. Existing photos retain full Piece identity. Stored and unsaved local previews stay separate.
- AddSale preserves its Phase 2N request guards and cleanup; cleanup now also clears the selected Piece ID. Selection changes feed a different hook identity; late prior-Piece responses cannot restore the old image.
- Shared media session rotation already revokes web blobs and removes controlled native cache files, including late completions. Tests exercise web and mocked iOS/Android paths, same-account replacement, account replacement and logout. Native device/build validation is not claimed.

## Narrow integration repair: keep Casualty photo editing working

Protected-aware editing returns a replacement filename and requests a reload rather than constructing a static URL. Casualties/AddCasualty now retain that returned filename in preview state. The shared Piece cache and native destination include the filename revision so an edit cannot reuse old bytes. Editable Piece children are keyed by full media identity; decode failures display only a local placeholder.

AddCasualty's removed-photo comparison uses the existing photo ID when present, retaining filename comparison for legacy records without an ID. This is necessary so updating preview metadata does not accidentally mark an edited photo as deleted on Save. Mutation endpoints, deletion rules and edit ownership are unchanged.

Sale create/update payloads, rollback, Sale→Contact ownership, Quick Sale, Piece-photo copying, Casualty/Piece deletion and historical records are unchanged. Viewing causes no server mutation. No server/schema/migration source changed.

## Complete repeated current-source audit

Searched both pinned trees, including all current website HTML/JavaScript, shared-mobile source, server URL construction, generic media helpers, image consumers and editor completion paths. Inspected source callers and route registration, not only direct string matches. Compiled bundles were inventoried separately; no bundles regenerated. Repeated searches included `uploads`, `source=`, `uri=`, `imageUrl`, `getLegacy*PhotoUri`, `storedFilename`, Combo slot writers, and filename-replacement responses.

### Current reachable runtime consumers — restriction blockers

The generic `src/components/EditablePhoto.js` defaults `protectedDelivery=false`. After successful `replaceStoredPhoto`, a changed filename constructs `${API_BASE_URL}/uploads/${replacementFilename}?edited=...`. The server's existing `/api/photos/by-filename/:filename` endpoint creates a fresh JPEG filename for every successful replacement, including current JPEG input, not only historical HEIC.

These current registered editors pass stored filenames without either `protectedDelivery` or `saveEditedPhoto`:

1. `TestTileDetailScreen.js:ProtectedTestTilePhoto` — initial protected load, then generic edit completion can render static replacement.
2. `AddTestTileScreen.js:ProtectedExistingTestTilePhoto` — same issue for existing stored tile photos; new local picks are distinct.
3. `ComboDetailScreen.js:ComboDetailPhoto` owner branch — protected/public initial contract is lost on edit completion.
4. `AddComboScreen.js` existing stored photo editor — same generic completion path.

This is one shared post-edit defect across four surfaces, not old-client-only or explicit ambiguous compatibility. A Phase 2V audit regression executes the actual generic editor with a protected blob input and a successful synthetic filename replacement and observes the resulting static URL. Source assertions establish the four callers. No edits to these screens, their loaders or the generic editor were made in Phase 2V.

### Explicit legacy-ambiguous compatibility paths

| Current source references | Classification / guard |
|---|---|
| Website `pieceEdgePhotoAttrs` | Static only when established classification is legacy-ambiguous |
| Website `clayPhotoMarkup`, `glazePhotoMarkup`, Test Tile markup, `firingPhotoMarkup`, `salePhotoMarkup`, `pricingPhotoMarkup`, `projectPhotoMarkup` | Existing category owner-protected metadata selects protected loading; absent legacy metadata retains compatibility |
| Website `comboPhotoUrl`, Forum markup, avatar context, Glaze/Clay Test markup, `eventImageMarkup` | Existing explicit legacy/static/ambiguous branches; protected/public-aware paths remain separate |
| Mobile `pieceMedia`, `clayMedia`, `glazeMedia` (including Glaze/Clay Tests), `testTileMedia`, `comboMedia`, `firingMedia`, `pricingMedia`, `saleMedia`, `projectMedia`, `eventMedia`, `profileMedia`, `forumMedia` | Static helper branches retained only via each established compatibility classifier; current protected delivery never uses them on load failure |
| Mobile generic EditablePhoto for genuinely local/legacy callers | Local device previews remain local; legitimate ambiguous stored-image editing retains compatibility. Four known protected/public callers above are explicitly excluded from this classification |
| Mobile PieceDetail `piece.image/imageUrl` fallback | Historical/offline shape without current Piece photos; current server Piece records deliver `photos` and do not produce these aliases. Local database carries historical aliases without a visibility field; no new known-private current-source URL constructor found here |

### Dead/non-delivery references

- Website `renderComboPhotos` string-only fallback: current writers use null, File, or `{filename,combo,slot}` objects. No current string writer found; retained dead/legacy input path.
- AddEvent's initial static-looking image string is a presence sentinel on the actual edit route; the stored image is rendered by EventPhotoImage, while new picks use local URIs.
- Native/web photoEditor `/uploads/` markers parse stored filenames; they do not load media themselves.
- Runtime comments, tests, fixtures, audit documents, historical fix scripts, branding/store asset generators and generated screenshots are not current application media consumers.

### Old compiled/released clients and explicit public routes

- Both checked-in `public/_expo` and `public/app/_expo` bundles contain old static consumers. Released iOS/Android, cached website scripts and saved/shared/bookmarked historic links remain rollout compatibility blockers. They were neither rebuilt nor deleted.
- Server `express.static(UPLOADS_DIR)` remains unrestricted. Filesystem storage/cleanup references are implementation details, not additional browser consumers.
- Piece, Combo, Profile and Shop explicit public routes use record-aware contracts; sample/static catalog delivery remains intentionally public. No new public route or share feature was introduced.

## Exact next recommendation — do not begin automatically

**Phase 2W — Test Tile and Glaze Combo post-edit media closure.**

Close only the four stored-photo editor completion paths listed above through their existing protected/public-aware category contracts, changing a genuinely shared editor helper only if necessary. Preserve local unsaved previews, record/slot ownership, filename replacement semantics and public/legacy classification. Verify successful edit→protected/public reload, changed filenames, selected-record/session races, cleanup, local failure and no protected→static fallback; repeat the complete current-source readiness audit and full verification. Leave global `/uploads` and production untouched. Do not start Phase 3.

## Verification checkpoint

Counts and GitHub evidence are recorded below after the complete verification run. Tests use synthetic records/files only. No production access, deployment, migrations/backfills, filename rewrites of historical records, global uploads restriction, OTA, native builds or store submissions occurred. No redesign, search, Esme or voice was added.

### Final local verification

- Phase 2V backend/web regressions: 16/16.
- Complete backend/QL verification: 869 passing (705 TAP + 164 non-TAP checks).
- Phase 2V mobile regressions: 27/27, including reproduction/documentation of the deferred post-edit blocker.
- Complete mobile verification: 328/328.
- Shared JavaScript parsing: 137/137.
- Strict Phase 1 gate: 37/37.
- Calendar/iCal, Phase 2U public Piece route and all earlier media contracts: PASS.
- Unexpected failures/skips/TODOs: 0/0/0.
- Node 22 used for the complete suites, matching CI. The initial Node 24 attempt could not load the pre-existing SQLite native dependency; rerunning under the repository-required Node 22 resolved that environment mismatch.
- The isolated Sale DOM fixture now includes its real shared Piece-helper dependency; production logic and prior assertions were not weakened.
- GitHub Actions must succeed on the exact pushed commits before declaring this slice complete. Final response records both commit/run IDs.
