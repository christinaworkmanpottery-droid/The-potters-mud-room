# Phase 4J — confirmed Studio Note creation

Accepted parent: Phase 4I.4, a12f6087f0c1a1f6be221deb567ae51c25c01f3d.
Christina said “It works” on real iPhone Safari on October 2, then explicitly
requested starting the proposed 4J Studio Note slice. Phases 4B–4I remain closed;
this is the next numbered slice within master Phase 4, not a full write agent.

## Scope

“Add a studio note that I want to try this combination again.” previews the exact
words after the command. Nothing is saved until a later explicit “save note” or
“yes” with the current pending context. “Cancel” / “no” discards it. To correct,
dictate a replacement using “Add a studio note that …”; the old draft is invalid.
The existing 200-character request limit remains (including the command prefix).
Optional Spoken replies reads the preview aloud; typed preview/confirmation works
through the same core. On successful save, open existing Studio Notes UI.

No implicit Piece/glaze linking or pronoun expansion: Notes are currently free
text. Preserve the dictated words, case and punctuation. This slice adds creation
only, not editing/deletion, attachments, arbitrary writes or a voice-only system.

## Safety and reuse

- Shared canonical `ql/studio-notes.cjs` create operation used by the existing
  POST /api/studio/notes and assistant. Same table, owner, IDs and existing UI;
  manual create/edit/delete retain their APIs. No schema changes.
- Core rechecks live account and request cancellation before writing.
- Provider cannot invent the body or confirmation: draft must equal exact text
  extraction, and confirm/cancel must match explicit user text. No caller note IDs.
- Private drafts live only in server memory, one current draft per owner, 5-minute
  expiry, maximum 1000 owners. Client gets only the existing opaque context token.
- Draft is single-use, consumed before a synchronous SQLite create/read transaction.
  Duplicate/concurrent/replayed confirmation cannot create another note. Failed
  save says so and requires a new draft. Restart discards pending drafts.
- No database write for draft/cancel/no/expiry/stale or foreign context. Changing
  feature/topic or an unsupported request invalidates the pending draft. Existing
  client stop/hide/auth transitions drop the context, with no automatic save.
- Response says “Saved” only after canonical transaction success. Lost network
  acknowledgment remains uncertain to the client; check Notes before redictating.
- No provider-specific API, remote model, new subscription or production deployment.

## Verification

Full assistant/search suite, strict foundation gate, and actual website + HTTP +
SQLite simulated-microphone integration. New tests cover exact words, no pre-save
write, yes/save, cancel, replacement, replay/concurrency, expiry/eviction, provider
forgery, foreign account, auth change, aborted request, server restart, failed
transaction, feature navigation, stop/restart, and manual API create/edit parity.
Operator-only staging-smoke checks canonical saved body, duplicate confirmation,
cancellation and count before/after in the isolated synthetic account. It leaves
one clearly labeled synthetic saved note for inspection per run.

## Christina's real iPhone acceptance

Open https://potters-ql-phase4f-safari.onrender.com/?test=4j#qlAssistant and refresh.
Confirm “Conversation test 4J”. Enable Spoken replies for audible readback. Start
once and wait for Microphone ready between phrases:

1. “Add a studio note that I want to try this combination again.” Expect readback
   and confirmation prompt; no saved note yet.
2. “Save note.” Expect saved acknowledgment and normal Studio Notes page containing
   exactly “I want to try this combination again.”
3. “Save note.” Expect no second saved note.
4. “Add a studio note that discard this test.” Then “Cancel.” Expect no new note.
5. “Open blue bowl.” Then “What glaze is on it?” Existing accepted flow remains.
6. “Stop listening.” Verify manual Notes still works.

Real-device acceptance is pending; automated speech events do not prove iPhone
microphone/speech playback. Production, main, native releases and TestFlight stay
untouched. Branch: ql/phase-4j-confirmed-studio-notes.
