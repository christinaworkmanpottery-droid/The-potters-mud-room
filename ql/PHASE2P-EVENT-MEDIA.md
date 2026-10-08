# Phase 2P Event media verification

Verification repair of backend 513e81a3d0ea34dfe58b5898d86f56fb437722e4 and mobile d3194127b0e55087594372cfb154d2d4afa7d735. Both original exact-head push workflows failed (backend 36664107819; mobile 36664026299).

## Causes and narrow repairs

- Backend Event DOM test contained an invalid regular expression and asserted a detail-photo call that does not exist: the website has Event cards and a metadata editor, not a separate image detail view. The assertion now executes the existing configurable markup helper with the detail class. Existing card/editor behavior is unchanged.
- The static-upload assertion used `uploadsDir` instead of the actual unchanged `UPLOADS_DIR` identifier. Corrected the identifier and added real anonymous HTTP compatibility verification.
- Mobile sharing/calendar assertion searched from an import through unrelated image-rendering JSX. It now executes the actual share callback and Google Calendar builder, asserting that their outputs contain metadata and no image reference.
- Actual website defects: revoked blobs were not removed from displayed Event images; late metadata could render after account replacement; a stale multi-image loop could start another request with a replacement token; image 401 responses did not clear earlier Event blobs. Added DOM cleanup, generation/token guards, and current-session expiry handling. Share/edit metadata callbacks also reject stale completion.
- No earlier safety tests were removed, skipped, or relaxed. Added behavioral DOM, mobile-loader/hook, and disposable HTTP/database tests.

## Verification

`node ql/verify-phase1.cjs`: 671 passing executions (507 TAP tests plus 164 individual legacy PASS checks; excludes nine summary lines and the final runner summary). Includes 43 Phase 2P backend/web regressions (10 source contract, 17 DOM, 16 HTTP/mutation checks) and all earlier protected-media and calendar/iCal coverage.

Separate `QL_READINESS_STRICT=1 node --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs`: 37/37. Mobile complete suite: 207/207, including 27 Event checks. Shared JavaScript parsing: 131/131. No failures, skips, TODOs, or cancellations in the final local runs. Exact-head Actions must be checked after pushing these repairs; local results alone do not close Phase 2P.

## Contract and remaining risk

Events have server-enforced ownership and no explicit image-publication state. Current authenticated responses select owner-protected image delivery without reclassifying historical URLs. Protected delivery is authenticated, owner-scoped, private/no-store, collision-aware, and fail-closed. No public Event-image route was added. Anonymous subscriptions and share/calendar payloads contain metadata only.

Replacement commits the new DB reference before reference-safe cleanup. Failed uploads are discarded; foreign/missing mutations are equivalent. Delete commits metadata removal before cleanup. Shared references retain files; cleanup/response failures cannot remove the committed replacement. Unrelated Event fields and calendar output remain intact.

Known historical `/uploads/<filename>` URLs remain anonymously readable; old clients still rely on static delivery. Anonymous subscription URLs expose Event metadata to their holders. No deployment, production-data access, migration/backfill, filename rewrite, global uploads restriction, OTA, native build, or store submission occurred. Phase 2Q implementation has not begun.
