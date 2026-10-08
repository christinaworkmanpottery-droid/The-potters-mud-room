# Photo Lookup Eval-1

This is a regression benchmark of the existing POST /api/pieces/photo-search endpoint, not a ranking implementation. No shipping server, mobile, schema, index, crops, weights, hashes, color extraction or thresholds are changed.

## Reproduce

Use Node 22 and the repository lockfile (`npm ci`). From repository root:

```
node ql/photo-eval/run.cjs --verify-frozen
node --test tests/ql-photo-eval.cjs
node --require ./ql/rehearsal/suite-isolate.cjs ql/verify-phase1.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

For full recovery in a disposable checkout, follow `ql/rehearsal/README.md`. The rehearsal's non-root permission check must pass; a local BLOCKED result does not close verification.

The corpus is committed and hashed. `node ql/photo-eval/fixtures.cjs` regenerates it without external assets. Do not regenerate/relabel to help a candidate algorithm pass. The evaluator validates file hashes against the manifests before sending any queries. Query IDs link JSON/CSV failures to `corpus/images/`. Every image is original procedural SVG rasterized by the pinned Sharp version; no paid calls, cameras, production images or personal records are involved.

The 48 retrieval Pieces are owned by A (16 blue, 16 pale, 8 dark, 8 multicolor), with three photos each. B holds 48 **additional security-only** mirror Pieces with 144 separate files containing identical bytes. Total seeded DB: 96 Pieces and 288 photos. Query labels: 336 EXACT, 48 EQUIVALENT duplicate-photo controls, 32 AMBIGUOUS and 100 NO_MATCH. Decodable background-only images are NO_MATCH; invalid decoders are not counted as successful rejection. Baseline retrieval accuracy uses all 384 unambiguous positives; ambiguous acceptable-set retrieval is separate. Missing correct Pieces remain accuracy failures; rank mean/median are explicitly conditional on being returned. No-match FPR uses any returned match, because V1 has no other acceptance policy.

All Piece families have paired near-duplicates: same geometry/color with different visible central incisions. Consequently the near-duplicate subset equals all positives, and this adversarial corpus is not representative of a typical studio. Family split is fixed: 24 Pieces, 192 positives, 16 ambiguous, 50 negatives per split. Neither split was used to tune scoring. Correlated derivatives are not independent observations. This establishes procedural regression evidence, not real-photo performance or population accuracy.

## Isolation and observation

The runner starts copied application files in a newly created OS temp directory. It reuses the repository's disposable-server isolation preload: binds only 127.0.0.1, denies all server outbound network/subprocess calls, and fails if an outbound attempt occurs. It passes an explicit minimal environment, no production credentials. A/B records are seeded only after empty startup and background backfill have settled. No live service is contacted. The test runtime's public uploads directory contains only disposable generated fixtures and transient synthetic queries. Raw /uploads compatibility is intentionally unchanged (Safety-1).

The observer inserts one trace write **after** candidate scoring/sorting and per-Piece MAX selection, without replacing any algorithm statement. Removing that insertion must recover the original server byte-for-byte. It records the pre-hue-gate candidate set, photo scores and winners. Full ranking/score equality is checked on 516 warm repeat queries and another 516 queries sent to an entirely unmodified server copy. Latency used for gates comes from the unmodified server; observer timings are separately marked. Trace writes contain only synthetic A data. Complete API responses are checked in memory for B owner/ID/title/media sentinels before compact results are saved. B's identical-image positive control and protected-media owner/foreign/anonymous controls establish that the data/routes actually exist.

Cold protocol resets A's 144 feature pairs before **every** query, measuring a fresh uncached library, not startup scheduler races. A separate M08 sequence keeps state over 15 requests and records progressive coverage. Warm protocol uses all 144 completed pairs. Nothing fixes the ten-photo inline cap.

## Future gates

Preserve this committed baseline and manifests. Run candidate evidence on the same corpus and comparable hardware, then:

```
node ql/photo-eval/compare.cjs FROZEN-plain-results.json CANDIDATE-plain-results.json
```

Future-release mode requires light/plain Top-1 >= baseline + 0.10. It deliberately fails when run against unchanged baseline. Blue protection covers **all** baseline-correct blue Top-1 and Top-3 cases, stronger than a confidence subset. Overall Top-3 cannot fall; no-match FPR cannot rise; no foreign IDs, leakage flags or duplicate Piece cards; p50 and p95 warmed sequential HTTP latency <= 110% baseline. Changed labels or missing/duplicate query IDs fail. Run privacy integration checks as well; arbitrary external JSON is not proof of owner isolation. A 100% baseline no-match FPR makes the non-worsening gate weak: later confidence work needs an explicit stronger acceptance target rather than claiming calibration from that gate.

Use `--verify-frozen` when reproducing Eval-1: it also compares all 516 rankings/scores with the committed baseline before replacing evidence. Omit that flag only for a deliberate future algorithm comparison, using the separate release-gate command.

The runner writes evidence into `evidence/`; preserve/copy the frozen baseline before a future run. Do not commit a changed baseline as if it were a successful improvement. Failures are reproducible by query ID and image hash. Future changes to corpus or workload require a separately versioned benchmark.

Safety-1, Features-1, Results-1, EXIF-camera files, real test-owned captures, 100/1000/10000-photo scaling and concurrency stress remain separate work. No production/TestFlight changes are part of Eval-1.
