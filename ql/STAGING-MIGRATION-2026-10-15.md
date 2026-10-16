# Staging preservation checkpoint — October 15

Implemented `ql/staging-snapshot.cjs` to preserve SQLite records and uploaded media before the existing ephemeral preview is migrated. It uses SQLite's backup API (including committed WAL records), validates database integrity/foreign keys, hashes all copied files, rejects symlinks, rejects production URLs, and never overwrites an existing snapshot. A failed snapshot is removed. This utility is not a live backup service or proof of deployed durability.

## Operator procedure

1. Obtain shell access to the existing staging instance without redeploying it. Stop application writes, including background writers. Merely setting the flag below does not stop the application. Do not suspend/restart an ephemeral instance to achieve this.
2. Copy this standalone script to that instance without a deployment. With its existing dependencies available, run:

   ```sh
   APP_URL=https://mudroom-ql-integrated-oct14.onrender.com QL_STAGING_WRITES_STOPPED=1 node ql/staging-snapshot.cjs backup data /tmp/ql-staging-snapshot
   node ql/staging-snapshot.cjs verify /tmp/ql-staging-snapshot
   ```

3. Transfer the complete snapshot off the ephemeral instance into private storage and verify the transferred copy. It contains account data and must never be committed, publicly uploaded, or exposed through an HTTP route. Do not print its contents.
4. Only after the off-instance copy is verified, attach the prepared persistent disk to the isolated staging service. Restore the snapshot's `data` contents while the application is stopped, before allowing initial startup to create a fresh database. Do not overwrite an existing populated database. The Render connector in this session cannot attach a disk, change the service plan/start command, or execute shell commands; these operations remain blocked.
5. Use the existing mount-checked staging start command and Blueprint. Verify authenticated records and uploads, then redeploy and verify those same records/media again. That final test is required before claiming durable storage.

## Actual results

Node 22.23.3: `node --test tests/ql-staging-snapshot.cjs tests/ql-durable-staging.cjs` — **8 passed, 0 failed, 0 skipped**. Covers database/media preservation, corruption detection, committed WAL records, production/unpaused rejection, overwrite rejection, symlink rejection, mount checks and credential isolation. Initial local dependency installation failed under Node 24; rebuilding the repository's dependency under Node 22 resolved it. No production dependencies were changed.

## Delivery remains blocked

- Native PR #3 remains at `6b78948c0aa6511742e17d07954cd35dac9b0a6d`. Its documented 907 passing tests are prior checkpoint evidence, not a new native run in this session.
- No EAS CLI/session or EXPO/EAS authentication variables are available in this session. Plugin discovery returned no Expo/EAS integration. Signed APK/IPA installation links have not been produced.
- No physical devices are connected. Continuous voice, corrections, interruptions, contacts and native installation remain unverified on devices.
- Render read confirms `mudroom-ql-integrated-oct14` is still free and auto-deploy is off. No existing staging data was exported or migrated in this session; no disk was provisioned. Provisioning incurs hosting charges.
- No production, store, OTA, or TestFlight changes were made. These utility-only changes do not touch approved UI, avatars or member-facing runtime behavior. Owner acceptance is not requested.
