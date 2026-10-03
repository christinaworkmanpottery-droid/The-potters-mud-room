# Phase 4K — voice reliability hardening

Base: 0edfc78d6e2e8a0f1630c08120441754871c186c (accepted Phase 4J.2).
Branch: ql/phase-4k-voice-reliability.
Production and TestFlight untouched. Provider-neutral turn API unchanged.

Changes:
- Persistent top-of-panel live transcript for every hands-free utterance, followed
  by final “Heard” text. Existing note preview remains, with safe text rendering.
- All hands-free commands wait for recognizer disconnect, retaining cumulative
  final segments; no early stop after “Create a note”. Explicit stop command
  remains bounded. Tap-to-talk retains its existing behavior.
- Interim-only, low nonzero confidence (<0.6), and watchdog-interrupted turns
  require local review before any request. Say “use those words”, repeat the full
  corrected sentence, or “discard transcript”. Yes/save cannot bypass this review.
  The existing backend still requires separate confirmation before saving a note.
- Bounded unfinished-note guard also rejects trailing conjunctions/prepositions
  and “I need to buy”. No text is rewritten, no fuzzy auto-correction added.
- Review state clears with session/account lifecycle and manual navigation.
  Existing microphone ownership, restart, permission and hidden-page safeguards
  remain. Oversized utterances never submit an earlier prefix.

Validation: Node 22 (repository CI version), all 415 assistant tests pass,
including real local HTTP/SQLite and website integration. Node 24 native SQLite
crashed during initial local validation; no dependency or production runtime
change was made. CI branch trigger extended to this checkpoint.

Browser-event tests cover interim updates, cumulative final+interim segments,
low-confidence review, explicit acceptance/correction/discard, watchdog review,
no duplicate submission, no write for incomplete notes, corrected exact saves,
privacy clearing and uninterrupted hands-free follow-up. Source contract:
https://webaudio.github.io/web-speech-api/ (cumulative results and interim replacement).

Limits: real microphone acceptance is pending. Browser speech service controls
recognition and whether interim events arrive. Zero/missing confidence is unknown,
not evidence of accuracy. The fragment guard is bounded, not a semantic correctness
classifier. Each turn retains the existing 200-character limit. Nothing silently
saves note text; inspect the readback and say “save note” only when complete.

Staging service: srv-davicepsrm7s73c4ga0g, workspace tea-d6it8hcr85hc73c5rtog.
Service deploy branch remains ql/phase-4f-assistant-safari-acceptance; publish the
same checkpoint there (fast-forward only), manual staging deploy, verify live SHA.
URL: https://potters-ql-phase4f-safari.onrender.com/#qlAssistant

Real iPhone test: start once; say “Create a note”, then “I need to buy sapphire
glaze for my next firing.” Watch words live and check final readback. Correct with
“Replace note with …”, then “Save note”. Say “Open blue vase” without touching the
mic. In a new note dictate “I need to buy”, then “Save note”: it must refuse the
incomplete save. If speech review appears, use the displayed voice commands.
