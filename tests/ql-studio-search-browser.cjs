'use strict';
// Engineering layout/keyboard smoke; APIs are synthetic. Real authorization is
// exercised separately by ql-studio-search-http.cjs. No external requests allowed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../public');
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=pathname==='/'?'index.html':pathname.slice(1);
  if(!['index.html','app.js','studio-search.js','style.css','website-utils.js'].includes(file)){res.writeHead(404);res.end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,file)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const base='http://127.0.0.1:'+server.address().port;
  for(const [name,width,height] of [['desktop',1280,900],['iphone-width',390,844]]){
   const context=await browser.newContext({viewport:{width,height},isMobile:width<500,hasTouch:width<500});
   await context.addInitScript(()=>localStorage.setItem('mudlog_token','synthetic'));
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.origin!==base){await route.abort();return;}
    if(!u.pathname.startsWith('/api/')){await route.continue();return;}
    let data=[];
    if(u.pathname==='/api/auth/me')data={user:{id:'a',tier:'starter',display_name:'Studio owner'}};
    if(u.pathname==='/api/ql/search')data={results:[{recordType:'contact',sourceRecordId:'c',title:'Celadon '+('studio '.repeat(12)),excerpt:'<img src=x onerror=alert(1)> '+('Saved pottery notes '.repeat(9))}],lockedTypes:['test-tile'],hasMore:false,nextOffset:null,capped:false};
    if(u.pathname==='/api/contacts/c')data={id:'c',user_id:'a',name:'Canonical Contact',notes:'Fresh saved notes'};
    await route.fulfill({json:data});
   });
   await page.goto(base+'/#studioSearch');
   await page.locator('#studioSearchInput').waitFor({state:'visible'});
   await page.locator('#studioSearchInput').fill('celadon');await page.locator('#studioSearchInput').press('Enter');
   await page.locator('.studio-search-result').waitFor();
   assert.equal(await page.locator('#studioSearchResults img').count(),0);
   const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,input:getComputedStyle(document.getElementById('studioSearchInput')).fontSize,targets:[...document.querySelectorAll('#pageStudioSearch button:not([hidden])')].map(x=>x.getBoundingClientRect().height)}));
   assert.equal(metrics.width,width);assert.ok(metrics.scroll<=metrics.client,JSON.stringify(metrics));assert.equal(metrics.input,'16px');assert.ok(metrics.targets.every(h=>h>=44),JSON.stringify(metrics));
   await page.locator('.studio-search-result').focus();const focus=await page.locator('.studio-search-result').evaluate(e=>({style:getComputedStyle(e).outlineStyle,width:getComputedStyle(e).outlineWidth}));assert.notEqual(focus.style,'none');assert.notEqual(focus.width,'0px');
   if(process.env.SEARCH_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SEARCH_SCREENSHOT_DIR,name+'.png'),fullPage:true});
   await page.locator('.studio-search-result').press('Enter');await page.getByRole('heading',{name:'Canonical Contact'}).waitFor();
   await page.getByRole('button',{name:'Back to Search',exact:false}).filter({visible:true}).first().click();
   await page.locator('.studio-search-result').waitFor({state:'visible'});assert.equal(await page.locator('#studioSearchDetail').textContent(),'');
   assert.deepEqual(errors,[]);console.log('PASS Search-2 Chromium '+name+': keyboard, text safety, touch targets, focus, no overflow, canonical read, Back');await context.close();
  }
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
