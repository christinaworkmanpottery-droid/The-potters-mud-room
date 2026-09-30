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
 db.prepare("UPDATE users SET tier='starter',billing_period='promo'").run();
 db.prepare("INSERT INTO clay_bodies(id,user_id,name) VALUES('ca','a','Clay A'),('cb','b','Clay B')").run();
 db.prepare("INSERT INTO clay_photos(id,clay_id,filename) VALUES('pa','ca','clay-a.jpg'),('pb','cb','clay-b.jpg')").run();
 for(const n of ['clay-a.jpg','clay-b.jpg'])fs.writeFileSync(path.join(tmp,'data/uploads',n),'fixture-'+n);
});

const request=async(url,method='GET',body,t=tokenA)=>{const r=await fetch(base+url,{method,headers:{...auth(t),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()}};
const seed=(id,clay,text)=>db.prepare('INSERT INTO pieces(id,user_id,title,clay_body_id,studio) VALUES(?,?,?,?,?)').run(id,'a',id,clay,text);
for(const [id,clay,text,display] of [['both','ca','Manual','Clay A'],['saved','ca',null,'Clay A'],['manual',null,'Manual','Manual'],['empty',null,null,null],['foreign','cb','Own text','Own text'],['foreign-empty','cb',null,null]])test('display contract '+id,async()=>{seed(id,clay,text);const r=await request('/api/pieces/'+id);assert.equal(r.status,200);assert.equal(r.data.clay_body_name,display);assert.equal(r.data.clay,display);assert.equal(db.prepare('SELECT studio FROM pieces WHERE id=?').get(id).studio,text)});
for(const text of [null,'Retained'])test('dangling Clay is safe '+text,async()=>{db.pragma('foreign_keys=OFF');const id='dangling-'+text;seed(id,'missing',text);db.pragma('foreign_keys=ON');const r=await request('/api/pieces/'+id);assert.equal(r.data.clay_body_name,text);assert.equal(r.data.clay,text)});
test('shared Clay supports many Pieces',async()=>assert.equal(db.prepare("SELECT count(*) n FROM pieces WHERE clay_body_id='ca'").get().n,2));
test('Clay and Piece each independently require ownership',async()=>{assert.equal((await request('/api/clay-bodies/ca')).data.clay.id,'ca');const a=await request('/api/clay-bodies/cb'),b=await request('/api/clay-bodies/missing');assert.equal(a.status,404);assert.deepEqual(a,b);assert.equal((await request('/api/pieces/both','GET',undefined,tokenB)).status,404)});
test('rename changes fresh display but not stored text',async()=>{assert.equal((await request('/api/clay-bodies/ca','PUT',{name:'Renamed'})).status,200);for(const id of ['both','saved'])assert.equal((await request('/api/pieces/'+id)).data.clay_body_name,'Renamed');assert.equal(db.prepare("SELECT studio FROM pieces WHERE id='both'").get().studio,'Manual')});
test('CSV uses resolved current name and raw Studio',async()=>{const r=await fetch(base+'/api/export/pieces',{headers:auth(tokenA)});assert.equal(r.status,200);const csv=await r.text();assert.match(csv,/"both","Renamed"[^\n]*"Manual"/);assert.match(csv,/"manual",""[^\n]*"Manual"/);assert.doesNotMatch(csv,/"Clay B"/)});
test('Piece deletion preserves saved Clay',async()=>{seed('remove-piece','ca',null);assert.equal((await request('/api/pieces/remove-piece','DELETE')).status,200);assert.ok(db.prepare("SELECT id FROM clay_bodies WHERE id='ca'").get())});
test('Clay deletion detaches all owned Pieces without copying name',async()=>{assert.equal((await request('/api/clay-bodies/ca','DELETE')).status,200);for(const id of ['both','saved']){const p=db.prepare('SELECT * FROM pieces WHERE id=?').get(id);assert.equal(p.clay_body_id,null);assert.equal(p.studio,id==='both'?'Manual':null);assert.equal((await request('/api/pieces/'+id)).data.clay_body_name,id==='both'?'Manual':null)}assert.ok(db.prepare("SELECT id FROM clay_bodies WHERE id='cb'").get())});
test('CSV after deletion retains raw Studio and empties library name',async()=>{const csv=await(await fetch(base+'/api/export/pieces',{headers:auth(tokenA)})).text();assert.match(csv,/"both",""[^\n]*"Manual"/);assert.doesNotMatch(csv,/Renamed/)});
test('POST explicit saved selection preserves supplied Studio and coexisting saved ID',async()=>{const c=await request('/api/clay-bodies','POST',{name:'Write Clay'});const id=c.data.id;const p=await request('/api/pieces','POST',{title:'Write',clayIntent:'saved',clayBodyId:id,studio:'Clay text'});assert.equal(p.status,200);const raw=db.prepare('SELECT * FROM pieces WHERE id=?').get(p.data.id);assert.equal(raw.clay_body_id,id);assert.equal(raw.studio,'Clay text');assert.equal((await request('/api/pieces/'+raw.id)).data.clay_body_name,'Write Clay');});
test('PUT explicit saved intent keeps separate Studio value',async()=>{const raw=db.prepare("SELECT * FROM pieces WHERE title='Write'").get();const r=await request('/api/pieces/'+raw.id,'PUT',{title:'Write',clayIntent:'saved',clayBodyId:raw.clay_body_id,studio:'Studio wins'});assert.equal(r.status,200);const fresh=db.prepare('SELECT * FROM pieces WHERE id=?').get(raw.id);assert.equal(fresh.studio,'Studio wins');assert.equal(fresh.clay_body_id,raw.clay_body_id)});
for(const method of ['POST','PUT'])test(method+' rejects foreign selected Clay',async()=>{const raw=db.prepare("SELECT * FROM pieces WHERE title='Write'").get();const r=await request('/api/pieces'+(method==='PUT'?'/'+raw.id:''),method,{title:'Invalid',clayBodyId:'cb'});assert.equal(r.status,400)});
test('History uses live Clay values and creation date without fake link date or manual relationships',()=>{const {createPieceHistoryService}=require('../ql/piece-history.cjs');const service=createPieceHistoryService(db);const raw=db.prepare("SELECT * FROM pieces WHERE title='Write'").get();db.prepare("UPDATE clay_bodies SET name='History rename',created_at='2020-01-01' WHERE id=?").run(raw.clay_body_id);const h=service.get({userId:'a',pieceId:raw.id});assert.equal(h.clay.values.name,'History rename');assert.equal(h.clay.recordedAt,'2020-01-01');assert.equal(h.clay.relationshipDate,null);assert.equal(service.get({userId:'a',pieceId:'manual'}).clay,null);assert.equal(service.get({userId:'a',pieceId:'foreign'}).clay,null);assert.equal(service.get({userId:'a',pieceId:'both'}).clay,null)});

test('PUT omitted Clay ID preserves it while independently editing Studio',async()=>{const raw=db.prepare("SELECT * FROM pieces WHERE title='Write'").get();await request('/api/pieces/'+raw.id,'PUT',{title:'Write',studio:'Retained'});const p=db.prepare('SELECT * FROM pieces WHERE id=?').get(raw.id);assert.equal(p.clay_body_id,raw.clay_body_id);assert.equal(p.studio,'Retained')});
