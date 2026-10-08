# Phase 4G — connected studio reads and navigation

Continues the accepted Phase 4F public mirror `ab71c7726ae885dcc044f1ebf072c77fb9f51d0e`.
The original 4F commit remains in history. Production and TestFlight are out of scope.

## Supported

- Open/show/go to/take me to Pieces, Clay/Clay Bodies, Glazes, Raw Materials,
  Test Tiles, Firings, Pricing, Sales, Projects, Contacts, Events/Calendar.
  Optional “my”, “the”, and “please” are accepted.
- “When was my last firing?” and all existing last-firing date aliases keep their
  original factual response, date validation, ownership and tie handling.
- “Open my last firing” opens the actual record with the existing Studio Search
  canonical, authenticated, read-only viewer. A latest-date tie opens matching
  search results; no records/valid dates produces an honest answer without navigation.
- “Find blue glazes”, “Search my glazes for blue”, “Find celadon” (all domains).
  All eleven domain filters reuse the existing Studio Search service and UI.
- “Open test tiles and show me underglazes” searches Test Tiles for underglaze.
  Test Tile search includes the saved surface_result field; no inferred classification.
- “Open photo lookup” / “Open photo search” opens existing Photo Lookup.
  Selecting/uploading the image remains manual. No new image pipeline.
- “Open studio search” opens existing Search.

## Safety and bounds

Same provider-neutral core, request envelope, feature flags, JWT and live-account
checks. Provider outputs are validated against exact argument schemas. No caller-
selected account, URL, arbitrary route, or SQL identifier is accepted. Navigation
uses an explicit browser allowlist and preserves account/request/visibility guards.
Search rechecks live Test Tile entitlement; feature loaders and record viewers keep
canonical authorization and private-media boundaries. Studio Search queries again
on entry, so stale assistant metadata cannot authorize a record.

No model calls, writes, delete tools, persistent conversations, automatic photo
uploads, background listening or native changes. Write commands are explicitly
unavailable and make no changes. Confirmation-backed writes, richer semantic
interpretation, and full hands-free operation are deferred to future slices.
Unsupported wording fails safely. Typed and manual navigation remain available.

## Verification

Node 22 (matching staging runtime family):

    node --test --test-reporter=tap tests/ql-assistant*.cjs tests/ql-studio-search.cjs tests/ql-studio-search-dom.cjs tests/ql-studio-search-http.cjs

342 passed, 0 failed. Covers all destination mappings, all-domain owner-scoped
reads, live entitlement revocation, untrusted intents, malformed input, denied
write commands, latest-record/no-record/tie behavior, page transitions, safe
Search/viewer handoffs, session races, flags OFF, typed and voice regressions,
and canonical HTTP/read authorization. `git diff --check` clean.
The initial local Node 24/SQLite native-addon crash was resolved by using isolated
Node 22 and rebuilding the locked SQLite dependency; no dependencies changed.

## Staging

Existing isolated service: `srv-davicepsrm7s73c4ga0g` in workspace
`tea-d6it8hcr85hc73c5rtog`, auto-deploy OFF.
URL: https://potters-ql-phase4f-safari.onrender.com/#qlAssistant
Its existing `ql/phase-4f-assistant-safari-acceptance` deployment ref may be fast-
forwarded to the new Phase 4G commit; the canonical work branch is
`ql/phase-4g-connected-studio-navigation`. No force updates or main changes.
No production secrets/data are copied. The synthetic account initially has a
single firing; other feature lists can be empty. Local tests use two independent
owners with records in every domain.

Next iPhone check: open Test Tiles; open Glazes; find underglaze Test Tiles; open
last firing; ask its date; use Back/manual menus; repeat one command by microphone.
Safari speech can still return no-speech; typing remains available.
