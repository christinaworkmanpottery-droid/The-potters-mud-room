# Quantum Leap checkpoint — Phase 2E

Phase 2E adds private Piece-photo compatibility to the shared mobile client without restricting global `/uploads`.

- Mobile branch: `ql/phase-2e-private-piece-mobile` in `potters-mudroom-app`.
- Backend branch: `ql/phase-2e-private-piece-mobile`, based exactly on Phase 2D commit `c7155bcc7cc784016e57c783e54455ecae4792cd`.
- Piece list API now exposes the same explicit `photoVisibility` classification already used by Piece detail.
- No migration, backfill, file rename, deployment, production-data access, native-store release, or global media rewrite.
- Production remains untouched.
