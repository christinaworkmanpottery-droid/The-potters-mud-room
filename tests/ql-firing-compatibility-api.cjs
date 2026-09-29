// Phase 1F relationship service/API checks. Synthetic loopback only; never production.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ql-firing-compat-api-'));
const secret=crypto.randomBytes(32).toString('hex'),adminKey=crypto.randomBytes(32).toString('hex');
const port=44000+crypto.randomInt(7000),base='http://127.0.0.1:'+port;let server,db,output='',passed=0;
const migrated=process.env.QL_TEST_MIGRATION==='1';
const token=owner=>jwt.sign({userId:owner,tier:'starter'},secret);
async function request(route,method='GET',body,owner='a',extraHeaders={}){
 const headers={...extraHeaders};if(owner)headers.Authorization='Bearer '+token(owner);
 if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 let data=null;try{data=await response.json();}catch{} return {status:response.status,data};
}
async function check(name,fn){await fn();passed++;console.log('PASS Phase 1F API: '+name);}
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
 fs.mkdirSync(path.join(tmp,'ql'));fs.copyFileSync(path.join(root,'ql/relationships.cjs'),path.join(tmp,'ql/relationships.cjs'));
 fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});
 for(const name of ['node_modules','public'])fs.symlinkSync(path.join(root,name),path.join(tmp,name),'dir');
 fs.writeFileSync(path.join(tmp,'loopback.cjs'),"const net=require('node:net');const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';return listen.apply(this,args);};");
 server=spawn(process.execPath,['--require','./loopback.cjs','server.js'],{cwd:tmp,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:String(port),APP_URL:base,JWT_SECRET:secret,ADMIN_API_KEY:adminKey},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
 for(let i=0;i<150&&!output.includes('running on');i++){if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
 assert.ok(output.includes('running on'),output);
 db=new Database(path.join(tmp,'data/pottery.db'));db.pragma('foreign_keys=ON');
 if(migrated)require('../ql/relationships.cjs').migrate(db);seed('a','a');seed('b','b');


 db.prepare("INSERT INTO pieces(id,user_id,title) VALUES('a-p2','a','Second'),('a-p3','a','Third')").run();
 const legacy=id=>db.prepare('SELECT * FROM firing_logs WHERE id=?').get(id);
 const qlIds=id=>db.prepare('SELECT piece_id FROM ql_piece_firings WHERE firing_id=? ORDER BY piece_id').all(id).map(r=>r.piece_id);
 let firing;
 await check('legacy API create has same response and reads, with optional pair synchronization',async()=>{
  const r=await request('/api/firing-logs','POST',{pieceId:'a-p',notes:'Original',userId:'b'});
  assert.equal(r.status,200);firing=r.data.id;assert.equal(legacy(firing).user_id,'a');assert.equal(legacy(firing).piece_id,'a-p');
  if(migrated)assert.deepEqual(qlIds(firing),['a-p']);
  assert.equal((await request('/api/firing-logs/'+firing)).data.piece_title,'a Piece');
  assert.ok((await request('/api/pieces/a-p')).data.firings.some(f=>f.id===firing));
 });
 await check('legacy API reassign and repeat remove old pair and preserve additional QL Pieces',async()=>{
  if(migrated)assert.equal((await request('/api/ql/pieces/a-p3/firings','POST',{firingId:firing})).status,201);
  for(let i=0;i<2;i++)assert.equal((await request('/api/firing-logs/'+firing,'PUT',{pieceId:'a-p2',notes:'Edited'})).status,200);
  assert.equal(legacy(firing).piece_id,'a-p2');assert.equal(legacy(firing).notes,'Edited');
  if(migrated){assert.deepEqual(qlIds(firing),['a-p2','a-p3']);assert.equal((await request('/api/ql/pieces/a-p/firings')).data.some(f=>f.id===firing),false);}
 });
 await check('legacy API clear/omitted field keeps full-replacement behavior and additional QL pairs',async()=>{
  for(const body of [{pieceId:null,notes:'Cleared'},{notes:'Omitted'}])assert.equal((await request('/api/firing-logs/'+firing,'PUT',body)).status,200);
  assert.equal(legacy(firing).piece_id,null);if(migrated)assert.deepEqual(qlIds(firing),['a-p3']);
 });
 await check('foreign and absent Piece/Firing writes return identical errors and never change data',async()=>{
  const before=legacy(firing);
  for(const method of ['POST','PUT']){
   const route='/api/firing-logs'+(method==='PUT'?'/'+firing:'');
   const foreign=await request(route,method,{pieceId:'b-p'}),missing=await request(route,method,{pieceId:'missing'});
   assert.equal(foreign.status,400);assert.deepEqual(foreign,missing);
  }
  const foreign=await request('/api/firing-logs/b-f','PUT',{pieceId:'a-p'}),missing=await request('/api/firing-logs/missing','PUT',{pieceId:'a-p'});
  assert.equal(foreign.status,404);assert.deepEqual(foreign,missing);assert.deepEqual(legacy(firing),before);
 });
 if(migrated){
  await check('QL remove dual and legacy-only pairs clears old-client reads and retries are inert',async()=>{
   for(const id of [firing,'a-legacy']){
    if(id===firing)assert.equal((await request('/api/firing-logs/'+id,'PUT',{pieceId:'a-p'})).status,200);
    const route='/api/ql/pieces/a-p/firings/'+id;
    assert.deepEqual((await request(route,'DELETE')).data,{removed:true});assert.deepEqual((await request(route,'DELETE')).data,{removed:false});
    assert.equal(legacy(id).piece_id,null);assert.equal((await request('/api/pieces/a-p')).data.firings.some(f=>f.id===id),false);
   }
   assert.deepEqual(qlIds(firing),['a-p3']);
  });
  await check('sync SQL failure rolls back legacy HTTP create and edit including metadata',async()=>{
   const before=legacy(firing),links=qlIds(firing),count=db.prepare('SELECT count(*) n FROM firing_logs').get().n;
   db.exec("CREATE TRIGGER phase1f_fail BEFORE INSERT ON ql_piece_firings BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
   assert.equal((await request('/api/firing-logs/'+firing,'PUT',{pieceId:'a-p2',notes:'Must roll back'})).status,500);
   assert.equal((await request('/api/firing-logs','POST',{pieceId:'a-p',notes:'Must not exist'})).status,500);
   assert.deepEqual(legacy(firing),before);assert.deepEqual(qlIds(firing),links);assert.equal(db.prepare('SELECT count(*) n FROM firing_logs').get().n,count);
   db.exec('DROP TRIGGER phase1f_fail');
  });
 }
 await check('Piece HTTP delete retains Firing history and explicit Firing delete leaves other Pieces',async()=>{
  assert.equal((await request('/api/firing-logs/'+firing,'PUT',{pieceId:'a-p2',notes:'Retain history'})).status,200);
  assert.equal((await request('/api/pieces/a-p2','DELETE')).status,200);
  assert.equal(legacy(firing).piece_id,null);assert.equal(legacy(firing).notes,'Retain history');if(migrated)assert.deepEqual(qlIds(firing),['a-p3']);
  assert.equal((await request('/api/firing-logs/'+firing,'DELETE')).status,200);assert.equal(legacy(firing),undefined);
  assert.equal((await request('/api/pieces/a-p3')).status,200);if(migrated)assert.deepEqual(qlIds(firing),[]);
  else assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='ql_piece_firings'").get(),undefined);
 });
 console.log('PASS '+passed+' Phase 1F firing compatibility API checks ('+(migrated?'QL':'legacy')+')');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{try{db?.close();}catch{}if(server&&!server.killed)server.kill('SIGTERM');});
