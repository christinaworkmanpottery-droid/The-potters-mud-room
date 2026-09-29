# Phase 2D — Protected Piece media compatibility contract

Date: 2026-09-29

## Scope

Phase 2D protects only Piece-detail photos used by the authenticated private website workflow. It does not disable `/uploads`, migrate files, rename filenames, change mobile QL behavior, or alter Gallery, Community, Forum, Glaze Combos, Events, Profiles, or other image-bearing surfaces.

## Classification

Piece photo delivery is classified from the owning Piece record, not from the filename.

- `private`: `pieces.is_public = 0`. This is an account-owned studio Piece and the website Piece-detail surface uses authenticated protected delivery.
- `public`: `pieces.is_public = 1`. This is an explicit public-gallery opt-in. Phase 2D leaves its legacy public image behavior unchanged.
- `legacy-ambiguous`: the visibility flag is NULL, missing, or otherwise not exactly 0/1. Phase 2D does not auto-reclassify it. The existing website compatibility behavior is preserved.
- unsupported automatic classification: any shared upload reference that cannot be proven to belong to the requested Piece and current account, any invalid visibility value, and any filename reused by a foreign-account record.

No classification is inferred from UUID shape, filename, route, creation date, or filesystem location.

## Protected private Piece delivery

`GET /api/ql/pieces/:pieceId/photos/:photoId` requires bearer authentication. The server resolves the photo through `piece_photos -> pieces`, requires current-account ownership, requires the Piece to classify as `private`, validates a safe stored raster file, rejects ambiguous cross-account filename reuse, sends `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`, and returns the same generic 404 payload for foreign/missing/unavailable media.

Stored filenames remain unchanged and are never used as authorization.

Connected History continues to use its existing owner-scoped `/api/ql/pieces/:pieceId/history/photos/:photoId` route, now backed by the same delivery helper.

## Website transition

The authenticated Piece-detail JSON now includes `photoVisibility`.

- `private`: the website fetches each Piece photo with bearer auth, `cache: no-store`, and renders a temporary object URL.
- `public`: the existing `/uploads/<filename>` URL remains in use for compatibility.
- `legacy-ambiguous`: the website preserves the pre-Phase-2D legacy URL behavior. It does not silently claim the record is private or public.

Protected-photo failure is local to that image. Piece details, edit controls, and Connected History remain usable.

## Mobile compatibility

No iOS/Android QL code changes occur in Phase 2D. Existing supported builds continue using stored filenames and legacy `/uploads` references. The API adds `photoVisibility` without removing or renaming existing fields, so old clients can ignore it.

Before global `/uploads` restriction, supported iOS/Android builds must be updated to consume an explicit protected/public media contract, private caches must be account-isolated/purged on account replacement, public/community media must have an explicit anonymous-delivery contract, ambiguous legacy references must be inventoried, and a production-approved migration/rollback rehearsal must pass.

## Session/cache isolation

The website tracks private Piece-detail blob URLs separately from History blob URLs but revokes both through the established Piece private-state cleanup path. Cleanup runs on navigation away from Piece detail, logout, and successful account replacement before the new token is installed. In-flight private photo fetches also verify Piece view generation and session token before creating a blob URL.

## Compatibility boundary

Global `/uploads` remains intentionally unchanged in Phase 2D. Existing filenames, database references, website public surfaces, and native clients remain valid. This slice reduces exposure only where ownership and privacy are already provable: private authenticated Piece detail.
