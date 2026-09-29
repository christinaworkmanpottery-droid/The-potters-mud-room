# QL Phase 1F — resumable checkpoint

September 29, 2026. Complete on `ql/phase-1-relationships`. Nothing deployed.
Production branches, Render services, mobile sources/builds and production data untouched.
Starting checkpoint: `8e7f397629340fd8fe0988278b3158f263f5590b` (Phase 1E).

## Policy and implementation

- Effective Firing↔Piece links are the same-owner union of the optional legacy selection
  and explicit QL pairs. Duplicate pairs yield one Firing result.
- Legacy-only records remain valid/readable without mutation or migration.
- QL-only pairs remain explicit; creating them does not choose/overwrite a legacy selection.
- Different legacy/QL Pieces mean additional shared associations, not exclusive ownership.
- QL remove atomically clears both forms of its selected pair; retries are inert.
- Legacy create/edit goes through `ql/relationships.cjs`: persist the record and selection,
  remove the previous selected QL pair on reassignment/clear, and add the new selected pair
  when QL is installed. Preserve other associations. No historical/global normalization.
- Piece deletion still preserves all Firing history/photos, including last-link history.
  Explicit Firing deletion still removes its links while preserving Pieces/shared files.
- No schema/migration changes. No UI, reverse APIs, higher-level features or deployment.
- Service policy and complete server read/write audit: `ql/RELATIONSHIPS.md`.

## Verification

Ran the full `node ql/verify-phase1.cjs` at the exact starting checkpoint: 204 passing executions.
Ran the full command after Phase 1F: **233 passing executions**, zero failures (Node 22.16.0).
All Phase 1A–1E suites retained. Two old Phase 1A assertions of independent legacy unlink
were updated to the deliberately superseding Phase 1F pair-removal contract; all other
preservation assertions remain. Disposable server harnesses now copy the service module.

New checks: 17 service/unit executions and 12 HTTP executions (5 legacy + 7 QL).
Cover legacy-only, QL-only, dual/different Pieces, create/retry/remove, stale/cross-owner
corruption, selection replace/clear/omission, preservation of unrelated pairs, identical
foreign/missing failures, injected transactional rollback, Piece deletion and Firing history.

Implementation commit: `b173793ebd860648db7a5e5451a5288effe177b7`.
GitHub Actions **successful** for that exact implementation commit:
https://github.com/christinaworkmanpottery-droid/The-potters-mud-room/actions/runs/36612180084
The branch-only workflow used Node 22, `npm ci`, and the full Phase 1 verifier. No deploy.
This checkpoint-only follow-up records the confirmed remote result; runtime/test code is unchanged.

## Newly clarified risks

- Legacy screens still expose only their single selection, not the full QL set.
- Existing full-replacement PUT clears an omitted `pieceId`; retained for compatibility.
- Stale clients can reselect an unlinked Piece with a later valid PUT (last-write-wins;
  no existing revision token). Atomicity is not optimistic conflict detection.
- Raw SQL writers bypass the service. Historical corruption remains filtered and unmodified
  except for the particular selected pair deliberately written/removed.
- Legacy PUT to missing/foreign Firing now returns identical generic 404s instead of a
  misleading no-op success. Legacy invalid related Piece errors remain identical 400s.
- Existing Actions checkout/setup-node v4 runtime deprecation warning remains outside scope.

## Exact recommended Phase 1G — not started

**Add a read-only Phase 1 relationship integrity audit and synthetic migration/recovery
rehearsal.** Report stale/cross-account legacy and QL references and schema drift without
repairing them; classify legitimate legacy/QL multi-Piece associations correctly under
Phase 1F. On disposable fixtures only, verify backup → opt-in Phase 1A migration → mixed
legacy/QL writes/deletes → restore, preserving IDs, ownership, history and photo references.
Run the full verifier, commit/push and checkpoint. No production DB access, schema change,
automatic repair/backfill, UI, new relationship APIs or deployment.
