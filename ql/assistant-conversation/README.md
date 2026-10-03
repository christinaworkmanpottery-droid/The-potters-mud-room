# Phase 4I — bounded conversation context and Piece follow-ups

Accepted base: Phase 4H `454b92599407cf7ec70a88e003f55c81e5dce00f`.
Branch: `ql/phase-4i-conversation-context`.
Christina accepted 4H on her real iPhone Safari: one activation, listening resumed
between tested navigation commands. 4B–4H remain closed for their accepted scope.
4I is the next numbered slice, under master-roadmap Phase 4 intelligence/voice.

## Delivered scope

The existing provider-neutral core and `/api/ql/assistant/turn` now support a small
read-only conversation. Both typed and voice input use the same resolver, validated
intents, authorization, search service, Piece history service and canonical viewer.
No second voice agent, paid model, schema migration or production change.

- “Open my pieces” establishes Piece scope.
- “Show me the blue one” searches saved Piece text in that scope. Color is not
  inferred from photos. “Find blue pieces” establishes scope directly too.
- A single match opens the existing authenticated Piece viewer. Multiple matches
  give up to five numbered choices, in canonical search order; “the first one”
  through “the fifth one” selects only from that announced list. More-than-five
  results are explicitly disclosed. No arbitrary first-match selection.
- “What glaze did I use on that?” / “Which glazes did I use on it?” reads saved
  glaze layers and custom labels. “When did I fire it?” / “When was that fired?”
  reads valid saved dates of linked firings. No created-at fallback or inferred date.
- “Open it” reopens the selected Piece. “Go back to my glazes” uses normal routing
  and clears the Piece reference. Other topics likewise do not retain old focus.
- Missing context, deleted/transferred records and missing facts are explicit.
- All writes remain unavailable, including Studio Note creation; no success is
  claimed. Confirmation-backed writes are a later small slice.

## Context and safety

Backward-compatible version-1 extension: optional `context:{token:null|string}`.
The browser sends null for a new conversation and accepts only a correlated,
48-character hexadecimal opaque token in the response. Old requests without a
context keep the former stateless behavior, including normal search responses.

The core holds a bounded map of random 192-bit references to immutable snapshots:
owner ID, Piece scope, selected Piece ID OR at most five candidate IDs, and expiry.
No transcript, audio, credentials, record facts, media or database persistence.
Each snapshot expires after 15 minutes and the entire store holds at most 1,000.
Restart, expiry or eviction prompts a fresh search. Context is a hint, never an
authorization: live auth is checked before/after provider resolution, every record
and relationship is read again under the authenticated owner. Tokens copied to a
foreign account yield no information. Providers still receive text only; their
outputs pass exact allowlisted intent schemas, never arbitrary record IDs or SQL.
The optional context extension cannot be used as a write authorization.

The client drops its token on session stop/restart, visibility loss, pagehide,
authentication/account change, manual departure and unsupported/error responses.
Server snapshots then remain inaccessible from that client and expire/evict normally.
Own asynchronous record-view transitions retain context only for the matching
canonical record route. Ordinary manual navigation clears it without ending an
otherwise idle hands-free session. Late/canceled responses cannot replace context.
Typed return to the assistant after its own navigation retains the last reference;
a subsequent manual departure clears it. No browser storage writes were added.

## Verification

Node 22.23.3, matching staging's runtime family; locked dependencies unchanged.

- 490/490 assistant/core/voice/search regressions passed under the loopback-only
  suite isolation guard. The added full website/actual HTTP/SQLite test passed
  separately under the same guard after fixing its test URL representation.
  Combined: 491 passing, zero outstanding failures/skips.
- Strict Phase 1 foundation gate: 37/37 passed.
- Full-site integration uses actual app.js, studio-search.js, ql-assistant.js,
  authenticated HTTP, SQLite and Piece detail UI. Speech events are simulated;
  this is not a new physical microphone acceptance claim.
- Explicit coverage: single/ambiguous/empty/capped matches, ordinals, fresh reads,
  foreign-owner links, deleted/transferred Pieces, missing dates/glazes, token
  expiry/eviction/restart, malformed requests/provider outputs, unavailable writes,
  typed parity, async viewer handoff, cancellation and stale-response boundaries.
- Dedicated branch CI runs assistant/search tests and the strict foundation gate.
  Remote CI and deployment status must be checked before claiming a live release.

Reproduce:

    node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-assistant*.cjs tests/ql-studio-search.cjs tests/ql-studio-search-dom.cjs tests/ql-studio-search-http.cjs
    QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs

## Staging and Christina's next test

Only existing service `srv-davicepsrm7s73c4ga0g`, workspace
`tea-d6it8hcr85hc73c5rtog`, auto-deploy OFF. Canonical 4I branch stays separate;
its exact commit may fast-forward the existing 4F staging deployment ref. Preserve
the accepted 4H branch. No main, production, mobile or TestFlight changes.

URL: https://potters-ql-phase4f-safari.onrender.com/#qlAssistant
Same synthetic Safari test login. `staging-smoke.cjs` is operator-invoked only,
requires the test password from environment, hard-codes the isolated host and
verifies the exact synthetic account before creating any fixture. It seeds labeled
Blue Bowl / Blue Vase / Green Cup and an Ocean glaze + 2026-10-01 linked firing
through canonical APIs, then verifies ten follow-up turns. It never runs at startup.

Reload Safari. Start once. Wait for Microphone ready between phrases:

1. “Open my pieces.”
2. “Show me the QL 4I blue one.” Expect two named choices, not a guessed selection.
3. “The first one.” Expect QL 4I Blue Bowl (synthetic) in the existing Piece viewer.
4. “What glaze did I use on that?” Expect QL 4I Ocean (synthetic).
5. “When did I fire it?” Expect saved date 2026-10-01.
6. “Show me the QL 4I green one.” Then the same glaze/date questions: expect
   honest missing-record answers, not the previous Bowl's details.
7. “Go back to my glazes.” Expect the normal Glazes feature.
8. “Stop listening.” Verify stopped. Typed/manual controls remain available.

The optional spoken-replies setting remains as in 4H. This slice does not claim
arbitrary natural language, visual color understanding, general cross-domain
conversation, persistent memory, writes, wake words, background or native voice.
After Christina's focused acceptance, choose the next small roadmap slice from
this checkpoint; do not reopen accepted 4B–4H or roll into a large write-agent build.
