# Phase 4J.1 — natural note-start dialogue

Real iPhone screenshot showed “Create new note about glazing” correctly heard but
rejected in 4J. Broaden add/create/make [a] [new] [studio] note wording. A bare new
note or “about <topic>” starts collection: ask what the note should say. The next
ordinary dictated sentence becomes an exact-word draft, never an automatic save.
Topic text is only used in the question, not invented as note content or title.
Direct “Add a note that <words>” / “Create a new note saying <words>” also works.

Reuse the bounded owner-scoped five-minute draft store, same confirmation and
canonical create operation. Saving before any text asks for text without writing.
Recognized command/control prefixes retain command semantics while collecting;
users may use the explicit “Add a note that …” form for content beginning with a
command word. Cancel, navigation, unsupported commands, expiry, account changes,
stop and restart preserve existing invalidation behavior. No new schema or writes
other than confirmed creation. No production or native changes.

Coverage: exact screenshot -> collecting -> premature save -> exact sentence ->
draft -> confirmed save; cancel; direct synonyms; foreign and expired context;
command handling; actual website/HTTP simulated-microphone three-turn dialogue.
Operator staging smoke includes exact screenshot, next-turn words, cancellation,
and verifies no extra saved record. Phase 4J is still awaiting device acceptance.

Test 4J.1: enable Spoken replies if audible prompts are wanted, start once, say
“Create new note about glazing”, then “Try three coats next time.” Readback should
match those words. Say “Save note” to save or “Cancel” to discard. Normal Notes UI
remains available. No need to repeat “Add a studio note that” before the sentence.
