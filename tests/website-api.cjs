// Run only in a disposable local database; this never connects to Render.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const root=path.resolve(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mudroom-master-test-'));
for(const file of ['server.js','database.js','iap.js'])fs.copyFileSync(path.join(root,file),path.join(tmp,file));
fs.symlinkSync(path.join(root,'node_modules'),path.join(tmp,'node_modules'),'dir');
fs.symlinkSync(path.join(root,'public'),path.join(tmp,'public'),'dir');
const port=31000+Math.floor(Math.random()*10000),base='http://127.0.0.1:'+port;
const secret='disposable-local-regression-secret';
let db,server,output='';
const fixture='website-fixture';
const token=jwt.sign({userId:fixture,tier:'starter'},secret);
const headers={Authorization:'Bearer '+token};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jN1kAAAAASUVORK5CYII=','base64');
async function request(route,method='GET',body,auth=headers){
 const opts={method,headers:{...auth}};
 if(body instanceof FormData)opts.body=body;
 else if(body!==undefined){opts.body=JSON.stringify(body);opts.headers['Content-Type']='application/json';}
 const res=await fetch(base+route,opts);
 const data=await res.json();
 if(!res.ok)throw Object.assign(new Error(data.error||res.status),{status:res.status});
 return data;
}
function multipart(fields,images=[]){const f=new FormData();for(const [k,v]of Object.entries(fields))f.append(k,typeof v==='object'?JSON.stringify(v):String(v));for(const img of images)f.append(img.field||'photos',new Blob([png],{type:'image/png'}),img.name||'test.png');return f;}
async function test(name,fn){await fn();console.log('PASS',name);}
(async()=>{
 server=spawn(process.execPath,['server.js'],{cwd:tmp,env:{PATH:process.env.PATH,PORT:String(port),JWT_SECRET:secret,ADMIN_API_KEY:'local-fixture-key',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
 for(let i=0;i<100&&!output.includes('running on');i++){if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
 assert.ok(output.includes('running on'),'local server starts');
 db=new Database(path.join(tmp,'data/pottery.db'));
 db.prepare('INSERT INTO users(id,email,password_hash,tier,display_name,is_private,findable,country) VALUES(?,?,?,?,?,?,?,?)').run(fixture,'fixture@example.com','local-only','starter','Fixture',1,0,'United State');
 db.prepare('INSERT INTO users(id,email,password_hash,tier) VALUES(?,?,?,?)').run('other-user','other@example.com','local-only','starter');
 db.prepare('INSERT INTO pieces(id,user_id,title,status) VALUES(?,?,?,?)').run('fixture-piece',fixture,'Photo piece','done');
 fs.writeFileSync(path.join(tmp,'data/uploads/piece.png'),png);
 db.prepare('INSERT INTO piece_photos(id,piece_id,filename,is_primary) VALUES(?,?,?,?)').run('piece-photo','fixture-piece','piece.png',1);
 assert.equal((await request("/api/auth/me")).user.id,fixture);
 let sale,combo;
 await test('Quick Sale 2 × $1.50 survives edit and returns $3.00 in CSV',async()=>{
  const batch=await request('/api/sales/bulk','POST',{eventName:'Fixture event',date:'2026-09-25',venueType:'studio',lineItems:[{itemDescription:'Mini dish',quantity:2,priceEach:1.50}]});sale=batch.ids[0];
  await request('/api/sales/'+sale,'PUT',{itemDescription:'Updated dish'});
  const row=db.prepare('SELECT * FROM sales WHERE id=?').get(sale);assert.equal(row.quantity,2);assert.equal(row.price,1.5);
  const csv=await (await fetch(base+'/api/sales/export',{headers})).text();assert.match(csv,/"2","1.50","3.00"/);
 });
 await test('regular sale create/edit photos persist; omitted metadata preserved',async()=>{
  const created=await request('/api/sales','POST',multipart({price:'31.95',quantity:2,date:'2026-09-25',notes:'Keep these notes'},[{field:'photo'}]));
  let row=db.prepare('SELECT * FROM sales WHERE id=?').get(created.id);assert.ok(row.image_filename);const old=row.image_filename;
  await request('/api/sales/'+created.id,'PUT',multipart({price:'32.95',quantity:2},[{field:'photo',name:'changed.png'}]));
  row=db.prepare('SELECT * FROM sales WHERE id=?').get(created.id);assert.notEqual(row.image_filename,old);assert.equal(row.notes,'Keep these notes');assert.equal(row.price,32.95);assert.equal(row.quantity,2);assert.ok(fs.existsSync(path.join(tmp,'data/uploads',row.image_filename)));
 });
 await test('Quick Sale edit accepts photo on original record',async()=>{
  await request('/api/sales/'+sale,'PUT',multipart({quantity:2,price:'1.50'},[{field:'photo'}]));
  assert.ok(db.prepare('SELECT image_filename FROM sales WHERE id=?').get(sale).image_filename);
 });
 await test('linked Piece photo is copied and remains intact after sale photo change',async()=>{
  const created=await request('/api/sales','POST',{pieceId:'fixture-piece',price:65.95,quantity:1,date:'2026-09-25'});
  const row=db.prepare('SELECT * FROM sales WHERE id=?').get(created.id);assert.ok(row.image_filename);assert.notEqual(row.image_filename,'piece.png');
  await request('/api/sales/'+created.id,'PUT',multipart({price:'65.95'},[{field:'photo'}]));
  assert.ok(fs.existsSync(path.join(tmp,'data/uploads/piece.png')));
 });
 await test('bad amount/quantity reject whole save without rounding or partial insertion',async()=>{
  const count=db.prepare('SELECT COUNT(*) c FROM sales').get().c;
  await assert.rejects(request('/api/sales','POST',{price:'1.999',quantity:1}),e=>e.status===400);
  await assert.rejects(request('/api/sales/bulk','POST',{lineItems:[{quantity:2,priceEach:1.5},{quantity:1.5,priceEach:2}]}),e=>e.status===400);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sales').get().c,count);
 });
 await test('Studio Note create/edit/edit persists one original id',async()=>{
  const n=await request('/api/studio/notes','POST',{title:'Note',body:'Initial'});
  await request('/api/studio/notes/'+n.id,'PUT',{title:'Updated',body:'Second'});
  await request('/api/studio/notes/'+n.id,'PUT',{title:'Updated again',body:'Third'});
  const all=await request('/api/studio/notes');assert.equal(all.length,1);assert.equal(all[0].id,n.id);assert.equal(all[0].body,'Third');
 });
 await test('Community Library saves two photos on create',async()=>{
  combo=await request('/api/community/combos','POST',multipart({name:'Two photos',notes:'Keep notes',isShared:false,layers:[{glazeName:'Blue',coats:2,method:'brush'}],photoSlots:[0,1]},[{name:'a.png'},{name:'b.png'}]));
  const row=db.prepare('SELECT * FROM glaze_combos WHERE id=?').get(combo.id);assert.ok(row.photo_filename);assert.ok(row.photo_filename2);assert.notEqual(row.photo_filename,row.photo_filename2);
 });
 await test('Community Library edit replaces one photo in place, preserves other photo and notes',async()=>{
  const old=db.prepare('SELECT * FROM glaze_combos WHERE id=?').get(combo.id);
  await request('/api/community/combos/'+combo.id,'PUT',multipart({name:'Edited',photoSlots:[old.photo_filename,0]},[{name:'replacement.png'}]));
  const row=db.prepare('SELECT * FROM glaze_combos WHERE id=?').get(combo.id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM glaze_combos WHERE user_id=?').get(fixture).c,1);assert.equal(row.notes,'Keep notes');assert.equal(row.is_shared,0);assert.equal(row.photo_filename,old.photo_filename);assert.notEqual(row.photo_filename2,old.photo_filename2);
  assert.equal(db.prepare('SELECT application_method FROM glaze_combo_layers WHERE combo_id=?').get(combo.id).application_method,'brush');
 });
 await test('Community Library append fills empty slot; ownership prevents editing another entry',async()=>{
  const a=await request('/api/community/combos','POST',multipart({name:'One photo',isShared:false},[{name:'a.png'}]));
  const first=db.prepare('SELECT photo_filename FROM glaze_combos WHERE id=?').get(a.id).photo_filename;
  await request('/api/community/combos/'+a.id,'PUT',multipart({name:'Added second'},[{name:'b.png'}]));
  const row=db.prepare('SELECT * FROM glaze_combos WHERE id=?').get(a.id);assert.equal(row.photo_filename,first);assert.ok(row.photo_filename2);
  const other={Authorization:'Bearer '+jwt.sign({userId:'other-user',tier:'starter'},secret)};
  await assert.rejects(request('/api/community/combos/'+a.id,'PUT',{name:'Wrong owner'},other),e=>e.status===403);
 });
 await test('all domain forms normalize for Shopping, Events and Profile; opt-in stays explicit',async()=>{
  for(const website of ['amazon.com','www.amazon.com','https://amazon.com/path']){
   const shop=await request('/api/shopping-list','POST',{name:'Clay',sourceUrl:website});assert.match(db.prepare('SELECT source_url FROM shopping_list_items WHERE id=?').get(shop.id).source_url,/^https:\/\//);
   const ev=await request('/api/events','POST',{title:'Test',eventDate:'2026-09-25',website});assert.match(db.prepare('SELECT website FROM events WHERE id=?').get(ev.id).website,/^https:\/\//);
  }
  await request('/api/user/profile','PUT',{website:'ChristinaWorkmanPottery.com',country:'United State'});
  const me=await request('/api/auth/me');assert.equal(me.user.website,'https://christinaworkmanpottery.com/');assert.equal(me.user.country,'United States');assert.equal(me.user.findable,0);assert.equal(me.user.is_private,1);assert.equal(me.user.isAdmin,false);
 });
 await test('sample PDF is a real PDF; styles/scripts resolve from nested URLs',async()=>{
  const r=await fetch(base+'/shop/mud-log-preview.pdf');assert.match(r.headers.get('content-type'),/application\/pdf/);assert.equal((await r.text()).slice(0,5),'%PDF-');
  const html=await (await fetch(base+'/nested/preview')).text();assert.match(html,/src="\/app.js\?v=20260925"/);assert.match(html,/href="\/style.css/);
 });
 await test('server restart retains records and every saved photo',async()=>{
  const photos=fs.readdirSync(path.join(tmp,'data/uploads')).sort();
  db.close();db=null;
  const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;
  output='';
  server=spawn(process.execPath,['server.js'],{cwd:tmp,env:{PATH:process.env.PATH,PORT:String(port),JWT_SECRET:secret,ADMIN_API_KEY:'local-fixture-key',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
  for(let i=0;i<100&&!output.includes('running on');i++){if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
  assert.ok(output.includes('running on'),'server restarts');
  assert.deepEqual(fs.readdirSync(path.join(tmp,'data/uploads')).sort(),photos);
  const sales=await request('/api/sales');assert.equal(sales.find(s=>s.id===sale).quantity,2);
  const entries=await request('/api/community/combos?filter=all-my');assert.equal(entries.filter(c=>c.id===combo.id).length,1);
 });
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(db)db.close();if(server && server.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill();await exited;}fs.rmSync(tmp,{recursive:true,force:true});});
