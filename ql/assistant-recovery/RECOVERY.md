# Studio Notes voice recovery — October 5, 2026 UTC

## Verified baseline and limits

Last explicit real-iPhone acceptance available: Phase 4K.2, ac35a23fb3610afab6c85782e86fe59ecdd5243a. Render deploy dep-db0ah1s9v7es73aju88g was live from October 3 07:03 UTC. The user subsequently reported a briefly working state followed by regression, but the available records do not identify that later state unambiguously. Do not invent that checkpoint or declare all later changes guilty.

Inspected staging: srv-davicepsrm7s73c4ga0g, workspace tea-d6it8hcr85hc73c5rtog, https://potters-ql-phase4f-safari.onrender.com. Prior deployed SHA d97b0a83d459a7015c5c763bae676bcfb9dfa168. Auto-deploy off. Production/main and mobile/TestFlight excluded.

## Every subsequent commit inspected

| Commit | Change and recovery decision |
| --- | --- |
| 173dc09 | Flexible read commands/context; retain to preserve navigation. |
| 47536fc | Block unresolved write-target confirmation; retain safety. |
| c31e903 | Confirmed saved-note append and owner/body comparison; retain. |
| 1173f95 | Stop-listening assertion only; retain. |
| 8340102 | Natural physical pottery plans become previews; retain. |
| cef6229 | Keep saved-note focus after duplicate saves/unsupported turns; retain. |
| 6af729a | Separate destination from addition text; retain. |
| 3aab946 | All implicit continuations become fragments; reproduced normal split-dictation save blocking. |
| 7606e3a | Explicit replacement test only; retain. |
| 61f059b | Backend accumulation repairs split dictation; retain. Browser continuous=true and 1.5-second endpoint timer changed accepted capture lifecycle; revert browser portion. Removed live note preview; reproduced regression and restore. |
| d710438 | B-Mix clarification variants retained. Default-on speech output makes an unavailable audio service stop a previously usable default session; reproduced and restore explicit opt-in. Spoken replies remain available. |
| d97b0a8 | Spoken HTTP test completion; retain with explicit opt-in. |

## Reproductions and bounded restoration

Identical local SQL/core probe, initial draft `New note Make 40 soy sauce dishes in terra-cotta clay`, then `fire at cone 04`, then `Save note`:
- ac35a23: saved only `fire at cone 04`. This is a pre-existing fragment-overwrite defect despite successful single-utterance device acceptance; a wholesale rollback would restore it.
- 3aab946: retained original draft but blocked save awaiting append/replace choice. This establishes the save-blocking regression introduced by the fragment protection.
- 61f059b: saved the complete combined sentence. Retain this isolated backend fix without its larger browser capture change.

The new recovery client tests fail against d97b0a8 for default-session continuation without speech synthesis and live interim note preview. Both pass after restoration. The continuous-recognition change is reverted to accepted behavior as a precaution; an exact acoustic causal claim is not established by these tests.

Browser source restored from ac35a23, with only recovery label and accumulated draft display limit retained. Thus hands-free orchestration, recognizer release, interim preview, cancellation, and optional spoken replies follow the accepted browser design. The assistant restarts recognition between utterances; users still activate only once.

A new end-to-end phrase test exposed material-first and interior filler wording rejection. A three-line classification-only adjustment handles those variations without rewriting saved text. No provider changes, new capabilities, new paid service, or data migration.

## Verification and release gate

Node 22.16.0, matching CI major; isolated disposable SQLite and HTTP fixtures; no live user data. Run:

```
node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-assistant*.cjs tests/ql-studio-search.cjs tests/ql-studio-search-dom.cjs tests/ql-studio-search-http.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
```

Existing prior suite baseline: 659/659. New recovery scenarios cover all three user phrases, filler words, singular/plural, word order, next-turn dictation, split sessions, exact cone 04/B-Mix preservation, number-only fragment protection, correction, note additions, real UI display, real HTTP save, SQL persistence, canonical API re-read, duplicate-save prevention, and recognition restart after every turn. Existing tests remain; expectations for deliberately reverted continuous mode, default audio, and interim preview now assert the accepted behavior. Audio integration tests explicitly opt in and still prove readback and listening handoff.

Automated recognition callbacks are not actual recorded speech or a real iPhone microphone. These tests prove downstream handling of transcripts, not acoustic accuracy. Real-device acceptance is not claimed. No new iPhone test is requested before all automated gates pass.

Final local gate: assistant/search 662/662; strict foundation 37/37. CI must also pass on the exact recovery commit before staging deploy.
