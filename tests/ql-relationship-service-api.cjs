// Phase 1E relationship service/API checks. Synthetic loopback only; never production.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ql-rel-service-api-'));
const secret=crypto.randomBytes(32).toString('hex'),adminKey=crypto.randomBytes(32).toString('hex');
const port=44000+crypto.randomInt(7000),base='http://127.0.0.1:'+port;let server,db,output='',passed=0;
const token=owner=>jwt.sign({userId:owner,tier:'starter'},secret);
async function request(route,method='GET',body,owner='a',extraHeaders={}){
 const headers={...extraHeaders};if(owner)headers.Authorization='Bearer '+token(owner);
 if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 let data=null;try{data=await response.json();}catch{} return {status:response.status,data};
}
async function check(name,fn){await fn();passed++;console.log('PASS Phase 1E API: '+name);}
function seed(owner,prefix){
 db.prepare('INSERT INTO users(id,email,password_hash,tier) VALUES(?,?,?,?)').run(owner,owner+'@example.invalid','synthetic','starter');
 db.prepare('INSERT INTO pieces(id,user_id,title,status) VALUES(?,?,?,?)').run(prefix+'-p',owner,prefix+' Piece','done');
 db.prepare('INSERT INTO firing_logs(id,user_id,piece_id,notes) VALUES(?,?,?,?)').run(prefix+'-legacy',owner,prefix+'-p','legacy direct link');
 db.prepare('INSERT INTO firing_logs(id,user_id,notes) VALUES(?,?,?)').run(prefix+'-f',owner,'explicit firing');
 db.prepare('INSERT INTO test_tiles(id,user_id,clay_name,glaze_name) VALUES(?,?,?,?)').run(prefix+'-t',owner,'Manual clay','Manual glaze');
 db.prepare('INSERT INTO pricing_calculations(id,user_id,inputs_json,result_json) VALUES(?,?,?,?)').run(prefix+'-pr',owner,'{}','{}');
}
(async()=>{
 for(const name of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,name),path.join(tmp,name));
 fs.mkdirSync(path.join(tmp,'ql'));fs.copyFileSync(path.join(root,'ql/relationships.cjs'),path.join(tmp,'ql/relationships.cjs'));fs.copyFileSync(path.join(root,'ql/piece-editor.cjs'),path.join(tmp,'ql/piece-editor.cjs'));
 fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});
 for(const name of ['node_modules','public'])fs.symlinkSync(path.join(root,name),path.join(tmp,name),'dir');
 fs.writeFileSync(path.join(tmp,'loopback.cjs'),"const net=require('node:net');const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';return listen.apply(this,args);};");
 server=spawn(process.execPath,['--require','./loopback.cjs','server.js'],{cwd:tmp,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:String(port),APP_URL:base,JWT_SECRET:secret,ADMIN_API_KEY:adminKey},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
 for(let i=0;i<150&&!output.includes('running on');i++){if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
 assert.ok(output.includes('running on'),output);
 db=new Database(path.join(tmp,'data/pottery.db'));db.pragma('foreign_keys=ON');
 require('../ql/relationships.cjs').migrate(db);seed('a','a');seed('b','b');

 await check('unauthenticated requests are rejected',async()=>{
  assert.equal((await request('/api/ql/pieces/a-p/firings','GET',undefined,null)).status,401);
  assert.equal((await request('/api/ql/pieces/a-p/firings','POST',{firingId:'a-f'},null)).status,401);
 });
 for(const [pathName,bodyKey,target] of [['firings','firingId','a-f'],['test-tiles','testTileId','a-t'],['pricing','pricingId','a-pr']]){
  await check(pathName+' create/read/remove and duplicate handling',async()=>{
   let r=await request('/api/ql/pieces/a-p/'+pathName,'POST',{[bodyKey]:target,userId:'b',accountId:'b'});
   assert.equal(r.status,201);
   r=await request('/api/ql/pieces/a-p/'+pathName,'POST',{[bodyKey]:target});assert.equal(r.status,201);
   const table=pathName==='firings'?'ql_piece_firings':pathName==='test-tiles'?'ql_piece_test_tiles':'ql_piece_pricing';
   assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table+" WHERE user_id='a'").get().n,1);
   r=await request('/api/ql/pieces/a-p/'+pathName);assert.equal(r.status,200);assert.ok(r.data.some(x=>x.id===target));
   r=await request('/api/ql/pieces/a-p/'+pathName+'/'+target,'DELETE');assert.equal(r.status,200);assert.equal(r.data.removed,true);
   r=await request('/api/ql/pieces/a-p/'+pathName);assert.equal(r.data.some(x=>x.id===target),false);
  });
 }
 await check('legacy firing read-through remains compatible',async()=>{
  const r=await request('/api/ql/pieces/a-p/firings');assert.equal(r.status,200);assert.ok(r.data.some(x=>x.id==='a-legacy'));
 });
 await check('invalid and foreign IDs fail without mutation or ownership disclosure',async()=>{
  for(const [pathName,bodyKey,foreign] of [['firings','firingId','b-f'],['test-tiles','testTileId','b-t'],['pricing','pricingId','b-pr']]){
   assert.equal((await request('/api/ql/pieces/a-p/'+pathName,'POST',{[bodyKey]:'missing'})).status,404);
   assert.equal((await request('/api/ql/pieces/a-p/'+pathName,'POST',{[bodyKey]:foreign})).status,404);
   assert.equal((await request('/api/ql/pieces/a-p/'+pathName+'/'+foreign,'DELETE')).status,404);
  }
  assert.equal((await request('/api/ql/pieces/b-p/firings')).status,404);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ql_piece_firings WHERE user_id='a'").get().n,0);
 });
 await check('safe reads filter corrupt foreign and stale targets',async()=>{
  db.exec('DROP TRIGGER ql_piece_test_tiles_insert; DROP TRIGGER ql_piece_test_tiles_update;');
  db.prepare("INSERT INTO ql_piece_test_tiles(id,user_id,piece_id,test_tile_id) VALUES('corrupt','a','a-p','b-t')").run();
  let r=await request('/api/ql/pieces/a-p/test-tiles');assert.equal(r.status,200);assert.equal(r.data.some(x=>x.id==='b-t'),false);
  db.pragma('foreign_keys=OFF');db.prepare("UPDATE ql_piece_test_tiles SET test_tile_id='missing-t' WHERE id='corrupt'").run();db.pragma('foreign_keys=ON');
  r=await request('/api/ql/pieces/a-p/test-tiles');assert.equal(r.data.some(x=>x.id==='missing-t'),false);
 });
 await check('failed relationship mutation rolls back cleanly',async()=>{
  db.exec("CREATE TRIGGER phase1e_fail BEFORE INSERT ON ql_piece_firings BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  const before=db.prepare('SELECT COUNT(*) n FROM ql_piece_firings').get().n;
  const r=await request('/api/ql/pieces/a-p/firings','POST',{firingId:'a-f'});assert.equal(r.status,500);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM ql_piece_firings').get().n,before);
  db.exec('DROP TRIGGER phase1e_fail');
 });
 await check('client ownership spoofing never changes server-derived owner',async()=>{
  const r=await request('/api/ql/pieces/a-p/pricing','POST',{pricingId:'a-pr',userId:'b',accountId:'b',ownerId:'b'});
  assert.equal(r.status,201);
  const row=db.prepare("SELECT * FROM ql_piece_pricing WHERE piece_id='a-p' AND pricing_id='a-pr'").get();
  assert.equal(row.user_id,'a');
 });
 console.log('PASS '+passed+' Phase 1E relationship service/API checks');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{try{db?.close();}catch{}if(server&&!server.killed)server.kill('SIGTERM');});
