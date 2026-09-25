const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8'), { url:'http://localhost/', runScripts:'outside-only', pretendToBeVisual:true });
const w = dom.window;
const calls = [];
const notes = [];
let sales = [{id:'sale-1', price:1.50, quantity:2, item_description:'Mini dish', date:'2026-09-25', image_filename:'first.png'}];
let combos = [{ id:'combo-1', name:'Two photo test', photo_filename:'one.png', photo_filename2:'two.png', layers:[{glaze_name:'Test glaze',coats:2,application_method:'brush'}],is_shared:1 }];
const user = {id:'user-1',email:'fixture@example.com',tier:'starter',isAdmin:true,display_name:'Fixture',country:'United States',findable:0,is_private:1};
w.localStorage.setItem('mudlog_token', 'test-token');
w.scrollTo=()=>{}; w.HTMLElement.prototype.scrollIntoView=()=>{};
w.URL.createObjectURL=()=> 'blob:test-photo';w.URL.revokeObjectURL=()=>{};
w.setInterval=()=>0;
w.fetch=async (url, opts={})=>{
  const method=opts.method || 'GET'; const body=opts.body instanceof w.FormData ? Object.fromEntries(opts.body.entries()) : opts.body ? JSON.parse(opts.body) : {};
  calls.push({url,method,body});
  let data={};
  if(url==='/api/auth/me') data={user};
  else if(url==='/api/dashboard') data={totalPieces:0,totalClays:0,totalGlazes:0,sales:{total:3},recentPieces:[],statusCounts:[]};
  else if(url==='/api/studio/notes' && method==='POST'){data={id:'note-1',...body};notes.push(data);}
  else if(url==='/api/studio/notes/note-1' && method==='PUT'){Object.assign(notes[0],body);data=notes[0];}
  else if(url==='/api/studio/notes') data=notes;
  else if(url.startsWith('/api/sales') && method==='GET') data=sales;
  else if(url==='/api/sales/sale-1' && method==='PUT'){Object.assign(sales[0], { quantity:Number(body.quantity),price:Number(body.price)});data={id:'sale-1'};}
  else if(url==='/api/community/combos/combo-1' && method==='PUT'){data={id:'combo-1'};}
  else if(url.startsWith('/api/community/combos')) data=combos;
  else if(url.startsWith('/api/pieces')) data=[];
  else if(url==='/api/blog/posts') data=[{id:'blog-1',slug:'test-post',title:'Test post',content:'Test content'}];
  else if(url==='/api/blog/posts/test-post') data={id:'blog-1',slug:'test-post',title:'Test post',content:'Test content'};
  else if(url==='/api/profile/member-1') data={user:{id:'member-1',display_name:'Member',website:'ChristinaWorkmanPottery.com'}};
  else if(url==='/api/shopping-list') data={clays:[],glazes:[],custom:[]};
  else if(/clay-bodies|glazes|stores|reviews|notifications|events|featured|comments/.test(url)) data=[];
  return {ok:true,status:200,json:async()=>data};
};
w.eval(fs.readFileSync(path.join(__dirname,'../public/website-utils.js'),'utf8'));
w.eval(fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8'));
const pause=()=>new Promise(r=>setTimeout(r,30));
const field=id=>w.document.getElementById(id);
async function test(name, fn){await fn();console.log('PASS',name);}
(async()=>{
 await pause();
 await test('shared badge maps authenticated admin and Unlimited account', async()=>{
   assert.equal(field('navTier').textContent,'ADMIN');
   assert.equal(w.WebsiteUtils.accountLabel({tier:'starter'}),'Unlimited');
   assert.equal(w.WebsiteUtils.accountLabel({tier:'free'}),'Free');
 });
 await test('note create then repeated edit keeps one record and re-enables Save',async()=>{
   w.openStudioNoteModal();field('studioNoteBody').value='First';
   await w.saveStudioNote({preventDefault(){},target:field('studioNoteForm')});
   w.openStudioNoteModal(notes[0]);field('studioNoteBody').value='Updated';
   await w.saveStudioNote({preventDefault(){},target:field('studioNoteForm')});
   w.openStudioNoteModal(notes[0]);field('studioNoteBody').value='Updated again';
   await w.saveStudioNote({preventDefault(){},target:field('studioNoteForm')});
   assert.equal(notes.length,1);assert.equal(notes[0].body,'Updated again');
   assert.equal(field('studioNoteForm').querySelector('[type=submit]').disabled,false);
 });
 await test('sales details versus Edit, exact cents, quantity and saved photo',async()=>{
   w.navigate('sales');await pause();
   assert.match(field('salesList').innerHTML,/viewSale/);assert.match(field('salesList').textContent,/\$3\.00/);
   await w.viewSale('sale-1');assert.match(field('saleDetailsContent').textContent,/1\.50/);
   field('saleDetailsEdit').click();await pause();assert.equal(field('saleQuantity').value,'2');
   assert.match(field('salePhotoPreview').innerHTML,/first.png/);
   await w.saveSale({preventDefault(){},target:field('saleForm')});
   assert.equal(sales.length,1);assert.equal(sales[0].quantity,2);assert.equal(sales[0].price,1.5);
 });
 await test('combo edit preserves id and photo slots, guards double submit',async()=>{
   w.editCombo('combo-1');await pause();
   const file=new w.File(['image'],'new.png',{type:'image/png'});
   w.setComboPhoto(1,{files:[file]});
   const event={preventDefault(){},target:field('comboForm')};
   await Promise.all([w.saveCombo(event),w.saveCombo(event)]);
   const writes=calls.filter(c=>c.url==='/api/community/combos/combo-1' && c.method==='PUT');
   assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].body.photoSlots),['one.png',0]);
   assert.equal(JSON.parse(writes[0].body.layers)[0].method,'brush');
   assert.equal(field('comboId').value,'combo-1');
 });
 await test('two photos accumulate and excess selections are rejected visibly',async()=>{
   w.openComboModal();
   w.addComboPhotos({files:[new w.File(['a'],'a.png')],value:'a'});
   w.addComboPhotos({files:[new w.File(['b'],'b.png')],value:'b'});
   assert.equal(field('comboPhotoSlots').querySelectorAll('img').length,2);
   w.addComboPhotos({files:[new w.File(['c'],'c.png')],value:'c'});
   assert.equal(field('comboPhotoSlots').querySelectorAll('img').length,2);
 });
 await test('Dashboard Back and Blog Back do not rewrite history or loop',async()=>{
   w.navigate('dashboard');w.navigate('studioNotes');
   w.history.back();await pause();assert.equal(w.location.hash,'#dashboard');
   assert.ok(field('pageDashboard').classList.contains('active'));
   w.navigate('pieces'); w.history.back(); await pause();
   assert.equal(w.location.hash,'#dashboard'); assert.ok(field('pageDashboard').classList.contains('active'));
   w.navigate('blog');await pause();const before=w.history.length;
   await w.viewBlogPost('test-post');await pause();
   assert.equal(w.history.length,before+1);assert.equal(w.location.hash,'#blog/test-post');
   assert.equal(calls.filter(c=>c.url==='/api/blog/posts/test-post').length,1);
   w.history.back();await pause();assert.equal(w.location.hash,'#blog');assert.ok(field('pageBlog').classList.contains('active'));
   w.history.forward();await pause();assert.equal(w.location.hash,'#blog/test-post');
   assert.equal(calls.filter(c=>c.url==='/api/blog/posts/test-post').length,2);
 });
 await test('external member link is absolute; blank and malformed URLs handled',async()=>{
   await w.viewMemberProfile('member-1');
   assert.equal(field('memberProfileContent').querySelector('a').href,'https://christinaworkmanpottery.com/');
   for(const value of ['amazon.com','www.amazon.com','https://amazon.com']) assert.match(w.fixUrl(value),/^https:\/\//);
   assert.equal(w.fixUrl(''),null);assert.equal(w.fixUrl('javascript:alert(1)'),null);
 });
 await test('Help jumps to settings without opting user in; Casualty preselected',async()=>{
   w.openFindPotterSettings();await pause();assert.equal(w.location.hash,'#profile/find-potter');
   assert.equal(field('profileFindable').checked,false);assert.equal(field('profilePrivate').checked,true);
   w.navigate('casualties');w.openCasualtyModal();assert.equal(field('pieceStatus').value,'broken');
 });
 await test('preview keeps real account and credentials separate',async()=>{
   w.navigate('sales');w.showGuestPreview();assert.equal(field('previewPage').style.display,'block');
   assert.equal(w.localStorage.getItem('mudlog_token'),'test-token');
   assert.ok(field('mainApp').classList.contains('hidden'));
   w.exitPreviewToLanding();assert.equal(w.location.hash,'#sales');assert.equal(field('navTier').textContent,'ADMIN');
 });
 await test('root asset URLs survive nested paths; Help has only Mud Room links',async()=>{
   assert.equal(w.document.querySelector('link[href*="style.css"]').getAttribute('href'),'/style.css?v=20260925');
   assert.ok(w.document.querySelector('script[src="/app.js?v=20260925"]'));
   assert.equal(field('pageHelp').querySelectorAll('a[href*="lucehealing"],a[href*="christinaworkmanpottery"]').length,0);
 });
 await pause(); dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1});
