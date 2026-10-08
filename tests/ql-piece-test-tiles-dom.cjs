const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
async function fixture(t, ids = []) {
  const w = new JSDOM(fs.readFileSync('public/index.html', 'utf8'), { url: 'http://localhost', runScripts: 'outside-only' }).window;
  t.after(() => w.close()); w.scrollTo = () => {}; w.setInterval = () => 0;
  w.URL.createObjectURL = () => 'blob:tiles'; const revoked = []; w.URL.revokeObjectURL = url => revoked.push(url);
  w.fetch = async () => ({ ok: true, json: async () => ({}) });
  w.eval(fs.readFileSync('public/website-utils.js', 'utf8'));
  w.eval(fs.readFileSync('public/app.js', 'utf8') + '\nwindow.session=(id="a")=>{clearPieceHistory();token="token-"+id;currentUser={id,tier:"free"};};');
  await tick(); w.session();
  let links = [...ids], history = 0, available = true, fail = false;
  const saved = [1,2,3].map(i => ({ id: String(i), name: 'Kiln '+i, firing_type:'glaze',cone:'6',date:'2026-09-01',photos:i===1?[{id:'photo',filename:'private.jpg',photoDelivery:'owner-protected'}]:[], photoDelivery:'owner-protected', photo_filename:i===1?'private.jpg':null, photo_filename2:null, photo_filename3:i===1?'third.jpg':null,photoDelivery3:'owner-protected',clay_library_name:'Library Clay',glaze_library_name:'Library Glaze',created_at:'2026-09-01', notes:'Saved notes' }));
  const calls=[];
  w.api = async url => {
    if(url.includes('/history')) { history++; return {pieceId:'p',events:[]}; }
    if(url.startsWith('/api/test-tiles/')) return url.endsWith('/photos') ? saved.find(c=>c.id===url.split('/')[3]).photos : saved.find(c=>c.id===url.split('/').pop());
    if(url.startsWith('/api/pieces/')) return {id:url.split('/').pop(),title:'Piece',photos:[],glazes:[]};
    return [];
  };
  const request = async (url, options={}) => {
    if(url.includes('/pricing') || url.endsWith('/firings'))return {ok:true,json:async()=>[],headers:{get:()=> 'false'}};
    calls.push({url,options}); if(fail) throw Error('PRIVATE SQL SECRET');
    let data;
    if(url.includes('/photos/')) return {ok:true,blob:async()=>new w.Blob(['photo'])};
    if(url==='/api/test-tiles') data=saved;
    else if(url.startsWith('/api/test-tiles/')) data=saved.find(c=>c.id===url.split('/').pop());
    else if(options.method==='POST') {links=[...new Set([...links,JSON.parse(options.body).testTileId])];data={};}
    else if(options.method==='DELETE') {links=links.filter(id=>id!==url.split('/').pop());data={removed:true};}
    else data=links.map(id=>saved.find(t=>t.id===id));
    return {ok:true,json:async()=>data,headers:{get:()=>available?'true':'false'}};
  };
  w.fetch=request;
  await w.viewPiece('p'); await tick();
  return {w,calls,saved,request,revoked,root:()=>w.document.getElementById('linkedTestTiles'),history:()=>history,links:()=>links,
    availability:v=>available=v,fail:v=>fail=v};
}
const button = (root, name) => [...root.querySelectorAll('button')].find(el=>el.textContent===name);
async function link(f,id='1') {const s=f.root().querySelector('select');s.value=id;s.dispatchEvent(new f.w.Event('change'));button(f.root(),'Link').click();await tick();}

test('entitled empty and picker excludes current links',async t=>{const f=await fixture(t);assert.match(f.root().textContent,/No saved Test Tiles linked/);assert.equal(f.root().querySelectorAll('option').length,4);});
test('Link reloads server truth and History',async t=>{const f=await fixture(t);const before=f.history();await link(f);assert.deepEqual(f.links(),['1']);assert.equal(f.root().querySelectorAll('strong').length,1);assert.ok(f.history()>before);assert.equal(f.root().querySelectorAll('option').length,3);});
test('Unlink reloads History and preserves other links',async t=>{const f=await fixture(t,['1','2']);button(f.root(),'Unlink').click();await tick();assert.deepEqual(f.links(),['2']);});
test('unavailable differs from empty and Retry',async t=>{const f=await fixture(t);f.availability(false);await f.w.viewPiece('p');await tick();assert.match(f.root().textContent,/not available/);assert.ok(button(f.root(),'Retry'));});
test('error clears picker and retry restores',async t=>{const f=await fixture(t,['1']);f.fail(true);await f.w.viewPiece('p');await tick();assert.ok(button(f.root(),'Retry'));assert.equal(f.root().querySelector('select'),null);f.fail(false);button(f.root(),'Retry').click();await tick();assert.equal(f.root().querySelectorAll('strong').length,1);});
for(const method of ['GET','POST','DELETE'])test(method+' 403 clears all relationship payload',async t=>{const f=await fixture(t,['1']);const fetch=f.w.fetch;f.w.fetch=(u,o={})=>u.includes('/test-tiles')&&(o.method||'GET')===method?Promise.resolve({ok:false,status:403,json:async()=>({code:'TEST_TILE_ENTITLEMENT_REQUIRED'}),headers:{get:()=> 'true'}}):fetch(u,o);if(method==='GET')await f.w.viewPiece('p');else if(method==='POST')await link(f,'2');else button(f.root(),'Unlink').click();await tick();assert.match(f.root().textContent,/locked/);assert.equal(f.root().querySelector('select'),null);assert.equal(f.root().querySelector('strong'),null);});
test('View fetches fresh ID with read-only renderer names and three-slot metadata',async t=>{const f=await fixture(t,['1']);button(f.root(),'View').click();await tick();const body=f.w.document.getElementById('testTileViewBody');assert.match(body.textContent,/Library Clay/);assert.match(body.textContent,/Library Glaze/);assert.match(body.textContent,/Saved notes/);assert.equal(body.querySelectorAll('img').length,2);assert.equal(f.w.document.getElementById('testTileViewEditBtn').hidden,true);assert.equal(f.w.document.getElementById('testTileViewEditBtn').onclick,null);assert.ok(f.calls.some(c=>c.url==='/api/test-tiles/1'));assert.ok(f.calls.every(c=>!c.url.includes('/uploads/')));});
for(const status of [403,404,500])test('viewer '+status+' clears prior content',async t=>{const f=await fixture(t,['1']);button(f.root(),'View').click();await tick();const orig=f.w.fetch;f.w.fetch=(u,o)=>u==='/api/test-tiles/1'?Promise.resolve({ok:false,status,json:async()=>({})}):orig(u,o);await f.w.viewTestTileById('1',{readOnly:true});const body=f.w.document.getElementById('testTileViewBody');assert.doesNotMatch(body.textContent,/Saved notes/);assert.equal(body.querySelector('img'),null);assert.match(body.textContent,status===403?/locked/:status===404?/unavailable/:/Unable/);if(status!==403)assert.ok(button(body,'Retry'));});
test('viewer close aborts detail and clears content blobs and lightbox',async t=>{const f=await fixture(t,['1']);await f.w.viewTestTileById('1');await tick();f.w.closeModal('testTileViewModal');assert.equal(f.w.document.getElementById('testTileViewBody').textContent,'');assert.ok(f.revoked.length);});
for(const action of ['close','account','new'])test('viewer ignores stale '+action+' response',async t=>{const f=await fixture(t,['1']);const orig=f.w.fetch;let finish;f.w.fetch=(u,o)=>u==='/api/test-tiles/1'?new Promise(r=>finish=r):orig(u,o);const pending=f.w.viewTestTileById('1');if(action==='close')f.w.closeModal('testTileViewModal');if(action==='account')f.w.session('b');if(action==='new'){f.saved[1].notes='Second detail';await f.w.viewTestTileById('2');}finish({ok:true,json:async()=>f.saved[0]});await pending;assert.doesNotMatch(f.w.document.getElementById('testTileViewBody').textContent,/Saved notes/);});
test('manual names precede library fallback',async t=>{const f=await fixture(t,['1']);f.saved[0].clay_name='Manual Clay';f.saved[0].glaze_name='Manual Glaze';await f.w.viewTestTileById('1');const body=f.w.document.getElementById('testTileViewBody');assert.match(body.textContent,/Manual Clay/);assert.doesNotMatch(body.textContent,/Library Clay/);});
test('normal viewer retains deliberate edit action',async t=>{const f=await fixture(t);await f.w.viewTestTileById('1');assert.equal(f.w.document.getElementById('testTileViewEditBtn').hidden,false);assert.equal(typeof f.w.document.getElementById('testTileViewEditBtn').onclick,'function');});
test('media 403 clears viewer and linked state',async t=>{const f=await fixture(t,['1']);const orig=f.w.fetch;f.w.fetch=(u,o)=>u.includes('/photos/')?Promise.resolve({ok:false,status:403}):orig(u,o);await f.w.viewTestTileById('1');await tick();assert.match(f.root().textContent,/locked/);assert.equal(f.w.document.getElementById('testTileViewBody').querySelector('img'),null);});
test('photo failure preserves details',async t=>{const f=await fixture(t,['1']);const orig=f.w.fetch;f.w.fetch=(u,o)=>u.includes('/photos/')?Promise.resolve({ok:false,status:404}):orig(u,o);await f.w.viewTestTileById('1');await tick();assert.match(f.w.document.getElementById('testTileViewBody').textContent,/Saved notes/);});
