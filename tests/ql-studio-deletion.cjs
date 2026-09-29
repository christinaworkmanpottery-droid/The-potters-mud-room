const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const {createFixture,snapshot}=require('../ql/fixtures.cjs');
const {migrate,link}=require('../ql/relationships.cjs');
const {createDeletionLifecycle}=require('../deletion-lifecycle.cjs');
const configs=[['clay','clay_bodies','clay-a','clay-a.jpg'],['glaze','glazes','glaze-a','glaze-a.jpg'],['testTile','test_tiles','tile-a','tile-a.jpg']];
const row=(db,table,id)=>db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
function setup(t,ql=false,legacy=false){
 const db=new Database(':memory:');createFixture(db,{legacy});if(ql)migrate(db);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ql-studio-'));const warnings=[];
 for(const name of ['clay-a.jpg','glaze-a.jpg','tile-a.jpg','tile-a-2.jpg','tile-a-3.jpg','test-a.jpg'])fs.writeFileSync(path.join(dir,name),'fixture');
 db.exec("UPDATE test_tiles SET clay_body_id='clay-a',glaze_id='glaze-a' WHERE id='tile-a'; UPDATE glaze_clay_tests SET clay_body_id='clay-a' WHERE id='test-a';");
 if(ql)for(const pieceId of ['piece-a','piece-a-2'])for(const [kind,targetId]of [['testTile','tile-a'],['firing','firing-a']])link(db,{userId:'a',pieceId,kind,targetId});
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {db,api:createDeletionLifecycle(db,dir,(...x)=>warnings.push(x)),dir,warnings,exists:n=>fs.existsSync(path.join(dir,n))};
}
for(const ql of [false,true])for(const [kind,table,id,file] of configs){
 test(`${ql?'QL':'legacy'} ${kind}: ownership, history and private file cleanup`,t=>{
  const {db,api,exists}=setup(t,ql);const foreign=snapshot(db).map(t=>({name:t.name,rows:t.rows.filter(r=>r.user_id==='b')}));
  const firing=row(db,'firing_logs','firing-a'),sale=row(db,'sales','sale-a');
  const before=snapshot(db);assert.equal(api.deleteStudioRecord('b',id,kind),0);assert.deepEqual(snapshot(db),before);
  assert.equal(api.deleteStudioRecord('a',id,kind),1);assert.equal(api.deleteStudioRecord('a',id,kind),0);
  assert.equal(row(db,table,id),undefined);assert.equal(exists(file),false);
  assert.ok(row(db,'pieces','piece-a'));assert.deepEqual(row(db,'firing_logs','firing-a'),firing);assert.deepEqual(row(db,'sales','sale-a'),sale);
  assert.deepEqual(snapshot(db).map(t=>({name:t.name,rows:t.rows.filter(r=>r.user_id==='b')})),foreign);
  if(kind==='clay'){
   assert.equal(row(db,'pieces','piece-a').clay_body_id,null);assert.equal(row(db,'test_tiles','tile-a').clay_body_id,null);
   assert.equal(row(db,'test_tiles','tile-a').clay_name,'Historical clay');assert.equal(row(db,'glaze_clay_tests','test-a').clay_body_id,null);assert.ok(exists('test-a.jpg'));
  }
  if(kind==='glaze'){
   const layer=row(db,'piece_glazes','layer-a');assert.equal(layer.glaze_id,null);assert.equal(layer.custom_name,'Same name');assert.equal(layer.coats,1);
   assert.equal(row(db,'test_tiles','tile-a').glaze_id,null);assert.equal(row(db,'test_tiles','tile-a').glaze_name,'Historical glaze');
   assert.equal(row(db,'glaze_clay_tests','test-a'),undefined);assert.equal(row(db,'glaze_ingredients','ingredient-a'),undefined);assert.equal(exists('test-a.jpg'),false);
  }
  if(ql){assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_test_tiles').get().n,kind==='testTile'?0:2);}
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
 });
 test(`${ql?'QL':'legacy'} ${kind}: global shared file protection`,t=>{
  const {db,api,exists}=setup(t,ql);db.prepare("UPDATE firing_photos SET filename=? WHERE id='firing-photo-b'").run(file);
  const before=row(db,'firing_photos','firing-photo-b');api.deleteStudioRecord('a',id,kind);
  assert.ok(exists(file));assert.deepEqual(row(db,'firing_photos','firing-photo-b'),before);
 });
 test(`${ql?'QL':'legacy'} ${kind}: rollback preserves all metadata and files`,t=>{
  const {db,api,exists}=setup(t,ql);db.exec(`CREATE TRIGGER fail BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'injected failure'); END;`);
  const before=snapshot(db);assert.throws(()=>api.deleteStudioRecord('a',id,kind),/injected failure/);assert.deepEqual(snapshot(db),before);assert.ok(exists(file));
  if(ql)assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_test_tiles').get().n,2);
 });
 test(`${ql?'QL':'legacy'} ${kind}: cleanup error leaves committed DB and retained file`,t=>{
  const {db,api,exists,warnings}=setup(t,ql);
  db.exec('ALTER TABLE pricing_calculations RENAME TO previous_pricing; CREATE VIEW pricing_calculations AS SELECT * FROM missing_table;');
  assert.equal(api.deleteStudioRecord('a',id,kind),1);assert.equal(row(db,table,id),undefined);assert.ok(exists(file));assert.ok(warnings.length);
 });
}
for(const [kind,sql] of [
 ['clay',"UPDATE pieces SET clay_body_id='clay-a' WHERE id='piece-b'"],
 ['clay',"UPDATE test_tiles SET clay_body_id='clay-a' WHERE id='tile-b'"],
 ['clay',"UPDATE glaze_clay_tests SET clay_body_id='clay-a' WHERE id='test-b'"],
 ['glaze',"UPDATE piece_glazes SET glaze_id='glaze-a' WHERE id='layer-b'"],
 ['glaze',"UPDATE test_tiles SET glaze_id='glaze-a' WHERE id='tile-b'"],
 ['glaze',"UPDATE glaze_clay_tests SET clay_body_id='clay-b' WHERE id='test-a'"],
 ['testTile',"UPDATE test_tiles SET clay_body_id='clay-b' WHERE id='tile-a'"],
 ['testTile',"UPDATE test_tiles SET glaze_id='glaze-b' WHERE id='tile-a'"]
])test(`cross-account ${kind} rejects ${sql}`,t=>{
 const {db,api}=setup(t,true);db.exec(sql);const before=snapshot(db);const id=configs.find(c=>c[0]===kind)[2];
 assert.throws(()=>api.deleteStudioRecord('a',id,kind),e=>e.status===409);assert.deepEqual(snapshot(db),before);
});
test('corrupt QL tile link rejects deletion without modifying foreign Piece',t=>{
 const {db,api}=setup(t,true);db.exec("DROP TRIGGER ql_piece_test_tiles_update; UPDATE ql_piece_test_tiles SET piece_id='piece-b' WHERE piece_id='piece-a'");
 assert.throws(()=>api.deleteStudioRecord('a','tile-a','testTile'),e=>e.status===409);assert.ok(row(db,'test_tiles','tile-a'));
});
test('very old NOT NULL glaze layer safely rejects; unreferenced glaze still deletes',t=>{
 const {db,api,exists}=setup(t,false,true);const before=snapshot(db);
 assert.throws(()=>api.deleteStudioRecord('a','glaze-a','glaze'),e=>e.status===409);assert.deepEqual(snapshot(db),before);assert.ok(exists('glaze-a.jpg'));
 db.exec("DELETE FROM piece_glazes WHERE glaze_id='glaze-a'");assert.equal(api.deleteStudioRecord('a','glaze-a','glaze'),1);
});
test('empty tile labels get fallback names; manual layer names and all application metadata survive',t=>{
 const {db,api}=setup(t);db.exec("UPDATE test_tiles SET clay_name='',glaze_name=NULL WHERE id='tile-a'; UPDATE piece_glazes SET custom_name='My mix',coats=3,notes='Keep',layer_order=4 WHERE id='layer-a'");
 const layer=row(db,'piece_glazes','layer-a');api.deleteStudioRecord('a','clay-a','clay');api.deleteStudioRecord('a','glaze-a','glaze');
 assert.equal(row(db,'test_tiles','tile-a').clay_name,'Same name');assert.equal(row(db,'test_tiles','tile-a').glaze_name,'Same name');assert.deepEqual(row(db,'piece_glazes','layer-a'),{...layer,glaze_id:null});
});
test('direct Clay/Glaze photo and embedded test deletion protect shared files and parents',t=>{
 const {db,api,exists}=setup(t);db.exec("UPDATE glaze_photos SET filename='clay-a.jpg' WHERE id='glaze-photo-a'; UPDATE glaze_clay_tests SET photo_filename='clay-a.jpg' WHERE id='test-a'");
 for(const [kind,id]of [['clay','clay-photo-a'],['glaze','glaze-photo-a']]){
  assert.equal(api.deletePhoto('b',id,kind),false);assert.equal(api.deletePhoto('a',id,kind),true);assert.ok(exists('clay-a.jpg'));
 }
 assert.equal(api.deleteClayTest('b','glaze-a','test-a'),false);assert.equal(api.deleteClayTest('a','glaze-b','test-a'),false);
 assert.equal(api.deleteClayTest('a','glaze-a','test-a'),true);assert.equal(exists('clay-a.jpg'),false);assert.ok(row(db,'glazes','glaze-a'));
});
