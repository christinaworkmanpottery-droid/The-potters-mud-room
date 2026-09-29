// Phase 1H executable blockers. TODO tests RUN desired invariants and currently fail.
// They are NOT passing safety tests. Remove TODO only with the focused Phase 1I repair.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { migrate, link } = require('../ql/relationships.cjs');
const root = path.resolve(__dirname,'..');
const migrated = true;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'ql-delete-api-'));
let server, db, output = '', passed = 0;
const secret = crypto.randomBytes(32).toString('hex');
const adminKey = crypto.randomBytes(32).toString('hex');
const port = 41000 + crypto.randomInt(10000);
const base = `http://127.0.0.1:${port}`;
async function request(route,method='DELETE',body,owner='a',admin=false) {
  const headers={Authorization:'Bearer '+jwt.sign({userId:owner,tier:'starter'},secret)};
  if(admin)headers['x-admin-key']=adminKey;
  if(body)headers['Content-Type']='application/json';
  const response=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const data=await response.json();return {status:response.status,data};
}
const get=(table,id)=>db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const file=name=>path.join(tmp,'data/uploads',name);
const blocker=(id,name,fn)=>test(id+' '+name,{todo:process.env.QL_READINESS_STRICT === '1' ? false : 'OPEN Phase 1I readiness blocker; not safety evidence'},fn);
(async()=>{
  for(const name of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,name),path.join(tmp,name));
  fs.mkdirSync(path.join(tmp,'ql'), {recursive:true}); fs.copyFileSync(path.join(root,'ql/relationships.cjs'),path.join(tmp,'ql/relationships.cjs'));
  fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});
  for(const name of ['node_modules','public'])fs.symlinkSync(path.join(root,name),path.join(tmp,name),'dir');
  fs.writeFileSync(path.join(tmp,'loopback.cjs'),"const net=require('node:net');const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';return listen.apply(this,args);};");
  server=spawn(process.execPath,['--require','./loopback.cjs','server.js'],{cwd:tmp,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:String(port),APP_URL:base,JWT_SECRET:secret,ADMIN_API_KEY:adminKey},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
  for(let i=0;i<150&&!output.includes('running on');i++){if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
  assert.ok(output.includes('running on'),output);
  db=new Database(path.join(tmp,'data/pottery.db'));db.pragma('foreign_keys=ON');
  if(migrated)migrate(db);
  for(const id of ['a','b','delete-self','delete-admin'])db.prepare('INSERT INTO users(id,email,password_hash,tier) VALUES(?,?,?,?)').run(id,id+'@example.invalid','synthetic','starter');

  async function form(route,method,values) {
    const body=new FormData();for(const [k,v]of Object.entries(values))body.append(k,v);
    const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+jwt.sign({userId:'a',tier:'starter'},secret)},body});
    return {status:response.status,data:await response.json()};
  }
  function shared(prefix) {
    const filename=prefix+'.jpg';fs.writeFileSync(file(filename),'synthetic shared bytes');
    db.prepare('INSERT INTO pieces(id,user_id) VALUES(?,?)').run(prefix+'-p','b');
    db.prepare('INSERT INTO piece_photos(id,piece_id,filename) VALUES(?,?,?)').run(prefix+'-ph',prefix+'-p',filename);
    db.prepare('INSERT INTO pricing_calculations(id,user_id,inputs_json,result_json,photo_filename) VALUES(?,?,?,?,?)').run(prefix+'-price','a','{}','{}',filename);
    return filename;
  }
  await blocker('H1a','Pricing delete preserves a different account Piece photo',async()=>{
    const filename=shared('price-delete');
    assert.equal((await request('/api/pricing-calculations/price-delete-price')).status,200);
    assert.ok(get('piece_photos','price-delete-ph'));
    assert.ok(fs.existsSync(file(filename)),'still-referenced photo must survive');
  });
  await blocker('H1b','Pricing replacement preserves another record photo',async()=>{
    const filename=shared('price-edit');
    const r=await form('/api/pricing-calculations/price-edit-price','PUT',{inputs:'{}',result:'{}',photo:new Blob(['new'],{type:'image/jpeg'})});
    assert.equal(r.status,200);assert.ok(fs.existsSync(file(filename)),'still-referenced old photo must survive');
  });
  db.prepare("INSERT INTO clay_bodies(id,user_id,name) VALUES('private-clay','b','PRIVATE CLAY')").run();
  db.prepare("INSERT INTO glazes(id,user_id,name) VALUES('private-glaze','b','PRIVATE GLAZE')").run();
  db.prepare("INSERT INTO pieces(id,user_id,title,status,is_public,clay_body_id) VALUES('public-piece','a','Public','done',1,'private-clay')").run();
  db.prepare("INSERT INTO piece_glazes(id,piece_id,glaze_id) VALUES('foreign-layer','public-piece','private-glaze')").run();
  await blocker('H2a','Gallery does not expand corrupt foreign Clay/Glaze references',async()=>{
    const list=await fetch(base+'/api/gallery').then(r=>r.json());
    const detail=await fetch(base+'/api/gallery/public-piece').then(r=>r.json());
    assert.ok(!JSON.stringify({list,detail}).includes('PRIVATE'),'foreign library labels must not be public');
  });
  await blocker('H3','Admin size cleanup preserves registered studio files',async()=>{
    const filename=shared('admin-clean');
    const r=await request('/api/admin/disk/cleanup-large?above=0','DELETE',undefined,'a',true);
    assert.equal(r.status,200);assert.ok(fs.existsSync(file(filename)),'size alone is not permission to remove referenced bytes');
  });
  await blocker('H6','Editing a shared JPEG cannot overwrite another account photo bytes',async()=>{
    const sharp=require('sharp');
    const original=await sharp({create:{width:8,height:8,channels:3,background:'#aa3300'}}).jpeg().toBuffer();
    const replacement=await sharp({create:{width:8,height:8,channels:3,background:'#0033aa'}}).jpeg().toBuffer();
    fs.writeFileSync(file('shared-edit.jpg'),original);
    for(const owner of ['a','b']){
      db.prepare('INSERT INTO pieces(id,user_id) VALUES(?,?)').run('edit-'+owner,owner);
      db.prepare('INSERT INTO piece_photos(id,piece_id,filename) VALUES(?,?,?)').run('edit-photo-'+owner,'edit-'+owner,'shared-edit.jpg');
    }
    const r=await form('/api/photos/by-filename/shared-edit.jpg','PUT',{photo:new Blob([replacement],{type:'image/jpeg'})});
    assert.equal(r.status,200);assert.deepEqual(fs.readFileSync(file(get('piece_photos','edit-photo-b').filename)),original,'foreign referenced bytes must stay unchanged');
  });
  await blocker('H4','Sale deletion rolls back Piece status if deleting Sale fails',async()=>{
    db.prepare("INSERT INTO pieces(id,user_id,status,sale_price) VALUES('sold-piece','a','sold',12)").run();
    db.prepare("INSERT INTO sales(id,user_id,piece_id,price) VALUES('failed-sale','a','sold-piece',12)").run();
    const before=get('pieces','sold-piece');
    db.exec("CREATE TRIGGER fail_sale_delete BEFORE DELETE ON sales WHEN OLD.id='failed-sale' BEGIN SELECT RAISE(ABORT,'injected'); END");
    try {assert.equal((await request('/api/sales/failed-sale')).status,500);assert.ok(get('sales','failed-sale'));assert.deepEqual(get('pieces','sold-piece'),before);}
    finally {db.exec('DROP TRIGGER fail_sale_delete');}
  });
  await blocker('H5','Sale contact write rejects foreign contact before mutation',async()=>{
    db.prepare("INSERT INTO contacts(id,user_id,name) VALUES('private-contact','b','Private')").run();
    const before=db.prepare('SELECT count(*) n FROM sales').get().n;
    const r=await request('/api/sales','POST',{price:2,quantity:1,contactId:'private-contact'});
    assert.equal(r.status,400,'foreign contact must be rejected');
    assert.equal(db.prepare('SELECT count(*) n FROM sales').get().n,before);
  });
  for (const variant of ['firing','tile']) await (variant==='tile' ? (id,name,fn)=>test(id+' '+name,fn) : blocker)('H7-'+variant,'Historical '+variant+' startup preserves installed QL relationships and photo metadata',async()=>{
    const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ql-old-startup-'));let old;
    try {
      fs.mkdirSync(path.join(fixtureRoot,'data'));
      fs.copyFileSync(path.join(root,'database.js'),path.join(fixtureRoot,'database.js'));
      fs.symlinkSync(path.join(root,'node_modules'),path.join(fixtureRoot,'node_modules'),'dir');
      const schema=require('../ql/schema.json'), table=schema.tables.find(t=>t.name==='firing_logs'), original=table.sql;
      old=new Database(path.join(fixtureRoot,'data/pottery.db'));
      try {
        if(variant==='firing')table.sql=original.replace("'lustre', ",'').replace("'lustre',",'');
        require('../ql/fixtures.cjs').createFixture(old,{legacy:variant==='tile'});
      } finally {table.sql=original;}
      migrate(old);link(old,{userId:'a',pieceId:'piece-a',kind:variant==='firing'?'firing':'testTile',targetId:variant==='firing'?'firing-a':'tile-a'});
      const tables=variant==='firing'?['firing_logs','firing_photos','ql_piece_firings']:['test_tiles','ql_piece_test_tiles'];
      const snapshot=()=>Object.fromEntries(tables.map(table=>[table,old.prepare('SELECT * FROM '+table+' ORDER BY id').all()]));
      const before=snapshot();old.close();
      const child=require('node:child_process').spawnSync(process.execPath,['-e',"const d=require('./database.js').initDB();d.close()"],{cwd:fixtureRoot,env:{PATH:process.env.PATH,NODE_ENV:'test'},encoding:'utf8'});
      old=new Database(path.join(fixtureRoot,'data/pottery.db'));
      // A rejected startup must also preserve relationships; success cannot hide cascades.
      if(variant==='tile')assert.notEqual(child.status,0,'unsupported startup must reject rather than serve a broken QL schema');
      assert.ok(old.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(tables[0]),'startup removed its parent table');
      assert.deepEqual(snapshot(),before,'startup must preserve relationships even when rejected: '+child.status);
    } finally {if(old?.open)old.close();fs.rmSync(fixtureRoot,{recursive:true,force:true});}
  });
  await blocker('H2b','Photo Lookup does not expand foreign Clay/Glaze references',async()=>{
    // The baseline lacks this optional historical column; supply it only in this
    // disposable fixture to reach the relationship serializer (see readiness review).
    db.exec('ALTER TABLE pieces ADD COLUMN hide_from_photo_search INTEGER DEFAULT 0');
    const sharp=require('sharp');
    const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#2266bb'}}).png().toBuffer();
    fs.writeFileSync(file('lookup.png'),bytes);
    db.prepare("INSERT INTO piece_photos(id,piece_id,filename) VALUES('lookup-photo','public-piece','lookup.png')").run();
    const r=await form('/api/pieces/photo-search','POST',{photo:new Blob([bytes],{type:'image/png'})});
    assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(!JSON.stringify(r.data).includes('PRIVATE'),'foreign library labels must not be returned');
  });
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(db)db.close();if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
  fs.rmSync(tmp,{recursive:true,force:true});
});
