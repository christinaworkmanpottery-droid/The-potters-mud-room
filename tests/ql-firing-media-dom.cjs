const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
const source=fs.readFileSync('public/app.js','utf8');
function fixture(fetch){const dom=new JSDOM('<div id="firingList"></div><div id="firingViewBody"></div><img id="lightboxImg"><div id="firingViewModal"></div>');const revoked=[];let i=0;const ctx=vm.createContext({document:dom.window.document,URL:{createObjectURL:()=>`blob:${++i}`,revokeObjectURL:u=>revoked.push(u)},AbortController,fetch,API:'',token:'A',pendingFiringPhotos:[],esc:String,closeLightbox:()=>{}});vm.runInContext(source.slice(source.indexOf('let firingMediaGeneration'),source.indexOf('async function printFiringLog')),ctx);return{ctx,dom,revoked,run:s=>vm.runInContext(s,ctx)};}
function render(f,delivery='owner-protected'){f.run(`document.getElementById('firingList').innerHTML=firingPhotoMarkup({id:'c',photoDelivery:'${delivery}'},{id:'p',filename:'a.jpg'})`);}
test('website Firing owner photo uses protected fetch and blob full-size source',async()=>{let request;const f=fixture(async(...args)=>{request=args;return{ok:true,blob:async()=>({})}});render(f);await f.run("loadFiringMedia('firingList')");assert.equal(request[0],'/api/ql/firing-logs/c/photos/p');assert.equal(request[1].headers.Authorization,'Bearer A');assert.equal(request[1].cache,'no-store');assert.equal(f.dom.window.document.querySelector('#firingList img').src,'blob:1');});
test('website legacy contract preserves static URL',()=>{const f=fixture();render(f,'legacy-ambiguous');assert.equal(f.dom.window.document.querySelector('img').getAttribute('src'),'/uploads/a.jpg');});
test('website account switch clears Firing DOM and revokes private URLs',async()=>{const f=fixture(async()=>({ok:true,blob:async()=>({})}));render(f);await f.run("loadFiringMedia('firingList')");f.run("clearFiringMedia(); token='B'");assert.deepEqual(f.revoked,['blob:1']);assert.equal(f.dom.window.document.getElementById('firingList').innerHTML,'');});
test('late website Account A response cannot populate reused Account B view',async()=>{let resolve;const f=fixture(()=>new Promise(r=>resolve=r));render(f);const pending=f.run("loadFiringMedia('firingList')");f.run("clearFiringMedia();token='B'");render(f);resolve({ok:true,blob:async()=>({})});await pending;assert.equal(f.dom.window.document.querySelector('#firingList img').getAttribute('src'),null);});
test('website Firing image failure remains local and record controls survive',async()=>{const f=fixture(async()=>({ok:false}));render(f);f.run("document.getElementById('firingList').insertAdjacentHTML('beforeend','<button>Edit Firing</button>')");await f.run("loadFiringMedia('firingList')");assert.equal(f.dom.window.document.querySelector('img').alt,'Photo unavailable');assert.equal(f.dom.window.document.querySelector('button').textContent,'Edit Firing');});
test('website closed/reused modal invalidates late image request',async()=>{let resolve;const f=fixture(()=>new Promise(r=>resolve=r));render(f);const pending=f.run("loadFiringMedia('firingList')");f.run("clearFiringMedia('firingList')");resolve({ok:true,blob:async()=>({})});await pending;assert.equal(f.dom.window.document.querySelector('img').getAttribute('src'),null);});

async function integrated(t){
 const dom=new JSDOM(fs.readFileSync('public/index.html','utf8'),{url:'http://localhost/',runScripts:'outside-only'}),w=dom.window;t.after(()=>w.close());w.scrollTo=()=>{};w.setInterval=()=>0;const calls=[],revoked=[];let sequence=0;w.URL.createObjectURL=()=>`blob:firing-${++sequence}`;w.URL.revokeObjectURL=u=>revoked.push(u);w.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({}),blob:async()=>new w.Blob(['image'])}};
 w.eval(fs.readFileSync('public/website-utils.js','utf8'));w.eval(source+"\nwindow.firingTestSession=t=>{token=t;currentUser={id:t,tier:'starter'};currentPage='firings'};");await new Promise(r=>setTimeout(r,10));w.firingTestSession('A');
 const f={id:'f',firing_type:'bisque',photoDelivery:'owner-protected',photos:[{id:'p1',filename:'one.jpg',photoDelivery:'owner-protected'},{id:'p2',filename:'two.jpg',photoDelivery:'owner-protected'}]};w.api=async url=>url==='/api/pieces'?[]:url.endsWith('/photos')?f.photos:[f];calls.length=0;return{w,f,calls,revoked};
}
const settle=()=>new Promise(setImmediate);
test('real Firing cards detail editor reorder and lightbox all load protected photos',async t=>{
 const {w,f,calls}=await integrated(t);w.localStorage.setItem('mudlog_view_firings','card');await w.loadFirings();await settle();
 // Force cards regardless of persisted view preference.
 const c=w.document.getElementById('firingList');c.innerHTML=w.firingCardView(f);await w.loadFiringMedia('firingList');assert.equal(c.querySelectorAll('[src^="blob:"]').length,2);
 w.viewFiring('f');await settle();await settle();assert.equal(w.document.querySelectorAll('#firingViewBody img[src^="blob:"]').length,2);
 const img=w.document.querySelector('#firingViewBody img');w.openLightbox(img.src);assert.equal(w.document.getElementById('lightboxImg').src,img.src);w.closeModal('firingViewModal');assert.equal(w.document.getElementById('lightboxImg').getAttribute('src'),null);
 w.openFiringModal(f);await settle();assert.equal(w.document.querySelectorAll('#firingPhotosContainer img[src^="blob:"]').length,2);
 await w.openFiringPhotoReorder('f');await settle();assert.equal(w.document.querySelectorAll('#firingPhotoReorderContent img[src^="blob:"]').length,2);w.moveFiringPhoto(0,1);await settle();assert.equal(w.document.querySelector('#firingPhotoReorderContent img').dataset.privateFiringPhoto,'p2');
 assert.ok(calls.every(c=>!c.url.includes('/uploads/')));assert.ok(calls.some(c=>c.url==='/api/ql/firing-logs/f/photos/p2'));
});
test('real Firing stale list/detail/editor/reorder metadata cannot repopulate after account replacement',async t=>{
 const {w,f}=await integrated(t);
 for(const action of [()=>w.loadFirings(),()=>w.viewFiring('f'),()=>w.loadFiringPhotos('f'),()=>w.openFiringPhotoReorder('f')]){
 let resolve;w.api=()=>new Promise(r=>resolve=r);action();w.clearFiringMedia();w.firingTestSession('B');resolve([f]);await settle();
 for(const id of ['firingList','firingViewBody','firingPhotosContainer','firingPhotoReorderContent'])assert.equal(w.document.getElementById(id).innerHTML,'');w.firingTestSession('A');
 }
});
test('Firing print copies protected blob images and closes on session cleanup',async t=>{
 const {w,f}=await integrated(t);w.document.getElementById('firingList').innerHTML=w.firingCardView(f);
 const printDom=new JSDOM(''),p={document:printDom.window.document,closed:false,print(){this.printed=true},close(){this.closed=true}};t.after(()=>printDom.window.close());w.open=()=>p;
 await w.printFiringLog();assert.equal(p.printed,true);assert.equal(p.document.querySelectorAll('img[src^="blob:"]').length,2,p.document.documentElement.outerHTML);assert.ok(!p.document.body.innerHTML.includes('/uploads/'));w.clearFiringMedia();assert.equal(p.closed,true);
});
test('Firing create preview URLs are released when editor closes',async t=>{
 const {w,revoked}=await integrated(t);w.openFiringModal();await w.uploadFiringPhotos({target:{files:[new w.File(['bytes'],'new.jpg',{type:'image/jpeg'})],value:'x'}});const img=w.document.querySelector('#firingPhotosContainer img');const uri=img.src;w.openLightbox(uri);w.closeModal('firingModal');assert.ok(revoked.includes(uri));assert.equal(w.document.getElementById('lightboxImg').getAttribute('src'),null);
});
