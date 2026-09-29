// Every database/server used by these checks is synthetic and disposable.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const cleanEnv = { PATH: process.env.PATH, NODE_ENV: 'test' };
for (const [args, extraEnv] of [
  [['ql/verify.cjs'], {}],
  [['--test', 'tests/ql-relationships.cjs'], {}],
  [['tests/website-api.cjs'], { QL_TEST_MIGRATION: '1' }],
  [['--test', 'tests/ql-deletion.cjs'], {}],
  [['--test', 'tests/ql-studio-deletion.cjs'], {}],
  [['tests/ql-relationship-safety-api.cjs'], {}],
  [['tests/ql-relationship-safety-api.cjs'], { QL_TEST_MIGRATION: '1' }],
  [['tests/ql-relationship-service-api.cjs'], {}],
  [['tests/ql-studio-deletion-api.cjs'], {}],
  [['tests/ql-studio-deletion-api.cjs'], { QL_TEST_MIGRATION: '1' }],
  [['tests/ql-deletion-api.cjs'], {}],
  [['tests/ql-deletion-api.cjs'], { QL_TEST_MIGRATION: '1' }]
]) {
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...cleanEnv, ...extraEnv }, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('PASS Phase 1E: baseline + relationships + ownership-safe writes/reads + deletion lifecycle (legacy and QL)');
