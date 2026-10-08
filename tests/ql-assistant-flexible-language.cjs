'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAssistantCore,deterministicProvider}=require('../ql/assistant/core.cjs');
const {interpret}=require('../ql/assistant/language.cjs');
let db,dir,core;
const ask=(text,context={token:null},owner='a',instance=core)=>instance.turn({authorize:()=>owner,request:{version:1,requestId:'flexible',input:{text},context}});
const add=(table,data)=>db.prepare(`INSERT INTO ${table} (${Object.keys(data)}) VALUES (${Object.keys(data).map(()=>'?')})`).run(...Object.values(data));
test.before(()=>{
 dir=fs.mkdtempSync(path.join(os.tmpdir(),'ql-4l-'));
 fs.copyFileSync(path.join(__dirname,'../database.js'),path.join(dir,'database.js'));
 fs.symlinkSync(path.join(__dirname,'../node_modules'),path.join(dir,'node_modules'),'dir');
 db=require(path.join(dir,'database.js')).initDB();core=createAssistantCore(db);
 for(const id of ['a','b'])add('users',{id,email:id+'@example.invalid',password_hash:'synthetic',tier:'free'});
 for(const [id,title] of [['bowl','Blue bowl'],['vase','Blue vase']])add('pieces',{id,user_id:'a',title});
 add('glazes',{id:'sapphire',user_id:'a',name:'Sapphire'});
 add('piece_glazes',{id:'layer',piece_id:'bowl',glaze_id:'sapphire'});
 add('firing_logs',{id:'fire',user_id:'a',piece_id:'bowl',date:'2026-10-01'});
});
test.after(()=>{db?.close();fs.rmSync(dir,{recursive:true,force:true});});
for(const phrase of ['Could you please bring up my glazes?','Um, let me see the glazes please','Glazes, open','glaze','I would like to look at my glazes'])test('navigation: '+phrase,async()=>{
 const r=await ask(phrase);assert.equal(r.response.navigation.page,'glazes');
});
for(const phrase of ['Could you look for sapphire glazes?','Please search glazes for sapphire','Find sapphire in glazes','Pull up glazes matching sapphire'])test('saved search: '+phrase,async()=>{
 const r=await ask(phrase);assert.equal(r.intent.name,'studio.search');assert.deepEqual(r.intent.arguments,{type:'glaze',query:'sapphire'});assert.ok(r.result.results.some(x=>x.title==='Sapphire'));
});
for(const phrase of ['Would you pull up the blue bowl?','I want to look at my blue bowl','Blue bowl, open'])test('Piece selection: '+phrase,async()=>{
 const r=await ask(phrase);assert.equal(r.response.navigation.id,'bowl');
});
for(const phrase of ['Tell me about the glaze on it','And its glaze?','glazes?','Could you tell me which glaze is on that piece?'])test('Piece glaze follow-up: '+phrase,async()=>{
 const selected=await ask('Open the blue bowl');const r=await ask(phrase,selected.context);assert.deepEqual(r.result.glazes,['Sapphire']);
});
for(const phrase of ['Remind me when I fired it','And its firing?','firing dates?','Could you tell me when that was fired?'])test('Piece firing follow-up: '+phrase,async()=>{
 const selected=await ask('Open the blue bowl');const r=await ask(phrase,selected.context);assert.deepEqual(r.result.dates,['2026-10-01']);
});
for(const phrase of ['What was the date of my most recent firing?','Can you remind me when I last fired?','Tell me about my latest firing'])test('latest studio firing: '+phrase,async()=>{
 assert.equal((await ask(phrase)).result.date,'2026-10-01');
});
test('ambiguous destinations retain the question and accept a short answer',async()=>{
 let r=await ask('Could you open clay or glazes?');assert.equal(r.result.status,'clarification');assert.equal(r.response.navigation,undefined);
 r=await ask('I am not sure',r.context);assert.equal(r.result.status,'clarification');
 r=await ask('Glazes please',r.context);assert.equal(r.response.navigation.page,'glazes');
});
test('ambiguous search retains query through domain clarification',async()=>{
 let r=await ask('Find sapphire clay or glazes');assert.equal(r.result.status,'clarification');
 r=await ask('glazes',r.context);assert.deepEqual(r.intent.arguments,{type:'glaze',query:'sapphire'});
});
test('incomplete search collects only its missing value',async()=>{
 let r=await ask('Search glazes for');assert.equal(r.result.status,'clarification');
 r=await ask('sapphire',r.context);assert.deepEqual(r.intent.arguments,{type:'glaze',query:'sapphire'});
});
test('ambiguous Piece fact retains both candidates and the original question',async()=>{
 let r=await ask('Could you find blue pieces?');assert.equal(r.result.status,'choices');
 r=await ask('Tell me when it was fired',r.context);assert.equal(r.result.status,'clarification');
 r=await ask('The first one',r.context);assert.deepEqual(r.result.dates,['2026-10-01']);
});
test('two requested facts clarify and keep the selected Piece',async()=>{
 let r=await ask('Open the blue bowl');r=await ask('Tell me its glaze and when it was fired',r.context);
 assert.equal(r.result.status,'clarification');r=await ask('glazes',r.context);assert.deepEqual(r.result.glazes,['Sapphire']);
});
test('uncertain write preserves exact request and note draft, never changes data',async()=>{
 const before=db.prepare('SELECT * FROM piece_glazes').all();
 let r=await ask('New note Make 25 dishes with B-Mix clay');
 r=await ask('Add sapphire to that',r.context);assert.match(r.response.text,/current note/);assert.equal(r.result.draftText,'Make 25 dishes with B-Mix clay');
 const noteCount=db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n;
 r=await ask('Save note',r.context);assert.match(r.response.text,/clarify the revised note/);assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n,noteCount);
 r=await ask('the note',r.context);assert.match(r.response.text,/Add sapphire to that/);assert.equal(r.result.draftText,'Make 25 dishes with B-Mix clay');
 r=await ask('Replace note with Make 25 dishes with B-Mix clay and sapphire glaze',r.context);
 r=await ask('Save note',r.context);assert.equal(r.result.status,'saved');assert.deepEqual(db.prepare('SELECT * FROM piece_glazes').all(),before);
});
test('write reference uses a clear Piece context and clarifies when no target is known',async()=>{
 let r=await ask('Add sapphire to that');assert.match(r.response.text,/Studio Note or a Piece/);
 r=await ask('Open blue bowl');r=await ask('Add sapphire to that',r.context);assert.match(r.response.text,/selected Piece/);assert.equal(r.response.navigation,undefined);
});
test('unsupported polite mutation does not discard a pending draft',async()=>{
 let r=await ask('New note Buy sapphire glaze');r=await ask('Could you delete all pieces',r.context);
 assert.equal(r.result.draftText,'Buy sapphire glaze');assert.equal((await ask('Save note',r.context)).result.status,'saved');
});
test('a bare feature name during note dictation stays literal note text',async()=>{
 let r=await ask('New note');r=await ask('Glazes',r.context);
 assert.equal(r.result.draftText,'Glazes');assert.equal(r.response.navigation,undefined);
 await ask('Cancel',r.context);
});
test('foreign and restarted contexts cannot reuse a pending search or selected Piece',async()=>{
 const r=await ask('Search glazes for');
 await assert.rejects(ask('sapphire',r.context,'b'));
 await assert.rejects(ask('sapphire',r.context,'a',createAssistantCore(db)));
 const selected=await ask('Open blue bowl');const other=await ask('Tell me what glaze is on it',selected.context,'b');
 assert.equal(other.result.status,'clarification');assert.doesNotMatch(JSON.stringify(other),/Sapphire/);
});
test('injected provider cannot fabricate internal clarification authority',async()=>{
 const c=createAssistantCore(db,{intentProvider:{resolveIntent:()=>({name:'studio.language.clarify',arguments:{}})}});
 await assert.rejects(ask('anything',{token:null},'a',c),e=>e.code==='INVALID_REQUEST');
});
for(const text of ['Could you delete all glazes','Do not open glazes','Open glazes then delete them','Open glazes except sapphire'])test('no partial execution: '+text,async()=>{
 assert.equal(interpret(text),null);await assert.rejects(ask(text));
});
