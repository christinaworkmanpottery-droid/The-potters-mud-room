# Photo Lookup Client-Integration-1

Branch: ql/photo-lookup-client-integration-1
Exact parent: d7a1bc896fd8ebef1fac4c01d275b23b5e0ea6e1 (Results-1).
Closure-1 compatible; frozen ancestors are untouched.

## Bounded changes

- Native Photo Lookup maps image/jpg and case-insensitive JPEG suffixes to image/jpeg. Valid JPEG and PNG metadata stays valid. Picker/camera/editor MIME metadata is retained. Filename suffixes are preserved; URI query fragments are excluded from multipart filenames. Server validation remains byte-identical.
- Web result cards use native buttons with safe bound handlers that call the existing viewPiece. No duplicate viewer. Actual canonical-viewer DOM tests cover fresh Piece ID/owner checking, denied/deleted records, query/session replacement and existing Back to Pieces behavior. Detail fetches use a query serial distinct from the media cleanup that viewPiece intentionally performs on entry.
- Picker/results/retry are native keyboard controls. Status is announced. Same-file reselection is enabled by resetting the file input. Retry keeps the current failed File, is cleared on replacement/session reset, and cannot submit twice. Mobile blocks duplicate in-flight requests and retries the current selection.
- Ranking, feature extraction, score, thresholds, candidates, confidence/no-match policy and winning-photo selection are unchanged.

## Verification

43 new Node regression cases: 28 backend/web (including 12 native-to-HTTP cases and their parent test), 15 mobile. New cases all pass. Both camera and gallery paths preserve metadata. Real Safety-1 HTTP returns 200 for native .jpg/.JPG/.jpeg and PNG, 415 for unsupported SVG MIME, 400 for invalid bytes; no Safety-1 weakening.

Full backend/QL runner: 1,472 TAP cases pass, plus all standalone integrated checks. The five added canonical-viewer cases were executed separately on final source (1,477 passing TAP cases across these runs). Final affected Photo Lookup/Safety/Results/Search tests are rerun after the viewer handoff correction; 261/261 pass; see targeted-final.tap. Full mobile suite: 897/897 pass. Strict foundation: 37/37 pass. Recovery: 114 pass, 0 fail, known non-root EINVAL check deferred. Recovery lifecycle/database/server source is unchanged by this client slice; the recovery run preceded the final Photo Lookup-only handoff adjustment.

Fresh evaluation: 516 queries × four modes = 2,064 evaluations. Ranking/score, confidence, winning-photo provenance and account isolation exactly equal the preserved Results-1 rows, with deterministic projection hashes in evidence/frozen-parity.json. Top-1 49.48%; Top-3 78.39%; light/plain Top-1 54.69%; protected-blue losses 0; cold omissions 0. Winning photos 17,762/17,762. No-match: 82/100 No confident match, 18 uncertain suggestions, 0 confident identifications. Ambiguous Top-3 32/32. Server SHA-256 remains 4513db2cf86ce7336d0e86938b9f233286e881f7d4e4c31225d7f77d3e432369.

## Preservation and limits

Mobile remains an exact, reproducible combined patch against Search-3 fffdf32b4d9085dd16782b4157bfc8cf2edcf6d8. The Results-1 patch is unchanged. mobile-client-integration-1.patch includes Results-1 plus these fixes and applies independently to verified original blobs; all five postimages match tested files. mobile-checkpoint.json records hashes. No separate mobile commit is claimed. The upload-contract test uses the exact tested API postimage saved here; it is not imported by production runtime.

Publication, exact-head CI and non-root verification remain deferred, not development blockers. No publication retries were made. Native build/device testing was not run. This runtime also lacks Chromium; installation failed with a truncated archive. Actual browser keyboard smoke (browser.cjs) and the inherited Search browser smoke could not launch. DOM activation/canonical navigation and native button semantics passed; do not claim physical Enter/Space browser certification. No new source-level integration blocker was found.

## Short closure check

1. Native JPEG defect: resolved at the real Safety-1 HTTP boundary on both iOS/Android multipart branches.
2. Undefined web handler: removed; real canonical Piece viewer opens the correct authorized record in DOM integration tests.

PHASE 3 READY TO CLOSE

Stop here. No Phase 4, Wedgie, Studio Finds, deployment, production change or TestFlight change.
