# Quantum Leap checkpoint — Phase 1I

Date: 2026-09-29. Branch: `ql/phase-1-relationships`.
Starting checkpoint: `d56a495bbff24b241881951bec6213b7f38746d2`.
This checkpoint is committed with the Phase 1I implementation; use Git history for its SHA.

**Phase 1 is READY TO CLOSE.** Zero known closure blockers remain after the equivalent-bypass
review. No production access, migration, deployment or repair. No UI, Esme, voice, advanced
search, redesign, native/platform work or community expansion. Phase 2 has not begun.

## Seven repairs

1. **Pricing/shared files — fixed.** Globally reference-aware, safe-path cleanup after DB commit;
   shared/Piece-only/pricing-only files, missing files, SQL failures, QL links and foreign requests tested.
2. **Gallery/Photo Lookup — fixed.** Same-owner related library reads, private candidate scope,
   fresh owner/visibility recheck, unsafe/stale file filtering; public Gallery behavior retained.
3. **Admin cleanup — fixed.** Size/video paths preserve all registered and orphan-metadata file
   references, including cross-account references. No metadata deletion to force orphan status.
4. **Sale deletion — fixed.** Sale/required Piece changes atomic; failures roll back; surviving
   Sales keep their history and sold Piece state; only last Sale removal resets an owned sold Piece.
5. **Sale→Contact — fixed.** Generic unavailable rejection on create/edit; safe API/internal reads;
   atomic Contact detach; foreign inbound rejection and self/admin account preflight coverage.
6. **Shared-image edits — fixed.** Copy-on-write across editable photo slots, no old-byte overwrite;
   ambiguous same-account filename edits reject safely; reply-photo ownership follows its author.
7. **Historical Firing startup — fixed.** Supported pre-QL rebuild preserves parent/children/later
   columns; transactional DROP failure rolls back. Unsupported post-QL rebuild order rejects before
   any mutation. Historical Tile/Sales variants and legacy runners covered.

Equivalent bypasses fixed: avatar/profile, Event, forum and Project cleanup; Sale and Combo cleanup;
Pricing editor omission; forum reply/post ownership confusion; internal Sale Contact read; lossy
legacy Sales rebuild; unsafe legacy HTTP/CLI migration invocation; dormant emergency WAL/upload
removal; unsafe stored-file reads and stale async image-hash writes after photo replacement.

## Verification

Node **22.16.0**, unchanged dependency lockfile. Disposable data and loopback servers only.

- `node ql/verify-phase1.cjs`: **336 passing executions**, **0 failures, 0 TODO, 0 skips**.
  Count = 187 Node test-runner passes + 149 individual manual checks; excludes summaries and
  the separate successful disposable schema/integrity diagnostic.
- Original **9 previously failing readiness checks: 9/9 pass**. Original historical Tile
  preservation check also passes. No assertions weakened or marked optional.
- Expanded readiness API suite: **25/25 in QL mode and 25/25 in legacy mode**.
- Historical migration/cleanup/internal-read suite: **12/12**.
- Strict gate: `QL_READINESS_STRICT=1 node --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs`
  — **37 passed, 0 failed, 0 TODO, 0 skipped**, exit 0.
- All Phase 1A–1H established regression behavior retained. `git diff --check` clean.
- GitHub Actions: confirmation pending push of this implementation checkpoint. CI runs the
  complete verifier and expanded strict gate; record its observed result after push.

Read `PHASE1-READINESS.md` for current contracts, equivalent-path review and limits.
`PHASE1H-READINESS.md` preserves the original blocked audit; its open statuses are historical.
The only `schema.json` delta is Sales CREATE SQL formatting from its corrected preserving rebuild;
column/FK inventory and QL migration contract/checksum remain unchanged.

## Deferred gates and limits

Before production migration: authorized actual-schema inventory and exact historical fixtures;
coordinated writer freeze and paired database/uploads backup/restore rehearsal; image decoding,
path and permission checks; representative audit scale/memory/runtime within a maintenance budget;
explicit release/migration approval. Current fixture success does not certify production.

Later platform gates: native cache/account isolation, live iOS source mapping, real-device/store
purchases. Firing stale writes remain last-write-wins until revision handling is approved.
Unrelated manual/community workflow coverage and conservative unused-file retention remain deferred.
Optional legacy Photo Lookup visibility schema is respected when present; its toggle safely returns
409 when absent. Multiple same-account filename references reject edits until an explicit target
can be supplied through a separately approved client/API change. No UI changed here.

## Exact recommended Phase 2A — not started

Read-only connected Piece-history contract and service/API, website only: aggregate the authenticated
owner's existing Piece, Clay, Glaze applications, legacy/QL Firing union, explicit Test Tile/Pricing
links, Sales and photos into a deterministic read model and one owner-scoped read endpoint. Include
source IDs/types and recorded dates; preserve unknown dates/manual labels; deduplicate identical
associations; filter inaccessible/stale references without repair or inferred links. Add contract,
legacy compatibility and isolation regressions. No UI, new relationships, automatic backfill,
AI/Esme, voice, advanced search/ranking changes, redesign, native work or production actions.
Await the next assigned chunk; do not implement Phase 2A in Phase 1I.
