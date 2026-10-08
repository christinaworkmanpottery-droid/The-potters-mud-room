# Pre-release Piece editor preservation

Branch in both repositories: `ql/pre-release-piece-editor-preservation`.
Remote parents: backend `89d8d97ec1d502f2f8a7e5fa6a71acb2db6121a1`; mobile `da6207e43c2876418a052219d9a53b37fd6dee0c`.
Phase 3 remains closed. This implements the separately approved editor-preservation audit; no new Phase 3 relationship contract.

## Clay contract

POST/PUT share one deterministic alias resolver. `clayBodyId`/`clay_body_id` resolve before validation. Equal aliases are accepted; conflicting aliases fail atomically. Omitted ID and compatibility text preserve independently on PUT. Explicit ID null clears only the ID; explicit Studio null clears only compatibility text. The remainder of Piece scalar updates retains its previous semantics.

`clayIntent` (also `clay_intent`):
- Omitted: compatible independent explicit fields; differing Clay/Studio text is rejected rather than applying conflicting POST/PUT precedence. A changed legacy Clay label without a cleared ID or explicit intent cannot silently retain a saved relationship.
- `untouched`: no Clay mutation; separate explicit Studio edit is allowed.
- `manual`: require Clay text, clear saved ID, store manual text in the existing overloaded Studio compatibility field. Explicit Clay intent wins over old Studio content.
- `saved`: validate the selected same-owner ID. Manual-to-saved clears the deliberately replaced manual compatibility text. Saved-to-saved retains existing Studio/description text unless the caller explicitly supplies Studio (including null); it cannot classify historical Studio content by name. New selections can explicitly supply genuine Studio content.
- `clear`: clear both by default; an explicit independent Studio value may be retained.

No name matching, data rewrite or migration. Unchanged dangling historical IDs are not reassigned in SQL, avoiding a foreign-key failure on an unrelated edit. Deliberately selecting dangling/foreign records fails.

## Glaze contract

Normalize `glazeIds`/`glaze_ids` arrays or JSON strings before validation/inheritance/insertion. Per-layer aliases: `id`/`layerId`/`layer_id`, `glazeId`/`glaze_id`, `customName`/`custom_name`, `method`/`applicationMethod`/`application_method`, `layerOrder`/`layer_order`, coats, notes. Conflicts/malformed arrays reject without mutation. Omission keeps exact existing rows; an explicit empty array clears them.

Existing metadata can be inherited only through an existing row belonging to this Piece, itself scoped to the authenticated account. Duplicate, stale, foreign or wrong-Piece row identities fail before mutation. Never inherit by Glaze ID. Repeated saved Glazes and mixed manual/saved rows remain independent.

Full replacements may regenerate row IDs. This is acceptable existing behavior; metadata, sparse/duplicate/nullable order, custom text, notes, explicit zero coats and all existing methods (including other) persist. New layers default coats only when omitted; null and zero are not truthiness-defaulted. Supported coats are nonnegative integers or null, matching the integer domain while preserving historical zero. Historical untouched rows are never normalized. Row-identity changes continue to invalidate Phase 3G launchers.

A replacement of existing layers without row IDs must supply complete identity/text/coats/method/notes, otherwise it is an ambiguous destructive old-client write and fails. No guessed repeated-layer matching. New POST layers may use older sparse payloads and receive new-row defaults. Flat Glaze text does not erase structured rows.

## Editors

Website input events, not focus/blur/hydration/name comparisons, mark Clay manual replacement and clear hidden IDs. A saved picker action sets explicit intent. Per-layer snapshots retain saved ID plus historical custom text, coats, method/other, notes and order. Typing clears only that row's saved ID; choosing saved clears the deliberately replaced manual label. Unrelated saves omit unchanged Clay/Studio/layers. Studio-only edits preserve the Clay relationship. Cancel/reopen resets unsaved intent. Notes use the existing notes column.

Mobile snapshots retain row IDs, full metadata, repeats and order. The old destructive aggregate input is replaced with small per-layer name inputs, existing-style library selection, per-row removal and add controls in the existing section. Metadata remains visible and is preserved during label/selection changes. Repeated saved selections can be added. Blank deliberately edited labels remove only that row; explicit removal of all rows emits an empty array. No drag/drop, recipe controls, new model or editor redesign. Duplicate Piece creation omits old row IDs while retaining metadata. Unrelated updates omit relationships, retaining mixed Clay ID/Studio records.

History chronology and Phase 3F/3G authorization are unchanged. Fresh saved-to-manual state has no saved ID to authorize View; manual-to-saved uses normal fresh ownership checks.

## Queue and multipart

Piece queue items carry an account identifier inside the existing JSON payload, without a SQLite migration or stored credential. Unknown/other-account items fail through existing pending/attempt/error mechanisms and are never marked complete. Known original-account replay captures a session guard used before/after asynchronous requests, including token lookup via the API helper. Legacy update entries without the preservation protocol version are retained for review, not guessed. Flat-only legacy Glaze creates and malformed structures also fail recoverably. JSON and multipart share the same prepared payload; structured arrays are JSON-encoded under either alias. Empty/null clear signals are not dropped.

The normal Piece editor remains online-first; this is a safeguard for reachable legacy queue functions, not a new offline editor. Existing non-Piece sync and session guards remain unchanged. There is no new create-idempotency protocol: uncertain old queue outcomes still require review through existing recovery mechanisms.

## Verification and compatibility

New API/database/DOM tests cover no-op, transitions, partial edits, repeated layers, metadata, aliases, multipart, malformed payloads, foreign/stale rows, dangling omission, rollback and History. Mobile tests execute the editor, mapping and queue paths with controlled native dependencies. Final local verification: new backend/web 95/95; complete backend/QL 1,261 passing (1,024 TAP + 237 standalone checks); new mobile 64/64; complete mobile 737/737; shared JavaScript 154/154; strict Phase 1 37/37; Phase 2 media, Phase 3A–3H, History and Calendar/iCal PASS. Failures/cancellations/skips/TODOs: 0/0/0/0. Exact-head GitHub Actions are recorded in the completion response.

Existing Phase 3F audit fixtures previously asserted the deferred bugs (POST/PUT conflicting precedence and omitted Clay clearing). Those expectations are updated to the approved preservation contract; read-only Clay View/deletion/History tests are retained. Disposable server fixtures now copy the new runtime module. This does not reopen Phase 3.

Full gates: backend/QL suite, mobile suite, shared JS parse, strict Phase 1, Phase 2 protected media, Phase 3A–3H and Calendar/iCal. Zero unexpected failures/cancellations/skips/TODOs required. No production access, deploy, migrations/backfill, OTA, native build or submission.

## Later physical-device checklist

Safari: saved Clay/Glaze to manual typing and paste; no-op edits; method other; repeated Glazes; keyboard/Save; cancel/back without mutation.
iOS/Android: metadata no-op preservation, repeats, per-layer changes, saved/manual transitions, offline failure/reconnect, reachable queue paths and original-account recovery, keyboard/Save visibility, cancel/back.
Automated tests do not replace physical-device validation.

## Next separate maintenance slice (not begun)

Recommend `ql/pre-release-events-contact-initialization` in both repositories as applicable: audit and narrowly correct fresh-database initialization of `events.contact_id` against the existing Event/Contact contract, with disposable fresh/legacy/recovery fixtures, repeat-start/idempotence and Calendar/iCal regressions. Do not inspect production schema, deploy or migrate/backfill production. Then fresh-install/recovery rehearsal, followed by physical-device/release validation. Do not begin that slice automatically.
