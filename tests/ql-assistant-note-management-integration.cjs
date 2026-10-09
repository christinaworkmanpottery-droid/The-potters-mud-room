'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom'),fixture=require('../ql/assistant-voice-validation/fixture.cjs');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<400;i++){if(fn())return;await pause(10);}throw Error('Timed out');}
test('website + HTTP + real SQL: note selection, social, rename, deletion, share and continuing speech',async()=>{
 let dom;try{
  await fixture.start('1','1','1','1');const {base,token,db}=fixture.state;
  db.prepare('INSERT INTO contacts(id,user_id,name,email) VALUES(?,?,?,?)').run('s','a','Sarah','sarah@example.invalid');
  dom=new JSDOM(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),{url:base+'/#qlAssistant',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,engines=[];Object.defineProperty(w,'isSecureContext',{value:true});w.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  w.speechSynthesis={speak(s){queueMicrotask(()=>{s.onstart?.();s.onend?.();});},cancel(){}};
  w.localStorage.setItem('mudlog_token',token);w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.setInterval=()=>0;
  w.fetch=(url,opts={})=>{const target=new URL(url,base);assert.equal(target.origin,base);return fetch(target.href,opts);};
  w.webkitSpeechRecognition=class{constructor(){engines.push(this);}start(){this.onaudiostart?.();}stop(){queueMicrotask(()=>this.onend?.());}abort(){}result(text){this.onresult?.({results:[{isFinal:true,0:{transcript:text}}]});}};
  for(const file of ['website-utils.js','app.js','studio-search.js','ql-note-sharing.js','ql-assistant.js'])vm.runInContext(fs.readFileSync(path.join(root,'public',file),'utf8'),dom.getInternalVMContext());
  await until(()=>w.QLAssistant?.available());w.navigate('qlAssistant');const el=id=>w.document.getElementById(id);el('qlAssistantSpokenReplies').checked=true;el('qlAssistantSessionStart').click();
  async function say(text){const count=engines.length;engines.at(-1).result(text);engines.at(-1).onend?.();await until(()=>engines.length>count);return el('qlAssistantResponse').textContent;}
  await say('New note I need to make ring dishes in B-Mix clay with Sapphire Float and Tuscan Blue glaze.');
  assert.match(await say('Thank you, Clayton'),/welcome/);
  await say('save note');const saved=db.prepare("SELECT * FROM studio_notes WHERE user_id='a'").get();assert.match(saved.title,/Ring Dishes/);assert.doesNotMatch(saved.body,/Thank you/);
  assert.match(await say('Find my note about ring dishes'),/Opening/);await until(()=>el('studioNoteId').value===saved.id);assert.equal(el('studioNoteBody').value,saved.body);
  await say('Rename that note to Glaze project');assert.equal(db.prepare('SELECT title FROM studio_notes WHERE id=?').get(saved.id).title,'Glaze project');assert.equal(el('studioNoteTitle').value,'Glaze project');
  await say('Delete previous note');assert.match(await say('cancel'),/Canceled/);assert.ok(db.prepare('SELECT id FROM studio_notes WHERE id=?').get(saved.id));
  await say('Email my glaze project note to Sarah');await say('first');assert.match(await say('yes'),/Sharing prepared/);assert.ok(el('qlNoteSharing'));assert.match(el('qlNoteSharing').textContent,/Glaze project/);
  await say('cancel sending');assert.equal(el('qlNoteSharing'),null);
  await say('Delete my glaze project note');assert.match(await say('yes'),/Deleted/);assert.equal(db.prepare('SELECT id FROM studio_notes WHERE id=?').get(saved.id),undefined);assert.equal(el('studioNoteModal').classList.contains('open'),false);await until(()=>!el('studioNotesList').textContent.includes('Glaze project'));
  assert.match(await say('Thanks'),/welcome/);
 }finally{dom?.window.close();await fixture.stop();}
});
