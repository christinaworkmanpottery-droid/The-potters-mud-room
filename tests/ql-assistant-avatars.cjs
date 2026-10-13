'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root,file),'utf8');
const tick = () => new Promise(r => setTimeout(r,20));
async function fixture(t, config = {enabled:true,voiceEnabled:true,handsFreeEnabled:true}, support = 'standard', spokenDefault = false) {
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
    if (url === '/api/ql/assistant/preferences') data = {avatar:'bowl'};
    if (url === '/api/dashboard') data = {totalPieces:0,totalClays:0,totalGlazes:0,sales:{total:0},recentPieces:[],statusCounts:[]};
    return {ok:true,status:200,json:async()=>data};
  };
  const run = code => require('node:vm').runInContext(code, dom.getInternalVMContext());
  run(source('public/website-utils.js')); run(source('public/app.js'));
  await tick(); run(source('public/clayton-avatar-assets.js')); run(source('public/clayton-avatars.js')); run(source('public/ql-assistant.js')); await tick();
  const el = id => w.document.getElementById(id);
  if (el('qlAssistantEntry')) w.navigate('qlAssistant');
  if(el('qlAssistantSpokenReplies'))el('qlAssistantSpokenReplies').checked=!!spokenDefault;
  const send = (text = 'When was my last firing?') => {
    el('qlAssistantInput').value = text;
    el('qlAssistantForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  };
  const reply = (i=0,text='Your latest recorded firing date is 2026-10-01.',extra={}) => pending[i].resolve({ok:true,status:200,json:async()=>({version:1,requestId:pending[i].body.requestId,accountId:'a',response:{text},...extra})});
  return {w,el,send,reply,pending,calls,engines,timers,talk:()=>el('qlAssistantTalk')?.click()};
}

const start = f => { const b=f.el('qlAssistantSessionStart'); if(b && !b.hidden)b.click(); };
const state = f => f.el('qlAssistantSession').dataset.state;
const restart = f => { const fn=f.timers.get(650); if(typeof fn==='function') fn(); };
const avatar = f => f.w.document.querySelector('.clayton-stage');
test('six exact images, immediate selection and ordered per-account persistence',async t=>{
 const f=await fixture(t);const choices=[...f.w.document.querySelectorAll('[data-avatar]')];
 assert.equal(choices.length,6);assert.equal(avatar(f).querySelector('img').alt,'Studio Bowl');
 const expected=['Bag of Clay','Studio Bowl','Pottery Buddy','Studio Pebble','Moon & Stars','Microphone'];
 for(const [i,b] of choices.entries()) {b.click();assert.equal(avatar(f).querySelector('img').alt,expected[i]);assert.equal(b.getAttribute('aria-pressed'),'true');assert.match(avatar(f).querySelector('img').src,/^data:image\/jpeg;base64,/);}
 await tick();const puts=f.calls.filter(x=>x.options.method==='PUT');
 assert.equal(puts.length,6);assert.deepEqual(puts.map(x=>JSON.parse(x.options.body).avatar),['bag','bowl','buddy','pebble','moon','microphone']);
 assert.ok(puts.every(x=>x.options.headers.Authorization==='Bearer token-a'));
 assert.match(f.w.document.querySelector('.clayton-save').textContent,/Saved/);
 f.w.eval("currentUser = {id:'b',tier:'free'};token='token-b';localStorage.setItem('mudlog_token','token-b');QLAssistant.syncSession()");
 assert.equal(avatar(f).querySelector('img').alt,'Bag of Clay'); await tick();
 assert.equal(f.calls.filter(x=>x.url==='/api/ql/assistant/preferences').at(-1).options.headers.Authorization,'Bearer token-b');
});
test('Start Listening, actual microphone, processing and Stop share the existing engine',async t=>{
 const f=await fixture(t);f.el('clayton-start').click();assert.equal(f.engines.length,1);
 f.el('clayton-start').click();assert.equal(f.engines.length,1);
 f.engines[0].onstart();assert.equal(avatar(f).dataset.state,'listening');
 f.engines[0].result('When was my last firing?');assert.equal(avatar(f).dataset.state,'thinking');
 f.reply();await tick();f.el('clayton-stop').click();assert.equal(avatar(f).dataset.state,'idle');
 assert.equal(f.el('qlAssistantSession').dataset.state,'stopped');
});
test('unsupported microphone and denied permission give visible errors',async t=>{
 const unsupported=await fixture(t,undefined,'none');unsupported.el('clayton-start').click();
 assert.equal(avatar(unsupported).dataset.state,'error');assert.match(unsupported.el('clayton-feedback').textContent,/unavailable/);
 const f=await fixture(t);f.el('clayton-start').click();f.engines[0].onerror({error:'not-allowed'});
 assert.equal(avatar(f).dataset.state,'error');assert.match(f.el('clayton-feedback').textContent,/Permission denied/);
});
test('Hear Clayton follows speech callbacks, Stop cancels, and never opens a microphone',async t=>{
 const f=await fixture(t);let spoken,cancels=0;
 f.w.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
 f.w.speechSynthesis={speak:u=>spoken=u,cancel:()=>cancels++};
 f.el('clayton-hear').click();assert.ok(spoken);assert.equal(f.engines.length,0);
 spoken.onstart();assert.equal(avatar(f).dataset.state,'speaking');spoken.onend();assert.equal(avatar(f).dataset.state,'idle');
 f.el('clayton-hear').click();spoken.onstart();const stale=spoken.onend;f.el('clayton-stop').click();stale();
 assert.equal(avatar(f).dataset.state,'idle');assert.equal(cancels,1);
 f.el('clayton-hear').click();spoken.onerror();assert.equal(avatar(f).dataset.state,'error');
});
test('actual saved/deleted responses drive success; failed requests drive error',async t=>{
 const f=await fixture(t);f.send('save draft');assert.equal(avatar(f).dataset.state,'thinking');
 f.reply(0,'Saved',{result:{tool:'studio.note',status:'saved'}});await tick();assert.equal(avatar(f).dataset.state,'success');
 f.send('delete note');f.reply(1,'Deleted',{result:{tool:'studio.note.manage',status:'deleted'}});await tick();assert.equal(avatar(f).dataset.state,'success');
 f.send('open pieces');f.pending[2].reject(Error('offline'));await tick();assert.equal(avatar(f).dataset.state,'error');
});
test('failed persistence is visible and cannot overwrite a later selection with old GET',async t=>{
 const f=await fixture(t);const prior=f.w.fetch;f.w.fetch=async(url,options)=>options?.method==='PUT'?{ok:false,status:503}:prior(url,options);
 f.w.document.querySelector('[data-avatar=moon]').click();await tick();
 assert.equal(avatar(f).querySelector('img').alt,'Moon & Stars');assert.match(f.w.document.querySelector('.clayton-save').textContent,/Could not save/);
});
