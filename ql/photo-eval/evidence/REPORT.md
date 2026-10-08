# Photo Lookup Eval-1 baseline

Unchanged backend 5fff6c4daf0b16de7f744fa541d8a94034b83f88; server SHA-256 5a46db2025758bb37a760c1c60c13e5c3f16b411f307f018669108d992e85b28. Synthetic procedural pottery only. 48 retrieval Pieces / 144 enrolled photos / 516 labeled queries (384 positives, 32 ambiguous, 100 no-match). 48 additional Account B security Pieces mirror 144 images. Labels are authored independently of output.

## Measured results

Warm Top-1 40.36%; Top-3 77.08%. Piece-macro Top-1 40.36%. Correct rank among returned: mean 3.2923497267759565, median 2; 18 correct Pieces absent (not omitted from accuracy denominator).

| Subset | Positive queries | Top-1 | Top-3 |
|---|---:|---:|---:|
| B | 128 | 32.81% | 78.91% |
| L | 128 | 39.06% | 67.97% |
| D | 64 | 40.63% | 76.56% |
| M | 64 | 57.81% | 92.19% |
| nearDuplicate | 384 | 40.36% | 77.08% |
| lightingBackground | 144 | 50.69% | 80.56% |
| cropOrientation | 96 | 20.83% | 45.83% |
| duplicate | 48 | 35.42% | 91.67% |
| independentViews | 336 | 41.07% | 75.00% |
| development | 192 | 38.02% | 75.52% |
| holdout | 192 | 42.71% | 78.65% |

No-match false positives 100/100 (100.00%), defining positive as any API-returned result. Ambiguous acceptable Top-1 68.75%, Top-3 100.00%; both acceptable IDs in Top-3 93.75%. API has no explicit uncertainty state.

## Cold cache

Each cold request resets all A features after empty startup has settled: Top-1 3.65%, Top-3 7.29%. 352/384 positives have no expected Piece evaluated. Only ten photo feature sets are generated inline. See cold-progression.json for 15 consecutive requests without reset and exact candidate counts. This isolates inline behavior after newly added uncached photos; startup-backfill scheduling is deliberately not benchmarked. Warm cache has all 144 A photos ready.

## Latency and scores

Uninstrumented endpoint, sequential 516 queries, p50 19.93 ms / p95 27.27 ms. Cold observer run p50 84.76 / p95 100.35 ms includes trace I/O and inline feature work. Warm observer timing is retained separately, not used as performance gate baseline.

Score distributions and decile bins are in summary.json; these are similarities, not calibrated probabilities. Correct Top-1 median 1, incorrect Top-1 median 1, no-match median 0.9028579136025369. Do not interpret a displayed 100% as certainty.

## Multi-photo, privacy and determinism

Every result collapses to one Piece. Internal per-photo scores and winning photo IDs are in warm-traces.json and multi-photo.json. Winning photo differs from first displayed photo in 177 labeled acceptable-Piece rows. API exposes no winning-photo ID. All A candidate traces and complete API responses checked for B IDs, titles, owners and filenames: zero leaks; B positive control succeeded. Protected cross-owner media returned 404. Legacy /uploads is unchanged and remains Safety-1. Warm repeated and uninstrumented runs: 1032 query comparisons, zero ranking/score differences.

## Frozen gates

Zero losses for EVERY baseline-correct blue Top-1 and Top-3 case (stronger than confidence-only). Future light/plain Top-1 must improve >=10 percentage points. No overall Top-3 loss, no increase in no-match false-positive rate, zero account leakage. Same hardware/runtime sequential warm p50 and p95 <=110% baseline. Baseline self-check passes; future-release gate intentionally fails the unchanged baseline's improvement requirement. Eval-1 claims no improvement.

## Scope and reproduction

Run Node 22: node ql/photo-eval/run.cjs, then node --test tests/ql-photo-eval.cjs. Fixtures are deterministic generated SVG/PNG, not camera photographs or proof of real-world retrieval quality. All Pieces have same-color/same-shape partner distractors, differentiated by incised marks. Derivative queries are correlated; object-family development/holdout splits are fixed (24 Pieces, 192 positives, 16 ambiguous, 50 negatives each). Independent and angle images are separate procedural renders, not independent physical captures. Crop moves/scales the object; ambiguous views intentionally remove identity marks. Actual EXIF-tagged camera files, very large libraries, concurrency stress and production-hardware latency remain future evaluation extensions. No tuning occurred on either split.

Original server is untouched. Observer adds only a local trace write to a disposable copy after ranking; complete warm ranking/score parity verified against unmodified source. Fixtures seeded after startup settles; temp data and query uploads remain disposable and loopback-only. Safety-1, Features-1 and Results-1 are not implemented. Production untouched; TestFlight 49 unchanged.
