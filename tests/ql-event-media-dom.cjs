const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8');
test('website Event cards use contract-aware image markup',()=>assert.ok(app.includes("eventImageMarkup(e, 'photo-thumb'")));
test('website Event list hydrates protected images after rendering',()=>assert.ok(app.includes('hydrateEventMedia(c, events)')));
test('website Event markup supports protected detail-size presentation',()=>{ const f=fixture(); assert.match(f.run("eventImageMarkup({id:'a',image_filename:'a.jpg',photoDelivery:'owner-protected'}, 'detail-photo')"), /data-event-media=.*class="detail-photo"/); });
test('private Event images use authenticated blob loading',()=>{
  assert.match(app,/\/api\/ql\/events\/.*\/photos\//);
  assert.match(app,/Authorization: 'Bearer ' \+ requestToken/);
  assert.match(app,/URL\.createObjectURL/);
});
test('website Event media has abort stale and cleanup guards',()=>{
  assert.match(app,/controller\.abort\(\)/);
  assert.match(app,/eventMediaGeneration/);
  assert.match(app,/URL\.revokeObjectURL/);
});
test('website clears Event media on logout session replacement and navigation',()=>{
  const matches=app.match(/clearEventMedia\(\)/g)||[];
  assert.ok(matches.length>=5);
});
test('legacy Event image loading remains static-compatible',()=>assert.match(app,/eventMediaVisibility\(event\) !== 'private'.*\/uploads\//s));
test('private failures do not silently fall back to static uploads',()=>{
  const p=app.indexOf('async function hydrateEventMedia');
  const q=app.indexOf('// ============ EVENTS',p);
  assert.doesNotMatch(app.slice(p,q),/\/uploads\//);
});
test('failed Event image stays local to its element',()=>assert.match(app,/onerror="this\.style\.display='none'"/));

// Execute the actual Event functions against a disposable DOM, including delayed responses.
const vm = require('node:vm'), { JSDOM } = require('jsdom');
function fixture(fetchImpl = async()=>({ok:true,blob:async()=>({})})) {
 const dom=new JSDOM('<div id="eventsList"></div><div id="eventsEmpty"></div>'), revoked=[], requests=[];let n=0;
 const ctx=vm.createContext({document:dom.window.document,URL:{createObjectURL:()=>`blob:${++n}`,revokeObjectURL:u=>revoked.push(u)},AbortController,fetch:async(...a)=>{requests.push(a);return fetchImpl(...a)},API:'',token:'A',esc:String});
 vm.runInContext(app.slice(app.indexOf('const eventMedia ='),app.indexOf('// ============ EVENTS')),ctx);
 return {dom,ctx,revoked,requests,run:s=>vm.runInContext(s,ctx)};
}
const event={id:'a',user_id:'A',image_filename:'a.jpg',photoDelivery:'owner-protected',title:'Event A',event_date:'2026-10-01'};
function render(f, events=[event]) {f.ctx.events=events;f.run("document.getElementById('eventsList').innerHTML=events.map(e=>eventImageMarkup(e)).join('')");}
const hydrate=f=>f.run("hydrateEventMedia(document.getElementById('eventsList'),events)");
test('Event website owner image loads authenticated no-store bytes',async()=>{const f=fixture();render(f);await hydrate(f);assert.equal(f.requests[0][0],'/api/ql/events/a/photos/a.jpg');assert.equal(f.requests[0][1].headers.Authorization,'Bearer A');assert.equal(f.requests[0][1].cache,'no-store');assert.equal(f.dom.window.document.querySelector('img').src,'blob:1');});
test('Event logout clears displayed images and revokes blobs',async()=>{const f=fixture();render(f);await hydrate(f);f.run('clearEventMedia()');assert.deepEqual(f.revoked,['blob:1']);assert.equal(f.dom.window.document.getElementById('eventsList').innerHTML,'');});
test('late Event blob cannot populate B or start subsequent A image under B token',async()=>{let resolve;const f=fixture(()=>new Promise(r=>resolve=r));render(f,[event,{...event,id:'second'}]);const pending=hydrate(f);f.run("clearEventMedia();token='B'");render(f);resolve({ok:true,blob:async()=>({})});await pending;assert.equal(f.requests.length,1);assert.deepEqual(f.revoked,['blob:1']);assert.equal(f.dom.window.document.querySelector('img').getAttribute('src'),null);});
test('current Event photo 401 clears previously rendered private blobs',async()=>{let count=0;const f=fixture(async()=>++count===1?{ok:true,blob:async()=>({})}:{ok:false,status:401});render(f,[event,{...event,id:'second'}]);await hydrate(f);assert.deepEqual(f.revoked,['blob:1']);assert.equal(f.dom.window.document.querySelector('img'),null);});
test('stale Event photo 401 cannot clear replacement account',async()=>{let resolve;const f=fixture(()=>new Promise(r=>resolve=r));render(f);const pending=hydrate(f);f.run("clearEventMedia();token='B';document.getElementById('eventsList').textContent='B'");resolve({ok:false,status:401});await pending;assert.equal(f.dom.window.document.getElementById('eventsList').textContent,'B');});
test('Event protected failure keeps controls and makes no static fallback request',async()=>{const f=fixture(async()=>({ok:false,status:404}));render(f);f.run("document.getElementById('eventsList').insertAdjacentHTML('beforeend','<button>Edit</button>')");await hydrate(f);assert.equal(f.requests.length,1);assert.equal(f.dom.window.document.querySelector('img').getAttribute('src'),null);assert.equal(f.dom.window.document.querySelector('button').textContent,'Edit');});
test('legacy Event still renders historical static URL',()=>{const f=fixture();render(f,[{...event,photoDelivery:null}]);assert.equal(f.dom.window.document.querySelector('img').getAttribute('src'),'/uploads/a.jpg');});
test('late Event list metadata cannot populate replacement account',async()=>{let resolve;const f=fixture();f.ctx.api=()=>new Promise(r=>resolve=r);f.ctx.toast=()=>{};vm.runInContext(app.slice(app.indexOf('async function loadEvents()'),app.indexOf('function shareEvent(')),f.ctx);const pending=f.run('loadEvents()');f.run("clearEventMedia();token='B'");resolve([event]);await pending;assert.equal(f.dom.window.document.getElementById('eventsList').innerHTML,'');assert.equal(f.requests.length,0);});
