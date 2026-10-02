# Photo Lookup Safety-1

Branch: `ql/photo-lookup-safety-1`. Direct parent: frozen Eval-1
`4646f7b96454b2a1d1c4e641c58e6d2bae3b9d49` (`ql/photo-lookup-eval-1`).
Eval-1 publication, exact-head Actions, and the non-root recovery permission check remain
open verification dependencies. They do not block development. No Eval-1 commit, corpus,
source, baseline evidence, or gates were rewritten. Safety-1 publication/Actions are deferred
under the same known environment limitation; `safety-1.bundle` is the portable checkpoint.

## Shipping changes

- Photo Lookup has a dedicated request-local memory uploader. It never creates a query
  filename, filesystem object, public URL, or persistent record. Partial chunks are wiped
  on failure/abort; complete buffers are wiped and detached after success, error or abort.
  Cleanup is idempotent, including a parser callback arriving after socket closure.
- Authentication and a current database account are required before parsing. Account
  existence is rechecked after image validation and before result delivery. Feature-cache
  writes now explicitly constrain the current Piece owner, as do candidate/result reads.
- Encoded image limit: 12 MiB. Decoded image limit: 40 million pixels and 12,000 pixels
  per side; single-frame only. Allowed MIME/decoded formats: JPEG, PNG, WebP, GIF,
  AVIF, HEIC/HEIF (subject to installed decoder support). SVG, TIFF, non-images,
  truncated/corrupt images, excess fields/files and malformed multipart fail safely.
  Sharp validates and decodes before the unchanged legacy feature extractors; validated
  original bytes, not transformed/re-encoded pixels, enter the original algorithm.
- At most one active request per account and four per process. Upload parsing has a
  30-second deadline; an expired/interrupted upload closes the connection and releases
  its memory and slot. Limits are per process, not a distributed rate limiter.
- The unauthenticated `/api/debug/extract-color` uploader is retired (404 before parsing).
  `/api/debug/photo-colors` additionally requires a current account and remains owner-scoped.
- Successful Photo Lookup retains multipart field `photo` and `{matches,total}` with
  existing candidate metadata/media contracts. Responses are private/no-store. Safety
  rejection uses 400 (malformed), 401 (missing account), 413 (size/dimensions), 415
  (unsupported image type), or 429 (capacity). Animated/multipage images are deliberately
  rejected. These are the narrowly scoped API changes; shipping clients need no change
  for supported normal photo uploads.
- Global legacy `/uploads`, existing candidate-media delivery, schema, ranking, crops,
  color weights, perceptual hashes, thresholds and ten-photo backfill cap are unchanged.
  Historical query files already left in legacy uploads are not swept by this slice.

## Verification

30 new focused regressions pass, including two exact source hash checks against Eval-1's
feature extraction and scoring/selection. Focused tests cover success/error/abort cleanup,
malformed/type/byte/pixel/dimension rejection, authorization, missing/deleted accounts,
cross-account isolation, debug retirement, query URL absence, protected candidate media,
capacity release and explicit zeroing of retained buffer references.

Full local runner: PASS, 1,396 TAP tests, zero failures/skips/cancellations; all standalone
checks also pass (250 PASS log lines include summary lines, not an additional test count).
Strict gate: 37/37. Disposable recovery: 114 passed, zero failed, one known BLOCKED
non-root permission check (runtime EINVAL). No new source blocker.

The unchanged Eval-1 harness ran with `--verify-frozen`. Every ranking and score matches
in all four modes: cold, warm, repeated, and uninstrumented (516 queries each; 2,064
comparisons, zero differences). Warm Top-1 is 155/384 = 40.364583%; Top-3 is 296/384 =
77.083333%; no-match false positives remain 100/100. No accuracy improvement is claimed.
Frozen Eval-1 files remain byte-for-byte identical; candidate evidence is stored here.

`evidence/comparison.json` includes identical baseline/candidate ranking digests by mode;
`*-results.json` retains complete per-query ranking/score evidence; `summary.json` is raw
harness output (its sourceCheckpoint is the harness's historical algorithm checkpoint,
while serverSha256 identifies the tested server bytes). Its timing differs from the
original CPU/runtime and ran alongside the full suite, so it is not a fair latency gate.
`evidence/same-machine.json` is a separate sequential comparison of exact Eval-1 and
Safety-1 on this machine. Reproduce using a disposable exact Eval-1 checkout:

```
node --test tests/ql-photo-safety.cjs
node ql/photo-safety/compare-local.cjs /path/to/exact-eval-1-checkout
node --require ./ql/rehearsal/suite-isolate.cjs ql/verify-phase1.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

The new module is included in older disposable fixture copy lists; existing assertions
are not weakened. The full runner includes Safety-1 and Actions recognizes its branch.
Node 22.16.0 and existing installed dependencies matching the committed package-lock
were used. Production, Render deployments, TestFlight 49, mobile and subsequent QL
feature slices remain untouched.

Final paired timing (516 requests per version, alternating order): baseline p50 35.582 ms / p95 84.285 ms; Safety-1 p50 36.342 ms / p95 75.732 ms. Existing gate PASS, zero ranking differences. The first unpaired measurement failed p50; both subsequent paired measurements pass. All measurements are retained; the gate was not relaxed. The final validation-only decoder optimization was checked with the focused suite and final paired run after the broader suite/recovery.

## Changed files

- `.github/workflows/ql-phase1-verify.yml`
- `ql/photo-query-safety.cjs`
- `ql/photo-safety/README.md`
- `ql/photo-safety/compare-local.cjs`
- `ql/photo-safety/evidence/cold-results.json`
- `ql/photo-safety/evidence/comparison.json`
- `ql/photo-safety/evidence/focused.log`
- `ql/photo-safety/evidence/full-suite.log`
- `ql/photo-safety/evidence/plain-results.json`
- `ql/photo-safety/evidence/recovery.json`
- `ql/photo-safety/evidence/recovery.log`
- `ql/photo-safety/evidence/repeat-results.json`
- `ql/photo-safety/evidence/same-machine-first.json`
- `ql/photo-safety/evidence/same-machine-paired-before.json`
- `ql/photo-safety/evidence/same-machine.json`
- `ql/photo-safety/evidence/strict.log`
- `ql/photo-safety/evidence/summary.json`
- `ql/photo-safety/evidence/verification.json`
- `ql/photo-safety/evidence/warm-results.json`
- `ql/verify-phase1.cjs`
- `ql/verify.cjs`
- `server.js`
- `tests/ql-clay-media.cjs`
- `tests/ql-deletion-api.cjs`
- `tests/ql-editor-preservation-api.cjs`
- `tests/ql-event-media-api.cjs`
- `tests/ql-events-contact-initialization.cjs`
- `tests/ql-firing-compatibility-api.cjs`
- `tests/ql-firing-media.cjs`
- `tests/ql-forum-media-api.cjs`
- `tests/ql-glaze-media.cjs`
- `tests/ql-photo-safety.cjs`
- `tests/ql-piece-clay-api.cjs`
- `tests/ql-piece-firings-api.cjs`
- `tests/ql-piece-glaze-api.cjs`
- `tests/ql-piece-history-api.cjs`
- `tests/ql-piece-history-web-api.cjs`
- `tests/ql-piece-media.cjs`
- `tests/ql-piece-pricing-api.cjs`
- `tests/ql-piece-public-edges-api.cjs`
- `tests/ql-piece-sales-api.cjs`
- `tests/ql-piece-test-tiles-api.cjs`
- `tests/ql-pricing-media.cjs`
- `tests/ql-profile-media-api.cjs`
- `tests/ql-project-media.cjs`
- `tests/ql-readiness-blockers.cjs`
- `tests/ql-relationship-safety-api.cjs`
- `tests/ql-relationship-service-api.cjs`
- `tests/ql-sales-media.cjs`
- `tests/ql-shop-media-api.cjs`
- `tests/ql-studio-deletion-api.cjs`
- `tests/website-api.cjs`
