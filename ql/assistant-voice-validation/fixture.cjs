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
const root = path.resolve(__dirname,'../..');
let dir,server,db,base,token,foreignToken,secret;
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const add = (table,values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values));
async function start(core, web, voice, handsFree = '0') {
  dir = fs.mkdtempSync(path.join(os.tmpdir(),'ql-search-'));
  secret = crypto.randomBytes(32).toString('hex');
  for (const file of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs']) fs.copyFileSync(path.join(root,file),path.join(dir,file));
  fs.cpSync(path.join(root,'ql'),path.join(dir,'ql'),{recursive:true,filter:p=>!p.includes(path.sep+'evidence')});
  fs.cpSync(path.join(root,'geodata'),path.join(dir,'geodata'),{recursive:true});
  for (const folder of ['node_modules','public']) fs.symlinkSync(path.join(root,folder),path.join(dir,folder),'dir');
  fs.writeFileSync(path.join(dir,'port.cjs'),"const net=require('net'),listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...a){this.once('listening',()=>require('fs').writeFileSync('port',String(this.address().port)));return listen.apply(this,a)};");
  let log='';
  server=spawn(process.execPath,['--require','./port.cjs','server.js'],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'test',QL_ASSISTANT_CORE_ENABLED:core,QL_ASSISTANT_WEB_ENABLED:web,QL_ASSISTANT_VOICE_WEB_ENABLED:voice,QL_ASSISTANT_HANDS_FREE_WEB_ENABLED:handsFree,NODE_OPTIONS:'--require '+path.join(root,'ql/rehearsal/suite-isolate.cjs'),PORT:'0',JWT_SECRET:secret,ADMIN_API_KEY:crypto.randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe']});
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

module.exports={start,stop,get state(){return {base,token,foreignToken,db,dir}}};
