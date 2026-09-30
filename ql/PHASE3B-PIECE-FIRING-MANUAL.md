# Phase 3B — Manual Piece ↔ Firing

Branch in both repositories: `ql/phase-3b-piece-firing-manual`.
Authoritative GitHub parents: backend `388d804a0bae09aaa7be4ee04910e8d95efb393f`; mobile `18f0e530b9054d09cc1b854e4f45b2c4c1b104bb`.

## Contract and synchronization

The existing Phase 1F relationship service is unchanged. The effective same-owner union of `firing_logs.piece_id` and `ql_piece_firings` remains authoritative. Matching pairs deduplicate; different Piece associations remain valid. Explicit Link adds only its QL pair, without changing the selected legacy Piece. Unlink atomically clears both representations of the requested pair and preserves unrelated links. Legacy selector reassignment synchronizes only affected pairs. No schema, migration, inference, repair, entitlement, or conflict-resolution change is included.

Existing authenticated endpoints remain:
- GET `/api/ql/pieces/:pieceId/firings`
- POST `/api/ql/pieces/:pieceId/firings` with `{ firingId }`
- DELETE `/api/ql/pieces/:pieceId/firings/:targetId`

Ownership comes from authentication and the service's same-owner checks. Foreign/missing/deleted targets retain generic unavailable responses. GET retains its array shape and Phase 3A `X-QL-Relationships-Available: true|false` header. The shared canonical `serializeFiring` now serves list, detail, and relationship responses, preserving all stored Firing fields, IDs, schedule, notes, dates, selected Piece and protected Phase 2L photos. No junction rows become a viewer contract.

When relationship tables are unavailable, legacy-only Firings remain readable through the service and existing Piece/Firing workflows. The availability header is false and new controls display unavailable/retry, with no mutations or startup migration. Legacy piece_id is not rewritten by unavailable relationship actions.

## Website

Piece detail includes compact Linked Firings with list, eligible saved-record selector, explicit Link/View/Unlink, loading, empty, unavailable, generic error and Retry states. Saved kiln/date/type/cone and IDs distinguish records. Already-linked IDs are excluded. Successful mutations reload the server union, replace/reload Connected History, and refresh the old Piece Firing summary from the server. No optimistic relationships are created.

View reuses the existing Firing modal and renderer with fresh authorized detail. Relationship entry hides direct Delete and photo reorder; the existing explicit Edit button still enters the existing editor. Protected photo delivery and lightbox cleanup remain intact. Piece/account/token/generation/mount checks, mutation locks and Firing-request markers prevent stale completions from altering a new screen. Piece navigation closes and clears the linked viewer.

## Shared iOS/Android

`LinkedFirings` mounts in PieceDetailScreen beside LinkedPricing. Its narrow controller confirms the persisted Piece via server GET and checks the availability header before allowing writes. Local-only, unsynchronized, offline, stale cached or unavailable Pieces cannot fabricate or queue links. Existing local Piece editing remains intact. The parent Firing summary refreshes from the confirmed server Piece.

View loads authorized data and navigates to the existing FiringDetailScreen in read-only mode. That screen uses a guarded loader with loading/error/Retry, keyed by Firing/account/session/focus. Relationship entry carries the originating session generation. Read-only photos use the existing FiringPhotoImage; photo editing, reordering and direct deletion are excluded, while deliberate Edit opens the existing AddFiring workflow. Returning from editing refetches data. No second Firing renderer is introduced.

## Verification

Synthetic local databases only, Node 22 as used by CI:
- New backend/API: 21 passing checks.
- New website DOM: 24 passing checks.
- New backend/web combined: 45/45.
- Complete backend/QL runner: 957 passing executions (752 TAP + 205 standalone PASS assertions).
- New mobile: 40/40; complete mobile: 413/413.
- Shared JavaScript parsing: 142/142.
- Strict Phase 1 readiness gate: 37/37.
- Phase 2 protected-media contracts: PASS.
- Phase 3A regressions: 38 backend/web and 28 mobile PASS.
- Calendar/iCal: PASS.
- Zero failures, cancellations, skips or TODOs in completed runs.

The new API tests cover both representations, union deduplication and Connected History, one-to-many and many-to-one relationships, idempotency, authenticated ownership, canonical serialization, protected media, legacy reassignment, pair-specific unlink, deletion safety and unavailable-table behavior. Website/mobile tests cover controls, server refresh, unavailable/error/Retry, rapid actions, session/navigation isolation and viewer reuse. Existing Phase 1F, deletion and media suites remain in the full runner.

Final completion requires successful GitHub Actions attached to the exact pushed commits. The workflow includes this branch and both new suites; neither workflow deploys.

## Limits and next task

Production is untouched. No production-data access, migration/backfill, deployment, global `/uploads` restriction, OTA, native build or store submission occurred. Physical-device validation remains a release gate. Old clients' last-write behavior for the legacy Piece selector remains deliberately deferred. A server mutation accepted before navigation can complete, but its stale client response cannot update the new screen.

Recommended Phase 3C: **scope/audit only for manual Piece ↔ Test Tile list/select/link/view/unlink on website and shared mobile**. Audit the existing Unlimited entitlement contract (`starter/basic/mid/top`) across relationship list/select/link/view/unlink, Test Tile detail/photos and Connected History. Explicitly define downgraded/free-account behavior before implementation approval. Review ownership, unavailable-table behavior, deletion preservation, existing viewer reuse and session/navigation safety. Propose the smallest consistent implementation slice. No entitlement changes, implementation, schema changes, automatic associations, reverse management, production access or deployment during that audit. Phase 3C has not begun.
