'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const root = path.resolve(__dirname,'..');
let dir,server,db,base,token,foreignToken,secret;
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const add = (table,values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values));
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(),'ql-search-'));
  secret = crypto.randomBytes(32).toString('hex');
  for (const file of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs']) fs.copyFileSync(path.join(root,file),path.join(dir,file));
  fs.cpSync(path.join(root,'ql'),path.join(dir,'ql'),{recursive:true,filter:p=>!p.includes(path.sep+'evidence')});
  fs.cpSync(path.join(root,'geodata'),path.join(dir,'geodata'),{recursive:true});
  for (const folder of ['node_modules','public']) fs.symlinkSync(path.join(root,folder),path.join(dir,folder),'dir');
  fs.writeFileSync(path.join(dir,'port.cjs'),"const net=require('net'),listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...a){this.once('listening',()=>require('fs').writeFileSync('port',String(this.address().port)));return listen.apply(this,a)};");
  let log='';
  server=spawn(process.execPath,['--require','./port.cjs','server.js'],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'test',QL_ASSISTANT_CORE_ENABLED:'1',PORT:'0',JWT_SECRET:secret,ADMIN_API_KEY:crypto.randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',chunk=>log+=chunk);server.stderr.on('data',chunk=>log+=chunk);
  for(let i=0;i<600;i++) {
    if(server.exitCode!==null) throw Error(log);
    if(fs.existsSync(path.join(dir,'port')) && /\[Startup\] (All .*photos already|Backfill complete:)/.test(log)) break;
    await pause(25);
  }
  assert.ok(fs.existsSync(path.join(dir,'port')),log);
  base='http://127.0.0.1:'+fs.readFileSync(path.join(dir,'port'),'utf8');
  db=new Database(path.join(dir,'data/pottery.db'));
  db.pragma('foreign_keys=ON');
  for(const id of ['a','b']) add('users',{id,email:id+'@example.invalid',password_hash:'synthetic',tier:'starter',billing_period:'promo'});
  for(const owner of ['a','b']) add('firing_logs',{id:owner+'-firing',user_id:owner,date:'2026-10-01'});
  token=jwt.sign({userId:'a',tier:'starter'},secret);
  foreignToken=jwt.sign({userId:'b'},secret);
});
test.after(async()=>{
  if(db?.open) db.close();
  if(server && server.exitCode===null) { const done=new Promise(resolve=>server.once('exit',resolve));server.kill();await done; }
  if(dir) fs.rmSync(dir,{recursive:true,force:true});
});



const proof={version:1,requestId:'integration',input:{text:'When was my last firing?'}};
async function ask(authToken=token,body=proof){const r=await fetch(base+'/api/ql/assistant/turn',{method:'POST',headers:{'Content-Type':'application/json',...(authToken?{Authorization:'Bearer '+authToken}:{})},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
test('actual server complete flow agrees with canonical firing list',async()=>{
 db.prepare('UPDATE firing_logs SET date=? WHERE user_id=?').run('2026-10-01','a');
 db.prepare('UPDATE firing_logs SET date=? WHERE user_id=?').run('2026-11-01','b');
 const list=await fetch(base+'/api/firing-logs',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
 const a=await ask();assert.equal(a.status,200);assert.equal(a.data.result.date,list[0].date);
 const b=await ask(foreignToken);assert.equal(b.data.result.date,'2026-11-01');
 const after=await fetch(base+'/api/firing-logs',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());assert.deepEqual(after,list);
});
test('actual server refuses missing and expired auth',async()=>{
 assert.equal((await ask(null)).status,401);assert.equal((await ask(jwt.sign({userId:'a'},secret,{expiresIn:-1}))).status,401);
});
test('actual server rejects cross-account arguments',async()=>{
 assert.equal((await ask(token,{...proof,input:{command:{name:'studio.firing.latest',arguments:{id:'b-firing'}}}})).status,400);
});

test('HTTP conversation selects an owned Piece then rereads canonical relationships',async()=>{
 add('pieces',{id:'a-blue',user_id:'a',title:'Blue bowl'});
 add('pieces',{id:'b-blue',user_id:'b',title:'Blue secret'});
 add('glazes',{id:'a-ocean',user_id:'a',name:'Ocean'});
 add('piece_glazes',{id:'a-layer',piece_id:'a-blue',glaze_id:'a-ocean'});
 db.prepare("UPDATE firing_logs SET piece_id='a-blue' WHERE id='a-firing'").run();
 const turn=(text,context={token:null},auth=token)=>ask(auth,{version:1,requestId:'ctx-http',input:{text},context});
 let r=await turn('Open my pieces');assert.equal(r.status,200);
 r=await turn('Show me the blue one',r.data.context);assert.equal(r.data.response.navigation.id,'a-blue');
 const context=r.data.context;
 const canonical=await fetch(base+'/api/pieces/a-blue',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());assert.equal(canonical.id,r.data.response.navigation.id);
 r=await turn('What glaze did I use on that?',context);assert.deepEqual(r.data.result.glazes,['Ocean']);
 r=await turn('When did I fire it?',r.data.context);assert.deepEqual(r.data.result.dates,['2026-10-01']);
 assert.equal((await turn('When did I fire it?',context,foreignToken)).data.result.status,'clarification');
 assert.equal((await turn('When did I fire it?',context,null)).status,401);
 assert.equal((await turn('Delete it',context)).status,400);
 db.prepare("DELETE FROM piece_glazes WHERE id='a-layer'").run();
 assert.equal((await turn('What glaze did I use on that?',context)).data.result.status,'empty');
});
