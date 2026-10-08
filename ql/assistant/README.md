# Phase 4B: isolated assistant core

Backend-only, read-only proof. The new `/api/ql/assistant/turn` POST is registered
only with `QL_ASSISTANT_CORE_ENABLED=1` (off by default). No schema/storage changes,
UI, voice, provider network calls, credit deductions or legacy chat migration.
Existing `/api/ai/chat`, OpenAI gpt-4o configuration and legacy shared client chat
histories remain unchanged and are never used by this flow.

## Contracts

Request: `{version:1,requestId:"proof-1",input:{text:"When was my last firing?"}}`.
Alternatively `input:{command:{name:"studio.firing.latest",arguments:{}}}`.
Exact keys required at each level; request ID is 1–64 ASCII letters/digits/_/-;
text is 1–200 characters. Four bounded phrases are supported (case, whitespace,
optional final question mark normalized): "when was my last firing", "when was
my latest firing", "latest recorded firing", "last firing". This is a proof
resolver, not general natural-language understanding. No IDs, owner selectors,
history, client context or extra command parameters are accepted.

Flow: validate live authentication → validate request → resolve/validate intent →
revalidate authentication → owner-scoped tool → structured evidence → formatter.
`createAssistantCore(db).turn({request,authorize,signal})` is the programmatic
entry. `authorize` is a trusted server callback, never input from JSON. It must
return the currently authenticated account and reject invalid/expired credentials.
The HTTP adapter verifies the ordinary bearer JWT on both checks, requires a live
account and never accepts admin-key-only access or the legacy JWT-tier fallback.
Free and paid accounts retain their normal firing-read access; no new paywall.

Intent provider interface:
`resolveIntent({text}, {signal}) -> Promise<{name,arguments}> | {name,arguments}`.
It gets only request text, no owner, credentials, history or studio evidence.
The default adapter is deterministic. Server-injected fake adapters prove
replaceability. HTTP exposes no provider selection. Any future paid adapter
requires its own timeout/budget/privacy/cancellation implementation and release
scope; none is included or enabled here. Provider output must pass the same exact
allowlist/empty-arguments validator and cannot authorize tools or format facts.
Structured commands skip the resolver entirely.

Tool: `latestRecordedFiring(db, authenticatedAccountId, validatedIntent)`.
Result:
`{tool:"studio.firing.latest",status:"found"|"empty"|"undated",date:string|null,
tiedRecords:number,unorderableRecords:number}`.
Only the existing `firing_logs.date` column is retrieved, constrained by the same
`user_id=?` owner predicate and `ORDER BY date DESC` as the canonical list API.
No duplicated storage or new completion state. Canonical clients save date-only
YYYY-MM-DD; latest means latest valid saved firing date, not creation time or
presumed completion. Gregorian date validation excludes absent/malformed dates;
they are counted and explicitly disclosed as unorderable. Future saved dates
remain eligible and wording says "recorded". Same-date ties are counted, without
inventing a unique record. All-undated and genuinely empty are distinct outcomes.
The date-only proof needs no record ID/card, cone, kiln, notes or Piece links.
The scan streams minimal date rows; memory/output are bounded, runtime scales
with the authenticated account's firing count. No changes to legacy sorting,
serialization, reads/writes, or handling of historical malformed dates.

Response:
`{version:1,requestId,accountId,intent,result,response:{text}}`.
The account ID is authenticated response correlation, not client-selected context.
`result` is factual evidence; `response` is deterministic presentation. Formatter
requires the exact result schema and valid status/date/count combinations. Dates
remain saved ISO date-only strings; no timezone conversion, invented numbers,
kiln/cone/temperature/notes or relationships. It refuses extra evidence fields.
An unavailable DB is 503, never an empty answer. Malformed/unsupported input is
400; absent/expired/deleted-account authentication is 401. All handler responses
use `Cache-Control: private, no-store`. No request/record logging is introduced;
unexpected error details are replaced by a generic availability error.

## Isolation and limits

No session store, transcript, cache or last-intent memory exists. Every turn reads
fresh authorized data, even when another account reuses a request ID. Account
change during asynchronous intent resolution fails before retrieval. Live account
and token expiry are rechecked after resolution; cancellation prevents retrieval.
No durable conversational state can migrate between accounts.

This does not retrofit JWT logout revocation into the application: a still-valid
old bearer remains that old account's credential under existing auth semantics.
The future 4C client must cancel and clear ephemeral state on logout/account
switch, bind pending replies to its account/session generation + request ID, and
discard stale replies before display/storage. A backend-only change cannot
prevent an absent client from displaying a response already delivered before a
switch. Existing legacy chat history must not be imported.

## Verification and next slice

53 new regressions cover core/formatter/adapter contracts and the real server
route, two-account isolation, crafted IDs, empty and invalid/tied/future dates,
missing/expired/deleted-account auth, session replacement, cancellation, provider
independence, zero external calls and unchanged canonical firing reads. Full
verification includes these tests; loopback-only suite guard blocks network
side effects. Strict foundation passed 37/37. Disposable recovery passed 114 supported checks
with zero failures; the single existing non-root permission check remains blocked
by the local runtime (EINVAL). No new recovery blocker.

Recommend 4C: one flag-gated website typed question/button proof using this exact
contract, ephemeral account-bound view state and cancellation/generation guards.
Show dates and empty/error states safely. Record navigation would require an
explicitly scoped source-ID extension, since 4B intentionally returns only dates.
Do not start voice, other studio tools, paid models or a legacy-chat redesign.
Publication/exact-head CI, non-root recovery and device verification remain
previously deferred dependencies, not reasons to loop or reopen Phase 3.

Final local full backend/QL runner: PASS (exit 0), including all 53 new
regressions. Frozen Phase 3 source checkpoints remain unchanged. No deployment,
production access, native build, TestFlight change or external model call.
