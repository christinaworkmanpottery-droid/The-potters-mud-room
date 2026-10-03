# Phase 4J.2 — complete dictation, visible draft and correction

Device evidence: after intending a sapphire-glaze reminder, the user saw a saved
note containing only “I've been”. Screenshot proves saved truncation but cannot
prove exactly what speech events Safari emitted. User also requested visible text
while speaking. Phase 4J remains unaccepted.

Found client stopVoice() on the first fully finalized result. In pending Note
collection/review only, wait for natural recognition end instead. Accumulate the
browser's cumulative results, including multiple final chunks; if trailing words
remain interim, do not submit the earlier final fragment. Existing watchdog and
single microphone ownership remain. Stop listening remains immediate. Ordinary
navigation voice handling and the accepted 4H restart flow remain unchanged.

A visible “Live note draft — not saved” region at the top of the voice panel shows
interim text as received; it is textContent, never HTML or a database write. The
server returns exact preview text after drafting, and the preview clears on stop,
account transitions, navigation/finished note. No automatic save. Recognition may
still end early or mishear; no promise of complete hardware recognition accuracy.

While a Note draft is pending, another ordinary sentence replaces it. “Replace
note with <full text>” / “Change note to <full text>” explicitly replace only an
unsaved draft; they cannot edit an existing saved note. “Buy sapphire glaze” is
note content in pending dictation, never a purchase. A few unmistakably unfinished
phrases (including “I've been”) refuse saving and request full text; this is a
bounded guard, not a general completeness classifier. Every replacement gets a
fresh pending identity and requires confirmation; old drafts cannot be saved.

Tests cover multiple final events, final+interim end, exactly-once submission,
live preview before requests, clearing on stop, actual site/API integration,
fragment no-write, corrected exact body, stale confirmation and cancellation.
Production and existing saved notes are untouched. Staging smoke verifies the
screenshot fragment is blocked and a corrected pending draft cancels without write.

Retest 4J.2: start once; “Create a note about sapphire glaze”; after microphone
ready say “I need to buy sapphire glaze for my next firing.” Watch the live draft.
Check full readback; if wrong, say “Replace note with I need to buy sapphire glaze.”
Only then “Save note”. Existing “I've been” record is not automatically changed.
Enable Spoken replies to hear prompts. Real iPhone acceptance remains pending.
