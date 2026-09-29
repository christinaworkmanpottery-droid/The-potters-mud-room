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
test.before(start);test.after(stop);
const auth=t=>({Authorization:'Bearer '+t});
test('private Piece media classification is explicit and public opt-in stays distinct',()=>{assert.match(serverSource,/function classifyPiecePhotoVisibility/);assert.match(serverSource,/return 'legacy-ambiguous'/);});
test('authenticated owner can load private Piece photo',async()=>{const r=await fetch(base+'/api/ql/pieces/private-a/photos/photo-private-a',{headers:auth(tokenA)});assert.equal(r.status,200);assert.equal(await r.text(),'fixture-private-a.jpg');assert.match(r.headers.get('cache-control')||'',/private.*no-store/);});
test('another account cannot load private Piece photo',async()=>{const r=await fetch(base+'/api/ql/pieces/private-a/photos/photo-private-a',{headers:auth(tokenB)});assert.equal(r.status,404);assert.deepEqual(await r.json(),{error:'Photo unavailable'});});
test('unauthenticated private Piece photo request is denied',async()=>{const r=await fetch(base+'/api/ql/pieces/private-a/photos/photo-private-a');assert.equal(r.status,401);});
test('foreign and nonexistent private photo behavior is equivalent',async()=>{const a=await fetch(base+'/api/ql/pieces/private-b/photos/photo-private-b',{headers:auth(tokenA)}),b=await fetch(base+'/api/ql/pieces/private-a/photos/missing',{headers:auth(tokenA)});assert.equal(a.status,b.status);assert.deepEqual(await a.json(),await b.json());});
test('private Piece detail contract preserves stored filename and marks protected visibility',async()=>{const r=await fetch(base+'/api/pieces/private-a',{headers:auth(tokenA)}),p=await r.json();assert.equal(p.photoVisibility,'private');assert.equal(p.photos[0].filename,'private-a.jpg');});
test('website private Piece detail uses protected delivery rather than legacy filename URL',()=>{assert.match(appSource,/p\.photoVisibility === 'private'/);assert.match(appSource,/data-private-piece-photo/);assert.match(appSource,/\/api\/ql\/pieces\/.*\/photos\//s);});
test('intentionally public Piece detail remains on legacy public delivery',async()=>{let r=await fetch(base+'/api/pieces/public-a',{headers:auth(tokenA)});const p=await r.json();assert.equal(p.photoVisibility,'public');r=await fetch(base+'/uploads/public-a.jpg');assert.equal(r.status,200);const protectedR=await fetch(base+'/api/ql/pieces/public-a/photos/photo-public-a',{headers:auth(tokenA)});assert.equal(protectedR.status,404);});
test('legacy ambiguous classification is not silently forced through private route',async()=>{let r=await fetch(base+'/api/pieces/ambiguous-a',{headers:auth(tokenA)});const p=await r.json();assert.equal(p.photoVisibility,'legacy-ambiguous');r=await fetch(base+'/api/ql/pieces/ambiguous-a/photos/photo-ambiguous-a',{headers:auth(tokenA)});assert.equal(r.status,404);assert.match(appSource,/privatePiecePhotos = p\.photoVisibility === 'private'/);});
test('account switching and navigation revoke prior private Piece object URLs',()=>{assert.match(appSource,/pieceDetailPrivatePhotoUrls\.forEach\(url => URL\.revokeObjectURL\(url\)\)/);assert.match(appSource,/clearPieceHistory\(\);[\s\S]{0,300}token = data\.token/);assert.match(appSource,/if \(page !== 'pieceDetail'\) clearPieceHistory\(\)/);});
test('private Piece photo reload path is read-only and failure leaves Piece detail usable',()=>{const fn=appSource.slice(appSource.indexOf('async function loadPrivatePieceDetailPhotos'),appSource.indexOf('function historyElement'));assert.match(fn,/method|fetch\(/);assert.doesNotMatch(fn,/POST|PUT|PATCH|DELETE/);assert.match(fn,/Photo unavailable/);});
test('Connected History protected-photo behavior remains owner-scoped',async()=>{let r=await fetch(base+'/api/ql/pieces/private-a/history/photos/photo-private-a',{headers:auth(tokenA)});assert.equal(r.status,200);r=await fetch(base+'/api/ql/pieces/private-a/history/photos/photo-private-a',{headers:auth(tokenB)});assert.equal(r.status,404);});

test('Piece list API exposes the same explicit visibility contract for mobile thumbnails',async()=>{for(const [id,expected] of [['private-a','private'],['public-a','public'],['ambiguous-a','legacy-ambiguous']]){const r=await fetch(base+'/api/pieces',{headers:auth(tokenA)}),pieces=await r.json(),p=pieces.find(x=>x.id===id);assert.ok(p);assert.equal(p.photoVisibility,expected);}});
