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

for(const [type] of fixtures) test(type+' searches own canonical record only',async()=>{
  const result=await request('?q=celadon&types='+type);
  assert.equal(result.status,200);
  assert.equal(result.cache,'private, no-store');
  assert.deepEqual(result.data.results.map(r=>[r.recordType,r.sourceRecordId]),[[type,'a-'+type]]);
  assert.deepEqual(Object.keys(result.data.results[0]).sort(),['excerpt','matchedFields','recordType','sourceRecordId','title']);
});
test('all categories are searched and foreign account has only its own results',async()=>{
  assert.equal(search({}).results.length,11);
  const result=await request('?q=celadon',foreignToken);
  assert.equal(result.data.results.length,11);
  assert.ok(result.data.results.every(r=>r.sourceRecordId.startsWith('b-')));
});
test('public Piece and corrupt foreign Clay relationship do not broaden scope',()=>{
  db.prepare("UPDATE pieces SET is_public=1 WHERE user_id='b'").run();
  db.prepare("UPDATE pieces SET clay_body_id='b-clay' WHERE user_id='a'").run();
  db.prepare("UPDATE clay_bodies SET name='foreign-secret' WHERE id='b-clay'").run();
  assert.deepEqual(search({q:'foreign-secret'}).results,[]);
  assert.equal(search({types:'piece'}).results.length,1);
});
test('current Test Tile tier revocation overrides stale JWT without counts or snippets',async()=>{
  db.prepare("UPDATE users SET tier='free' WHERE id='a'").run();
  const result=await request('?q=celadon');
  assert.equal(result.status,200);
  assert.deepEqual(result.data.lockedTypes,['test-tile']);
  assert.equal(result.data.results.length,10);
  assert.equal(JSON.stringify(result.data.results).includes('a-test-tile'),false);
  const only=await request('?q=celadon&types=test-tile');
  assert.deepEqual(only.data.results,[]);assert.equal(only.data.hasMore,false);
  assert.equal(only.data.nextOffset,null);
  db.prepare("UPDATE users SET tier='starter' WHERE id='a'").run();
  assert.equal((await request('?q=celadon&types=test-tile')).data.results.length,1);
});
test('missing, invalid and deleted-account credentials fail closed with no-store',async()=>{
  for(const candidate of [null,'bad',jwt.sign({userId:'deleted'},secret),jwt.sign({userId:'a'},secret,{expiresIn:-1})]) {
    const result=await request('?q=celadon',candidate);assert.equal(result.status,401);assert.equal(result.cache,'private, no-store');
  }
});
test('invalid and structured query parameters are rejected',async()=>{
  for(const params of ['','?q=x','?q=','?q[]=celadon','?q=celadon&q=piece','?q=celadon&types[]=piece','?q=celadon&types=users','?q=celadon&types=','?q=celadon&limit=-1','?q=celadon&limit=51','?q=celadon&limit=1.5','?q=celadon&offset=9999','?q=celadon&offset[]=0','?q='+('a'.repeat(121)),'?q=a+b+c+d+e+f+g+h+i','?q=blue%00green']) {
    const result=await request(params);assert.equal(result.status,400,params);
  }
});
test('SQL syntax, percent and underscore are literal search content',()=>{
  add('pieces',{id:'literal',user_id:'a',title:'100%_ pot'});
  assert.deepEqual(search({q:'%_',types:'piece'}).results.map(r=>r.sourceRecordId),['literal']);
  assert.deepEqual(search({q:"' OR 1=1 --"}).results,[]);
});
test('Unicode case and canonical accents are handled, tokens can match different fields',()=>{
  add('pieces',{id:'unicode',user_id:'a',title:'CAFÉ mug',notes:'green handle'});
  const result=search({q:'cafe\u0301 green',types:'piece'}).results;
  assert.equal(result.length,1);assert.equal(result[0].sourceRecordId,'unicode');
  assert.deepEqual(result[0].matchedFields,['title','notes']);
  assert.equal(search({q:'café purple',types:'piece'}).results.length,0);
});
test('exact title precedes title phrase and body-only hits; pagination is stable',()=>{
  add('pieces',{id:'rank-body',user_id:'a',title:'Aaa',notes:'needle'});
  add('pieces',{id:'rank-phrase',user_id:'a',title:'needle bowl'});
  add('pieces',{id:'rank-exact',user_id:'a',title:'needle'});
  const ids=[];
  for(let offset=0;offset<3;offset++) {
    const result=search({q:'needle',limit:'1',offset:String(offset)});
    ids.push(result.results[0].sourceRecordId);assert.equal(result.hasMore,offset<2);
    assert.equal(result.nextOffset,offset<2?offset+1:null);
  }
  assert.deepEqual(ids,['rank-exact','rank-phrase','rank-body']);
});
test('same IDs in different categories are not collapsed',()=>{
  add('pieces',{id:'same-id',user_id:'a',title:'identical'});
  add('clay_bodies',{id:'same-id',user_id:'a',name:'identical'});
  assert.deepEqual(search({q:'identical'}).results.map(r=>r.recordType),['clay','piece']);
});
test('long matched notes produce a bounded contextual excerpt without HTML generation',()=>{
  add('pieces',{id:'long-notes',user_id:'a',title:'Context',notes:'z'.repeat(1000)+' <script>needleunique</script> '+'z'.repeat(300)});
  const result=search({q:'needleunique'}).results[0];
  assert.ok(result.excerpt.length<=182);assert.match(result.excerpt,/needleunique/);
  assert.match(result.excerpt,/<script>/); // Plain text: clients MUST use textContent, not HTML.
});
test('queries do not change schema, records, media references or entitlement state',()=>{
  const snapshot=()=>JSON.stringify({schema:db.prepare('SELECT sql FROM sqlite_master ORDER BY name').all(),rows:fixtures.map(([,table])=>db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()),users:db.prepare('SELECT * FROM users ORDER BY id').all()});
  const before=snapshot();for(const q of ['celadon','needle','café','missing']) search({q});
  assert.equal(snapshot(),before);
});
test('fresh rename and deletion appear without an index rebuild or stale cache',async()=>{
  add('pieces',{id:'fresh',user_id:'a',title:'old-uniquename'});
  assert.equal((await request('?q=old-uniquename')).data.results.length,1);
  db.prepare("UPDATE pieces SET title='new-uniquename' WHERE id='fresh'").run();
  assert.equal((await request('?q=old-uniquename')).data.results.length,0);
  assert.equal((await request('?q=new-uniquename')).data.results.length,1);
  db.prepare("DELETE FROM pieces WHERE id='fresh'").run();
  assert.equal((await request('?q=new-uniquename')).data.results.length,0);
});
test('result-window cap is explicit and never emits an unusable next offset',()=>{
  db.transaction(()=>{for(let i=0;i<1002;i++) add('pieces',{id:'cap-'+String(i).padStart(4,'0'),user_id:'a',title:'windowcap'});})();
  const result=search({q:'windowcap',offset:'950',limit:'50'});
  assert.equal(result.results.length,50);assert.equal(result.hasMore,true);assert.equal(result.capped,true);assert.equal(result.nextOffset,null);
});
