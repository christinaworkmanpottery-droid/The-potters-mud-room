# Phase 4I.2 — observed speech mishearing recovery

Base: 1d7209c24220af8b69e224baf4bfb711f601fcc8.
Branch: ql/phase-4i-speech-clarification.
Christina reported 4I.1 works but “vase” needed three attempts. Her screenshot
shows the actual Blue Vase viewer and finalized “What way is on blue phase”,
plus interim “What ways is on blue phase”, followed by unsupported-question text.
This validates Piece opening in that interaction but exposes mishearing recovery.
No claim that the browser transcription engine has been fixed or replaced.

Bounded repair in the same provider-neutral core:

- Correctly transcribed named glaze questions (“What glaze is on blue vase?”,
  “What glaze did I use on the blue bowl?”) use canonical owned Piece search
  and existing owner-filtered history. One match reads it and opens the canonical
  viewer; ambiguity preserves the requested glaze read while asking a choice.
- The observed “what way/ways is on …” phrase does not silently become a glaze
  question. With an owned selected Piece, propose the exact interpretation,
  naming that Piece, and require “yes” or “no”. No fact or navigation is returned
  before confirmation. No current Piece means a fresh-selection prompt.
- A named glaze query with no matching records can likewise ask whether the user
  means the current Piece. It never silently substitutes that Piece.
- “Yes” performs only this pending read, with fresh ownership/relationship reads.
  “No” cancels the interpretation and keeps the selected Piece for a corrected
  question. No pending confirmation means no action. Normal navigation/topic
  changes discard the pending interpretation. Deleted/foreign records remain
  unavailable. Confirmation cannot authorize any write, deletion or arbitrary tool.
- Context holds only the existing IDs/scope plus internal pending-read booleans;
  no audio, transcript, credentials, persistent records or new provider calls.
- Existing 4H lifecycle and 4I.1 visible reply behavior remain; build marker and
  script URL updated to 4I.2. No production/native/TestFlight changes.

499 assistant/search tests passed under the isolated Node 22 local HTTP/SQLite
runner. Added tests reproduce both exact screenshot transcripts, yes/no/no-pending
behavior, current-record retention, owner/deletion/topic boundaries, named reads,
ambiguous choices and the complete actual website listen/clarify/confirm/listen
flow with simulated speech. CI also runs the strict foundation gate. The staging
smoke script verifies 24 turns including this observed wording and truthful empty
Vase glaze data. Real-iPhone acceptance remains Christina's check.

Test on existing isolated Safari site after the repair is verified live:
confirm “Conversation test 4I.2”, start once, open the Blue Bowl and ask about its
glaze. If that question is transcribed into the observed way/phase wording, expect
a named clarification and answer yes/no hands-free. Blue Bowl has saved Ocean;
Blue Vase has no saved glaze. The persistent Heard/response lines provide precise
evidence for other transcription errors; do not add broad silent substitutions.
