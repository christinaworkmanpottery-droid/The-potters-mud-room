const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { backup, verify } = require('../ql/staging-snapshot.cjs');
const env = { APP_URL: 'https://mudroom-ql-integrated-oct14.onrender.com', QL_STAGING_WRITES_STOPPED: '1' };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = path.join(root, 'data'); fs.mkdirSync(data);
  const db = new Database(path.join(data, 'pottery.db'));
  db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes VALUES (1, 'B-Mix cone 6');"); db.close();
  fs.mkdirSync(path.join(data, 'uploads'));
  fs.writeFileSync(path.join(data, 'uploads', 'photo.jpg'), 'synthetic photo bytes');
  return { root, data, destination: path.join(root, 'snapshot') };
}
test('snapshot preserves SQLite records and media and detects subsequent corruption', async t => {
  const { data, destination } = fixture(t);
  await backup(data, destination, env);
  verify(destination);
  const db = new Database(path.join(destination, 'data', 'pottery.db'), { readonly: true });
  assert.equal(db.prepare('SELECT body FROM notes').get().body, 'B-Mix cone 6'); db.close();
  assert.equal(fs.readFileSync(path.join(destination, 'data', 'uploads', 'photo.jpg'), 'utf8'), 'synthetic photo bytes');
  fs.writeFileSync(path.join(destination, 'data', 'uploads', 'photo.jpg'), 'corrupt');
  assert.throws(() => verify(destination), /checksum/);
});
test('snapshot refuses production and unpaused sources without creating output', async t => {
  const { data, destination } = fixture(t);
  await assert.rejects(backup(data, destination, { ...env, APP_URL: 'https://thepottersmudroom.com' }), /isolated/);
  await assert.rejects(backup(data, destination, { ...env, QL_STAGING_WRITES_STOPPED: '0' }), /stopped/);
  assert.equal(fs.existsSync(destination), false);
});
test('snapshot never overwrites an existing backup or writes inside source', async t => {
  const { data, destination } = fixture(t);
  await backup(data, destination, env);
  await assert.rejects(backup(data, destination, env), /EEXIST/);
  verify(destination);
  await assert.rejects(backup(data, path.join(data, 'snapshot'), env), /outside/);
});
test('snapshot refuses symbolic links and removes incomplete output', async t => {
  const { data, destination } = fixture(t);
  fs.symlinkSync('/etc/hosts', path.join(data, 'uploads', 'link'));
  await assert.rejects(backup(data, destination, env), /symbolic/);
  assert.equal(fs.existsSync(destination), false);
});
test('snapshot includes committed WAL records without depending on WAL sidecars', async t => {
  const { data, destination } = fixture(t);
  const source = new Database(path.join(data, 'pottery.db'));
  try {
    source.pragma('journal_mode = WAL');
    source.exec("INSERT INTO notes VALUES (2, 'Sapphire Float');");
    await backup(data, destination, env);
    const copy = new Database(path.join(destination, 'data', 'pottery.db'));
    try { assert.equal(copy.prepare('SELECT body FROM notes WHERE id = 2').get().body, 'Sapphire Float'); }
    finally { copy.close(); }
  } finally { source.close(); }
});
