# Phase 4H — foreground hands-free session proof

Accepted parent: `65fac752f3f3cc6fc74dbd008e5c9279491d103e` (Phase 4G).
Branch: `ql/phase-4h-hands-free-session`.
Phase 4G remains accepted for the navigation Christina actually tested, not every application feature. Kiln Share has no existing website route and remains a separate gap.

## Implementation

The existing `public/ql-assistant.js` owns the session. There is no second assistant, provider, intent parser, action registry, or API. Final speech continues through `/api/ql/assistant/turn` and its existing response validation and allowlisted navigation dispatch. Typed input, tap-to-talk, and manual forms/navigation remain available. No audio recording, transcript persistence, new provider keys, database changes, or production deployment.

New server flag `QL_ASSISTANT_HANDS_FREE_WEB_ENABLED=1` additionally requires all three existing core/web/voice flags. Missing, false, or nonliteral flag values fail closed. The active session is memory-only and never starts on page load.

Explicit Start voice session -> fresh single-utterance browser recognizer -> finalized text -> stop and wait for recognizer disconnect -> existing assistant turn -> existing navigation -> visible response / optional speech synthesis -> 650 ms release interval -> fresh recognizer. No need for another tap between successful commands if the browser permits restart. `continuous=true` is deliberately not treated as an indefinite-listening guarantee. There is no microphone capture during processing or spoken output, no barge-in, and no wake word.

A fixed session control remains visible across navigation, with starting, listening, processing, responding, speaking, stopped, permission-denied, and unavailable states. End session works during recognition, HTTP requests, and speech output. Finalized “stop listening”, “pause voice”, “end voice session”, or “stop voice session” ends the session while it is listening. These control phrases are session lifecycle controls, not studio intents.

Recovery: 30-second recognition watchdog; five-second disconnect deadline; up to two automatic retries after empty/interim-only disconnects; no execution of interim drafts; 30-second HTTP and spoken-response watchdogs; 15-minute total proof-session cap. The cap and retries are application choices, not Safari platform limits. Missing disconnect does not start a second recognizer. Hard errors stop, with no permission prompt loop. Typing cancels pending voice work and preserves the typed text. Manual navigation during an outstanding turn cancels that stale turn. Visibility loss, pagehide, token/account changes, invalid authentication, and logout invalidate pending callbacks and stop capture. Returning to Safari never automatically resumes.

Spoken replies are an unchecked, explicit experimental option. The text response is always available. A speech-output error or missing completion stops visibly and suggests disabling spoken replies. We cannot promise browser speech output or recognition reliability before the real device test.

## Browser evidence and precise limits

Reviewed October 2, 2026 Pacific. Documentation and bug reports establish constraints and risks, not a physical-device acceptance pass.

- Safari recognition uses the Siri speech engine. WebKit documents a dependency on Siri being enabled. Constructor presence alone does not mean the service works. System settings, site permission, language, service availability, and interruptions can prevent recognition. HTTPS is enforced by this client. Initial activation is explicit, and permission rejection is respected.
  https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/
- The Web Speech specification defines `continuous` as allowing multiple final results, not a promise of perpetual listening. Interim results may change; only final results are actionable here. Browser restart without another gesture is a capability to prove on Christina's Safari, not something an automated fake can establish.
  https://webaudio.github.io/web-speech-api/
- Safari media autoplay has user-activation rules; they vary by API and existing capture/playback state. MediaStream autoplay rules do not prove speechSynthesis will work after an asynchronous request. This slice does not use silent audio to bypass those rules. Optional TTS has error and timeout handling.
  https://webkit.org/blog/7763/a-closer-look-into-webrtc/
- WebKit bug 321436 reports recognition hanging after media playback on iOS 26.6. A subsequent iOS 27 report describes TTS handoff failures with a reused recognizer and successful cycles with a fresh recognizer. These are device-specific reports, not a universal platform verdict. We use a fresh recognizer after disconnect and avoid audio by default; a watchdog handles absent browser events. Physical testing is still required.
  https://bugs.webkit.org/show_bug.cgi?id=321436
- Background/lock behavior differs among Safari tabs, installed web apps, and embedded WKWebViews. Historical capture bugs include interruptions, suspension, and ended tracks; some are resolved or configuration-dependent. Do not claim every Safari audio API is universally forbidden in background. For this Web Speech proof, there is no reliable indefinite background or lock-screen guarantee. The application deliberately ends on hidden/pagehide and requires a fresh activation when visible.
  https://bugs.webkit.org/show_bug.cgi?id=204681
  https://bugs.webkit.org/show_bug.cgi?id=226620
- No app-side workaround can guarantee that clearly spoken words become final browser transcripts. The user-visible improvement is bounded recovery, truthful readiness and failure states, fresh attempts after release, and no repeated tapping between successful turns. Recognition accuracy remains an acceptance question.

## Native mobile work still required

The planned reliable studio experience needs native audio-session ownership, microphone/speech authorization, audio focus and route changes, interruption recovery, Bluetooth/speaker testing, and lifecycle handling. Background/locked-screen sessions require a separately designed and OS-compliant native implementation, not simply wrapping this page in a WebView. iOS supports background recording with appropriate audio configuration and permission; Android microphone foreground services have while-in-use/start restrictions and visible service requirements. Neither platform gives arbitrary unrestricted always-on listening. Wake-word work remains unimplemented and must undergo separate feasibility, battery, permission and policy evaluation. Clayton is not finalized.

https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/record
https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition
https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start

## Real-iPhone Safari acceptance

Use the existing isolated staging account and URL:
https://potters-ql-phase4f-safari.onrender.com/#qlAssistant

1. Reload Safari; open QL Assistant. Leave Spoken replies unchecked initially. Tap Start voice session once and allow requested permission.
2. Wait for Microphone ready. Say “Open pieces”. After the next Microphone ready, say “Open glazes”, “Open test tiles”, “Open my last firing”, and “Show me Community”. Do not tap between commands. Verify the session control follows the destination.
3. Try an unsupported request and “Open Kiln Share”: neither should open unrelated Firings.
4. Say “stop listening”. Confirm Stopped and microphone release. Start again, then test End session while listening and processing.
5. Switch apps or lock the screen. Return: it must remain stopped. Verify typed input and manual navigation still work.
6. Separately enable Spoken replies and start again. Check a complete listen/respond/listen cycle. If audio fails or recognition stops after playback, note the visible state and iOS version; disable spoken replies and restart. This test separates browser audio handoff from navigation correctness.

Synthetic speech event tests do not prove microphone permission prompts, iPhone recognition accuracy, hardware audio playback, lock-screen behavior, or automatic-restart permission on a real device. Phase 4H's device acceptance remains open until Christina tests it.
