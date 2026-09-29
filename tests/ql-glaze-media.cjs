const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'..');
const appSource=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');
let tmp,server,db,base,secret,tokenA,tokenB,log='';
async function start(){
 tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ql-piece-media-'));
 for(const n of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,n),path.join(tmp,n));
 fs.mkdirSync(path.join(tmp,'ql'));for(const n of ['relationships.cjs','piece-history.cjs'])fs.copyFileSync(path.join(root,'ql',n),path.join(tmp,'ql',n));
 fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});for(const n of ['node_modules','public'])fs.symlinkSync(path.join(root,n),path.join(tmp,n),'dir');
 const port=44000+crypto.randomInt(1000);base='http://127.0.0.1:'+port;secret=crypto.randomBytes(32).toString('hex');
 server=spawn(process.execPath,['server.js'],{cwd:tmp,env:{PATH:process.env.PATH,PORT:String(port),JWT_SECRET:secret,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>log+=c);server.stderr.on('data',c=>log+=c);
 for(let i=0;i<120&&!log.includes('running on');i++)await new Promise(r=>setTimeout(r,100));assert.ok(log.includes('running on'),log);
 db=new Database(path.join(tmp,'data/pottery.db'));tokenA=jwt.sign({userId:'a'},secret);tokenB=jwt.sign({userId:'b'},secret);
 db.prepare("INSERT INTO users(id,email,password_hash) VALUES('a','a@example.com','x'),('b','b@example.com','x')").run();
 db.prepare("INSERT INTO pieces(id,user_id,title,is_public) VALUES('private-a','a','Private A',0),('public-a','a','Public A',1),('private-b','b','Private B',0),('ambiguous-a','a','Ambiguous A',NULL)").run();
 db.prepare("INSERT INTO piece_photos(id,piece_id,filename,original_name,stage,sort_order) VALUES('photo-private-a','private-a','private-a.jpg','a.jpg','finished',0),('photo-public-a','public-a','public-a.jpg','p.jpg','finished',0),('photo-private-b','private-b','private-b.jpg','b.jpg','finished',0),('photo-ambiguous-a','ambiguous-a','ambiguous-a.jpg','x.jpg','finished',0)").run();
 const up=path.join(tmp,'data/uploads');for(const n of ['private-a.jpg','public-a.jpg','private-b.jpg','ambiguous-a.jpg'])fs.writeFileSync(path.join(up,n),'fixture-'+n);
}
async function stop(){if(db)db.close();if(server&&server.exitCode===null){const p=new Promise(r=>server.once('exit',r));server.kill();await p}if(tmp)fs.rmSync(tmp,{recursive:true,force:true});}
test.after(stop);
const auth=t=>({Authorization:'Bearer '+t});

const route=(id='ca',photo='pa')=>base+'/api/ql/glazes/'+id+'/photos/'+photo;
test.before(async()=>{
 await start();
 db.prepare("INSERT INTO glazes(id,user_id,name) VALUES('ca','a','Glaze A'),('cb','b','Glaze B')").run();
 db.prepare("INSERT INTO glaze_photos(id,glaze_id,filename) VALUES('pa','ca','glaze-a.jpg'),('pb','cb','glaze-b.jpg')").run();
 for(const n of ['glaze-a.jpg','glaze-b.jpg'])fs.writeFileSync(path.join(tmp,'data/uploads',n),'fixture-'+n);
});
test('Glaze owner receives authenticated bytes with private no-store and nosniff',async()=>{const r=await fetch(route(),{headers:auth(tokenA)});assert.equal(r.status,200);assert.equal(await r.text(),'fixture-glaze-a.jpg');assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');});
test('foreign and missing Glaze photo have identical generic responses',async()=>{const rs=await Promise.all([fetch(route(),{headers:auth(tokenB)}),fetch(route('ca','missing'),{headers:auth(tokenA)}),fetch(route('missing'),{headers:auth(tokenA)})]);for(const r of rs){assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'Photo unavailable'});}});
test('unauthenticated Glaze photo denied',async()=>assert.equal((await fetch(route())).status,401));
test('Glaze list/detail announce owner delivery without inventing historical visibility',async()=>{for(const url of ['/api/glazes']){const r=await fetch(base+url,{headers:auth(tokenA)});const data=await r.json();const glaze=Array.isArray(data)?data[0]:data.glaze;assert.equal(glaze.photoDelivery,'owner-protected');assert.equal(glaze.photoVisibility,'legacy-ambiguous');assert.equal(glaze.photos[0].filename,'glaze-a.jpg');}assert.equal(db.prepare('SELECT filename FROM glaze_photos WHERE id=?').get('pa').filename,'glaze-a.jpg');});
test('cross-account Glaze filename collision fails closed for both owners',async()=>{db.prepare("UPDATE glaze_photos SET filename='glaze-a.jpg' WHERE id='pb'").run();try {assert.equal((await fetch(route(),{headers:auth(tokenA)})).status,404);assert.equal((await fetch(route('cb','pb'),{headers:auth(tokenB)})).status,404);}finally{db.prepare("UPDATE glaze_photos SET filename='glaze-b.jpg' WHERE id='pb'").run();}});
test('foreign non-Glaze reference also prevents protected Glaze delivery',async()=>{db.prepare("UPDATE piece_photos SET filename='glaze-a.jpg' WHERE id='photo-private-b'").run();try{assert.equal((await fetch(route(),{headers:auth(tokenA)})).status,404);}finally{db.prepare("UPDATE piece_photos SET filename='private-b.jpg' WHERE id='photo-private-b'").run();}});
test('unsafe path and symlink never expose filesystem bytes',async()=>{for(const name of ['../pottery.db','linked.jpg']){if(name==='linked.jpg')fs.symlinkSync(path.join(tmp,'data/pottery.db'),path.join(tmp,'data/uploads/linked.jpg'));db.prepare('UPDATE glaze_photos SET filename=? WHERE id=?').run(name,'pa');assert.equal((await fetch(route(),{headers:auth(tokenA)})).status,404);}db.prepare("UPDATE glaze_photos SET filename='glaze-a.jpg' WHERE id='pa'").run();});
test('legacy anonymous Glaze URL remains unchanged',async()=>{const r=await fetch(base+'/uploads/glaze-a.jpg');assert.equal(r.status,200);assert.equal(await r.text(),'fixture-glaze-a.jpg');});
async function upload(token,replace=true){const fd=new FormData();fd.set('photo',new Blob([await require('sharp')({create:{width:2,height:2,channels:3,background:'red'}}).jpeg().toBuffer()],{type:'image/jpeg'}),'selected.jpg');fd.set('replacePhotoId','pa');return fetch(base+'/api/glazes/ca/photos',{method:'POST',headers:auth(token),body:fd});}
test('Glaze replacement rejects foreign owner without touching references or bytes',async()=>{const r=await upload(tokenB);assert.equal(r.status,404);assert.equal(db.prepare("SELECT filename FROM glaze_photos WHERE id='pa'").get().filename,'glaze-a.jpg');});
test('Glaze failed database commit preserves old photo and physical bytes',async()=>{db.exec("CREATE TRIGGER fail_glaze BEFORE UPDATE ON glaze_photos BEGIN SELECT RAISE(ABORT,'fixture'); END");try{assert.equal((await upload(tokenA)).status,500);assert.ok(db.prepare("SELECT id FROM glaze_photos WHERE id='pa'").get());assert.ok(fs.existsSync(path.join(tmp,'data/uploads/glaze-a.jpg')));}finally{db.exec('DROP TRIGGER fail_glaze');}});
test('Glaze replacement uses fresh filename and retains foreign shared old bytes',async()=>{db.prepare("UPDATE glaze_photos SET filename='glaze-a.jpg' WHERE id='pb'").run();const r=await upload(tokenA);assert.equal(r.status,200);const data=await r.json();assert.notEqual(data.filename,'glaze-a.jpg');assert.ok(fs.existsSync(path.join(tmp,'data/uploads/glaze-a.jpg')));assert.equal(db.prepare("SELECT filename FROM glaze_photos WHERE id='pb'").get().filename,'glaze-a.jpg');assert.equal((await fetch(route('ca',data.id),{headers:auth(tokenA)})).status,200);assert.equal((await fetch(route('ca',data.id),{headers:auth(tokenB)})).status,404);});
test('Piece protected delivery and explicit public compatibility remain intact',async()=>{assert.equal((await fetch(base+'/api/ql/pieces/private-a/photos/photo-private-a',{headers:auth(tokenA)})).status,200);assert.equal((await fetch(base+'/api/ql/pieces/private-a/photos/photo-private-a',{headers:auth(tokenB)})).status,404);assert.equal((await fetch(base+'/uploads/public-a.jpg')).status,200);});

test('Glaze scoped edit preserves other photos and foreign shared bytes',async()=>{
 const current=db.prepare("SELECT * FROM glaze_photos WHERE glaze_id='ca'").get();
 db.prepare("INSERT INTO glaze_photos(id,glaze_id,filename,sort_order,photo_label) VALUES('second','ca','glaze-a.jpg',8,'fired')").run();
 const fd=new FormData();fd.set('photo',new Blob(['new pixels'],{type:'image/jpeg'}),'edit.jpg');fd.set('replacePhotoId','second');
 const r=await fetch(base+'/api/glazes/ca/photos',{method:'POST',headers:auth(tokenA),body:fd});assert.equal(r.status,200);const data=await r.json();assert.equal(data.id,'second');
 assert.equal(db.prepare('SELECT filename FROM glaze_photos WHERE id=?').get(current.id).filename,current.filename);
 const updated=db.prepare("SELECT * FROM glaze_photos WHERE id='second'").get();assert.equal(updated.sort_order,8);assert.equal(updated.photo_label,'fired');assert.notEqual(updated.filename,'glaze-a.jpg');assert.ok(fs.existsSync(path.join(tmp,'data/uploads/glaze-a.jpg')));
});
test('Glaze scoped edit rejects photo identity outside selected record',async()=>{const fd=new FormData();fd.set('photo',new Blob(['new pixels'],{type:'image/jpeg'}),'edit.jpg');fd.set('replacePhotoId','pb');assert.equal((await fetch(base+'/api/glazes/ca/photos',{method:'POST',headers:auth(tokenA),body:fd})).status,404);assert.equal(db.prepare("SELECT glaze_id FROM glaze_photos WHERE id='pb'").get().glaze_id,'cb');});

test('Glaze rejects new uploads at limit while scoped replacement remains allowed',async()=>{const fd=new FormData();fd.set('photo',new Blob(['new'],{type:'image/jpeg'}),'new.jpg');const before=db.prepare("SELECT * FROM glaze_photos WHERE glaze_id='ca'").all();const r=await fetch(base+'/api/glazes/ca/photos',{method:'POST',headers:auth(tokenA),body:fd});assert.equal(r.status,403);assert.deepEqual(db.prepare("SELECT * FROM glaze_photos WHERE glaze_id='ca'").all(),before);});
test('Glaze reorder preserves exact permutation and rejects duplicate and foreign identities',async()=>{const rows=db.prepare("SELECT id FROM glaze_photos WHERE glaze_id='ca' ORDER BY sort_order").all().map(p=>p.id);for(const ids of [[rows[0],rows[0]],[rows[0],'pb']]){const r=await fetch(base+'/api/glazes/ca/photos/reorder',{method:'PUT',headers:{...auth(tokenA),'Content-Type':'application/json'},body:JSON.stringify({photoIds:ids})});assert.equal(r.status,400);}const desired=[...rows].reverse();const r=await fetch(base+'/api/glazes/ca/photos/reorder',{method:'PUT',headers:{...auth(tokenA),'Content-Type':'application/json'},body:JSON.stringify({photoIds:desired})});assert.equal(r.status,200);assert.deepEqual(db.prepare("SELECT id FROM glaze_photos WHERE glaze_id='ca' ORDER BY sort_order").all().map(p=>p.id),desired);assert.equal((await fetch(base+'/api/glazes/ca/photos/reorder',{method:'PUT',headers:{...auth(tokenB),'Content-Type':'application/json'},body:JSON.stringify({photoIds:rows})})).status,404);});
test('Glaze deletion denies foreign account and retains shared test-media bytes',async()=>{db.prepare("INSERT INTO glaze_photos(id,glaze_id,filename) VALUES('delete-shared','ca','shared-test.jpg')").run();db.prepare("INSERT INTO glaze_clay_tests(id,glaze_id,clay_name,photo_filename) VALUES('deferred','ca','Manual','shared-test.jpg')").run();fs.writeFileSync(path.join(tmp,'data/uploads/shared-test.jpg'),'test');assert.equal((await fetch(base+'/api/glaze-photos/delete-shared',{method:'DELETE',headers:auth(tokenB)})).status,404);assert.ok(db.prepare("SELECT 1 FROM glaze_photos WHERE id='delete-shared'").get());assert.equal((await fetch(base+'/api/glaze-photos/delete-shared',{method:'DELETE',headers:auth(tokenA)})).status,200);assert.ok(fs.existsSync(path.join(tmp,'data/uploads/shared-test.jpg')));assert.equal((await fetch(base+'/uploads/shared-test.jpg')).status,200);assert.equal((await fetch(base+'/api/ql/glazes/ca/clay-tests/deferred/photo',{headers:auth(tokenA)})).status,200);const tests=await (await fetch(base+'/api/glazes/ca/clay-tests',{headers:auth(tokenA)})).json();assert.equal(tests[0].photo_filename,'shared-test.jpg');assert.equal(tests[0].photoDelivery,'owner-protected');assert.equal(tests[0].photoVisibility,'legacy-ambiguous');});
test('Glaze deletion database failure retains live row and bytes',async()=>{db.prepare("INSERT INTO glaze_photos(id,glaze_id,filename) VALUES('delete-fail','ca','delete-fail.jpg')").run();fs.writeFileSync(path.join(tmp,'data/uploads/delete-fail.jpg'),'keep');db.exec("CREATE TRIGGER fail_delete_glaze BEFORE DELETE ON glaze_photos BEGIN SELECT RAISE(ABORT,'fixture'); END");try{assert.equal((await fetch(base+'/api/glaze-photos/delete-fail',{method:'DELETE',headers:auth(tokenA)})).status,500);assert.ok(db.prepare("SELECT 1 FROM glaze_photos WHERE id='delete-fail'").get());assert.ok(fs.existsSync(path.join(tmp,'data/uploads/delete-fail.jpg')));}finally{db.exec('DROP TRIGGER fail_delete_glaze');}});
test('Clay protected delivery unchanged beside Glaze',async()=>{db.prepare("INSERT INTO clay_bodies(id,user_id,name) VALUES('clay-check','a','Clay')").run();db.prepare("INSERT INTO clay_photos(id,clay_id,filename) VALUES('clay-check-photo','clay-check','clay-check.jpg')").run();fs.writeFileSync(path.join(tmp,'data/uploads/clay-check.jpg'),'clay');const u=base+'/api/ql/clay-bodies/clay-check/photos/clay-check-photo';assert.equal((await fetch(u,{headers:auth(tokenA)})).status,200);assert.equal((await fetch(u,{headers:auth(tokenB)})).status,404);});
test('Glaze cleanup failure leaves unused bytes after committed row deletion',()=>{db.pragma('foreign_keys=ON');db.prepare("INSERT INTO glaze_photos(id,glaze_id,filename) VALUES('cleanup-fail','ca','cleanup-fail.jpg')").run();const file=path.join(tmp,'data/uploads/cleanup-fail.jpg');fs.writeFileSync(file,'old');const unlink=fs.unlinkSync;const {createDeletionLifecycle}=require('../deletion-lifecycle.cjs');const service=createDeletionLifecycle(db,path.join(tmp,'data/uploads'),()=>{});fs.unlinkSync=p=>{if(p===file){assert.equal(db.prepare("SELECT 1 FROM glaze_photos WHERE id='cleanup-fail'").get(),undefined);throw Object.assign(new Error('fixture cleanup failure'),{code:'EACCES'});}return unlink(p);};try{assert.equal(service.deletePhoto('a','cleanup-fail','glaze'),true);assert.equal(db.prepare("SELECT 1 FROM glaze_photos WHERE id='cleanup-fail'").get(),undefined);assert.ok(fs.existsSync(file));}finally{fs.unlinkSync=unlink;}});

test('Glaze Clay Test protected delivery enforces owner auth and generic missing behavior',async()=>{
 db.prepare("INSERT INTO glaze_clay_tests(id,glaze_id,clay_name,photo_filename) VALUES('test-a','ca','Manual','test-a.jpg'),('test-b','cb','Manual','test-b.jpg')").run();
 fs.writeFileSync(path.join(tmp,'data/uploads/test-a.jpg'),'test-a');fs.writeFileSync(path.join(tmp,'data/uploads/test-b.jpg'),'test-b');
 const u=base+'/api/ql/glazes/ca/clay-tests/test-a/photo';
 const owner=await fetch(u,{headers:auth(tokenA)});assert.equal(owner.status,200);assert.equal(await owner.text(),'test-a');assert.match(owner.headers.get('cache-control'),/private.*no-store/);
 assert.equal((await fetch(u)).status,401);
 const foreign=await fetch(u,{headers:auth(tokenB)}),missing=await fetch(base+'/api/ql/glazes/ca/clay-tests/missing/photo',{headers:auth(tokenA)});
 assert.equal(foreign.status,404);assert.equal(missing.status,404);assert.deepEqual(await foreign.json(),await missing.json());
});
test('Glaze Clay Test filename collision fails closed across accounts',async()=>{
 db.prepare("UPDATE glaze_clay_tests SET photo_filename='test-a.jpg' WHERE id='test-b'").run();
 try{assert.equal((await fetch(base+'/api/ql/glazes/ca/clay-tests/test-a/photo',{headers:auth(tokenA)})).status,404);assert.equal((await fetch(base+'/api/ql/glazes/cb/clay-tests/test-b/photo',{headers:auth(tokenB)})).status,404);}
 finally{db.prepare("UPDATE glaze_clay_tests SET photo_filename='test-b.jpg' WHERE id='test-b'").run();}
});
test('Glaze Clay Test replacement is record scoped and preserves shared old bytes',async()=>{
 db.prepare("INSERT INTO glaze_clay_tests(id,glaze_id,clay_name,photo_filename) VALUES('replace-a','ca','Manual','replace-old.jpg'),('replace-b','cb','Manual','replace-old.jpg')").run();
 fs.writeFileSync(path.join(tmp,'data/uploads/replace-old.jpg'),'old');
 const fd=new FormData();fd.set('photo',new Blob(['new'],{type:'image/jpeg'}),'new.jpg');
 assert.equal((await fetch(base+'/api/glazes/ca/clay-tests/replace-a/photo',{method:'PUT',headers:auth(tokenB),body:fd})).status,404);
 const fd2=new FormData();fd2.set('photo',new Blob(['new'],{type:'image/jpeg'}),'new.jpg');
 const r=await fetch(base+'/api/glazes/ca/clay-tests/replace-a/photo',{method:'PUT',headers:auth(tokenA),body:fd2});assert.equal(r.status,200);
 assert.notEqual(db.prepare("SELECT photo_filename FROM glaze_clay_tests WHERE id='replace-a'").get().photo_filename,'replace-old.jpg');
 assert.equal(db.prepare("SELECT photo_filename FROM glaze_clay_tests WHERE id='replace-b'").get().photo_filename,'replace-old.jpg');assert.ok(fs.existsSync(path.join(tmp,'data/uploads/replace-old.jpg')));
});
test('Glaze Clay Test delete remains owner scoped and shared-file safe',async()=>{
 db.prepare("INSERT INTO glaze_clay_tests(id,glaze_id,clay_name,photo_filename) VALUES('delete-test-a','ca','Manual','delete-test-shared.jpg'),('delete-test-b','cb','Manual','delete-test-shared.jpg')").run();fs.writeFileSync(path.join(tmp,'data/uploads/delete-test-shared.jpg'),'shared');
 assert.equal((await fetch(base+'/api/glazes/ca/clay-tests/delete-test-a',{method:'DELETE',headers:auth(tokenB)})).status,404);assert.ok(db.prepare("SELECT 1 FROM glaze_clay_tests WHERE id='delete-test-a'").get());
 assert.equal((await fetch(base+'/api/glazes/ca/clay-tests/delete-test-a',{method:'DELETE',headers:auth(tokenA)})).status,200);assert.ok(fs.existsSync(path.join(tmp,'data/uploads/delete-test-shared.jpg')));
});
test('website Glaze Clay Test surfaces use protected loader and preserve deferred categories',()=>{
 assert.match(appSource,/data-glaze-clay-test-id/);assert.match(appSource,/api\/ql\/glazes\/.*clay-tests/);assert.match(appSource,/glazeClayTestMediaGeneration/);assert.match(appSource,/URL\.revokeObjectURL/);
 assert.match(appSource,/\/uploads\/.*combo/);assert.match(serverSource,/test_tiles/);assert.match(serverSource,/api\/ql\/pieces/);assert.match(serverSource,/api\/ql\/clay-bodies/);
});
