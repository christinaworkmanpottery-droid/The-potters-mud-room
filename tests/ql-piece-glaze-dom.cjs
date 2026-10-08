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
 const piece={id:'p',user_id:'a',title:'Piece',photos:[],glazes:[{id:'l1',glaze_id:'g',layer_order:1,glaze_name:'Current Glaze',coats:2,application_method:'brush'},{id:'manual',glaze_id:null,layer_order:2,glaze_name:'Manual'},{id:'l3',glaze_id:'g',layer_order:3,glaze_name:'Current Glaze'}]};
 const glaze={id:'g',user_id:'a',name:'Fresh Glaze',brand:'Brand',ingredients:[{ingredient_name:'Silica',percentage:100}],recipe_notes:'Recipe notes',notes:'Notes',photoDelivery:'owner-protected',photos:[{id:'gp',filename:'g.jpg'}],clay_tests:[{id:'ct',clay_name:'Test Clay',result_notes:'Test notes',photoDelivery:'owner-protected',photo_filename:'ct.jpg'}]};
 const data=url=>{
 if(url==='/api/glazes')return [glaze];
  if(url==='/api/clay-bodies/c')return {clay:{id:'c',user_id:'a',name:'Current Clay',photoDelivery:'owner-protected',photos:[{id:'cp',filename:'c.jpg'}]}};
  if(url.includes('/history'))return history();
  if(url.includes('/pieces/p/test-tiles'))return [];
  if(url.includes('/pieces/p/firings'))return linked?[firing]:[];
  if(url.includes('/pieces/p/pricing'))return [pricing];
  if(url.includes('/api/pieces/p'))return piece;
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
 return {w,calls,revoked,firing,tile,piece,glaze,launchers:()=>[...w.document.querySelectorAll('[data-piece-glaze-index] button')],linked:v=>linked=v,el:id=>w.document.getElementById(id),button:(id,label)=>[...w.document.getElementById(id).querySelectorAll('button')].find(b=>b.textContent===label)};
}
function absent(w,el){assert.equal(w.getComputedStyle(el).display,'none');assert.equal(el.disabled,true);assert.equal(el.tabIndex,-1);assert.equal(el.onclick,null);el.click();el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));}


test('ordered mixed layers and repeated Glaze launchers retain metadata and positions',async t=>{const f=await fixture(t);const rows=[...f.w.document.querySelectorAll('[data-piece-glaze-index]')];assert.equal(rows.length,3);assert.match(rows[0].textContent,/Current Glaze — 2 coats — brush/);assert.equal(rows[1].textContent,'Manual');assert.equal(f.launchers().length,2);assert.equal(rows[1].querySelector('button'),null)});
test('fresh detail and Piece recheck reuse full renderer read-only including protected child photos',async t=>{const f=await fixture(t);f.launchers()[0].click();await tick();const body=f.el('glazeViewBody');for(const text of ['Fresh Glaze','Brand','Silica','Recipe notes','Notes','Test Clay','Test notes'])assert.match(f.el('glazeViewTitle').textContent+body.textContent,new RegExp(text));for(const x of ['Edit','Duplicate','Photo'])absent(f.w,f.el('glazeView'+x+'Btn'));assert.equal(body.querySelectorAll('img').length,2);for(const img of body.querySelectorAll('img'))assert.match(img.src,/^blob:/);assert.ok(f.calls.some(x=>x.url==='/api/glazes'&&x.o.cache==='no-store'));assert.ok(f.calls.some(x=>x.url==='/api/pieces/p'&&x.o.cache==='no-store'));assert.equal(f.calls.filter(x=>x.o.method).length,0);assert.equal(body.querySelector('input,select,button'),null)});
for(const change of ['remove','recreate','reorder','position','reassign','manual','piece-owner'])test('old layer launcher unavailable after '+change,async t=>{const f=await fixture(t);const b=f.launchers()[0];if(change==='remove')f.piece.glazes.shift();if(change==='recreate')f.piece.glazes[0].id='new';if(change==='reorder')f.piece.glazes.reverse();if(change==='position')f.piece.glazes[0].layer_order=9;if(change==='reassign')f.piece.glazes[0].glaze_id='other';if(change==='manual')f.piece.glazes[0].glaze_id=null;if(change==='piece-owner')f.piece.user_id='b';b.click();await tick();assert.match(f.el('glazeViewBody').textContent,/unavailable/);assert.equal(b.disabled,true);assert.equal(b.isConnected,false);assert.equal(f.el('glazeViewBody').querySelector('img'),null)});
for(const kind of ['foreign','missing','name-only'])test('no name inference or foreign preflight '+kind,async t=>{const f=await fixture(t);if(kind==='foreign')f.glaze.user_id='b';if(kind==='missing')f.glaze.id='other';if(kind==='name-only')f.piece.glazes.forEach(x=>x.glaze_id=null);await f.w.viewPiece('p');await tick();assert.equal(f.launchers().length,0)});
for(const status of [401,403,404,500])test('generic failure and Retry '+status,async t=>{const f=await fixture(t);const fetch=f.w.fetch;f.w.fetch=async()=>({ok:false,status});f.launchers()[0].click();await tick();assert.match(f.el('glazeViewBody').textContent,status===500?/Unable/:/unavailable/);f.w.fetch=fetch;f.button('glazeViewBody','Retry').click();await tick();assert.equal(f.el('glazeViewTitle').textContent,'Fresh Glaze')});
for(const change of ['close','piece','account','session','newer'])test('late response isolation '+change,async t=>{const f=await fixture(t);const fetch=f.w.fetch;let finish;f.w.fetch=async(u,o)=>u==='/api/glazes'?new Promise(r=>finish=r):fetch(u,o);f.launchers()[0].click();if(change==='close')f.w.closeModal('glazeViewModal');if(change==='piece')f.w.clearPieceHistory();if(change==='account'){f.w.session('b');f.w.clearGlazeMedia()}if(change==='session'){f.w.session('new-session');f.w.clearGlazeMedia()}if(change==='newer'){f.w.fetch=fetch;f.w.openGlazeViewModal({id:'other',name:'New viewer',photos:[]})}finish({ok:true,json:async()=>[{...f.glaze,name:'LATE SECRET'}]});await tick();assert.doesNotMatch(f.el('glazeViewTitle').textContent+f.el('glazeViewBody').textContent,/LATE SECRET/)});
test('close cleans both media scopes child lightbox and cache, returns focus to correct repeated launcher',async t=>{const f=await fixture(t);for(const b of f.launchers()){b.click();await tick();const imgs=[...f.el('glazeViewBody').querySelectorAll('img')],urls=imgs.map(x=>x.src);imgs[1].click();f.w.closeModal('glazeViewModal');assert.equal(f.w.document.activeElement,b);assert.ok(urls.every(x=>f.revoked.includes(x)));assert.equal(f.el('lightboxImg').getAttribute('src'),null);assert.equal(f.el('glazeViewBody').textContent,'')}});
test('normal library restores controls and pending Piece response cannot replace it',async t=>{const f=await fixture(t);f.launchers()[0].click();await tick();f.w.openGlazeViewModal(f.glaze);for(const x of ['Edit','Duplicate','Photo']){const b=f.el('glazeView'+x+'Btn');assert.equal(b.disabled,false);assert.equal(b.tabIndex,0);assert.equal(typeof b.onclick,'function')}});

test('Retry retains originating layer focus rather than the replaced Retry button',async t=>{const f=await fixture(t),fetch=f.w.fetch,b=f.launchers()[1];f.w.fetch=async()=>({ok:false,status:500});b.click();await tick();const retry=f.button('glazeViewBody','Retry');retry.focus();f.w.fetch=fetch;retry.click();await tick();f.w.closeModal('glazeViewModal');assert.equal(f.w.document.activeElement,b)});
test('late child image download on close is revoked and cannot repopulate modal',async t=>{const f=await fixture(t),fetch=f.w.fetch;let finish;f.w.fetch=async(u,o)=>u.includes('/clay-tests/')?new Promise(r=>finish=r):fetch(u,o);f.launchers()[0].click();await tick();assert.ok(finish);f.w.closeModal('glazeViewModal');const n=f.revoked.length;finish({ok:true,blob:async()=>new f.w.Blob(['late'])});await tick();assert.ok(f.revoked.length>n);assert.equal(f.el('glazeViewBody').querySelector('img'),null)});
