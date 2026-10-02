# Photo Lookup Features-1

Parent: frozen Safety-1 `7686bb32fd6475a2f870ef789eaafde09ff46d23`.
Branch: `ql/photo-lookup-features-1`.
Frozen Eval-1: `4646f7b96454b2a1d1c4e641c58e6d2bae3b9d49`.

## Smallest measured change

1. Complete every eligible, same-owner photo's existing feature pair before ranking.
   The ten-photo cap is removed. Serial decoding, stored-image byte/pixel/dimension/frame
   bounds, abort checks, and a cooperative 25-second preparation/scoring budget bound work.
   A failed/unreadable/unsafe candidate produces an explicit 503, never a partial successful
   ranking. Budget expiry also returns 503; completed existing feature pairs survive so a
   retry can finish the remaining preparation. Decoding one image is bounded by 12 MiB,
   40 million pixels, 12,000 pixels per dimension, one frame. The time budget is cooperative,
   not a hard process termination deadline. Candidate metadata memory is linear in library
   size; scoring yields every 32 photos. Existing per-account/process request limits apply.
2. For queries whose selected color has saturation below the existing low-saturation boundary
   of 0.30, replace clipped `min(1, rawScore)` with `rawScore / 1.20`. The analytical maximum
   is 1.20 (weighted similarities total at most 1 plus the 0.20 duplicate bonus). Clipping
   had discarded useful structural distinctions between pale and dark similar-color Pieces.
   Saturated searches retain the original scoring path. The score is similarity, not probability.
3. Compute the DCT's fixed cosine constants once per process, preserving exact multiplication
   and addition order. Every one of the 660 frozen corpus images has identical old/new hash
   bytes. This is a constants table, not a user/image feature cache.

No new feature cache, feature format, persistent schema, index or migration is introduced.
Existing phash/avg_color values remain valid; color extraction, fixed crops, object-cluster
selection, hue gates and weights remain unchanged. Per-photo scores still collapse using MAX
per Piece, and internal winning photo IDs remain available for a later Results-1 slice.
The API response and user-visible percent presentation are unchanged.

## Evaluation discipline

`../photo-eval` corpus, manifests, labels, metrics, baseline evidence and tests remain frozen.
The candidate runner uses that harness logic and observer, writing only this directory.
`experiment.cjs` runs all 516 queries for each scoring experiment; release evidence runs all
four modes, including resetting all 144 A feature pairs before EVERY cold query. Account B
has 48 additional security-only Pieces and 144 mirrored images. Every serialized response,
owner, result ID and observed candidate is checked. This is synthetic procedural evidence,
not measured accuracy on real user photographs.

Experiments retained:
- `completeness-only`: zero warm ranking/score differences in all 516 queries.
- `unsaturated-score`: normalizing all queries improved aggregate retrieval but lost three
  protected blue Top-1 cases. Rejected; never shipped or used to relax the gate.
- `neutral-score`: restrict normalization to low-saturation queries; all accuracy gates pass.

Crop/orientation does not improve in this bounded slice. No-match false positives remain
100/100, so non-worsening is a weak guard and no calibration improvement is claimed.
No additional sampling, shadow selection or color extraction change was required to meet
this slice's stated accuracy gates. Those weaknesses remain visible in the measurements.

## Tests and reproduction

Use Node 22 and the committed lockfile. All servers/data are disposable and loopback-only.

```
node ql/photo-features/run.cjs
node ql/photo-features/compare-local.cjs /path/to/exact-eval-1-checkout
node --test tests/ql-photo-features.cjs
node --test tests/ql-photo-safety.cjs tests/ql-photo-eval.cjs
node --require ./ql/rehearsal/suite-isolate.cjs ql/verify-phase1.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

The paired timing runner warms both servers, alternates request order, and evaluates all
516 queries. Both p50 and p95 must be <=110% of the exact Eval-1 baseline on the same
hardware/runtime. Cold/instrumented timings are reported separately, not substituted.

Safety-1's 28 live safety tests remain unchanged. Its two historical source-hash tests now
read the exact preserved frozen algorithm fragment in `frozen-safety-algorithm.txt`, keeping
both original expected hashes. Features-1 is explicitly allowed to change scoring; current
behavior is covered by its new live/evaluation regressions and full-corpus feature-byte parity.
The fragment was extracted directly from the exact Safety-1 commit, without rewriting history.

## Verification dependency and scope

Publication, exact-head Actions and the non-root recovery permission check remain the one
known deferred environment dependency for these checkpoints. Development is not blocked by
it. Local recovery reports the non-root check as BLOCKED rather than passed. No new source
blocker is known. Production, Render, TestFlight 49, mobile, Results-1, Wedgie and Studio Finds
are untouched. Stop after this checkpoint.

## Latency correction and final cold execution

The first paired timing run missed p50 by 0.32 percentage points; two predetermined repeat
runs missed p95. All three failed measurements and their complete request rows are retained
under `paired-first`, `paired-repeat-1`, and `paired-repeat-2`. They were not treated as passing.
Removing per-candidate diagnostic formatting/serialization/logging resolved the regression
without changing the selector or ranking outputs. One thousand generated cluster signatures
compare the quiet selector with the frozen original; all 516 endpoint rankings/scores also
match the pre-logging-removal candidate exactly. The final paired run passes both unchanged
latency limits. No thresholds, labels or performance tolerances were relaxed.

The initial four-mode candidate evaluation ran cold requests sequentially. Its complete rows
and summary are preserved under `before-quiet-logging`. The final cold rerun uses four
independent disposable server/database shards; each query still clears all 144 A feature pairs
before its request. Every query is evaluated once, and results are reassembled by original
query index. This changes only cold test scheduling. Final cold timing includes parallel
instrumented workload and is not directly compared with the original sequential latency.
The release performance gate uses only the separate sequential alternating paired run.
