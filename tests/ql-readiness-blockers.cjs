// Phase 1H reproduced invariants plus Phase 1I equivalent-bypass regressions.
// Every check is mandatory; no TODO waivers in either gate.
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
const migrated = process.env.QL_TEST_MIGRATION !== '0';
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
const blocker=(id,name,fn)=>test(id+' '+name,fn);
(async()=>{
  for(const name of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,name),path.join(tmp,name));
  fs.mkdirSync(path.join(tmp,'ql'), {recursive:true}); fs.copyFileSync(path.join(root,'ql/relationships.cjs'),path.join(tmp,'ql/relationships.cjs'));fs.copyFileSync(path.join(root,'ql/piece-editor.cjs'),path.join(tmp,'ql/piece-editor.cjs'));
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
    // Baseline without the optional visibility column must be safe and usable.
    // Exercise the real baseline without fabricating a visibility column.
    const sharp=require('sharp');
    const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#2266bb'}}).png().toBuffer();
    fs.writeFileSync(file('lookup.png'),bytes);
    db.prepare("INSERT INTO piece_photos(id,piece_id,filename) VALUES('lookup-photo','public-piece','lookup.png')").run();
    const r=await form('/api/pieces/photo-search','POST',{photo:new Blob([bytes],{type:'image/png'})});
    assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(!JSON.stringify(r.data).includes('PRIVATE'),'foreign library labels must not be returned');
  });
  await test('I1 Pricing-only, Piece-only, missing and unsafe files use conservative post-commit cleanup',async()=>{
    fs.writeFileSync(file('price-only.jpg'),'only');
    db.prepare("INSERT INTO pricing_calculations(id,user_id,inputs_json,result_json,photo_filename) VALUES('price-only','a','{}','{}','price-only.jpg')").run();
    assert.equal((await request('/api/pricing-calculations/price-only')).status,200);
    assert.equal(fs.existsSync(file('price-only.jpg')),false);
    const filename=shared('piece-only');
    assert.equal((await request('/api/pricing-calculations/piece-only-price')).status,200);
    assert.ok(fs.existsSync(file(filename)));
    assert.equal((await request('/api/pieces/piece-only-p','DELETE',undefined,'b')).status,200);
    assert.equal(fs.existsSync(file(filename)),false);
    const outside=path.join(tmp,'outside.jpg');fs.writeFileSync(outside,'outside');
    fs.symlinkSync(outside,file('unsafe-link.jpg'));
    for(const [id,name]of [['missing','absent.jpg'],['traversal','../../outside.jpg'],['symlink','unsafe-link.jpg']]) {
      db.prepare('INSERT INTO pricing_calculations(id,user_id,inputs_json,result_json,photo_filename) VALUES(?,?,?,?,?)').run(id,'a','{}','{}',name);
      assert.equal((await request('/api/pricing-calculations/'+id)).status,200);
    }
    assert.equal(fs.readFileSync(outside,'utf8'),'outside');assert.ok(fs.lstatSync(file('unsafe-link.jpg')).isSymbolicLink());
  });
  await test('I1 Pricing SQL failure and foreign requests retain rows, QL links and bytes',async()=>{
    const name=shared('price-fail'),before=get('pricing_calculations','price-fail-price');
    if(migrated)link(db,{userId:'a',pieceId:'public-piece',kind:'pricing',targetId:before.id});
    db.exec("CREATE TRIGGER pricing_fail BEFORE DELETE ON pricing_calculations WHEN OLD.id='price-fail-price' BEGIN SELECT RAISE(ABORT,'injected'); END");
    try{assert.equal((await request('/api/pricing-calculations/'+before.id)).status,500);assert.deepEqual(get('pricing_calculations',before.id),before);assert.ok(fs.existsSync(file(name)));}
    finally{db.exec('DROP TRIGGER pricing_fail');}
    assert.equal((await request('/api/pricing-calculations/'+before.id,'DELETE',undefined,'b')).status,404);
    assert.deepEqual(get('pricing_calculations',before.id),before);
    db.exec("CREATE TRIGGER pricing_update_fail BEFORE UPDATE ON pricing_calculations WHEN OLD.id='price-fail-price' BEGIN SELECT RAISE(ABORT,'injected'); END");
    try {assert.equal((await form('/api/pricing-calculations/'+before.id,'PUT',{inputs:'{}',result:'{}',photo:new Blob(['new'],{type:'image/jpeg'})})).status,500);assert.deepEqual(get('pricing_calculations',before.id),before);assert.ok(fs.existsSync(file(name)));}
    finally {db.exec('DROP TRIGGER pricing_update_fail');}
    if(migrated)assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_pricing WHERE pricing_id=?').get(before.id).n,1);
  });
  await test('I3 Admin video/size cleanup retains every registered slot and orphan metadata',async()=>{
    // Isolated local lifecycle fixture covers every slot independently; reachable
    // endpoints below verify they delegate without deleting reference metadata.
    const ref='admin-video.mp4';fs.writeFileSync(file(ref),'video');
    db.prepare("INSERT INTO events(id,user_id,title,event_date,image_filename) VALUES('cleanup-event','b','event','2026-09-29',?)").run(ref);
    db.prepare("INSERT INTO forum_photos(id,filename) VALUES('orphan-photo',?)").run(ref);
    for(const route of ['/api/admin/disk/cleanup-videos','/api/admin/disk/cleanup-large?above=0']) {
      assert.equal((await request(route,'DELETE',undefined,'a',true)).status,200);
      assert.ok(fs.existsSync(file(ref)));assert.ok(get('forum_photos','orphan-photo'));assert.ok(get('events','cleanup-event'));
    }
    fs.writeFileSync(file('unused-video.mp4'),'unused');
    assert.equal((await request('/api/admin/disk/cleanup-videos','DELETE',undefined,'a',true)).status,200);
    assert.equal(fs.existsSync(file('unused-video.mp4')),false);
  });
  await test('I1 Profile/avatar, Event, Sale, Project and forum cleanup preserve another account reference',async()=>{
    const ref=shared('bypass');
    db.prepare('UPDATE users SET avatar_filename=?,profile_photo=? WHERE id=?').run(ref,ref,'a');
    assert.equal((await form('/api/profile/avatar','POST',{avatar:new Blob(['avatar'],{type:'image/jpeg'})})).status,200);
    assert.ok(fs.existsSync(file(ref)));
    assert.equal((await form('/api/profile/photo','POST',{photo:new Blob(['profile'],{type:'image/jpeg'})})).status,200);
    db.prepare("INSERT INTO events(id,user_id,title,event_date,image_filename) VALUES('event-edit','a','event','2026-09-29',?)").run(ref);
    assert.equal((await form('/api/events/event-edit/photo','POST',{photo:new Blob(['event'],{type:'image/jpeg'})})).status,200);
    db.prepare("INSERT INTO sales(id,user_id,price,image_filename) VALUES('sale-photo','a',5,?)").run(ref);
    assert.equal((await form('/api/sales/sale-photo/photo','POST',{photo:new Blob(['sale'],{type:'image/jpeg'})})).status,200);
    db.prepare("INSERT INTO projects(id,user_id,title) VALUES('project','a','project')").run();
    db.prepare("INSERT INTO project_photos(id,project_id,filename) VALUES('project-photo','project',?)").run(ref);
    assert.equal((await request('/api/project-photos/project-photo')).status,200);
    db.prepare("INSERT INTO forum_posts(id,user_id,title,body) VALUES('post','a','post','text')").run();
    db.prepare("INSERT INTO forum_photos(id,post_id,filename) VALUES('forum-photo','post',?)").run(ref);
    assert.equal((await request('/api/forum/photos/forum-photo')).status,200);
    assert.ok(fs.existsSync(file(ref)));assert.equal(get('piece_photos','bypass-ph').filename,ref);
  });
  await test('I4 Piece update failure rolls Sale deletion back; surviving sales preserve sold history',async()=>{
    db.prepare("INSERT INTO pieces(id,user_id,status,sale_price,date_sold) VALUES('sale-atomic-piece','a','sold',25,'2026-09-20')").run();
    db.prepare("INSERT INTO sales(id,user_id,piece_id,price) VALUES('sale-atomic','a','sale-atomic-piece',25)").run();
    const before=get('pieces','sale-atomic-piece');
    db.exec("CREATE TRIGGER piece_status_fail BEFORE UPDATE ON pieces WHEN OLD.id='sale-atomic-piece' BEGIN SELECT RAISE(ABORT,'injected'); END");
    try {assert.equal((await request('/api/sales/sale-atomic')).status,500);assert.ok(get('sales','sale-atomic'));assert.deepEqual(get('pieces','sale-atomic-piece'),before);}
    finally{db.exec('DROP TRIGGER piece_status_fail');}
    db.prepare("INSERT INTO sales(id,user_id,piece_id,price) VALUES('sale-survives','a','sale-atomic-piece',25)").run();
    const remaining=get('sales','sale-survives');
    assert.equal((await request('/api/sales/sale-atomic')).status,200);
    assert.deepEqual(get('sales','sale-survives'),remaining);assert.deepEqual(get('pieces','sale-atomic-piece'),before);
    assert.equal((await request('/api/sales/sale-survives')).status,200);
    assert.equal(get('pieces','sale-atomic-piece').status,'done');assert.equal(get('pieces','sale-atomic-piece').sale_price,null);
  });
  await test('I5 Contact create/update rejection is indistinguishable, reads filter stale/foreign pointers',async()=>{
    db.prepare("INSERT INTO contacts(id,user_id,name) VALUES('own-contact','a','Own')").run();
    const good=await request('/api/sales','POST',{price:2,contactId:'own-contact'});assert.equal(good.status,200);
    const id=good.data.id,before=get('sales',id);
    for(const [method,route]of [['POST','/api/sales'],['PUT','/api/sales/'+id]]) {
      const foreign=await request(route,method,{price:99,contactId:'private-contact'});
      const missing=await request(route,method,{price:99,contactId:'missing-contact'});
      assert.deepEqual(foreign,missing);assert.equal(foreign.status,400);assert.deepEqual(get('sales',id),before);
    }
    assert.equal((await request('/api/sales/'+id,'PUT',{price:3})).status,200);assert.equal(get('sales',id).contact_id,'own-contact');
    for(const [suffix,contact]of [['foreign','private-contact'],['missing','missing-contact'],['legacy',null]])db.prepare('INSERT INTO sales(id,user_id,price,contact_id) VALUES(?,?,?,?)').run('contact-read-'+suffix,'a',1,contact);
    const list=await request('/api/sales','GET');assert.equal(list.status,200);
    for(const suffix of ['foreign','missing','legacy'])assert.equal(list.data.find(r=>r.id==='contact-read-'+suffix).contact_id,null);
    assert.equal(list.data.find(r=>r.id===id).contact_id,'own-contact');
    db.prepare("DELETE FROM sales WHERE id LIKE 'contact-read-%'").run();
  });
  await test('I5 Contact deletion atomically detaches own Sales and rejects foreign inbound links',async()=>{
    db.prepare("INSERT INTO contacts(id,user_id,name) VALUES('contact-delete','a','Delete')").run();
    db.prepare("INSERT INTO sales(id,user_id,price,contact_id) VALUES('contact-sale','a',12,'contact-delete')").run();
    db.exec("CREATE TRIGGER contact_delete_fail BEFORE DELETE ON contacts WHEN OLD.id='contact-delete' BEGIN SELECT RAISE(ABORT,'injected'); END");
    try {assert.equal((await request('/api/contacts/contact-delete')).status,500);assert.equal(get('sales','contact-sale').contact_id,'contact-delete');}
    finally{db.exec('DROP TRIGGER contact_delete_fail');}
    db.prepare("INSERT INTO sales(id,user_id,price,contact_id) VALUES('foreign-contact-sale','b',12,'contact-delete')").run();
    assert.equal((await request('/api/contacts/contact-delete')).status,409);assert.ok(get('contacts','contact-delete'));
    db.prepare("DELETE FROM sales WHERE id='foreign-contact-sale'").run();
    assert.equal((await request('/api/contacts/contact-delete')).status,200);assert.equal(get('sales','contact-sale').contact_id,null);assert.equal(get('sales','contact-sale').price,12);
  });
  await test('I5 Self/admin account deletion rejects corrupt Contact links before any change',async()=>{
    for(const [owner,admin]of [['delete-self',false],['delete-admin',true]]) {
      db.prepare('INSERT INTO sales(id,user_id,price,contact_id) VALUES(?,?,1,?)').run('account-sale-'+owner,owner,'private-contact');
      const before=db.serialize();
      const r=admin?await request('/api/admin/members/'+owner,'DELETE',undefined,'a',true):await request('/api/account','DELETE',undefined,owner);
      assert.equal(r.status,409);assert.deepEqual(db.serialize(),before);
      db.prepare('DELETE FROM sales WHERE id=?').run('account-sale-'+owner);
    }
  });
  const sharp=require('sharp');
  const original=await sharp({create:{width:8,height:8,channels:3,background:'#aa3300'}}).jpeg().toBuffer();
  const edited=await sharp({create:{width:8,height:8,channels:3,background:'#0033aa'}}).jpeg().toBuffer();
  const edit=name=>form('/api/photos/by-filename/'+name,'PUT',{photo:new Blob([edited],{type:'image/jpeg'})});
  await test('I6 Same-account multi-record and multi-slot image edits reject without touching bytes',async()=>{
    for(const owner of ['a'])for(const id of ['one','two']) {
      db.prepare('INSERT INTO pieces(id,user_id) VALUES(?,?)').run('same-'+id,owner);
      db.prepare('INSERT INTO piece_photos(id,piece_id,filename) VALUES(?,?,?)').run('same-photo-'+id,'same-'+id,'same.jpg');
    }
    fs.writeFileSync(file('same.jpg'),original);
    assert.equal((await edit('same.jpg')).status,409);assert.deepEqual(fs.readFileSync(file('same.jpg')),original);
    db.prepare("INSERT INTO test_tiles(id,user_id,photo_filename,photo_filename2) VALUES('same-tile','a','slots.jpg','slots.jpg')").run();fs.writeFileSync(file('slots.jpg'),original);
    assert.equal((await edit('slots.jpg')).status,409);assert.deepEqual(fs.readFileSync(file('slots.jpg')),original);
  });
  await test('I6 Pricing edits isolate cross-account bytes; SQL failure retains old references and bytes',async()=>{
    const name=shared('pricing-cow');fs.writeFileSync(file(name),original);
    const r=await edit(name);assert.equal(r.status,200);assert.notEqual(r.data.filename,name);
    assert.equal(get('pricing_calculations','pricing-cow-price').photo_filename,r.data.filename);
    assert.deepEqual(fs.readFileSync(file(name)),original);assert.deepEqual(fs.readFileSync(file(r.data.filename)),edited);
    const before=get('pricing_calculations','pricing-cow-price');
    db.exec("CREATE TRIGGER photo_edit_fail BEFORE UPDATE ON pricing_calculations WHEN OLD.id='pricing-cow-price' BEGIN SELECT RAISE(ABORT,'injected'); END");
    const files=fs.readdirSync(path.dirname(file(name))).sort();
    try{assert.equal((await edit(before.photo_filename)).status,500);assert.deepEqual(get('pricing_calculations',before.id),before);assert.deepEqual(fs.readdirSync(path.dirname(file(name))).sort(),files);}
    finally{db.exec('DROP TRIGGER photo_edit_fail');}
  });
  await test('I6 Forum reply ownership cannot be inherited from someone else’s post',async()=>{
    db.prepare("INSERT INTO forum_posts(id,user_id,title,body) VALUES('reply-parent','a','parent','body')").run();
    db.prepare("INSERT INTO forum_replies(id,post_id,user_id,body) VALUES('foreign-reply','reply-parent','b','body')").run();
    db.prepare("INSERT INTO forum_photos(id,post_id,reply_id,filename) VALUES('foreign-reply-photo','reply-parent','foreign-reply','reply.jpg')").run();fs.writeFileSync(file('reply.jpg'),original);
    assert.equal((await edit('reply.jpg')).status,404);assert.equal((await request('/api/forum/photos/foreign-reply-photo')).status,403);
    assert.deepEqual(fs.readFileSync(file('reply.jpg')),original);
    db.prepare("INSERT INTO forum_replies(id,post_id,user_id,body) VALUES('own-reply','reply-parent','a','body')").run();
    db.prepare("INSERT INTO forum_photos(id,reply_id,filename) VALUES('own-reply-photo','own-reply','own-reply.jpg')").run();fs.writeFileSync(file('own-reply.jpg'),original);
    assert.equal((await edit('own-reply.jpg')).status,200);
  });
  await test('I2 Private Piece IDs and photos never enter Gallery or another account Photo Lookup',async()=>{
    db.prepare("INSERT INTO pieces(id,user_id,title,status,is_public) VALUES('lookup-private','b','SECRET PIECE','done',0)").run();
    db.prepare("INSERT INTO piece_photos(id,piece_id,filename) VALUES('lookup-secret','lookup-private','lookup-secret.jpg')").run();fs.writeFileSync(file('lookup-secret.jpg'),original);
    assert.equal((await fetch(base+'/api/gallery/lookup-private')).status,404);
    const gallery=await fetch(base+'/api/gallery').then(r=>r.json());assert.ok(!JSON.stringify(gallery).includes('SECRET PIECE'));
    const result=await form('/api/pieces/photo-search','POST',{photo:new Blob([original],{type:'image/jpeg'}),pieceId:'lookup-private',userId:'b'});
    assert.equal(result.status,200);assert.ok(!JSON.stringify(result.data).includes('lookup-private'));assert.ok(!JSON.stringify(result.data).includes('lookup-secret'));
    db.exec('ALTER TABLE pieces ADD COLUMN hide_from_photo_search INTEGER DEFAULT 0');
    db.prepare("UPDATE pieces SET hide_from_photo_search=1 WHERE user_id='a'").run();
    const hidden=await form('/api/pieces/photo-search','POST',{photo:new Blob([original],{type:'image/jpeg'})});assert.equal(hidden.status,200);assert.equal(hidden.data.total,0);
  });
  await test('I3 Legacy migration HTTP runner is guarded with QL; emergency cleanup cannot delete files',async()=>{
    if(migrated)assert.equal((await request('/api/admin/run-migration','POST',{filename:'anything.sql'},'a',true)).status,409);
    const before=fs.readdirSync(path.dirname(file('x'))).sort();
    const r=await request('/api/emergency/disk-cleanup','POST',{});assert.ok(r.status>=400);assert.deepEqual(fs.readdirSync(path.dirname(file('x'))).sort(),before);
  });

  await test('I6 all existing editable studio photo slots copy on write, preserving foreign shared bytes',async()=>{
    db.prepare("INSERT INTO clay_bodies(id,user_id,name) VALUES('cow-clay','a','Clay')").run();
    db.prepare("INSERT INTO glazes(id,user_id,name) VALUES('cow-glaze','a','Glaze')").run();
    db.prepare("INSERT INTO firing_logs(id,user_id) VALUES('cow-firing','a')").run();
    const cases=[
      ['clay_photos','filename',"INSERT INTO clay_photos(id,clay_id,filename) VALUES(?,'cow-clay',?)"],
      ['glaze_photos','filename',"INSERT INTO glaze_photos(id,glaze_id,filename) VALUES(?,'cow-glaze',?)"],
      ['firing_photos','filename',"INSERT INTO firing_photos(id,firing_id,filename) VALUES(?,'cow-firing',?)"],
      ['glaze_clay_tests','photo_filename',"INSERT INTO glaze_clay_tests(id,glaze_id,clay_name,photo_filename) VALUES(?,'cow-glaze','Clay',?)"],
      ['test_tiles','photo_filename3',"INSERT INTO test_tiles(id,user_id,photo_filename3) VALUES(?,'a',?)"],
      ['sales','image_filename',"INSERT INTO sales(id,user_id,image_filename) VALUES(?,'a',?)"],
      ['events','image_filename',"INSERT INTO events(id,user_id,title,event_date,image_filename) VALUES(?,'a','event','2026-09-29',?)"],
      ['project_photos','filename',"INSERT INTO project_photos(id,project_id,filename) VALUES(?,'project',?)"],
      ['glaze_combos','photo_filename2',"INSERT INTO glaze_combos(id,user_id,name,photo_filename2) VALUES(?,'a','Combo',?)"]
    ];
    for(const [table,column,sql]of cases) {
      const id='cow-'+table,name=id+'.jpg';fs.writeFileSync(file(name),original);
      db.prepare(sql).run(id,name);
      db.prepare('INSERT INTO piece_photos(id,piece_id,filename) VALUES(?,?,?)').run(id+'-foreign','lookup-private',name);
      const foreignBefore=get('piece_photos',id+'-foreign');
      const r=await edit(name);assert.equal(r.status,200,table+JSON.stringify(r.data));assert.notEqual(r.data.filename,name);
      assert.equal(get(table,id)[column],r.data.filename);assert.deepEqual(get('piece_photos',id+'-foreign'),foreignBefore);
      assert.deepEqual(fs.readFileSync(file(name)),original);assert.deepEqual(fs.readFileSync(file(r.data.filename)),edited);
    }
  });
  await test('I1 profile and forum SQL failures never delete still-committed image bytes',async()=>{
    fs.writeFileSync(file('profile-fail.jpg'),original);db.prepare("UPDATE users SET avatar_filename='profile-fail.jpg' WHERE id='a'").run();
    db.exec("CREATE TRIGGER avatar_fail BEFORE UPDATE OF avatar_filename ON users WHEN OLD.id='a' BEGIN SELECT RAISE(ABORT,'injected'); END");
    try {assert.equal((await form('/api/profile/avatar','POST',{avatar:new Blob([edited],{type:'image/jpeg'})})).status,500);assert.equal(get('users','a').avatar_filename,'profile-fail.jpg');assert.deepEqual(fs.readFileSync(file('profile-fail.jpg')),original);}
    finally{db.exec('DROP TRIGGER avatar_fail');}
    db.prepare("INSERT INTO forum_photos(id,post_id,filename) VALUES('forum-fail','post','forum-fail.jpg')").run();fs.writeFileSync(file('forum-fail.jpg'),original);
    db.exec("CREATE TRIGGER forum_delete_fail BEFORE DELETE ON forum_photos WHEN OLD.id='forum-fail' BEGIN SELECT RAISE(ABORT,'injected'); END");
    try {assert.equal((await request('/api/forum/photos/forum-fail')).status,500);assert.ok(get('forum_photos','forum-fail'));assert.deepEqual(fs.readFileSync(file('forum-fail.jpg')),original);}
    finally{db.exec('DROP TRIGGER forum_delete_fail');}
  });

})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(db)db.close();if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
  fs.rmSync(tmp,{recursive:true,force:true});
});
