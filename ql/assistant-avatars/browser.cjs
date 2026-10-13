'use strict';
// Real mobile WebKit rendering and real local HTTP/SQLite. Speech callbacks are
// simulated: this does not certify physical iPhone microphone/audio behavior.
const {webkit,devices}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const fixture=require('../assistant-voice-validation/fixture.cjs');
(async()=>{let browser;
try {
 await fixture.start('1','1','1','1');
 const {base,token,db}=fixture.state;
 browser=await webkit.launch();
 const context=await browser.newContext({...devices['iPhone 13']});
 await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await context.addInitScript(token=>{
  localStorage.setItem('mudlog_token',token);
  window.testEngines=[];
  window.webkitSpeechRecognition=class {
   constructor(){window.testEngines.push(this)} start(){this.onstart?.();this.onaudiostart?.()}
   abort(){} stop(){this.onend?.()}
   result(text){this.onresult?.({resultIndex:0,results:[{isFinal:true,0:{transcript:text,confidence:1}}]});this.onend?.()}
  };
  window.SpeechSynthesisUtterance=class {constructor(text){this.text=text}};
  Object.defineProperty(window,'speechSynthesis',{value:{getVoices:()=>[],cancel(){},speak(u){window.testSpeech=u;u.onstart?.()}}});
 },token);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#qlAssistant');
 await page.locator('.clayton-stage img').waitFor({state:'visible'});
 const names=['Bag of Clay','Studio Bowl','Pottery Buddy','Studio Pebble','Moon & Stars','Microphone'];
 const ids=['bag','bowl','buddy','pebble','moon','microphone'];
 for(let i=0;i<names.length;i++){
  await page.getByRole('button',{name:'Select '+names[i],exact:true}).click();
  await page.waitForFunction(name=>{const im=document.querySelector('.clayton-stage img');return im.alt===name&&im.complete&&im.naturalWidth>0},names[i]);
  await page.getByText('Saved to your account.',{exact:true}).waitFor();
  assert.equal(db.prepare("SELECT clayton_avatar FROM users WHERE id='a'").get().clayton_avatar,ids[i]);
 }
 await page.reload();await page.locator('.clayton-stage img[alt="Microphone"]').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');
 await page.locator('#clayton-hear').click();await page.locator('.clayton-stage[data-state=speaking]').waitFor();
 await page.evaluate(()=>window.testSpeech.onend());await page.locator('.clayton-stage[data-state=idle]').waitFor();
 await page.locator('#clayton-start').click();await page.locator('.clayton-stage[data-state=listening]').waitFor();
 await page.evaluate(()=>window.testEngines.at(-1).onerror({error:'not-allowed'}));
 await page.locator('.clayton-stage[data-state=error]').waitFor();
 assert.match(await page.locator('#clayton-feedback').textContent(),/Permission denied/);
 const send=async text=>{
  await page.locator('#qlAssistantInput').fill(text);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/ql/assistant/turn'));
  await page.locator('#qlAssistantForm button[type=submit]').click();await response;
  await page.waitForFunction(()=>document.getElementById('qlAssistantForm').getAttribute('aria-busy')==='false');
 };
 await send('Add a studio note that Avatar verification B-Mix cone 6');
 await send('save draft');await page.locator('.clayton-dock-avatar[data-state=success]').waitFor({state:'visible'});
 assert.ok(db.prepare("SELECT body FROM studio_notes WHERE user_id='a'").all().some(n=>n.body.includes('Avatar verification')));
 await page.evaluate(()=>navigate('qlAssistant'));
 await page.locator('#clayton-stop').click();await page.locator('.clayton-stage[data-state=idle]').waitFor();
 fs.mkdirSync('test-results',{recursive:true});
 await page.locator('.clayton-avatars').screenshot({path:'test-results/clayton-mobile-webkit.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: mobile WebKit; all six decoded images and taps; saved preference after reload; no overflow; simulated speech/permission callbacks; real HTTP note save; Stop; zero page errors. Physical iPhone microphone and audio not tested.');
} finally {await browser?.close();await fixture.stop();}
})().catch(e=>{console.error(e);process.exitCode=1});
