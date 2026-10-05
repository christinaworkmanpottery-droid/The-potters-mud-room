'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),fixture=require('../ql/assistant-voice-validation/fixture.cjs');
const root=path.resolve(__dirname,'..'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<700;i++){if(fn())return;await pause(10);}throw Error('Timed out waiting for Safari turn completion');}
const segment=(text,isFinal=true)=>({isFinal,0:{transcript:text,confidence:.9}});

test('Safari missing second-turn onend: silent three-turn note saves once, with live preview and no overlapping recognizers',async()=>{
 let dom;
 try {
  await fixture.start('1','1','1','1');const {base,token,db}=fixture.state;
  dom=new JSDOM(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),{url:base+'/#qlAssistant',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window,engines=[],turns=[];let owner=null;
  Object.defineProperty(w,'isSecureContext',{value:true});
  w.localStorage.setItem('mudlog_token',token);w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.setInterval=()=>0;
  // Basic dictation must work without any speech synthesis implementation.
  w.fetch=async(url,opts={})=>{const target=new URL(url,base);assert.equal(target.origin,base);const res=await fetch(target.href,opts);
   if(target.pathname==='/api/ql/assistant/turn')turns.push({input:JSON.parse(opts.body).input.text,result:await res.clone().json()});return res;};
  w.webkitSpeechRecognition=class {
   constructor(){assert.equal(owner,null,'no new recognizer while previous owner is connected');this.stops=0;engines.push(this);}
   start(){assert.equal(owner,null);owner=this;this.onaudiostart?.();}
   end(){if(owner===this)owner=null;this.onend?.();}
   stop(){this.stops++;queueMicrotask(()=>this.end());}
   abort(){if(owner===this)owner=null;}
   result(...results){this.onresult?.({results});}
  };
  for(const file of ['website-utils.js','app.js','studio-search.js','ql-assistant.js'])require('node:vm').runInContext(fs.readFileSync(path.join(root,'public',file),'utf8'),dom.getInternalVMContext());
  await until(()=>w.QLAssistant?.available());w.navigate('qlAssistant');const el=id=>w.document.getElementById(id);
  assert.equal(el('qlAssistantSpokenReplies').checked,false);el('qlAssistantSessionStart').click();
  const first=engines[0];assert.equal(first.continuous,false);first.result(segment('New note'));first.end();
  await until(()=>engines.length===2);
  assert.equal(turns[0].result.result.tool,'studio.note');assert.equal(turns[0].result.result.status,'collecting');
  assert.match(el('qlAssistantResponse').textContent,/What.*note.*say/i);assert.equal(first.stops,0,'natural onend cancels disconnect timer');
  const body='I need to buy sapphire glaze',second=engines[1];
  second.result(segment(body,false));assert.equal(el('qlAssistantNotePreviewText').textContent,body);assert.equal(turns.length,1);
  const lateEnd=second.onend;second.result(segment(body));
  // Deliberately NO manual onend here. Only stop() can release this recognizer.
  await until(()=>engines.length===3);
  assert.equal(second.stops,1);assert.equal(turns.length,2);assert.equal(turns[1].input,body);
  assert.equal(el('qlAssistantNotePreviewText').textContent,body);assert.equal(turns[1].result.result.draftText,body);
  lateEnd();assert.equal(turns.length,2,'a queued duplicate terminal event cannot resubmit');
  const save=engines[2];save.result(segment('Save note'));
  // Save also uses the real fallback, with no manually supplied terminal event.
  await until(()=>engines.length===4);assert.equal(save.stops,1);
  assert.equal(turns.length,3);assert.match(el('qlAssistantResponse').textContent,/Saved your Studio Note/);
  assert.deepEqual(db.prepare("SELECT body FROM studio_notes WHERE user_id='a'").all(),[{body}]);
  await until(()=>el('studioNotesList').textContent.includes(body));

  // Multi-segment dictation: a later interim result cancels the first deadline,
  // even if that interim remains pending past the entire disconnect interval.
  const newNote=engines.at(-1);newNote.result(segment('New note'));newNote.end();await until(()=>engines.length===5);
  const multi=engines.at(-1),a='Make 40 soy sauce dishes in terra-cotta clay',b='fire at cone 04';
  multi.result(segment(a));await pause(1800);assert.equal(multi.stops,0,'not the old 1.5 second endpoint');
  multi.result(segment(a),segment('fire at cone',false));await pause(3300);
  assert.equal(multi.stops,0,'interim continuation cancels fallback');assert.equal(turns.length,4,'no interim submission');
  multi.result(segment(a),segment(b));await until(()=>engines.length===6);
  assert.equal(multi.stops,1);assert.equal(turns[4].input,a+' '+b);assert.equal(el('qlAssistantNotePreviewText').textContent,a+' '+b);
  const saveMulti=engines.at(-1);saveMulti.result(segment('Save note'));saveMulti.end();await until(()=>engines.length===7);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a' AND body=?").get(a+' '+b).n,1);

  const cancelled=engines.at(-1);cancelled.result(segment('New note'));el('qlAssistantSessionStop').click();
  await pause(3300);assert.equal(cancelled.stops,0);assert.equal(turns.length,6);assert.equal(engines.length,7);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM studio_notes WHERE user_id='a'").get().n,2);
 } finally {dom?.window.close();await fixture.stop();}
});
