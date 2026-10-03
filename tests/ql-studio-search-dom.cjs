'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {JSDOM} = require('jsdom');
const tick = () => new Promise(r => setTimeout(r,15));
const types = ['piece','clay','glaze','raw-material','test-tile','firing','pricing','sale','project','contact','event'];
const paths = ['/api/pieces/x','/api/clay-bodies/x','/api/glazes','/api/glaze-chemicals','/api/test-tiles/x','/api/firing-logs/x','/api/pricing-calculations/x','/api/sales','/api/projects/x','/api/contacts/x','/api/events'];
const row = (type='piece',title='Search title',id='x') => ({recordType:type,sourceRecordId:id,title,excerpt:'Saved text',billing:'DO NOT DISPLAY',mediaUrl:'/private/path',matchedFields:['notes']});
const result = (rows=[row()],extra={}) => ({results:rows,lockedTypes:[],hasMore:false,nextOffset:null,capped:false,...extra});
const response = (data,status=200) => ({ok:status===200,status,json:async()=>data,headers:{get:()=>''},blob:async()=>new Blob([])});
async function fixture(t) {
 const w = new JSDOM(fs.readFileSync('public/index.html','utf8'),{url:'http://localhost',runScripts:'outside-only'}).window;
 t.after(()=>w.close());w.scrollTo=()=>{};w.setInterval=()=>0;w.confirm=()=>true;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
 w.fetch=async()=>response([]);
 w.eval(fs.readFileSync('public/website-utils.js','utf8'));
 w.eval(fs.readFileSync('public/app.js','utf8')+"\nwindow.session=(id='a',value=id)=>{token=value;currentUser=id?{id,tier:'starter'}:null;localStorage.setItem('mudlog_token',value);}; window.session();\n"+fs.readFileSync('public/studio-search.js','utf8'));
 await tick();w.session();
 const calls=[];let payload=result(),handler=null;
 const record={id:'x',user_id:'a',title:'Fresh canonical title',name:'Fresh canonical name',notes:'Fresh canonical notes',kiln_name:'Fresh canonical kiln',item_description:'Fresh canonical sale',photos:[],glazes:[],firings:[],inputs:{},result:{},tags:'',rating:0};
 const canonical = url => {
  if(url==='/api/clay-bodies/x')return {clay:record};
  if(['/api/glazes','/api/glaze-chemicals','/api/sales','/api/events'].includes(url))return [record];
  if(paths.includes(url))return record;
  if(url.endsWith('/history'))return {photos:[],history:[]};
  return [];
 };
 w.fetch=async(url,options={})=>{calls.push({url:String(url),options});if(handler){const custom=await handler(String(url),options);if(custom)return custom;}return response(String(url).startsWith('/api/ql/search?')?payload:canonical(String(url)));};
 w.navigate('studioSearch');
 const el=id=>w.document.getElementById(id);
 const submit=async(q='celadon')=>{el('studioSearchInput').value=q;el('studioSearchForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();};
 return {w,el,calls,record,submit,payload:p=>payload=p,handler:h=>handler=h,buttons:()=>[...el('studioSearchResults').querySelectorAll('button')],text:()=>w.document.body.textContent};
}

test('entry, labels, empty state, keyboard form, safe successful results',async t=>{
 const f=await fixture(t);assert.ok(f.w.document.querySelector('[data-page="studioSearch"]'));assert.match(f.el('studioSearchStatus').textContent,/Search your saved/);
 f.payload(result(types.map(type=>row(type))));await f.submit();assert.equal(f.buttons().length,11);assert.match(f.el('studioSearchStatus').textContent,/11 results/);
 assert.doesNotMatch(f.el('studioSearchResults').textContent,/DO NOT DISPLAY|private\/path|\bnotes\b/);assert.equal(f.el('studioSearchInput').getAttribute('maxlength'),'120');assert.equal(f.el('studioSearchInput').labels[0].textContent,'Search text');
});
test('stored HTML remains inert plain text',async t=>{const f=await fixture(t);const html='<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>';f.payload(result([{...row('piece',html),excerpt:html}]));await f.submit();assert.equal(f.el('studioSearchResults').querySelectorAll('img,script').length,0);assert.ok(f.el('studioSearchResults').textContent.includes(html));assert.equal(f.w.pwned,undefined);});
for(const [i,type] of types.entries())test(type+' opens fresh canonical viewer and returns to Search',async t=>{
 const f=await fixture(t);f.payload(result([row(type)]));await f.submit();const b=f.buttons()[0];b.click();await tick();await tick();
 assert.ok(f.calls.some(c=>c.url===paths[i]&&c.options.cache==='no-store'),JSON.stringify(f.calls));
 const region=type==='piece'?f.el('pieceDetailContent'):({clay:'clayViewBody',glaze:'glazeViewBody','test-tile':'testTileViewBody',firing:'firingViewBody',sale:'saleDetailsContent'}[type]?f.el({clay:'clayViewBody',glaze:'glazeViewBody','test-tile':'testTileViewBody',firing:'firingViewBody',sale:'saleDetailsContent'}[type]):f.el('studioSearchDetail'));
 assert.match(region.textContent,/Fresh canonical|Price Breakdown/);assert.doesNotMatch(region.textContent,/Search title/);
 assert.match(f.w.location.hash,new RegExp('studioSearch/'+type+'/x'));
 f.w.StudioSearch.back();assert.ok(f.el('pageStudioSearch').classList.contains('active'));assert.equal(f.buttons().length,1);assert.equal(f.el('studioSearchDetail').textContent,'');assert.equal(f.w.document.activeElement,b);
});
for(const [i,type] of types.entries())test(type+' deleted or foreign canonical result fails closed',async t=>{
 const f=await fixture(t);f.payload(result([row(type)]));await f.submit();f.handler(url=>url===paths[i]?response({error:'Not found'},404):null);f.buttons()[0].click();await tick();assert.match(f.el('studioSearchDetail').textContent,/Record unavailable/);assert.doesNotMatch(f.el('studioSearchDetail').textContent,/Search title|Fresh canonical/);assert.equal(f.buttons().length,0);
});
test('forged successful foreign response cannot bypass ownership',async t=>{const f=await fixture(t);await f.submit();f.record.user_id='b';f.buttons()[0].click();await tick();assert.match(f.el('studioSearchDetail').textContent,/Record unavailable/);assert.doesNotMatch(f.el('studioSearchDetail').textContent,/Fresh canonical/);});
for(const type of types)test(type+' filter is sent to API unchanged',async t=>{const f=await fixture(t);await f.submit();f.el('studioSearchType').value=type;f.el('studioSearchType').dispatchEvent(new f.w.Event('change'));await tick();assert.ok(f.calls.at(-1).url.includes('types='+type));});
test('locked Test Tiles hide all tile fields even from malformed payload; unrelated filters retain lock',async t=>{const f=await fixture(t);f.payload(result([row('test-tile','Secret'),row()],{lockedTypes:['test-tile']}));await f.submit();assert.equal(f.buttons().length,1);assert.doesNotMatch(f.el('studioSearchResults').textContent,/Secret/);assert.match(f.el('studioSearchLocked').textContent,/unavailable/);f.payload(result([row()]));f.el('studioSearchType').value='piece';f.el('studioSearchType').dispatchEvent(new f.w.Event('change'));await tick();assert.match(f.el('studioSearchLocked').textContent,/unavailable/);});
test('entitlement lost after search removes tiles and clears previous detail',async t=>{const f=await fixture(t);f.payload(result([row('test-tile')]));await f.submit();f.handler(url=>url==='/api/test-tiles/x'?response({},403):null);f.buttons()[0].click();await tick();assert.match(f.el('studioSearchDetail').textContent,/Record unavailable/);assert.match(f.el('studioSearchLocked').textContent,/unavailable/);assert.equal(f.buttons().length,0);assert.equal(f.el('testTileViewBody').textContent,'');});
test('loading, no results, error, retry, clear, and input focus',async t=>{const f=await fixture(t);let finish;f.handler(url=>url.startsWith('/api/ql/search?')?new Promise(r=>finish=r):null);const pending=f.submit();assert.match(f.el('studioSearchStatus').textContent,/Searching/);assert.equal(f.el('studioSearchResults').getAttribute('aria-busy'),'true');finish(response(result([])));await pending;assert.match(f.el('studioSearchStatus').textContent,/No results/);f.handler(url=>url.startsWith('/api/ql/search?')?response({},500):null);await f.submit();assert.equal(f.el('studioSearchRetry').hidden,false);f.handler(null);f.el('studioSearchRetry').click();await tick();assert.equal(f.buttons().length,1);f.el('studioSearchClear').click();assert.equal(f.buttons().length,0);assert.equal(f.el('studioSearchInput').value,'');assert.equal(f.w.document.activeElement,f.el('studioSearchInput'));});
test('API validation is handled without raw server error content',async t=>{const f=await fixture(t);f.handler(url=>url.startsWith('/api/ql/search?')?response({error:'<secret SQL path>'},400):null);await f.submit('one two three four five six seven eight nine');assert.match(f.el('studioSearchStatus').textContent,/eight unique words/);assert.doesNotMatch(f.el('studioSearchStatus').textContent,/SQL/);});
test('pagination keeps server order, retries same offset and honors cap',async t=>{const f=await fixture(t);f.payload(result([row('piece','Z')],{hasMore:true,nextOffset:25}));await f.submit();f.handler(url=>url.includes('offset=25')?response({},500):null);f.el('studioSearchMore').click();await tick();assert.equal(f.buttons().length,1);f.handler(null);f.payload(result([row('clay','A')],{hasMore:true,nextOffset:null,capped:true}));f.el('studioSearchRetry').click();await tick();assert.ok(f.calls.at(-1).url.includes('offset=25'));assert.deepEqual(f.buttons().map(b=>b.querySelector('strong').textContent),['Z','A']);assert.equal(f.el('studioSearchMore').hidden,true);assert.match(f.el('studioSearchStatus').textContent,/1,000.*Narrow/);const n=f.calls.length;f.el('studioSearchMore').click();await tick();assert.equal(f.calls.length,n);});
for(const change of ['account','token','logout','storage','clear','navigate','new-query'])test('late search cannot render after '+change,async t=>{
 const f=await fixture(t);let finish;f.handler(url=>url.startsWith('/api/ql/search?')?new Promise(r=>finish=r):null);await f.submit();const old=finish;
 if(change==='account')f.w.session('b');if(change==='token')f.w.session('a','new-token');if(change==='logout')f.w.logout();if(change==='storage'){f.w.localStorage.setItem('mudlog_token','other');f.w.dispatchEvent(new f.w.StorageEvent('storage',{key:'mudlog_token'}));}if(change==='clear')f.el('studioSearchClear').click();if(change==='navigate')f.w.navigate('contacts');if(change==='new-query'){f.handler(null);f.payload(result([row('clay','NEW')]));await f.submit('new');}
 old(response(result([row('piece','LATE SECRET')])));await tick();assert.doesNotMatch(f.el('studioSearchResults').textContent,/LATE SECRET/);if(change!=='new-query')assert.equal(f.buttons().length,0);
});
for(const change of ['account','token','logout','back','different-record'])test('late canonical read cannot render after '+change,async t=>{
 const f=await fixture(t);f.payload(result([row('contact')]));await f.submit();let finish;f.handler(url=>url==='/api/contacts/x'?new Promise(r=>finish=r):null);f.buttons()[0].click();await tick();
 if(change==='account')f.w.session('b');if(change==='token')f.w.session('a','new-token');if(change==='logout')f.w.logout();if(change==='back')f.w.StudioSearch.back();if(change==='different-record'){f.handler(null);await f.w.StudioSearch.open('event','x');}
 finish(response({...f.record,name:'LATE SECRET'}));await tick();assert.doesNotMatch(f.el('studioSearchDetail').textContent,/LATE SECRET/);
});
test('401 invalidates results, detail and in-flight state',async t=>{const f=await fixture(t);await f.submit();f.handler(url=>url==='/api/pieces/x'?response({},401):null);f.buttons()[0].click();await tick();assert.equal(f.buttons().length,0);assert.equal(f.el('studioSearchDetail').textContent,'');assert.match(f.el('studioSearchStatus').textContent,/session has expired/);});
test('canonical route refresh reauthorizes without any search metadata',async t=>{const f=await fixture(t);f.w.StudioSearch.restore('studioSearch/contact/x');await tick();assert.match(f.el('studioSearchDetail').textContent,/Fresh canonical name/);assert.ok(f.calls.some(c=>c.url==='/api/contacts/x'));});
test('browser Back clears detail and restores results; Forward reads fresh',async t=>{const f=await fixture(t);f.payload(result([row('contact')]));await f.submit();f.buttons()[0].click();await tick();f.w.history.back();await tick();await tick();assert.ok(f.el('pageStudioSearch').classList.contains('active'));assert.equal(f.el('studioSearchDetail').textContent,'');f.record.name='Renamed';f.w.history.forward();await tick();await tick();assert.match(f.el('studioSearchDetail').textContent,/Renamed/);});
test('new account never reuses existing results or selected detail',async t=>{const f=await fixture(t);f.payload(result([row('contact')]));await f.submit();f.buttons()[0].click();await tick();f.w.session('b');f.w.StudioSearch.syncSession();assert.equal(f.buttons().length,0);assert.equal(f.el('studioSearchDetail').textContent,'');assert.equal(f.el('studioSearchInput').value,'');});
test('entitlement revoked between preflight and canonical Tile fetch purges results',async t=>{const f=await fixture(t);f.payload(result([row('test-tile')]));await f.submit();let reads=0;f.handler(url=>url==='/api/test-tiles/x'&&++reads===2?response({},403):null);f.buttons()[0].click();await tick();await tick();assert.equal(f.buttons().length,0);assert.match(f.el('testTileViewBody').textContent,/locked/);assert.doesNotMatch(f.el('testTileViewBody').textContent,/Fresh canonical/);assert.doesNotMatch(f.el('studioSearchStatus').textContent,/1 results/);});
test('pricing response without owner field relies on canonical owner-scoped route',async t=>{const f=await fixture(t);f.payload(result([row('pricing')]));await f.submit();delete f.record.user_id;f.buttons()[0].click();await tick();assert.match(f.el('studioSearchDetail').textContent,/Price Breakdown/);});
test('modal close clears detail and returns to Search',async t=>{const f=await fixture(t);f.payload(result([row('clay')]));await f.submit();f.buttons()[0].click();await tick();f.w.closeModal('clayViewModal');assert.equal(f.el('clayViewBody').textContent,'');assert.ok(!f.el('clayViewModal').classList.contains('open'));assert.ok(f.el('pageStudioSearch').classList.contains('active'));});

test('assistant query bridge opens Search, filters and renders saved results',async t=>{
 const f=await fixture(t);f.payload(result([row('test-tile','Underglaze tile')]));
 f.w.navigate('firings');f.w.StudioSearch.runQuery('underglaze','test-tile');await tick();
 assert.ok(f.el('pageStudioSearch').classList.contains('active'));assert.equal(f.el('studioSearchInput').value,'underglaze');
 assert.equal(f.el('studioSearchType').value,'test-tile');assert.match(f.el('studioSearchResults').textContent,/Underglaze tile/);
 assert.ok(f.calls.some(c=>c.url.includes('q=underglaze')&&c.url.includes('types=test-tile')));
});
test('assistant record bridge opens actual latest firing viewer through canonical reads',async t=>{
 const f=await fixture(t);f.w.navigate('firings');await f.w.StudioSearch.open('firing','x');await tick();
 assert.ok(f.calls.some(c=>c.url==='/api/firing-logs/x'));
 assert.match(f.el('firingViewBody').textContent,/Fresh canonical kiln/);
 assert.match(f.w.location.hash,/studioSearch\/firing\/x/);
});
