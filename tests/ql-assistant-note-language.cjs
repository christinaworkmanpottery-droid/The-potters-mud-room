'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createAssistantCore,deterministicProvider}=require('../ql/assistant/core.cjs');
const {noteBody,noteStart}=require('../ql/assistant/notes.cjs');
// Real SQL and the canonical create operation, without optional native packages.
function fixture(t){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('a'),('b'); CREATE TABLE studio_notes(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,body TEXT);");
 const db={prepare:sql=>sqlite.prepare(sql),transaction:fn=>(...args)=>{
  sqlite.exec('BEGIN');try{const r=fn(...args);sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}
 }};
 t.after(()=>sqlite.close());
 const core=createAssistantCore(db);
 const ask=(text,context={token:null},owner='a')=>core.turn({authorize:()=>owner,request:{version:1,requestId:'language-test',input:{text},context}});
 return {db,core,ask,count:()=>db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n};
}
const exact='New note I need to make 25 soy sauce, dishes, and B mix clay save note';
const body='I need to make 25 soy sauce, dishes, and B mix clay';
test('reported full sentence keeps every word and quantity, then saves exactly once',async t=>{
 const f=fixture(t);let r=await f.ask(exact);
 assert.equal(r.result.status,'draft');assert.equal(r.result.draftText,body);assert.equal(f.count(),0);
 r=await f.ask('Okay, save it please.',r.context);
 assert.equal(r.result.status,'saved');
 assert.equal(f.db.prepare('SELECT body FROM studio_notes WHERE id=?').get(r.result.noteId).body,body);
 assert.equal(f.count(),1);
 assert.notEqual((await f.ask('Save note',r.context)).result.status,'saved');assert.equal(f.count(),1);
});
for(const prefix of ['New note','A new studio note','Start a note','Take a note','Write a note','Can you make a note','Could you please take a note','I want to make a note','I need to make a note','I would like to create a note','I’d like to add a note','Jot this down','Write down','I need to jot this down','Please write me a note','Okay, new note','Make a note of']){
 test('natural note request: '+prefix,async t=>{
  const f=fixture(t);const r=await f.ask(prefix+': Make 25 soy sauce dishes with B-Mix clay');
  assert.equal(r.result.status,'draft');assert.equal(r.result.draftText,'Make 25 soy sauce dishes with B-Mix clay');assert.equal(f.count(),0);
 });
}
test('new note alone gathers text and preserves a later inline save suffix',async t=>{
 const f=fixture(t);let r=await f.ask('New note.');
 assert.equal(r.result.status,'collecting');
 r=await f.ask('I need to make 25 soy sauce dishes and B mix clay save note',r.context);
 assert.equal(r.result.draftText,'I need to make 25 soy sauce dishes and B mix clay');assert.equal(f.count(),0);
 r=await f.ask('Please save the note.',r.context);assert.equal(r.result.status,'saved');
});
for(const phrase of ['Play save note','Clay save note','What did you say?']){
 test('unclear command preserves current draft: '+phrase,async t=>{
  const f=fixture(t);const draft=await f.ask(exact);const review=await f.ask(phrase,draft.context);
  assert.equal(review.result.draftText,body);assert.equal(review.result.status,'draft');assert.equal(f.count(),0);
  const saved=await f.ask('Save that',review.context);assert.equal(saved.result.status,'saved');
  assert.equal(f.db.prepare('SELECT body FROM studio_notes WHERE id=?').get(saved.result.noteId).body,body);
 });
}
test('misheard save with no draft explains missing content, never fabricates it',async t=>{
 const f=fixture(t);const r=await f.ask('Play save note');
 assert.equal(r.result.status,'clarification');assert.match(r.response.text,/do not have a current note draft/);assert.equal(f.count(),0);
});
test('clarification is private and cannot restore a stale or foreign draft',async t=>{
 const f=fixture(t);const old=await f.ask(exact);const current=await f.ask('New note Buy sapphire glaze');
 for(const [context,owner] of [[old.context,'a'],[current.context,'b'],[{token:'f'.repeat(48)},'a']]){
  const r=await f.ask('Play save note',context,owner);assert.equal(r.result.status,'clarification');assert.equal(r.result.draftText,undefined);
  assert.doesNotMatch(r.response.text,/sapphire|soy sauce/);
 }
 assert.equal(f.count(),0);assert.equal((await f.ask('Save note',current.context)).result.status,'saved');
});
test('natural cancellation never becomes note content or saves',async t=>{
 const f=fixture(t);
 for(const words of ['Please cancel the note','Okay, cancel','Don’t save it','Do not save note','Discard that please']){
  const r=await f.ask(exact);const canceled=await f.ask(words,r.context);
  assert.equal(canceled.result.status,'canceled');assert.notEqual((await f.ask('Save note',r.context)).result.status,'saved');
 }
 assert.equal(f.count(),0);
});
test('literal replacement, noncommand text and ambiguous requests stay literal or fail closed',async t=>{
 const f=fixture(t);let r=await f.ask(exact);
 r=await f.ask('Replace note with My button says save note',r.context);
 assert.equal(r.result.draftText,'My button says save note');assert.equal(f.count(),0);
 assert.equal(noteBody('New note thatched texture on 25 dishes'),'thatched texture on 25 dishes');
 assert.equal(noteBody('New note I need money to save'),'I need money to save');
 assert.equal(noteStart('New note save note').topic,'');
 for(const text of ['Save that','Do not create a note','Can you delete all notes']){
  await assert.rejects(f.ask(text),e=>e.status===400);
 }
 assert.equal(f.count(),0);
});
test('provider cannot invent clarification or confirmation authority',async t=>{
 const f=fixture(t);
 for(const name of ['studio.note.review','studio.note.confirm']){
  const core=createAssistantCore(f.db,{intentProvider:{resolveIntent:()=>({name,arguments:{}})}});
  await assert.rejects(core.turn({authorize:()=> 'a',request:{version:1,requestId:'forged',input:{text:'unrelated text'},context:{token:null}}}),e=>e.code==='INVALID_REQUEST');
 }
 assert.equal(f.count(),0);
});
