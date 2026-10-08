// Phase 1F contract tests. Disposable data only, with no implicit normalization.
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createFixture, snapshot } = require('../ql/fixtures.cjs');
const { migrate, createRelationshipService, readPiece } = require('../ql/relationships.cjs');
const { createDeletionLifecycle } = require('../deletion-lifecycle.cjs');
function fixture(t, installed = true) {
  const db = new Database(':memory:'); t.after(() => db.close()); createFixture(db);
  if (installed) migrate(db);
  const service = createRelationshipService(db);
  const pair = (pieceId = 'piece-a', targetId = 'firing-a', userId = 'a') => ({userId, pieceId, targetId, kind:'firing'});
  const list = (pieceId = 'piece-a') => service.list(pair(pieceId)).map(r => r.id);
  const row = () => db.prepare("SELECT * FROM firing_logs WHERE id='firing-a'").get();
  const edit = (pieceId, persist = () => {}) => service.writeLegacyFiring({userId:'a', firingId:'firing-a', pieceId}, persist);
  return {db, service, pair, list, row, edit};
}

test('legacy-only reads through without writing or requiring migration', t => {
  for (const installed of [false,true]) {
    const {db,list} = fixture(t,installed); const before=snapshot(db);
    assert.deepEqual(list(),['firing-a']); assert.deepEqual(readPiece(db,'a','piece-a').firings.map(r=>r.id),list());
    assert.deepEqual(snapshot(db),before);
  }
});
test('QL-only create preserves null legacy selection; repeat returns stable ID', t => {
  const {db,service,pair,list,row}=fixture(t); db.exec("UPDATE firing_logs SET piece_id=NULL WHERE id='firing-a'");
  const link=service.create(pair()); assert.equal(service.create(pair()).id,link.id);
  assert.equal(row().piece_id,null); assert.deepEqual(list(),['firing-a']);
});
test('create against legacy-only yields a deduplicated dual pair and preserves history', t => {
  const {db,service,pair,list}=fixture(t); const before=snapshot(db);
  service.create(pair());service.create(pair());assert.deepEqual(list(),['firing-a']);
  assert.deepEqual(snapshot(db),before); assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings').get().n,1);
});
test('different legacy/QL Pieces are additive shared history, not competing exclusive owners', t => {
  const {db,service,pair,list}=fixture(t); const before=snapshot(db);
  service.create(pair('piece-a-2')); assert.deepEqual(list(),['firing-a']);assert.deepEqual(list('piece-a-2'),['firing-a']);
  assert.deepEqual(snapshot(db),before);assert.equal(readPiece(db,'a','piece-a-2').firings.length,1);
});
for(const form of ['legacy','QL','both'])test(`remove ${form} pair clears effective link idempotently without deleting history`,t=>{
  const {db,service,pair,list,row}=fixture(t);
  if(form==='QL') db.exec("UPDATE firing_logs SET piece_id=NULL WHERE id='firing-a'");
  if(form!=='legacy')service.create(pair());
  service.create(pair('piece-a-2'));
  assert.equal(service.remove(pair()),1);assert.equal(service.remove(pair()),0);
  assert.deepEqual(list(),[]);assert.deepEqual(list('piece-a-2'),['firing-a']);assert.equal(row().piece_id,null);
  assert.equal(row().notes,'Original firing');assert.ok(db.prepare("SELECT 1 FROM firing_photos WHERE firing_id='firing-a'").get());
});
test('removing additional QL pair preserves a different legacy selection',t=>{
  const {service,pair,list,row}=fixture(t);service.create(pair('piece-a-2'));service.remove(pair('piece-a-2'));
  assert.deepEqual(list('piece-a-2'),[]);assert.deepEqual(list(),['firing-a']);assert.equal(row().piece_id,'piece-a');
});
for(const installed of [false,true])test(`legacy create/reassign/clear remains atomic with QL ${installed?'installed':'absent'}`,t=>{
  const {db,service,pair,list,edit,row}=fixture(t,installed);
  service.writeLegacyFiring({userId:'a',firingId:'new-firing',pieceId:'piece-a',create:true},()=>{
    db.prepare("INSERT INTO firing_logs(id,user_id,notes) VALUES('new-firing','a','new history')").run();
  });
  assert.equal(db.prepare("SELECT piece_id FROM firing_logs WHERE id='new-firing'").get().piece_id,'piece-a');
  if(installed){service.create(pair());service.create(pair('unlinked'));}
  edit('piece-a-2');assert.equal(row().piece_id,'piece-a-2');assert.deepEqual(list(),['new-firing']);assert.deepEqual(list('piece-a-2'),['firing-a']);
  if(installed){assert.deepEqual(list('unlinked'),['firing-a']);const before=db.prepare('SELECT * FROM ql_piece_firings ORDER BY id').all();edit('piece-a-2');assert.deepEqual(db.prepare('SELECT * FROM ql_piece_firings ORDER BY id').all(),before);}
  edit(null);edit(undefined);assert.equal(row().piece_id,null);assert.deepEqual(list('piece-a-2'),[]);
  if(installed)assert.deepEqual(list('unlinked'),['firing-a']);
  else assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ql_piece_firings'").get(),undefined);
});
test('stale legacy selection is ignored on reads and only repaired by an explicit edit',t=>{
  const {db,service,pair,list,edit,row}=fixture(t);db.pragma('foreign_keys=OFF');db.exec("UPDATE firing_logs SET piece_id='missing' WHERE id='firing-a'");db.pragma('foreign_keys=ON');
  const before=snapshot(db);assert.deepEqual(list(),[]);assert.deepEqual(snapshot(db),before);
  service.create(pair('piece-a-2'));assert.deepEqual(list('piece-a-2'),['firing-a']);assert.equal(row().piece_id,'missing');
  edit('piece-a');assert.equal(row().piece_id,'piece-a');assert.deepEqual(list(),['firing-a']);assert.deepEqual(list('piece-a-2'),['firing-a']);
});
test('stale/foreign QL targets and corrupt relationship owners never expand or get repaired by reads',t=>{
  const {db,service,pair,list}=fixture(t);db.exec('DROP TRIGGER ql_piece_firings_insert');db.pragma('foreign_keys=OFF');
  for(const [id,owner,piece,firing] of [['stale','a','piece-a','missing'],['foreign','a','piece-a','firing-b'],['owner','b','piece-a','firing-a'],['piece','a','missing','firing-a']]) db.prepare('INSERT INTO ql_piece_firings(id,user_id,piece_id,firing_id) VALUES(?,?,?,?)').run(id,owner,piece,firing);
  db.pragma('foreign_keys=ON');const before=db.prepare('SELECT * FROM ql_piece_firings ORDER BY id').all();
  assert.deepEqual(list(),['firing-a']);assert.equal(readPiece(db,'a','piece-a').firings.length,1);
  assert.deepEqual(db.prepare('SELECT * FROM ql_piece_firings ORDER BY id').all(),before);
  for(const id of ['firing-b','missing'])assert.throws(()=>service.remove(pair('piece-a',id)),{status:404,message:'Record unavailable'});
});
test('foreign legacy pointers do not expand; invalid writes fail identically before callbacks',t=>{
  const {db,service,pair,list}=fixture(t);db.exec("UPDATE firing_logs SET piece_id='piece-a' WHERE id='firing-b'");assert.deepEqual(list(),['firing-a']);
  const before=snapshot(db);const never=()=>assert.fail('callback must not execute');
  for(const id of ['piece-b','missing']){
    assert.throws(()=>service.writeLegacyFiring({userId:'a',firingId:'firing-a',pieceId:id},never),{status:400,message:'Related record unavailable'});
    assert.throws(()=>service.create(pair(id)),{status:404,message:'Record unavailable'});
  }
  for(const id of ['firing-b','missing'])assert.throws(()=>service.writeLegacyFiring({userId:'a',firingId:id,pieceId:'piece-a'},never),{status:404,message:'Record unavailable'});
  assert.deepEqual(snapshot(db),before);
});
test('sync failure rolls back legacy field, record metadata, old pair removal and new record insertion',t=>{
  const {db,service,pair,edit}=fixture(t);service.create(pair());const before=snapshot(db);const links=db.prepare('SELECT * FROM ql_piece_firings').all();
  db.exec("CREATE TRIGGER fail_sync BEFORE INSERT ON ql_piece_firings BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>edit('piece-a-2',()=>db.exec("UPDATE firing_logs SET notes='changed' WHERE id='firing-a'")),/injected/);
  assert.throws(()=>service.writeLegacyFiring({userId:'a',firingId:'new',pieceId:'piece-a',create:true},()=>db.exec("INSERT INTO firing_logs(id,user_id) VALUES('new','a')")),/injected/);
  assert.deepEqual(snapshot(db),before);assert.deepEqual(db.prepare('SELECT * FROM ql_piece_firings').all(),links);
});
test('failed dual unlink rolls back removal of QL pair',t=>{
  const {db,service,pair,list,row}=fixture(t);const link=service.create(pair());
  db.exec("CREATE TRIGGER fail_unlink BEFORE UPDATE OF piece_id ON firing_logs BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>service.remove(pair()),/injected/);assert.equal(row().piece_id,'piece-a');assert.deepEqual(list(),['firing-a']);assert.ok(db.prepare('SELECT 1 FROM ql_piece_firings WHERE id=?').get(link.id));
});
test('Piece deletion removes its pairs, preserves shared and last-link Firing history and photos',t=>{
  const {db,service,pair,row,list}=fixture(t);service.create(pair());service.create(pair('piece-a-2'));
  const lifecycle=createDeletionLifecycle(db,'/unused-synthetic-path',()=>{});
  assert.equal(lifecycle.deletePiece('a','piece-a'),1);assert.equal(row().piece_id,null);assert.deepEqual(list('piece-a-2'),['firing-a']);
  assert.equal(lifecycle.deletePiece('a','piece-a-2'),1);assert.equal(lifecycle.deletePiece('a','piece-a-2'),0);
  assert.ok(row());assert.ok(db.prepare("SELECT 1 FROM firing_photos WHERE firing_id='firing-a'").get());assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings').get().n,0);
});
test('explicit Firing deletion removes all its pairs without deleting Pieces',t=>{
  const {db,service,pair}=fixture(t);service.create(pair());service.create(pair('piece-a-2'));
  const lifecycle=createDeletionLifecycle(db,'/unused-synthetic-path',()=>{});
  assert.equal(lifecycle.deleteFiring('b','firing-a'),0);assert.equal(lifecycle.deleteFiring('a','firing-a'),1);assert.equal(lifecycle.deleteFiring('a','firing-a'),0);
  assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings').get().n,0);assert.ok(db.prepare("SELECT 1 FROM pieces WHERE id='piece-a'").get());assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
