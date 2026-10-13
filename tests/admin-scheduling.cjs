const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mudroom-admin-'));let child;
const base='http://127.0.0.1:31991';let token;
async function api(route,method='GET',body,authenticated=true){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(r.status+': '+data.error);return data;}
(async()=>{for(const f of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js'])fs.copyFileSync(path.join(root,f),path.join(tmp,f));for(const f of ['lib','geodata','content'])fs.cpSync(path.join(root,f),path.join(tmp,f),{recursive:true});for(const f of ['public','node_modules'])fs.symlinkSync(path.join(root,f),path.join(tmp,f),'dir');
 const password=require('crypto').randomBytes(20).toString('hex');let output='';child=spawn(process.execPath,['server.js'],{cwd:tmp,env:{...process.env,PORT:'31991',PREVIEW_MODE:'true',PREVIEW_ADMIN_EMAIL:'admin-preview@example.invalid',PREVIEW_ADMIN_PASSWORD:password,JWT_SECRET:'local-disposable-test-secret'}});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 for(let i=0;i<100;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,100));}if(i===99)throw Error(output);}
 const login=await api('/api/auth/login','POST',{email:'admin-preview@example.invalid',password},false);token=login.token;assert.equal(login.user.isAdmin,true);
 const drafts=await api('/api/admin/blog/posts');assert.equal(drafts.filter(p=>!p.is_published&&/^(beginner-prevent|intermediate-fix|advanced-pottery)/.test(p.slug)).length,3);
 const body={title:'Scheduling test',slug:'scheduling-test',excerpt:'Test',content:'<p>Test content</p>',isPublished:false};
 const post=await api('/api/admin/blog/posts','POST',body);await api('/api/admin/blog/posts/'+post.id,'PUT',{...body,title:'Edited',scheduledAt:new Date(Date.now()+60000).toISOString()});
 assert(!(await api('/api/blog/posts', 'GET',null,false)).some(p=>p.id===post.id));
 await api('/api/admin/blog/posts/'+post.id,'PUT',body);assert.equal((await api('/api/admin/blog/posts')).find(p=>p.id===post.id).scheduled_at,null);
 await api('/api/admin/blog/posts/'+post.id,'PUT',{...body,isPublished:true});assert((await api('/api/blog/posts','GET',null,false)).some(p=>p.id===post.id));
 const eligibility=await api('/api/admin/email-campaigns/eligibility');assert.equal(eligibility.preview,true);assert.deepEqual(eligibility.recipients,[{email:'subscriber@example.invalid'}]);
 const draft=await api('/api/admin/email-campaigns','POST',{subject:'Test',html:'<p>Email</p>'});
 await api('/api/admin/email-campaigns/'+draft.id,'PUT',{subject:'Edited test',html:'<p>Edited</p>'});await api('/api/admin/email-campaigns/'+draft.id+'/test','POST',{});
 await assert.rejects(api('/api/admin/email-campaigns/'+draft.id+'/send','POST',{recipientCount:1}),/confirmation/);
 await api('/api/admin/email-campaigns/'+draft.id+'/send','POST',{confirm:true,recipientCount:1});await assert.rejects(api('/api/admin/email-campaigns/'+draft.id+'/send','POST',{confirm:true,recipientCount:1}),/Only a draft/);
 const scheduled=await api('/api/admin/email-campaigns','POST',{subject:'Scheduled',html:'<p>Later</p>',scheduledAt:new Date(Date.now()+120000).toISOString(),recipientCount:1});
 await api('/api/admin/email-campaigns/'+scheduled.id,'PUT',{cancel:true});assert.equal((await api('/api/admin/email-campaigns')).find(c=>c.id===scheduled.id).status,'cancelled');
 const outbox=await api('/api/admin/email-campaigns/outbox');assert.equal(outbox.length,2);assert(outbox.every(x=>x.recipient.endsWith('@example.invalid')));
 // DST round trips in the actual client helpers.
 const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');const helpers=app.slice(app.indexOf('function pacificInputValue('),app.indexOf('let editingCampaignId'));
 const vm=require('vm'),ctx={Intl,Date};vm.createContext(ctx);vm.runInContext(helpers,ctx);
 assert.equal(ctx.pacificInputValue('2030-01-15T18:00:00Z'),'2030-01-15T10:00');assert.equal(ctx.pacificInputValue('2030-07-15T17:00:00Z'),'2030-07-15T10:00');
 assert.equal(ctx.pacificScheduleISO('2030-01-15T10:00'),'2030-01-15T10:00:00-08:00');assert.equal(ctx.pacificScheduleISO('2030-07-15T10:00'),'2030-07-15T10:00:00-07:00');assert.throws(()=>ctx.pacificScheduleISO('2030-03-10T02:30'),/does not exist/);
 const {JSDOM}=require('jsdom');
 const dom=new JSDOM(fs.readFileSync(path.join(root,'public/index.html'),'utf8'),{url:base+'/#admin',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window;w.localStorage.setItem('mudlog_token',token);w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.setInterval=()=>0;
 w.fetch=(url,opts)=>fetch(new URL(url,base),opts);w.eval(fs.readFileSync(path.join(root,'public/website-utils.js'),'utf8'));w.eval(fs.readFileSync(path.join(root,'public/app.js'),'utf8'));
 await new Promise(r=>setTimeout(r,300));await w.loadAdmin();await w.loadAdminBlogPosts();await w.loadAdminEmailCampaigns();assert(w.document.getElementById('campaignSubject'));assert(w.document.getElementById('adminBlogList').textContent.includes('Prevent')||w.document.getElementById('adminBlogList').textContent.length>50);
 w.openBlogPostEditor();assert.deepEqual([...w.document.querySelectorAll('#blogEditorOverlay input[type=text],#blogEditorOverlay textarea')].map(e=>e.id),['blogEdTitle','blogEdSlug','blogEdExcerpt','blogEdContent']);
 w.document.getElementById('blogEdTitle').value='Client preview';w.document.getElementById('blogEdContent').value='<p>Unsaved preview</p>';w.previewBlogEditor();assert(w.document.querySelector('#campaignPreviewOverlay iframe').srcdoc.includes('Unsaved preview'));
 w.document.getElementById('campaignPreviewOverlay').remove();w.document.getElementById('blogEditorOverlay').remove();await w.editCampaign(draft.id);assert.equal(w.document.getElementById('campaignSubject').value,'Edited test');dom.window.close();
 console.log('PASS admin integration: actual login/permissions, three preserved drafts, blog create/edit/schedule/cancel/publish, email edit/test/send/duplicate protection/cancel/capture, Pacific DST');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{child?.kill();setTimeout(()=>process.exit(process.exitCode||0),100);});
