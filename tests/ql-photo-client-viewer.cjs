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


async function lookup(f){f.w.navigate('visualSearch');f.handler((url)=>url==='/api/pieces/photo-search'?response({matches:[{id:'x',title:'Candidate',photos:[]}]}):null);await f.w.runVisualSearch({files:[new f.w.Blob(['image'])]});return f.el('visualSearchResults').querySelector('button');}
test('Photo Lookup opens fresh canonical Piece and preserves Back to Pieces contract',async t=>{const f=await fixture(t),b=await lookup(f);await b.onclick();assert.equal(f.w._currentPieceId,'x');assert.match(f.el('pieceDetailContent').textContent,/Fresh canonical title/);assert.ok(f.calls.some(c=>c.url==='/api/pieces/x'&&c.options.cache==='no-store'));const back=f.el('pagePieceDetail').querySelector('.detail-back');assert.match(back.textContent,/Back to Pieces/);f.w.eval(back.getAttribute('onclick'));await tick();await tick();assert.ok(f.el('pagePieces').classList.contains('active'))});
for(const outcome of ['deleted','foreign','replaced','session'])test('canonical Photo Lookup viewer guards '+outcome,async t=>{const f=await fixture(t),b=await lookup(f);let release;f.handler(url=>url==='/api/pieces/x'?new Promise(r=>release=r):null);const opening=b.onclick();await tick();if(outcome==='session')f.w.session('b');if(outcome==='replaced'){f.handler(url=>url==='/api/pieces/photo-search'?response({matches:[]}):null);await f.w.runVisualSearch({files:[new f.w.Blob(['new'])]})}release(outcome==='deleted'?response({error:'Not found'},404):response({...f.record,user_id:outcome==='foreign'?'b':'a'}));await opening;assert.notEqual(f.w._currentPieceId,'x');assert.equal(f.el('pagePieceDetail').classList.contains('active'),false)});
