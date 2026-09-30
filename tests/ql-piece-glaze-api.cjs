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


const request=async(url,method='GET',body,t=tokenA)=>{const r=await fetch(base+url,{method,headers:{...auth(t),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()}};
const raw=()=>db.prepare("SELECT * FROM piece_glazes WHERE piece_id='private-a' ORDER BY layer_order,id").all();
const layers=async()=> (await request('/api/pieces/private-a')).data.glazes;
const history=()=>require('../ql/piece-history.cjs').createPieceHistoryService(db).get({userId:'a',pieceId:'private-a'}).glazeLayers;
let csvBefore;
test.before(async()=>{await start();db.prepare("UPDATE users SET tier='starter'").run();db.prepare("INSERT INTO glazes(id,user_id,name) VALUES('ga','a','Saved'),('gb','b','SECRET'),('blank','a','')").run();
 db.pragma('foreign_keys=OFF');
 const add=db.prepare('INSERT INTO piece_glazes(id,piece_id,glaze_id,custom_name,layer_order,coats,application_method,notes) VALUES(?,?,?,?,?,?,?,?)');
 for(const [id,g,text,order] of [['saved','ga',null,0],['manual',null,'Manual',1],['both','ga','Retained',2],['neither',null,null,3],['blank','blank','Blank fallback',4],['foreign','gb','Own fallback',5],['dangling','gone','Kept',6],['foreign-empty','gb',null,7],['dangling-empty','gone',null,8],['repeat','ga',null,2]])add.run(id,'private-a',g,text,order,3,'brush','Layer notes');
 db.pragma('foreign_keys=ON');
 csvBefore=await(await fetch(base+'/api/export/pieces',{headers:auth(tokenA)})).text();
});
for(const [id,name] of [['saved','Saved'],['manual','Manual'],['both','Saved'],['neither',null],['blank',''],['foreign','Own fallback'],['dangling','Kept'],['foreign-empty',null],['dangling-empty',null],['repeat','Saved']])test('layer display precedence '+id,async()=>{const layer=(await layers()).find(g=>g.id===id);assert.equal(layer.glaze_name,name);assert.equal(layer.coats,3);assert.equal(layer.application_method,'brush');assert.equal(layer.notes,'Layer notes')});
test('mixed returned ordering, repeated IDs and nonunique positions preserve all layer identities',async()=>{const rows=await layers();assert.equal(rows.length,10);assert.equal(rows.filter(x=>x.glaze_id==='ga').length,3);assert.equal(rows.filter(x=>x.layer_order===2).length,2);assert.deepEqual(rows.map(x=>x.layer_order),[0,1,2,2,3,4,5,6,7,8]);assert.equal(new Set(rows.map(x=>x.id)).size,10)});
test('owned list excludes foreign references and Piece independently requires ownership',async()=>{const list=(await request('/api/glazes')).data;assert.deepEqual(list.map(x=>x.id).sort(),['blank','ga']);assert.equal((await request('/api/pieces/private-a','GET',undefined,tokenB)).status,404);assert.equal((await request('/api/pieces/missing')).status,404)});
test('History preserves row-per-layer order and manual layers, excludes foreign/dangling and fabricates no chronology',()=>{const h=history();assert.deepEqual(h.map(x=>x.sourceRecordId),['saved','manual','both','repeat','neither','blank']);assert.equal(h.filter(x=>x.values.glaze?.id==='ga').length,3);for(const e of h){assert.equal(e.relationshipDate,null);assert.equal(e.recordedAt,null)}});
test('live name brand type recipe photo and child-test changes are visible without rewriting layers',async()=>{const before=raw();db.prepare("UPDATE glazes SET name='Renamed',brand='Brand',glaze_type='recipe',recipe_notes='New recipe' WHERE id='ga'").run();db.prepare("INSERT INTO glaze_ingredients(id,glaze_id,ingredient_name,percentage) VALUES('ing','ga','Silica',100)").run();db.prepare("INSERT INTO glaze_photos(id,glaze_id,filename) VALUES('gp','ga','new.jpg')").run();db.prepare("INSERT INTO glaze_clay_tests(id,glaze_id,clay_name,result_notes,photo_filename) VALUES('ct','ga','Clay','New test','test.jpg')").run();for(const n of ['new.jpg','test.jpg'])fs.writeFileSync(path.join(tmp,'data/uploads',n),'media');
 const g=(await request('/api/glazes')).data.find(x=>x.id==='ga');assert.equal(g.name,'Renamed');assert.equal(g.brand,'Brand');assert.equal(g.glaze_type,'recipe');assert.equal(g.recipe_notes,'New recipe');assert.equal(g.ingredients[0].ingredient_name,'Silica');assert.equal(g.photos[0].filename,'new.jpg');assert.equal(g.clay_tests[0].result_notes,'New test');assert.equal(g.photoDelivery,'owner-protected');assert.equal(g.clay_tests[0].photoDelivery,'owner-protected');assert.deepEqual(raw(),before);assert.equal((await layers()).find(x=>x.id==='both').glaze_name,'Renamed')});
for(const route of ['/api/ql/glazes/ga/photos/gp','/api/ql/glazes/ga/clay-tests/ct/photo'])test('protected media exact parent child ownership '+route,async()=>{assert.equal((await fetch(base+route,{headers:auth(tokenA)})).status,200);assert.equal((await fetch(base+route,{headers:auth(tokenB)})).status,404);assert.equal((await fetch(base+route.replace('/ga/','/blank/'),{headers:auth(tokenA)})).status,404)});
test('CSV unchanged by Glaze edits and has no glaze columns',async()=>{const csv=await(await fetch(base+'/api/export/pieces',{headers:auth(tokenA)})).text();assert.equal(csv,csvBefore);assert.doesNotMatch(csv.split('\n')[0],/glaze/i)});
test('inconsistent historical ownership prevents deletion with 409 and no changes',async()=>{db.prepare("INSERT INTO piece_glazes(id,piece_id,glaze_id) VALUES('inconsistent','private-b','ga')").run();const before=raw();assert.equal((await request('/api/glazes/ga','DELETE')).status,409);assert.deepEqual(raw(),before);db.prepare("DELETE FROM piece_glazes WHERE id='inconsistent'").run()});
test('Glaze deletion preserves row identity position metadata and existing text or copies deleted name',async()=>{const before=raw();assert.equal((await request('/api/glazes/ga','DELETE')).status,200);const after=raw();assert.equal(after.length,before.length);for(let i=0;i<before.length;i++){const b=before[i];assert.deepEqual(after[i],b.glaze_id==='ga'?{...b,glaze_id:null,custom_name:b.custom_name||'Renamed'}:b)}assert.equal(history().length,6)});
test('CSV stays byte-identical after Glaze detachment',async()=>assert.equal(await(await fetch(base+'/api/export/pieces',{headers:auth(tokenA)})).text(),csvBefore));
test('Piece deletion removes its layers while preserving Glaze recipes photos and tests',async()=>{db.prepare("INSERT INTO pieces(id,user_id,title) VALUES('delete-piece','a','Delete')").run();db.prepare("INSERT INTO piece_glazes(id,piece_id,glaze_id) VALUES('delete-layer','delete-piece','blank')").run();const g=(await request('/api/glazes')).data;assert.equal((await request('/api/pieces/delete-piece','DELETE')).status,200);assert.equal(db.prepare("SELECT id FROM piece_glazes WHERE id='delete-layer'").get(),undefined);assert.deepEqual((await request('/api/glazes')).data,g)});
