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
async function start(core, web) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(),'ql-search-'));
  secret = crypto.randomBytes(32).toString('hex');
  for (const file of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs']) fs.copyFileSync(path.join(root,file),path.join(dir,file));
  fs.cpSync(path.join(root,'ql'),path.join(dir,'ql'),{recursive:true,filter:p=>!p.includes(path.sep+'evidence')});
  fs.cpSync(path.join(root,'geodata'),path.join(dir,'geodata'),{recursive:true});
  for (const folder of ['node_modules','public']) fs.symlinkSync(path.join(root,folder),path.join(dir,folder),'dir');
  fs.writeFileSync(path.join(dir,'port.cjs'),"const net=require('net'),listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...a){this.once('listening',()=>require('fs').writeFileSync('port',String(this.address().port)));return listen.apply(this,a)};");
  let log='';
  server=spawn(process.execPath,['--require','./port.cjs','server.js'],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'test',QL_ASSISTANT_CORE_ENABLED:core,QL_ASSISTANT_WEB_ENABLED:web,PORT:'0',JWT_SECRET:secret,ADMIN_API_KEY:crypto.randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe']});
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
}
async function stop(){
  if(db?.open) db.close();
  if(server && server.exitCode===null) { const done=new Promise(resolve=>server.once('exit',resolve));server.kill();await done; }
  if(dir) fs.rmSync(dir,{recursive:true,force:true});
}
for (const [core,web,enabled] of [['0','0',false],['1','0',false],['0','1',false],['1','1',true]]) {
 test(`server flag combination core=${core} web=${web}`,async()=>{
  try {
   await start(core,web);
   const r=await fetch(base+'/api/ql/assistant/config');
   assert.deepEqual(await r.json(),{enabled,voiceEnabled:false,handsFreeEnabled:false});assert.match(r.headers.get('cache-control'),/no-store/);
   if(enabled) {
    const {JSDOM}=require('jsdom');
    const dom=new JSDOM(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),{url:base,runScripts:'outside-only',pretendToBeVisual:true});
    try {
     const w=dom.window;w.localStorage.setItem('mudlog_token',token);
     w.eval(`var token=${JSON.stringify(token)},currentUser={id:'a'},API='',currentPage='qlAssistant';function navigate(p){QLAssistant.onNavigate(p);currentPage=p;if(p==='qlAssistant')QLAssistant.enter();}function closeNav(){}`);
     w.fetch=(url,opts)=>fetch(base+url,opts);
     w.eval(fs.readFileSync(path.join(root,'public/ql-assistant.js'),'utf8'));
     for(let i=0;i<100&&!w.document.getElementById('qlAssistantEntry');i++)await pause(10);
     assert.ok(w.document.getElementById('qlAssistantEntry'));
     w.navigate('qlAssistant');const form=w.document.getElementById('qlAssistantForm');
     const input=w.document.getElementById('qlAssistantInput'),output=w.document.getElementById('qlAssistantResponse');
     async function send(text){input.value=text;form.requestSubmit();for(let i=0;i<100&&form.getAttribute('aria-busy')==='true';i++)await pause(10);}
     await send('When was my last firing?');assert.equal(output.textContent,'Your latest recorded firing date is 2026-10-01.');
     db.prepare("DELETE FROM firing_logs WHERE user_id='a'").run();
     await send('last firing');assert.equal(output.textContent,'No recorded firing was found.');
     await send('What glaze did I use?');assert.match(output.textContent,/isn’t supported/);
    } finally {dom.window.close();}
   }
  } finally {await stop();}
 });
}
