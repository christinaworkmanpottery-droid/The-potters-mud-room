// No paths or environment input: every writable path is inside a fresh mkdtemp.
// This is a cold, quiesced DB+uploads rehearsal, NOT a live backup tool.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const { createFixture } = require('../ql/fixtures.cjs');
const { migrate, createRelationshipService, readPiece } = require('../ql/relationships.cjs');
const { createDeletionLifecycle, fileSlots } = require('../deletion-lifecycle.cjs');
const { auditRelationships } = require('../ql/integrity-audit.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function manifest(dir) {
  return fs.readdirSync(dir,{recursive:true}).sort().filter(name=>fs.statSync(path.join(dir,name)).isFile())
    .map(name=>({name,hash:hash(fs.readFileSync(path.join(dir,name)))}));
}
function databaseState(db) {
  const objects=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  return {objects, userVersion:db.pragma('user_version',{simple:true}),
    rows:objects.filter(r=>r.type==='table').map(r=>({name:r.name,rows:db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all()}))};
}
for(const legacy of [false,true])test(`backup → migration → mixed operations → audit → exact restore (${legacy?'historical':'current'} schema)`,t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ql-1g-recovery-'));
  const live=path.join(root,'fixture');const backup=path.join(root,'backup');const uploads=path.join(live,'uploads');
  fs.mkdirSync(uploads,{recursive:true}); const dbPath=path.join(live,'fixture.sqlite');let db;
  t.after(()=>{if(db?.open)db.close();fs.rmSync(root,{recursive:true,force:true});});
  const open=()=>{db=new Database(dbPath);db.pragma('foreign_keys=ON');return db;};
  open();db.pragma('journal_mode=WAL');createFixture(db,{legacy});
  db.exec("UPDATE test_tiles SET clay_body_id='clay-a',glaze_id='glaze-a' WHERE id='tile-a'; UPDATE glaze_clay_tests SET clay_body_id='clay-a' WHERE id='test-a'; UPDATE firing_photos SET filename='piece-a.jpg' WHERE id='firing-photo-a'");
  for(const [table,slots]of Object.entries(fileSlots))for(const row of db.prepare(`SELECT * FROM ${table}`).all())for(const column of slots)
    if(row[column])fs.writeFileSync(path.join(uploads,row[column]),Buffer.from(`synthetic photo bytes\0${row[column]}\n`));
  const inventory=()=>fs.readdirSync(uploads).sort();
  const baseline=databaseState(db);const baselineReport=auditRelationships(db,{fileInventory:inventory()});
  assert.deepEqual(baselineReport.issues,[]);assert.equal(baselineReport.migrationState,'absent');
  assert.equal(readPiece(db,'a','piece-a').firings[0].id,'firing-a');
  // One connection, no writers. Flush committed WAL, close, verify absence of sidecars,
  // then copy the complete directory. Never copy an open SQLite main file alone.
  assert.equal(db.pragma('wal_checkpoint(TRUNCATE)')[0].busy,0);db.close();
  assert.ok(!fs.existsSync(dbPath+'-wal'));assert.ok(!fs.existsSync(dbPath+'-shm'));
  const baselineBytes=manifest(live);fs.cpSync(live,backup,{recursive:true,errorOnExist:true});
  assert.deepEqual(manifest(backup),baselineBytes);
  open();assert.equal(migrate(db).applied,true);assert.equal(migrate(db).applied,false);
  // Migration is additive: every baseline table and every row remains identical.
  const migrated=databaseState(db);
  assert.deepEqual(migrated.rows.filter(r=>baseline.rows.some(b=>b.name===r.name)),baseline.rows);
  assert.deepEqual(auditRelationships(db,{fileInventory:inventory()}).issues,[]);
  const service=createRelationshipService(db);const deletion=createDeletionLifecycle(db,uploads,()=>assert.fail('unexpected cleanup warning'));
  const pair=(kind,targetId,pieceId='piece-a',userId='a')=>({kind,targetId,pieceId,userId});
  service.create(pair('firing','firing-a'));service.create(pair('firing','firing-a','unlinked'));
  service.create(pair('testTile','tile-a'));service.create(pair('pricing','pricing-a','piece-a-2'));
  service.writeLegacyFiring({userId:'a',firingId:'ql-only',pieceId:null,create:true},()=>db.exec("INSERT INTO firing_logs(id,user_id) VALUES('ql-only','a')"));
  service.create(pair('firing','ql-only','piece-a-2'));
  assert.equal(service.list(pair('firing','firing-a')).filter(r=>r.id==='firing-a').length,1);
  assert.equal(readPiece(db,'a','piece-a').testTiles[0].id,'tile-a');
  service.writeLegacyFiring({userId:'a',firingId:'firing-a',pieceId:'piece-a-2'},()=>{});
  assert.deepEqual(service.list(pair('firing','firing-a')).map(r=>r.id),[]);
  assert.deepEqual(service.list(pair('firing','firing-a','unlinked')).map(r=>r.id),['firing-a']);
  assert.equal(service.remove(pair('firing','firing-a','piece-a-2')),1);
  assert.equal(db.prepare("SELECT piece_id FROM firing_logs WHERE id='firing-a'").get().piece_id,null);
  assert.equal(service.remove(pair('firing','firing-a','piece-a-2')),0);
  service.writeLegacyFiring({userId:'a',firingId:'firing-a',pieceId:'piece-a'},()=>{});
  const beforeRejection=databaseState(db);const beforeFiles=manifest(uploads);
  assert.throws(()=>service.create(pair('firing','firing-b')),{status:404});
  assert.throws(()=>service.writeLegacyFiring({userId:'a',firingId:'firing-a',pieceId:'piece-b'},()=>assert.fail('must not write')),{status:400});
  assert.equal(deletion.deletePiece('b','piece-a'),0);
  assert.deepEqual(databaseState(db),beforeRejection);assert.deepEqual(manifest(uploads),beforeFiles);
  assert.deepEqual(auditRelationships(db,{fileInventory:inventory()}).issues,[]);
  // Both real metadata changes and filesystem deletion happen, so restore cannot pass
  // merely because the fixture was untouched. Shared filename survives Piece deletion.
  assert.equal(deletion.deletePiece('a','piece-a'),1);
  assert.ok(fs.existsSync(path.join(uploads,'piece-a.jpg')));
  assert.ok(db.prepare("SELECT 1 FROM firing_logs WHERE id='firing-a'").get());
  assert.equal(db.prepare("SELECT piece_id FROM sales WHERE id='sale-a'").get().piece_id,null);
  assert.equal(deletion.deleteStudioRecord('a','clay-a','clay'),1);
  assert.equal(db.prepare("SELECT clay_body_id FROM pieces WHERE id='piece-a-2'").get().clay_body_id,null);
  assert.equal(deletion.deleteStudioRecord('a','glaze-a','glaze'),1);
  const tile=db.prepare("SELECT * FROM test_tiles WHERE id='tile-a'").get();
  assert.equal(tile.clay_body_id,null);assert.equal(tile.glaze_id,null);assert.equal(tile.clay_name,'Historical clay');assert.equal(tile.glaze_name,'Historical glaze');
  assert.equal(deletion.deleteStudioRecord('a','tile-a','testTile'),1);
  assert.equal(deletion.deleteFiring('a','firing-a'),1);
  assert.ok(!fs.existsSync(path.join(uploads,'piece-a.jpg')));
  db.exec("INSERT INTO piece_photos(id,piece_id,filename) VALUES('new-photo','piece-a-2','after-backup.jpg')");
  fs.writeFileSync(path.join(uploads,'after-backup.jpg'),'new synthetic photo');
  assert.deepEqual(service.list(pair('pricing','pricing-a','piece-a-2')).map(r=>r.id),['pricing-a']);
  assert.deepEqual(service.list(pair('firing','ql-only','piece-a-2')).map(r=>r.id),['ql-only']);
  assert.equal(readPiece(db,'b','piece-b').firings[0].id,'firing-b');
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  assert.deepEqual(auditRelationships(db,{fileInventory:inventory()}).issues,[]);
  // Intentionally corrupt only the disposable database AFTER clean operations pass.
  db.pragma('foreign_keys=OFF');db.exec("DROP TRIGGER ql_piece_pricing_update; UPDATE ql_piece_pricing SET pricing_id='pricing-b'; UPDATE firing_logs SET piece_id='missing' WHERE id='ql-only'");db.pragma('foreign_keys=ON');
  const corruptBefore=databaseState(db);const corrupt=auditRelationships(db,{fileInventory:inventory()});
  assert.deepEqual(databaseState(db),corruptBefore);
  assert.deepEqual(corrupt.counts,{
    account_deletion_preflight_rejected:2, cross_account_relationship:1,
    invalid_firing_compatibility:1, invalid_ownership_chain:1, missing_record:1,
    ql_schema_drift:1, stale_legacy_relationship:1
  });
  assert.notDeepEqual(databaseState(db),baseline);
  db.close();
  // Replace the complete fixture, preventing newer unreferenced files/sidecars from
  // surviving the restore. The parent is our generated temporary directory only.
  fs.rmSync(live,{recursive:true});fs.cpSync(backup,live,{recursive:true,errorOnExist:true});
  assert.deepEqual(manifest(live),baselineBytes); // DB and all files byte-for-byte.
  assert.deepEqual(manifest(backup),baselineBytes); // Backup itself never modified.
  open();assert.deepEqual(databaseState(db),baseline);
  assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);assert.deepEqual(db.pragma('foreign_key_check'),[]);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name GLOB 'ql_*'").all(),[]);
  assert.deepEqual(auditRelationships(db,{fileInventory:inventory()}),baselineReport);
  assert.equal(readPiece(db,'a','piece-a').firings[0].id,'firing-a');
  assert.ok(fs.existsSync(path.join(uploads,'piece-a.jpg')));assert.ok(!fs.existsSync(path.join(uploads,'after-backup.jpg')));
  assert.deepEqual(manifest(uploads),baselineBytes.filter(r=>r.name.startsWith('uploads/')).map(r=>({...r,name:r.name.slice(8)})));
  db.close();
  // Independent readonly reopen proves the audit works with SQLite write protection.
  db=new Database(dbPath,{readonly:true,fileMustExist:true});db.pragma('foreign_keys=ON');
  assert.deepEqual(auditRelationships(db,{fileInventory:inventory()}),baselineReport);
  assert.throws(()=>db.exec("UPDATE pieces SET title='must fail'"),/readonly/);
});
