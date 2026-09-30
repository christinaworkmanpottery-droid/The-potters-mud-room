# Pre-release Admin demographics maintenance

Baseline: eae703904eb226ee5374b1bdae217084d76e37bb.
Branch: ql/pre-release-admin-demographics. Phase 3 remains closed.

The only application change replaces the invalid `SELECT is_admin FROM users`
authorization query in `GET /api/admin/demographics` with `isAdmin(req)`.
The existing auth middleware, admin email/key contract, 403 body, selected fields,
ordering, summaries and response serialization remain unchanged. No schema,
migration, dependency, mobile, other admin route or production changes.

`tests/ql-admin-demographics.cjs` exercises the real HTTP route in three synthetic
states: genuinely fresh server startup, initialized database, and populated existing
database restarted through current startup. It uses random test-only JWT/admin keys
and the source-defined admin email. There are 42 assertions grouped in three parent
tests (Node reports 45 passing tests). Coverage includes empty responses, both admin
paths, 401/403 denial, invalid/expired credentials, forged privilege claims, current
email authorization, exact fields/NULLs/sorting/aggregates, private-account boundaries,
and schema/user-row preservation. The admin email is introduced only after startup
so this test does not exercise the separately blocked billing CHECK transformation.

The existing fresh recovery rehearsal now requires admin 200, ordinary-user 403,
and unauthenticated 401. Its temporary admin email is restored before restart to
preserve the rehearsal's original startup-transformation fixture. No drift allowances
were broadened. The two unrelated source blockers remain release blockers.

Verification commands (Node 22, committed lockfile installed with npm ci):

- `node --require ./ql/rehearsal/suite-isolate.cjs ql/verify-phase1.cjs`
- `QL_READINESS_STRICT=1 node --require ./ql/rehearsal/suite-isolate.cjs --test tests/ql-readiness-blockers.cjs tests/ql-safety-migrations.cjs`
- In a marked disposable checkout: `node ql/rehearsal/run.cjs`

The existing suite baseline is 1,314; including 45 new reported tests gives 1,359.
Strict gate: 37; initialization: 53; editor preservation: 95. Full recovery rehearsal:
113 checks. Exact-head Actions is the authoritative non-root permission verification;
its evidence artifact records all completed rehearsal assertions and source blockers.

Next recommendation only: package the intended original Shop PDF at the existing
`public/shop/the-potters-mud-log.pdf` path, using an approved original or verifying
the existing generator's output, then track the asset and add a clean-checkout
availability test. Verify completed-purchase downloads, pending/foreign denial,
preview access and direct-original blocking. Do not regenerate on startup/restore,
change fulfillment behavior, or remediate the billing CHECK issue in that asset slice.
No Shop asset remediation is included here.
