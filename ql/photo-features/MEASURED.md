# Photo Lookup Features-1 measured checkpoint

Branch: `ql/photo-lookup-features-1`. Parent: `7686bb32fd6475a2f870ef789eaafde09ff46d23`.

Tested server SHA-256: `9ee1c2f61b70e7faa3cb3cc03b91da3dd9d3c054cbafe7ede06bd71947926d22`. Eval-1 and Safety-1 branches, commits, corpus and original evidence remain frozen.

## Changes

Removed the ten-photo inline cap: all eligible same-account candidate photos must have complete features before a successful ranking. Failed, unsafe, corrupt or oversized media returns an explicit 503 rather than a partial result. Serial decoding, candidate size/dimension limits, abort checks and a cooperative 25-second preparation/scoring budget bound work; completed existing feature pairs permit progress on retry.

Low-saturation query scores (selected-cluster saturation below 0.30) now retain structural distinctions using raw weighted similarity divided by its analytical maximum, 1.20, rather than clipping at 1. Saturated queries retain the legacy path. Piece-level MAX aggregation and internal winning-photo IDs remain intact. UI and percent labels are unchanged; scores are not probabilities.

Precomputed DCT cosine constants preserve exact legacy hash bytes for all 660 corpus images. Removed per-candidate diagnostic formatting/logging to meet the latency gate; selected clusters, scores and rankings are unchanged by that optimization. No new feature cache, feature format, schema, index, migration or paid AI/model call.

## Complete frozen-corpus comparison

48 retrieval Pieces, 144 photos, 516 labeled queries; 48 additional mirrored account-B Pieces are security controls. Accuracy uses 384 unambiguous positives; ambiguity and negatives are separate.

| Category | n | Before Top-1 | After Top-1 | Before Top-3 | After Top-3 |
|---|---:|---:|---:|---:|---:|
| Overall | 384 | 40.36% | 49.48% | 77.08% | 78.39% |
| Blue / high contrast | 128 | 32.81% | 36.72% | 78.91% | 79.69% |
| Light / plain | 128 | 39.06% | 54.69% | 67.97% | 70.31% |
| Dark | 64 | 40.63% | 56.25% | 76.56% | 78.13% |
| Multicolor | 64 | 57.81% | 57.81% | 92.19% | 92.19% |
| Lighting / background | 144 | 50.69% | 58.33% | 80.56% | 82.64% |
| Crop / orientation | 96 | 20.83% | 20.83% | 45.83% | 45.83% |
| Near-duplicate set | 384 | 40.36% | 49.48% | 77.08% | 78.39% |
| Exact-photo controls | 48 | 35.42% | 68.75% | 91.67% | 93.75% |
| Independent views | 336 | 41.07% | 46.73% | 75.00% | 76.19% |
| Development split | 192 | 38.02% | 47.40% | 75.52% | 76.56% |
| Holdout split | 192 | 42.71% | 51.56% | 78.65% | 80.21% |
| Ambiguous acceptable set | 32 | 68.75% | 81.25% | 100.00% | 100.00% |

Both acceptable ambiguous IDs in Top-3: 93.75% → 93.75%.

Protected blue: zero losses across all 42 baseline-correct Top-1 cases and all 101 baseline-correct Top-3 cases. Light/plain improves 50/128 → 70/128, **+15.625 percentage points**. Overall improves 155/384 → 190/384 Top-1 and 296/384 → 301/384 Top-3. Crop/orientation remains 20/96 Top-1 and 44/96 Top-3; no gain is claimed.

## Cold completeness

Cold Top-1: 3.65% → 49.48% (14/384 → 190/384). Cold Top-3: 7.29% → 78.39% (28/384 → 301/384).

Correct Piece unevaluated: **352/384 → 0/384**. All 516 final cold requests evaluate 144 eligible photos and 48 same-account Pieces before the hue gate. Cold, warm, repeat and uninstrumented rankings/scores agree exactly. Each cold request clears all existing A feature pairs; the final run uses four independent disposable server/database shards with unchanged inputs, labels and observer.

Correct Piece absent from returned results: cold 354 → 18; warm 18 → 18. The remaining 18 are evaluated but excluded by existing scoring/hue eligibility, not missing candidate features. Conditional mean correct rank among returned: 3.29235 → 3.14481; median 2 → 1. Missing Pieces remain accuracy failures.

## No-match and score behavior

No-match queries returning candidates: 100/100 → 100/100. Mean candidate count 28.60 → 27.94; median 26 → 26; range 17–48 → 17–45. The non-worsening gate passes, but false-positive behavior remains poor and is not calibrated.

Correct Top-1 score median: 1.00000 → 0.96688; incorrect Top-1 median: 1.00000 → 0.87858. These describe changed score populations, not probabilities.

## Latency

| Sequential paired measure | Exact Eval-1 | Features-1 | Ratio |
|---|---:|---:|---:|
| Warm p50 | 34.548 ms | 30.202 ms | 0.874× |
| Warm p95 | 73.929 ms | 63.640 ms | 0.861× |

Both unchanged <=1.10× gates PASS. Each version received 516 warmed HTTP requests in alternating order on the same Node 22 runtime/machine, with no concurrent cold evaluator or full suite. Three failed pre-logging-optimization timing runs are retained; no gate was relaxed and failed runs were not discarded.

Final cold instrumented, four-shard workload: p50 2620.95 ms; p95 3560.49 ms. This includes concurrent test load and is not compared to sequential baseline latency. The earlier sequential cold run of identical retrieval math before logging removal measured p50 2037.03 ms / p95 2850.34 ms; its full evidence is retained.

## Verification

- Complete integrated backend/QL runner: **1421/1421 TAP tests PASS**, zero failures, skips or cancellations; all standalone checks PASS. Features-1 adds 25 focused regressions.
- Safety-1: 30/30, including 28 unchanged live safety checks and two original source hashes against the preserved frozen algorithm fragment. Eval-1 tests and evidence retained.
- Four modes × 516 queries; cold/warm/repeat/plain exact ranking parity. Zero foreign-account candidates or response leaks; one result per Piece; winning photos remain maximum-scoring evidence.
- Strict foundation gate: 37/37 PASS.
- Recovery: 114 PASS, 0 failed, one known non-root permission check BLOCKED by EINVAL. This is deferred, not passed.
- Exact-head GitHub publication/Actions and non-root verification remain the existing deferred dependency. No new blocker remains.

The candidate source is verified by SHA-256 above. The recovery checkout used these same server bytes before final commit. Production, Render, mobile, TestFlight 49, Results-1, Wedgie and Studio Finds were not changed.

## Limits

This is an improvement on the fixed synthetic Eval-1 corpus, not a claim of measured real-photo accuracy. Crop/orientation and no-match rejection remain weaknesses. Large libraries may require retries while existing feature pairs are prepared; invalid stored photos fail explicitly. Metadata/result memory remains linear in the eligible library, with bounded per-image work and request admission. No production deployment or user-device test was performed.
