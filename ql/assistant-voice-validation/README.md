# Phase 4E — bounded web voice validation

Base: exact Phase 4D `ed83efe5eb1a4f0245c801e53ea5c349cc8a47c1`.
Branch: `ql/phase-4e-assistant-voice-validation`.

## Result and boundary

One reproduced fallback defect fixed: 4D rendered an unsupported/insecure
microphone button with computed `display: inline-flex` (disabled). It now uses
`hidden` so the existing scoped CSS removes it from display. The typed field,
unavailable explanation and manual Firings route remain usable. The existing
capability fallback regressions now assert actual computed display for both
missing recognition and insecure context. No assistant architecture changes.

Actual successful runtime: Node 22.23.3, JSDOM 26.1.0, real loopback HTTP server,
synthetic SQLite database, complete unchanged `app.js` and website utilities,
and the QL assistant script. Standard and prefixed speech engines were simulated.
31 full-script/HTTP checks pass. Existing focused tests cover queued callbacks,
late HTTP and JSON responses, navigation, logout, account/token/session changes,
storage events, pagehide, visibility loss, blur, retries and duplicate finals.
These are runtime simulations, NOT a real-browser or microphone pass.

## Browser attempts — no browser pass claimed

- Playwright WebKit 26.5 build 2336 downloaded successfully. Launch was blocked
  by missing GTK4/GStreamer and other shared libraries. Official dependency
  installer failed on container `setgroups`/`setegid`/`seteuid` restrictions.
- Chrome for Testing 151.0.7922.34 downloaded from Google's official distribution.
  Playwright launch failed at `process_singleton_posix.cc`: `socket() failed:
  Operation not permitted`. A reduced-process launch had the same failure.
- The provided Chrome cloud-browser surface could not open the isolated server:
  `http://127.0.0.1:41887` returned `net::ERR_BLOCKED_BY_CLIENT`.
- No browser permission prompt, actual recognition engine, microphone, audio,
  iPhone Safari, or actual WebKit page behavior was validated. No browser screenshot
  or successful listening claim exists. System restrictions were not bypassed.

## Evidence map

- `reproduced-fallback.log`: two failing computed-display assertions before fix.
- `runtime-before.log`: full-script/real-HTTP reproduction of unsupported control.
- `runtime.log`, `runtime.json`: 31 passing fallback-runtime checks after fix.
- `focused.log`: affected 4D/4C/4B suites.
- `full.log`: full backend/QL verification runner.
- `strict.log`: strict foundation gate.
- `recovery.log`, `recovery.json`: disposable recovery rehearsal and limitations.
- `browser-blockers.txt`: browser startup/network limitations.

The isolated backend inherits the existing loopback-only outbound guard and
receives no production credentials, provider keys, or production database.
Requests from the runtime harness are restricted to that server's origin.
The QL flow uses only `/api/ql/assistant/turn`; no legacy AI/chat request or
`aiChatHistory` write occurs. Session/local storage contains no transcript.
The application does not capture/persist audio. Browser/vendor audio processing
and retention cannot be verified or guaranteed here. Unchanged 4B core remains
the only factual response source. Legacy app.js, index.html, server route and
4B implementation remain byte-identical to 4D.

## Minimum isolated manual setup (prepared; not published)

Use Node 22 and the project's installed dependencies:

```
node ql/assistant-voice-validation/serve.cjs
```

This starts the exact checkout's website/backend in a new synthetic temporary
folder, enables all three existing flags, creates a disposable sign-in for
`a@example.invalid`, and prints a random temporary password. The known latest
firing is **2026-10-01**. SIGINT/SIGTERM deletes the disposable fixture.
No production account or data is required. The secret and password are ephemeral.

Flags (all must equal `1` for voice):

```
QL_ASSISTANT_CORE_ENABLED=1
QL_ASSISTANT_WEB_ENABLED=1
QL_ASSISTANT_VOICE_WEB_ENABLED=1
```

Core + web enable the typed entry; voice additionally enables supported speech
controls. All remain OFF by default in ordinary deployment. The fixture uses
these flags explicitly and never modifies production configuration.

Loopback HTTP is secure-context eligible on the same machine, but **is not an
accessible iPhone link**. A trusted HTTPS route to this isolated fixture must
be provisioned in an approved staging host before Christina's iPhone check.
No such route was available/verified here; none was deployed or promised.
Do not expose production storage, copy production keys, disable certificate
validation, or ask Christina to configure infrastructure. The local launcher is
preparation for the developer arranging that single test link.

Christina's focused check once that HTTPS link is ready:

1. Sign into the disposable account and open QL Assistant.
2. Tap microphone; allow the expected permission; say “When was my last firing?”
3. Check the recognized question and the factual response (fixture: 2026-10-01).
4. On a fresh tap, try Stop; on another, try Cancel.
5. Type the same question and confirm typed fallback works.

A first permission prompt may cause focus changes; 4D conservatively cancels on
blur. Whether Safari requires a fresh tap after granting permission remains
unverified, as do engine punctuation, permission UI and real start/stop timing.
Do not redesign these behaviors without an observed device defect.

## Closure / next slice

The bounded proof is NOT yet fully device-validated or ready for an unconditional
voice-proof close. Local hardening and supported automated checks are complete;
actual Safari/iPhone microphone verification remains an external dependency,
not a source redesign blocker. Recommended next bounded Phase 4 slice: **4F — focused iPhone Safari voice acceptance**. Complete
the focused trusted-HTTPS Safari microphone acceptance and fix only a reproduced
device defect, then make the close decision. Do not add native voice, wake words,
background listening, TTS, additional tools, history, names, avatars or personality.

No production merge/deployment, TestFlight change or next-slice implementation.

## Requirement coverage

| Requirement | Available evidence | Real Safari dependency |
| --- | --- | --- |
| Required flags / entry visibility | Six real HTTP flag combinations; existing 4C config checks | Visual confirmation in focused test |
| Typed 4C path | Real HTTP/core/DB factual result with full website scripts | Focused typed fallback |
| Microphone only when supported | Missing/insecure capability computed-display regressions, now fixed | Native API availability |
| Explicit start / obvious listening | Standard/prefixed event simulation; visible status and no automatic start | Real permission and listening UI |
| Stop / cancel | Stop called once; cancel aborts; late callbacks rejected | Engine-specific timing |
| Permission denial / unavailable | Simulated errors and absent API; typed path still reaches backend | Native permission prompt |
| Speech through 4C → 4B | Simulated final event sends original version-1 authenticated contract to real server | Actual transcription delivery |
| Same factual / unsupported results | Exact typed/spoken output equality against synthetic DB and safe unsupported result | Recognition accuracy / punctuation |
| Second attempt / duplication | Duplicate finals, queued canceled callbacks and old requests covered | Real engine event ordering |
| Navigation/logout/account/session | Actual website hooks plus queued callback and response regressions | Safari page/background lifecycle |
| No stale transcript / response | Existing serial/generation/session/identity tests retained | Device interruptions |
| No app audio/transcript persistence | Storage inspection, source checks, no added persistence; original core unchanged | Vendor retention is outside app control |
| No external model / legacy chat | Loopback-only backend; no provider keys; no AI route or history write | No paid model integration added |
| Legacy Ask a Potter independent | app.js, server.js and 4B code byte-identical to 4D | No legacy redesign in scope |

Recovery checks exercise the changed source in a disposable checkout. Its Git
HEAD remains 4D while staged source contains the one-line 4E fix, matching the
previous checkpoint workflow. Exact-head remote CI/publication remains deferred.

## Final verification counts

- 4D/4C/4B focused: 155/155 PASS (64 + 38 + 53); zero failures, exit 0.
- Full backend/QL: 1,632/1,632 TAP tests PASS; all standalone batches PASS;
  zero failures, exit 0. Existing loopback-only outbound guard active.
- Strict foundation gate: 37/37 PASS, exit 0.
- Full website-script + real HTTP/core/database fallback runtime: 31 PASS.
- Isolated manual launcher: login, three flags and factual turn verified.
- Supported recovery: 114 PASS, zero FAIL, one existing non-root EINVAL deferral;
  exit 1 reflects the known blocked check, not an unconditional recovery pass.
- Production source delta: one line in `public/ql-assistant.js`; two existing
  fallback cases strengthened. No source-level failures remain in this slice.

Re-run commands (Node 22):

```
node ql/assistant-voice-validation/runtime.cjs
node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-assistant-voice-web.cjs tests/ql-assistant-voice-http.cjs tests/ql-assistant-web.cjs tests/ql-assistant-web-http.cjs tests/ql-assistant-core.cjs tests/ql-assistant-http.cjs
node --require ./ql/rehearsal/suite-isolate.cjs ql/verify-phase1.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

Recovery: copy the checkpoint into a disposable checkout with no application DB,
mark `.rehearsal-checkout` as `synthetic-only-v1`, and run
`node ql/rehearsal/run.cjs`. Never run the rehearsal against deployed/user data.
