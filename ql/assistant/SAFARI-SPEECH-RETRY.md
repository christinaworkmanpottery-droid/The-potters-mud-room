# Safari speech retry correction

User reported one recognized attempt in about five on a real iPhone after Phase 4G.
Base: 2ea6df87ce4a964e701c902867cd35db7665d498.
Branch: ql/phase-4g-safari-speech-retry.

This is a focused client speech-lifecycle correction, not an assistant redesign.
No exact device root cause is claimed without a new iPhone microphone test.

- Enable interim recognition feedback. Interim-only completion preserves an
  editable draft for explicit Send; it never automatically submits partial words.
- Stop successful recognition and wait for its end/disconnection event before
  submission/retry. Do not abort a normally completed recognition session.
- Distinguish microphone readiness, sound detected, no returned text, network,
  audio capture, interruption, and permission errors.
- A still-visible window losing focus no longer clears recognition. Hidden
  documents, pagehide, navigation, logout/token/account changes and explicit
  cancellation still abort and discard transient speech.
- Keep a bounded single attempt: 20 seconds listening then at most 5 seconds
  for stop completion. No automatic retries, paid calls, stored transcripts,
  background capture, or changed server/domain authorization.
- Bump the assistant asset version to prevent stale client caching.

Validation on Node 22:
71 focused voice DOM + real local HTTP tests passed. These cover five consecutive
successes, five no-speech retries then success, delayed engine disconnect,
interim-only completion, timeouts, stale final events, ownership/session changes,
flags OFF, typed fallback, and actual assistant HTTP submission.
The other 166 assistant regression tests passed in the preceding full run.
That run's voice HTTP fixture initially lacked the newly required engine end
signal; it was corrected to assert no submission before end and is included in
those 71 passing tests. git diff --check is clean.

Existing isolated Render service remains the only deployment target:
srv-davicepsrm7s73c4ga0g / tea-d6it8hcr85hc73c5rtog.
https://potters-ql-phase4f-safari.onrender.com/#qlAssistant
Production and TestFlight untouched. Real iPhone reliability remains to be
confirmed by Christina after this patch; synthetic engine tests are not a
substitute for Safari's speech service and physical microphone.
