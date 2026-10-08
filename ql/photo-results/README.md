# Photo Lookup Results-1

Base: exact Features-1 commit `9d2e619570dc85d194ca1e5aff65c5d5e98fd598`.
Branch: `ql/photo-lookup-results-1`. No deployment, production data, TestFlight, Wedgie or Studio Finds changes.

## Contract

`POST /api/pieces/photo-search` preserves `matches`, `total`, the Piece fields, `photos`, `glazes`, raw numeric `matchScore` and Piece-level deduplication. Each match adds:

- `matchedPhotoId`: the ID of the exact candidate photo retained by MAX-per-Piece, including deterministic tie behavior. Resolve it within that match's existing `photos` array. The current owner-scoped Piece and its safe photo membership are checked again after asynchronous extraction; a missing/reassigned winning photo is not returned as an identification.
- `confidence: {level: 'possible'|'low', label: 'Possible match'|'Low confidence'}`.

The response adds `confidence: {model: 'photo-results-1', calibrated: false, confidentMatch: false, status: 'no_confident_match'|'ambiguous'|'possible', label, ambiguous, message}`. Empty results use the same summary contract. No path or bearer token is added. Existing protected-media components resolve photo IDs with their existing owner/public/legacy policy. Older API consumers may ignore additions; updated clients use the first photo only when talking to an older API that omits `matchedPhotoId`. An invalid claimed ID shows a placeholder, not a substituted first photo.

## Evidence-based uncertainty, not probability

Frozen Features-1 no-match Top-1 scores range from 0.61646 to **1.0**. Median incorrect positive Top-1 was 0.87858 and correct Top-1 0.96688. High score alone cannot establish identity. Results-1 intentionally does **not** emit Strong match or claim calibrated probabilities.

- Raw score >= **0.97**: Possible match.
- Raw score < **0.97** or non-finite: Low confidence.
- Best score below 0.97, non-finite, or no candidates: No confident match summary.
- First/second Piece score gap <= **0.03**: ambiguity flag. Above the score threshold, summary says Several pieces look similar. Below it, the rejection summary explicitly describes closest suggestions.
- All candidates stay in the same order. No score, feature, hue gate, crop, weight, threshold for retrieval, candidate count or Top-3 cutoff is changed.

These are coarse presentation boundaries chosen using existing synthetic development evidence, then measured on the full frozen corpus; this is not an independent calibration study. Of 153 unambiguous positives above the 0.97 boundary, only 91 Top-1 results are correct. This is precisely why even high-scoring results remain **possible**, never confident identifications. A single best suggestion still requires visual confirmation. Real-world confidence calibration remains unmeasured.

## Retrieval and presentation are separate

Four modes (cold, warm, repeat, uninstrumented), each **516 queries**, have exact ranking and score equality with Features-1. Frozen manifests and image hashes are unchanged.

| Retrieval measure | Results-1 | Change from Features-1 |
|---|---:|---:|
| Unambiguous Top-1 | 190/384 = 49.48% | 0 |
| Unambiguous Top-3 | 301/384 = 78.39% | 0 |
| Light/plain Top-1 | 70/128 = 54.69% | 0; retains +15.625 points vs Eval-1 |
| Light/plain Top-3 | 90/128 = 70.31% | 0 |
| Cold unevaluated correct candidates | 0/384 | 0 |
| Protected blue baseline-correct Top-1/Top-3 losses | 0 / 0 | 0 |
| Ambiguous acceptable-set Top-1 | 26/32 = 81.25% | 0 |
| Ambiguous acceptable-set Top-3 | 32/32 = 100% | 0 |
| Both acceptable ambiguous IDs in Top-3 | 30/32 = 93.75% | 0 |

No-match: **82/100** receive the No confident match summary; **18/100** remain possible suggestions (16 explicitly close-score ambiguous, 2 with a separated leading candidate). **0/100** receive a confident identification. All 100 still have ranked suggestions; candidate-return false-positive rate therefore remains **100%**, and must not be misreported as a rejection accuracy improvement. There is no hard removal of candidates.

The conservative boundary also marks **231/384 positive queries** low confidence. Their suggestions and retrieval accuracy are retained. Development/holdout negative counts are separately 41/50 below threshold and 9/50 possible; positive counts above threshold are 74/192 and 79/192 respectively. Those are synthetic, correlated measurements, not population probability estimates.

Ambiguous labels: 28/32 trigger the close-score flag; 26 get the ambiguous summary, 4 get No confident match (2 of those also close-score), and 2 get Possible match. All retain multiple candidates and none is asserted definitive.

Winning-photo observation: **17,762/17,762** warm returned candidates agree exactly with the scoring observer, with zero errors. Cold and repeat response provenance is also checked against its observer. The full 448 expected-Piece rows include 179 cases where the winning photo differs from the first stored photo. Separate HTTP tests verify owned delivery, foreign/anonymous denial, wrong-Piece denial, and the non-first winning-photo case.

## Client state

Web previously had generation/token stale-response guards. It now additionally aborts the previous request on replacement or media/session reset and clears prior status. Matching-photo selection and uncertainty replace first-photo/percentage rendering.

Mobile uses query identity plus an AbortController, invalidates on selection, camera capture, editing, account change and unmount, clears old results/error/loading immediately, and ignores old success/error/finally. Picker identity rejects out-of-order selections; old edit callbacks cannot replace a newer image. The shared API helper now forwards caller cancellation into its timeout controller. Photo requests additionally validate session and cancellation before the shared 401 handler, protecting replacement credentials from late failures.

17 new mobile tests include real screen-function rendering with controlled async responses, older-API fallback, invalid winning references, cancellation reaching fetch, and late 401/account protections. 8 web DOM regressions exercise actual extracted application functions. 20 backend regressions cover API provenance, media authorization, compatibility, confidence boundaries and frozen-corpus gates.

## Reproduce

Node 22 and committed backend dependencies:

```
node ql/photo-results/run.cjs
node --test tests/ql-photo-results.cjs tests/ql-photo-results-dom.cjs
node --require ./ql/rehearsal/suite-isolate.cjs ql/verify-phase1.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

Results evidence is separate from frozen Eval-1, Safety-1 and Features-1 evidence. The original Features-1 source snapshot is byte-exact (including original whitespace); its existing source-hash test now checks that snapshot and byte-identical current ranking logic instead of incorrectly demanding an unchanged entire server after an additive API change. Older disposable test fixtures explicitly copy the new confidence module. No previous assertions were waived.

## Mobile checkpoint portability

Mobile base: `fffdf32b4d9085dd16782b4157bfc8cf2edcf6d8`, repository `christinaworkmanpottery-droid/potters-mudroom-app`.

`mobile-results-1.patch` contains the two changed source files, 17 new regressions and verification-workflow branch/test additions. Apply only on that base or after checking compatibility. `mobile-checkpoint.json` records original blob IDs. Every downloaded source blob was checked against Git's blob hash. Applying the patch to clean original files reproduced all tested changed bytes exactly. The patch is included in the backend Results-1 commit/bundle, not left as unpreserved workspace edits.

Local mobile suite: **882/882 PASS**; **161 JavaScript files parsed**. Native simulator/device/Expo build not run. Mobile remote commit was **not created**: automatic approval review rejected publication as not explicitly authorized for this isolated task. No remote writes or TestFlight changes occurred. Existing backend publication/exact-head CI/non-root recovery dependencies remain deferred; see CHECKPOINT.md for final local gate counts.
