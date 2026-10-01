# QL testing policy — September 30, 2026 (Los Angeles)

Christina explicitly directed that she must not be the primary manual regression
layer for unfinished infrastructure. Broad physical-device validation is paused.
Automated tests, repository regressions and engineering smoke checks cover
foundation work as development continues. Changes to backend relationships alone
do not justify asking her to retest unchanged legacy screens.

## Preserved technical checkpoint

- TestFlight: **1.0.6 (49)**, existing `com.pottersmudroom.app` identity.
- Mobile base: `7ab57c662daa2c8d97cfbd9a3cc454bbe2cd1a8e`.
- Test configuration: `ql/testflight-isolated-validation`, canonical mobile commit
  `189b026d08290851a572850c88d7164d3521fef7`.
- Approved isolated backend checkpoint: `ffda5e75bbe2849b4840150e5dc6e86f13075b99`.
- Test backend: `https://potters-mud-room-testing.onrender.com`.
- User reports this proves isolated backend/build-pipeline operation. This is
  a technical checkpoint, not acceptance of all device workflows or final QL.
- Leave this build/configuration and test deployment intact for reference.

No production service, database, uploads, store release, OTA channel or app
identity changes are authorized by this development continuation. Test accounts
remain synthetic; do not copy production data or credentials.

## When to invite Christina

Invite product evaluation only when a meaningful user-facing milestone is
implemented and engineering-verified: new Search and result navigation, measured
Photo Lookup improvements, grounded assistant/voice workflows, Porcelain navigation
and design, or required community sharing. Explain what changed and give a short
set of product tasks focused on that change. Do not make her repeat a broad
legacy checklist to unblock another backend slice.

The first intended milestone is a usable cross-record Search workflow with
record navigation and loading/empty/error behavior on the isolated build. Search-1
is API-only and does not yet trigger a TestFlight invitation or another build.

Platform-specific engineering validation and final release acceptance remain
necessary at their appropriate gates. Unperformed physical tests stay unperformed;
automated results must never be relabeled device PASS. Phase 3A–3H engineering
contracts remain closed unless a demonstrated regression requires reopening.
