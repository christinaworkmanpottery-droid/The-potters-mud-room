// Phase 3B relationship service/API checks. Synthetic loopback only; never production.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ql-rel-service-api-'));
const secret=crypto.randomBytes(32).toString('hex'),adminKey=crypto.randomBytes(32).toString('hex');
const port=44000+crypto.randomInt(7000),base='http://127.0.0.1:'+port;let server,db,output='',passed=0;
let tokenTier='starter';const token=owner=>jwt.sign({userId:owner,tier:tokenTier},secret);
async function request(route,method='GET',body,owner='a',extraHeaders={}){
 const headers={...extraHeaders};if(owner)headers.Authorization='Bearer '+token(owner);
 if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 let data=null;try{data=await response.json();}catch{} return {status:response.status,data,cache:response.headers.get('Cache-Control'),available:response.headers.get('X-QL-Relationships-Available')};
}
async function check(name,fn){await fn();passed++;console.log('PASS Phase 3C API: '+name);}
function seed(owner,prefix){
 db.prepare('INSERT INTO users(id,email,password_hash,tier) VALUES(?,?,?,?)').run(owner,owner+'@example.invalid','synthetic','starter');
 db.prepare('INSERT INTO pieces(id,user_id,title,status) VALUES(?,?,?,?)').run(prefix+'-p',owner,prefix+' Piece','done');
 db.prepare('INSERT INTO firing_logs(id,user_id,piece_id,notes) VALUES(?,?,?,?)').run(prefix+'-legacy',owner,prefix+'-p','legacy direct link');
 db.prepare('INSERT INTO firing_logs(id,user_id,notes) VALUES(?,?,?)').run(prefix+'-f',owner,'explicit firing');
 db.prepare('INSERT INTO test_tiles(id,user_id,clay_name,glaze_name) VALUES(?,?,?,?)').run(prefix+'-t',owner,'Manual clay','Manual glaze');
 db.prepare('INSERT INTO pricing_calculations(id,user_id,inputs_json,result_json) VALUES(?,?,?,?)').run(prefix+'-pr',owner,'{}','{}');
}
(async()=>{
 for(const name of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,name),path.join(tmp,name));
 fs.mkdirSync(path.join(tmp,'ql'));fs.copyFileSync(path.join(root,'ql/relationships.cjs'),path.join(tmp,'ql/relationships.cjs'));fs.copyFileSync(path.join(root,'ql/piece-editor.cjs'),path.join(tmp,'ql/piece-editor.cjs'));fs.copyFileSync(path.join(root,'ql/piece-history.cjs'),path.join(tmp,'ql/piece-history.cjs'));
 fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});
 for(const name of ['node_modules','public'])fs.symlinkSync(path.join(root,name),path.join(tmp,name),'dir');
 fs.writeFileSync(path.join(tmp,'loopback.cjs'),"const net=require('node:net');const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';return listen.apply(this,args);};");
 server=spawn(process.execPath,['--require','./loopback.cjs','server.js'],{cwd:tmp,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:String(port),APP_URL:base,JWT_SECRET:secret,ADMIN_API_KEY:adminKey},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
 for(let i=0;i<150&&!output.includes('running on');i++){if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
 assert.ok(output.includes('running on'),output);
 db=new Database(path.join(tmp,'data/pottery.db'));db.pragma('foreign_keys=ON');
 require('../ql/relationships.cjs').migrate(db);seed('a','a');seed('b','b');



 const route='/api/ql/pieces/a-p/test-tiles';
 const post=(id,p='a-p')=>request('/api/ql/pieces/'+p+'/test-tiles','POST',{testTileId:id});
 const del=(id,p='a-p')=>request('/api/ql/pieces/'+p+'/test-tiles/'+id,'DELETE');
 db.pragma('ignore_check_constraints=ON');
 const tier=t=>db.prepare('UPDATE users SET tier=? WHERE id=?').run(t,'a');
 const count=()=>db.prepare('SELECT count(*) n FROM ql_piece_test_tiles').get().n;
 const history=async()=> (await request('/api/ql/pieces/a-p/history')).data;
 db.prepare("INSERT INTO pieces(id,user_id,title) VALUES('a-p2','a','Second')").run();
 db.prepare("INSERT INTO test_tiles(id,user_id,name,photo_filename,photo_filename2,photo_filename3) VALUES('a-t2','a','Secret tile','first.jpg',NULL,'third.jpg')").run();
 fs.writeFileSync(path.join(tmp,'data/uploads/first.jpg'),'photo');fs.writeFileSync(path.join(tmp,'data/uploads/third.jpg'),'photo');
 for(const t of ['starter','basic','mid','top']) await check('current DB qualifying '+t+' overrides free token with no billing',async()=>{tier(t);tokenTier='free';for(const url of ['/api/test-tiles','/api/test-tiles/a-t',route,'/api/ql/test-tiles/a-t2/photos/1'])assert.equal((await request(url)).status,200);assert.equal((await request('/api/test-tiles/preview')).data.available,true);});
 tokenTier='starter';
 await check('explicit multiple Link and idempotent status',async()=>{for(const id of ['a-t','a-t2','a-t'])assert.equal((await post(id)).status,201);assert.equal(count(),2);assert.equal((await request(route)).data.length,2);});
 await check('one tile across Pieces',async()=>{await post('a-t2','a-p2');assert.equal(count(),3);});
 const before=JSON.stringify(db.prepare('SELECT * FROM ql_piece_test_tiles ORDER BY id').all());
 for(const t of ['free','unknown',''])await check('locked '+JSON.stringify(t)+' fails closed despite entitled token',async()=>{tier(t);for(const [url,method,body] of [[route,'GET'],[route,'POST',{testTileId:'a-t'}],[route+'/a-t','DELETE'],['/api/test-tiles','GET'],['/api/test-tiles/a-t2','GET'],['/api/ql/test-tiles/a-t2/photos/1','GET']]){const r=await request(url,method,body);assert.equal(r.status,403);assert.deepEqual(r.data,{error:'Upgrade to Unlimited to use this feature.',code:'TEST_TILE_ENTITLEMENT_REQUIRED'});assert.match(r.cache,/private.*no-store/);}assert.equal((await request('/api/test-tiles/preview')).data.available,false);assert.equal(JSON.stringify(db.prepare('SELECT * FROM ql_piece_test_tiles ORDER BY id').all()),before);});
 await check('locked bulk deletion cannot remove hidden Test Tile associations',async()=>{const r=await request('/api/bulk-delete','POST',{type:'test-tiles',ids:['a-t2']});assert.equal(r.status,403);assert.equal(count(),3);});
 await check('locked generic photo replacement cannot edit Test Tile media',async()=>{const r=await request('/api/photos/by-filename/first.jpg','PUT');assert.equal(r.status,403);assert.equal(r.data.code,'TEST_TILE_ENTITLEMENT_REQUIRED');assert.equal(fs.readFileSync(path.join(tmp,'data/uploads/first.jpg'),'utf8'),'photo');});
 await check('locked History excludes tiles before timeline without tile placeholders',async()=>{const h=await history();assert.equal(h.testTilesAccess,'locked');assert.deepEqual(h.testTiles,[]);assert.ok(h.history.every(e=>e.recordType!=='test-tile'));for(const secret of ['Secret tile','a-t2','third.jpg','first.jpg','test_tile_id'])assert.ok(!JSON.stringify(h).includes(secret));assert.equal(h.firings.length,1);assert.equal(h.piece.values.id,'a-p');});
 await check('re-upgrade restores surviving associations details and protected media',async()=>{tier('basic');assert.equal((await request(route)).data.length,2);const h=await history();assert.equal(h.testTilesAccess,'available');assert.equal(h.testTiles.length,2);assert.equal((await request('/api/ql/test-tiles/a-t2/photos/3')).status,200);assert.equal(JSON.stringify(db.prepare('SELECT * FROM ql_piece_test_tiles ORDER BY id').all()),before);});
 await check('canonical serialization and same-owner library enrichment',async()=>{db.prepare("INSERT INTO glazes(id,user_id,name) VALUES('g','a','Library glaze')").run();db.prepare("INSERT INTO clay_bodies(id,user_id,name) VALUES('c','a','Library clay')").run();db.prepare("UPDATE test_tiles SET glaze_id='g',clay_body_id='c',notes='Saved notes',cone='6' WHERE id='a-t2'").run();const detail=(await request('/api/test-tiles/a-t2')).data;assert.equal(detail.glaze_library_name,'Library glaze');assert.equal(detail.clay_library_name,'Library clay');assert.equal(detail.photo_filename,'first.jpg');assert.equal(detail.photo_filename2,null);assert.equal(detail.photo_filename3,'third.jpg');assert.equal(detail.photoDelivery,'owner-protected');assert.equal(detail.photoDelivery3,'owner-protected');assert.equal(detail.photoVisibility3,'legacy-ambiguous');assert.deepEqual((await request(route)).data.find(x=>x.id==='a-t2'),detail);assert.deepEqual((await request('/api/test-tiles')).data.find(x=>x.id==='a-t2'),detail);assert.deepEqual((await history()).testTiles.find(x=>x.sourceRecordId==='a-t2').values,detail);});
 await check('foreign library enrichment never leaks name',async()=>{db.prepare("UPDATE glazes SET user_id='b' WHERE id='g'").run();assert.equal((await request('/api/test-tiles/a-t2')).data.glaze_library_name,null);db.prepare("UPDATE glazes SET user_id='a' WHERE id='g'").run();});
 for(const id of ['missing','b-p'])for(const t of ['free','starter'])await check('Piece 404 precedes entitlement '+id+' '+t,async()=>{tier(t);for(const m of ['GET','POST','DELETE']){const r=await request('/api/ql/pieces/'+id+'/test-tiles'+(m==='DELETE'?'/a-t':''),m,m==='POST'?{testTileId:'a-t'}:undefined);assert.equal(r.status,404);}});
 for(const m of ['GET','POST','DELETE'])await check('invalid session first '+m,async()=>{assert.equal((await request(route+(m==='DELETE'?'/a-t':''),m,m==='POST'?{testTileId:'a-t'}:undefined,null)).status,401);});
 tier('starter');
 for(const id of ['missing','b-t'])await check('missing foreign target '+id,async()=>{assert.equal((await post(id)).status,404);assert.equal((await del(id)).status,404);});
 await check('Unlink only association and repeat false',async()=>{assert.deepEqual((await del('a-t2')).data,{removed:true});assert.deepEqual((await del('a-t2')).data,{removed:false});assert.ok(db.prepare("SELECT 1 FROM test_tiles WHERE id='a-t2'").get());assert.equal((await request('/api/ql/pieces/a-p2/test-tiles')).data.length,1);});
 await check('Piece deletion preserves shared tile and unrelated associations',async()=>{await post('a-t2');await request('/api/pieces/a-p2','DELETE');assert.ok(db.prepare("SELECT 1 FROM test_tiles WHERE id='a-t2'").get());assert.equal((await request(route)).data.length,2);});
 await check('Tile deletion preserves Piece other links and repeats 404',async()=>{await request('/api/test-tiles/a-t2','DELETE');assert.ok(db.prepare("SELECT 1 FROM pieces WHERE id='a-p'").get());assert.equal((await request(route)).data.length,1);assert.equal((await del('a-t2')).status,404);});
 await check('entitled zero is available empty',async()=>{await del('a-t');const r=await request(route);assert.deepEqual(r.data,[]);assert.equal(r.available,'true');const h=await history();assert.equal(h.testTilesAccess,'available');assert.deepEqual(h.testTiles,[]);});
 await check('missing DB account fails closed standalone despite signed entitled token',async()=>{for(const u of ['/api/test-tiles','/api/test-tiles/a-t','/api/ql/test-tiles/a-t/photos/1'])assert.equal((await request(u,'GET',undefined,'deleted-account')).status,403);assert.equal((await request('/api/test-tiles/preview','GET',undefined,'deleted-account')).data.available,false);});
 await check('missing database tier column fails closed',async()=>{db.exec('ALTER TABLE users RENAME COLUMN tier TO hidden_tier');assert.equal((await request('/api/test-tiles','GET',undefined,'a',{'x-admin-key':adminKey})).status,403);db.exec('ALTER TABLE users RENAME COLUMN hidden_tier TO tier');});
 await post('a-t');db.exec('DROP TABLE ql_piece_pricing');
 for(const t of ['free','starter'])await check('established all-table availability takes precedence '+t,async()=>{tier(t);const r=await request(route);assert.equal(r.status,200);assert.deepEqual(r.data,[]);assert.equal(r.available,'false');assert.equal((await post('a-t')).status,409);assert.equal((await del('a-t')).status,409);assert.equal((await history()).testTilesAccess,'unavailable');assert.deepEqual((await history()).testTiles,[]);assert.equal(count(),1);assert.equal((await request('/api/ql/pieces/missing/test-tiles')).status,404);});
 console.log('PASS '+passed+' Phase 3C API checks');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{try{db?.close();}catch{}if(server&&!server.killed)server.kill('SIGTERM');});
