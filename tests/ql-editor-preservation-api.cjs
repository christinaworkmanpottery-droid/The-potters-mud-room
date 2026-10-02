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
 const up=path.join(tmp,'data/uploads');for(const n of ['private-a.jpg','public-a.jpg','private-b.jpg','ambiguous-a.jpg'])fs.writeFileSync(path.join(up,n),'fixture-'+n);
}
async function stop(){if(db)db.close();if(server&&server.exitCode===null){const p=new Promise(r=>server.once('exit',r));server.kill();await p}if(tmp)fs.rmSync(tmp,{recursive:true,force:true});}
test.after(stop);
const auth=t=>({Authorization:'Bearer '+t});


const request=async(url,method='GET',body,t=tokenA)=>{const r=await fetch(base+url,{method,headers:{...auth(t),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()}};
const piece=()=>db.prepare("SELECT * FROM pieces WHERE id='private-a'").get();
const rows=()=>db.prepare("SELECT * FROM piece_glazes WHERE piece_id='private-a' ORDER BY layer_order,rowid").all();
const reset=()=>{db.prepare("UPDATE pieces SET clay_body_id='ca',studio='Historical',title='Original' WHERE id='private-a'").run();db.prepare("DELETE FROM piece_glazes WHERE piece_id='private-a'").run();
 for(const [id,g,text,n,order] of [['l1','ga','Custom saved',0,4],['l2',null,'Manual',2,4],['l3','ga',null,3,20]])db.prepare('INSERT INTO piece_glazes(id,piece_id,glaze_id,custom_name,coats,application_method,notes,layer_order) VALUES(?,?,?,?,?,?,?,?)').run(id,'private-a',g,text,n,'other','Notes '+id,order);
};
const put=b=>request('/api/pieces/private-a','PUT',b);
test.before(async()=>{await start();db.prepare("UPDATE users SET tier='starter'").run();db.prepare("INSERT INTO clay_bodies(id,user_id,name) VALUES('ca','a','Clay A'),('ca2','a','Clay B'),('cb','b','Foreign')").run();db.prepare("INSERT INTO glazes(id,user_id,name) VALUES('ga','a','Glaze A'),('ga2','a','Glaze B'),('gb','b','Foreign')").run();reset();});
test.beforeEach(reset);
for(const body of [{title:'Title'},{status:'done'},{notes:'Notes'},{status:'broken',casualtyNotes:'Oops'},{description:'Description'},{}])test('partial edit preserves relationships '+JSON.stringify(body),async()=>{const before=rows();assert.equal((await put(body)).status,200);assert.equal(piece().clay_body_id,'ca');assert.equal(piece().studio,'Historical');assert.deepEqual(rows(),before)});
for(const [body,id,text] of [
 [{clayIntent:'manual',clay:'Typed',studio:'Old competing studio'},null,'Typed'],
 [{clayIntent:'saved',clayBodyId:'ca2'},'ca2','Historical'],
 [{clayIntent:'saved',clayBodyId:'ca2',studio:'Real studio'},'ca2','Real studio'],
 [{clayIntent:'clear'},null,null],
 [{clayBodyId:null},null,'Historical'],
 [{studio:null},'ca',null],
 [{clay_body_id:'ca2'},'ca2','Historical'],
 [{clay_body_id:null,clay:'Legacy manual'},null,'Legacy manual'],
 [{clayIntent:'untouched'},'ca','Historical'],
 [{clayIntent:'untouched',studio:'Studio edited'},'ca','Studio edited']
])test('Clay mutation '+JSON.stringify(body),async()=>{const before=rows();assert.equal((await put(body)).status,200);assert.equal(piece().clay_body_id,id);assert.equal(piece().studio,text);assert.deepEqual(rows(),before);const fresh=(await request('/api/pieces/private-a')).data;assert.equal(fresh.clay_body_id,id)});
for(const id of [null,'ca'])test('manual/saved Clay no-op '+id,async()=>{db.prepare("UPDATE pieces SET clay_body_id=? WHERE id='private-a'").run(id);assert.equal((await put({title:'No-op'})).status,200);assert.equal(piece().clay_body_id,id);assert.equal(piece().studio,'Historical')});
for(const body of [{clayBodyId:'cb'},{clayBodyId:'missing'},{clayBodyId:'ca',clay_body_id:'ca2'},{clay:'one',studio:'two'},{clay:'Typed'},{clayIntent:'saved',clayBodyId:null},{clayIntent:'manual',clay:'Typed',clayBodyId:'ca'}, {clayIntent:'clear',clay:'Conflicting'}])test('Clay atomic rejection '+JSON.stringify(body),async()=>{const before=piece(),layers=rows();assert.equal((await put({title:'Must rollback',...body})).status,400);assert.deepEqual(piece(),before);assert.deepEqual(rows(),layers)});
for(const [key,value] of [['customName','New manual'],['glazeId','ga2'],['coats',0],['method','brush'],['notes',''],['notes','Changed'],['method',null]])test('row identity inheritance '+key+'='+value,async()=>{const before=rows();const body=before.map(r=>({id:r.id}));body[2][key]=value;if(key==='customName')body[2].glazeId=null;assert.equal((await put({glazeIds:body})).status,200);const after=rows();const col={customName:'custom_name',glazeId:'glaze_id',method:'application_method'}[key]||key;for(let i=0;i<3;i++){assert.notEqual(after[i].id,before[i].id);const expected={...before[i],id:after[i].id};if(i===2){expected[col]=value;if(key==='customName')expected.glaze_id=null;}assert.deepEqual(after[i],expected)}});
for(const method of ['dip','brush','spray','pour','wax-resist','other',null])test('all supported methods '+method,async()=>{assert.equal((await put({glazeIds:[{id:'l1',application_method:method},{id:'l2'},{id:'l3'}]})).status,200);assert.equal(rows()[0].application_method,method)});
for(const alias of ['glazeIds','glaze_ids'])for(const stringify of [true,false])test('normalized aliases '+alias+' JSON '+stringify,async()=>{const layer={id:'l1',glaze_id:'ga2',custom_name:'Both',coats:0,applicationMethod:'other',notes:'Retained'};const value=[layer,{layer_id:'l2'},{layerId:'l3'}];assert.equal((await put({[alias]:stringify?JSON.stringify(value):value})).status,200);assert.equal(rows()[0].glaze_id,'ga2');assert.equal(rows()[0].custom_name,'Both');assert.equal(rows()[0].notes,'Retained');assert.equal(rows()[0].coats,0)});
test('explicit empty clears every layer',async()=>{assert.equal((await put({glazeIds:[]})).status,200);assert.deepEqual(rows(),[])});
test('flat legacy Glaze text never clears layers',async()=>{const before=rows();assert.equal((await put({glaze:'Legacy'})).status,200);assert.deepEqual(rows(),before)});
for(const bad of [null,'[object Object]',{},[{id:'stale'}],[{id:'l1',glaze_id:'gb'}],[{id:'l1',glazeId:'missing'}],[{id:'l1',glazeId:'ga',glaze_id:'ga2'}],[{id:'l1',method:'brush',application_method:'other'}],[{id:'l1'},{id:'l1'}],[{glazeId:'ga'}],[{id:'l1',coats:-1}],[{id:'l1',method:'invented'}]])test('Glaze rejection atomic '+JSON.stringify(bad),async()=>{const before=piece(),layers=rows();assert.equal((await put({title:'Rollback',glazeIds:bad})).status,400);assert.deepEqual(piece(),before);assert.deepEqual(rows(),layers)});
test('wrong Piece row identity fails atomically',async()=>{db.prepare("INSERT INTO piece_glazes(id,piece_id,glaze_id) VALUES('wrong','private-b','gb')").run();const before=rows();assert.equal((await put({glazeIds:[{id:'wrong'}]})).status,400);assert.deepEqual(rows(),before)});
test('conflicting array aliases fail atomically',async()=>{const before=rows();assert.equal((await put({glazeIds:[],glaze_ids:[{id:'l1'}]})).status,400);assert.deepEqual(rows(),before)});
test('same aliases are accepted after normalization',async()=>{assert.equal((await put({clayBodyId:'ca',clay_body_id:'ca',glazeIds:[{id:'l1',glazeId:'ga'}],glaze_ids:JSON.stringify([{layer_id:'l1',glaze_id:'ga'}])})).status,200)});
for(const alias of ['glazeIds','glaze_ids'])test('multipart create stores notes, zero coats and snake layer '+alias,async()=>{const fd=new FormData();fd.append('title','Multipart');fd.append('clayIntent','manual');fd.append('clay','Typed');fd.append(alias,JSON.stringify([{glaze_id:'ga',custom_name:'Both',coats:0,application_method:'other',notes:'Notes'}]));const r=await fetch(base+'/api/pieces',{method:'POST',headers:auth(tokenA),body:fd});assert.equal(r.status,200);const {id}=await r.json();const g=db.prepare('SELECT * FROM piece_glazes WHERE piece_id=?').get(id);assert.equal(g.notes,'Notes');assert.equal(g.coats,0);assert.equal(g.custom_name,'Both');assert.equal(g.application_method,'other')});
test('photo multipart unrelated update preserves exact relationships',async()=>{const before=rows();const fd=new FormData();fd.append('title','Photo update');fd.append('photo',new Blob(['photo'],{type:'image/jpeg'}),'photo.jpg');const r=await fetch(base+'/api/pieces/private-a',{method:'PUT',headers:auth(tokenA),body:fd});assert.equal(r.status,200);assert.deepEqual(rows(),before);assert.equal(piece().studio,'Historical')});
test('SQL insert failure rolls Piece and deletion back',async()=>{db.exec("CREATE TRIGGER reject_editor BEFORE INSERT ON piece_glazes WHEN NEW.notes='fail SQL' BEGIN SELECT RAISE(ABORT,'fixture'); END");const before=piece(),layers=rows();assert.equal((await put({title:'Rollback',glazeIds:[{id:'l1',notes:'fail SQL'}]})).status,400);assert.deepEqual(piece(),before);assert.deepEqual(rows(),layers);db.exec('DROP TRIGGER reject_editor')});
test('dangling untouched Clay and Glaze preserve exactly',async()=>{db.pragma('foreign_keys=OFF');db.prepare("UPDATE pieces SET clay_body_id='dangling' WHERE id='private-a'").run();db.prepare("UPDATE piece_glazes SET glaze_id='dangling' WHERE id='l1'").run();db.pragma('foreign_keys=ON');const before=rows();assert.equal((await put({title:'Unrelated'})).status,200);assert.deepEqual(rows(),before);assert.equal(piece().clay_body_id,'dangling')});
test('History after manual transition retains repeats order metadata and no fake timestamps',async()=>{assert.equal((await put({clayIntent:'manual',clay:'Typed',glazeIds:[{id:'l1'},{id:'l2'},{id:'l3',glazeId:null,customName:'Manual replacement'}]})).status,200);const h=require('../ql/piece-history.cjs').createPieceHistoryService(db).get({userId:'a',pieceId:'private-a'});assert.equal(h.clay,null);assert.equal(h.glazeLayers.length,3);for(const e of h.glazeLayers){assert.equal(e.relationshipDate,null);assert.equal(e.recordedAt,null)}const fresh=(await request('/api/pieces/private-a')).data;assert.equal(fresh.clay_body_id,null);assert.equal(fresh.glazes[2].glaze_id,null);assert.equal(fresh.glazes[2].notes,'Notes l3')});

test('manual Clay to saved clears replaced compatibility label',async()=>{db.prepare("UPDATE pieces SET clay_body_id=NULL,studio='Manual' WHERE id='private-a'").run();assert.equal((await put({clayIntent:'saved',clayBodyId:'ca2'})).status,200);assert.equal(piece().clay_body_id,'ca2');assert.equal(piece().studio,null)});
test('nullable stored layer order survives metadata edits',async()=>{db.prepare("UPDATE piece_glazes SET layer_order=NULL WHERE id='l1'").run();assert.equal((await put({glazeIds:[{id:'l1',layer_order:null,notes:'Changed'},{id:'l2'},{id:'l3'}]})).status,200);assert.equal(rows()[0].layer_order,null)});
