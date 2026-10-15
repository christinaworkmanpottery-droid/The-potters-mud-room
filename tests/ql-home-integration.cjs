'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const source=f=>fs.readFileSync('public/'+f,'utf8');
const tick=()=>new Promise(r=>setTimeout(r,25));
async function fixture(t){
 const dom=new JSDOM(source('index.html'),{url:'http://localhost/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];
 w.eval=code=>require('node:vm').runInContext(code,dom.getInternalVMContext());
 t.after(async()=>{await tick();w.close();});w.localStorage.setItem('mudlog_token','a-token');w.scrollTo=()=>{};w.setInterval=()=>0;
 w.fetch=async(url,options={})=>{
  calls.push({url,options});let data=[];
  if(url==='/api/auth/me')data={user:{id:'a',tier:'starter'}};
  if(url==='/api/dashboard')data={totalPieces:1,totalClays:2,totalGlazes:3,sales:{total:0},recentPieces:[{id:'real-piece',title:'My saved bowl',status:'wet'}]};
  if(url==='/api/ql/home/preferences')data={images:'minimal'};
  if(url==='/api/ql/voice/preferences')data={style:'neutral',voiceURI:'voice-a',rate:0.8};
  return {ok:true,status:200,json:async()=>data};
 };
 w.eval(source('website-utils.js'));w.eval(source('app.js'));await tick();
 w.eval(source('ql-home.js'));w.eval(source('ql-voice-settings.js'));await tick();
 return {w,calls,el:id=>w.document.getElementById(id)};
}
test('Home uses authenticated records and navigates into existing studio pages',async t=>{
 const f=await fixture(t);f.w.navigate('dashboard');await tick();
 assert.match(f.el('recentPieces').textContent,/My saved bowl/);
 assert.equal(f.el('statPieces').textContent,'1');
 const material=[...f.w.document.querySelectorAll('.ql-studio-grid button')].find(b=>b.textContent.includes('Raw Materials'));f.w.eval(material.getAttribute('onclick'));
 assert.ok(f.el('pageChemicals').classList.contains('active'));
 assert.ok(f.calls.some(c=>c.url==='/api/glaze-chemicals'));
 assert.equal(f.el('ql-home-talk').disabled,true);
});
test('ordered Home preference writes and account switch clear decorative member images',async t=>{
 const f=await fixture(t),select=f.el('ql-home-images');
 for(const value of ['mine','studio','minimal']){select.value=value;select.dispatchEvent(new f.w.Event('change'));}
 await tick();assert.deepEqual(f.calls.filter(c=>c.url==='/api/ql/home/preferences'&&c.options.method==='PUT').map(c=>JSON.parse(c.options.body).images),['mine','studio','minimal']);
 f.w.eval("setAuthToken('b-token');setAuthUser({id:'b',tier:'starter'});QLHome.sync()");await tick();
 assert.equal(select.value,'minimal');assert.equal(f.w.document.querySelectorAll('.ql-studio-grid img').length,0);
 assert.equal(f.calls.filter(c=>c.url==='/api/ql/home/preferences').at(-1).options.headers.Authorization,'Bearer b-token');
});
test('voice preferences apply to real utterances and reset when account changes',async t=>{
 const f=await fixture(t);f.w.speechSynthesis={getVoices:()=>[{voiceURI:'voice-a',name:'A',lang:'en-GB'}]};
 const speech={};f.w.QLVoiceSettings.apply(speech);assert.equal(speech.rate,0.8);assert.equal(speech.voice.voiceURI,'voice-a');assert.equal(speech.lang,'en-GB');
 let preview=0;f.w.QLVoiceSettings.mount(f.el('pageProfile'),()=>preview++);
 f.w.document.querySelector('.ql-voice-settings button').click();assert.equal(preview,1);
 f.w.eval('setAuthToken(null);setAuthUser(null)');const reset={};f.w.QLVoiceSettings.apply(reset);assert.equal(reset.rate,0.96);assert.equal(reset.voice,undefined);
});
