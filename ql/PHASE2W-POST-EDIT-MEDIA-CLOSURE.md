# Phase 2W — Test Tile and Glaze Combo post-edit media closure

Both branches: `ql/phase-2w-test-tile-combo-post-edit`.

Phase 2W is limited to the four mobile post-edit paths identified by the Phase 2V repeat audit. Server Test Tile and Glaze Combo ownership/publication routes are intentionally unchanged. Global `/uploads` remains unrestricted.

## Root cause

The shared `EditablePhoto` component has a deliberate compatibility default: stored-photo replacements use `/uploads/<replacementFilename>` unless a caller opts into protected delivery or supplies a category-aware `saveEditedPhoto`. TestTileDetail, AddTestTile, ComboDetail, and AddCombo already loaded their initial stored media through Phase 2J/2K category contracts, but those four editor callers had not opted their replacement completion into those contracts.

The repair stays at those category-aware callers plus scoped Test Tile/Combo cache invalidation. The generic editor remains unchanged for legacy/local callers.

## Preserved contracts

- Test Tiles: owner-protected slots 1/2/3 remain `GET /api/ql/test-tiles/:tileId/photos/:slot`.
- Combos: explicit public remains the existing anonymous record-aware public route; owner-private remains the authenticated owner route; legacy ambiguity remains compatibility-only.
- Unsaved device previews stay local.
- No filename inference, schema change, migration, backfill, deployment, OTA, native build, store submission, or production-data access.
- Global `/uploads` is not changed in Phase 2W.

## Verification intent

The mobile Phase 2W regression covers post-edit route promotion, slot identity, public/private metadata authority, stale session rejection, account switching, protected-state cleanup, and local unsaved previews. Phase 2J and Phase 2K regressions remain in the complete mobile suite. This repository adds server/web preservation assertions and keeps the complete backend/QL suite authoritative.
