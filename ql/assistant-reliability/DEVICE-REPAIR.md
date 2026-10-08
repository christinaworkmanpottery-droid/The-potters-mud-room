# Phase 4K.1 — real-iPhone note command repair

Base: cad210f85e4e5690050c915d88802b2b84f871d1.
Reported utterance: “Create another note I need to buy BMX clay save”.
Christina confirmed she said Bmix clay. Existing note parser rejected “another”.

Changes:
- Accept add/create/make another [new] [studio] note, with inline or next-turn text.
- Separate trailing save / save note / and save from new dictated note content;
  never treat inline save as confirmation of an unseen draft. Explicit replacement
  commands preserve literal text. A trailing “to save” remains note content.
- Standalone save confirms a current reviewed draft, never a Piece clarification.
- BMX followed by clay proposes B-Mix, but keeps the original full draft. Yes or
  “use B mix” selects the proposal and presents the corrected draft; a subsequent
  save is required. “Keep original words” preserves the literal original. Full
  replacement and cancellation remain available. No broad fuzzy substitution.
- Material clarification retains the preview and hands-free conversation context.
- Owner checks, expiring drafts, stale-context guards and duplicate-save protection
  remain in effect. No new AI provider, paid service or infrastructure.

Validation (Node 22): assistant/search suite 532/532; strict foundation 37/37.
Exact utterance exercised through website DOM, simulated speech callbacks, actual
local HTTP and SQLite, including blocked early save, correction, persisted text,
no duplicate save and subsequent navigation. These tests do not emulate microphone
acoustics or establish Safari speech-service accuracy.

Publish to ql/phase-4k-voice-reliability and fast-forward the existing isolated
staging branch ql/phase-4f-assistant-safari-acceptance. Production/main and mobile
remain untouched. Service srv-davicepsrm7s73c4ga0g, workspace
tea-d6it8hcr85hc73c5rtog; manual staging deploy only.
URL: https://potters-ql-phase4f-safari.onrender.com/#qlAssistant

Real-device acceptance pending: start one session, say the reported request. If
BMX clay is heard, answer yes, review the full corrected draft, then say save.
Confirm one correctly worded note and continued listening. Live transcription
still depends on the browser delivering interim speech results. This repair does
not promise universal transcription accuracy or unrestricted natural-language
command coverage.
