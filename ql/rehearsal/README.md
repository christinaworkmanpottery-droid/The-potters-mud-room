# Disposable pre-release recovery rehearsal

This is test tooling, **not a production backup/deployment command**. Phase 3 remains closed.
Original baseline: backend `4f570ec1c3d63f2fc35be94ca7f2f5f4bc532d0a`.
The Admin demographics maintenance slice changes only that route authorization check.
Mobile queue/editor source checkpoint is `7ab57c662daa2c8d97cfbd9a3cc454bbe2cd1a8e`.

## Execute in isolation

Use a new disposable checkout on `ql/pre-release-recovery-rehearsal`, Node 22, the committed
lockfile (`npm ci`), FFmpeg, and Poppler (`pdfinfo`, `pdftoppm`). Do not copy a deployment's
configuration, credentials, database, uploads, or devices into it. The checkout must contain
no `data/pottery.db`. On the **disposable checkout only**, create `.rehearsal-checkout` containing
`synthetic-only-v1`, then run `NODE_ENV=test node ql/rehearsal/run.cjs`.
There is no DB/media/production-path argument. All database paths are generated under mkdtemp.

The actual child entry point is `node server.js`. NODE_OPTIONS loads a test-only preload:
loopback-only ephemeral listener; denied network clients, DNS except literal loopback,
UDP, fetch, and subprocesses. Child environment is an allowlist (PATH, NODE_ENV=test,
PORT=0, generated JWT secret, preload). No production environment is forwarded. Six positive
isolation probes must fail closed; application execution must make zero outbound attempts.
This is process-level integration isolation, not a claim of a hostile-code OS sandbox.

Dependencies are installed once with npm ci in the disposable source checkout and shared by
fixture children. Matching tracked release files are copied, excluding data, secret-file
patterns and generated evidence. All mutating helpers require generated paths. Photo startup
completion is observed explicitly before comparisons; merely listening never marks success.

## What the rehearsal does

- Truly empty first startup; all source-schema columns, 13 Forum categories, three admin docs,
  six blog posts, one email-history seed and seven photo migration markers; real password
  registration/login, authenticated reads and fresh restarts.
- Supported historical pre-QL fixture with the four old compatibility shapes. Exact offline
  restoration precedes startup. Schema additions/rebuilds, source seeds (including generated
  seed IDs/timestamps), tier normalization and photo signatures are classified explicitly.
  Existing rows otherwise compare exactly. `migrate(db)` runs only after compatibility init.
- Current QL two-owner fixture, overlapping names, all representative relationship/media
  categories, repeated/sparse/manual layers, financial/account values, Contacts and Shop.
- Full paired cold backup, manifest-gated clean staging, exact read-only offline validation,
  restored startup and two restarts. Complete rows/schema/indexes/triggers/ledgers are compared.
  All media bytes and modes remain exact. Login changes only last_login.
- Actual HTTP plus JSDOM wired to the restored HTTP server: read-only Clay/Glaze View,
  manual-only absence, repeated layer launchers, late-response rejection and protected media.
  Existing comprehensive Phase 3 DOM suites additionally cover foreign/dangling View rules.
- Stored-tier matrix including free/starter/basic/mid/top/promo/NULL/unknown and missing account,
  Test Tile routes/linking/History redaction; normalization retains qualifying access.
- Forum image/video/HEAD/range/parent binding, block variants and restart-lost playback grants;
  Shop active/inactive images, merchant access, two purchasers, pending/completed orders,
  uploaded original, tracked authoritative built-in original and real public preview.
- Separate malformed/corrupt/partial/missing/orphan/conflicting/schema-drift/permission copies,
  manifest rejection, retained quarantine, corrected clean restore. Four individual invalid
  post-QL historical table definitions are intentionally injected into disposable copies;
  application startup must refuse without any row/schema mutation. No repair is added.

Images are decoded with Sharp; the synthetic MP4 is decoded by FFmpeg; tracked original
PDF and tracked preview are inspected and rendered by Poppler, then decoded with Sharp.

## Evidence and results

`evidence/report.json` and `report.md` record the tested tooling commit, source checkpoint,
runtime, named checks, startup/login diffs, fixture versions, manifest hashes, relationship
audit, entitlement matrix, failure outcomes and source blockers. `*-manifest.json` contains
paths/sizes/SHA-256/modes; `*-baseline.json` contains complete synthetic schema/rows/ledger state.
Generated secrets/passwords/tokens are not written to evidence. Synthetic password hashes remain
in row baselines to prove preservation. CI uploads these files as `disposable-recovery-evidence`.

Existing backend verification: 1,314 assertions (1,077 TAP plus 237 standalone checks),
strict Phase 1 37/37, editor preservation 95/95, initialization 53/53; Phase 2, Phase 3A–3H,
History, Contact/Event and Calendar/iCal included. Reused mobile editor/queue suite: 64/64;
no mobile changes or real-device queue access. Application/client source and test blobs used
for that run match the supplied mobile checkpoint. Full mobile rerun is not required because
mobile source/tests are unchanged.

Local root-only execution cannot spawn a non-root child (EINVAL). That assertion is explicitly
BLOCKED locally, not skipped or passed. The exact-head Actions job runs as the hosted non-root
runner and must execute media fetch + write-permission probes, restore permissions and recover.
CI requires every named rehearsal check to PASS with zero incomplete checks; source-level
release blockers below keep the **release/recovery acceptance decision BLOCKED** independently.

## Confirmed source blockers — no runtime fixes in this slice

1. **Resolved in the Admin demographics slice:** the route uses established `isAdmin(req)`
   authorization with no schema changes. Fresh-state rehearsal now requires admin success,
   ordinary-user 403, and unauthenticated 401 instead of the former missing-column 500.
2. **Resolved in the Shop release-asset slice:** the original is restored byte-for-byte
   from `643cd0f5b5f26949d0d550f009ebe5eb1c2311f0` and tracked at
   `public/shop/the-potters-mud-log.pdf`. See `../shop-release-asset.json` for provenance,
   path, size and SHA-256. Clean-checkout validation runs before install/startup; fixture
   setup verifies the hash and never generates the original. Release/capture manifests
   include it naturally among tracked files. Restore semantics are unchanged.
3. Source-specific startup assigns `stripe-monthly` despite the fresh `billing_period`
   CHECK permitting monthly/yearly/promo. Reproduced in a separate synthetic account copy.
   The SQLite build's read-only integrity_check returns ok while a writable-handle read-only
   PRAGMA reports `CHECK constraint failed in users`. Exact offline state and explicit field
   assertions remain necessary; read-only integrity alone is insufficient. A separate approved
   maintenance audit must resolve the existing assignment/schema incompatibility, not redesign tiers.

## Known limits

Stateless JWTs remain valid under signature/expiry after restart, logout or replacement login;
client generations can reject stale responses, and Forum grants are memory-only. Global /uploads
is deliberately unchanged and unrestricted; record-aware endpoint checks are not blanket privacy.
Some source initialization exceptions are swallowed. No rollback-generation marker or new
create-idempotency protocol exists: same-account valid stale queued work can replay after rollback.
Mobile SQLite, AsyncStorage and queues are not in the server generation. No real device is connected.

Source points to `/opt/render/project/src/data` for persistence, but cannot establish snapshot
consistency, retention, restore behavior, disk capacity, live contents or capture of off-disk release
assets. These remain release-time infrastructure unknowns. No Render/production access occurred.
