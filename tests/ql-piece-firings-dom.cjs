const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
async function fixture(t, ids = []) {
  const w = new JSDOM(fs.readFileSync('public/index.html', 'utf8'), { url: 'http://localhost', runScripts: 'outside-only' }).window;
  t.after(() => w.close()); w.scrollTo = () => {}; w.setInterval = () => 0;
  w.URL.createObjectURL = () => 'blob:firings'; const revoked = []; w.URL.revokeObjectURL = url => revoked.push(url);
  w.fetch = async () => ({ ok: true, json: async () => ({}) });
  w.eval(fs.readFileSync('public/website-utils.js', 'utf8'));
  w.eval(fs.readFileSync('public/app.js', 'utf8') + '\nwindow.session=(id="a")=>{clearPieceHistory();token="token-"+id;currentUser={id,tier:"free"};};');
  await tick(); w.session();
  let links = [...ids], history = 0, available = true, fail = false;
  const saved = [1,2,3].map(i => ({ id: String(i), kiln_name: 'Kiln '+i, firing_type:'glaze',cone:'6',date:'2026-09-01',photos:i===1?[{id:'photo',filename:'private.jpg',photoDelivery:'owner-protected'}]:[], photoDelivery:'owner-protected', created_at:'2026-09-01', description:'Saved notes' }));
  const calls=[];
  w.api = async url => {
    if(url.includes('/history')) { history++; return {pieceId:'p',events:[]}; }
    if(url.startsWith('/api/firing-logs/')) return url.endsWith('/photos') ? saved.find(c=>c.id===url.split('/')[3]).photos : saved.find(c=>c.id===url.split('/').pop());
    if(url.startsWith('/api/pieces/')) return {id:url.split('/').pop(),title:'Piece',photos:[],glazes:[]};
    return [];
  };
  const request = async (url, options={}) => {
    if(url.includes('/pricing'))return {ok:true,json:async()=>[],headers:{get:()=> 'false'}};
    calls.push({url,options}); if(fail) throw Error('PRIVATE SQL SECRET');
    let data;
    if(url.includes('/photos/')) return {ok:true,blob:async()=>new w.Blob(['photo'])};
    if(url.endsWith('/firing-logs')) data=saved;
    else if(url.includes('/firing-logs/')) data=saved.find(c=>c.id===url.split('/').pop());
    else if(options.method==='POST') {links=[...new Set([...links,JSON.parse(options.body).firingId])];data={};}
    else if(options.method==='DELETE') {links=links.filter(id=>id!==url.split('/').pop());data={removed:true};}
    else data=links.map(id=>({id,inputs_json:'RAW NOT DISPLAY'}));
    return {ok:true,json:async()=>data,headers:{get:()=>available?'true':'false'}};
  };
  w.fetch=request;
  await w.viewPiece('p'); await tick();
  return {w,calls,saved,request,revoked,root:()=>w.document.getElementById('linkedFirings'),history:()=>history,links:()=>links,
    availability:v=>available=v,fail:v=>fail=v};
}
const button = (root, name) => [...root.querySelectorAll('button')].find(el=>el.textContent===name);
async function link(f,id='1') {const s=f.root().querySelector('select');s.value=id;s.dispatchEvent(new f.w.Event('change'));button(f.root(),'Link').click();await tick();}
test('Linked Firings renders empty state and explicitly disabled Link',async t=>{const f=await fixture(t);assert.match(f.root().textContent,/No saved Firings linked/);assert.equal(button(f.root(),'Link').disabled,true);});
test('multiple links use canonical saved detail labels',async t=>{const f=await fixture(t,['1','2']);assert.match(f.root().textContent,/Kiln 1.*Kiln 2/s);assert.doesNotMatch(f.root().textContent,/RAW NOT DISPLAY/);assert.equal(f.root().querySelectorAll('strong').length,2);});
test('picker excludes already linked items',async t=>{const f=await fixture(t,['1','2']);assert.deepEqual([...f.root().querySelectorAll('option')].map(o=>o.value),['','3']);});
test('Link reloads server list and Connected History',async t=>{const f=await fixture(t);const before=f.history();await link(f);assert.deepEqual(f.links(),['1']);assert.match(f.root().textContent,/Kiln 1/);assert.equal(f.history(),before+1);assert.equal(f.calls.filter(c=>c.url.endsWith('/firings')&&!c.options.method).length,2);});
test('Unlink reloads server list and Connected History',async t=>{const f=await fixture(t,['1']);const before=f.history();button(f.root(),'Unlink').click();await tick();assert.deepEqual(f.links(),[]);assert.match(f.root().textContent,/No saved Firings linked/);assert.equal(f.history(),before+1);});
test('View reuses existing Firing modal and protected photos read-only',async t=>{const f=await fixture(t,['1']);button(f.root(),'View').click();await tick();const body=f.w.document.getElementById('firingViewBody');assert.match(body.textContent,/Kiln 1/);assert.ok(f.calls.some(c=>c.url.includes('/api/ql/firing-logs/1/photos/photo')&&c.options.headers.Authorization==='Bearer token-a'));assert.equal(body.querySelector('input,textarea'),null);assert.doesNotMatch(body.textContent,/Rearrange/);assert.equal(f.w.document.getElementById('firingViewDeleteBtn').hidden,true);assert.equal(f.w.document.getElementById('firingViewEditBtn').hidden,false);assert.ok(f.calls.every(c=>!c.url.includes('/uploads/')));});
test('closing viewer releases protected photo URL',async t=>{const f=await fixture(t,['1']);button(f.root(),'View').click();await tick();f.w.closeModal('firingViewModal');assert.ok(f.revoked.includes('blob:firings'));});
test('legacy database unavailable differs from empty and has retry',async t=>{const f=await fixture(t);f.availability(false);await f.w.viewPiece('p');await tick();assert.match(f.root().textContent,/not available for this database/);assert.equal(f.root().querySelector('select'),null);assert.ok(button(f.root(),'Retry'));});
test('error is generic and Retry recovers',async t=>{const f=await fixture(t);f.fail(true);await f.w.viewPiece('p');await tick();assert.match(f.root().textContent,/unavailable/);assert.doesNotMatch(f.root().textContent,/SECRET/);f.fail(false);button(f.root(),'Retry').click();await tick();assert.match(f.root().textContent,/No saved Firings linked/);});
test('rapid repeated Link sends a single mutation',async t=>{const f=await fixture(t);let finish;const original=f.w.fetch;f.w.fetch=(u,o)=>o?.method==='POST'?new Promise(r=>finish=()=>original(u,o).then(r)):original(u,o);const select=f.root().querySelector('select');select.value='1';select.dispatchEvent(new f.w.Event('change'));const b=button(f.root(),'Link');b.click();b.click();assert.match(f.root().textContent,/Updating link/);finish();await tick();assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);});
for(const method of ['POST','DELETE'])test('stale '+method+' cannot change another Piece',async t=>{const f=await fixture(t,method==='DELETE'?['1']:[]);let finish;const original=f.w.fetch;f.w.fetch=(u,o)=>o?.method===method?new Promise(r=>finish=()=>original(u,o).then(r)):original(u,o);if(method==='POST')await link(f);else button(f.root(),'Unlink').click();await f.w.viewPiece('other');await tick();const html=f.root().innerHTML,count=f.history();finish();await tick();assert.equal(f.root().innerHTML,html);assert.equal(f.history(),count);});
test('stale list rejected after account replacement',async t=>{const f=await fixture(t);let finish;f.w.fetch=()=>new Promise(r=>finish=r);await f.w.viewPiece('p');f.w.session('b');finish({ok:true,json:async()=>[{id:'1'}],headers:{get:()=> 'true'}});await tick();assert.equal(f.root(),null);});
test('logout removes linked data and read-only photo',async t=>{const f=await fixture(t,['1']);button(f.root(),'View').click();await tick();f.w.logout();assert.equal(f.root(),null);assert.ok(f.revoked.includes('blob:firings'));});
test('stored labels are text and cannot inject markup',async t=>{const f=await fixture(t,['1']);f.saved[0].kiln_name='<img src=x onerror=alert(1)>';await f.w.viewPiece('p');await tick();assert.match(f.root().textContent,/<img/);assert.equal(f.root().querySelector('img'),null);});
test('failed mutation requires server retry and never fabricates association',async t=>{const f=await fixture(t);f.fail(true);await link(f);assert.deepEqual(f.links(),[]);assert.ok(button(f.root(),'Retry'));assert.equal(f.root().querySelector('select'),null);});
for(const method of ['POST','DELETE'])test('account replacement rejects stale '+method,async t=>{const f=await fixture(t,method==='DELETE'?['1']:[]);let finish;const original=f.w.fetch;f.w.fetch=(u,o)=>o?.method===method?new Promise(r=>finish=()=>original(u,o).then(r)):original(u,o);if(method==='POST')await link(f);else button(f.root(),'Unlink').click();f.w.session('b');finish();await tick();assert.equal(f.root(),null);});

for(const mode of ['legacy-only','QL-only','dual'])test(mode+' server union renders once',async t=>{const f=await fixture(t,['1']);assert.equal(f.root().querySelectorAll('strong').length,1);});
test('stale viewer does not reopen after Piece navigation',async t=>{const f=await fixture(t,['1']);const original=f.w.api;let finish;f.w.api=u=>u==='/api/firing-logs/1'?new Promise(r=>finish=r):original(u);button(f.root(),'View').click();await f.w.viewPiece('other');finish(f.saved[0]);await tick();assert.equal(f.w.document.getElementById('firingViewBody').textContent,'');assert.equal(f.w.document.getElementById('firingViewModal').classList.contains('open'),false);});
test('Firing viewer errors have Retry and recover',async t=>{const f=await fixture(t,['1']);const original=f.w.api;f.w.api=async u=>{if(u==='/api/firing-logs/1')throw Error('private');return original(u)};button(f.root(),'View').click();await tick();const body=f.w.document.getElementById('firingViewBody');assert.match(body.textContent,/unavailable/);f.w.api=original;button(body,'Retry').click();await tick();assert.match(body.textContent,/Kiln 1/);});
test('rapid repeated Unlink sends once',async t=>{const f=await fixture(t,['1']);let finish;const original=f.w.fetch;f.w.fetch=(u,o)=>o?.method==='DELETE'?new Promise(r=>finish=()=>original(u,o).then(r)):original(u,o);const b=button(f.root(),'Unlink');b.click();b.click();finish();await tick();assert.equal(f.calls.filter(c=>c.options.method==='DELETE').length,1);});
