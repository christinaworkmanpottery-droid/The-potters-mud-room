# Phase 4C — typed website proof

Based on exact Phase 4B commit `8c05e56f32dfe1f9d919fd579f5763e04aea85fa`.
Branch: `ql/phase-4c-assistant-web`. Core and HTTP turn implementation unchanged.

## Test-only activation

Set both `QL_ASSISTANT_CORE_ENABLED=1` and `QL_ASSISTANT_WEB_ENABLED=1` in an
isolated development/test server. Both are OFF unless their value is exactly `1`.
`GET /api/ql/assistant/config` returns only `{enabled:boolean}`, with private,
no-store caching. Missing/failed/invalid config fails closed. The existing 4B
turn endpoint still uses its original core flag; the web flag adds UI only.
There is no URL, local-storage, account-tier, or client flag override.

Sign in, then select **QL assistant — testing** beside Studio Search, or visit
`#qlAssistant` on that test server. No entry or page is created when disabled.
Unsigned/invalid sessions cannot open or submit the proof. Display naming is one
local presentation constant, separate from route, protocol, and tool identifiers.

## Flow and rendering

One compact, labeled text input (maximum 200 characters), Send, native form/Enter
submission, loading status, response, Retry, and Open Firings. There is no chat
history, avatar, microphone, speech, TTS, wake word, or general-purpose chatbot.

Each submission posts the exact version-1 request to `/api/ql/assistant/turn`:
`{version:1,requestId:"web-N",input:{text}}`, with the captured bearer credential.
The client does not retrieve, sort, format, or reconstruct firing facts. Successful
responses must match version, request ID, and authenticated account ID. Only
`response.text` is rendered using `textContent`. Evidence is never displayed.
Empty, undated, tied, and valid-date responses retain the core's wording.
UNSUPPORTED_INTENT displays a neutral unsupported-test message. Other failures
offer Retry and manual Firings access. A 401 clears the view and invalidates that
client session until credentials/account identity change. No legacy AI fallback.

## Account and request lifecycle

Prompts, answers, and request state exist only in page memory/DOM. No assistant
prompt/response persistence, legacy chat-history reads/writes, studio mutations,
model/provider calls, or logging were added.

Application-owned token/account assignments use synchronous setters that clear
the assistant before identity changes. Logout, API 401, token storage events,
navigation, pagehide, and page visibility changes invalidate/clear pending UI.
Every asynchronous continuation rechecks token + account + stored-token identity,
session generation, request serial, current page, and AbortController signal.
This guards even transports that ignore abort, JSON parsing that finishes late,
and Account A → B → A. Identical pending sends are ignored; a different question
supersedes the prior request. Retry creates a new request identity. History/hash
navigation also cancels paths that bypass the ordinary page loader.

This inherits 4B's existing JWT semantics; clearing a client does not revoke an
already-issued bearer token at the server. Every turn remains server-authorized.

## Regression and verification commands

Use Node 22 and the repository dependencies; all server fixtures are synthetic.

```
node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-assistant-web.cjs tests/ql-assistant-web-http.cjs
node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-assistant-core.cjs tests/ql-assistant-http.cjs
node --require ./ql/rehearsal/suite-isolate.cjs ql/verify-phase1.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

The recovery runner requires `.rehearsal-checkout` containing `synthetic-only-v1`
in an isolated checkout with no application database, then
`node ql/rehearsal/run.cjs`. Never run that workflow in a deployed directory.

38 new website regressions cover flag combinations, complete real HTTP/core flow,
DOM states, form submission, duplicates, retry, cancellation, account/token
replacement, late replies/401/JSON parsing, safe rendering, no external requests
or legacy history writes, CSS visibility, manual fallback, and unchanged legacy
Ask a Potter functions. The full runner includes these and all 53 unchanged 4B
regressions. Existing source checks were updated for new cache versions and auth
setter syntax; their required media-cleanup ordering remains enforced.

## Deferred verification and next slice

Remote publication/exact-head CI, the existing non-root recovery permission check
(local runtime EINVAL), and real browser/native-device verification remain deferred
dependencies. Local Chromium launch was unavailable because the browser binary
is not installed; DOM and real HTTP checks provide the completed local evidence.
Do not retry publication or reopen earlier phases for these dependencies.

Recommended 4D: bounded foreground tap-to-talk input adapter feeding this same
contract, with capability/permission checks, explicit stop/cancel, and the typed
fallback. No wake word or background listening; TTS can remain a separate slice.
4D is not started. No deployment, production access/change, or TestFlight change.

## Final local results

- New 4C: 38/38 PASS; all 53 existing 4B regressions preserved and passing.
- Complete backend/QL runner: exit 0, 1,568 TAP tests PASS, zero failures;
  every standalone verification batch passed. Network guard restricts to loopback.
- Strict foundation: 37/37 PASS.
- Recovery: 114 PASS, zero FAIL, one existing non-root EINVAL deferral; no source blockers.
- DOM and real server integration: PASS. Actual Chromium/device testing remains deferred.
- No new blocker. No production/deployment/TestFlight changes or external AI calls.

Evidence is in `ql/assistant/evidence/`. Log trailing whitespace is normalized.
Recovery runs against the final staged source before the checkpoint commit; its
inherited Git metadata therefore names the unchanged 4B parent. Disposable
synthetic recovery trees were removed after evidence was retained.
