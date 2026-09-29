const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createFixture } = require('../ql/fixtures.cjs');
const { migrate, createRelationshipService } = require('../ql/relationships.cjs');
const { auditRelationships } = require('../ql/integrity-audit.cjs');
function fixture(t, installed = true, legacy = false) {
  const db = new Database(':memory:'); t.after(() => db.close()); createFixture(db, {legacy});
  if (installed) migrate(db);
  return db;
}
function snapshot(db) {
  const objects = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  return {objects, rows: objects.filter(r => r.type === 'table').map(r => [r.name, db.prepare(`SELECT * FROM "${r.name}" ORDER BY rowid`).all()])};
}
const has = (report, type, table, id) => report.issues.some(i => i.type === type && (!table || i.table === table) && (!id || i.id === id));
function inspectUnchanged(db) {
  const before = snapshot(db); const changes = db.prepare('SELECT total_changes() n').get().n;
  const report = auditRelationships(db);
  assert.deepEqual(auditRelationships(db), report);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
  return report;
}
for (const installed of [false, true]) for (const legacy of [false, true]) test(`clean manual/legacy data: installed=${installed}, old=${legacy}`, t => {
  const db = fixture(t, installed, legacy); const report = inspectUnchanged(db);
  assert.deepEqual(report.issues, []); assert.equal(report.firingStates.legacyOnly, 2);
  assert.equal(report.migrationState, installed ? 'installed' : 'absent');
});
test('QL-only, matching pairs and additional shared Pieces are valid, not duplicates/conflicts', t => {
  const db = fixture(t); const service = createRelationshipService(db);
  const add = (pieceId, targetId) => service.create({userId:'a', pieceId, targetId, kind:'firing'});
  add('piece-a','firing-a'); add('piece-a-2','firing-a');
  db.exec("INSERT INTO firing_logs(id,user_id) VALUES('ql-only','a')"); add('piece-a','ql-only');
  for (const [kind,targetId] of [['testTile','tile-a'],['pricing','pricing-a']]) service.create({userId:'a',pieceId:'piece-a',kind,targetId});
  const report = inspectUnchanged(db); assert.deepEqual(report.issues, []);
  assert.deepEqual(report.firingStates,{legacyOnly:1,qlOnly:1,matchingPair:1,additionalSharedPair:1,unlinked:0});
});
for (const [table, column, id, foreign] of [
  ['pieces','clay_body_id','piece-a','clay-b'], ['piece_glazes','glaze_id','layer-a','glaze-b'],
  ['test_tiles','clay_body_id','tile-a','clay-b'], ['test_tiles','glaze_id','tile-a','glaze-b'],
  ['glaze_clay_tests','clay_body_id','test-a','clay-b'], ['firing_logs','piece_id','firing-a','piece-b'],
  ['sales','piece_id','sale-a','piece-b']
]) for (const missing of [false,true]) test(`${table}.${column}: ${missing?'missing':'cross-owner'} endpoint and account preflight`, t => {
  const db = fixture(t); db.pragma('foreign_keys=OFF');
  db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(missing?'missing':foreign,id); db.pragma('foreign_keys=ON');
  const report = inspectUnchanged(db);
  assert.ok(has(report,missing?'missing_record':'cross_account_relationship',table,id));
  if (missing) assert.ok(has(report,'stale_legacy_relationship',table,id));
  assert.ok(has(report,'account_deletion_preflight_rejected','users','a'));
  if(table==='firing_logs') assert.ok(has(report,'invalid_firing_compatibility',table,id));
});
for (const [table,column,target] of [['ql_piece_firings','firing_id','firing'],['ql_piece_test_tiles','test_tile_id','tile'],['ql_piece_pricing','pricing_id','pricing']]) test(`${table}: missing, cross-account, invalid owner, orphan and duplicate`, t => {
  const db=fixture(t);
  // Explicitly weaken ONLY the synthetic fixture to represent externally corrupted data.
  db.pragma('foreign_keys=OFF'); db.exec(`DROP TABLE ${table}; CREATE TABLE ${table}(id TEXT,user_id TEXT,piece_id TEXT,${column} TEXT)`);
  const insert=db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?)`);
  for(const row of [['missing-target','a','piece-a','missing'],['missing-piece','a','missing',`${target}-a`],['cross','a','piece-a',`${target}-b`],['owner','ghost','piece-a',`${target}-a`],['duplicate','a','piece-a',`${target}-a`]])insert.run(...row);
  db.pragma('foreign_keys=ON'); const report=inspectUnchanged(db);
  for(const type of ['missing_record','stale_ql_relationship','orphaned_relationship_row','cross_account_relationship','invalid_ownership_chain','duplicate_relationship'])assert.ok(has(report,type,table),type);
  assert.ok(has(report,'ql_schema_drift'));assert.ok(has(report,'account_deletion_preflight_rejected','users','a'));
});
test('orphan photos/ingredients and missing record owners are reported without record contents',t=>{
  const db=fixture(t);db.pragma('foreign_keys=OFF');
  db.exec("UPDATE piece_photos SET piece_id='missing' WHERE id='piece-photo-a'; UPDATE glaze_ingredients SET glaze_id='missing' WHERE id='ingredient-a'; UPDATE clay_bodies SET user_id='ghost',notes='PRIVATE-CONTENT' WHERE id='clay-a'");db.pragma('foreign_keys=ON');
  const report=inspectUnchanged(db);
  assert.ok(has(report,'orphaned_relationship_row','piece_photos','piece-photo-a'));
  assert.ok(has(report,'orphaned_relationship_row','glaze_ingredients','ingredient-a'));
  assert.ok(has(report,'invalid_ownership_chain','clay_bodies','clay-a'));
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE-CONTENT|example.invalid|synthetic-hash|customer-a/);
});
test('shared files are valid; inventory reports missing/unreferenced files and unsafe metadata using tokens',t=>{
  const db=fixture(t);db.exec("UPDATE firing_photos SET filename='piece-a.jpg' WHERE id='firing-photo-a'");
  assert.deepEqual(inspectUnchanged(db).issues,[]);
  db.exec("UPDATE clay_photos SET filename='../private.jpg' WHERE id='clay-photo-a'; UPDATE glaze_photos SET filename='' WHERE id='glaze-photo-a'");
  const report=auditRelationships(db,{fileInventory:['piece-a.jpg','unused.jpg']});
  assert.ok(has(report,'missing_file')); assert.ok(has(report,'unreferenced_file'));assert.ok(has(report,'suspicious_file_metadata','clay_photos'));
  assert.ok(has(report,'suspicious_file_metadata','glaze_photos'));
  assert.doesNotMatch(JSON.stringify(report),/private.jpg|unused.jpg/);
});
test('duplicate photo rows and identical glaze applications reported; different layer order allowed',t=>{
  const db=fixture(t);
  db.exec("INSERT INTO piece_photos(id,piece_id,filename) VALUES('duplicate','piece-a','piece-a.jpg'); INSERT INTO piece_glazes(id,piece_id,glaze_id,layer_order) VALUES('dup-layer','piece-a','glaze-a',0),('other-layer','piece-a','glaze-a',2)");
  const report=inspectUnchanged(db);assert.ok(has(report,'duplicate_photo_reference'));assert.ok(has(report,'duplicate_glaze_application'));
  assert.deepEqual(report.issues.find(i=>i.type==='duplicate_glaze_application').rowIds,['dup-layer','layer-a']);
});
for(const sql of ['DROP TRIGGER ql_piece_firings_insert',"UPDATE ql_migrations SET checksum='bad'",'DROP TABLE ql_piece_pricing', 'CREATE TABLE ql_unexpected(id TEXT)'])test(`schema drift: ${sql}`,t=>{
 const db=fixture(t);db.exec(sql);assert.ok(has(inspectUnchanged(db),'ql_schema_drift'));
});
test('disabled FK enforcement is reported as unavailable preflight, never silently enabled',t=>{
 const db=fixture(t);db.pragma('foreign_keys=OFF');const report=inspectUnchanged(db);
 assert.ok(has(report,'account_preflight_unavailable'));assert.equal(db.pragma('foreign_keys',{simple:true}),0);
});

test('sale contact links are inspected even without a legacy foreign-key declaration',t=>{
 const db=fixture(t);db.exec("INSERT INTO contacts(id,user_id,name) VALUES('contact-b','b','Private name'); UPDATE sales SET contact_id='contact-b' WHERE id='sale-a'");
 const report=inspectUnchanged(db);assert.ok(has(report,'cross_account_relationship','sales','sale-a'));
 assert.doesNotMatch(JSON.stringify(report),/Private name/);
});
test('forum photo missing and incompatible parents are inspected',t=>{
 const db=fixture(t);db.pragma('foreign_keys=OFF');
 db.exec("INSERT INTO forum_photos(id,post_id,filename) VALUES('orphan','missing','forum.jpg')");db.pragma('foreign_keys=ON');
 const report=inspectUnchanged(db);assert.ok(has(report,'orphaned_relationship_row','forum_photos','orphan'));assert.ok(has(report,'invalid_ownership_chain','forum_photos','orphan'));
 db.exec("INSERT INTO forum_posts(id,user_id,title,body) VALUES('post-a','a','synthetic','synthetic'),('post-b','b','synthetic','synthetic'); INSERT INTO forum_replies(id,post_id,user_id,body) VALUES('reply','post-b','a','synthetic'); INSERT INTO forum_photos(id,post_id,reply_id,filename) VALUES('bad-chain','post-a','reply','forum.jpg')");
 assert.ok(has(inspectUnchanged(db),'invalid_photo_parent_chain','forum_photos','bad-chain'));
 // A reply by another user is normal community behavior, not an ownership violation.
 db.exec("UPDATE forum_photos SET post_id='post-b' WHERE id='bad-chain'");
 assert.ok(!has(inspectUnchanged(db),'invalid_photo_parent_chain','forum_photos','bad-chain'));
});
test('on-disk migrated corruption audit succeeds readonly and preserves exact database bytes',t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ql-readonly-audit-'));const filename=path.join(root,'fixture.sqlite');let db;
 t.after(()=>{if(db?.open)db.close();fs.rmSync(root,{recursive:true,force:true});});
 db=new Database(filename);createFixture(db);migrate(db);
 db.exec("UPDATE firing_logs SET piece_id='piece-b' WHERE id='firing-a'");db.close();
 const bytes=fs.readFileSync(filename);
 db=new Database(filename,{readonly:true,fileMustExist:true});db.pragma('foreign_keys=ON');
 const report=inspectUnchanged(db);assert.ok(has(report,'invalid_firing_compatibility'));
 assert.throws(()=>db.exec("DELETE FROM firing_logs"),/readonly/);db.close();
 assert.deepEqual(fs.readFileSync(filename),bytes);
});
