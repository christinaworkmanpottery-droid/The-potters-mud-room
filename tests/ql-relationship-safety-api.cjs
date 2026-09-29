// Phase 1D relationship safety. Synthetic loopback API checks, legacy + opt-in QL.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken'),crypto=require('node:crypto');
const {migrate,link}=require('../ql/relationships.cjs');
const root=path.resolve(__dirname,'..'), migrated=process.env.QL_TEST_MIGRATION==='1';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ql-rel-api-')); let server,db,output='',passed=0;
const secret=crypto.randomBytes(32).toString('hex'),adminKey=crypto.randomBytes(32).toString('hex');
const port=43000+crypto.randomInt(8000),base='http://127.0.0.1:'+port;
async function request(route,method='GET',body,owner='a'){
 const headers={Authorization:'Bearer '+jwt.sign({userId:owner,tier:'starter'},secret)};
 if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 let data=null;try{data=await response.json();}catch{} return {status:response.status,data};
}
async function upload(route,field,owner='a'){
 const body=new FormData();body.append(field,new Blob(['image'],{type:'image/jpeg'}),'x.jpg');
 const response=await fetch(base+route,{method:'POST',headers:{Authorization:'Bearer '+jwt.sign({userId:owner,tier:'starter'},secret)},body});
 let data=null;try{data=await response.json();}catch{} return {status:response.status,data};
}
const get=(table,id)=>db.prepare('SELECT * FROM '+table+' WHERE id=?').get(id);
const file=name=>path.join(tmp,'data/uploads',name);
async function check(name,fn){await fn();passed++;console.log('PASS '+(migrated?'QL':'legacy')+' relationship API: '+name);}
function seed(owner,prefix){
 db.prepare('INSERT INTO clay_bodies(id,user_id,name) VALUES(?,?,?)').run(prefix+'-c',owner,prefix+' Clay');
 db.prepare('INSERT INTO glazes(id,user_id,name) VALUES(?,?,?)').run(prefix+'-g',owner,prefix+' Glaze');
 db.prepare('INSERT INTO pieces(id,user_id,title,clay_body_id) VALUES(?,?,?,?)').run(prefix+'-p',owner,prefix+' Piece',prefix+'-c');
 db.prepare('INSERT INTO piece_glazes(id,piece_id,glaze_id,custom_name) VALUES(?,?,?,?)').run(prefix+'-l',prefix+'-p',prefix+'-g',prefix+' Manual');
 db.prepare('INSERT INTO firing_logs(id,user_id,piece_id,notes) VALUES(?,?,?,?)').run(prefix+'-f',owner,prefix+'-p','history');
 db.prepare('INSERT INTO test_tiles(id,user_id,clay_body_id,clay_name,glaze_id,glaze_name) VALUES(?,?,?,?,?,?)').run(prefix+'-t',owner,prefix+'-c',prefix+' Clay',prefix+'-g',prefix+' Glaze');
 db.prepare('INSERT INTO sales(id,user_id,piece_id,price,quantity) VALUES(?,?,?,2.5,1)').run(prefix+'-s',owner,prefix+'-p');
}
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
 db=new Database(path.join(tmp,'data/pottery.db'));db.pragma('foreign_keys=ON');if(migrated)migrate(db);
 for(const id of ['a','b','delete-ok','delete-bad'])db.prepare('INSERT INTO users(id,email,password_hash,tier) VALUES(?,?,?,?)').run(id,id+'@example.invalid','synthetic','starter');
 seed('a','a');seed('b','b');

 await check('valid same-account Piece Clay and Glaze creation',async()=>{
  const r=await request('/api/pieces','POST',{title:'Owned links',clay_body_id:'a-c',glaze_ids:[{glazeId:'a-g',coats:2}]});
  assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(get('pieces',r.data.id).clay_body_id,'a-c');
  assert.equal(db.prepare('SELECT glaze_id FROM piece_glazes WHERE piece_id=?').get(r.data.id).glaze_id,'a-g');
 });
 await check('cross-account Piece to Clay rejected atomically',async()=>{
  const n=db.prepare("SELECT count(*) n FROM pieces WHERE user_id='a'").get().n;
  assert.equal((await request('/api/pieces','POST',{title:'bad',clay_body_id:'b-c'})).status,400);
  assert.equal(db.prepare("SELECT count(*) n FROM pieces WHERE user_id='a'").get().n,n);
 });
 await check('cross-account Piece to Glaze rejected atomically',async()=>{
  const n=db.prepare("SELECT count(*) n FROM pieces WHERE user_id='a'").get().n;
  assert.equal((await request('/api/pieces','POST',{title:'bad',glaze_ids:[{glazeId:'b-g'}]})).status,400);
  assert.equal(db.prepare("SELECT count(*) n FROM pieces WHERE user_id='a'").get().n,n);
 });
 for (const [label,body] of [['Clay',{clay_body_id:'b-c'}],['Glaze',{glaze_ids:[{glazeId:'b-g'}]}]]) {
  await check('Piece update rejects foreign '+label+' without replacing existing history',async()=>{
   const before=get('pieces','a-p'), layers=db.prepare("SELECT * FROM piece_glazes WHERE piece_id='a-p'").all();
   assert.equal((await request('/api/pieces/a-p','PUT',{title:'must not persist',...body})).status,400);
   assert.deepEqual(get('pieces','a-p'),before);
   assert.deepEqual(db.prepare("SELECT * FROM piece_glazes WHERE piece_id='a-p'").all(),layers);
  });
 }
 await check('Sale create/update rejects foreign Piece without changing sale or Piece',async()=>{
  const sale=get('sales','a-s'), piece=get('pieces','b-p');
  const count=db.prepare('SELECT count(*) n FROM sales').get().n;
  assert.equal((await request('/api/sales','POST',{pieceId:'b-p',price:2,quantity:1})).status,400);
  assert.equal((await request('/api/sales/a-s','PUT',{pieceId:'b-p',price:2,quantity:1})).status,400);
  assert.deepEqual(get('sales','a-s'),sale);assert.deepEqual(get('pieces','b-p'),piece);
  assert.equal(db.prepare('SELECT count(*) n FROM sales').get().n,count);
 });
 await check('cross-account Firing to Piece rejected on create and update',async()=>{
  assert.equal((await request('/api/firing-logs','POST',{pieceId:'b-p',firingType:'bisque'})).status,400);
  assert.equal((await request('/api/firing-logs/a-f','PUT',{pieceId:'b-p',firingType:'bisque'})).status,400);
  assert.equal(get('firing_logs','a-f').piece_id,'a-p');
 });
 await check('cross-account Test Tile Clay and Glaze IDs rejected',async()=>{
  assert.equal((await request('/api/test-tiles','POST',{name:'bad',clay_body_id:'b-c',clay_name:'manual'})).status,400);
  assert.equal((await request('/api/test-tiles','POST',{name:'bad',glaze_id:'b-g',glaze_name:'manual'})).status,400);
  assert.equal((await request('/api/test-tiles/a-t','PUT',{name:'a',glaze_id:'b-g'})).status,400);
  assert.equal(get('test_tiles','a-t').glaze_id,'a-g');
 });
 await check('legacy Glaze clay-test path rejects foreign Clay',async()=>{
  const n=db.prepare("SELECT count(*) n FROM glaze_clay_tests WHERE glaze_id='a-g'").get().n;
  assert.equal((await request('/api/glazes/a-g/clay-tests','POST',{clay_body_id:'b-c',clay_name:'typed'})).status,400);
  assert.equal(db.prepare("SELECT count(*) n FROM glaze_clay_tests WHERE glaze_id='a-g'").get().n,n);
 });
 await check('Piece and Firing photo uploads cannot attach to foreign parents',async()=>{
  const n=fs.readdirSync(path.join(tmp,'data/uploads')).length;
  assert.equal((await upload('/api/pieces/b-p/photos','photo')).status,404);
  assert.equal((await upload('/api/firing-logs/b-f/photos','photos')).status,404);
  assert.equal(db.prepare("SELECT count(*) n FROM piece_photos WHERE piece_id='b-p'").get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM firing_photos WHERE firing_id='b-f'").get().n,0);
  assert.equal(fs.readdirSync(path.join(tmp,'data/uploads')).length,n);
 });
 await check('Firing photo reads require parent ownership',async()=>{
  db.prepare("INSERT INTO firing_photos(id,firing_id,filename) VALUES('b-fp','b-f','b.jpg')").run();
  assert.equal((await request('/api/firing-logs/b-f/photos')).status,404);
 });
 await check('serializers suppress cross-account relationship expansion',async()=>{
  db.prepare("UPDATE pieces SET clay_body_id='b-c' WHERE id='a-p'").run();
  db.prepare("UPDATE piece_glazes SET glaze_id='b-g',custom_name='Manual survives' WHERE id='a-l'").run();
  db.prepare("UPDATE firing_logs SET piece_id='b-p' WHERE id='a-f'").run();
  db.prepare("UPDATE sales SET piece_id='b-p' WHERE id='a-s'").run();
  db.prepare("UPDATE test_tiles SET clay_body_id='b-c',glaze_id='b-g' WHERE id='a-t'").run();
  db.prepare("INSERT INTO firing_logs(id,user_id,piece_id) VALUES('b-leak','b','a-p')").run();
  let r=await request('/api/pieces/a-p');assert.equal(r.data.clay_body_name,null);assert.equal(r.data.glazes[0].glaze_name,'Manual survives');assert.equal(r.data.glazes[0].brand,null);assert.equal(r.data.firings.some(x=>x.id==='b-leak'),false);
  r=await request('/api/firing-logs/a-f');assert.equal(r.data.piece_title,null);
  r=await request('/api/sales');assert.equal(r.data.find(x=>x.id==='a-s').piece_title,null);
  r=await request('/api/test-tiles/a-t');assert.equal(r.data.clay_library_name,null);assert.equal(r.data.glaze_library_name,null);
  db.prepare("UPDATE pieces SET clay_body_id='a-c' WHERE id='a-p'").run();db.prepare("UPDATE piece_glazes SET glaze_id='a-g' WHERE id='a-l'").run();
  db.prepare("UPDATE firing_logs SET piece_id='a-p' WHERE id='a-f'").run();db.prepare("UPDATE sales SET piece_id='a-p' WHERE id='a-s'").run();
  db.prepare("UPDATE test_tiles SET clay_body_id='a-c',glaze_id='a-g' WHERE id='a-t'").run();db.prepare("DELETE FROM firing_logs WHERE id='b-leak'").run();
 });
 await check('stale missing related records load with manual fallback',async()=>{
  db.pragma('foreign_keys=OFF');db.prepare("UPDATE pieces SET clay_body_id='missing-c' WHERE id='a-p'").run();db.prepare("UPDATE piece_glazes SET glaze_id='missing-g',custom_name='Historical manual' WHERE id='a-l'").run();db.prepare("UPDATE test_tiles SET clay_body_id='missing-c',glaze_id='missing-g',clay_name='Historical clay',glaze_name='Historical glaze' WHERE id='a-t'").run();db.pragma('foreign_keys=ON');
  let r=await request('/api/pieces/a-p');assert.equal(r.status,200);assert.equal(r.data.clay_body_name,null);assert.equal(r.data.glazes[0].glaze_name,'Historical manual');
  r=await request('/api/test-tiles/a-t');assert.equal(r.status,200);assert.equal(r.data.clay_library_name,null);assert.equal(r.data.glaze_library_name,null);assert.equal(r.data.clay_name,'Historical clay');assert.equal(r.data.glaze_name,'Historical glaze');
  db.pragma('foreign_keys=OFF');db.prepare("UPDATE pieces SET clay_body_id='a-c' WHERE id='a-p'").run();db.prepare("UPDATE piece_glazes SET glaze_id='a-g' WHERE id='a-l'").run();db.prepare("UPDATE test_tiles SET clay_body_id='a-c',glaze_id='a-g' WHERE id='a-t'").run();db.pragma('foreign_keys=ON');
 });
 await check('QL same-owner links work and cross-account Piece links fail',async()=>{
  if(!migrated)return;
  assert.ok(link(db,{userId:'a',pieceId:'a-p',kind:'testTile',targetId:'a-t'}));assert.ok(link(db,{userId:'a',pieceId:'a-p',kind:'firing',targetId:'a-f'}));
  assert.throws(()=>link(db,{userId:'a',pieceId:'a-p',kind:'testTile',targetId:'b-t'}),/Record unavailable/);assert.throws(()=>link(db,{userId:'a',pieceId:'a-p',kind:'firing',targetId:'b-f'}),/Record unavailable/);
 });
 await check('valid account deletion removes Phase1 graph and preserves shared file',async()=>{
  seed('delete-ok','d');const shared='shared.jpg';fs.writeFileSync(file(shared),'shared');
  db.prepare("INSERT INTO piece_photos(id,piece_id,filename) VALUES('d-pp','d-p',?)").run(shared);db.prepare("INSERT INTO piece_photos(id,piece_id,filename) VALUES('b-shared','b-p',?)").run(shared);
  for(const [table,id,parent,col,name] of [['clay_photos','d-cp','d-c','clay_id','d-clay.jpg'],['glaze_photos','d-gp','d-g','glaze_id','d-glaze.jpg'],['firing_photos','d-fp','d-f','firing_id','d-fire.jpg']]){
   db.prepare('INSERT INTO '+table+'(id,'+col+',filename) VALUES(?,?,?)').run(id,parent,name);fs.writeFileSync(file(name),'private');
  }
  if(migrated)link(db,{userId:'delete-ok',pieceId:'d-p',kind:'firing',targetId:'d-f'});
  const r=await request('/api/account','DELETE',undefined,'delete-ok');assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(get('users','delete-ok'),undefined);assert.equal(get('test_tiles','d-t'),undefined);
  assert.ok(fs.existsSync(file(shared)));assert.equal(fs.existsSync(file('d-clay.jpg')),false);assert.equal(fs.existsSync(file('d-glaze.jpg')),false);assert.equal(fs.existsSync(file('d-fire.jpg')),false);
 });
 await check('account deletion rejects cross-account relationship before mutation',async()=>{
  seed('delete-bad','x');db.prepare("UPDATE test_tiles SET clay_body_id='x-c' WHERE id='b-t'").run();
  const u=get('users','delete-bad'),p=get('pieces','x-p');const r=await request('/api/account','DELETE',undefined,'delete-bad');assert.equal(r.status,409,JSON.stringify(r.data));
  assert.deepEqual(get('users','delete-bad'),u);assert.deepEqual(get('pieces','x-p'),p);assert.equal(get('test_tiles','b-t').clay_body_id,'x-c');
  db.prepare("UPDATE test_tiles SET clay_body_id='b-c' WHERE id='b-t'").run();
 });
 assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
 console.log('PASS '+passed+' relationship API checks ('+(migrated?'QL':'legacy')+')');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(db)db.close();if(server&&server.exitCode===null)await new Promise(r=>{server.once('exit',r);server.kill();});fs.rmSync(tmp,{recursive:true,force:true});});
