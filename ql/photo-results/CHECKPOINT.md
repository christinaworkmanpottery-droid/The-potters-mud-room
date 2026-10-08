# Results-1 local verification

Parent: 9d2e619570dc85d194ca1e5aff65c5d5e98fd598. Branch: ql/photo-lookup-results-1.

- Results-1: 20 backend + 8 web + 17 mobile new regressions, all PASS.
- Backend/QL: 1449/1449 TAP tests PASS, all standalone integrated checks PASS.
- Mobile: 882/882 PASS, 161 JavaScript files parsed.
- Frozen evaluation: 516 queries × four modes; exact Features-1 ranking/score parity.
- Strict foundation: 37/37 PASS.
- Recovery: 114 PASS, 0 FAIL, 1 BLOCKED: existing non-root EINVAL limitation.
- Server SHA-256: 4513db2cf86ce7336d0e86938b9f233286e881f7d4e4c31225d7f77d3e432369.
- Frozen corpus and Eval-1/Safety-1/Features-1 commit objects unchanged.
- Mobile patch application independently verified against exact Search-3 source blobs.
- Local first-photo/winning-photo, protected media, stale result and backward compatibility gates PASS.

Publication/exact-head CI/non-root verification remain deferred. Automatic approval review rejected the mobile GitHub tree creation because it considered remote publication outside the authorized isolated scope. No mobile remote commit or branch was created. The tested patch is preserved in this checkpoint. This is not a mobile native/device build or production release.

No new implementation blocker remains. Production, TestFlight, Wedgie and Studio Finds are untouched. Stop here; do not automatically start another slice.

See README.md for API contract, confidence policy, false-positive accounting and limitations. See evidence/validation for executed logs. The recovery report's historical sourceCheckpoint/parent HEAD fields are inherited labels; this checkpoint records the exact tested server hash above. Frozen snapshot and patch context whitespace intentionally remains byte-exact.
