// Phase 3B relationship service/API checks. Synthetic loopback only; never production.
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
 let data=null;try{data=await response.json();}catch{} return {status:response.status,data,available:response.headers.get('X-QL-Relationships-Available')};
}
async function check(name,fn){await fn();passed++;console.log('PASS Phase 3B API: '+name);}
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
 fs.mkdirSync(path.join(tmp,'ql'));fs.copyFileSync(path.join(root,'ql/relationships.cjs'),path.join(tmp,'ql/relationships.cjs'));fs.copyFileSync(path.join(root,'ql/piece-editor.cjs'),path.join(tmp,'ql/piece-editor.cjs'));fs.copyFileSync(path.join(root,'ql/photo-query-safety.cjs'),path.join(tmp,'ql/photo-query-safety.cjs'));fs.copyFileSync(path.join(root,'ql/piece-history.cjs'),path.join(tmp,'ql/piece-history.cjs'));
  fs.copyFileSync(path.join(root,'ql/photo-result-confidence.cjs'),path.join(tmp,'ql/photo-result-confidence.cjs'));
 fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});
 for(const name of ['node_modules','public'])fs.symlinkSync(path.join(root,name),path.join(tmp,name),'dir');
 fs.writeFileSync(path.join(tmp,'loopback.cjs'),"const net=require('node:net');const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';return listen.apply(this,args);};");
 server=spawn(process.execPath,['--require','./loopback.cjs','server.js'],{cwd:tmp,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:String(port),APP_URL:base,JWT_SECRET:secret,ADMIN_API_KEY:adminKey},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
 for(let i=0;i<150&&!output.includes('running on');i++){if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
 assert.ok(output.includes('running on'),output);
 db=new Database(path.join(tmp,'data/pottery.db'));db.pragma('foreign_keys=ON');
 require('../ql/relationships.cjs').migrate(db);seed('a','a');seed('b','b');



 const route='/api/ql/pieces/a-p/firings';
 const post=(id,piece='a-p')=>request('/api/ql/pieces/'+piece+'/firings','POST',{firingId:id,userId:'b'});
 const del=(id,piece='a-p')=>request('/api/ql/pieces/'+piece+'/firings/'+id,'DELETE');
 const ids=async(piece='a-p')=>(await request('/api/ql/pieces/'+piece+'/firings')).data.map(x=>x.id).sort();
 const history=async(piece='a-p')=>(await request('/api/ql/pieces/'+piece+'/history')).data.firings.map(x=>x.sourceRecordId).sort();
 const exists=(table,id)=>db.prepare('SELECT * FROM '+table+' WHERE id=?').get(id);
 db.prepare("INSERT INTO pieces(id,user_id,title,status) VALUES('a-p2','a','Other','done')").run();
 db.prepare("INSERT INTO firing_photos(id,firing_id,filename) VALUES('photo','a-legacy','firing.jpg')").run();
 fs.mkdirSync(path.join(tmp,'data/uploads'),{recursive:true});fs.writeFileSync(path.join(tmp,'data/uploads/firing.jpg'),'protected photo');
 await check('legacy-only remains readable with available signal',async()=>{assert.deepEqual(await ids(),['a-legacy']);assert.equal((await request(route)).available,'true');assert.deepEqual(await history(),['a-legacy']);});
 await check('QL-only explicit Link uses authenticated owner',async()=>{assert.equal((await post('a-f')).status,201);assert.equal(db.prepare("SELECT user_id FROM ql_piece_firings WHERE firing_id='a-f'").get().user_id,'a');assert.equal(exists('firing_logs','a-f').piece_id,null);});
 await check('multiple Firings and matching union deduplicate in History',async()=>{await post('a-legacy');assert.deepEqual(await ids(),['a-f','a-legacy']);assert.deepEqual(await history(),['a-f','a-legacy']);});
 await check('repeated Link idempotent',async()=>{await post('a-f');assert.equal(db.prepare("SELECT count(*) n FROM ql_piece_firings WHERE firing_id='a-f'").get().n,1);});
 await check('one Firing multiple Pieces does not overwrite legacy selection',async()=>{await post('a-legacy','a-p2');assert.equal(exists('firing_logs','a-legacy').piece_id,'a-p');assert.deepEqual(await ids('a-p2'),['a-legacy']);});
 await check('canonical relationship representation equals authorized Firing detail',async()=>{db.prepare("UPDATE firing_logs SET schedule=?,temperature='2200',cone='6',notes='Saved notes',date='2026-09-01' WHERE id='a-legacy'").run('[{\"temperature\":2200}]');const detail=(await request('/api/firing-logs/a-legacy')).data;const linked=(await request(route)).data.find(x=>x.id==='a-legacy');assert.deepEqual(linked,detail);assert.equal(linked.photos[0].photoDelivery,'owner-protected');assert.equal(linked.photos[0].filename,'firing.jpg');assert.equal(linked.temperature,'2200');assert.equal(linked.notes,'Saved notes');});
 await check('protected Firing media retains authorization',async()=>{assert.equal((await request('/api/ql/firing-logs/a-legacy/photos/photo')).status,200);assert.equal((await request('/api/ql/firing-logs/a-legacy/photos/photo','GET',undefined,'b')).status,404);assert.equal((await request('/api/ql/firing-logs/a-legacy/photos/photo','GET',undefined,null)).status,401);});
 for(const id of ['missing','b-p'])await check('foreign/missing Piece '+id,async()=>{for(const method of ['GET','POST','DELETE']){const r=await request('/api/ql/pieces/'+id+'/firings'+(method==='DELETE'?'/a-f':''),method,method==='POST'?{firingId:'a-f'}:undefined);assert.equal(r.status,404);assert.equal(r.data.error,'Relationship unavailable');}});
 for(const id of ['missing','b-f'])await check('foreign/missing Firing '+id,async()=>{assert.equal((await post(id)).status,404);assert.equal((await del(id)).status,404);});
 await check('cross-account link rejection',async()=>{assert.equal((await request(route,'POST',{firingId:'a-f'},'b')).status,404);});
 await check('Unlink clears selected legacy and QL pair preserving other Pieces/photos',async()=>{assert.equal((await del('a-legacy')).data.removed,true);assert.equal(exists('firing_logs','a-legacy').piece_id,null);assert.deepEqual(await ids(),['a-f']);assert.deepEqual(await ids('a-p2'),['a-legacy']);assert.deepEqual(await history(),['a-f']);assert.ok(exists('firing_photos','photo'));assert.ok(fs.existsSync(path.join(tmp,'data/uploads/firing.jpg')));});
 await check('repeated Unlink harmless',async()=>{assert.equal((await del('a-legacy')).data.removed,false);});
 await check('legacy-only Unlink clears matching field',async()=>{db.prepare("UPDATE firing_logs SET piece_id='a-p' WHERE id='a-legacy'").run();await del('a-legacy');assert.equal(exists('firing_logs','a-legacy').piece_id,null);assert.deepEqual(await ids('a-p2'),['a-legacy']);});
 await check('legacy selector reassignment synchronizes affected pairs only',async()=>{await request('/api/firing-logs/a-legacy','PUT',{pieceId:'a-p',firingType:'bisque'});db.prepare("INSERT INTO pieces(id,user_id,title,status) VALUES('a-p3','a','Third','done')").run();await post('a-legacy','a-p3');assert.equal((await request('/api/firing-logs/a-legacy','PUT',{pieceId:'a-p2',firingType:'glaze'})).status,200);assert.deepEqual(await ids(),['a-f']);assert.deepEqual(await ids('a-p2'),['a-legacy']);assert.deepEqual(await ids('a-p3'),['a-legacy']);});
 await check('Piece deletion preserves Firing/photos and other associations',async()=>{await request('/api/pieces/a-p2','DELETE');assert.ok(exists('firing_logs','a-legacy'));assert.ok(exists('firing_photos','photo'));assert.ok(fs.existsSync(path.join(tmp,'data/uploads/firing.jpg')));assert.deepEqual(await ids('a-p3'),['a-legacy']);assert.equal(exists('firing_logs','a-legacy').piece_id,null);});
 await check('Firing deletion preserves Pieces and unrelated associations',async()=>{await post('a-f','a-p3');await request('/api/firing-logs/a-legacy','DELETE');assert.ok(exists('pieces','a-p3'));assert.ok(exists('pieces','a-p'));assert.deepEqual(await ids('a-p3'),['a-f']);assert.deepEqual(await ids(),['a-f']);assert.equal(db.prepare("SELECT count(*) n FROM ql_piece_firings WHERE firing_id='a-legacy'").get().n,0);});
 await check('deleted targets cannot be linked',async()=>{assert.equal((await post('a-legacy')).status,404);assert.equal((await post('a-f','a-p2')).status,404);});
 await check('unavailable tables preserve legacy list and signal false without repair',async()=>{db.exec("DROP TABLE ql_piece_firings; UPDATE firing_logs SET piece_id='a-p' WHERE id='a-f'");const r=await request(route);assert.equal(r.available,'false');assert.deepEqual(r.data.map(x=>x.id),['a-f']);assert.equal(r.data[0].photoDelivery,'owner-protected');assert.equal((await post('a-f')).status,409);assert.equal((await del('a-f')).status,409);assert.equal(exists('firing_logs','a-f').piece_id,'a-p');assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='ql_piece_firings'").get(),undefined);});
 await check('unavailable infrastructure leaves old Firing selector working',async()=>{assert.equal((await request('/api/firing-logs/a-f','PUT',{pieceId:'a-p3',firingType:'bisque'})).status,200);assert.equal(exists('firing_logs','a-f').piece_id,'a-p3');assert.deepEqual(await ids('a-p3'),['a-f']);assert.equal((await request('/api/ql/pieces/b-p/firings')).status,404);});
 console.log('PASS '+passed+' Phase 3B relationship service/API checks');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{try{db?.close();}catch{}if(server&&!server.killed)server.kill('SIGTERM');});
