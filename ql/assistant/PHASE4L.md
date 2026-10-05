# Phase 4L — reusable flexible read commands and clarification

Base: accepted 4K.2, ac35a23fb3610afab6c85782e86fe59ecdd5243a.
Branch: ql/phase-4l-flexible-commands.

Scope: existing navigation, canonical studio search, selected Piece glaze/firing
questions, latest recorded firing. No new Piece/material write capabilities.
The accepted note workflow remains the only assistant studio write in this slice.

`language.cjs` separates conversational scaffolding, action, domain, query and
context. Shared domain metadata and a bounded compositional grammar produce the
existing allowlisted intents. It does not add a phrase table per workflow, call
a paid model, expose account data to a provider, or execute a tool. It is not an
unrestricted natural-language model: additional phrasing may still need work.
Exact dictated note payloads are not normalized. All proposals still pass the
existing exact intent schemas, authentication recheck, owner-scoped tools and
permission gates before execution. Custom intent providers retain their existing
contract; no raw conversation or private studio records are sent to them.

Clarifications keep bounded pending slots in the existing owner-bound, expiring
context store. Domain choices preserve a search query. Missing search terms can
be supplied on the next turn. Ambiguous Piece choices retain a requested glaze or
firing fact through selection. Multiple requested facts ask which to read first.
An uncertain write retains its exact request and any current note draft, uses
known note/Piece focus when present, and never silently applies a Piece change.
Unsupported mutations during a draft now return a review without discarding it;
two previous regression expectations were updated for this explicit requirement.
Note confirmation, expiry, stale-draft, ownership and duplicate-save gates remain.

Client changes are limited to the staging version label. The existing live
transcript, speech review, hands-free loop, typed path and manual forms are reused.
The full website/HTTP/SQLite integration test now traverses natural navigation,
clarification, a short answer, Piece follow-ups and search-term collection while
asserting recognition restarts between turns.

Validation uses Node 22 (matching CI) and disposable SQLite/HTTP fixtures with
outbound traffic denied by the existing suite-isolate harness. Node 24 in the
workspace crashed inside the existing native SQLite dependency; dependencies
were not upgraded. Run the assistant/search and strict foundation gates before
deploying. Automated speech events are not proof of real-iPhone acoustic accuracy.

Deployment target only: srv-davicepsrm7s73c4ga0g, workspace
tea-d6it8hcr85hc73c5rtog, potters-ql-phase4f-safari.onrender.com.
Auto-deploy is off. After validation, fast-forward the existing staging branch
ql/phase-4f-assistant-safari-acceptance and manually deploy this service.
Do not change main, production, mobile releases, billing or real-user data.

Real-iPhone acceptance (open /?test=4l#qlAssistant):
1. Start the voice session once. Say “Could you bring up my glazes?”
2. Say “Open clay or glazes.” Answer the clarification with “Glazes, please.”
3. Say “Could you find blue pieces?” Choose a listed Piece if asked.
4. Say “Tell me about the glaze on it”, then “And its firing?”
5. Say “Search glazes for”, then supply a saved glaze name when asked.
6. Say “New note I need to make 25 soy sauce dishes in B-Mix clay.”
   Try “Add sapphire to that.” The original draft must remain; nothing saves.
   Dictate a complete correction, review it, then explicitly save or cancel.
7. Confirm words remain visible and listening resumes. Try a typed request too.

Real-device acceptance remains pending. Preserve accepted 4K.2 as the rollback.


## Phase 4L.1 — saved note follow-up repair
User accepted everything tested except “Add in Sapphire Float” after saving a note.
This slice retains an owner-bound, five-minute saved-note reference in memory.
Natural additions to that note create an update preview; explicit save updates the
same row with an owner/body compare-and-swap. Titles and other notes are preserved.
Cancel, expiry, changed/deleted notes, account isolation, navigation, duplicate
confirmation, full corrections, and starting a different note are protected.
No new Piece/glaze inventory mutations or aesthetic changes. Production untouched.
Regression tests include actual HTTP/website hands-free save → append → save →
visible updated note. Real-iPhone acceptance still required for this repair.
Test: create/save a note, say “Add in Sapphire Float”, review the combined text,
say “Save note”, verify one updated note and resumed listening.


## Phase 4L.2 — real-device natural studio-plan note repair
4L.1 did not pass real-device acceptance: user reported four attempts and showed
correctly recognized “Make 30 soy sauce dishes in dark horse clay” rejected as
unsupported. This repairs intent handling, not acoustic recognition. Bounded
physical pottery plans (make/throw/trim/decorate + quantity + pottery form) can
become exact-text note previews without memorizing a new-note prefix. No record
creation or save occurs until explicit confirmation. Same behavior during note
collection. Existing saved-note follow-up repair preserved. Added negative cases
for record mutations and actual HTTP/website flow for the reported wording.
Production remains untouched. Real-iPhone retest required.
