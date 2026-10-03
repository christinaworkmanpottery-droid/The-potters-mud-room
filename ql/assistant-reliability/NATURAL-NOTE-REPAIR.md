# Phase 4K.2 — natural note wording and recoverable unclear commands

Base: bb81e2b58ed1c79e3efa0122e8432ad586dd1cab.
Christina reported saying: “New note I need to make 25 soy sauce, dishes,
and B mix clay save note”. The screen showed only “Play save note” and
an unsupported response. She explicitly requires flexible everyday phrasing.

Verified defect: “New note” was not a supported note prefix. The previous
grammar required add/create/make. An unsupported follow-up also cleared a
pending note. The screenshot alone cannot establish why Safari delivered
only the tail of the utterance.

Changes:
- Parse a family of note requests, including new note, take/write/start a
  note, jot/write this down, modal and first-person requests, and polite
  prefixes. Keep the body, number, material spelling and punctuation exact.
- Natural confirmations such as “Okay, save it please” work only with a
  current owner-bound note draft. Polite save/cancel forms are accepted.
- Short unclear save-like utterances request clarification and preserve a
  valid draft; missing drafts are explained without inventing content.
- Unsupported commands during a pending draft ask for clarification.
  Explicit unsupported writes still fail closed and invalidate as before.
- Inline save is separated from the body; the established readback and
  subsequent confirmation remain. No unseen draft is automatically saved.
- The visible testing label is 4K.2.

Local validation: 27 new real-SQL tests pass, including the exact utterance,
17 note prefix variations, natural save/cancel, ambiguous speech recovery,
foreign/stale context, duplicate writes and provider forgery.
The existing full website + HTTP + SQLite simulated-speech integration
also exercises the reported sentence, unclear follow-up, retained preview,
exact saved text and subsequent hands-free navigation.
Run the existing GitHub assistant/search and strict foundation gates before
deploying. Automated events do not establish real iPhone acoustic accuracy.

Scope: ql/phase-4k-voice-reliability, then fast-forward only the existing
ql/phase-4f-assistant-safari-acceptance branch after passing verification.
Render service srv-davicepsrm7s73c4ga0g in tea-d6it8hcr85hc73c5rtog.
Production/main and mobile releases remain untouched.
No new paid provider or service. Browser transcription remains unchanged;
this fixes language handling after transcription, not all speech errors.

Real-device acceptance remains open. Use the original sentence naturally,
review the complete draft, and confirm aloud. If the screen again receives
only a tail, capture that evidence for the speech layer rather than calling
this an accepted microphone fix.
