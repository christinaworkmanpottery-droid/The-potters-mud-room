const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { migrate, link, unlink, readPiece } = require('../ql/relationships.cjs');
const { createFixture, snapshot } = require('../ql/fixtures.cjs');

function fixture(t, options) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  createFixture(db, options);
  return db;
}
const args = (kind = 'firing', targetId = 'firing-a', pieceId = 'piece-a', userId = 'a') => ({ userId, pieceId, kind, targetId });
const cases = [['firing', 'firing', 'ql_piece_firings', 'firing_id', 'firing_logs'],
  ['testTile', 'tile', 'ql_piece_test_tiles', 'test_tile_id', 'test_tiles'],
  ['pricing', 'pricing', 'ql_piece_pricing', 'pricing_id', 'pricing_calculations']];

for (const legacy of [false, true]) {
  test(`${legacy ? 'historical' : 'current'} schema: additive migration preserves all 61 tables and values; repeat is inert`, t => {
    const db = fixture(t, { legacy });
    const before = snapshot(db);
    assert.equal(migrate(db).applied, true);
    assert.deepEqual(snapshot(db), before);
    assert.equal(migrate(db).applied, false);
    assert.equal(db.prepare('SELECT count(*) n FROM ql_migrations').get().n, 1);
    assert.deepEqual(snapshot(db), before);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(readPiece(db, 'a', 'piece-a').firings[0].id, 'firing-a');
  });
}

test('reader works before migration and preserves nullable/name-only records', t => {
  const db = fixture(t);
  const result = readPiece(db, 'a', 'piece-a');
  assert.equal(result.glazes[1].custom_name, 'Handwritten glaze');
  assert.equal(result.sales[0].price, 1.5);
  assert.equal(result.sales[0].quantity, 2);
  const empty = readPiece(db, 'a', 'unlinked');
  assert.equal(empty.clay, null);
  for (const field of ['glazes', 'photos', 'firings', 'testTiles', 'pricing', 'sales']) assert.deepEqual(empty[field], []);
});

for (const [kind, prefix, table, column, target] of cases) {
  test(`${kind}: stable/idempotent many-to-many links, owner-scoped unlink and original rows untouched`, t => {
    const db = fixture(t); migrate(db);
    const before = snapshot(db);
    const first = link(db, args(kind, `${prefix}-a`));
    assert.equal(link(db, args(kind, `${prefix}-a`)).id, first.id);
    assert.notEqual(link(db, args(kind, `${prefix}-a`, 'piece-a-2')).id, first.id);
    assert.throws(() => unlink(db, args(kind, `${prefix}-a`, 'piece-a', 'b')), /Record unavailable/);
    assert.equal(unlink(db, args(kind, `${prefix}-a`)), 1);
    assert.equal(unlink(db, args(kind, `${prefix}-a`)), 0);
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 1);
    assert.deepEqual(snapshot(db), before);
  });
  test(`${kind}: cross-account/missing endpoints rejected through helper AND SQL insert/update`, t => {
    const db = fixture(t); migrate(db);
    for (const targetId of [`${prefix}-b`, 'absent']) assert.throws(() => link(db, args(kind, targetId)), /Record unavailable/);
    assert.throws(() => link(db, args(kind, `${prefix}-a`, 'piece-b')), /Record unavailable/);
    assert.throws(() => db.prepare(`INSERT INTO ${table}(id,user_id,piece_id,${column}) VALUES('bad','a','piece-a',?)`).run(`${prefix}-b`), /same-owner/);
    assert.throws(() => db.prepare(`INSERT INTO ${table}(id,user_id,piece_id,${column}) VALUES('bad','a','missing',?)`).run(`${prefix}-a`), /same-owner/);
    const row = link(db, args(kind, `${prefix}-a`));
    for (const [field, value] of [[column, `${prefix}-b`], ['piece_id', 'piece-b'], ['user_id', 'b']]) {
      assert.throws(() => db.prepare(`UPDATE ${table} SET ${field}=? WHERE id=?`).run(value, row.id), /same-owner/);
    }
    assert.throws(() => db.prepare(`UPDATE ${target} SET user_id='b' WHERE id=?`).run(`${prefix}-a`), /ownership cannot change/);
    assert.throws(() => db.prepare("UPDATE pieces SET user_id='b' WHERE id='piece-a'").run(), /ownership cannot change/);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
  test(`${kind}: deleting an endpoint cleans junctions without deleting other endpoints`, t => {
    const db = fixture(t); migrate(db);
    link(db, args(kind, `${prefix}-a`)); link(db, args(kind, `${prefix}-a`, 'piece-a-2'));
    db.prepare("DELETE FROM pieces WHERE id='piece-a-2'").run();
    assert.ok(db.prepare(`SELECT id FROM ${target} WHERE id=?`).get(`${prefix}-a`));
    db.prepare(`DELETE FROM ${target} WHERE id=?`).run(`${prefix}-a`);
    assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
    assert.ok(db.prepare("SELECT id FROM pieces WHERE id='piece-a'").get());
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  });
}

test('legacy firing edits remain authoritative; explicit links deduplicate and remain independent', t => {
  const db = fixture(t); migrate(db);
  assert.equal(readPiece(db, 'a', 'piece-a').firings.length, 1);
  db.prepare("UPDATE firing_logs SET piece_id='piece-a-2' WHERE id='firing-a'").run();
  assert.equal(readPiece(db, 'a', 'piece-a').firings.length, 0);
  assert.equal(readPiece(db, 'a', 'piece-a-2').firings.length, 1);
  link(db, args('firing', 'firing-a', 'piece-a-2'));
  assert.equal(readPiece(db, 'a', 'piece-a-2').firings.length, 1);
  link(db, args());
  assert.equal(readPiece(db, 'a', 'piece-a').firings.length, 1);
  unlink(db, args('firing', 'firing-a', 'piece-a-2'));
  assert.equal(readPiece(db, 'a', 'piece-a-2').firings.length, 1); // Legacy link is not erased.
});

test('reader fails closed on foreign account and filters legacy cross-owner joins without repairing rows', t => {
  const db = fixture(t); migrate(db);
  assert.throws(() => readPiece(db, 'b', 'piece-a'), /Record unavailable/);
  assert.throws(() => readPiece(db, 'b', 'missing'), /Record unavailable/);
  assert.throws(() => readPiece(db, '', 'piece-a'), /Record unavailable/);
  db.prepare("UPDATE pieces SET clay_body_id='clay-b' WHERE id='piece-a'").run();
  db.prepare("UPDATE piece_glazes SET glaze_id='glaze-b' WHERE id='layer-a'").run();
  db.prepare("UPDATE firing_logs SET piece_id='piece-a' WHERE id='firing-b'").run();
  db.prepare("UPDATE sales SET piece_id='piece-a' WHERE id='sale-b'").run();
  const before = snapshot(db);
  const result = readPiece(db, 'a', 'piece-a');
  assert.equal(result.clay, null);
  assert.equal(result.glazes.length, 1); assert.equal(result.glazes[0].custom_name, 'Handwritten glaze');
  assert.deepEqual(result.firings.map(x => x.id), ['firing-a']);
  assert.deepEqual(result.sales.map(x => x.id), ['sale-a']);
  assert.deepEqual(snapshot(db), before);
});

test('failure midway through DDL rolls back all new objects and ledger', t => {
  const db = fixture(t);
  db.exec('CREATE TABLE ql_piece_test_tiles(collision TEXT)');
  const before = db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  assert.throws(() => migrate(db), /already exists/);
  assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before);
});

test('missing prerequisite or disabled FK enforcement fails before mutation; schema drift is rejected', t => {
  const empty = new Database(':memory:'); t.after(() => empty.close());
  assert.throws(() => migrate(empty), /prerequisite missing/);
  const db = fixture(t);
  db.pragma('foreign_keys=OFF');
  assert.throws(() => migrate(db), /foreign_keys=ON/);
  db.pragma('foreign_keys=ON'); migrate(db);
  db.exec('DROP TRIGGER ql_piece_firings_insert');
  assert.throws(() => migrate(db), /drift/);
});

test('migration/links survive reopen and SQLite backup/restore; photo references and bytes unchanged', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-preservation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let db = new Database(path.join(dir, 'fixture.db')); t.after(() => { if (db.open) db.close(); });
  createFixture(db); db.pragma('journal_mode=WAL');
  const before = snapshot(db);
  const filenames = before.flatMap(t => t.rows.flatMap(row => Object.entries(row)
    .filter(([key, val]) => /filename\d*$/.test(key) && val).map(([, val]) => val)));
  assert.equal(new Set(filenames).size, 20);
  const uploads = path.join(dir, 'uploads'); fs.mkdirSync(uploads);
  for (const filename of filenames) fs.writeFileSync(path.join(uploads, filename), `Synthetic photo: ${filename}`);
  const hashes = () => fs.readdirSync(uploads).sort().map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(uploads, name))).digest('hex')]);
  const originalHashes = hashes();
  migrate(db);
  const saved = cases.map(([kind, prefix]) => link(db, args(kind, `${prefix}-a`)));
  db.close(); db = new Database(path.join(dir, 'fixture.db'));
  assert.equal(migrate(db).applied, false);
  const restoredContext = readPiece(db, 'a', 'piece-a');
  assert.equal(restoredContext.testTiles[0].photo_filename3, 'tile-a-3.jpg');
  assert.equal(restoredContext.pricing[0].photo_filename, 'pricing-a.jpg');
  assert.deepEqual(snapshot(db), before); assert.deepEqual(hashes(), originalHashes);
  await db.backup(path.join(dir, 'restored.db'));
  const restored = new Database(path.join(dir, 'restored.db')); t.after(() => restored.close());
  assert.deepEqual(readPiece(restored, 'a', 'piece-a'), restoredContext);
  assert.deepEqual(cases.map(([kind, prefix]) => link(restored, args(kind, `${prefix}-a`))), saved);
  assert.deepEqual(restored.pragma('foreign_key_check'), []);
  assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
});


test('reader filters corrupt QL junction ownership and missing targets without leaking data', t => {
  const db = fixture(t); migrate(db);
  db.exec('DROP TRIGGER ql_piece_test_tiles_insert; DROP TRIGGER ql_piece_test_tiles_update; DROP TRIGGER ql_piece_firings_insert; DROP TRIGGER ql_piece_firings_update;');
  db.prepare("INSERT INTO ql_piece_test_tiles(id,user_id,piece_id,test_tile_id) VALUES('bad-tile','a','piece-a','tile-b')").run();
  db.prepare("INSERT INTO ql_piece_firings(id,user_id,piece_id,firing_id) VALUES('bad-fire','a','piece-a','firing-b')").run();
  let result = readPiece(db, 'a', 'piece-a');
  assert.equal(result.testTiles.some(x => x.id === 'tile-b'), false);
  assert.equal(result.firings.some(x => x.id === 'firing-b'), false);
  db.pragma('foreign_keys=OFF');
  db.prepare("UPDATE ql_piece_test_tiles SET test_tile_id='missing-tile' WHERE id='bad-tile'").run();
  db.pragma('foreign_keys=ON');
  result = readPiece(db, 'a', 'piece-a');
  assert.equal(result.testTiles.some(x => x.id === 'missing-tile'), false);
});
