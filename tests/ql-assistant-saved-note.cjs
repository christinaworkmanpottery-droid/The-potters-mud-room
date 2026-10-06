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


test('saved note phrase correction previews then updates same note',async t=>{
 const f=fixture(t);let r=await f.ask('New note Make 30 soy sauce dishes and terra-cotta clay fire cone six');
 r=await f.ask('Save note',r.context);const id=r.result.noteId;
 const preview=await f.ask('Change last note and terra-cotta clay to in terra-cotta clay',r.context);
 assert.equal(preview.result.status,'draft');
 assert.equal(preview.result.draftText,'Make 30 soy sauce dishes in terra-cotta clay fire cone six');
 assert.equal(f.db.prepare('SELECT body FROM studio_notes WHERE id=?').get(id).body,'Make 30 soy sauce dishes and terra-cotta clay fire cone six');
 const result=await f.ask('Save it',preview.context);
 assert.equal(result.result.noteId,id);
 assert.equal(f.db.prepare('SELECT body FROM studio_notes WHERE id=?').get(id).body,'Make 30 soy sauce dishes in terra-cotta clay fire cone six');
});
test('saved note correction fails closed when phrase is missing or repeated',async t=>{
 const f=fixture(t);let r=await f.ask('New note red clay and red clay');r=await f.ask('Save note',r.context);
 let x=await f.ask('Change red clay to B-Mix clay',r.context);assert.equal(x.result.status,'clarification');assert.match(x.response.text,/more than once/);
 x=await f.ask('Change blue clay to B-Mix clay',x.context);assert.equal(x.result.status,'clarification');assert.match(x.response.text,/could not find/);
 assert.equal(f.db.prepare('SELECT body FROM studio_notes').get().body,'red clay and red clay');
});
