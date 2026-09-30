# Pre-release Events/Contact first-start initialization

Branch: `ql/pre-release-events-contact-initialization` (backend only).
Authoritative remote parent: `5284f208d8b6b35e393c0838a560316cdc4ffabf`.
Phase 3 remains closed. Production untouched. No recovery rehearsal begun.

## Exact correction

Move the existing `safeAdd('events', 'contact_id', 'TEXT')` after Events CREATE TABLE and its existing indexes. Move the four existing Contact safeAdd calls (role, address, instagram, website) after Contacts CREATE TABLE and its existing index. Keep sales.contact_id where it was. No other runtime changes.

All five remain nullable TEXT with NULL defaults and no new foreign key. Existing indexes, relationship semantics and API handlers are unchanged. The existing safeAdd duplicate-column handling remains unchanged; repeated startup completes without surfaced duplicate-column errors. No schema redesign, substitute fields, data rewrite, backfill, media migration, filename change or /uploads change.

The original parent was reproduced on a disposable database: all five columns absent after first initDB, present after second initDB. Corrected initDB produces all five immediately on the first call, independently of server startup. The full fresh server also passes Contact/Event HTTP checks without a preparatory initDB or second start.

## Compatibility and API evidence

53 new regression tests in `tests/ql-events-contact-initialization.cjs`:

- Five fresh initDB column checks verify type, nullability, NULL defaults, uniqueness and unchanged lack of Contact foreign keys.
- 32 disposable existing-install shapes cover every present/missing subset (including all present and all absent). Each contains historical Contact/Event records, timestamps and media metadata. Missing columns are repaired with NULL; existing values remain exact. Abort-on-UPDATE/DELETE triggers prove no Contact/Event row rewrite. Existing indexes/triggers remain exact. Three further startups per fixture preserve complete schema, rows, integrity and FK checks.
- 16 API checks cover first-start basic Contact create/list/detail; each optional field create/read/update/NULL or empty clear; full values across init; owner-scoped reads and unchanged foreign/missing mutation no-ops; Event reads/writes/dates/times, stored links, counts/detail queries, detachment, inconsistent-reference deletion refusal, ownership and deletion; and Contact-independent iCal export/feed across init. Only generated DTSTAMP is normalized in cross-request iCal comparisons.

Existing semantics, not a new linking feature: Event POST/PUT do not consume contactId/contact_id. Tests explicitly prove those inputs remain ignored, and an existing stored link survives an Event edit (including an attempted API clear). Persisted-link fixtures use disposable SQL to exercise the existing Contact count/detail consumers. Event contact_id is legacy TEXT without a Contact FK: missing/foreign stored pointers are not rewritten or newly constrained. Contact detail stays owner-scoped; foreign Events do not enter another owner's Contact detail. Deleting an owned Contact detaches its same-owner Events; inconsistent foreign references still reject deletion atomically with 409. No Event→Contact detail endpoint or relationship editor was added.

## Snapshot and verification

`ql/schema.json` now reflects the first complete fresh server startup. Exactly Contacts and Events differ: the five approved columns are added, with consequent Events column ordinal shifts; all other column definitions, FK definitions and tables are unchanged. The historical safety fixture no longer manually adds four Contact columns already supplied by the snapshot; its tests are retained.

Node 22 (matching CI) with the existing lockfile/dependencies:

- New initialization/Contact/Event regressions: **53/53**.
- Complete backend/QL: **1,314 passing** (1,077 TAP + 237 standalone checks).
- Strict Phase 1: **37/37**.
- Phase 2 protected-media contracts: **PASS**.
- Phase 2P Event media: **43/43**, owner-scoped/protected media and existing filename/upload behavior preserved.
- Phase 3A–3H regressions: **PASS**.
- Editor-preservation backend/web: **95/95**.
- Complete existing Calendar/iCal checks (unit, website API/DOM and Event media API), plus new initialization comparisons: **PASS**.
- Final failures/cancellations/skips/TODOs: **0/0/0/0**.

Commands: `node ql/verify-phase1.cjs`; `QL_READINESS_STRICT=1 node --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs`. The full gate includes its existing synthetic recovery regression file; this does not begin the separately scoped recovery rehearsal. New tests are included in the full gate and the branch is included in the GitHub Actions push trigger. Exact-head Actions result is reported with the completion commit.

During test development, the container default Node 24 was incompatible with existing Node 22 native dependencies; verification used Node 22. Initial test data was corrected to satisfy existing website validation, and generated iCal DTSTAMP was excluded from cross-request equality. No runtime behavior was changed to accommodate these test issues.

Mobile: no source, documentation or commit change required. Existing mobile checkpoint remains `7ab57c662daa2c8d97cfbd9a3cc454bbe2cd1a8e`; no new mobile Actions run is claimed.

## Exact next recommendation — not started

Next authorize **isolated fresh-install and paired database/uploads recovery rehearsal, scope/audit first**, using this exact backend completion commit and mobile `7ab57c662daa2c8d97cfbd9a3cc454bbe2cd1a8e`, with `ql/RECOVERY-RUNBOOK.md` as the procedure source. Define synthetic representative fresh, supported existing and QL-installed fixtures; expected schema/rows/ownership/relationships and upload filename/hash manifests; cold paired backup/restore, interrupted-operation and repeated-start checks; stop criteria and evidence checklist. Preserve the five-column first-start contract, Phase 1–3 contracts and editor preservation. Approve the concrete rehearsal plan before execution. Do not use production data/services or deploy, migrate/backfill production, build native apps, send OTA or submit stores.

Limitations: this source/test maintenance is not a production migration, full operational recovery rehearsal, or physical-device/release validation. Those remain separate gates. Existing legacy Event Contact API limitations and historical TEXT pointers remain unchanged by design.
