# October 8 Studio Notes recovery

Scope: `ql/studio-note-recovery-gpt`, isolated `potters-ql-recovery-gpt` only. No production, website main branch, mobile, or TestFlight changes.

## Evidence and regression

The six October 8 screenshots were read through their extracted text (image pixels were unavailable). The observed deployed commit was `2bde54fec556c166cd1dd98a498857ff23607479`, Render deployment `dep-db3gdhrtqb8s73dt44n0`.

The repository's earlier recovery evidence identifies `ac35a23fb3610afab6c85782e86fe59ecdd5243a` as the last exactly pinned real-device-accepted Phase 4K.2 checkpoint. Later user acceptance exists, including October 7, but is not an independently pinned complete acceptance of the current branch head. We compared the accepted capture lifecycle and the immediate `8f4e2e7` parent against `2bde54f`; no wholesale rollback was used.

`2bde54f` introduced an untracked five-second timer that restarted recognition before sending captured words and bypassed low-confidence/interim review. This reproduced early listening, missing submission, and overlapping-turn failures. Separately, draft/save/cancel aliases were missing, natural requests beginning with Clayton were rejected, and correction/addition routes were restricted to saved-note targets. The concise speech change could omit the actual clay clarification question.

## Contained repair

- Restore serialized recognition -> request -> spoken response -> recognition, retaining the three-second quiet-final fallback and natural onend handling. No early restart while a request or speech utterance owns the turn; detach stale microphone callbacks before speech.
- Keep existing owner-bound, expiring collecting/draft/material-review/saved states. Interpret edits and controls before dictation. Save and cancel act on the active draft; reopening a saved note creates an editing preview bound to that database row.
- Natural new-note requests, draft aliases, literal remove/replace/insert/add, full replacement, and targeted conversational pottery corrections. Edits preserve the original saved target through confirmation and compare the original database body before updating.
- Treat V-Mix/B mixed/BM mix/BMX clay as uncertain, requiring clarification. Conversational corrections can target one known clay/form/glaze/cone span. Ambiguous or repeated targets are not guessed; cone 04 stays distinct from cone 4. Other note content stays literal.
- Save-like misrecognition `Safe draft` does not execute a save or enter the draft. Interim commands do not overwrite the displayed note. Concise speech retains the question needed to clarify clay.
- Add the recovery branch to the existing assistant CI workflow; auto-deploy remains off.

## Verification

Node 22.16.0 (CI Node 22). Synthetic SQLite and HTTP fixtures only.

- Deployed-head existing assistant/search suite: 675 passed, 8 failed, 683 total.
- New October 8 SQL/parser scenarios against deployed head: 2 passed, 21 failed.
- Repaired complete assistant/search suite: 709 passed, 0 failed. Includes the October 8 sequence through browser speech events, actual HTTP, canonical database save/re-read, same-row saved edits, and canceled edits.
- Strict foundation gate: 37 passed, 0 failed.
- New browser cases cover late recognizer callbacks during spoken output, queued restart during pending HTTP/TTS, command preview contamination, and low-confidence speech review.

Existing test expectations changed only for intentional behavior: active-draft additions now work; synthesis cancellation counts include the already-existing activation primer; concise speech is checked alongside the full corrected visible text. No tests removed or skipped.

## Limits

Automated speech events do not prove real-iPhone acoustics. Safari still supplies speech recognition; no new provider or paid service was introduced. Unsupported or ambiguous corrections ask for exact words. Turns retain the existing 200-character limit. Reopen/edit targets the current note in the active, expiring conversation, not arbitrary historical notes. No new real-device acceptance is claimed.
