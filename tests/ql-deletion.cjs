const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createFixture } = require('../ql/fixtures.cjs');
const { migrate, link } = require('../ql/relationships.cjs');
const { createDeletionLifecycle, hasStoredFileReference, fileSlots } = require('../deletion-lifecycle.cjs');

function fixture(t, migrated = true, legacy = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-delete-'));
  const db = new Database(':memory:');
  createFixture(db, { legacy });
  if (migrated) migrate(db);
  for (const name of ['piece-a.jpg','piece-b.jpg','firing-a.jpg','firing-b.jpg']) fs.writeFileSync(path.join(dir,name),name);
  const warnings = [];
  const api = createDeletionLifecycle(db,dir,(...args)=>warnings.push(args));
  t.after(()=>{ db.close(); fs.rmSync(dir,{recursive:true,force:true}); });
  return {db,dir,api,warnings,exists: name=>fs.existsSync(path.join(dir,name))};
}
const row = (db,table,id)=>db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const associate = (db,pieceId='piece-a-2')=>link(db,{userId:'a',pieceId,kind:'firing',targetId:'firing-a'});

for (const migrated of [false,true]) {
  test(`${migrated?'QL':'legacy'}: Piece deletion removes its own rows/files, retains firing and sale history, idempotent`,t=>{
    const {db,api,exists}=fixture(t,migrated,!migrated);
    const before=row(db,'firing_logs','firing-a');
    assert.equal(api.deletePiece('a','piece-a'),1);
    assert.equal(row(db,'pieces','piece-a'),undefined);
    assert.deepEqual(row(db,'firing_logs','firing-a'),{...before,piece_id:null});
    assert.equal(row(db,'sales','sale-a').piece_id,null);
    assert.equal(row(db,'piece_photos','piece-photo-a'),undefined);
    assert.equal(db.prepare("SELECT count(*) n FROM piece_glazes WHERE piece_id='piece-a'").get().n,0);
    assert.equal(exists('piece-a.jpg'),false);assert.ok(exists('firing-a.jpg'));
    assert.equal(api.deletePiece('a','piece-a'),0);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  });
  test(`${migrated?'QL':'legacy'}: foreign Piece ID is a complete no-op`,t=>{
    const {db,api,exists}=fixture(t,migrated);
    const before=db.serialize();
    assert.equal(api.deletePiece('a','piece-b'),0);
    assert.deepEqual(db.serialize(),before);assert.ok(exists('piece-b.jpg'));
  });
}

test('shared legacy+QL firing survives deletion in either order and after last association',t=>{
  for(const order of [['piece-a','piece-a-2'],['piece-a-2','piece-a']]) {
    const {db,api,exists}=fixture(t);associate(db);
    const id=row(db,'firing_photos','firing-photo-a').id;
    api.deletePiece('a',order[0]);
    assert.ok(row(db,'pieces',order[1]));assert.ok(row(db,'firing_logs','firing-a'));
    api.deletePiece('a',order[1]);
    assert.equal(row(db,'firing_logs','firing-a').piece_id,null);
    assert.equal(row(db,'firing_photos','firing-photo-a').id,id);assert.ok(exists('firing-a.jpg'));
    assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings').get().n,0);
  }
});
test('QL-only shared firing: deleting one Piece removes only that junction',t=>{
  const {db,api}=fixture(t);db.prepare("UPDATE firing_logs SET piece_id=NULL WHERE id='firing-a'").run();
  associate(db,'piece-a');const remaining=associate(db);
  api.deletePiece('a','piece-a');
  assert.deepEqual(row(db,'ql_piece_firings',remaining.id),remaining);
});
test('tile/pricing junctions clean up while target records, files and sale amounts survive',t=>{
  const {db,api}=fixture(t);
  for(const [kind,targetId]of [['testTile','tile-a'],['pricing','pricing-a']]) link(db,{userId:'a',pieceId:'piece-a',kind,targetId});
  api.deletePiece('a','piece-a');
  for(const table of ['ql_piece_test_tiles','ql_piece_pricing']) assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.ok(row(db,'test_tiles','tile-a'));assert.ok(row(db,'pricing_calculations','pricing-a'));
  assert.equal(row(db,'sales','sale-a').price,1.5);assert.equal(row(db,'sales','sale-a').quantity,2);
});
test('shared Piece photo survives until its last reference is removed',t=>{
  const {db,api,exists}=fixture(t);
  db.prepare("INSERT INTO piece_photos(id,piece_id,filename,phash,sort_order) VALUES('shared','piece-a-2','piece-a.jpg','keep-hash',2)").run();
  const before=row(db,'piece_photos','shared');api.deletePiece('a','piece-a');
  assert.ok(exists('piece-a.jpg'));assert.deepEqual(row(db,'piece_photos','shared'),before);
  api.deletePiece('a','piece-a-2');assert.equal(exists('piece-a.jpg'),false);
});
test('firing, sale, pricing and test inline slots independently protect a Piece file',t=>{
  for(const [table,column,id]of [['firing_photos','filename','firing-photo-a'],['sales','image_filename','sale-a'],['pricing_calculations','photo_filename','pricing-a'],['test_tiles','photo_filename3','tile-a']]) {
    const {db,api,exists}=fixture(t);
    db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run('piece-a.jpg',id);
    api.deletePiece('a','piece-a');assert.ok(exists('piece-a.jpg'),`${table}.${column}`);
  }
});
test('another account reference protects the file without altering foreign metadata',t=>{
  const {db,api,exists}=fixture(t);
  db.prepare("UPDATE piece_photos SET filename='piece-a.jpg' WHERE id='piece-photo-b'").run();
  const before=row(db,'piece_photos','piece-photo-b');api.deletePiece('a','piece-a');
  assert.ok(exists('piece-a.jpg'));assert.deepEqual(row(db,'piece_photos','piece-photo-b'),before);
});
test('cross-owner legacy firing/sale links block all Piece mutations and account preflight',t=>{
  for(const table of ['firing_logs','sales']) {
    const {db,api,exists}=fixture(t);
    db.prepare(`UPDATE ${table} SET piece_id='piece-a' WHERE user_id='b'`).run();
    const before=db.serialize();
    assert.throws(()=>api.deletePiece('a','piece-a'),e=>e.status===409);
    assert.throws(()=>api.assertAccountPieceIsolation('a'),e=>e.status===409);
    assert.deepEqual(db.serialize(),before);assert.ok(exists('piece-a.jpg'));
  }
});
test('SQL failure rolls back detached firings, sales, metadata and retains files',t=>{
  const {db,api,exists}=fixture(t);associate(db);
  db.exec("CREATE TRIGGER prevent_piece_delete BEFORE DELETE ON pieces BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
  const before=db.serialize();assert.throws(()=>api.deletePiece('a','piece-a'),/injected failure/);
  assert.deepEqual(db.serialize(),before);assert.ok(exists('piece-a.jpg'));
});
test('missing upload is harmless; invalid path and symlink are never followed',t=>{
  const {db,api,dir,exists}=fixture(t);
  fs.unlinkSync(path.join(dir,'piece-a.jpg'));api.deletePiece('a','piece-a');
  fs.symlinkSync(path.join(dir,'piece-b.jpg'),path.join(dir,'alias.jpg'));
  api.cleanupFiles(['alias.jpg','../outside.jpg','/absolute.jpg','..']);
  assert.ok(exists('alias.jpg'));assert.ok(exists('piece-b.jpg'));
});
test('cleanup failure retains a file and does not undo successful metadata deletion',t=>{
  const {db,api,exists,warnings}=fixture(t);
  // Simulates an unexpected schema/query failure during reference checking.
  db.exec('ALTER TABLE pricing_calculations RENAME TO previous_pricing; CREATE VIEW pricing_calculations AS SELECT * FROM missing_table;');
  api.deletePiece('a','piece-a');assert.equal(row(db,'pieces','piece-a'),undefined);
  assert.ok(exists('piece-a.jpg'));assert.equal(warnings.length,1);
});
test('explicit firing deletion removes only its links and unshared files; foreign ID no-op',t=>{
  const {db,api,exists}=fixture(t);associate(db);
  assert.equal(api.deleteFiring('b','firing-a'),0);
  assert.equal(api.deleteFiring('a','firing-a'),1);
  assert.ok(row(db,'pieces','piece-a'));assert.ok(row(db,'pieces','piece-a-2'));
  assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings').get().n,0);
  assert.equal(row(db,'firing_photos','firing-photo-a'),undefined);assert.equal(exists('firing-a.jpg'),false);
});
test('explicit firing/photo deletion preserves shared file and ownership',t=>{
  const {db,api,exists}=fixture(t);
  db.prepare("UPDATE firing_photos SET filename='piece-a.jpg' WHERE id='firing-photo-a'").run();
  assert.equal(api.deletePhoto('b','piece-photo-a','piece'),false);
  assert.equal(api.deletePhoto('a','piece-photo-a','piece'),true);assert.ok(exists('piece-a.jpg'));
  assert.equal(api.deletePhoto('b','firing-photo-a','firing'),false);
  assert.equal(api.deletePhoto('a','firing-photo-a','firing'),true);assert.equal(exists('piece-a.jpg'),false);
});
test('orphan metadata is conservatively treated as a file reference',t=>{
  const {db,api,exists}=fixture(t);db.pragma('foreign_keys=OFF');
  db.prepare("INSERT INTO piece_photos(id,piece_id,filename) VALUES('orphan','missing','piece-a.jpg')").run();
  db.pragma('foreign_keys=ON');api.deletePiece('a','piece-a');assert.ok(exists('piece-a.jpg'));
});
test('baseline stored-file slot inventory is complete, including pricing; optional historical slots work',()=>{
  const schema=require('../ql/schema.json');
  const inventory=Object.fromEntries(schema.tables.map(t=>[t.name,t.columns.map(c=>c.name).filter(c=>c==='filename'||c.endsWith('_filename')||/^photo_filename\d*$/.test(c)||c==='profile_photo')]).filter(([,c])=>c.length));
  assert.deepEqual(fileSlots,inventory);
  for(const [table,columns]of Object.entries(fileSlots))for(const column of columns) {
    const db=new Database(':memory:');try{
      db.exec(`CREATE TABLE ${table}(${column} TEXT);`);
      db.prepare(`INSERT INTO ${table} VALUES(?)`).run('test.jpg');
      assert.equal(hasStoredFileReference(db,'test.jpg'),true,`${table}.${column}`);
      assert.equal(hasStoredFileReference(db,'other.jpg'),false);
    }finally{db.close();}
  }
});
test('disabled FKs and nested transactions cannot perform unsafe cleanup',t=>{
  const {db,api,exists}=fixture(t);
  assert.throws(()=>db.transaction(()=>api.deletePiece('a','piece-a'))(),/own its transaction/);
  db.pragma('foreign_keys=OFF');assert.throws(()=>api.deletePiece('a','piece-a'),/foreign_keys/);
  assert.ok(exists('piece-a.jpg'));assert.ok(row(db,'pieces','piece-a'));
});
