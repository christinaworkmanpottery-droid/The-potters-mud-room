const fs=require('fs'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{const browser=await chromium.launch({headless:true,args:['--no-sandbox']});try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
const src=fs.readFileSync('public/app.js','utf8'),html=fs.readFileSync('public/index.html','utf8');
await page.setContent(html.slice(html.indexOf('<div id="pageVisualSearch"'),html.indexOf('<div id="pageContacts"')));
await page.addScriptTag({content:`let token='A'; let opened=[]; let requests=[]; let fail=false;
function esc(x){return String(x)} function pieceEdgePhotoAttrs(){return ''} async function loadPieceEdgeMedia(){} async function viewPiece(id,options){if(options.active())opened.push(id)}
window.fetch=async(u,o)=>{requests.push(o.body.get('photo').name);if(fail)throw Error('offline');return{ok:true,json:async()=>({matches:[{id:'correct-piece',title:'Test Piece',photos:[]}]})}};
`+src.slice(src.indexOf('let pieceEdgeGeneration ='),src.indexOf('function pieceEdgePhotoAttrs'))+src.slice(src.indexOf('async function runVisualSearch('),src.indexOf('\nasync function loadContacts()',src.indexOf('async function runVisualSearch(')))});
let checks=0;
for(const key of ['Enter','Space']){await page.locator('#visualSearchChoose').focus();const pending=page.waitForEvent('filechooser');await page.keyboard.press(key);const chooser=await pending;await chooser.setFiles({name:'query.jpg',mimeType:'image/jpeg',buffer:Buffer.from('synthetic')});await page.locator('button.card').waitFor();await page.locator('button.card').focus();await page.keyboard.press(key);assert.equal(await page.evaluate(()=>opened.at(-1)),'correct-piece');checks+=2;}
await page.locator('button.card').click();assert.equal(await page.evaluate(()=>opened.length),3);checks++;
await page.evaluate(()=>{fail=true;return runVisualSearch({files:[new File(['B'],'current.jpg',{type:'image/jpeg'})]})});
await page.evaluate(()=>{fail=false});await page.locator('#visualSearchRetry').focus();await page.keyboard.press('Space');await page.locator('button.card').waitFor();assert.equal(await page.evaluate(()=>requests.at(-1)),'current.jpg');checks++;
assert.deepEqual(errors,[]);checks++;
console.log(JSON.stringify({browser:'Chromium',passed:checks,failed:0,checks:'Enter/Space picker and result; click result; keyboard retry; no runtime errors'}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
