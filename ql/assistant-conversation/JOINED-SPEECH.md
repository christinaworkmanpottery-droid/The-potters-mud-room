# Phase 4I.4 — joined speech recovery

Real iPhone 4I.3 evidence: “Show me Blueface” returned unsupported. Extend the
existing bounded vase clarification to face and joined-word variants. Canonical
literal saved matches still win; suggested records require yes or an ordinal;
no-match requests do not invent a record. No speech engine changes.

When an unsupported open/show request occurs within authenticated Piece context,
ask the user to repeat the saved name or search for matches. This clears pending
suggestions, does not navigate, and does not turn write/permission/provider errors
into guesses. Known feature navigation keeps its normal priority.

Use shared provider-neutral core, opaque owner-scoped contexts and canonical APIs.
No new writes, visual changes, schema changes, or production/native changes.
Regression adds exact joined transcript, face variant, unknown-name recovery,
pending cancellation, valid feature navigation, and write rejection. Operator
staging smoke includes exact screenshot plus spoken-confirmation-equivalent turn.
Real microphone acceptance pending. Test marker: Conversation test 4I.4.

Retest: start once, “Show me Blueface” -> named Blue Vase confirmation -> yes opens
it. “Show me blurf” while in Piece conversation asks for the saved name without
opening anything. “Open blue bowl” remains valid afterward.
