const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'..');
const appSource=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');
let tmp,server,db,base,secret,tokenA,tokenB,log='';
async function start(){
 tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ql-piece-media-'));
 for(const n of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,n),path.join(tmp,n));
 fs.mkdirSync(path.join(tmp,'ql'));for(const n of ['relationships.cjs','piece-history.cjs','piece-editor.cjs','photo-query-safety.cjs','photo-result-confidence.cjs'])fs.copyFileSync(path.join(root,'ql',n),path.join(tmp,'ql',n));
 fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});for(const n of ['node_modules','public'])fs.symlinkSync(path.join(root,n),path.join(tmp,n),'dir');
 const port=44000+crypto.randomInt(1000);base='http://127.0.0.1:'+port;secret=crypto.randomBytes(32).toString('hex');
 server=spawn(process.execPath,['server.js'],{cwd:tmp,env:{PATH:process.env.PATH,PORT:String(port),JWT_SECRET:secret,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>log+=c);server.stderr.on('data',c=>log+=c);
 for(let i=0;i<120&&!log.includes('running on');i++)await new Promise(r=>setTimeout(r,100));assert.ok(log.includes('running on'),log);
 db=new Database(path.join(tmp,'data/pottery.db'));tokenA=jwt.sign({userId:'a'},secret);tokenB=jwt.sign({userId:'b'},secret);
 db.prepare("INSERT INTO users(id,email,password_hash) VALUES('a','a@example.com','x'),('b','b@example.com','x')").run();
 db.prepare("INSERT INTO pieces(id,user_id,title,is_public) VALUES('private-a','a','Private A',0),('public-a','a','Public A',1),('private-b','b','Private B',0),('ambiguous-a','a','Ambiguous A',NULL)").run();
 db.prepare("INSERT INTO piece_photos(id,piece_id,filename,original_name,stage,sort_order) VALUES('photo-private-a','private-a','private-a.jpg','a.jpg','finished',0),('photo-public-a','public-a','public-a.jpg','p.jpg','finished',0),('photo-private-b','private-b','private-b.jpg','b.jpg','finished',0),('photo-ambiguous-a','ambiguous-a','ambiguous-a.jpg','x.jpg','finished',0)").run();
 db.prepare("UPDATE pieces SET status='glaze-fired' WHERE id='public-a'").run();
 const up=path.join(tmp,'data/uploads');for(const n of ['private-a.jpg','public-a.jpg','private-b.jpg','ambiguous-a.jpg'])fs.writeFileSync(path.join(up,n),'fixture-'+n);
}
async function stop(){if(db)db.close();if(server&&server.exitCode===null){const p=new Promise(r=>server.once('exit',r));server.kill();await p}if(tmp)fs.rmSync(tmp,{recursive:true,force:true});}
test.before(start);test.after(stop);
const auth=t=>({Authorization:'Bearer '+t});

const pub=(p='public-a',ph='photo-public-a')=>base+'/api/ql/pieces/'+p+'/photos/'+ph+'/public';
test('2U public Piece photo loads anonymously with nosniff and revalidation',async()=>{const r=await fetch(pub());assert.equal(r.status,200);assert.equal(await r.text(),'fixture-public-a.jpg');assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.match(r.headers.get('cache-control'),/public.*must-revalidate/);});
test('2U public route denies private and legacy-ambiguous relationships',async()=>{for(const id of ['private-a','ambiguous-a']){const r=await fetch(pub(id,'photo-'+id));assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'Photo unavailable'});}});
test('2U wrong Piece-photo relationship denied even when both filenames are known',async()=>{assert.equal((await fetch(pub('public-a','photo-private-a'))).status,404);});
test('2U unfinished public Piece denied; actual Gallery status normalization preserved',async()=>{db.pragma('ignore_check_constraints=ON');for(const status of ['bisque-fired','Final Fired','done','complete','sold']){db.prepare('UPDATE pieces SET status=? WHERE id=?').run(status,'public-a');assert.equal((await fetch(pub())).status,status==='bisque-fired'?404:200);}db.prepare("UPDATE pieces SET status='glaze-fired' WHERE id='public-a'").run();});
test('2U private and public filename collisions both fail closed',async()=>{for(const id of ['private-a','public-a']){db.prepare('INSERT INTO piece_photos(id,piece_id,filename) VALUES(?,?,?)').run('collision',id,'public-a.jpg');assert.equal((await fetch(pub())).status,404);db.prepare("DELETE FROM piece_photos WHERE id='collision'").run();}});
test('2U cross-category filename collision fails closed',async()=>{db.prepare("INSERT INTO clay_bodies(id,user_id,name) VALUES('clay','a','Clay')").run();db.prepare("INSERT INTO clay_photos(id,clay_id,filename) VALUES('cp','clay','public-a.jpg')").run();assert.equal((await fetch(pub())).status,404);db.prepare("DELETE FROM clay_photos WHERE id='cp'").run();});
test('2U unsafe stored filenames missing files and symlinks never disclose paths',async()=>{for(const name of ['../private-a.jpg','missing.jpg','link.jpg','unsafe.svg']){if(name==='link.jpg')fs.symlinkSync(path.join(tmp,'data/uploads/private-a.jpg'),path.join(tmp,'data/uploads/link.jpg'));db.prepare('UPDATE piece_photos SET filename=? WHERE id=?').run(name,'photo-public-a');const r=await fetch(pub());assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'Photo unavailable'});}db.prepare("UPDATE piece_photos SET filename='public-a.jpg' WHERE id='photo-public-a'").run();});
test('2U unpublishing revokes public access on next request',async()=>{db.prepare("UPDATE pieces SET is_public=0 WHERE id='public-a'").run();assert.equal((await fetch(pub())).status,404);db.prepare("UPDATE pieces SET is_public=1 WHERE id='public-a'").run();assert.equal((await fetch(pub())).status,200);});
test('2U Gallery carries record/photo identity for public delivery',async()=>{const data=await(await fetch(base+'/api/gallery')).json(),p=data.pieces.find(p=>p.id==='public-a');assert.equal(p.photoId,'photo-public-a');assert.equal(p.photoVisibility,'public');assert.equal(p.is_public,1);});
test('2U dashboard and list expose explicit visibility',async()=>{for(const route of ['/api/dashboard','/api/pieces']){const data=await(await fetch(base+route,{headers:auth(tokenA)})).json();const rows=data.recentPieces||data;assert.equal(rows.find(p=>p.id==='private-a').photoVisibility,'private');}});
test('2U global uploads remains unchanged including private historical compatibility',async()=>{assert.equal((await fetch(base+'/uploads/private-a.jpg')).status,200);assert.match(serverSource,/app\.use\('\/uploads', express\.static\(UPLOADS_DIR\)\)/);});
test('2U Photo Lookup metadata is owner-resolved without changing scoring',()=>{const source=serverSource.slice(serverSource.indexOf('const matches = [];',serverSource.indexOf("app.post('/api/pieces/photo-search'")));assert.match(source,/photoVisibility: classifyPiecePhotoVisibility\(current\)/);assert.match(source,/p\.user_id=\?/);assert.match(source,/matchScore: best.score/);});
test('2U Photo Lookup returns owner-only private/public/legacy classification with original matching',async()=>{
 const bytes=await require('sharp')({create:{width:64,height:64,channels:3,background:{r:50,g:120,b:200}}}).png().toBuffer();
 for(const id of ['private-a','public-a','ambiguous-a','private-b'])fs.writeFileSync(path.join(tmp,'data/uploads',id+'.jpg'),bytes);
 const form=new FormData();form.append('photo',new Blob([bytes],{type:'image/png'}),'lookup.png');
 const r=await fetch(base+'/api/pieces/photo-search',{method:'POST',headers:auth(tokenA),body:form});assert.equal(r.status,200);const data=await r.json();
 for(const [id,visibility] of [['private-a','private'],['public-a','public'],['ambiguous-a','legacy-ambiguous']]){const m=data.matches.find(m=>m.id===id);assert.ok(m,id);assert.equal(m.photoVisibility,visibility);assert.equal(m.user_id,'a');assert.equal(m.photos[0].id,'photo-'+id);assert.ok(m.matchScore>=0.45);}
 assert.ok(!data.matches.some(m=>m.id==='private-b'));
});
