'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createAssistantCore}=require('../ql/assistant/core.cjs');
function fixture(t){
 const sql=new DatabaseSync(':memory:');sql.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES ('a'),('b'); CREATE TABLE studio_notes(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,body TEXT);");
 const db={prepare:s=>sql.prepare(s),transaction:fn=>(...args)=>{sql.exec('BEGIN');try{const r=fn(...args);sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 t.after(()=>sql.close());const core=createAssistantCore(db);
 return {db,ask:(text,context={token:null},owner='a')=>core.turn({authorize:()=>owner,request:{version:1,requestId:'oct8',input:{text},context}}),rows:()=>db.prepare('SELECT * FROM studio_notes').all()};
}
for(const phrase of ['Clayton, create a new note for me','Hey Clayton, could you please create a new note for me?','Create a new note for me'])test('Oct8 natural initiation: '+phrase,async t=>{
 const f=fixture(t);let r=await f.ask(phrase);assert.equal(r.result.status,'collecting');r=await f.ask('I need to make 30 soy sauce dishes in B-Mix clay fire at cone 6 with Sapphire Float glaze',r.context);assert.equal(r.result.status,'draft');assert.doesNotMatch(r.result.draftText,/for me/);
 r=await f.ask('Save draft',r.context);assert.equal(r.result.status,'saved');assert.equal(f.rows().length,1);
});
test('Oct8 corrections, remove, add, save, reopen and persist on same database row',async t=>{
 const f=fixture(t);let r=await f.ask('New note I need to make 30 soy subs dishes in B mixed clay fire to cone six use Sapphire float blaze BMX');
 assert.equal(r.result.status,'material-review');const heard=r.result.draftText;
 r=await f.ask('Edit draft',r.context);assert.equal(r.result.draftText,heard);
 r=await f.ask('On the live note draft remove BMX',r.context);assert.doesNotMatch(r.result.draftText,/BMX|remove|Edit draft/);
 for(const words of ['I said B-Mix clay','I meant soy sauce dishes','Correct that to cone 6','I said Sapphire Float glaze'])r=await f.ask(words,r.context);
 assert.equal(r.result.draftText,'I need to make 30 soy sauce dishes in B-Mix clay fire to cone 6 use Sapphire Float glaze');
 r=await f.ask('Add two coats',r.context);assert.match(r.result.draftText,/\ntwo coats$/);
 r=await f.ask('Save draft',r.context);assert.equal(r.result.status,'saved');const id=r.result.noteId;
 r=await f.ask('Clayton reopen my note',r.context);assert.equal(r.result.status,'draft');
 r=await f.ask('Change 30 to 25',r.context);r=await f.ask('Remove two coats',r.context);r=await f.ask('Save my draft please',r.context);
 assert.equal(r.result.noteId,id);assert.equal(f.rows().length,1);assert.equal(f.rows()[0].body,'I need to make 25 soy sauce dishes in B-Mix clay fire to cone 6 use Sapphire Float glaze');
 r=await f.ask('Edit my note',r.context);r=await f.ask('Replace draft with Buy groceries and call Glenn',r.context);r=await f.ask('Cancel draft',r.context);assert.equal(r.result.status,'canceled');assert.match(f.rows()[0].body,/25 soy sauce/);
});
for(const stage of ['collecting','draft','material-review'])for(const phrase of ['Cancel draft','Clayton cancel my draft','Discard the draft please'])test('Oct8 cancellation in '+stage+': '+phrase,async t=>{
 const f=fixture(t);let r=await f.ask(stage==='collecting'?'New note':stage==='draft'?'New note Play':'New note Buy V-Mix clay');const old=r.context;r=await f.ask(phrase,r.context);assert.equal(r.result.status,'canceled');assert.notEqual((await f.ask('Save draft',old)).result.status,'saved');assert.equal(f.rows().length,0);
});
for(const words of ['Safe draft','Shut up','Edit draft','Remove unknown words','I meant electric brown clay'])test('Oct8 command cannot contaminate draft: '+words,async t=>{
 const f=fixture(t);let r=await f.ask('New note Buy groceries and call Glenn');r=await f.ask(words,r.context);assert.equal(r.result.draftText,'Buy groceries and call Glenn');assert.equal(f.rows().length,0);
});
for(const variant of ['V-Mix','B mixed','BM mix','BMX'])test('uncertain '+variant+' asks before changing clay',async t=>{
 const f=fixture(t);let r=await f.ask('New note Buy '+variant+' clay fire at cone 04');assert.equal(r.result.status,'material-review');assert.match(r.result.draftText,new RegExp(variant));r=await f.ask('Save draft',r.context);assert.equal(f.rows().length,0);r=await f.ask('I said B-Mix clay',r.context);assert.equal(r.result.draftText,'Buy B-Mix clay fire at cone 04');r=await f.ask('Save draft',r.context);assert.equal(f.rows()[0].body,'Buy B-Mix clay fire at cone 04');
});
test('ambiguous or nonpottery corrections never guess, repeated text and foreign edits fail closed',async t=>{
 const f=fixture(t);let r=await f.ask('New note red cup and red plate');r=await f.ask('Change red to blue',r.context);assert.equal(r.result.draftText,'red cup and red plate');r=await f.ask('Remove red',r.context);assert.equal(r.result.draftText,'red cup and red plate');r=await f.ask('I said green',r.context);assert.equal(r.result.draftText,'red cup and red plate');
 r=await f.ask('Replace draft with Remind Glenn to buy oat milk',r.context);r=await f.ask('Save draft',r.context);const original=f.rows()[0].body;await assert.rejects(f.ask('Remove Glenn',r.context,'b'));assert.equal(f.rows()[0].body,original);
 r=await f.ask('Change oat milk to tea',r.context);f.db.prepare('UPDATE studio_notes SET body=?').run('Manual update');r=await f.ask('Save draft',r.context);assert.equal(r.result.status,'failed');assert.equal(f.rows()[0].body,'Manual update');
});

const acceptedBody='I need to make three ring dishes in B-Mix clay, fired to cone 6, using Sapphire Float.';
const editedBody=acceptedBody.replace('I need to make','I made');
for(const saved of [false,true])for(const phrase of [
 'Remove I need to make and put I made instead',
 'Instead of I need to make, say I made',
 'Change I need to make to I made',
 'Change the beginning to I made',
 'Remove I knead to make and put I made instead'
])test('Oct8 conversational replacement '+(saved?'saved: ':'draft: ')+phrase,async t=>{
 const f=fixture(t);let r=await f.ask('New note '+acceptedBody.replace('B-Mix','BMX'));
 assert.equal(r.result.status,'material-review');r=await f.ask('yes',r.context);
 assert.equal(r.result.draftText,acceptedBody);
 let id;if(saved){r=await f.ask('Save note',r.context);id=r.result.noteId;}
 r=await f.ask(phrase,r.context);
 if(/beginning|knead/.test(phrase)){
  assert.match(r.response.text,/Replace “I need to make” with “I made”/);
  assert.equal(r.result.draftText,acceptedBody);r=await f.ask('Yes',r.context);
 }
 assert.equal(r.result.draftText,editedBody);
 assert.equal(f.rows().length,saved?1:0);
 if(saved)assert.equal(f.rows()[0].body,acceptedBody);
 r=await f.ask('Save draft',r.context);assert.equal(r.result.status,'saved');
 assert.equal(f.rows().length,1);assert.equal(f.rows()[0].body,editedBody);
 if(saved)assert.equal(r.result.noteId,id);
 assert.match(r.response.text,/I made three ring dishes/);
});
test('ambiguous, repeated and incomplete replacement commands preserve note and are never dictation',async t=>{
 const f=fixture(t);const body='I need to make bowls. I need to make plates.';
 let r=await f.ask('New note '+body);
 for(const phrase of ['Remove I need to make and put I made instead','Instead of I need to make','Change the start to I made']){
  r=await f.ask(phrase,r.context);assert.equal(r.result.draftText,body);
 }
 r=await f.ask('yes',r.context);assert.equal(r.result.draftText,body);assert.equal(f.rows().length,0);
});
test('rejecting an inferred edit cancels without persisting or swallowing a later new command',async t=>{
 const f=fixture(t);let r=await f.ask('New note '+acceptedBody);r=await f.ask('Save note',r.context);
 r=await f.ask('Change the beginning to I made',r.context);r=await f.ask('no',r.context);
 assert.equal(f.rows()[0].body,acceptedBody);
 r=await f.ask('New note Call Glenn tomorrow',r.context);r=await f.ask('Save note',r.context);
 assert.equal(f.rows().length,2);
});
