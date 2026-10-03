'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root,file),'utf8');
const tick = () => new Promise(r => setTimeout(r,20));
async function fixture(t, config = {enabled:true}) {
  const dom = new JSDOM(source('public/index.html'), {url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true});
  const w = dom.window, calls = [], pending = [];
  const style = w.document.createElement('style'); style.textContent = source('public/style.css'); w.document.head.append(style);
  t.after(() => w.close());
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
  const reply = (i=0,text='Your latest recorded firing date is 2026-10-01.',extra={}) => pending[i].resolve({ok:true,status:200,json:async()=>({version:1,requestId:pending[i].body.requestId,accountId:'a',intent:{name:'studio.firing.latest',arguments:{}},response:{text},...extra})});
  return {w,el,send,reply,pending,calls};
}
test('flag OFF has no entry, page, or turn request even with direct navigation',async t=>{
 const f=await fixture(t,{enabled:false});f.w.navigate('qlAssistant');assert.equal(f.el('qlAssistantEntry'),null);assert.equal(f.el('pageQLAssistant'),null);assert.equal(f.pending.length,0);
});
test('missing/failed config fails closed',async t=>{const f=await fixture(t,new Error('offline'));assert.equal(f.el('qlAssistantEntry'),null);});
test('non-boolean enabled fails closed',async t=>{const f=await fixture(t,{enabled:'true'});assert.equal(f.el('qlAssistantEntry'),null);});
test('flag ON shows clearly marked separate entry and compact form',async t=>{const f=await fixture(t);assert.equal(f.el('qlAssistantEntry').hidden,false);assert.match(f.el('qlAssistantEntry').textContent,/QL.*testing/);assert.equal(f.el('qlAssistantInput').maxLength,200);});
test('supported question sends version 1 contract with bounded context reference and renders only factual response',async t=>{
 const f=await fixture(t);f.send();assert.deepEqual(f.pending[0].body,{version:1,requestId:'web-1',input:{text:'When was my last firing?'},context:{token:null}});
 f.reply(0,undefined,{result:{secret:'hidden evidence'}});await tick();assert.equal(f.el('qlAssistantResponse').textContent,'Your latest recorded firing date is 2026-10-01.');assert.doesNotMatch(f.el('pageQLAssistant').textContent,/hidden evidence/);
});
for(const [name,text] of [['no-firing','No recorded firing was found.'],['undated','Your firing records have no valid saved firing date, so I cannot determine the latest.'],['tied records','Your latest recorded firing date is 2026-10-01. 2 firing records share that date.']]) test(name+' preserves core wording',async t=>{const f=await fixture(t);f.send();f.reply(0,text);await tick();assert.equal(f.el('qlAssistantResponse').textContent,text);});
test('unsupported question stays bounded',async t=>{const f=await fixture(t);f.send('What glaze did I use?');f.pending[0].resolve({ok:false,status:400,json:async()=>({code:'UNSUPPORTED_INTENT'})});await tick();assert.match(f.el('qlAssistantResponse').textContent,/isn’t supported/);assert.equal(f.pending.length,1);});
test('loading state ends after response',async t=>{const f=await fixture(t);f.send();assert.equal(f.el('qlAssistantForm').getAttribute('aria-busy'),'true');assert.match(f.el('qlAssistantResponse').textContent,/Looking up/);f.reply();await tick();assert.equal(f.el('qlAssistantForm').getAttribute('aria-busy'),'false');});
test('error and retry use a fresh request identity',async t=>{const f=await fixture(t);f.send();f.pending[0].reject(Error('offline'));await tick();assert.equal(f.el('qlAssistantRetry').hidden,false);f.el('qlAssistantRetry').click();assert.equal(f.pending.length,2);assert.notEqual(f.pending[0].body.requestId,f.pending[1].body.requestId);f.reply(1);await tick();assert.match(f.el('qlAssistantResponse').textContent,/2026-10-01/);});
test('native form submission supports keyboard Enter without click dependency',async t=>{const f=await fixture(t);f.el('qlAssistantInput').value='last firing';f.el('qlAssistantForm').requestSubmit();assert.equal(f.pending.length,1);assert.equal(f.el('qlAssistantForm').querySelector('[type="submit"]').textContent,'Send');});
test('duplicate sends while pending are ignored',async t=>{const f=await fixture(t);f.send();f.send();f.el('qlAssistantForm').requestSubmit();assert.equal(f.pending.length,1);});
test('second question supersedes first even if transport ignores abort',async t=>{const f=await fixture(t);f.send();f.send('last firing');assert.equal(f.pending.length,2);assert.equal(f.pending[0].options.signal.aborted,true);f.reply(1,'new');await tick();f.reply(0,'stale');await tick();assert.equal(f.el('qlAssistantResponse').textContent,'new');});
test('navigation cancels and clears content',async t=>{const f=await fixture(t);f.send();f.w.navigate('firings');assert.equal(f.pending[0].options.signal.aborted,true);f.reply(0,'stale');await tick();assert.equal(f.el('qlAssistantInput').value,'');assert.equal(f.el('qlAssistantResponse').textContent,'');});
test('logout clears pending request and rendered answer immediately',async t=>{const f=await fixture(t);f.send();f.reply();await tick();f.send('last firing');f.w.logout();assert.equal(f.el('qlAssistantInput').value,'');assert.equal(f.el('qlAssistantResponse').textContent,'');assert.equal(f.el('qlAssistantForm').getAttribute('aria-busy'),'false');assert.equal(f.pending[1].options.signal.aborted,true);});
test('account replacement clears synchronously and stale A cannot render under B',async t=>{const f=await fixture(t);f.send();f.w.eval("setAuthUser({id:'b'}); setAuthToken('token-b'); localStorage.setItem('mudlog_token','token-b');");assert.equal(f.el('qlAssistantInput').value,'');assert.equal(f.el('qlAssistantResponse').textContent,'');f.w.navigate('qlAssistant');f.send();f.reply(1,'B answer',{accountId:'b'});await tick();f.reply(0,'A secret');await tick();assert.equal(f.el('qlAssistantResponse').textContent,'B answer');});
test('same-account token replacement clears immediately',async t=>{const f=await fixture(t);f.send();f.w.eval("setAuthToken('new-token'); localStorage.setItem('mudlog_token','new-token');");assert.equal(f.el('qlAssistantInput').value,'');assert.equal(f.pending[0].options.signal.aborted,true);f.reply(0,'stale');await tick();assert.equal(f.el('qlAssistantResponse').textContent,'');});
test('cross-tab token replacement clears and hides entry',async t=>{const f=await fixture(t);f.send();f.w.localStorage.setItem('mudlog_token','other');f.w.dispatchEvent(new f.w.StorageEvent('storage',{key:'mudlog_token'}));assert.equal(f.el('qlAssistantInput').value,'');assert.equal(f.el('qlAssistantEntry').hidden,true);assert.equal(f.pending[0].options.signal.aborted,true);});
test('401 clears content and blocks same invalid session',async t=>{const f=await fixture(t);f.send();f.pending[0].resolve({status:401});await tick();assert.equal(f.el('qlAssistantResponse').textContent,'');assert.equal(f.el('qlAssistantInput').value,'');assert.equal(f.el('qlAssistantEntry').hidden,true);f.send();assert.equal(f.pending.length,1);});
test('other website API 401 also invalidates assistant',async t=>{const f=await fixture(t);f.send();f.w.fetch=async()=>({status:401,ok:false,json:async()=>({error:'Invalid token'})});await f.w.api('/api/test').catch(()=>{});assert.equal(f.el('qlAssistantInput').value,'');assert.equal(f.pending[0].options.signal.aborted,true);});
for(const extra of [{accountId:'b'},{requestId:'other'},{version:2},{response:{}}]) test('mismatched response rejected '+JSON.stringify(extra),async t=>{const f=await fixture(t);f.send();f.reply(0,'private',extra);await tick();assert.doesNotMatch(f.el('qlAssistantResponse').textContent,/private/);assert.equal(f.el('qlAssistantRetry').hidden,false);});
test('safe text rendering prevents markup interpretation',async t=>{const f=await fixture(t);f.send();f.reply(0,'<img src=x onerror=alert(1)>');await tick();assert.equal(f.el('qlAssistantResponse').children.length,0);});
test('pagehide cancels requests and clears ephemeral state',async t=>{const f=await fixture(t);f.send();f.w.dispatchEvent(new f.w.Event('pagehide'));f.reply(0,'stale');await tick();assert.equal(f.el('qlAssistantInput').value,'');assert.equal(f.el('qlAssistantResponse').textContent,'');});
test('no external model calls or legacy history writes; manual fallback remains',async t=>{const f=await fixture(t);const storage=JSON.stringify(f.w.localStorage);const start=f.calls.length;f.send();f.reply();await tick();assert.deepEqual(f.calls.slice(start).map(c=>c.url),['/api/ql/assistant/turn']);assert.equal(JSON.stringify(f.w.localStorage),storage);assert.equal(f.w.sessionStorage.length,0);[...f.el('pageQLAssistant').querySelectorAll('button')].find(b=>b.textContent==='Open Firings').click();assert.equal(f.w.eval('currentPage'),'firings');await tick();});
test('legacy Ask a Potter source remains byte-identical to 4B',()=>{
 const app=source('public/app.js'); const start=app.indexOf('function loadAiChatHistory');
 assert.ok(start>=0);
 // Pinned hashes are computed from the frozen 4B legacy function region below.
 const section=app.slice(start,app.indexOf('\n// ',start));
 assert.equal(crypto.createHash('sha256').update(section).digest('hex'),'b24fe6085e9d1f71bcd2f6ac262292aff7179eee335554dbca6a2df07d4b3f76');
});

test('scoped CSS preserves hidden retry and signed-out entry',async t=>{const f=await fixture(t);assert.equal(f.w.getComputedStyle(f.el('qlAssistantRetry')).display,'none');f.w.eval('setAuthToken(null)');f.w.QLAssistant.syncSession();assert.equal(f.w.getComputedStyle(f.el('qlAssistantEntry')).display,'none');});
test('hash navigation outside normal page router cancels',async t=>{const f=await fixture(t);f.send();f.w.history.pushState({},'', '#reset-password');f.w.dispatchEvent(new f.w.HashChangeEvent('hashchange'));assert.equal(f.pending[0].options.signal.aborted,true);f.reply(0,'stale');await tick();assert.equal(f.el('qlAssistantResponse').textContent,'');});
test('A to B to A cannot revive old request generation',async t=>{const f=await fixture(t);f.send();f.w.eval("setAuthUser({id:'b'});setAuthUser({id:'a'});");f.reply(0,'old A');await tick();assert.equal(f.el('qlAssistantResponse').textContent,'');});
test('session changes while JSON parses cannot render late answer',async t=>{const f=await fixture(t);f.send();let finish;f.pending[0].resolve({ok:true,status:200,json:()=>new Promise(r=>finish=r)});await tick();f.w.eval("setAuthUser({id:'b'});");finish({version:1,requestId:f.pending[0].body.requestId,accountId:'a',response:{text:'private'}});await tick();assert.equal(f.el('qlAssistantResponse').textContent,'');});
test('late 401 from A cannot invalidate B',async t=>{const f=await fixture(t);f.send();f.w.eval("setAuthUser({id:'b'});setAuthToken('token-b');localStorage.setItem('mudlog_token','token-b');");f.w.navigate('qlAssistant');f.pending[0].resolve({status:401});await tick();assert.equal(f.w.QLAssistant.available(),true);});

// Phase 4G: exercise real page router, not just response strings.
for (const page of [...new Set(Object.values(require('../ql/assistant/intents.cjs').DESTINATIONS).map(d=>d.page))]) {
 test('assistant actually navigates to '+page,async t=>{
  const f=await fixture(t);f.send('Open a feature');f.reply(0,'Opening.',{response:{text:'Opening.',navigation:{kind:'page',page}}});await tick();
  assert.equal(f.w.eval('currentPage'),page);assert.equal(f.el('pageQLAssistant').classList.contains('active'),false);
  assert.ok(f.w.document.querySelector('.page.active'));assert.equal(f.el('qlAssistantInput').value,'');
 });
}
for (const target of [{kind:'page',page:'admin'},{kind:'page',page:'https://evil.invalid'},{kind:'page',page:'pieces',url:'evil'},
 {kind:'record',type:'contact',id:'b'},{kind:'search',type:'users',query:'private'}]) {
 test('untrusted navigation rejected '+JSON.stringify(target),async t=>{
  const f=await fixture(t);f.send();f.reply(0,'Opening',{response:{text:'Opening',navigation:target}});await tick();
  assert.equal(f.w.eval('currentPage'),'qlAssistant');assert.equal(f.el('qlAssistantRetry').hidden,false);
 });
}
test('late navigation cannot redirect after account change',async t=>{
 const f=await fixture(t);f.send('Open glazes');f.w.eval("setAuthUser({id:'b'});");
 f.reply(0,'Opening',{response:{text:'Opening',navigation:{kind:'page',page:'glazes'}}});await tick();assert.equal(f.w.eval('currentPage'),'qlAssistant');
});
test('latest record hands off to existing authenticated record viewer',async t=>{
 const f=await fixture(t);let opened;f.w.StudioSearch={open:(...args)=>{opened=args;}};
 f.send('Open my last firing');f.reply(0,'Opening',{response:{text:'Opening',navigation:{kind:'record',type:'firing',id:'a-firing'}}});await tick();
 assert.deepEqual(opened,['firing','a-firing']);
});
test('filtered search hands off query and type to Studio Search',async t=>{
 const f=await fixture(t);let query;f.w.StudioSearch={runQuery:(...args)=>{query=args;}};
 f.send('Find blue glazes');f.reply(0,'Found',{response:{text:'Found',navigation:{kind:'search',type:'glaze',query:'blue'}}});await tick();
 assert.deepEqual(query,['blue','glaze']);
});
test('write commands explain that no changes were made',async t=>{
 const f=await fixture(t);f.send('Delete my pieces');f.pending[0].resolve({ok:false,status:400,json:async()=>({code:'ACTION_NOT_AVAILABLE'})});await tick();
 assert.match(f.el('qlAssistantResponse').textContent,/No changes were made/);assert.equal(f.w.eval('currentPage'),'qlAssistant');
});

test('firing shortcut clears for unsupported, failed, and unavailable unrelated requests',async t=>{
 const f=await fixture(t);const shortcut=f.el('qlAssistantFiringFallback');
 assert.equal(shortcut.hidden,true);
 f.send();f.reply();await tick();assert.equal(shortcut.hidden,false);
 f.send('Show me unicorns');assert.equal(shortcut.hidden,true);
 f.pending[1].resolve({ok:false,status:400,json:async()=>({code:'UNSUPPORTED_INTENT'})});await tick();
 assert.equal(shortcut.hidden,true);assert.doesNotMatch(f.el('qlAssistantResponse').textContent,/Firings/);
 f.send('Open photo lookup');f.pending[2].reject(Error('offline'));await tick();
 assert.equal(shortcut.hidden,true);assert.doesNotMatch(f.el('qlAssistantResponse').textContent,/Firings/);
 f.send('Show me Kiln Share');f.pending[3].resolve({ok:false,status:400,json:async()=>({code:'DESTINATION_UNAVAILABLE'})});await tick();
 assert.match(f.el('qlAssistantResponse').textContent,/Kiln Share is not available in this website build/);
 assert.equal(shortcut.hidden,true);assert.equal(f.w.eval('currentPage'),'qlAssistant');
});
test('firing shortcut clears on logout and navigation',async t=>{
 const f=await fixture(t);f.send();f.reply();await tick();assert.equal(f.el('qlAssistantFiringFallback').hidden,false);
 f.w.navigate('pieces');assert.equal(f.el('qlAssistantFiringFallback').hidden,true);
 f.w.navigate('qlAssistant');f.send();f.reply(1);await tick();f.w.logout();assert.equal(f.el('qlAssistantFiringFallback').hidden,true);
});

test('typed follow-ups use the same ephemeral context and clear on manual departure',async t=>{
 const f=await fixture(t);f.send('Open pieces');f.reply(0,'Opening pieces',{context:{token:'a'.repeat(48)},response:{text:'Opening pieces',navigation:{kind:'page',page:'pieces'}}});await tick();
 f.w.navigate('qlAssistant');f.send('Show me the blue one');assert.equal(f.pending[1].body.context.token,'a'.repeat(48));
 f.reply(1,'Choose a piece',{context:{token:'b'.repeat(48)}});await tick();f.send('The first one');assert.equal(f.pending[2].body.context.token,'b'.repeat(48));
 f.reply(2,'Selected',{context:{token:'c'.repeat(48)}});await tick();f.w.navigate('glazes');f.w.navigate('qlAssistant');f.send('When did I fire it?');assert.equal(f.pending[3].body.context.token,null);
});
