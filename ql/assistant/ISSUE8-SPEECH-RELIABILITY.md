# Clayton speech reliability — Issue #8

## Acceptance checkpoint

The October 8 user-accepted recovery checkpoint is
`9d1083042e57f396ff246069a710c6034d818919` on
`ql/studio-note-recovery-gpt`. Render recovery deployment
`dep-db3soqbtqb8s73f8g7d0` served that commit before this patch.
User acceptance covers create, edit, add, replace/remove, save, cancel,
hands-free operation and spoken replies. Production and TestFlight are excluded.

## Bounded changes

- Normalize unambiguous spoken cone numbers only in pottery context, retaining
  leading zeros (cone zero four / oh four → cone 04, never cone 4).
  Format B mix clay as B-Mix clay. Do not change literal edit anchors.
- Offer confirmation for soy subs/saucer dishes and Sapphire flow glaze/float
  blaze, preserving the original when requested. Save does not approve a guess.
  Existing server-side B-Mix clarification retains priority, including its draft
  editing and cancellation workflows. Unknown materials and temperatures remain
  literal: this is not a comprehensive vocabulary or a new speech recognizer.
- A clear final result can supersede low-confidence interim hypotheses.
  Low-confidence finalized segments and incomplete speech still require review.
- After a dictation draft, reopen listening before speaking the acknowledgement.
  Wait three seconds for a continuation; sound or text cancels the acknowledgement.
  Continued dictation uses the existing server draft/context. Commands continue
  through the accepted parser. A quiet acknowledgement must await microphone
  disconnect; speech end/error/watchdog share one cleanup path.
- Keep the accepted native speech output, shorter prompts and confirmations.
  No paid speech service, voice preference change, or broad assistant rewrite.

## Verification

Use Node 22, matching the recovery GitHub Actions workflow:

```
node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-assistant*.cjs tests/ql-studio-search.cjs tests/ql-studio-search-dom.cjs tests/ql-studio-search-http.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

The browser/HTTP/SQLite integration still exercises saved-note edits and
cancellation. New event-sequence tests cover breathing-pause continuation,
quiet microphone release before TTS, stale callbacks, original-word retention,
uncertain-term review and confidence reconciliation. Browser speech-service
accuracy and actual acoustic timing still require the short real-iPhone check.

## Real-iPhone check — changed behavior only

1. Dictate a note with B-Mix clay, cone six, cone zero four, Sapphire Float glaze
   and soy sauce dishes. Check the preview; cone 04 must retain its zero.
2. Pause briefly after a sentence, then continue. Clayton should leave space to
   continue and retain both portions in the draft.
3. Dictate an ordinary reminder. Its words should remain intact. If Clayton asks
   about a mishearing, approve the correction or keep the original words.
4. Let a brief confirmation finish. Clayton should resume listening without
   adding his own spoken confirmation to the note.

## Following stage — not implemented here

Member-selectable warm masculine, warm feminine and gender-neutral natural
voices; previews before choosing; adjustable speech speed; change voice anytime.
Owner preference: a warm, natural masculine voice. Maintain concise speech,
natural turn-taking, reliable hands-free operation and all accepted workflows.
