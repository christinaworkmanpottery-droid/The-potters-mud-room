# Cross-platform implementation checkpoint

Native draft: https://github.com/christinaworkmanpottery-droid/potters-mudroom-app/pull/3

Native commit: `c172b05c46f816b3f354a1bef7f352558714cd57` on `ql/integrated-native-20261014`, based on the existing Search-3 branch. Includes recovered Photo Lookup client work, authenticated native Home, six exact avatars, native speech/recognition coordination, preference persistence, confirmed on-device contact resolution and existing record access gates. See the native repository's `QL-INTEGRATED-2026-10-14.md` for scope and limitations.

## This companion change

- Adds bundled licensed studio photography to the existing optional Home image mode. Provenance: `public/images/ql-studio/CREDITS.md`. Does not replace member photos or change Minimal mode.
- Supplies the spoken recipient query in a server-confirmed device-sharing response. Phone address-book data stays on-device. Existing Mud Room contact handling and confirmation logic retained.
- Prepares a separate staging Blueprint and startup guard that refuses an unmounted data directory or production URL/credentials. Does not modify the root production Blueprint.

## Executed checks

- Backend: **2,161 tests passed; zero failed/skipped**, Node 22.23.3, `CHROMIUM_PATH=/tmp/ql-chromium QL_READINESS_STRICT=1 node --test --test-concurrency=4 tests/*.cjs`.
- Native: **902 tests passed; zero failed/skipped**, including Search/Photo Lookup and 20 new native coordination/sharing/login-isolation tests.
- Expo generated iOS/Android Hermes and web bundles. Config introspection verified microphone/speech/contact declarations; Android contact writing is blocked.
- Chromium using the native web export and real staging API: successful login, Home and Clayton rendering, saved avatar preference, typed firing query response, no page errors after fixes. Initial checks found and resolved a browser timer receiver failure and a pre-login sync/stale-401 race.
- `ql/render-integrated-staging.yaml` validates against the official Render draft-2020-12 Blueprint schema.

## Deployment and remaining gates

The live web preview remains at `d4f76e4`: https://mudroom-ql-integrated-oct14.onrender.com . Auto-deploy is off. This companion change is committed but **not deployed**. The new photo/device-query code is therefore not yet live on the web preview.

No production, OTA, native store or existing TestFlight build was changed. No signed APK/IPA was generated: the EAS CLI reports `Not logged in`. No physical iPhone/Android microphone, contact permission, voice inventory, interruption or sharing-delivery verification was possible in this runtime.

The current staging service is free and ephemeral. The prepared Blueprint upgrades that exact staging service to Starter and attaches 1 GB at `/opt/render/project/src/data`, covering SQLite and uploads. **It incurs hosting charges and has not been applied.** Preserve the current test database/uploads with a consistent backup before disk attachment/redeployment. Existing staging records have not been intentionally deleted. A mount guard is not proof of durability: the redeploy-persistence test still needs to run after provisioning.

Physical-device/upgrade regression, guaranteed voice-style availability, complete all-screen visual acceptance, durable hosting and signed native builds remain open. No overall completion percentage and no founder acceptance request.
