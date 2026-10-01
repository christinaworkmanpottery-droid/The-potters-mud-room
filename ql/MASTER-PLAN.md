# Quantum Leap master scope

Consolidated from Christina's September 27–28 approved scope, recovered conversation context and September 29 Phase 0 instruction. This is a scope consolidation, not a verbatim transcript. Existing PROJECT.md is a historical early proposal and must not override current code, pricing or these requirements. Detailed implementation phase assignments beyond Phase 0 remain proposals until approved.

## Product direction

Evolve The Potter's Mud Room into a coherent Studio + Community + Business product. Reuse the existing application, accounts, subscriptions and records. Pieces are the center of a piece's history. Connect Pieces, Clay, Glazes, Raw Materials, Test Tiles, Firings, photos/results, Pricing, Sales, Contacts, Events and Community with durable provenance rather than disconnected copies.

- Full manual workflows first. Manual Mode is complete, not a fallback.
- A reversible, user-controlled **QL Future** switch eventually enables the approved futuristic experience: voice, Esme, connected interactions and visual recognition. No automatic forced transition.
- Voice-first interaction with full manual parity and visible manual controls.
- Esme/intelligent assistance grounded in the user's permitted records and studio history; replaceable model/provider architecture rather than permanent dependence on one vendor.
- Improved Photo Lookup that can use piece context and results. Preserve the existing working lookup until a measured upgrade is verified.
- Raw Materials becomes a major section; connect recipe ingredients and inventory carefully without losing typed historical names.
- Interconnected Test Tiles, Firings, Pricing and Sales; preserve photos, results, dates, costs and original relationships.
- Powerful cross-record Search; studio memory and provenance, with ownership and visibility boundaries.
- Ask a Potter, community and private-group concepts; preserve private content and explicit sharing controls.
- Modern Porcelain-style redesign rather than terracotta/beige pottery clichés. Adaptive phones, tablets, foldables/two-pane layouts and desktop experience.
- Future Apple/Duo form factors and Mac/computer experience.
- Narrow CarPlay feasibility investigation for Contacts and Events: Call, Message and Directions. Feasibility investigation is not a promise of platform support.
- Find a Potter remains city/radius only, explicit Public plus discovery opt-in, no precise home-location collection.

## Execution order and constraints

### September 30 roadmap reconciliation and resumption

The current `Quantum_Leap_Master_Tracker.xlsx` (Quantum Leap folder, September 30)
uses the following master phase numbers. Do not confuse these with the historical
engineering branch/slice numbers, especially completed engineering Phase 3A–3H.

| Master phase | Scope | Current development interpretation |
| --- | --- | --- |
| 0 | Baseline / architecture / isolation | Complete |
| 1 | Relationships / safety / synchronization / integrity | Complete; retain gates |
| 2 | Connected Studio foundation / media / manual workflows | Foundation source work complete; preserve contracts |
| 3 | Search + Photo Lookup 2.0 | Next unfinished phase; Search-1 API started here |
| 4 | Wedgie / Esme intelligence + Voice | Future; candidate Wedgie name is not final |
| 5 | Manual Mode + QL Future + Porcelain redesign | Manual foundation exists; full UX remains |
| 6 | Adaptive / foldable / Duo / tablet | Future |
| 7 | Community / Ask a Potter / business tools | Existing features partial; Studio Finds/Potter Picks required for launch |
| 8 | Mac/computer + narrow CarPlay feasibility | Future |
| 9 | Migration readiness | Recovery groundwork done; final migration gate remains |
| 10 | Independent testing | Engineering verification continues throughout development |
| 11 | Member testing / refinement | After meaningful product milestones and engineering gates |
| 12 | Production replacement | Separate explicit release authorization required |

Christina's September 30 instruction authorizes resuming development from the
next unfinished master-roadmap phase. Broad physical validation is paused, not
marked passed and not a prerequisite for further isolated feature development.
See `TESTING-MILESTONES.md`; it supersedes earlier immediate-manual-test handoffs.
Search-1 is one bounded backend slice, not completion of master Phase 3. Preserve
existing Photo Lookup until a measured improvement passes a labeled evaluation.

1. Phase 0: audit current systems; pin baselines; isolate work; document data relationships, reuse and risks; verify and commit. No new QL product features.
2. Propose and approve small relationship/model and manual-workflow chunks before intelligence, voice or visual redesign.
3. Implement and independently verify each approved chunk in isolation; preserve compatibility with existing clients.
4. Rehearse migrations and recovery, verify parity and platform behavior, then obtain explicit approval before any production switch.

Keep the current website, iOS and Android stable. Preserve user IDs, password hashes, provider identifiers, entitlements, records, photos, storage references and ownership. Reuse existing app identities/signing for eventual releases; no new unrelated Google Play product. Native sandbox identities, if needed for side-by-side development, must be explicitly separated from release identity.

Each chunk: build → test/verify → commit and push → concise checkpoint → next approved chunk. Stop safely at checkpoints. Keep completion reports short; record full details in the repository. Do not work ahead. New ideas enter this list/backlog rather than the active phase. Approximate conservative QL reserve agreed September 28: $300 beyond existing services/subscriptions; this is a planning reserve, not automatic authorization to buy infrastructure or consume it.

## Known carryover items — not Phase 0 implementation

- Website/iOS Admin top tabs and App Usage taps; accurate paid-member counts/status and removal of identified test-member display through a separately reviewed task.
- iOS Find a Potter availability requires a verified native build; shared source alone does not update installed iOS.
- Android device retests and store purchase checks remain distinct from static/mocked tests. Existing September 26 repair documents are retained in the mobile repository.
- Messages/conversations deletion was deferred to QL; schedule explicitly.
- Photo Lookup ranking on light/plain pieces needs a labeled evaluation set before changing scoring.
- Earlier shopping-list/deletion and other device issues must be checked against current source and device evidence before marking complete.

No new ideas added or features implemented in Phase 0.
