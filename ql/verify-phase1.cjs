// Every database/server used by these checks is synthetic and disposable.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const cleanEnv = { PATH: process.env.PATH, NODE_ENV: 'test' };
for (const [args, extraEnv] of [
  [['ql/verify.cjs'], {}],
  [['tests/ql-piece-pricing-api.cjs'], {}],
  [['--test', 'tests/ql-piece-pricing-dom.cjs'], {}],
  [['--test', 'tests/ql-relationships.cjs'], {}],
  [['--test', 'tests/ql-firing-compatibility.cjs'], {}],
  [['--test', 'tests/ql-integrity-audit.cjs'], {}],
  [['--test', 'tests/ql-recovery-rehearsal.cjs'], {}],
  [['--test', 'tests/ql-readiness-blockers.cjs'], {}],
  [['--test', 'tests/ql-readiness-blockers.cjs'], { QL_TEST_MIGRATION: '0' }],
  [['--test', 'tests/ql-safety-migrations.cjs'], {}],
  [['tests/website-api.cjs'], { QL_TEST_MIGRATION: '1' }],
  [['--test', 'tests/ql-deletion.cjs'], {}],
  [['--test', 'tests/ql-studio-deletion.cjs'], {}],
  [['tests/ql-relationship-safety-api.cjs'], {}],
  [['tests/ql-relationship-safety-api.cjs'], { QL_TEST_MIGRATION: '1' }],
  [['tests/ql-relationship-service-api.cjs'], {}],
  [['tests/ql-firing-compatibility-api.cjs'], {}],
  [['tests/ql-firing-compatibility-api.cjs'], { QL_TEST_MIGRATION: '1' }],
  [['tests/ql-studio-deletion-api.cjs'], {}],
  [['tests/ql-studio-deletion-api.cjs'], { QL_TEST_MIGRATION: '1' }],
  [['tests/ql-deletion-api.cjs'], {}],
  [['tests/ql-deletion-api.cjs'], { QL_TEST_MIGRATION: '1' }],
  [['--test', 'tests/ql-piece-history.cjs'], {}],
  [['tests/ql-piece-history-api.cjs'], {}],
  [['--test', 'tests/ql-piece-history-dom.cjs'], {}],
  [['tests/ql-piece-history-web-api.cjs'], {}],
  [['--test', 'tests/ql-piece-media.cjs'], {}],
  [['--test', 'tests/ql-piece-public-edges-api.cjs','tests/ql-piece-public-edges-dom.cjs'], {}],
  [['--test', 'tests/ql-casualty-sale-previews-dom.cjs'], {}],
  [['--test', 'tests/ql-phase-2w-post-edit-media.cjs'], {}],
  [['--test', 'tests/ql-upload-restriction-readiness.cjs'], {}],
  [['--test', 'tests/ql-clay-media.cjs', 'tests/ql-clay-media-dom.cjs'], {}],
  [['--test', 'tests/ql-glaze-media.cjs', 'tests/ql-glaze-media-dom.cjs'], {}],
  [['--test', 'tests/ql-test-tile-media.cjs'], {}],
  [['--test', 'tests/ql-glaze-combo-media.cjs'], {}],
  [['--test', 'tests/ql-firing-media.cjs', 'tests/ql-firing-media-dom.cjs'], {}],
  [['--test', 'tests/ql-pricing-media.cjs', 'tests/ql-pricing-media-dom.cjs'], {}],
  [['--test', 'tests/ql-sales-media.cjs', 'tests/ql-sales-media-dom.cjs'], {}],
  [['--test', 'tests/ql-project-media.cjs', 'tests/ql-project-media-dom.cjs'], {}],
  [['--test', 'tests/ql-shop-media-api.cjs', 'tests/ql-shop-media-dom.cjs'], {}],
  [['--test', 'tests/ql-forum-media-api.cjs', 'tests/ql-forum-media-dom.cjs'], {}],
  [['--test', 'tests/ql-profile-media-api.cjs', 'tests/ql-profile-media-dom.cjs'], {}],
  [['--test', 'tests/ql-event-media.cjs', 'tests/ql-event-media-dom.cjs', 'tests/ql-event-media-api.cjs'], {}]
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...cleanEnv, ...extraEnv }, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS Phase 1 regressions/readiness unchanged plus Phase 2A-2S protected/public-aware studio media and upload restriction-readiness validation');
