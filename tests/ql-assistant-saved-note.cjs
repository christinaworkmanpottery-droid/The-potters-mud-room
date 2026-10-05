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

async function saved(f){let r=await f.ask('New note I need to make 25 soy sauce dishes in B mix clay');return f.ask('Save note',r.context);}
for(const words of ['Add in Sapphire Float','Also mention Sapphire Float','Could you please add Sapphire Float to my note','Append Sapphire Float to that','Include Sapphire Float']){
 test('saved note addition: '+words,async t=>{
  const f=fixture(t);const original=await saved(f);const id=original.result.noteId;
  f.db.prepare('UPDATE studio_notes SET title=? WHERE id=?').run('Dishes',id);
  const preview=await f.ask(words,original.context);
  assert.equal(preview.result.status,'draft');assert.match(preview.result.draftText,/B mix clay\nSapphire Float$/);
  assert.doesNotMatch(f.db.prepare('SELECT body FROM studio_notes WHERE id=?').get(id).body,/Sapphire/);
  const result=await f.ask('Save it',preview.context);assert.equal(result.result.noteId,id);assert.equal(f.count(),1);
  assert.equal(f.db.prepare('SELECT title FROM studio_notes WHERE id=?').get(id).title,'Dishes');
  await f.ask('Save note',preview.context);assert.equal(f.count(),1);
  assert.equal(f.db.prepare('SELECT body FROM studio_notes WHERE id=?').get(id).body.split('Sapphire').length,2);
 });
}
test('cancel amendment preserves saved original',async t=>{
 const f=fixture(t);let r=await saved(f);const id=r.result.noteId;r=await f.ask('Add in Sapphire Float',r.context);await f.ask('Cancel',r.context);
 assert.doesNotMatch(f.db.prepare('SELECT body FROM studio_notes WHERE id=?').get(id).body,/Sapphire/);assert.equal(f.count(),1);
});
test('manual changes between preview and save are never overwritten',async t=>{
 const f=fixture(t);const original=await saved(f);const r=await f.ask('Add in Sapphire Float',original.context);
 f.db.prepare('UPDATE studio_notes SET body=? WHERE id=?').run('Manual edit',original.result.noteId);
 const result=await f.ask('Save note',r.context);assert.equal(result.result.status,'failed');assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,'Manual edit');
});
test('foreign context never reveals or changes note',async t=>{
 const f=fixture(t);const original=await saved(f);
 await assert.rejects(f.ask('Add in Sapphire Float',original.context,'b'));
 assert.doesNotMatch(f.db.prepare('SELECT body FROM studio_notes').get().body,/Sapphire/);
});
test('navigation clears saved-note focus',async t=>{
 const f=fixture(t);const original=await saved(f);const nav=await f.ask('Open glazes',original.context);
 await assert.rejects(f.ask('Add in Sapphire Float',nav.context));
 await assert.rejects(f.ask('Add in Sapphire Float',original.context));
});
test('ambiguous content asks for words; explicit Piece destination never appends',async t=>{
 const f=fixture(t);const original=await saved(f);const r=await f.ask('Add that to my note',original.context);
 assert.equal(r.result.status,'clarification');assert.match(r.response.text,/What words/);
 assert.equal((await f.ask('Add Sapphire Float to my piece',r.context)).result.status,'clarification');assert.doesNotMatch(f.db.prepare('SELECT body FROM studio_notes').get().body,/Sapphire/);
});
test('multiple additions and full correction keep same saved target',async t=>{
 const f=fixture(t);const original=await saved(f);let r=await f.ask('Add in Sapphire Float',original.context);
 r=await f.ask('Also mention two coats',r.context);assert.match(r.result.draftText,/Sapphire Float\ntwo coats/);
 r=await f.ask('Replace note with Make 25 dishes with Sapphire Float',r.context);r=await f.ask('Save note',r.context);
 assert.equal(r.result.noteId,original.result.noteId);assert.equal(f.count(),1);assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,'Make 25 dishes with Sapphire Float');
});
test('new note during amendment creates a separate note without altering original',async t=>{
 const f=fixture(t);const original=await saved(f);let r=await f.ask('Add in Sapphire Float',original.context);
 r=await f.ask('New note Buy clay',r.context);r=await f.ask('Save note',r.context);
 assert.notEqual(r.result.noteId,original.result.noteId);assert.equal(f.count(),2);assert.doesNotMatch(f.db.prepare('SELECT body FROM studio_notes WHERE id=?').get(original.result.noteId).body,/Sapphire/);
});

for(const interruption of ['Save note','What did you say?','Change clay to Electric Brown','Add Sapphire Float to my piece'])test('saved-note follow-up survives nonexecuted turn: '+interruption,async t=>{
 const f=fixture(t);const original=await saved(f);let r=await f.ask(interruption,original.context);
 assert.equal(r.result.status,'clarification');assert.equal(f.count(),1);
 r=await f.ask('Add sapphire glaze',r.context);assert.equal(r.result.status,'draft');assert.match(r.result.draftText,/sapphire glaze/);
 r=await f.ask('Save it',r.context);assert.equal(r.result.noteId,original.result.noteId);assert.equal(f.count(),1);
});

for(const words of ['Add sapphire float glaze to last note','Add sapphire float glaze to my last note','Add sapphire float glaze to the most recent studio note','Add sapphire float glaze to the note I just saved','Add to my last note sapphire float glaze','Please append to the latest note: sapphire float glaze'])test('note reference is instruction, not payload: '+words,async t=>{
 const f=fixture(t);const original=await saved(f);const r=await f.ask(words,original.context);
 assert.equal(r.result.draftText,'I need to make 25 soy sauce dishes in B mix clay\nsapphire float glaze');
 const result=await f.ask('Save',r.context);assert.equal(result.result.noteId,original.result.noteId);assert.equal(f.count(),1);
 assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,r.result.draftText);
});
test('unknown note destination asks instead of appending routing words',async t=>{
 const f=fixture(t);const original=await saved(f);const r=await f.ask('Add sapphire glaze to the first note',original.context);
 assert.equal(r.result.status,'clarification');assert.match(r.response.text,/Which note/);assert.doesNotMatch(f.db.prepare('SELECT body FROM studio_notes').get().body,/sapphire/);
});
test('quoted routing words remain literal payload',async t=>{
 const f=fixture(t);const original=await saved(f);const r=await f.ask('Add "refer to last note"',original.context);assert.match(r.result.draftText,/\nrefer to last note$/);
});

for(const command of ['I said B-Mix clay.','Change BM mix to B-Mix.','Correct that to B-Mix clay.','No, I meant Bmix clay'])test('post-save persisted correction: '+command,async t=>{
 const f=fixture(t);
 let r=await f.ask('New note I need to buy sapphire float glaze, make 30 soy sauce dishes, and BM mix');
 r=await f.ask('Save note',r.context);const id=r.result.noteId;
 f.db.prepare('UPDATE studio_notes SET title=? WHERE id=?').run('Studio tasks',id);
 r=await f.ask(command,r.context);
 assert.equal(r.result.status,'saved');assert.equal(r.result.noteId,id);assert.equal(f.count(),1);
 const body='I need to buy sapphire float glaze, make 30 soy sauce dishes, and B-Mix'+(command.startsWith('Change')?'':' clay');
 assert.equal(f.db.prepare('SELECT body FROM studio_notes WHERE id=?').get(id).body,body);
 assert.match(r.response.text,/Updated your Studio Note/);assert.ok(r.response.text.includes(body));
 assert.equal(f.db.prepare('SELECT title FROM studio_notes WHERE id=?').get(id).title,'Studio tasks');
 assert.equal(r.response.navigation.page,'studioNotes');
 r=await f.ask('Add two coats',r.context);r=await f.ask('Save note',r.context);assert.equal(r.result.noteId,id);
});
for(const spelling of ['B-Mix clay','BM mix clay','bm mix clay'])test('new dictation preserves or normalizes '+spelling,async t=>{
 const f=fixture(t);let r=await f.ask('New note');
 r=await f.ask('Buy '+spelling,r.context);assert.equal(r.result.draftText,'Buy B-Mix clay');
 r=await f.ask('Save note',r.context);assert.equal(r.result.status,'saved');assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,'Buy B-Mix clay');
});
test('ambiguous implicit correction preserves text until explicit unique replacement',async t=>{
 const f=fixture(t);let r=await f.ask('New note Compare B mix clay and bee mix clay');
 r=await f.ask('keep original words',r.context);r=await f.ask('Save note',r.context);
 const id=r.result.noteId,before=f.db.prepare('SELECT body FROM studio_notes').get().body;
 r=await f.ask('I said B-Mix clay',r.context);assert.equal(r.result.status,'clarification');assert.match(r.response.text,/Which exact words/);
 assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,before);
 r=await f.ask('Change bee mix to B-Mix',r.context);assert.equal(r.result.noteId,id);
 assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,'Compare B mix clay and B-Mix clay');
});
test('post-save correction protects ownership and concurrent manual changes',async t=>{
 const f=fixture(t);let r=await saved(f);const id=r.result.noteId;
 const foreign=await f.ask('I said B-Mix clay',r.context,'b');
 assert.equal(foreign.result.status,'clarification');assert.doesNotMatch(foreign.response.text,/25 soy sauce/);
 assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,'I need to make 25 soy sauce dishes in B mix clay');
 f.db.prepare('UPDATE studio_notes SET body=? WHERE id=?').run('Manual edit',id);
 r=await f.ask('I said B-Mix clay',r.context);assert.equal(r.result.status,'clarification');
 assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,'Manual edit');
});

test('exact legacy BM mix clay note corrects in place without duplicating clay',t=>{
 const {createNoteDrafts}=require('../ql/assistant/notes.cjs');const f=fixture(t),notes=createNoteDrafts(f.db);
 const body='I need to buy sapphire float glaze, make 30 soy sauce dishes, and BM mix clay.';
 const draft=notes.draft('a',body,{reviewMaterial:false});const original=notes.confirm('a',draft.state,true,'Save note');
 const result=notes.correct('a',original.state,{from:'BM mix',to:'B-Mix'});
 assert.equal(result.result.noteId,original.result.noteId);assert.equal(f.count(),1);
 assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,body.replace('BM mix','B-Mix'));
});
for(const words of ['Change missing words to B-Mix','I said Electric Brown clay'])test('unresolved correction keeps saved note and asks: '+words,async t=>{
 const f=fixture(t);let r=await saved(f);const before=f.db.prepare('SELECT body FROM studio_notes').get().body;
 r=await f.ask(words,r.context);assert.equal(r.result.status,'clarification');assert.match(r.response.text,/Which exact words/);
 assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,before);
 r=await f.ask('Change B mix to B-Mix',r.context);assert.equal(r.result.status,'saved');
});
