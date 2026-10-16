# Quantum Leap continuation — October 15, 2026

## Completed

History browser gate fixed at 8922a6b381b7a84a6f4c6199a1084adea3a7794b. The old Chromium --dump-dom preflight timed out and returned process exit 0, falsely appearing successful without executing layout assertions. The replacement uses Playwright (as Search already does), explicit desktop/iPhone viewports, isolated contexts, page-error assertions, and hard failure on unavailable browsers. Executing it also exposed missing session globals in the extracted renderer fixture; those are now supplied. Desktop 1280x900 and iPhone 390x844 both passed. No product runtime/UI change.

Native source/test/config files reconstructed from the available local snapshot and verified byte-for-byte against GitHub blob hashes at native commit 6b78948c0aa6511742e17d07954cd35dac9b0a6d. Store marketing images and unused branding files missing locally were not reconstructed; this is not a complete signed-build checkout. Approved Clayton assets matched and were unchanged.

## Actual new test results

Node 22.23.0:

- Native `node --test tests/*.cjs tests/*.mjs`: 922 passed, 0 failed, 0 skipped. This includes android-parity.mjs in addition to the prior checkpoint's *.test.mjs selection, explaining the count increase from 907. Covers Search/Photo Lookup, isolation, sharing confirmation/ambiguity/cancellation, saved settings, and simulated recognition/speech timing including extended silence.
- Backend `node --test tests/ql-assistant*.cjs tests/ql-photo*.cjs tests/ql-studio-search*.cjs tests/ql-home-integration.cjs`: 947 passed, 0 failed, 0 skipped. Search Chromium desktop and iPhone-width checks passed. Covers backend conversational editing, sharing, preferences, voice/session behavior and photo/search authorization.
- Backend History browser/DOM plus staging snapshot/startup: 40 passed, 0 failed, 0 skipped. Includes 8 snapshot/startup safeguards. These are local fixture tests, not live backup/restore/restart proof.

Browser runs used CHROMIUM_PATH=/tmp/ql-chromium and the runtime Playwright module.

## Remaining blockers

Render browser sign-in succeeded using the owner's selected existing Google account. Existing service srv-db83ccaj9qps73bg41f0 remains Free, auto-deploy off, live at d4f76e4. Its Shell page explicitly refuses access on free compute. Connected tools likewise cannot execute a host export. Existing HTTP CSV export routes do not constitute a full database/media snapshot. No live export, disk attachment, upgrade, deployment, restoration, or restart was performed. The owner's requirement to verify all staging data before any change remains a hard gate. A supported provider-assisted export/access route is required before upgrading this ephemeral instance; do not restart it to obtain access.

EAS CLI installed and `eas whoami` reports Not logged in. Current CLI supports `eas login --device --non-interactive` and a resume request; a secure device authorization was initiated. No credentials requested in chat, no signed builds or installation links yet. Once authenticated, restore missing build assets from the verified native commit and use only ql-integrated internal distribution, preserving application identities and existing TestFlight 49.

No physical devices attached. Automated tests do not prove real microphone, OS contacts/composer, installed voice inventory or installation behavior.

Production member data, production services, TestFlight 49, application identities, approved Porcelain After Dark UI and six avatars were not modified. No store submission, OTA update, production merge or founder acceptance request.
