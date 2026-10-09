# Clayton Studio Notes management — October 9, 2026

Recovery-only release on `ql/studio-note-recovery-gpt`, service `potters-ql-recovery-gpt`.

## Implemented

- Whole-record delete intent precedes text-edit parsing. A single owner-scoped saved ID, title and body are reviewed; explicit yes consumes a short-lived confirmation. Changed records and repeated confirmations cannot delete another record.
- Short deterministic titles for new notes, retaining verbatim body and explicit titles. Voice rename and explicit `Generate a title for that note` for legacy untitled notes; no bulk rewrite.
- Title/content/date lookup, recent-note lists, duplicate disambiguation and record opening. Selected records reuse the established edit/add/save draft workflow. Relative dates use the browser IANA timezone, with UTC fallback for clients without it.
- Brief social responses preserve draft context. Goodbye ends the session. Cancel/never mind cancel pending work.
- Existing owner-scoped `contacts` table used for recipient lookup. Name, exact contact detail, role and saved relationship words can resolve a contact; ambiguous matches require a choice.
- Sharing prepares the saved snapshot only after note, recipient and method review. Changed note/contact data blocks stale confirmation. Email and SMS use compose links; native sharing uses `navigator.share`.
- A browser share card requires a tap, previews the content, and reviews the final address/method before launching. Contact Picker capability detection requests one selected contact and only relevant fields. Selected device data stays in the page and is never sent to the server or imported.
- Share cancellation, permission denial and failure never report delivery. Compose launch is a request, not confirmed sending. Native share resolution is also not treated as delivery confirmation.
- Existing recognizer start/end/error/recovery implementation is unchanged. The client adds record opening, share-card handling, social draft display preservation, and explicit handoff/session end behavior.

## Platform boundaries and separate native deliverable

Safari cannot provide general voice search of the phone address book. The website searches Mud Room contacts independently; on browsers lacking Contact Picker, the card supports a manually entered destination or recipient selection in the operating system's compose/share interface. Contact Picker and Web Share require user activation, so this browser handoff is not entirely hands-free. The microphone deliberately pauses on handoff; return to Clayton and start the session again.

Native iOS/Android contact selection, voice-resolved phone-contact search with appropriate permission, and native compose completion callbacks are **not implemented in this web repository**. They remain a separate native-platform deliverable requiring the mobile source project and isolated development build. No approved mobile build or production service is changed.

Existing speech readback is bounded to 300 characters; full note content is displayed when opened. No recorded acoustic or real-device validation is claimed by automated speech callbacks.

## Acceptance — one session after healthy deployment and passing gates

1. Say: `New note I need to make ring dishes in B-Mix clay with Sapphire Float and Tuscan Blue glaze.` Say `Thank you, Clayton`, then `Save note`. Confirm a descriptive title and unchanged content.
2. Say `Find my note about ring dishes`. Choose a number if needed. Say `Rename that note to Ring dish acceptance`. Add `Two coats`, then save. Check that the same note changed.
3. Say `Delete that note`, then `Cancel`. Verify it remains.
4. Say `Email my ring dish acceptance note to [a saved Mud Room contact]`. Select the contact, confirm the preparation, and inspect the card. Open compose and cancel there; Clayton must not claim it was sent. Device contacts use the explicit platform fallback.
5. Return and start voice. Say `Delete my ring dish acceptance note`, confirm yes, and verify that only this disposable test note disappears.

## Verification commands

Use Node 22, matching CI, and disposable fixtures:

```
node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-assistant*.cjs tests/ql-studio-search.cjs tests/ql-studio-search-dom.cjs tests/ql-studio-search-http.cjs
QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs
node --require ./ql/rehearsal/suite-isolate.cjs --test tests/directory-calendar.cjs tests/website-api.cjs tests/website-dom.cjs
```

Mocks cover recognizer callbacks, device contacts, and browser share APIs. The new integration test uses the actual website, HTTP handler and SQLite persistence with a synthetic user. It verifies continuing listening, selected-note opening, title/body display, rename, cancellation, deletion, and prepared sharing.

Local release results: assistant/search **783/783 passed**, strict foundation **37/37 passed**, website regression runners **3/3 passed**. Zero remaining failures. Node 22.16.0. Earlier local Node 24 native-addon/runtime failures were resolved by matching the repository's CI runtime; application dependencies were not changed.
