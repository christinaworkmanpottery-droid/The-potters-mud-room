# Phase 1 readiness — Phase 1I, 2026-09-29

**Phase 1 is READY TO CLOSE.** All seven Phase 1H blockers and the equivalent safety
bypasses identified in this review are repaired and covered. No known Phase 1 closure
blockers remain. This is an isolated source/fixture decision, **not production readiness
or deployment approval**. Phase 2 has not begun.

Starting checkpoint: `d56a495bbff24b241881951bec6213b7f38746d2`, branch
`ql/phase-1-relationships`. The original full relationship/read/write/delete/bulk/account
coverage matrix and nine failing assertions are preserved in `PHASE1H-READINESS.md` as
historical evidence. This document supersedes its open-blocker statuses. Existing
Phase 1A–1H contracts and regressions remain in the full verifier.

## Repairs and focused evidence

| Area | Repair / final contract | Evidence |
| --- | --- | --- |
| H1 Pricing/shared files | Pricing update/delete commit metadata before globally reference-aware cleanup. Every registered reference, including another account or orphan metadata, protects bytes. Missing files are harmless; traversal and symlinks are skipped; IO failure retains unused bytes. QL Pricing cascades affect junctions only. | Original H1a/H1b; I1 Pricing-only/Piece-only/unsafe-path, foreign requests, failed update/delete, QL junction retention; I1/I3 all-slot and IO-failure checks. |
| H2 Gallery/Photo Lookup | Public Gallery sharing remains explicit and unchanged; Clay/Glaze expansion uses the Piece owner's library. Private Photo Lookup scopes candidates to the authenticated user, filters stale files and unsafe paths, re-resolves ownership/visibility after async work, and omits foreign/missing Glaze links. No ranking changes. | H2a/H2b; I2 private/forged IDs, foreign metadata/photos, existing visibility exclusion. |
| H3 Admin maintenance | Size/video cleanup delegates to the same global reference guard; never removes metadata to manufacture an orphan. Unreferenced regular files may be removed; referenced/orphan-metadata/symlink assets are retained. Dormant emergency WAL/all-upload destruction is disabled in code. Legacy HTTP/CLI migration runners reject installed QL. | H3; I3 video/size orphan/reference checks, all registered slots, emergency route, HTTP and CLI guards. |
| H4 Sale deletion | Sale removal and required Piece reset are one immediate transaction. Only removing the last Sale referencing a sold Piece resets that owned Piece to done; other Sale rows and the Piece's current sold state remain unchanged when another Sale survives. File cleanup is after commit. | H4 injected Sale failure; I4 injected Piece failure, multi-sale survival, last-sale reset. |
| H5 Sale→Contact | Create/edit validates Contact server-side, before copying files and again inside the transaction. Foreign/missing IDs have identical errors. API and internal Piece-reader Sales suppress stale/foreign Contact pointers without changing history. Contact deletion atomically detaches own Sales (and existing Event pointers); foreign inbound links reject. Account preflight checks inbound/outbound Contact isolation. | H5; I5 create/update/legacy/read/internal read, Contact delete rollback, foreign inbound, self/admin account rejection. |
| H6 Shared-photo edit | JPEG/PNG/HEIC replacements always create a new JPEG and transactionally update authorized references. Another account's filename/bytes remain unchanged. Multiple references in the same account make a filename-only request ambiguous: return 409 without edits. Avatar/profile aliases in one user row remain one logical image. Forum reply ownership follows the reply, with a valid post chain. | H6; I6 same-account multi-record/multi-slot rejection, Pricing COW/rollback, forum ownership, all editable studio slot COW. |
| H7 Historical startup | Before any startup mutation, reject QL installations still requiring legacy Firing/Tile/Sales/Piece-Glaze rebuilds. Supported pre-QL Firing and Sales rebuilds preserve all existing columns, indices, triggers and child rows in transactions, verify FKs, restore enforcement, and retain recovery tables on refusal. | Original H7 Firing/Tile; I7 pre-QL Firing/Sales/Tile → QL → restart, unchanged post-QL rejection, failure after DROP rollback, stale migration table preservation. |

## Equivalent bypass review

Reviewed physical unlink/rename/write/copy sites, filename reference updates, legacy table
rebuilds, Sale readers/writers, Contact deletion and account preflight in runtime source
and migration entrypoints. Fixed genuine equivalents:

- Avatar/profile, Event image, forum single-photo and Project photo cleanup now run after
  metadata commit through the shared lifecycle. Sale photo replacement and Combo replacement
  use the same safe-path/serialized cleanup, replacing their separate reference checks.
- Forum image authorization no longer lets a post owner edit/delete another author's reply
  attachment when both IDs exist; normal reply-only photo rows remain editable by their owner.
- Pricing and all previously editable file slots are included in the filename editor. Per-row
  metadata edits (rotation/stage/reorder) do not overwrite shared physical bytes. Uploads to
  individual Piece/Firing/Clay/Glaze/Tile records already use fresh generated filenames.
- Old Sales CHECK migration was another lossy fixed-column rebuild; it now retains Contact
  links and future columns. Unsafe post-QL rebuild orders and legacy migration runners reject.
- Sale photo-copy and Photo Lookup/backfill reject unsafe stored paths/symlinks. Async hash
  writes require the original filename so a completed old hash cannot replace a new image's
  invalidated metadata after copy-on-write.
- Remaining direct unlinks in `server.js` dispose only of fresh request-owned Multer uploads,
  never stored old filenames. No runtime upload overwrite or unguarded stored-file unlink
  remains. Admin cleanup does not delete SQLite sidecars.

No new unresolved safety blocker was found. This is bounded source and synthetic regression
coverage, not a claim that every unrelated community workflow or every historical schema is
certified. Deliberate conservative retention is not complete physical account erasure.

## Compatibility details

The optional historical `hide_from_photo_search` column is not added by Phase 1I. Photo Lookup
works without it; when it exists its exclusion remains enforced. A visibility-toggle request
on a schema without that column returns 409 rather than SQL failure. Actual schema inventory
must establish this optional capability before future release.

Filename-only edits with multiple same-account references fail safely; resolving which record
the user intended needs a separately approved client/API change. Record-specific replacement
remains available where the existing product supports it. No UI was changed here.

`schema.json` changed only in the generated Sales CREATE SQL formatting from the corrected
rebuild; column/FK inventory is unchanged. No QL migration checksum or table contract changed.

## Verification and remaining gates

See `CHECKPOINT.md` for the exact count, commit and CI evidence. Required commands:

```sh
node ql/verify-phase1.cjs
QL_READINESS_STRICT=1 node --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

The full verifier runs readiness API checks in both legacy and QL modes. No TODO, skip or
known-failure waiver remains. Strict gate covers the original blockers and expanded tests.

Before production migration, still require separately authorized schema inventory and exact
historical-schema rehearsal; coordinated writer freeze and paired DB/uploads backup/restore;
image decoding/path/permission review beyond byte manifests; representative audit memory/time
measurements and maintenance budget; explicit release/migration approval. No production was
accessed or changed in Phase 1I.

Later-platform gates remain mobile cache/account isolation, live iOS source mapping, real-device
and store-purchase checks. Stale-client Firing writes are still last-write-wins; revision conflict
handling is deferred. Unrelated recipe editing/reorder/community workflow coverage and retained
unused non-studio assets remain deferred unless a concrete safety defect is discovered.

## Recommended next chunk — not started

**Phase 2A: read-only connected Piece-history contract and service/API, website only.**
Compose the authenticated owner's existing Piece, Clay, Glaze applications, legacy/QL Firing
union, explicit Test Tile/Pricing links, Sales and photos into one deterministic read model.
Keep source IDs/types and recorded dates, preserve unknown dates/manual labels, deduplicate
only identical associations, and filter inaccessible/stale references without repairs or
inferred links. Add one owner-scoped read endpoint and focused contract/isolation/legacy tests,
with no UI, new relationships, automatic backfill, AI/Esme, voice, ranking/search upgrade,
redesign, native changes, production access or deployment. This is a recommendation requiring
its own next instruction; no Phase 2 implementation is included here.
