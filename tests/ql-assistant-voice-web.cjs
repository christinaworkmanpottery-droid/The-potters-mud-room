'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root,file),'utf8');
const tick = () => new Promise(r => setTimeout(r,20));
async function fixture(t, config = {enabled:true,voiceEnabled:true}, support = 'standard') {
  const dom = new JSDOM(source('public/index.html'), {url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window, calls = [], pending = [], engines = [], timers = new Map();
  const nativeSetTimeout = w.setTimeout.bind(w);
  w.setTimeout = (fn, ms) => { const id = nativeSetTimeout(fn, ms); timers.set(ms, fn); return id; };
  Object.defineProperty(w, 'isSecureContext', {value:support !== 'insecure'});
  class Speech {
    constructor() { if(support === 'constructor-error') throw Error('unavailable'); this.starts=0;this.stops=0;this.aborts=0;engines.push(this); }
    start() { this.starts++; if(support === 'start-error') throw Error('permission'); }
    stop() { this.stops++; if(support === 'stop-error') throw Error('stopped'); }
    abort() { this.aborts++; }
    result(text, final=true) { this.onresult?.({resultIndex:0,results:[{isFinal:final,0:{transcript:text}}]}); if(final) this.onend?.(); }
  }
  if(support !== 'none') w[support === 'prefixed' ? 'webkitSpeechRecognition' : 'SpeechRecognition'] = Speech;
  const style = w.document.createElement('style'); style.textContent = source('public/style.css'); w.document.head.append(style);
  t.after(async () => { await tick(); w.close(); });
  w.localStorage.setItem('mudlog_token','token-a');
  w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {}; w.setInterval = () => 0;
  w.fetch = async (url, options = {}) => {
    calls.push({url,options});
    if (url === '/api/ql/assistant/config') { if (config instanceof Error) throw config; return {ok:true,json:async()=>config}; }
    if (url === '/api/ql/assistant/turn') return new Promise((resolve,reject) => pending.push({resolve,reject,options,body:JSON.parse(options.body)}));
    let data = [];
    if (url === '/api/auth/me') data = {user:{id:'a',email:'a@example.invalid',tier:'free'}};
    if (url === '/api/dashboard') data = {totalPieces:0,totalClays:0,totalGlazes:0,sales:{total:0},recentPieces:[],statusCounts:[]};
    return {ok:true,status:200,json:async()=>data};
  };
  const run = code => require('node:vm').runInContext(code, dom.getInternalVMContext());
  run(source('public/website-utils.js')); run(source('public/app.js'));
  await tick(); run(source('public/ql-assistant.js')); await tick();
  const el = id => w.document.getElementById(id);
  if (el('qlAssistantEntry')) w.navigate('qlAssistant');
  const send = (text = 'When was my last firing?') => {
    el('qlAssistantInput').value = text;
    el('qlAssistantForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  };
  const reply = (i=0,text='Your latest recorded firing date is 2026-10-01.',extra={}) => pending[i].resolve({ok:true,status:200,json:async()=>({version:1,requestId:pending[i].body.requestId,accountId:'a',response:{text},...extra})});
  return {w,el,send,reply,pending,calls,engines,timers,talk:()=>el('qlAssistantTalk')?.click()};
}
for(const config of [{enabled:false,voiceEnabled:true},{enabled:true},{enabled:true,voiceEnabled:false},{enabled:true,voiceEnabled:'true'}]) test('voice flag fails closed '+JSON.stringify(config),async t=>{const f=await fixture(t,config);assert.equal(f.el('qlAssistantTalk'),null);assert.equal(f.engines.length,0);});
for(const support of ['none','insecure']) test('capability fallback '+support,async t=>{const f=await fixture(t,undefined,support);assert.equal(f.el('qlAssistantTalk').disabled,true);assert.equal(f.w.getComputedStyle(f.el('qlAssistantTalk')).display,'none');assert.match(f.el('qlAssistantVoiceStatus').textContent,/unavailable/);f.send();f.reply();await tick();assert.match(f.el('qlAssistantResponse').textContent,/2026/);});
for(const support of ['standard','prefixed']) test('explicit start and stop with '+support,async t=>{const f=await fixture(t,undefined,support);assert.equal(f.engines.length,0);f.talk();const e=f.engines[0];assert.equal(e.starts,1);assert.equal(e.continuous,false);assert.equal(e.interimResults,true);assert.equal(e.maxAlternatives,1);e.onstart();assert.match(f.el('qlAssistantVoiceStatus').textContent,/Listening/);assert.equal(f.el('qlAssistantInput').disabled,false);f.el('qlAssistantStop').click();f.el('qlAssistantStop').click();assert.equal(e.stops,1);e.result('When was my last firing?');assert.deepEqual(f.pending[0].body.input,{text:'When was my last firing?'});f.reply();await tick();assert.match(f.el('qlAssistantResponse').textContent,/2026/);});
test('cancel stops and suppresses already queued final event',async t=>{const f=await fixture(t);f.talk();const e=f.engines[0],late=e.onresult;f.el('qlAssistantCancelVoice').click();assert.equal(e.aborts,1);late({results:[{isFinal:true,0:{transcript:'last firing'}}]});assert.equal(f.pending.length,0);assert.equal(f.el('qlAssistantInput').value,'');assert.match(f.el('qlAssistantVoiceStatus').textContent,/canceled/);});
test('duplicate taps and final events send exactly once',async t=>{const f=await fixture(t);f.talk();f.talk();assert.equal(f.engines.length,1);const e=f.engines[0],event={results:[{isFinal:true,0:{transcript:'last firing'}}]},callback=e.onresult;callback(event);callback(event);e.onend();f.el('qlAssistantForm').requestSubmit();assert.equal(f.pending.length,1);assert.equal(e.aborts,0);assert.equal(f.pending[0].options.headers.Authorization,'Bearer token-a');});
test('interim speech never populates or submits',async t=>{const f=await fixture(t);f.talk();f.engines[0].result('partial secret',false);assert.equal(f.pending.length,0);assert.equal(f.el('qlAssistantInput').value,'');});
test('unsupported speech uses same safe unsupported response',async t=>{const f=await fixture(t);f.talk();f.engines[0].result('Tell me a joke');assert.equal(f.pending[0].body.input.text,'Tell me a joke');f.pending[0].resolve({ok:false,status:400,json:async()=>({code:'UNSUPPORTED_INTENT'})});await tick();assert.match(f.el('qlAssistantResponse').textContent,/isn’t supported/);assert.equal(f.pending.length,1);});
for(const error of ['not-allowed','service-not-allowed','audio-capture','network','no-speech','aborted','language-not-supported']) test('nonblocking speech error '+error,async t=>{const f=await fixture(t);f.talk();const e=f.engines[0];e.onerror({error});assert.equal(e.aborts,1);assert.match(f.el('qlAssistantVoiceStatus').textContent,/type your question/);assert.equal(f.el('qlAssistantTalk').disabled,false);f.send();f.reply();await tick();assert.match(f.el('qlAssistantResponse').textContent,/2026/);});
for(const support of ['constructor-error','start-error','stop-error']) test('engine exception fallback '+support,async t=>{const f=await fixture(t,undefined,support);f.talk();if(support==='stop-error')f.el('qlAssistantStop').click();assert.match(f.el('qlAssistantVoiceStatus').textContent,/type your question/);f.send();assert.equal(f.pending.length,1);});
for(const text of ['', 'a'.repeat(201)]) test('empty or oversized speech does not submit '+text.length,async t=>{const f=await fixture(t);f.talk();f.engines[0].result(text);assert.equal(f.pending.length,0);assert.equal(f.el('qlAssistantInput').value,'');assert.match(f.el('qlAssistantVoiceStatus').textContent,/200/);});
test('engine ending without final result allows explicit retry only',async t=>{const f=await fixture(t);f.talk();f.engines[0].onend();assert.equal(f.engines.length,1);assert.match(f.el('qlAssistantVoiceStatus').textContent,/No speech/);f.talk();assert.equal(f.engines.length,2);});
for(const ms of [20000,5000]) test('bounded timeout '+ms,async t=>{const f=await fixture(t);f.talk();if(ms===5000)f.el('qlAssistantStop').click();f.timers.get(ms)();if(ms===20000)f.timers.get(5000)();assert.equal(f.engines[0].aborts,1);assert.equal(f.el('qlAssistantTalk').disabled,false);assert.equal(f.pending.length,0);});
const changes={
 navigation:f=>f.w.navigate('firings'),
 logout:f=>f.w.logout(),
 account:f=>f.w.eval("setAuthUser({id:'b'})"),
 token:f=>f.w.eval("setAuthToken('replacement')"),
 roundtrip:f=>f.w.eval("setAuthUser({id:'b'});setAuthUser({id:'a'});"),
 invalid:f=>f.w.QLAssistant.sessionInvalid(),
 storage:f=>{f.w.localStorage.setItem('mudlog_token','replacement');f.w.dispatchEvent(new f.w.StorageEvent('storage',{key:'mudlog_token'}));},
 hidden:f=>{Object.defineProperty(f.w.document,'hidden',{value:true});f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));},
 pagehide:f=>f.w.dispatchEvent(new f.w.Event('pagehide')),
 hash:f=>{f.w.history.pushState({},'','#firings');f.w.dispatchEvent(new f.w.HashChangeEvent('hashchange'));},
 popstate:f=>{f.w.history.pushState({},'','#firings');f.w.dispatchEvent(new f.w.PopStateEvent('popstate'));}
};
for(const [name,change] of Object.entries(changes)) {
 test('cancel recognition and stale transcript on '+name,async t=>{const f=await fixture(t);f.talk();const e=f.engines[0],late=e.onresult,error=e.onerror,start=e.onstart,end=e.onend;change(f);assert.equal(e.aborts,1);late({results:[{isFinal:true,0:{transcript:'private last firing'}}]});error({error:'not-allowed'});start();end();assert.equal(f.el('qlAssistantInput').value,'');assert.equal(f.el('qlAssistantVoiceStatus').textContent,'');assert.equal(f.pending.length,0);});
 test('cancel request and stale voice answer on '+name,async t=>{const f=await fixture(t);f.talk();f.engines[0].result('last firing');change(f);assert.equal(f.pending[0].options.signal.aborted,true);f.reply(0,'private stale');await tick();assert.equal(f.el('qlAssistantResponse').textContent,'');assert.equal(f.el('qlAssistantInput').value,'');});
}
test('new voice attempt aborts older assistant response',async t=>{const f=await fixture(t);f.send();f.talk();assert.equal(f.pending[0].options.signal.aborted,true);f.reply(0,'stale');await tick();assert.equal(f.el('qlAssistantResponse').textContent,'');f.engines[0].result('last firing');f.reply(1,'current');await tick();assert.equal(f.el('qlAssistantResponse').textContent,'current');});
test('cancel then retry rejects queued events from old engine',async t=>{const f=await fixture(t);f.talk();const late=f.engines[0].onresult;f.el('qlAssistantCancelVoice').click();f.talk();late({results:[{isFinal:true,0:{transcript:'stale'}}]});assert.equal(f.pending.length,0);f.engines[1].result('last firing');assert.equal(f.pending.length,1);});
test('typing takes over without late transcript overwriting edit',async t=>{const f=await fixture(t);f.talk();const late=f.engines[0].onresult;f.el('qlAssistantInput').value='manual';f.el('qlAssistantInput').dispatchEvent(new f.w.Event('input'));late({results:[{isFinal:true,0:{transcript:'stale'}}]});assert.equal(f.el('qlAssistantInput').value,'manual');assert.equal(f.engines[0].aborts,1);f.send('last firing');assert.equal(f.pending.length,1);});
test('typed submit cancels active recognition and retains original typed path',async t=>{const f=await fixture(t);f.talk();f.send();assert.equal(f.engines[0].aborts,1);assert.equal(f.pending.length,1);f.reply();await tick();assert.match(f.el('qlAssistantResponse').textContent,/2026/);});
test('hidden foreground cannot start or submit',async t=>{const f=await fixture(t);Object.defineProperty(f.w.document,'hidden',{value:true});f.talk();f.send();assert.equal(f.engines.length,0);assert.equal(f.pending.length,0);});
test('no audio/transcript storage, external request, legacy route or chat writes',async t=>{const f=await fixture(t);const storage=JSON.stringify(f.w.localStorage),start=f.calls.length;f.talk();f.engines[0].result('last firing');f.reply();await tick();assert.deepEqual(f.calls.slice(start).map(c=>c.url),['/api/ql/assistant/turn']);assert.equal(JSON.stringify(f.w.localStorage),storage);assert.equal(f.w.sessionStorage.length,0);assert.doesNotMatch(source('public/ql-assistant.js'),/MediaRecorder|getUserMedia|indexedDB|setItem|\/api\/ai\/chat|speechSynthesis|console\./);assert.match(f.el('qlAssistantVoice').textContent,/browser may send audio/);});
test('voice stop/cancel truly hidden when idle',async t=>{const f=await fixture(t);assert.equal(f.w.getComputedStyle(f.el('qlAssistantStop')).display,'none');assert.equal(f.w.getComputedStyle(f.el('qlAssistantCancelVoice')).display,'none');});

// Regression: distinguish visible focus changes, interim-only speech, and engine end.
test('visible browser focus loss does not discard microphone session',async t=>{
 const f=await fixture(t);f.talk();const e=f.engines[0];f.w.dispatchEvent(new f.w.Event('blur'));
 assert.equal(e.aborts,0);e.result('Open test tiles');assert.equal(f.pending[0].body.input.text,'Open test tiles');
});
test('five consecutive speech attempts complete without aborting successful engines',async t=>{
 const f=await fixture(t);
 for(let i=0;i<5;i++){f.talk();const e=f.engines[i];e.onstart();e.onaudiostart();e.result('When was my last firing?');f.reply(i);await tick();assert.equal(e.aborts,0);assert.equal(f.el('qlAssistantTalk').disabled,false);}
 assert.equal(f.pending.length,5);
});
test('interim-only disconnect preserves editable draft but never auto-submits',async t=>{
 const f=await fixture(t);f.talk();const e=f.engines[0];e.result('open test tiles',false);e.onend();
 assert.equal(e.aborts,0);assert.equal(f.el('qlAssistantInput').value,'open test tiles');assert.equal(f.pending.length,0);
 assert.match(f.el('qlAssistantVoiceStatus').textContent,/tap Send/);f.el('qlAssistantForm').requestSubmit();assert.equal(f.pending.length,1);
});
test('final waits for disconnect; another tap cannot overlap engines',async t=>{
 const f=await fixture(t);f.talk();const e=f.engines[0];e.onresult({results:[{isFinal:true,0:{transcript:'last firing'}}]});
 f.talk();assert.equal(f.engines.length,1);assert.equal(f.pending.length,0);assert.equal(e.stops,1);assert.equal(e.aborts,0);
 e.onend();assert.equal(f.pending.length,1);assert.equal(f.el('qlAssistantTalk').disabled,false);
});
test('stop timeout preserves interim draft and requires Send',async t=>{
 const f=await fixture(t);f.talk();f.engines[0].result('open glazes',false);f.el('qlAssistantStop').click();f.timers.get(5000)();
 assert.equal(f.pending.length,0);assert.equal(f.el('qlAssistantInput').value,'open glazes');assert.match(f.el('qlAssistantVoiceStatus').textContent,/tap Send/);
});
test('sound without recognized text reports recognizer outcome instead of claiming silence',async t=>{
 const f=await fixture(t);f.talk();const e=f.engines[0];e.onsoundstart();e.onend();
 assert.match(f.el('qlAssistantVoiceStatus').textContent,/Sound was detected/);assert.equal(f.pending.length,0);assert.equal(f.el('qlAssistantTalk').disabled,false);
});
test('late final after interim draft cancellation cannot navigate',async t=>{
 const f=await fixture(t);f.talk();const e=f.engines[0],late=e.onresult;e.result('open glazes',false);f.el('qlAssistantCancelVoice').click();
 late({results:[{isFinal:true,0:{transcript:'open glazes'}}]});assert.equal(f.pending.length,0);assert.equal(f.el('qlAssistantInput').value,'');
});
test('five explicit retries recover after no-speech errors',async t=>{
 const f=await fixture(t);
 for(let i=0;i<5;i++){f.talk();f.engines[i].onerror({error:'no-speech'});assert.equal(f.el('qlAssistantTalk').disabled,false);assert.equal(f.pending.length,0);}
 f.talk();f.engines[5].result('last firing');assert.equal(f.pending.length,1);
});
test('pending finalized speech cannot submit after account replacement',async t=>{
 const f=await fixture(t);f.talk();const e=f.engines[0],end=e.onend;
 e.onresult({results:[{isFinal:true,0:{transcript:'open contacts'}}]});
 f.w.eval("setAuthUser({id:'b'})");end();assert.equal(f.pending.length,0);assert.equal(f.el('qlAssistantInput').value,'');
});
