'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),fixture=require('../ql/assistant-voice-validation/fixture.cjs');
const root=path.resolve(__dirname,'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await pause(10);}throw Error('Timed out');}
test('recovery: real note phrases through speech events, HTTP, displayed content, SQLite and resumed listening',async()=>{
 let dom;
 try {
  await fixture.start('1','1','1','1');const {base,token,db}=fixture.state;
  db.prepare('INSERT INTO pieces (id,user_id,title) VALUES (?,?,?)').run('blue','a','Blue bowl');
  db.prepare('INSERT INTO glazes (id,user_id,name) VALUES (?,?,?)').run('ocean','a','Ocean');
  db.prepare('INSERT INTO piece_glazes (id,piece_id,glaze_id) VALUES (?,?,?)').run('layer','blue','ocean');
  db.prepare("UPDATE firing_logs SET piece_id='blue' WHERE user_id='a'").run();
  dom=new JSDOM(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),{url:base+'/#qlAssistant',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,engines=[],requests=[],spoken=[];Object.defineProperty(w,'isSecureContext',{value:true});
  w.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  w.speechSynthesis={speak(s){spoken.push(s.text);queueMicrotask(()=>{s.onstart?.();s.onend?.();});},cancel(){}};
  w.localStorage.setItem('mudlog_token',token);w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.setInterval=()=>0;
  w.fetch=(url,opts={})=>{const target=new URL(url,base);assert.equal(target.origin,base);requests.push({url:target.pathname,body:opts.body});return fetch(target.href,opts);};
  w.webkitSpeechRecognition=class {constructor(){engines.push(this);}start(){this.onaudiostart?.();}stop(){queueMicrotask(()=>this.onend?.());}abort(){}result(text){this.onresult?.({results:[{isFinal:true,0:{transcript:text}}]});}};
  for(const file of ['website-utils.js','app.js','studio-search.js','ql-assistant.js'])require('node:vm').runInContext(fs.readFileSync(path.join(root,'public',file),'utf8'),dom.getInternalVMContext());
  await until(()=>w.QLAssistant?.available());w.navigate('qlAssistant');
  const el=id=>w.document.getElementById(id);el('qlAssistantSpokenReplies').checked=true;el('qlAssistantSessionStart').click();
  async function say(text){const count=engines.length;const engine=engines.at(-1);engine.onresult?.({results:[{isFinal:false,0:{transcript:text}}]});assert.ok(el('qlAssistantSessionCommand').textContent.includes(text),'live transcript visible');assert.equal(el('qlAssistantForm').getAttribute('aria-busy'),'false');engine.result(text);engine.onend?.();await until(()=>engines.length>count);return el('qlAssistantResponse').textContent;}

  const cases=[
   ['I need to make 25 soy sauce dishes in B-Mix clay.'],
   ['Make 30 soy sauce dishes in electric brown clay, fire at cone 04.'],
   ['Make 40 soy sauce dishes in terra-cotta clay, fire at cone 04.'],
   ['Okay, could you please make thirty soy sauce dishes using electric brown clay, fired at cone 04.'],
   ['In B-Mix clay, I need to make 25 soy sauce dishes.'],
   ['I need to, um, make a soy sauce dish in B-Mix clay.'],
   ['New note','Fire at cone 04, using terra-cotta clay, make 40 soy sauce dishes.'],
   ['Make 40 soy sauce dishes in terra-cotta clay','fire at cone 04'],
   ['Make 30 soy sauce dishes','in electric brown clay','fire at cone 04']
  ];
  let total=0;
  for(const phrases of cases){
   await say('Open glazes');
   const content=phrases.filter(p=>p!=='New note').join(' ');
   for(const phrase of phrases)await say(phrase);
   assert.equal(el('qlAssistantNotePreviewText').textContent,content,'exact complete draft: '+content);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n,total,'nothing saved before confirmation');
   assert.match(await say('Okay, save it please.'),/Saved your Studio Note/);
   await until(()=>el('studioNotesList').textContent.includes(content));
   assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a' AND body=?").get(content).n,1);
   // Reopen through canonical HTTP after saving: persistence is not just the preview.
   const saved=await fetch(base+'/api/studio/notes',{headers:{Authorization:'Bearer '+token}}).then(r=>r.json());
   assert.ok(JSON.stringify(saved).includes(content));
   total++;
   assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n,total);
   assert.match(await say('Save note'),/already saved/);
   assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n,total,'no duplicates');
  }
  await say('Open glazes');
  const full='Make 30 soy sauce dishes in electric brown clay fire at cone 04';
  await say(full);await say('104');
  assert.equal(el('qlAssistantNotePreviewText').textContent,full);
  assert.match(await say('Save note'),/Should I add/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n,total);
  await say('Keep the original');await say('Save note');total++;
  await say('Open glazes');
  await say('Make 25 soy sauce dishes in the mix clay');
  assert.match(el('qlAssistantResponse').textContent,/Did you mean “B-Mix clay”/);
  await say('Save note');assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n,total);
  await say('I said Bmix');
  assert.equal(el('qlAssistantNotePreviewText').textContent,'Make 25 soy sauce dishes in B-Mix clay');
  await say('Save note');total++;
  await until(()=>el('studioNotesList').textContent.includes('Make 25 soy sauce dishes in B-Mix clay'));
  await say('Add sapphire float glaze to last note');await say('Save note');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n,total);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a' AND body=?").get('Make 25 soy sauce dishes in B-Mix clay\nsapphire float glaze').n,1);
  // October 8 acceptance: real client speech -> HTTP -> saved-row editing,
  // with spoken acknowledgement and listening resumed by say() after each turn.
  const before='I need to make three ring dishes in B-Mix clay, fired to cone 6, using Sapphire Float.';
  const after=before.replace('I need to make','I made');
  await say('New note '+before.replace('B-Mix','BMX'));
  assert.match(el('qlAssistantResponse').textContent,/Did you mean “B-Mix clay”/);
  await say('yes');await say('Save note');
  const noteId=db.prepare('SELECT id FROM studio_notes WHERE user_id=? AND body=?').get('a',before).id;
  await say('Remove I need to make and put I made instead');
  assert.equal(el('qlAssistantNotePreviewText').textContent,after);
  assert.match(await say('Save note'),/Updated your Studio Note/);
  assert.equal(db.prepare('SELECT body FROM studio_notes WHERE id=?').get(noteId).body,after);
  assert.equal(spoken.at(-1),'Done. I updated the note.','saved edit confirmed aloud');
  assert.match(await say('When was my last firing?'),/2026-10-01/);
  assert.ok(engines.length>30,'one activation supports all turns');
 } finally {await pause(50);dom?.window.close();await fixture.stop();}
});
