const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const browserPackage=process.env.BILLING_CHROMIUM_PACKAGE;
(async()=>{
 const launch=browserPackage?await import(browserPackage):null;
 const engine=launch?.default;
 const browser=await chromium.launch(engine?{executablePath:await engine.executablePath(),args:engine.args,headless:true}:{headless:true});
 try{
  const page=await browser.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:844});
   await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><main style="max-width:1000px;margin:auto;padding:12px"><div id="adminContent"></div></main>');
   await page.addStyleTag({content:fs.readFileSync(path.join(__dirname,'../public/style.css'),'utf8')});
   await page.evaluate(()=>{
    window.currentUser={isAdmin:true};window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));window.loadAdmin=()=>{};
    window.apiCalls=[];
    window.api=async(path,opts)=>{window.apiCalls.push({path,opts});return {checkedAt:new Date().toISOString(),stats:{byTier:{paid:1,gifted:2,free:3,review:1},paidCountVerifiedByStripe:true},members:[],discrepancies:[],pendingEvents:[],payments:[{id:'ch_synthetic_long_reference_12345678901234567890',name:'Synthetic Member <img src=x onerror=alert(1)>',email:'member@potter.test',product:'Unlimited Plan — $69.50/year',status:'succeeded',createdAt:'2026-10-14T14:30:53Z',gross:6950,fee:232,net:6718,refunded:0,currency:'usd',subscriptionStatus:'active',renewalDate:'2027-10-14T14:30:51Z',expirationDate:'2027-10-14T14:30:51Z',payoutStatus:'paid',depositDate:'2026-10-16'}],invoices:[],subscriptions:[],payouts:[]};};
   });
   await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../public/billing-admin.js'),'utf8')});
   await page.evaluate(()=>showPaymentsRevenue());
   assert.equal(await page.locator('#billingHistory article').count(),1);assert.equal(await page.locator('#billingHistory img').count(),0);
   await page.locator('article summary').click();
   assert.ok(await page.locator('article').innerText().then(t=>t.includes('$69.50')&&t.includes('$2.32')&&t.includes('$67.18')));
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: no horizontal overflow`);
   await page.locator('#billingSearch').fill('absent');assert.equal(await page.locator('article').count(),0);
   await page.locator('#billingSearch').fill('member');assert.equal(await page.locator('article').count(),1);
   await page.locator('#billingStatus').selectOption('failed');assert.equal(await page.locator('article').count(),0);
   await page.getByRole('button',{name:'Refresh from Stripe'}).click();
   assert.ok(await page.evaluate(()=>apiCalls.some(c=>c.opts.method==='POST'&&c.path.endsWith('/reconcile'))));
   assert.deepEqual(errors,[]);
   if(width===390)await page.screenshot({path:'/tmp/billing-mobile.png',fullPage:true});
   console.log('PASS payment UI at '+width+'px: search, filters, refresh, escaped customer text, expandable details and no overflow');

  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
