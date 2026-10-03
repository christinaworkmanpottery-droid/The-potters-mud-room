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
 for(const text of ['Edit a studio note','Delete it','Save that'])await assert.rejects(ask(text,r.context),e=>e.code==='ACTION_NOT_AVAILABLE');
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

test('observed way/phase speech requires confirmation and preserves Piece context',async()=>{
 const selected=await ask('Open blue bowl');
 for(const words of ['What way is on blue phase','What ways is on blue phase']) {
  const proposed=await ask(words,selected.context);
  assert.equal(proposed.result.status,'clarification');assert.equal(proposed.response.navigation,undefined);
  assert.match(proposed.response.text,/Do you mean: what glaze is saved on Blue bowl\? Say yes or no/);
  assert.doesNotMatch(proposed.response.text,/Ocean/);
  const yes=await ask('Yes',proposed.context);assert.deepEqual(yes.result.glazes,['Ocean']);
  assert.equal((await ask('Yes',yes.context)).result.status,'clarification');
  const no=await ask('No',proposed.context);assert.match(no.response.text,/Canceled/);
  assert.equal((await ask('Yes',no.context)).result.status,'clarification');
  assert.deepEqual((await ask('What glaze is on it?',no.context)).result.glazes,['Ocean']);
 }
});
test('correctly heard named glaze queries read saved data or ask a choice',async()=>{
 for(const words of ['What glaze is on the blue bowl?','What glaze did I use on blue bowl?']) {
  const r=await ask(words);assert.deepEqual(r.result.glazes,['Ocean']);assert.equal(r.response.navigation.id,'a-blue');
 }
 add('pieces',{id:'a-blue2',user_id:'a',title:'Blue vase'});
 try {
  const choices=await ask('What glaze is on blue?');assert.equal(choices.result.status,'choices');
  const second=await ask('The second one',choices.context);assert.equal(second.result.status,'empty');assert.equal(second.response.navigation.id,'a-blue2');
 }finally{db.prepare("DELETE FROM pieces WHERE id='a-blue2'").run();}
});
test('unknown named target is not silently replaced by the current Piece',async()=>{
 const chosen=await ask('Open blue bowl');
 const r=await ask('What glaze is on blue phase?',chosen.context);assert.equal(r.result.status,'clarification');assert.equal(r.response.navigation,undefined);assert.doesNotMatch(r.response.text,/Ocean/);
 const correct=await ask('What glaze is on white cup?',chosen.context);assert.equal(correct.result.status,'empty');assert.equal(correct.response.navigation.id,'a-white');
 assert.equal((await ask('What way is on blue phase')).result.status,'clarification');
});
test('read clarification cannot survive account changes, record deletion or topic changes',async()=>{
 let r=await ask('Open blue bowl');r=await ask('What way is on blue phase',r.context);
 const foreign=await ask('Yes',r.context,'b');assert.equal(foreign.result.status,'clarification');assert.doesNotMatch(JSON.stringify(foreign),/Ocean|Blue bowl|a-blue/);
 const nav=await ask('Open glazes',r.context);assert.equal((await ask('Yes',nav.context)).result.status,'clarification');
 add('pieces',{id:'temporary-confirm',user_id:'a',title:'Temporary bowl'});
 let temp=await ask('Open temporary bowl');temp=await ask('What way is on that',temp.context);db.prepare("DELETE FROM pieces WHERE id='temporary-confirm'").run();
 assert.equal((await ask('Yes',temp.context)).result.status,'clarification');
 for(const intent of [{name:'studio.piece.confirmRead',arguments:{confirmed:'true'}},{name:'studio.piece.confirmRead',arguments:{confirmed:true,pieceId:'b-blue'}},{name:'studio.piece.clarifyGlazes',arguments:{pieceId:'b-blue'}}])assert.throws(()=>validateIntent(intent));
});
test('misheard piece names ask before opening and retain canonical followups',async()=>{
 add('pieces',{id:'repair-vase',user_id:'a',title:'Blue vase'});
 try {
  for(const word of ['faze','phase','base','face']) {
   const r=await ask('Show me blue '+word);assert.match(r.response.text,/Did you mean Blue vase/);assert.equal(r.response.navigation,undefined);
   const yes=await ask('Yes',r.context);assert.equal(yes.response.navigation.id,'repair-vase');
   assert.equal((await ask('What glaze is on it?',yes.context)).result.status,'empty');
   const no=await ask('No',r.context);assert.equal(no.response.navigation,undefined);assert.equal((await ask('Yes',no.context)).response.navigation,undefined);
   assert.equal((await ask('Yes',r.context,'b')).response.navigation,undefined);
   const moved=await ask('Open my glazes',r.context);assert.equal((await ask('Yes',moved.context)).response.navigation,undefined);
  }
  const pending=await ask('Show me blue faze');
  db.prepare("DELETE FROM pieces WHERE id='repair-vase'").run();
  assert.equal((await ask('Yes',pending.context)).response.navigation,undefined);
  assert.match((await ask('Show me blue faze')).response.text,/could not match/);
 }finally{db.prepare("DELETE FROM pieces WHERE id='repair-vase'").run();}
});
test('literal matches win; ambiguous speech alternatives require selection',async()=>{
 for(const [id,title] of [['literal','Blue faze'],['vase1','Blue vase'],['vase2','Blue vase tall']])add('pieces',{id,user_id:'a',title});
 try {
  assert.equal((await ask('Show me blue faze')).response.navigation.id,'literal');
  const r=await ask('Show me blue phase');assert.equal(r.result.status,'choices');assert.equal(r.response.navigation,undefined);
  assert.equal((await ask('Yes',r.context)).response.navigation,undefined);
  assert.ok(['vase1','vase2'].includes((await ask('The first one',r.context)).response.navigation.id));
  assert.throws(()=>validateIntent({name:'studio.piece.clarifyOpen',arguments:{query:'blue faze',pieceId:'foreign'}}));
 }finally{db.prepare("DELETE FROM pieces WHERE id IN ('literal','vase1','vase2')").run();}
});

test('joined speech and unknown piece navigation recover without guessing',async()=>{
 add('pieces',{id:'joined-vase',user_id:'a',title:'Blue vase'});
 try {
  const r=await ask('Show me Blueface');assert.match(r.response.text,/Did you mean Blue vase/);assert.equal(r.response.navigation,undefined);
  assert.equal((await ask('Yes',r.context)).response.navigation.id,'joined-vase');
  const unknown=await ask('Show me blurf',r.context);assert.match(unknown.response.text,/Please repeat/);assert.equal(unknown.response.navigation,undefined);
  assert.equal((await ask('Yes',unknown.context)).response.navigation,undefined);
  const nav=await ask('Open my glazes',r.context);assert.equal(nav.response.navigation.page,'glazes');
  await assert.rejects(ask('Delete blue vase',r.context),{code:'ACTION_NOT_AVAILABLE'});
 }finally{db.prepare("DELETE FROM pieces WHERE id='joined-vase'").run();}
});

test('Studio Note draft preserves exact words; explicit confirmation saves once',async()=>{
 const before=db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n;
 const text='I want to try this combination again.';
 const draft=await ask('Add a studio note that '+text);assert.equal(draft.result.status,'draft');assert.match(draft.response.text,/Nothing has been saved/);assert.equal(draft.response.navigation,undefined);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n,before);
 const results=await Promise.all([ask('Save note',draft.context),ask('Save note',draft.context)]);
 assert.equal(results.filter(r=>r.result.status==='saved').length,1);
 const saved=results.find(r=>r.result.status==='saved');assert.equal(saved.response.navigation.page,'studioNotes');
 const row=db.prepare('SELECT * FROM studio_notes WHERE id=?').get(saved.result.noteId);assert.equal(row.body,text);assert.equal(row.user_id,'a');assert.equal(row.title,null);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n,before+1);
 assert.notEqual((await ask('Yes',saved.context)).result.status,'saved');
});
test('Studio Note cancellation, replacement, navigation and foreign contexts cannot save stale drafts',async()=>{
 const count=()=>db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n;const before=count();
 let draft=await ask('Create a studio note: Canceled test');
 assert.equal((await ask('Cancel',draft.context)).result.status,'canceled');assert.notEqual((await ask('Save note',draft.context)).result.status,'saved');
 draft=await ask('Add a studio note that old words');const replacement=await ask('Add a studio note that replacement words',draft.context);
 assert.notEqual((await ask('Save note',draft.context)).result.status,'saved');assert.equal((await ask('No',replacement.context)).result.status,'canceled');
 draft=await ask('Add a studio note that private words');const foreign=await ask('Save note',draft.context,'b');assert.doesNotMatch(JSON.stringify(foreign),/private words/);assert.notEqual(foreign.result.status,'saved');
 await ask('Open my glazes',draft.context);assert.notEqual((await ask('Save note',draft.context)).result.status,'saved');assert.equal(count(),before);
});
test('Studio Note save failures never claim success and cannot replay',async()=>{
 const draft=await ask('Add a studio note that Failure test');
 db.exec("CREATE TRIGGER reject_note BEFORE INSERT ON studio_notes BEGIN SELECT RAISE(ABORT,'test failure'); END");
 try{const r=await ask('Save note',draft.context);assert.equal(r.result.status,'failed');assert.equal(r.response.navigation,undefined);assert.match(r.response.text,/could not be saved/);}
 finally{db.exec('DROP TRIGGER reject_note');}
 assert.notEqual((await ask('Save note',draft.context)).result.status,'saved');
});
test('Studio Note provider cannot invent body or confirmation, and context is required',async()=>{
 const forged=createAssistantCore(db,{intentProvider:{resolveIntent:()=>({name:'studio.note.draft',arguments:{body:'Invented body'}})}});
 await assert.rejects(ask('Add a studio note that actual words',{token:null},'a',forged),{code:'INVALID_REQUEST'});
 const confirming=createAssistantCore(db,{intentProvider:{resolveIntent:()=>({name:'studio.note.confirm',arguments:{}})}});
 await assert.rejects(ask('What glaze is on it?',{token:null},'a',confirming),{code:'INVALID_REQUEST'});
 await assert.rejects(core.turn({authorize:()=> 'a',request:{version:1,requestId:'noctx',input:{text:'Add a studio note that test'}}}),{code:'INVALID_REQUEST'});
 assert.throws(()=>validateIntent({name:'studio.note.confirm',arguments:{body:'injected'}}));
});
test('Studio Note pending drafts expire and are bounded',()=>{
 let now=0;const drafts=require('../ql/assistant/notes.cjs').createNoteDrafts(db,{now:()=>now,ttl:10,max:1});
 const a=drafts.draft('a','A');drafts.draft('b','B');assert.equal(drafts.confirm('a',a.state,true).result.status,'clarification');
 const b=drafts.draft('b','B');now=11;assert.equal(drafts.confirm('b',b.state,true).result.status,'clarification');
});
test('note confirmation rechecks auth, aborts and error invalidation before any write',async()=>{
 const before=db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n;
 let draft=await ask('Add a studio note that Never save after auth change');let authCalls=0;
 await assert.rejects(core.turn({authorize:()=>++authCalls===1?'a':'b',request:{version:1,requestId:'auth-change',input:{text:'Save note'},context:draft.context}}),{code:'SESSION_CHANGED'});
 const abort=new AbortController();abort.abort();
 await assert.rejects(core.turn({authorize:()=> 'a',signal:abort.signal,request:{version:1,requestId:'abort-note',input:{text:'Save note'},context:draft.context}}),{code:'CANCELLED'});
 await assert.rejects(ask('Delete it',draft.context),{code:'ACTION_NOT_AVAILABLE'});
 assert.notEqual((await ask('Save note',draft.context)).result.status,'saved');
 draft=await ask('Add a studio note that Restart discards this');
 assert.notEqual((await ask('Save note',draft.context,'a',createAssistantCore(db))).result.status,'saved');
 await ask('Cancel',draft.context);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n,before);
});
test('save note cannot accidentally confirm a pending Piece clarification',async()=>{
 const piece=await ask('Open blue bowl');const clarification=await ask('What way is on blue phase',piece.context);
 const r=await ask('Save note',clarification.context);assert.equal(r.result.status,'clarification');assert.equal(r.response.navigation,undefined);assert.match(r.response.text,/no current Studio Note draft/);
});
test('natural new-note dialogue gathers actual words then confirms before save',async()=>{
 const before=db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n;
 let start=await ask('Create new note about glazing');assert.equal(start.result.status,'collecting');assert.match(start.response.text,/what.*note to say about glazing/i);assert.equal(start.response.navigation,undefined);
 start=await ask('Save note',start.context);assert.equal(start.result.status,'collecting');
 const draft=await ask('Try three coats of Ocean next time.',start.context);assert.equal(draft.result.status,'draft');assert.match(draft.response.text,/Try three coats of Ocean next time\./);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n,before);
 const saved=await ask('Save note',draft.context);assert.equal(saved.result.status,'saved');assert.equal(db.prepare('SELECT body FROM studio_notes WHERE id=?').get(saved.result.noteId).body,'Try three coats of Ocean next time.');
 assert.notEqual((await ask('Save note',draft.context)).result.status,'saved');
 for(const text of ['Create a new note','Make a studio note','Add a new studio note about firing']){
  const collecting=await ask(text);assert.equal(collecting.result.status,'collecting');assert.equal((await ask('Cancel',collecting.context)).result.status,'canceled');
 }
});
test('note dialogue rejects foreign/expired context, preserves commands and direct dictation',async()=>{
 const start=await ask('Create new note about glazing');
 await assert.rejects(ask('Try three coats.',start.context,'b'),{code:'UNSUPPORTED_INTENT'});
 const nav=await ask('Open my pieces',start.context);assert.equal(nav.response.navigation.page,'pieces');
 await assert.rejects(ask('Try three coats.',start.context),{code:'UNSUPPORTED_INTENT'});
 const fresh=await ask('Create new note');await assert.rejects(ask('Delete all my pieces',fresh.context),{code:'ACTION_NOT_AVAILABLE'});
 for(const text of ['Create a new note saying Exact Words','Add a note that Exact Words']){
  const r=await ask(text);assert.equal(r.result.status,'draft');assert.match(r.response.text,/Exact Words/);await ask('Cancel',r.context);
 }
 let now=0;const drafts=require('../ql/assistant/notes.cjs').createNoteDrafts(db,{now:()=>now,ttl:10});const begin=drafts.begin('a','glazing');assert.equal(drafts.wantsText('a',begin.state),true);now=10;assert.equal(drafts.wantsText('a',begin.state),false);
});
test('incomplete note refuses saving; next full sentence replaces draft before explicit save',async()=>{
 const before=db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n;
 const start=await ask('Create new note about needing to buy sapphire glaze');
 const clipped=await ask("I've been",start.context);assert.equal(clipped.result.status,'draft');
 const blocked=await ask('Save note',clipped.context);assert.equal(blocked.result.status,'incomplete');assert.match(blocked.response.text,/Nothing has been saved/);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM studio_notes').get().n,before);
 const corrected=await ask('I need to buy sapphire glaze.',blocked.context);assert.equal(corrected.result.status,'draft');
 assert.notEqual((await ask('Save note',clipped.context)).result.status,'saved');
 const saved=await ask('Save note',corrected.context);assert.equal(saved.result.status,'saved');
 assert.equal(db.prepare('SELECT body FROM studio_notes WHERE id=?').get(saved.result.noteId).body,'I need to buy sapphire glaze.');
 const pending=await ask('Create new note');const replacement=await ask('Replace note with Buy sapphire glaze.',pending.context);assert.equal(replacement.result.status,'draft');await ask('Cancel',replacement.context);
});
