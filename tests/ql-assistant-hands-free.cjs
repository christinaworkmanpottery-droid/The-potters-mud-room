'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root,file),'utf8');
const tick = () => new Promise(r => setTimeout(r,20));
async function fixture(t, config = {enabled:true,voiceEnabled:true,handsFreeEnabled:true}, support = 'standard') {
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

const start = f => f.el('qlAssistantSessionStart').click();
const state = f => f.el('qlAssistantSession').dataset.state;
const restart = f => f.timers.get(650)();
test('no automatic activation and explicit flag only',async t=>{
 for(const cfg of [{enabled:true,voiceEnabled:true},{enabled:true,voiceEnabled:false,handsFreeEnabled:true},{enabled:true,voiceEnabled:true,handsFreeEnabled:'true'}]) {
  const f=await fixture(t,cfg);assert.equal(f.el('qlAssistantSession'),null);assert.equal(f.engines.length,0);
 }
 const f=await fixture(t);assert.equal(f.engines.length,0);assert.equal(state(f),'stopped');
});
test('five navigation commands need only one activation',async t=>{
 const f=await fixture(t);start(f);start(f);
 for(const [i,page] of ['pieces','glazes','clayBodies','testTiles','firings'].entries()) {
  assert.equal(f.engines.length,i+1);const e=f.engines[i];e.onstart();e.onaudiostart();assert.equal(state(f),'listening');
  e.result('Open '+page);assert.equal(state(f),'processing');
  f.reply(i,'Opening '+page,{response:{text:'Opening '+page,navigation:{kind:'page',page}}});await tick();
  assert.equal(f.w.eval('currentPage'),page);assert.equal(f.engines.length,i+1);restart(f);
 }
 assert.equal(f.pending.length,5);assert.equal(f.engines.length,6);
});
test('all 4G page destinations retain active session',async t=>{
 const f=await fixture(t);start(f);
 const pages=['casualties','community','shop','aiChat','visualSearch','shoppingList','studioNotes','profile','messages'];
 for(const [i,page] of pages.entries()) {f.engines[i].result('Open '+page);f.reply(i,'Open',{response:{text:'Opening',navigation:{kind:'page',page}}});await tick();assert.equal(f.w.eval('currentPage'),page);restart(f);}
});
test('firing record and search reuse existing StudioSearch entry points',async t=>{
 const f=await fixture(t);let record,query;
 f.w.StudioSearch={onNavigate(){},open(type,id){record={type,id};f.w.navigate('searchRecord');return Promise.resolve().then(()=>f.w.navigate('studioSearch'));},runQuery(q,type){query={q,type};f.w.navigate('studioSearch');}};
 start(f);f.engines[0].result('Open my last firing');f.reply(0,'Opening',{response:{text:'Opening',navigation:{kind:'record',type:'firing',id:'existing'}}});await tick();assert.deepEqual(record,{type:'firing',id:'existing'});restart(f);
 f.engines[1].result('Find blue glazes');f.reply(1,'Searching',{response:{text:'Searching',navigation:{kind:'search',type:'glaze',query:'blue'}}});await tick();assert.deepEqual(query,{q:'blue',type:'glaze'});restart(f);assert.equal(f.engines.length,3);
});
for(const code of ['UNSUPPORTED_INTENT','DESTINATION_UNAVAILABLE','ACTION_NOT_AVAILABLE']) test('safe non-navigation '+code,async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('not supported');f.pending[0].resolve({ok:false,status:400,json:async()=>({code})});await tick();
 assert.equal(f.w.eval('currentPage'),'qlAssistant');assert.equal(f.el('qlAssistantFiringFallback').hidden,true);restart(f);assert.equal(f.engines.length,2);
});
test('no-speech retries only after disconnect, bounded at three attempts',async t=>{
 const f=await fixture(t);start(f);
 for(let i=0;i<3;i++){const e=f.engines[i];e.onerror({error:'no-speech'});assert.equal(f.engines.length,i+1);e.onend();if(i<2)restart(f);}
 assert.equal(state(f),'stopped');assert.equal(f.pending.length,0);assert.equal(f.engines.length,3);
});
test('interim-only words never execute and retry after disconnect',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('open glazes',false);f.engines[0].onend();assert.equal(f.pending.length,0);restart(f);f.engines[1].result('Open glazes');assert.equal(f.pending.length,1);
});
for(const error of ['not-allowed','service-not-allowed','audio-capture','network','aborted']) test('terminal error stops session '+error,async t=>{
 const f=await fixture(t);start(f);f.engines[0].onerror({error});assert.equal(state(f),error.includes('allowed')?'permission-denied':'unavailable');assert.equal(f.engines.length,1);assert.equal(f.el('qlAssistantSessionStop').hidden,true);
});
test('engine watchdog cannot overlap a stuck recognizer',async t=>{
 const f=await fixture(t);start(f);f.timers.get(30000)();f.timers.get(5000)();assert.equal(state(f),'unavailable');assert.equal(f.engines[0].aborts,1);assert.equal(f.engines.length,1);
});
test('no-speech missing onend stops without restarting',async t=>{
 const f=await fixture(t);start(f);f.engines[0].onerror({error:'no-speech'});f.timers.get(5000)();assert.equal(state(f),'unavailable');assert.equal(f.engines.length,1);
});
for(const action of ['button','voice','hidden','logout','storage','pagehide','typed','timeout']) test('session cancellation and queued callbacks '+action,async t=>{
 const f=await fixture(t);start(f);const e=f.engines[0],late=e.onresult;
 if(action==='button')f.el('qlAssistantSessionStop').click();
 if(action==='voice')e.result('Stop listening');
 if(action==='hidden'){Object.defineProperty(f.w.document,'hidden',{value:true});f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));}
 if(action==='logout')f.w.logout();
 if(action==='storage'){f.w.localStorage.setItem('mudlog_token','other');f.w.dispatchEvent(new f.w.StorageEvent('storage',{key:'mudlog_token'}));}
 if(action==='pagehide')f.w.dispatchEvent(new f.w.Event('pagehide'));
 if(action==='typed'){f.el('qlAssistantInput').value='manual';f.el('qlAssistantInput').dispatchEvent(new f.w.Event('input'));}
 if(action==='timeout')f.timers.get(900000)();
 late({results:[{isFinal:true,0:{transcript:'Open glazes'}}]});assert.equal(f.pending.length,0);assert.equal(f.engines.length,1);assert.equal(state(f),'stopped');
});
test('End session suppresses late HTTP navigation',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Open glazes');f.el('qlAssistantSessionStop').click();assert.equal(f.pending[0].options.signal.aborted,true);
 f.reply(0,'Opening',{response:{text:'Opening',navigation:{kind:'page',page:'glazes'}}});await tick();assert.equal(f.w.eval('currentPage'),'qlAssistant');assert.equal(state(f),'stopped');
});
test('manual navigation during pending voice cancels stale action',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Open glazes');f.w.navigate('pieces');f.reply(0,'Opening',{response:{text:'Opening',navigation:{kind:'page',page:'glazes'}}});await tick();assert.equal(f.w.eval('currentPage'),'pieces');assert.equal(state(f),'stopped');
});
test('speech output waits for recognizer release and completion before listening',async t=>{
 const f=await fixture(t);let spoken,canceled=0;f.w.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};f.w.speechSynthesis={speak(s){spoken=s;},cancel(){canceled++;}};
 f.el('qlAssistantSpokenReplies').checked=true;start(f);f.engines[0].result('last firing');f.reply();await tick();assert.ok(spoken);assert.equal(f.engines.length,1);spoken.onstart();assert.equal(state(f),'speaking');spoken.onend();restart(f);assert.equal(f.engines.length,2);
 f.engines[1].result('last firing');f.reply(1);await tick();const late=spoken.onend;f.el('qlAssistantSessionStop').click();late();assert.equal(canceled,1);assert.equal(f.engines.length,2);
});
for(const mode of ['missing','error','watchdog']) test('audio fallback '+mode,async t=>{
 const f=await fixture(t);let spoken;if(mode!=='missing'){f.w.SpeechSynthesisUtterance=class {};f.w.speechSynthesis={speak(s){spoken=s;},cancel(){}};}
 f.el('qlAssistantSpokenReplies').checked=true;start(f);f.engines[0].result('last firing');f.reply();await tick();if(mode==='error')spoken.onerror();if(mode==='watchdog')f.timers.get(30000)();assert.equal(state(f),'unavailable');assert.equal(f.engines.length,1);
});
test('duplicate final callback sends exactly once',async t=>{
 const f=await fixture(t);start(f);const e=f.engines[0],cb=e.onresult,event={results:[{isFinal:true,0:{transcript:'last firing'}}]};cb(event);cb(event);e.onend();cb(event);assert.equal(f.pending.length,1);
});
test('invalid response cannot navigate',async t=>{const f=await fixture(t);start(f);f.engines[0].result('Open glazes');f.reply(0,'bad',{accountId:'b',response:{text:'bad',navigation:{kind:'page',page:'glazes'}}});await tick();assert.equal(f.w.eval('currentPage'),'qlAssistant');assert.equal(f.el('qlAssistantFiringFallback').hidden,true);});

test('stalled assistant request stops and suppresses late navigation',async t=>{const f=await fixture(t);start(f);f.engines[0].result('Open glazes');f.timers.get(30000)();assert.equal(state(f),'unavailable');assert.equal(f.pending[0].options.signal.aborted,true);f.reply(0,'Opening',{response:{text:'Opening',navigation:{kind:'page',page:'glazes'}}});await tick();assert.equal(f.w.eval('currentPage'),'qlAssistant');});
test('queued automatic restart is inert after End session',async t=>{const f=await fixture(t);start(f);f.engines[0].onend();const queued=f.timers.get(650);f.el('qlAssistantSessionStop').click();queued();assert.equal(f.engines.length,1);assert.equal(state(f),'stopped');});
test('prefixed Safari recognition supports consecutive turns',async t=>{const f=await fixture(t,undefined,'prefixed');start(f);f.engines[0].result('last firing');f.reply();await tick();restart(f);assert.equal(f.engines.length,2);});

test('typing cancels pending voice navigation and preserves manual words',async t=>{const f=await fixture(t);start(f);f.engines[0].result('Open glazes');f.el('qlAssistantInput').value='manual edit';f.el('qlAssistantInput').dispatchEvent(new f.w.Event('input'));f.reply(0,'Opening',{response:{text:'Opening',navigation:{kind:'page',page:'glazes'}}});await tick();assert.equal(f.w.eval('currentPage'),'qlAssistant');assert.equal(f.el('qlAssistantInput').value,'manual edit');assert.equal(f.pending[0].options.signal.aborted,true);});
test('tap-to-talk cannot overlap active session and Cancel ends it',async t=>{const f=await fixture(t);start(f);assert.equal(f.el('qlAssistantTalk').disabled,true);f.el('qlAssistantCancelVoice').click();assert.equal(state(f),'stopped');assert.equal(f.engines[0].aborts,1);});

// Phase 4I: opaque context must survive only the intended conversation.
test('hands-free follow-ups carry context across owned asynchronous Piece navigation',async t=>{
 const f=await fixture(t);const key='a'.repeat(48);let opened;
 f.w.StudioSearch={onNavigate(){},async open(type,id){opened={type,id};f.w.history.pushState({},'','#studioSearch/'+type+'/'+id);f.w.navigate('searchRecord',{fromHistory:true,searchDetail:true});await tick();f.w.navigate('pieceDetail',{fromHistory:true,searchDetail:true});}};
 start(f);f.engines[0].result('Open my pieces');assert.deepEqual(f.pending[0].body.context,{token:null});
 f.reply(0,'Opening pieces',{context:{token:key},response:{text:'Opening pieces',navigation:{kind:'page',page:'pieces'}}});await tick();restart(f);
 f.engines[1].result('Show me the blue one');assert.equal(f.pending[1].body.context.token,key);
 f.reply(1,'Showing Blue bowl',{context:{token:'b'.repeat(48)},response:{text:'Showing Blue bowl',navigation:{kind:'record',type:'piece',id:'blue'}}});await tick();await tick();assert.deepEqual(opened,{type:'piece',id:'blue'});restart(f);
 f.engines[2].result('What glaze did I use on that?');assert.equal(f.pending[2].body.context.token,'b'.repeat(48));
 f.reply(2,'Saved glaze: Ocean',{context:{token:'c'.repeat(48)}});await tick();restart(f);
 f.engines[3].result('When did I fire it?');assert.equal(f.pending[3].body.context.token,'c'.repeat(48));
 f.reply(3,'Saved date: 2026-10-01',{context:{token:'d'.repeat(48)}});await tick();restart(f);assert.equal(f.engines.length,5);
});
for(const action of ['end','hidden','manual','foreign-record','unsupported'])test('context clears after '+action,async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Find blue pieces');
 f.reply(0,'Selected',{context:{token:'a'.repeat(48)}});await tick();
 if(action==='end'){f.el('qlAssistantSessionStop').click();start(f);}
 if(action==='hidden'){Object.defineProperty(f.w.document,'hidden',{value:true,configurable:true});f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));Object.defineProperty(f.w.document,'hidden',{value:false});start(f);}
 if(action==='manual'){f.w.navigate('glazes');restart(f);}
 if(action==='foreign-record'){f.w.history.pushState({},'','#studioSearch/piece/another');f.w.navigate('searchRecord',{fromHistory:true,searchDetail:true});restart(f);}
 if(action==='unsupported'){restart(f);f.engines.at(-1).result('Delete it');f.pending.at(-1).resolve({ok:false,status:400,json:async()=>({code:'ACTION_NOT_AVAILABLE'})});await tick();restart(f);}
 f.engines.at(-1).result('When did I fire it?');assert.equal(f.pending.at(-1).body.context.token,null);
});
test('invalid or late response cannot replace conversation context',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Open pieces');
 f.reply(0,'secret',{context:{token:'not-a-token'}});await tick();assert.doesNotMatch(f.el('qlAssistantResponse').textContent,/secret/);restart(f);
 f.engines[1].result('Open pieces');f.el('qlAssistantSessionStop').click();f.reply(1,'late',{context:{token:'a'.repeat(48)}});await tick();start(f);f.engines[2].result('When did I fire it?');assert.equal(f.pending[2].body.context.token,null);
});

test('device repair: choices and glaze answer remain visible when listening resumes',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Show me the blue one');
 const choices='2 Pieces match. 1. Blue bowl; 2. Blue vase. Say the first one.';
 f.reply(0,choices,{context:{token:'a'.repeat(48)}});await tick();restart(f);f.engines[1].onaudiostart();
 assert.equal(f.el('qlAssistantSessionReply').textContent,choices);
 assert.equal(f.el('qlAssistantSessionCommand').textContent,'Heard: Show me the blue one');
 assert.match(f.el('qlAssistantSessionStatus').textContent,/Microphone ready/);
 assert.notEqual(f.w.getComputedStyle(f.el('qlAssistantSessionReply')).display,'none');
 assert.ok(f.el('qlAssistantSessionReply').compareDocumentPosition(f.el('qlAssistantSessionStatus')) & f.w.Node.DOCUMENT_POSITION_FOLLOWING);
 f.engines[1].result('What glaze is on it?');assert.equal(f.el('qlAssistantSessionReply').textContent,'');
 f.reply(1,'Saved glaze: Ocean',{context:{token:'b'.repeat(48)}});await tick();restart(f);f.engines[2].onaudiostart();
 assert.equal(f.el('qlAssistantSessionReply').textContent,'Saved glaze: Ocean');
 assert.equal(f.el('qlAssistantSessionCommand').textContent,'Heard: What glaze is on it?');
 f.w.logout();assert.equal(f.el('qlAssistantSessionReply').textContent,'');assert.equal(f.el('qlAssistantSessionCommand').textContent,'');
});
test('visible voice response is safe text and cleared on hidden/pagehide',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Open pieces');
 f.reply(0,'<img src=x onerror=alert(1)>');await tick();restart(f);
 assert.equal(f.el('qlAssistantSessionReply').children.length,0);
 f.w.dispatchEvent(new f.w.Event('pagehide'));assert.equal(f.el('qlAssistantSessionReply').textContent,'');
});
test('note dictation waits for natural end and submits all final chunks exactly once',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Create new note');
 f.reply(0,'What should it say?',{result:{tool:'studio.note',status:'collecting'},context:{token:'a'.repeat(48)}});await tick();restart(f);
 const e=f.engines.at(-1);const result=(text,isFinal=true)=>({isFinal,0:{transcript:text}});
 e.onresult({results:[result("I've been")]});assert.equal(e.stops,0);assert.equal(f.pending.length,1);
 e.onresult({results:[result("I've been"),result('needing to buy',false)]});assert.equal(f.pending.length,1);
 e.onresult({results:[result("I've been"),result('needing to buy sapphire glaze.')]});assert.equal(e.stops,0);assert.equal(f.pending.length,1);
 e.onend();assert.equal(f.pending.length,2);assert.equal(f.pending[1].body.input.text,"I've been needing to buy sapphire glaze.");
 e.onend?.();assert.equal(f.pending.length,2);
});
test('note dictation never submits an earlier final chunk when trailing words remain interim',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Create new note');f.reply(0,'Text?',{result:{tool:'studio.note',status:'collecting'},context:{token:'a'.repeat(48)}});await tick();restart(f);
 const e=f.engines.at(-1);e.onresult({results:[{isFinal:true,0:{transcript:"I've been"}}]});
 e.onresult({results:[{isFinal:true,0:{transcript:"I've been"}},{isFinal:false,0:{transcript:'needing sapphire glaze'}}]});e.onend();assert.equal(f.pending.length,1);
 assert.match(f.el('qlAssistantSessionReply').textContent,/incomplete|misheard/i);
 assert.match(f.el('qlAssistantSessionCommand').textContent,/Needs review/);
});
test('interim words appear as hearing text without replacing the accumulated draft',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Create new note');
 f.reply(0,'Text?',{result:{tool:'studio.note',status:'collecting'},context:{token:'a'.repeat(48)}});await tick();restart(f);
 const e=f.engines.at(-1);e.onresult({results:[{isFinal:false,0:{transcript:'I need sapphire'}}]});
 assert.equal(f.el('qlAssistantNotePreview').hidden,false);assert.equal(f.el('qlAssistantNotePreviewText').textContent,'');assert.match(f.el('qlAssistantSessionCommand').textContent,/I need sapphire/);assert.equal(f.pending.length,1);
 e.onresult({results:[{isFinal:false,0:{transcript:'I need to buy sapphire glaze.'}}]});assert.equal(f.el('qlAssistantNotePreviewText').textContent,'');assert.match(f.el('qlAssistantSessionCommand').textContent,/I need to buy sapphire glaze/);
 f.el('qlAssistantSessionStop').click();assert.equal(f.el('qlAssistantNotePreview').hidden,true);assert.equal(f.el('qlAssistantNotePreviewText').textContent,'');assert.equal(f.pending.length,1);
});

// Phase 4K: browser event sequences, not a claim about real microphone accuracy.
test('one-turn note and commands retain all chunks and show live text', async t=>{
 const f=await fixture(t);start(f);const e=f.engines[0];
 const r=(text,isFinal,confidence=.9)=>({isFinal,0:{transcript:text,confidence}});
 e.onresult({results:[r('Create a note',true)]});assert.equal(e.stops,0);assert.equal(f.pending.length,0);
 e.onresult({results:[r('Create a note',true),r('I need sapphire',false)]});
 assert.equal(f.el('qlAssistantSessionCommand').textContent,'Hearing: Create a note I need sapphire');
 e.onresult({results:[r('Create a note',true),r('I need sapphire glaze',true)]});e.onend();
 assert.equal(f.pending[0].body.input.text,'Create a note I need sapphire glaze');
 assert.equal(f.el('qlAssistantSessionCommand').textContent,'Heard: Create a note I need sapphire glaze');
});
for(const mode of ['interim','confidence','watchdog'])test('uncertain speech requires explicit transcript review '+mode, async t=>{
 const f=await fixture(t);start(f);const e=f.engines[0];
 e.onresult({results:[{isFinal:mode!=='interim',0:{transcript:'Open blue vase',confidence:mode==='confidence'?.3:.9}}]});
 if(mode==='watchdog')f.timers.get(30000)();e.onend();
 assert.equal(f.pending.length,0);assert.match(f.el('qlAssistantSessionReply').textContent,/use those words/);
 restart(f);f.engines.at(-1).result('Yes');assert.equal(f.pending.length,0);
 restart(f);f.engines.at(-1).result('Use those words');assert.equal(f.pending.length,1);
 assert.equal(f.pending[0].body.input.text,'Open blue vase');f.reply();await tick();restart(f);assert.equal(state(f),'starting');
});
test('review correction and discard never execute the old transcript',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Delete blue vase',false);f.engines[0].onend();restart(f);
 f.engines.at(-1).result('Open blue bowl');assert.equal(f.pending[0].body.input.text,'Open blue bowl');f.reply();await tick();restart(f);
 f.engines.at(-1).result('Save note',false);f.engines.at(-1).onend();restart(f);f.engines.at(-1).result('Discard transcript');assert.equal(f.pending.length,1);
});
test('overflow never submits the previous final prefix',async t=>{
 const f=await fixture(t);start(f);const e=f.engines[0];
 e.onresult({results:[{isFinal:true,0:{transcript:'Create a note'}}]});
 e.onresult({results:[{isFinal:true,0:{transcript:'x'.repeat(201)}}]});e.onend?.();assert.equal(f.pending.length,0);
});
test('ending review clears transcript and queued confirmation',async t=>{
 const f=await fixture(t);start(f);f.engines[0].result('Open glazes',false);f.engines[0].onend();f.el('qlAssistantSessionStop').click();start(f);
 f.engines.at(-1).result('Use those words');assert.equal(f.pending[0].body.input.text,'Use those words');
});

test('4K.1 material clarification keeps preview and hands-free context across correction and save',async t=>{
 const f=await fixture(t);start(f);
 f.engines[0].result('Create another note I need to buy BMX clay save');
 f.reply(0,'Did you mean B-Mix clay?',{result:{tool:'studio.note',status:'material-review',draftText:'I need to buy BMX clay'},context:{token:'a'.repeat(48)}});await tick();restart(f);
 assert.equal(f.el('qlAssistantNotePreview').hidden,false);assert.equal(f.el('qlAssistantNotePreviewText').textContent,'I need to buy BMX clay');
 f.engines[1].result('Use B mix');assert.equal(f.pending[1].body.context.token,'a'.repeat(48));
 f.reply(1,'Check the corrected note.',{result:{tool:'studio.note',status:'draft',draftText:'I need to buy B-Mix clay'},context:{token:'b'.repeat(48)}});await tick();restart(f);
 assert.equal(f.el('qlAssistantNotePreviewText').textContent,'I need to buy B-Mix clay');
 f.engines[2].result('Save');assert.equal(f.pending[2].body.context.token,'b'.repeat(48));
 f.reply(2,'Saved your Studio Note.',{result:{tool:'studio.note',status:'saved'},context:{token:'c'.repeat(48)},response:{text:'Saved your Studio Note.',navigation:{kind:'page',page:'studioNotes'}}});await tick();restart(f);
 assert.equal(f.el('qlAssistantNotePreview').hidden,true);assert.equal(f.engines.length,4);assert.equal(f.w.eval('currentPage'),'studioNotes');
});

test('continuous recognition accumulates final segments before submitting once',async t=>{
 const f=await fixture(t);start(f);const e=f.engines[0];assert.equal(e.continuous,true);
 const result=text=>({isFinal:true,0:{transcript:text,confidence:.9}});
 e.onresult({results:[result('Make 40 soy sauce dishes in terra-cotta clay')]});
 assert.equal(f.pending.length,0);assert.equal(e.stops,0);
 e.onresult({results:[result('Make 40 soy sauce dishes in terra-cotta clay'),result('fire at cone 04')]});
 assert.equal(f.pending.length,0);f.timers.get(1500)();assert.equal(e.stops,1);
 e.onend();assert.equal(f.pending.length,1);
 assert.equal(f.pending[0].body.input.text,'Make 40 soy sauce dishes in terra-cotta clay fire at cone 04');
});
test('queued speech endpoint cannot restart or submit after cancellation',async t=>{
 const f=await fixture(t);start(f);const e=f.engines[0];
 e.onresult({results:[{isFinal:true,0:{transcript:'Make 40 soy sauce dishes'}}]});
 const endpoint=f.timers.get(1500);f.el('qlAssistantSessionStop').click();endpoint();
 assert.equal(e.stops,0);assert.equal(f.pending.length,0);assert.equal(f.engines.length,1);
});
