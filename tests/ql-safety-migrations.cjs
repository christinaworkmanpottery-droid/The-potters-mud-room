// Phase 1I: disposable historical startup and maintenance safety only.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const Database=require('better-sqlite3');
const {createFixture}=require('../ql/fixtures.cjs');
const {migrate,link}=require('../ql/relationships.cjs');
const {fileSlots,createDeletionLifecycle}=require('../deletion-lifecycle.cjs');
const root=path.resolve(__dirname,'..');
function fixture(t,variant,ql=false) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ql-startup-i-'));
  fs.mkdirSync(path.join(dir,'data'));
  for(const name of ['database.js','run-migration.js'])fs.copyFileSync(path.join(root,name),path.join(dir,name));
  fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
  const db=new Database(path.join(dir,'data/pottery.db'));
  t.after(()=>{if(db.open)db.close();fs.rmSync(dir,{recursive:true,force:true});});
  const schema=require('../ql/schema.json');const firing=schema.tables.find(t=>t.name==='firing_logs'),sale=schema.tables.find(t=>t.name==='sales');
  const originals=[firing.sql,sale.sql];
  try {
    if(variant==='firing')firing.sql=firing.sql.replace("'lustre', ",'').replace("'lustre',",'');
    if(variant==='sales')sale.sql=sale.sql.replace(/venue_type TEXT\s*,/,"venue_type TEXT CHECK(venue_type IN ('market','online','other')), ");
    createFixture(db,{legacy:variant==='tile'});
  }finally{[firing.sql,sale.sql]=originals;}
  db.prepare("UPDATE firing_logs SET start_time='08:00',end_time='18:00',open_temp='150' WHERE id='firing-a'").run();
  for (const column of ['role','address','instagram','website']) db.exec(`ALTER TABLE contacts ADD COLUMN ${column} TEXT`);
  db.prepare("INSERT INTO contacts(id,user_id,name) VALUES('contact-a','a','Historical buyer')").run();
  db.prepare("UPDATE sales SET contact_id='contact-a' WHERE id='sale-a'").run();
  if(ql){migrate(db);link(db,{userId:'a',pieceId:'piece-a',kind:variant==='tile'?'testTile':'firing',targetId:variant==='tile'?'tile-a':'firing-a'});}
  return {db,dir,run:(code="const db=require('./database.js').initDB();db.close()")=>spawnSync(process.execPath,['-e',code],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'test'},encoding:'utf8'})};
}
const rows=(db,names)=>Object.fromEntries(names.map(n=>[n,db.prepare(`SELECT * FROM ${n} ORDER BY id`).all()]));
for(const variant of ['firing','sales','tile'])test(`I7 supported pre-QL ${variant} startup preserves rows, photos, Contact and later time columns`,t=>{
  const {db,run}=fixture(t,variant);
  const tables=['pieces','piece_glazes','firing_logs','firing_photos','test_tiles','sales','contacts'];
  const before=rows(db,tables);const r=run();assert.equal(r.status,0,r.stderr);
  assert.deepEqual(rows(db,tables),before);assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
  // Only after successful legacy startup is explicit QL migration supported.
  migrate(db);link(db,{userId:'a',pieceId:'piece-a',kind:'firing',targetId:'firing-a'});
  assert.equal(run().status,0);assert.deepEqual(rows(db,tables),before);
});
for(const variant of ['firing','sales','tile'])test(`I7 post-QL historical ${variant} rejects before any schema or row mutation`,t=>{
  const {db,run}=fixture(t,variant,true);
  const snapshot=()=>db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>({...r,rows:db.prepare('SELECT * FROM "'+r.name+'" ORDER BY rowid').all()}));
  const before=snapshot();const r=run();assert.notEqual(r.status,0);assert.match(r.stderr,/startup rejected without mutation/);assert.deepEqual(snapshot(),before);
});
test('I7 failure after dropping Firing parent rolls back parent, child rows and new table',t=>{
  const {db,run}=fixture(t,'firing');const before=rows(db,['firing_logs','firing_photos']);
  const r=run(`const D=require('better-sqlite3');const exec=D.prototype.exec;D.prototype.exec=function(sql){if(sql.startsWith('DROP TABLE firing_logs; ALTER')){exec.call(this,'DROP TABLE firing_logs');throw new Error('injected after drop');}return exec.call(this,sql);};require('./database.js').initDB()`);
  assert.notEqual(r.status,0);assert.match(r.stderr,/injected after drop/);assert.deepEqual(rows(db,['firing_logs','firing_photos']),before);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='firing_logs_new'").get(),undefined);assert.deepEqual(db.pragma('foreign_key_check'),[]);
});
test('I7 leftover migration table is preserved and never overwritten',t=>{
  const {db,run}=fixture(t,'firing');db.exec("CREATE TABLE firing_logs_new(recovery TEXT); INSERT INTO firing_logs_new VALUES('keep')");
  const before=rows(db,['firing_logs','firing_photos']);assert.notEqual(run().status,0);assert.deepEqual(rows(db,['firing_logs','firing_photos']),before);assert.equal(db.prepare('SELECT recovery FROM firing_logs_new').get().recovery,'keep');
});
test('I3 legacy CLI migration refuses installed QL without changing database',t=>{
  const {db,dir}=fixture(t,'current',true);fs.mkdirSync(path.join(dir,'migrations'));fs.writeFileSync(path.join(dir,'migrations/destructive.sql'),'DROP TABLE firing_logs;');
  const before=db.serialize();const r=spawnSync(process.execPath,['run-migration.js','destructive.sql'],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'test'},encoding:'utf8'});
  assert.notEqual(r.status,0);assert.match(r.stderr,/disabled with QL/);assert.deepEqual(db.serialize(),before);
});
test('I1/I3 every registered file slot independently protects bytes, including orphan metadata',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ql-slots-i-')),db=new Database(':memory:');
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});db.pragma('foreign_keys=ON');
  for(const [table,slots]of Object.entries(fileSlots))db.exec(`CREATE TABLE ${table} (id TEXT,${slots.map(c=>c+' TEXT').join(',')})`);
  const lifecycle=createDeletionLifecycle(db,dir);
  for(const [table,slots]of Object.entries(fileSlots))for(const slot of slots){
    fs.writeFileSync(path.join(dir,'shared.jpg'),'bytes');db.prepare(`INSERT INTO ${table}(id,${slot}) VALUES('orphan','shared.jpg')`).run();
    lifecycle.cleanupFiles(['shared.jpg']);assert.equal(fs.readFileSync(path.join(dir,'shared.jpg'),'utf8'),'bytes',table+'.'+slot);
    db.prepare(`DELETE FROM ${table}`).run();
  }
  lifecycle.cleanupFiles(['shared.jpg']);assert.equal(fs.existsSync(path.join(dir,'shared.jpg')),false);
});
test('I1 cleanup filesystem failure retains unreferenced file after metadata commits',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ql-cleanup-i-')),db=new Database(':memory:');
  t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});db.pragma('foreign_keys=ON');db.exec('CREATE TABLE sales(id TEXT,image_filename TEXT)');
  fs.writeFileSync(path.join(dir,'retain.jpg'),'keep');db.exec("INSERT INTO sales VALUES('sale','retain.jpg')");db.transaction(()=>db.exec("DELETE FROM sales WHERE id='sale'"))();
  const original=fs.unlinkSync;let warnings=0;
  try{fs.unlinkSync=()=>{throw new Error('injected IO failure')};createDeletionLifecycle(db,dir,()=>warnings++).cleanupFiles(['retain.jpg']);}
  finally{fs.unlinkSync=original;}
  assert.equal(warnings,1);assert.equal(db.prepare('SELECT count(*) n FROM sales').get().n,0);assert.equal(fs.readFileSync(path.join(dir,'retain.jpg'),'utf8'),'keep');
});

test('I5 internal Piece read model filters foreign Sale Contact pointers without mutating history',t=>{
  const {db}=fixture(t,'current',true);
  db.prepare("INSERT INTO contacts(id,user_id,name) VALUES('foreign-contact','b','Private')").run();
  db.prepare("UPDATE sales SET contact_id='foreign-contact' WHERE id='sale-a'").run();
  const before=db.serialize();const piece=require('../ql/relationships.cjs').readPiece(db,'a','piece-a');
  assert.equal(piece.sales.find(s=>s.id==='sale-a').contact_id,null);assert.deepEqual(db.serialize(),before);
});
