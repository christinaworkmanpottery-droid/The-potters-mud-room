// Real responsive History checks. Browser setup failures must fail this gate.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 let browser;
 try {
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8'),style=fs.readFileSync(path.join(root,'public/style.css'),'utf8'),start=app.indexOf('function historyElement'),end=app.indexOf('async function loadPieceHistory');
 assert.ok(start>=0&&end>start,'History renderer source located');const historySource=app.slice(start,end);
 const fixture='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+style+'</style></head><body><main id="host" style="max-width:1000px;margin:auto;padding:16px"></main><script>let pieceViewGeneration=1,token="fixture",currentUser={id:"fixture"},currentPage="pieceDetail";window._currentPieceId="fixture-piece";</script><script>'+historySource+'</script><script>'+
 `const c=document.createElement('section');c.className='card piece-history';c.id='pieceHistory';document.getElementById('host').append(c);const long='Very long pottery record label '.repeat(12);const e=(recordType,id,name,date,extra={})=>({recordType,sourceRecordId:id,recordedAt:date,relationshipDate:null,manualLabel:name,values:{name,...extra}});
 const data={clay:e('clay','clay',long,'2026-01-01',{brand:'Studio Clay'}),glazeLayers:[e('glaze-layer','g1','Hand mixed custom glaze',null,{layer:{coats:3,application_method:'brush',notes:long},glaze:null})],photos:[],history:[]};
 for(let i=0;i<36;i++)data.history.push(e(i%4===0?'firing':i%4===1?'test-tile':i%4===2?'pricing':'sale','r'+i,long+(i+1),i%7===0?null:'2026-02-'+String((i%28)+1).padStart(2,'0'),i%4===0?{firing_type:'glaze',cone:'6',results:long}:i%4===3?{price:75}:{}));
 renderPieceHistory(c,data);const retry=document.createElement('button');retry.className='btn btn-secondary btn-sm';retry.textContent='Try again';retry.type='button';c.append(retry);const cr=c.getBoundingClientRect(),br=retry.getBoundingClientRect();document.title=JSON.stringify({vw:innerWidth,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,historyRight:Math.ceil(cr.right),retryH:Math.ceil(br.height),headings:[...c.querySelectorAll('h2,h3')].map(x=>x.textContent),last:c.querySelectorAll('li').length});`+
 '</script></body></html>';

 for(const [name,width,height] of [['desktop',1280,900],['iphone-narrow',390,844]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:width<500,hasTouch:width<500});
  try {
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.abort());
   await page.setContent(fixture);
   assert.deepEqual(errors,[],'History renderer has no browser errors');
   const data=JSON.parse(await page.title());
   assert.equal(data.vw,width);
   assert.ok(data.scrollWidth<=data.clientWidth,`${name} horizontal overflow`);
   assert.ok(data.historyRight<=data.clientWidth,`${name} History exceeds viewport`);
   assert.ok(data.retryH>=44,`${name} retry touch target`);
   assert.equal(data.headings[0],'Connected History');
   for(const h of ['Clay','Glaze layers','Firings','Test Tiles','Pricing','Sales'])assert.ok(data.headings.includes(h),h);
   assert.equal(data.last,38);
   console.log('PASS Phase 2C Chromium '+name+' responsive History');
  } finally {await context.close();}
 }
 }finally{await browser?.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
