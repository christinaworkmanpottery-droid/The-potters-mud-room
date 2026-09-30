'use strict';
const {JSDOM}=require('jsdom'),{fs,path,assert,request}=require('./core.cjs');
const wait=()=>new Promise(r=>setTimeout(r,20));
module.exports=async function browser(server,a,b){
 const w=new JSDOM(fs.readFileSync(path.join(server.dir,'public/index.html'),'utf8'),{url:server.base,runScripts:'outside-only'}).window;
 try{w.scrollTo=()=>{};w.setInterval=()=>0;w.confirm=()=>true;let n=0;w.URL.createObjectURL=()=>`blob:synthetic-${++n}`;w.URL.revokeObjectURL=()=>{};w.fetch=async()=>({ok:true,json:async()=>({})});
 w.eval(fs.readFileSync(path.join(server.dir,'public/website-utils.js'),'utf8'));w.eval(fs.readFileSync(path.join(server.dir,'public/app.js'),'utf8')+"\nwindow.syntheticSession=(t,id)=>{token=t;currentUser={id,tier:'starter'};currentPage='pieceDetail';};");await wait();w.syntheticSession(a,'a');
 w.api=async(url,options={})=>{assert.ok(!options.method||options.method==='GET','Read-only browser test');const r=await request(server,url,a);if(r.status!==200)throw Error('HTTP '+r.status);return r.data;};
 const fetchLive=(url,options={})=>{assert.ok(!options.method||options.method==='GET');return fetch(new URL(url,server.base),{...options,headers:{Authorization:'Bearer '+a,...options.headers}});};w.fetch=fetchLive;
 await w.viewPiece('piece-a');for(let i=0;i<100&&!w.document.getElementById('pieceClayView');i++)await wait();const clay=w.document.getElementById('pieceClayView');assert.ok(clay);const launchers=[...w.document.querySelectorAll('[data-piece-glaze-index] button')];assert.equal(launchers.length,3);assert.equal(w.document.querySelectorAll('[data-piece-glaze-index]').length,5);
 clay.click();for(let i=0;i<100&&!w.document.getElementById('clayViewBody').querySelector('img');i++)await wait();assert.ok(w.document.getElementById('clayViewBody').querySelector('img'));for(const control of ['Edit','Duplicate','Photo'])assert.equal(w.document.getElementById('clayView'+control+'Btn').disabled,true);w.closeModal('clayViewModal');
 launchers[0].click();for(let i=0;i<100&&!w.document.getElementById('glazeViewBody').querySelector('img');i++)await wait();assert.ok(w.document.getElementById('glazeViewBody').querySelector('img'));for(const control of ['Edit','Duplicate','Photo'])assert.equal(w.document.getElementById('glazeView'+control+'Btn').disabled,true);w.closeModal('glazeViewModal');
 let release;w.fetch=async(url,options)=>{const response=await fetchLive(url,options);if(url==='/api/glazes')return new Promise(resolve=>{release=()=>resolve(response)});return response;};launchers[1].click();for(let i=0;i<100&&!release;i++)await wait();assert.ok(release);w.syntheticSession(b,'b');w.clearGlazeMedia();release();await wait();assert.equal(w.document.getElementById('glazeViewBody').querySelector('img'),null);
 w.syntheticSession(a,'a');w.fetch=fetchLive;await w.viewPiece('manual');await wait();assert.equal(w.document.getElementById('pieceClayView'),null);assert.equal(w.document.querySelectorAll('[data-piece-glaze-index] button').length,0);
 }finally{w.close();}
};
