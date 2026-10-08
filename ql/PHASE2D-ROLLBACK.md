# Phase 2D — rollback plan

Date: 2026-09-29

Phase 2D is code-only and does not rename files, change storage paths, backfill records, alter production data, or remove `/uploads`. Rollback therefore requires no database or media restoration.

## Revert steps

1. Revert the Phase 2D commit on `ql/phase-2d-piece-media` (or remove only the Phase 2D server/client changes before any future merge).
2. Restore Piece detail rendering to `/uploads/<filename>` for all Piece photos.
3. Remove the private Piece-detail route `/api/ql/pieces/:pieceId/photos/:photoId`, the `photoVisibility` response field, and private Piece-detail object-URL loader.
4. Keep the pre-existing Connected History route and Phase 2C protections unchanged.
5. Leave the global static `/uploads` route enabled; no stored filename changes are required.

## Rollback verification

Run the complete QL verifier and strict Phase 1 gate. Confirm Piece detail renders its prior legacy URLs, website/mobile APIs still return the same filename fields, Connected History protected photos still pass owner/cross-account tests, public/community image surfaces still load, and no database/upload files changed as a consequence of the rollback.

Because Phase 2D performs no migration, a rollback does not need to rewrite references or move bytes.
