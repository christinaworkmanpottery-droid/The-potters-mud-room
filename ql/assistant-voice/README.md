# Phase 4D — bounded foreground tap-to-talk website proof

Base: exact 4C `1546c4f8192bbdc698fcc8f5f2384e7a5f81e785`.
Branch: `ql/phase-4d-assistant-voice-web`.

## Activation and scope

All three server environment values must equal `1`:
`QL_ASSISTANT_CORE_ENABLED`, `QL_ASSISTANT_WEB_ENABLED`, and
`QL_ASSISTANT_VOICE_WEB_ENABLED`. All default OFF. Config is private/no-store;
missing/invalid voice config fails closed. Core/web flags still determine typed
entry availability. Voice OFF creates no speech control and never constructs a
recognizer. No browser storage or URL flag override.

On the signed-in test `#qlAssistant` page, Tap to talk starts one foreground
English-US recognition attempt. Stop requests a final result; Cancel discards the
attempt. Single final text populates the existing 200-character typed input and
calls its existing submit function, posting exactly the unchanged version-1
contract to `/api/ql/assistant/turn`. The 4B core and its route are unchanged.
The supported proof is “When was my last firing?” and the same four existing
4B phrases. Unsupported speech gets the same bounded unsupported response.
No transcript rewriting, inference, new tool, legacy AI fallback, or new history.

## Lifecycle and privacy

Standard SpeechRecognition or prefixed webkitSpeechRecognition is feature-tested,
with secure context required. Constructor/start/stop exceptions, unavailable
capability, permission denial, engine errors, empty/overlong speech, or no result
leave typed input and manual Firings access usable. Controls and statuses are
labeled, keyboard-operable buttons; typed input is never disabled by listening.

No microphone starts at mount, entry, page resume or recognition end. Recognition
is non-continuous and final-only, one alternative. The whole attempt (including
permission/start delay) is bounded to 20 seconds; Stop completion to 3 seconds.
No automatic retry/restart. Duplicate start/stop/final callbacks are guarded.
Editing or submitting typed text cancels speech. Starting another voice attempt
aborts any older assistant request. Cancel then tap starts a fresh capture.

Speech callbacks capture account/session generation and their recognition object.
Cancellation detaches handlers, aborts recognition and clears timers. Even already
queued callbacks recheck identity and generation. Existing AbortController,
request serial, response identity and JSON-parse guards are preserved. Account,
token and session invalidation, logout, cross-tab auth changes, route/history
navigation, pagehide, visibility loss and (when voice enabled) window blur clear
transient state. Returning to foreground never restarts recognition.

The app stores no audio, transcripts or conversation history; no MediaRecorder,
audio upload endpoint, storage write, logging or model call is added. Final text
travels only through the existing authenticated assistant turn path. The browser
speech engine may process audio through its vendor service; this is explicitly
shown before tapping. Browser/vendor audio handling and retention are outside
this app's control; this proof does not claim guaranteed on-device recognition
or vendor-side zero retention. No paid application AI/model API is invoked and
no studio facts are sent to a speech or model provider by application code.

Speech API semantics checked against MDN:
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/stop
https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/abort

## Verification

Node 22, synthetic fixtures, loopback-only backend suite. Commands:

```
node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-assistant-voice-web.cjs tests/ql-assistant-voice-http.cjs tests/ql-assistant-web.cjs tests/ql-assistant-web-http.cjs tests/ql-assistant-core.cjs tests/ql-assistant-http.cjs
node --require ./ql/rehearsal/suite-isolate.cjs ql/verify-phase1.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

Recovery: isolated checkout with `.rehearsal-checkout` containing
`synthetic-only-v1`, no application database, then `node ql/rehearsal/run.cjs`.
Never run against deployed/user data. Staged source is copied by that runner.

New tests include DOM lifecycle/queued-callback simulations plus real HTTP →
unchanged authenticated 4B core → database firing read → rendered response.
All 4C tests remain; its HTTP config assertion alone includes the new boolean.
All 4B tests and implementation remain unchanged. Legacy app.js byte-identical.
Evidence and final counts are captured alongside this document.

## Limits and next slice

Real microphone/permission behavior on Safari/iPhone and other browsers has not
been device-verified. Capability detection is not a promise that a vendor engine
is available, online or accurate. Secure context, browser/vendor permissions and
engine behavior affect availability. Browser-supplied punctuation or alternate
wording can fall outside the deliberately narrow existing intent resolver;
the user can edit or type the proof question. Blur cancels conservatively,
including browser UI that transfers focus; use a fresh explicit tap afterward.
No native implementation, TTS, wake word, background/locked-screen listening,
continuous conversation, avatar, personality or final name is included.

Recommended next Phase 4 slice: 4E — bounded real-browser/device validation of
this same foreground proof, especially iPhone Safari microphone permissions,
stop/cancel, interruptions and account switching, with only reproduced fixes.
Do not expand scope to wake words, native speech or additional tools yet.
Remote publication/exact-head CI and prior unsupported non-root recovery checks
remain tracked separately. No deploy, production merge or TestFlight change.

## Final local results

- 4D new regressions: 64/64 PASS (58 lifecycle/DOM, 6 real HTTP flag/core).
- Existing 4C: 38/38 PASS; existing 4B: 53/53 PASS.
- Combined focused run: 155/155 PASS, exit 0.
- Full backend/QL runner: 1,632 TAP tests PASS, zero failures; all standalone
  batches PASS; exit 0, loopback-only network guard.
- Strict foundation gate: 37/37 PASS, exit 0.
- Supported recovery: 114 PASS, zero FAIL, one existing non-root EINVAL
  deferral. Recovery runner exit 1 reflects this explicitly blocked check;
  no source blockers. Do not describe this as an unconditional recovery pass.
- No production access/change, deployment, merge, native build or TestFlight change.

Recovery evidence copied before deleting this run's disposable synthetic trees.
Its inherited Git metadata identifies 4C because it tests staged 4D source before
commit. Only documentation/evidence were added afterward. Full raw logs, startup
and restore manifests, and counts are retained under `evidence/`.
