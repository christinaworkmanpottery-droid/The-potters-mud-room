const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'..');
const appSource=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');
let tmp,server,db,base,secret,tokenA,tokenB,log='';
async function start(){
 tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ql-piece-media-'));
 for(const n of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,n),path.join(tmp,n));
 fs.mkdirSync(path.join(tmp,'ql'));for(const n of ['relationships.cjs','piece-history.cjs','piece-editor.cjs'])fs.copyFileSync(path.join(root,'ql',n),path.join(tmp,'ql',n));
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

const route=(id='ca',photo='pa')=>base+'/api/ql/clay-bodies/'+id+'/photos/'+photo;
test.before(async()=>{
 await start();
 db.prepare("INSERT INTO clay_bodies(id,user_id,name) VALUES('ca','a','Clay A'),('cb','b','Clay B')").run();
 db.prepare("INSERT INTO clay_photos(id,clay_id,filename) VALUES('pa','ca','clay-a.jpg'),('pb','cb','clay-b.jpg')").run();
 for(const n of ['clay-a.jpg','clay-b.jpg'])fs.writeFileSync(path.join(tmp,'data/uploads',n),'fixture-'+n);
});
test('Clay owner receives authenticated bytes with private no-store and nosniff',async()=>{const r=await fetch(route(),{headers:auth(tokenA)});assert.equal(r.status,200);assert.equal(await r.text(),'fixture-clay-a.jpg');assert.match(r.headers.get('cache-control'),/private.*no-store/);assert.equal(r.headers.get('x-content-type-options'),'nosniff');});
test('foreign and missing Clay photo have identical generic responses',async()=>{const rs=await Promise.all([fetch(route(),{headers:auth(tokenB)}),fetch(route('ca','missing'),{headers:auth(tokenA)}),fetch(route('missing'),{headers:auth(tokenA)})]);for(const r of rs){assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'Photo unavailable'});}});
test('unauthenticated Clay photo denied',async()=>assert.equal((await fetch(route())).status,401));
test('Clay list/detail announce owner delivery without inventing historical visibility',async()=>{for(const url of ['/api/clay-bodies','/api/clay-bodies/ca']){const r=await fetch(base+url,{headers:auth(tokenA)});const data=await r.json();const clay=Array.isArray(data)?data[0]:data.clay;assert.equal(clay.photoDelivery,'owner-protected');assert.equal(clay.photoVisibility,'legacy-ambiguous');assert.equal(clay.photos[0].filename,'clay-a.jpg');}assert.equal(db.prepare('SELECT filename FROM clay_photos WHERE id=?').get('pa').filename,'clay-a.jpg');});
test('cross-account Clay filename collision fails closed for both owners',async()=>{db.prepare("UPDATE clay_photos SET filename='clay-a.jpg' WHERE id='pb'").run();try {assert.equal((await fetch(route(),{headers:auth(tokenA)})).status,404);assert.equal((await fetch(route('cb','pb'),{headers:auth(tokenB)})).status,404);}finally{db.prepare("UPDATE clay_photos SET filename='clay-b.jpg' WHERE id='pb'").run();}});
test('foreign non-Clay reference also prevents protected Clay delivery',async()=>{db.prepare("UPDATE piece_photos SET filename='clay-a.jpg' WHERE id='photo-private-b'").run();try{assert.equal((await fetch(route(),{headers:auth(tokenA)})).status,404);}finally{db.prepare("UPDATE piece_photos SET filename='private-b.jpg' WHERE id='photo-private-b'").run();}});
test('unsafe path and symlink never expose filesystem bytes',async()=>{for(const name of ['../pottery.db','linked.jpg']){if(name==='linked.jpg')fs.symlinkSync(path.join(tmp,'data/pottery.db'),path.join(tmp,'data/uploads/linked.jpg'));db.prepare('UPDATE clay_photos SET filename=? WHERE id=?').run(name,'pa');assert.equal((await fetch(route(),{headers:auth(tokenA)})).status,404);}db.prepare("UPDATE clay_photos SET filename='clay-a.jpg' WHERE id='pa'").run();});
test('legacy anonymous Clay URL remains unchanged',async()=>{const r=await fetch(base+'/uploads/clay-a.jpg');assert.equal(r.status,200);assert.equal(await r.text(),'fixture-clay-a.jpg');});
async function upload(token,replace=true){const fd=new FormData();fd.set('photo',new Blob([await require('sharp')({create:{width:2,height:2,channels:3,background:'red'}}).jpeg().toBuffer()],{type:'image/jpeg'}),'selected.jpg');fd.set('replace',String(replace));return fetch(base+'/api/clay-bodies/ca/photos',{method:'POST',headers:auth(token),body:fd});}
test('Clay replacement rejects foreign owner without touching references or bytes',async()=>{const r=await upload(tokenB);assert.equal(r.status,404);assert.equal(db.prepare("SELECT filename FROM clay_photos WHERE id='pa'").get().filename,'clay-a.jpg');});
test('Clay failed database commit preserves old photo and physical bytes',async()=>{db.exec("CREATE TRIGGER fail_clay BEFORE INSERT ON clay_photos BEGIN SELECT RAISE(ABORT,'fixture'); END");try{assert.equal((await upload(tokenA)).status,500);assert.ok(db.prepare("SELECT id FROM clay_photos WHERE id='pa'").get());assert.ok(fs.existsSync(path.join(tmp,'data/uploads/clay-a.jpg')));}finally{db.exec('DROP TRIGGER fail_clay');}});
test('Clay replacement uses fresh filename and retains foreign shared old bytes',async()=>{db.prepare("UPDATE clay_photos SET filename='clay-a.jpg' WHERE id='pb'").run();const r=await upload(tokenA);assert.equal(r.status,200);const data=await r.json();assert.notEqual(data.filename,'clay-a.jpg');assert.ok(fs.existsSync(path.join(tmp,'data/uploads/clay-a.jpg')));assert.equal(db.prepare("SELECT filename FROM clay_photos WHERE id='pb'").get().filename,'clay-a.jpg');assert.equal((await fetch(route('ca',data.id),{headers:auth(tokenA)})).status,200);assert.equal((await fetch(route('ca',data.id),{headers:auth(tokenB)})).status,404);});
test('Piece protected delivery and explicit public compatibility remain intact',async()=>{assert.equal((await fetch(base+'/api/ql/pieces/private-a/photos/photo-private-a',{headers:auth(tokenA)})).status,200);assert.equal((await fetch(base+'/api/ql/pieces/private-a/photos/photo-private-a',{headers:auth(tokenB)})).status,404);assert.equal((await fetch(base+'/uploads/public-a.jpg')).status,200);});

test('Clay scoped edit preserves other photos and foreign shared bytes',async()=>{
 const current=db.prepare("SELECT * FROM clay_photos WHERE clay_id='ca'").get();
 db.prepare("INSERT INTO clay_photos(id,clay_id,filename,sort_order,photo_label) VALUES('second','ca','clay-a.jpg',8,'fired')").run();
 const fd=new FormData();fd.set('photo',new Blob(['new pixels'],{type:'image/jpeg'}),'edit.jpg');fd.set('replacePhotoId','second');
 const r=await fetch(base+'/api/clay-bodies/ca/photos',{method:'POST',headers:auth(tokenA),body:fd});assert.equal(r.status,200);const data=await r.json();assert.equal(data.id,'second');
 assert.equal(db.prepare('SELECT filename FROM clay_photos WHERE id=?').get(current.id).filename,current.filename);
 const updated=db.prepare("SELECT * FROM clay_photos WHERE id='second'").get();assert.equal(updated.sort_order,8);assert.equal(updated.photo_label,'fired');assert.notEqual(updated.filename,'clay-a.jpg');assert.ok(fs.existsSync(path.join(tmp,'data/uploads/clay-a.jpg')));
});
test('Clay scoped edit rejects photo identity outside selected record',async()=>{const fd=new FormData();fd.set('photo',new Blob(['new pixels'],{type:'image/jpeg'}),'edit.jpg');fd.set('replacePhotoId','pb');assert.equal((await fetch(base+'/api/clay-bodies/ca/photos',{method:'POST',headers:auth(tokenA),body:fd})).status,404);assert.equal(db.prepare("SELECT clay_id FROM clay_photos WHERE id='pb'").get().clay_id,'cb');});
