const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,10));
async function fixture(t){
 const w=new JSDOM(fs.readFileSync('public/index.html','utf8'),{url:'http://localhost',runScripts:'outside-only'}).window;
 t.after(()=>w.close());w.scrollTo=()=>{};w.setInterval=()=>0;w.confirm=()=>true;
 const style=w.document.createElement('style');style.textContent=fs.readFileSync('public/style.css','utf8');w.document.head.append(style);
 const revoked=[],calls=[];let n=0,linked=true;
 w.URL.createObjectURL=()=>`blob:photo-${++n}`;w.URL.revokeObjectURL=u=>revoked.push(u);
 w.fetch=async()=>({ok:true,json:async()=>({})});w.eval(fs.readFileSync('public/website-utils.js','utf8'));
 w.eval(fs.readFileSync('public/app.js','utf8')+"\nwindow.session=(a='a')=>{token=a;currentUser={id:a,tier:'starter'};currentPage='pieceDetail';window._currentPieceId='p'};");await tick();w.session();
 const firing={id:'f',kiln_name:'Old kiln',piece_id:'p',firing_type:'glaze',photos:[]};
 const tile={id:'t',name:'Tile',photo_filename:'tile.jpg',photoDelivery:'owner-protected'};
 const pricing={id:'r',name:'Pricing',inputs:{},result:{}};
 const history=()=>({photos:[{recordType:'piece-photo',sourceRecordId:'photo',values:{}}],history:[{recordType:'sale',sourceRecordId:'s',values:{item_description:'Sale'}}]});
 const data=url=>{
  if(url==='/api/clay-bodies/c')return {clay:{id:'c',user_id:'a',name:'Current Clay',photoDelivery:'owner-protected',photos:[{id:'cp',filename:'c.jpg'}]}};
  if(url.includes('/history'))return history();
  if(url.includes('/pieces/p/test-tiles'))return [];
  if(url.includes('/pieces/p/firings'))return linked?[firing]:[];
  if(url.includes('/pieces/p/pricing'))return [pricing];
  if(url.includes('/api/pieces/p'))return {id:'p',user_id:'a',clay_body_id:'c',clay_body_name:'Current Clay',title:'Piece',photos:[],glazes:[],firings:linked?[firing]:[]};
  if(url.includes('/photos'))return [];
  if(url==='/api/firing-logs/f')return firing;
  if(url.startsWith('/api/firing-logs'))return [firing];
  if(url==='/api/test-tiles/t')return tile;
  if(url==='/api/test-tiles')return [tile];
  if(url==='/api/pricing-calculations/r')return pricing;
  if(url==='/api/pricing-calculations')return [pricing];
  if(url==='/api/sales')return [{id:'s',user_id:'a',piece_id:'p',item_description:'Sale'}];
  return [];
 };
 w.api=async(url,o={})=>{calls.push({url,o});if(o.method==='PUT'){firing.kiln_name=o.body.kilnName;linked=o.body.pieceId==='p';}return data(url)};
 w.fetch=async(url,o={})=>{calls.push({url,o});return{ok:true,headers:{get:()=> 'true'},json:async()=>data(url),blob:async()=>new w.Blob(['photo'])}};
 await w.viewPiece('p');await tick();
 return {w,calls,revoked,firing,tile,linked:v=>linked=v,el:id=>w.document.getElementById(id),button:(id,label)=>[...w.document.getElementById(id).querySelectorAll('button')].find(b=>b.textContent===label)};
}
function absent(w,el){assert.equal(w.getComputedStyle(el).display,'none');assert.equal(el.disabled,true);assert.equal(el.tabIndex,-1);assert.equal(el.onclick,null);el.click();el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));}

test('fresh owned reference enables compact View and read-only viewer with protected photos',async t=>{const f=await fixture(t);const b=f.el('pieceClayView');assert.ok(b);b.click();await tick();assert.match(f.el('clayViewBody').textContent,/In Stock|Out of Stock/);for(const x of ['Edit','Duplicate','Photo'])absent(f.w,f.el('clayView'+x+'Btn'));const img=f.el('clayViewBody').querySelector('img');assert.match(img.src,/^blob:/);assert.ok(f.calls.some(c=>c.url.includes('/api/ql/clay-bodies/c/photos/cp')));assert.ok(f.calls.some(c=>c.url==='/api/pieces/p'&&c.o.cache==='no-store'));assert.equal(f.calls.filter(c=>c.o.method).length,0)});
for(const p of [{id:'p',user_id:'a',studio:'Manual'},{id:'p',user_id:'a',clay_body_name:'Same name'},{id:'p',user_id:'a',clay_body_id:'foreign',studio:'Own fallback'},{id:'p',user_id:'a',clay_body_id:'missing'}])test('no View for text or unresolved reference '+JSON.stringify(p),async t=>{const f=await fixture(t);const api=f.w.api;f.w.api=async u=>u==='/api/pieces/p'?{...p,photos:[],glazes:[]}:u.startsWith('/api/clay-bodies/')?Promise.reject(Error('missing')):api(u);await f.w.viewPiece('p');await tick();assert.equal(f.el('pieceClayView'),null)});
test('foreign preflight response never enables View',async t=>{const f=await fixture(t);const api=f.w.api;f.w.api=async u=>u==='/api/clay-bodies/c'?{clay:{id:'c',user_id:'b',name:'Secret'}}:api(u);await f.w.viewPiece('p');await tick();assert.equal(f.el('pieceClayView'),null);assert.doesNotMatch(f.el('pieceDetailContent').textContent,/Secret/)});
for(const status of [403,404,500])test('failure status '+status+' clears stale details and Retry authorizes again',async t=>{const f=await fixture(t);const fetch=f.w.fetch;f.w.fetch=async()=>({ok:false,status});f.el('pieceClayView').click();await tick();assert.match(f.el('clayViewBody').textContent,status===500?/Unable/:/unavailable/);assert.equal(f.el('clayViewBody').querySelector('img'),null);f.w.fetch=fetch;f.button('clayViewBody','Retry').click();await tick();assert.ok(f.el('clayViewBody').querySelector('img'))});
for(const change of ['close','piece','session','association'])test('pending Clay rejects '+change,async t=>{const f=await fixture(t);const fetch=f.w.fetch;let finish;f.w.fetch=async(u,o)=>u==='/api/clay-bodies/c'?new Promise(r=>finish=r):change==='association'&&u==='/api/pieces/p'?{ok:true,json:async()=>({id:'p',user_id:'a',clay_body_id:'other'})}:fetch(u,o);f.el('pieceClayView').click();if(change==='close')f.w.closeModal('clayViewModal');if(change==='piece')f.w.clearPieceHistory();if(change==='session')f.w.clearClayMedia();finish({ok:true,json:async()=>({clay:{id:'c',user_id:'a',name:'Late secret',photos:[]}})});await tick();assert.doesNotMatch(f.el('clayViewBody').textContent,/Late secret/);if(change==='association')assert.match(f.el('clayViewBody').textContent,/unavailable/)});
test('close restores launch focus and revokes viewer blob',async t=>{const f=await fixture(t);const b=f.el('pieceClayView');b.click();await tick();const url=f.el('clayViewBody').querySelector('img').src;f.w.closeModal('clayViewModal');assert.equal(f.w.document.activeElement,b);assert.ok(f.revoked.includes(url));assert.equal(f.el('clayViewBody').textContent,'')});
test('normal library controls restored after read-only viewer',async t=>{const f=await fixture(t);f.el('pieceClayView').click();await tick();f.w.closeModal('clayViewModal');f.w.openClayViewModal({id:'c',name:'Normal',photos:[]});for(const x of ['Edit','Duplicate','Photo']){const b=f.el('clayView'+x+'Btn');assert.equal(b.disabled,false);assert.equal(b.tabIndex,0);assert.equal(typeof b.onclick,'function')}});
