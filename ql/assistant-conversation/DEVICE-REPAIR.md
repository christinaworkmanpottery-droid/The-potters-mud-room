# Phase 4I device acceptance repair — 4I.1

Base: e0b94274f81602d2e62940fbbb6e524945df90e4.
Branch: ql/phase-4i-device-repair. Phase 4I is NOT accepted/closed.
Christina reported inability to open Pieces or obtain their glaze information.
Her October 2 screenshot shows My Pieces and the interim words “Open blue vase”.
That exact phrase fails the original 4I parser (UNSUPPORTED_INTENT). The screenshot
alone does not prove whether Safari finalized the utterance.

Reproduced defects and repair:

- Named Piece commands such as “Open blue vase” and “Open the blue bowl” were
  unsupported. Recognize bounded named pottery-form requests as the existing
  owner-scoped Piece text search; no arbitrary routes, writes or guessed records.
- Ordinal transcriptions “the 1st one”, “the first 1”, “number one” and equivalents
  through five now select only an already-announced candidate. No list means
  clarification. Add glaze/firing references ending in “that one” and common
  “what glaze is on it?” wording without broadening access.
- The only visible response on destination pages was in the microphone-status
  line. Automatic restart overwrote choices/facts after 650ms, while the regular
  response paragraph was on the hidden assistant page. Keep the last finalized
  command and answer in separate text-only paragraphs in the existing dock.
  Microphone status changes no longer erase the answer. A new submitted command
  clears the prior answer; invalidation/logout/hide/stop clears both paragraphs.
  No transcript history, storage or new telemetry is introduced.
- Visible build marker “Conversation test 4I.1” and a revised script URL make the
  loaded repair identifiable. This is functional acceptance feedback, not a
  visual redesign. The successful 4H recognition lifecycle remains intact.

Verification: 495 assistant/search tests passed on Node 22 with isolated local
HTTP/SQLite. Includes full actual website/backend flow, maintained answers after
recognition restarts, safe text rendering, logout clearing and the wording
variants. Branch CI also runs the strict foundation gate. The operator-only
staging smoke script adds exact “Open blue vase” and follow-up checks to its
existing synthetic-fixture sequence (17 turns).

Staging remains the existing isolated Safari service and account. No production,
TestFlight, billing, schema or write-agent changes. Redeploy/verify the exact
repair commit and rerun the operator smoke before handing off.

Christina: open the refreshed link and verify “Conversation test 4I.1”. Start once,
then “Open the blue bowl”, “What glaze is on it?”, “When did I fire that one?”,
“Open blue vase”. Bowl has the synthetic Ocean glaze and saved 2026-10-01 firing;
Vase has no saved glaze/firing. Answers must remain visible as listening resumes.
If failure remains, capture the new Heard/answer lines so the next repair can
identify recognition vs interpretation vs navigation rather than guessing.
