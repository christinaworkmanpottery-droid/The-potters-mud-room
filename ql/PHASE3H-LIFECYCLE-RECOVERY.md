# Phase 3H — lifecycle and recovery closure

Branch in both repositories: `ql/phase-3h-lifecycle-recovery`.
Remote parents: backend `c8b86025998ee6fbae0fc0e494a289bb30293243`; mobile `965b43b82b22abf671cd860c2e33be404e9a7bf6`.

## Three blocker reassessment

1. Piece-origin Firing Edit now carries Piece/Firing/account/session/editor generation. A keyed editor boundary makes prior form state and record ID inaccessible on account/session replacement or navigation away. Canonical private-media session validity is checked before requests and after asynchronous selector loads, picker work, mutation/photo completion and error/navigation callbacks. Stale callbacks cannot save, hydrate, expire the replacement login or navigate it. Standalone create/edit, validation, photos and optional Piece selection retain their existing semantics. Intentional Piece-origin Edit remains available after authorization.
2. Website Pricing/Firing/Test Tile controllers retain a reconciliation requirement from mutation start until successful reread, including committed mutations with lost responses. Retry never replays the mutation: it replaces stale History containers and awaits current History plus relationship reads; Firing also reloads the canonical Piece legacy summary. Failed History recovery keeps Retry in reconciliation mode. Loading/busy and account/token/Piece/controller guards suppress duplicates and stale results. Locked tiles clear metadata and do not regain authorization through cached rows.
3. Piece-origin Firing/Test Tile viewers carry originating Piece ID, incorporate connectivity into keyed lifecycle identity, and invalidate old generations on every transition. Disconnect removes the protected viewer and its controls; reconnect requires the current Piece association and canonical owned detail before rendering. Test Tile reconnect rechecks database entitlement through protected endpoints. Known tier loss renders locked; re-entitlement does not restore cached detail. Distinct lifecycle identities prevent an old online response or Edit handler becoming valid again after reconnect.

Protected media retains Phase 2 routes and session rules. An optional caller scope on the existing Firing/Test Tile loaders gives these viewers/editor downloads their own temporary resources. Invalidation rejects and disposes late downloads; unmount releases completed scoped resources. Reconnect gets fresh protected media. Shared same-session cache resources remain untouched. No private /uploads fallback and no global media redesign.

## Verification

- New backend/web lost-response and stale recovery fixtures: 20/20.
- Complete backend/QL: 1,166 passing (929 TAP executions + 237 standalone checks).
- New mobile lifecycle/editor/viewer/media regressions: 50/50.
- Complete mobile: 673/673.
- Shared JavaScript parsing: 152/152.
- Strict Phase 1 gate: 37/37.
- Phase 3A–3G, Phase 2 protected-media contracts, Calendar/iCal: PASS.
- Final failures/cancellations/skips/TODOs: 0/0/0/0.
- No local EADDRINUSE; no stray test server. Initial full-backend invocation used shell Node 24 against Node 22 native dependencies and stopped before the suite; corrected to the CI-declared Node 22 runtime without a code/dependency change.
- GitHub Actions exact final commit verification is recorded in the completion response. The workflows only verify; no deployment workflow was introduced.

Backend working tree matches the complete remote parent tree. Mobile runtime/dependencies/tests match the remote parent; unrelated historical assets/docs absent from the local reconstruction are preserved by applying only changed files onto the exact remote parent tree.

## Closure and boundaries

Source-level assessment: all three Phase 3H blockers are resolved; no new manual-relationship closure blocker was found. PHASE 3 IS READY TO CLOSE once the final exact-head CI runs succeed. Passing tests support this conclusion; the three lifecycle paths above were also reviewed against their contracts.

No new relationship, editor-semantic repair, schema, migration/backfill, production access, deployment, OTA, native build, store submission or global /uploads restriction. All Pricing/Firing/Test Tile/Sale/Clay/Glaze contracts remain intact.

Physical iOS/Android/Safari validation remains required before release: account replacement/logout during editor save and photo loads, navigation/back, disconnect/reconnect with pending requests, Firing reassignment/deletion, Test Tile tier loss/restoration, and lost-response Retry across all Piece summaries. Automated mocks are not physical-device validation.

Deferred pre-release work remains separate: mobile Piece Glaze metadata loss/reset; website manual Clay typing retaining saved Clay ID; typed Glaze labels retaining hidden saved ID; Piece-save Glaze layer note recreation/omission; duplicate/density cleanup. Do not silently normalize these.

`events.contact_id` remains a reproducible fresh-database initialization defect, unrelated to Phase 3 relationship contracts. Address separately after Phase 3 closure and before fresh-install/recovery rehearsal; no production inspection.

Exact recommended next task (not begun): pre-release editor-preservation scope/audit only, covering the four deferred data-preservation issues above and defining the smallest remediation slice. Keep database initialization maintenance separately scoped before fresh-install/recovery rehearsal. Do not begin the next Quantum Leap phase or release work automatically.
