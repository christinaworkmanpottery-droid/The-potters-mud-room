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
const {createStudioSearchService} = require('../ql/studio-search.cjs');
const root = path.resolve(__dirname,'..');
let dir,server,db,base,service,token,foreignToken,secret;
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
const fixtures = [
  ['piece','pieces','title',{}], ['clay','clay_bodies','name',{}],
  ['glaze','glazes','name',{}], ['raw-material','glaze_chemicals','name',{}],
  ['test-tile','test_tiles','name',{}], ['firing','firing_logs','kiln_name',{}],
  ['pricing','pricing_calculations','name',{inputs_json:'{}',result_json:'{}'}],
  ['sale','sales','venue',{}], ['project','projects','title',{}],
  ['contact','contacts','name',{}], ['event','events','title',{event_date:'2026-09-30'}]
];
const add = (table,values) => db.prepare(`INSERT INTO ${table} (${Object.keys(values).join(',')}) VALUES (${Object.keys(values).map(()=>'?').join(',')})`).run(...Object.values(values));
const search = input => service.search({userId:'a',q:'celadon',...input});
async function request(query,authToken=token) {
  const response = await fetch(base+'/api/ql/search'+query,{headers:authToken?{Authorization:'Bearer '+authToken}:{}});
  return {status:response.status,cache:response.headers.get('cache-control'),data:await response.json()};
}
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(),'ql-search-'));
  secret = crypto.randomBytes(32).toString('hex');
  for (const file of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs']) fs.copyFileSync(path.join(root,file),path.join(dir,file));
  fs.cpSync(path.join(root,'ql'),path.join(dir,'ql'),{recursive:true,filter:p=>!p.includes(path.sep+'evidence')});
  fs.cpSync(path.join(root,'geodata'),path.join(dir,'geodata'),{recursive:true});
  for (const folder of ['node_modules','public']) fs.symlinkSync(path.join(root,folder),path.join(dir,folder),'dir');
  fs.writeFileSync(path.join(dir,'port.cjs'),"const net=require('net'),listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...a){this.once('listening',()=>require('fs').writeFileSync('port',String(this.address().port)));return listen.apply(this,a)};");
  let log='';
  server=spawn(process.execPath,['--require','./port.cjs','server.js'],{cwd:dir,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:'0',JWT_SECRET:secret,ADMIN_API_KEY:crypto.randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe']});
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
  for(const [type,table,title,extra] of fixtures) for(const owner of ['a','b']) add(table,{id:owner+'-'+type,user_id:owner,[title]:'Celadon '+type,...extra});
  token=jwt.sign({userId:'a',tier:'starter'},secret);
  foreignToken=jwt.sign({userId:'b'},secret);
  service=createStudioSearchService(db);
});
test.after(async()=>{
  if(db?.open) db.close();
  if(server && server.exitCode===null) { const done=new Promise(resolve=>server.once('exit',resolve));server.kill();await done; }
  if(dir) fs.rmSync(dir,{recursive:true,force:true});
});


// Drive the actual Search UI against disposable HTTP canonical APIs, including
// mutations between search and navigation. Search-1's regressions stay untouched.
const {JSDOM}=require('jsdom');
const destinations={piece:'pieceDetailContent',clay:'clayViewBody',glaze:'glazeViewBody','raw-material':'studioSearchDetail','test-tile':'testTileViewBody',firing:'firingViewBody',pricing:'studioSearchDetail',sale:'saleDetailsContent',project:'studioSearchDetail',contact:'studioSearchDetail',event:'studioSearchDetail'};
async function browser(t){
 const w=new JSDOM(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),{url:base,runScripts:'outside-only'}).window;
 t.after(()=>w.close());w.setInterval=()=>0;w.scrollTo=()=>{};w.URL.createObjectURL=()=> 'blob:fixture';w.URL.revokeObjectURL=()=>{};
 w.fetch=async()=>({ok:true,status:200,json:async()=>[]});
 w.eval(fs.readFileSync(path.join(root,'public/website-utils.js'),'utf8'));
 w.eval(fs.readFileSync(path.join(root,'public/app.js'),'utf8')+'\nwindow.installSession=(v,id)=>{token=v;currentUser={id,tier:"starter"};localStorage.setItem("mudlog_token",v);};\n'+fs.readFileSync(path.join(root,'public/studio-search.js'),'utf8'));
 await pause(20);w.installSession(token,'a');
 w.fetch=(url,opts={})=>{assert.ok(String(url).startsWith('/'),'Only local API calls');return fetch(base+url,{...opts,signal:undefined});};
 w.navigate('studioSearch');
 const el=id=>w.document.getElementById(id);
 const run=async type=>{el('studioSearchInput').value='celadon';el('studioSearchType').value=type;el('studioSearchForm').dispatchEvent(new w.Event('submit',{cancelable:true}));for(let i=0;i<200&&el('studioSearchResults').getAttribute('aria-busy')==='true';i++)await pause(10);};
 return {w,el,run};
}
for(const [type] of fixtures)test('HTTP Search to canonical '+type+' viewer',async t=>{
 const b=await browser(t);await b.run(type);assert.equal(b.el('studioSearchResults').querySelectorAll('button').length,1);
 await b.w.StudioSearch.open(type,'a-'+type);await pause(30);
 assert.doesNotMatch(b.el('studioSearchDetail').textContent,/unavailable|Unable/);
 assert.ok(b.el(destinations[type]).textContent.trim().length>0);
 assert.doesNotMatch(b.el(destinations[type]).textContent,/user_id|password_hash|stripe_customer/);
 b.w.StudioSearch.back();
});
for(const [type,table,title] of fixtures)test('HTTP '+type+' ownership changes after search fail closed',async t=>{
 const b=await browser(t);await b.run(type);db.prepare('UPDATE '+table+' SET user_id=? WHERE id=?').run('b','a-'+type);
 try{await b.w.StudioSearch.open(type,'a-'+type);assert.match(b.el('studioSearchDetail').textContent,/Record unavailable/);assert.equal(b.el('studioSearchResults').querySelectorAll('button').length,0);}finally{db.prepare('UPDATE '+table+' SET user_id=? WHERE id=?').run('a','a-'+type);}
});
test('HTTP fresh rename wins over Search metadata',async t=>{const b=await browser(t);await b.run('contact');db.prepare("UPDATE contacts SET name='Renamed after search' WHERE id='a-contact'").run();try{await b.w.StudioSearch.open('contact','a-contact');assert.match(b.el('studioSearchDetail').textContent,/Renamed after search/);}finally{db.prepare("UPDATE contacts SET name='Celadon contact' WHERE id='a-contact'").run();}});
test('HTTP lost Test Tile entitlement clears searched tile and denies canonical viewer',async t=>{const b=await browser(t);await b.run('test-tile');db.prepare("UPDATE users SET tier='free' WHERE id='a'").run();try{await b.w.StudioSearch.open('test-tile','a-test-tile');assert.match(b.el('studioSearchDetail').textContent,/Record unavailable/);assert.match(b.el('studioSearchLocked').textContent,/unavailable/);assert.equal(b.el('testTileViewBody').textContent,'');await b.run('');assert.doesNotMatch(b.el('studioSearchResults').textContent,/Celadon test-tile/);}finally{db.prepare("UPDATE users SET tier='starter' WHERE id='a'").run();}});
test('HTTP canonical deleted Contact after search fails closed',async t=>{const b=await browser(t);await b.run('contact');const saved=db.prepare("SELECT * FROM contacts WHERE id='a-contact'").get();db.prepare("DELETE FROM contacts WHERE id='a-contact'").run();try{await b.w.StudioSearch.open('contact','a-contact');assert.match(b.el('studioSearchDetail').textContent,/Record unavailable/);}finally{add('contacts',saved);}});
test('HTTP new account cannot reuse prior results or open former account record',async t=>{const b=await browser(t);await b.run('contact');b.w.installSession(foreignToken,'b');b.w.StudioSearch.syncSession();assert.equal(b.el('studioSearchResults').textContent,'');await b.w.StudioSearch.open('contact','a-contact');assert.match(b.el('studioSearchDetail').textContent,/Record unavailable/);await b.run('contact');assert.equal(b.el('studioSearchResults').querySelectorAll('button').length,1);});
