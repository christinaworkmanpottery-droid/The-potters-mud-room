'use strict';
// Strongest available fallback: full website scripts + actual synthetic HTTP/core/DB.
// JSDOM is NOT a browser engine. Speech events are explicitly simulated.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom'),fixture=require('./fixture.cjs');
const root=path.resolve(__dirname,'../..');
const report={runtime:'Node '+process.version+' / JSDOM '+require('jsdom/package.json').version,browser:false,realMicrophone:false,speech:'simulated standard and prefixed constructors',checks:[]};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<300;i++){if(fn())return;await pause(10)}throw Error('Condition timed out')}
const check=(name,fn)=>{fn();report.checks.push(name);console.log('PASS '+name)};
(async()=>{try{
 await fixture.start('1','1','1');const {base,token,foreignToken,db}=fixture.state;
 db.prepare("UPDATE firing_logs SET date='2026-09-03' WHERE user_id='b'").run();
 for(const support of ['standard','prefixed','none']) {
  const dom=new JSDOM(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),{url:base+'/#qlAssistant',runScripts:'outside-only',pretendToBeVisual:true});
  try{
   const w=dom.window,engines=[],requests=[];
   Object.defineProperty(w,'isSecureContext',{value:true});
   w.localStorage.setItem('mudlog_token',token);w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.setInterval=()=>0;
   w.fetch=(url,options={})=>{const target=new URL(url,base);assert.equal(target.origin,base);requests.push({path:target.pathname,body:options.body});return fetch(target,options)};
   class Speech {constructor(){engines.push(this);this.aborts=0;this.stops=0}start(){this.onstart?.()}stop(){this.stops++}abort(){this.aborts++}result(text){this.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:text}}]})}}
   if(support!=='none')w[support==='prefixed'?'webkitSpeechRecognition':'SpeechRecognition']=Speech;
   const style=w.document.createElement('style');style.textContent=fs.readFileSync(path.join(root,'public/style.css'),'utf8');w.document.head.append(style);
   for(const file of ['website-utils.js','app.js','ql-assistant.js'])require('node:vm').runInContext(fs.readFileSync(path.join(root,'public',file),'utf8'),dom.getInternalVMContext());
   await until(()=>w.QLAssistant?.available());w.navigate('qlAssistant');
   const el=id=>w.document.getElementById(id),input=el('qlAssistantInput'),output=el('qlAssistantResponse');
   const ready=()=>until(()=>el('qlAssistantForm').getAttribute('aria-busy')==='false');
   const send=async text=>{input.value=text;el('qlAssistantForm').requestSubmit();await ready()};
   const turns=()=>requests.filter(r=>r.path==='/api/ql/assistant/turn');
   const c=(name,fn)=>check(support+': '+name,fn);
   c('entry active; no automatic recognition',()=>{assert.equal(el('qlAssistantEntry').hidden,false);assert.equal(engines.length,0);assert.ok(el('pageQLAssistant').classList.contains('active'))});
   await send('When was my last firing?');const typed=output.textContent;
   c('typed path reaches factual DB result',()=>assert.equal(typed,'Your latest recorded firing date is 2026-10-01.'));
   if(support==='none'){c('unsupported microphone hidden; fallback usable',()=>{assert.equal(w.getComputedStyle(el('qlAssistantTalk')).display,'none');assert.equal(input.disabled,false)});continue}
   const storage=JSON.stringify(w.localStorage),chatBefore=w.localStorage.getItem('aiChatHistory');
   const start=()=>{el('qlAssistantTalk').click();return engines.at(-1)};
   let engine=start();c('explicit start has visible listening and typed input',()=>{assert.match(el('qlAssistantVoiceStatus').textContent,/Listening/);assert.equal(input.disabled,false);assert.equal(el('qlAssistantStop').hidden,false)});
   el('qlAssistantStop').click();const callback=engine.onresult;engine.result('When was my last firing?');callback({results:[{isFinal:true,0:{transcript:'When was my last firing?'}}]});await ready();
   c('stop; one speech request; identical typed/speech factual answer',()=>{assert.equal(engine.stops,1);assert.equal(turns().length,2);assert.equal(output.textContent,typed);assert.equal(input.value,'When was my last firing?')});
   await send('Tell me a joke');const unsupported=output.textContent;engine=start();engine.result('Tell me a joke');await ready();
   c('unsupported speech equals typed safe response',()=>{assert.match(unsupported,/isn’t supported/);assert.equal(output.textContent,unsupported)});
   engine=start();const stale=engine.onresult;el('qlAssistantCancelVoice').click();const before=turns().length;engine=start();stale({results:[{isFinal:true,0:{transcript:'stale'}}]});engine.result('last firing');await ready();
   c('cancel then second attempt drops stale transcript; exactly one new turn',()=>{assert.equal(turns().length,before+1);assert.equal(input.value,'last firing')});
   engine=start();engine.onerror({error:'not-allowed'});c('simulated permission denial is visible',()=>assert.match(el('qlAssistantVoiceStatus').textContent,/denied/));await send('last firing');c('typed fallback after denial reaches backend',()=>assert.equal(output.textContent,typed));
   for(const change of ['navigation','account','logout','session']){
    // Restore synthetic account through unchanged production auth setters.
    w.eval(`setAuthToken(${JSON.stringify(token)});setAuthUser({id:'a',tier:'starter'});`);w.localStorage.setItem('mudlog_token',token);w.QLAssistant.syncSession();w.navigate('qlAssistant');
    engine=start();const late=engine.onresult,prior=turns().length;
    if(change==='navigation')w.navigate('firings');
    if(change==='account'){w.eval(`setAuthToken(${JSON.stringify(foreignToken)});setAuthUser({id:'b',tier:'starter'});`);w.localStorage.setItem('mudlog_token',foreignToken);w.QLAssistant.syncSession()}
    if(change==='session')w.QLAssistant.sessionInvalid();
    if(change==='logout')w.logout();
    late({results:[{isFinal:true,0:{transcript:'private stale'}}]});
    c(change+' cancels engine and late transcript',()=>{assert.equal(engine.aborts,1);assert.equal(input.value,'');assert.equal(output.textContent,'');assert.equal(turns().length,prior)});
   }
   c('no chat-history writes or persisted transcripts',()=>{assert.deepEqual(w.localStorage.getItem('aiChatHistory'),chatBefore);assert.equal(w.sessionStorage.length,0);assert.ok(Object.keys(w.localStorage).every(k=>['mudlog_token','mudlog_visitor_key'].includes(k)));assert.doesNotMatch(JSON.stringify(w.localStorage),/last firing|Tell me a joke|private stale/);assert.ok(!storage.includes('firing'))});
   c('assistant requests use only existing turn endpoint',()=>{assert.equal(requests.some(r=>r.path==='/api/ai/chat'),false);for(const r of turns())assert.deepEqual(Object.keys(JSON.parse(r.body)).sort(),['input','requestId','version'])});
  } finally{await pause(250);dom.window.close()}
 }
 report.passed=report.checks.length;
} catch(e){report.error=e.stack;process.exitCode=1;console.error(e)}finally{await fixture.stop();fs.writeFileSync(path.join(__dirname,'evidence/runtime.json'),JSON.stringify(report,null,2))}})();
