# Quantum Leap checkpoint — Phase 2D

Phase 2D protected-media compatibility slice is implemented on branch `ql/phase-2d-piece-media`.

- Private Piece-detail photos: authenticated owner-scoped protected delivery.
- Explicit Piece media classification: private, public, legacy-ambiguous.
- Existing filename references preserved.
- Public/ambiguous compatibility preserved through legacy delivery.
- iOS/Android implementation not started.
- Global `/uploads` remains enabled.
- Production untouched; no migration, backfill, deployment, or production-data access.
- Rollback: `ql/PHASE2D-ROLLBACK.md`.
- Compatibility contract: `ql/PHASE2D-MEDIA-COMPATIBILITY.md`.
