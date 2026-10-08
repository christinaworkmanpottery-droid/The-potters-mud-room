# Phase 3F — Piece → saved Clay read-only View

Branch in both repositories: `ql/phase-3f-piece-clay-readonly`.
Parents: backend `6aa80ea99e6a0befe2b610529d4a0eea93726144`; mobile `10151c0fe31da88ddbd7d3ba3e00d38869ce5b82`.

## Contract preserved

The existing nullable `pieces.clay_body_id` is the sole saved-library relationship. An owned resolved Clay supplies the current display name; descriptive/manual `pieces.studio` remains the compatibility fallback. Names, aliases, cached titles and route snapshots never grant View. One Piece has zero/one saved Clay; many Pieces may share that Clay. No name matching, reassignment, Link/Unlink or picker was added.

Backend runtime, schema, endpoints, migrations, Piece editors, POST/PUT precedence, CSV and Connected History are unchanged. POST prefers `clay` over `studio`; PUT prefers `studio` over `clay`. PUT with no Clay ID clears the ID. The existing website editor can retain and resend its hidden Clay ID after descriptive text edits; this mutation-semantic issue is documented only, not repaired here. Historical coexisting ID/text is untouched.

Renaming Clay changes the resolved name on the next fresh Piece/History/export read without rewriting stored text. Clay deletion clears owned Piece references, leaves Pieces and raw Studio text intact, and does not copy the deleted name. A no-text Piece may display no Clay afterward. Piece deletion preserves Clay. History retains current Clay values and Clay creation chronology, with no fabricated link date; manual text creates no History relationship. CSV retains the current owner-resolved Clay Body column and raw Studio column.

## Website

A compact View appears beside the unchanged Clay label only after independently authorizing the saved Clay ID from current authorized Piece state. Opening clears the existing Clay modal, fetches Clay detail without cache, then re-fetches the originating Piece to confirm ownership and the same reference. Only then does the existing renderer show detail. Loading, generic unavailable, error and Retry are supported.

Piece-origin Duplicate/Edit/Add Photo controls use Phase 3E effective control hardening: hidden, disabled, non-focusable, inline display none and disconnected handlers. Normal library controls are restored on normal opening. Closing returns focus to the surviving launcher, invalidates request generation and clears protected image/blob state. Piece/session change invalidates pending work; late responses cannot reopen the viewer.

## Mobile

PieceDetail uses current server-confirmed state and adds a small Clay View affordance. Local-only, unsynchronized/unverified, offline and unfocused Pieces do not grant access. The affordance independently verifies Clay and the current Piece reference. Navigation passes only Clay ID, originating Piece ID and session/origin context. The existing ClayDetailScreen performs fresh authorization on entry/focus/retry and renders through its existing layout in read-only mode.

Account/session/Piece/Clay/focus/connectivity changes discard prior verified detail. Request serials reject late work. Confirmed same-session Piece descriptions can remain offline; fresh Clay detail cannot open offline. Reconnect re-fetches Piece to use its current Clay reference. Clay detail reconnection requires fresh authorization. No offline Clay authorization or queued mutation exists. Duplicate/Edit/Delete are absent and the existing non-editable ClayPhotoImage replaces the editable photo path only for Piece-origin viewing. Navigation Back returns to the originating Piece.

## Media

Phase 2G delivery and cache architecture are reused unchanged: owner-protected Clay/photo identity checks, generic failures, missing-photo fallback, revision-aware mobile cache, session isolation, and website blob cleanup. Known-private media never falls back to `/uploads`. No photos are copied to Pieces; global `/uploads` is unchanged.

## Verification

Node 22, repository-declared dependencies and unchanged lockfiles. Local disposable databases only. Existing mobile runtime/test source and dependency hashes match the Phase 3E remote tree; unrelated historical local documentation/assets are not part of the pushed patch. Remote commits are based directly on the exact approved Phase 3E parents.

- New backend/web regressions: 36/36.
- Complete backend/QL verification: 1,100 passing (863 TAP + 237 standalone checks).
- New mobile regressions: 42/42.
- Complete mobile verification: 573/573.
- Shared JavaScript parsing: 150/150.
- Strict Phase 1 readiness: 37/37.
- Phase 2 protected-media, Phase 3A–3E and Calendar/iCal: PASS.
- Final unexpected failures/cancellations/skips/TODOs: 0/0/0/0.
- Exact-head non-deploy Actions commit/run IDs are recorded in the completion report.

## Deferred release checks and next task

Physical-device validation remains required: iOS Back gesture, Android Back, offline Retry, reconnect, account replacement, protected photos, read-only control visibility and focus/return flow where applicable. Automated DOM/controller/hook tests are not physical-device validation. No native builds were performed.

`events.contact_id` remains a separate pre-release database-initialization maintenance item at unchanged priority. No repair is included.

Recommended next task: **Phase 3G scope/audit only — Piece → saved Glaze read-only View**. Audit the existing `piece_glazes` layer records, saved Glaze IDs versus manual labels, ownership, cardinality/order, deletion, viewer reuse, protected Glaze media, offline/session lifecycle, History and export semantics before proposing implementation. Do not create an implementation branch or begin the slice during Phase 3F.

Production untouched. No deployment, migration/backfill, OTA, store submission, native build, media redesign or `/uploads` restriction.
