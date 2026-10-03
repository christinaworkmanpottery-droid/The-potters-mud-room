'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {createAssistantCore,validateIntent,validateRequest}=require('../ql/assistant/core.cjs');
const {createContextStore}=require('../ql/assistant/conversation.cjs');
let db,dir,core;
const add=(table,data)=>db.prepare(`INSERT INTO ${table} (${Object.keys(data).join(',')}) VALUES (${Object.keys(data).map(()=>'?')})`).run(...Object.values(data));
const ask=(text,context={token:null},userId='a',c=core)=>c.turn({authorize:()=>userId,request:{version:1,requestId:'conversation',input:{text},context}});
test.before(()=>{
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'ql-4i-'));
 fs.copyFileSync(path.join(__dirname,'../database.js'),path.join(dir,'database.js'));
 fs.symlinkSync(path.join(__dirname,'../node_modules'),path.join(dir,'node_modules'),'dir');
 db=require(path.join(dir,'database.js')).initDB();core=createAssistantCore(db);
 for(const id of ['a','b'])add('users',{id,email:id+'@example.invalid',password_hash:'synthetic',tier:'free'});
 for(const owner of ['a','b']) {
  add('pieces',{id:owner+'-blue',user_id:owner,title:'Blue bowl',notes:owner==='b'?'private foreign note':'saved blue piece'});
  add('glazes',{id:owner+'-glaze',user_id:owner,name:owner==='a'?'Ocean':'Foreign private glaze'});
  add('piece_glazes',{id:owner+'-layer',piece_id:owner+'-blue',glaze_id:owner+'-glaze',layer_order:1});
  add('firing_logs',{id:owner+'-fire',user_id:owner,piece_id:owner+'-blue',date:owner==='a'?'2026-10-01':'2026-09-01'});
 }
 add('pieces',{id:'a-white',user_id:'a',title:'White cup'});
});
test.after(()=>{db?.close();fs.rmSync(dir,{recursive:true,force:true});});
test('complete natural follow-up chain uses saved piece relationships',async()=>{
 let r=await ask('Open my pieces');
 r=await ask('Show me the blue one',r.context);assert.equal(r.response.navigation.id,'a-blue');
 r=await ask('What glaze did I use on that?',r.context);assert.deepEqual(r.result.glazes,['Ocean']);
 r=await ask('When did I fire it?',r.context);assert.deepEqual(r.result.dates,['2026-10-01']);
 r=await ask('Open it',r.context);assert.equal(r.response.navigation.id,'a-blue');
 r=await ask('Go back to my glazes',r.context);assert.equal(r.response.navigation.page,'glazes');
 r=await ask('When did I fire it?',r.context);assert.equal(r.result.status,'clarification');assert.equal(r.response.navigation,undefined);
});
test('direct piece search establishes focus; title color must be saved text',async()=>{
 const r=await ask('Find blue pieces');assert.equal(r.response.navigation.id,'a-blue');
 const start=await ask('Open my pieces');const absent=await ask('Show me the purple one',start.context);
 assert.equal(absent.result.status,'empty');assert.match(absent.response.text,/cannot identify a color from photos/);
 assert.equal((await ask('When did I fire it?',absent.context)).result.status,'clarification');
});
test('multiple matches do not guess; ordinal uses announced choice list',async()=>{
 add('pieces',{id:'a-blue2',user_id:'a',title:'Blue vase'});
 try {
  const r=await ask('Find blue pieces');assert.equal(r.result.status,'choices');assert.match(r.response.text,/1\. Blue bowl; 2\. Blue vase/);
  assert.equal(r.response.navigation.kind,'search');
  assert.equal((await ask('What glaze did I use on that?',r.context)).result.status,'clarification');
  const choice=await ask('The second one',r.context);assert.equal(choice.response.navigation.id,'a-blue2');
  const empty=await ask('What glaze did I use on that?',choice.context);assert.equal(empty.result.status,'empty');assert.match(empty.response.text,/No glaze layers/);
  assert.match((await ask('When did I fire it?',choice.context)).response.text,/No firings are linked/);
  assert.equal((await ask('The fifth one',r.context)).result.status,'clarification');
 } finally {db.prepare("DELETE FROM pieces WHERE id='a-blue2'").run();}
});
test('capped result lists remain ambiguous and bounded',async()=>{
 for(let i=0;i<7;i++)add('pieces',{id:'many'+i,user_id:'a',title:'Many '+i});
 try {const r=await ask('Find many pieces');assert.equal(r.result.hasMore,true);assert.equal(r.result.results.length,5);assert.match(r.response.text,/More than five/);assert.equal(r.response.navigation.kind,'search');}
 finally {db.prepare("DELETE FROM pieces WHERE id LIKE 'many%'").run();}
});
test('missing, foreign, unknown, expired and restarted contexts fail closed',async()=>{
 const a=await ask('Find blue pieces');
 for(const ctx of [{token:null},{token:'f'.repeat(48)}])assert.equal((await ask('When did I fire it?',ctx)).result.status,'clarification');
 const b=await ask('What glaze did I use on that?',a.context,'b');assert.equal(b.result.status,'clarification');assert.doesNotMatch(JSON.stringify(b),/Ocean|a-blue/);
 const restarted=await ask('When did I fire it?',a.context,'a',createAssistantCore(db));assert.equal(restarted.result.status,'clarification');
 let time=0;const store=createContextStore({now:()=>time,ttl:10,max:2});const first=store.save('a',{pieceId:'a-blue'});assert.equal(store.read(first.token,'b'),null);time=10;assert.equal(store.read(first.token,'a'),null);
 const old=store.save('a',{});store.save('a',{});store.save('a',{});assert.equal(store.read(old.token,'a'),null);
});
test('deleted or transferred piece cannot be read from an old reference',async()=>{
 add('pieces',{id:'temporary',user_id:'a',title:'Ephemeral piece'});
 const r=await ask('Find ephemeral pieces');db.prepare("UPDATE pieces SET user_id='b' WHERE id='temporary'").run();
 assert.equal((await ask('When did I fire it?',r.context)).result.status,'clarification');
 db.prepare("DELETE FROM pieces WHERE id='temporary'").run();assert.equal((await ask('Open it',r.context)).result.status,'clarification');
});
test('relationship reads are fresh and never leak another owner',async()=>{
 const r=await ask('Find blue pieces');
 add('piece_glazes',{id:'cross-layer',piece_id:'a-blue',glaze_id:'b-glaze'});
 add('firing_logs',{id:'cross-fire',user_id:'b',piece_id:'a-blue',date:'2099-01-01'});
 db.prepare("UPDATE glazes SET name='Ocean updated' WHERE id='a-glaze'").run();
 try {assert.deepEqual((await ask('What glaze did I use on that?',r.context)).result.glazes,['Ocean updated']);assert.deepEqual((await ask('When did I fire it?',r.context)).result.dates,['2026-10-01']);}
 finally {db.prepare("DELETE FROM piece_glazes WHERE id='cross-layer'").run();db.prepare("DELETE FROM firing_logs WHERE id='cross-fire'").run();db.prepare("UPDATE glazes SET name='Ocean' WHERE id='a-glaze'").run();}
});
test('custom glaze labels and missing firing dates are factual, not inferred',async()=>{
 const r=await ask('Find blue pieces');add('piece_glazes',{id:'custom',piece_id:'a-blue',custom_name:'My mix',layer_order:2});
 add('firing_logs',{id:'undated',user_id:'a',piece_id:'a-blue',date:'not a date'});
 try {assert.deepEqual((await ask('Which glazes did I use on it?',r.context)).result.glazes,['Ocean','My mix']);assert.match((await ask('When was that fired?',r.context)).response.text,/Some linked firings have no valid saved date/);}
 finally {db.prepare("DELETE FROM piece_glazes WHERE id='custom'").run();db.prepare("DELETE FROM firing_logs WHERE id='undated'").run();}
});
test('new intents cannot supply IDs, owner, arbitrary fields or writes',()=>{
 for(const name of ['studio.piece.open','studio.piece.glazes','studio.piece.firings'])assert.throws(()=>validateIntent({name,arguments:{id:'b-blue'}}));
 for(const index of [0,6,1.1,'1',null])assert.throws(()=>validateIntent({name:'studio.piece.choose',arguments:{index}}));
 for(const context of [{token:null,pieceId:'b-blue'},{token:'b-blue'},{token:[]},{userId:'b'}])assert.throws(()=>validateRequest({version:1,requestId:'x',input:{text:'Open it'},context}));
});
test('writes remain unavailable and context is not a write authorization',async()=>{
 const before=db.prepare('SELECT * FROM pieces ORDER BY id').all();const r=await ask('Find blue pieces');
 for(const text of ['Add a studio note that I want to try this combination again','Delete it','Save that'])await assert.rejects(ask(text,r.context),e=>e.code==='ACTION_NOT_AVAILABLE');
 assert.deepEqual(db.prepare('SELECT * FROM pieces ORDER BY id').all(),before);
});
test('injected provider uses same bounded references with no history or data exposure',async()=>{
 const seen=[];const c=createAssistantCore(db,{intentProvider:{resolveIntent(input){seen.push(input);return {name:'studio.piece.firings',arguments:{}};}}});
 const r=await ask('When did I fire it?',{token:null},'a',c);assert.deepEqual(seen,[{text:'When did I fire it?'}]);assert.equal(r.result.status,'clarification');
});

test('device wording: spoken ordinals and names select real saved Pieces',async()=>{
 add('pieces',{id:'a-blue2',user_id:'a',title:'Blue vase'});
 try {
  const list=await ask('Find blue pieces');
  assert.equal((await ask('Open blue vase',list.context)).response.navigation.id,'a-blue2');
  for(const phrase of ['The 1st one.','The first 1.','Number one','Open number 1','The first piece'])assert.equal((await ask(phrase,list.context)).response.navigation.id,'a-blue');
  for(const phrase of ['The 2nd one','Number two','Show me the second one'])assert.equal((await ask(phrase,list.context)).response.navigation.id,'a-blue2');
  for(const phrase of ['Open the blue bowl','Show me my blue bowl']) {
   const chosen=await ask(phrase,list.context);assert.equal(chosen.response.navigation.id,'a-blue');
   for(const question of ['What glaze is on it?','What glaze did I use on that one?','Which glazes are on this piece?','What glaze was used on that?'])assert.deepEqual((await ask(question,chosen.context)).result.glazes,['Ocean']);
   for(const question of ['When did I fire that one?','When was this one fired?'])assert.deepEqual((await ask(question,chosen.context)).result.dates,['2026-10-01']);
  }
 }finally{db.prepare("DELETE FROM pieces WHERE id='a-blue2'").run();}
});
test('new name and ordinal wording preserves empty and owner boundaries',async()=>{
 assert.equal((await ask('The 1st one')).result.status,'clarification');
 assert.equal((await ask('Open the purple bowl')).result.status,'empty');
 const b=await ask('Open the blue bowl',{token:null},'b');assert.equal(b.response.navigation.id,'b-blue');
 assert.deepEqual((await ask('What glaze is on it?',b.context,'b')).result.glazes,['Foreign private glaze']);
 await assert.rejects(ask('Open the blue bowl and delete it'),e=>e.status===400);
});
