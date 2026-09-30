// Phase 3A relationship service/API checks. Synthetic loopback only; never production.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ql-rel-service-api-'));
const secret=crypto.randomBytes(32).toString('hex'),adminKey=crypto.randomBytes(32).toString('hex');
const port=44000+crypto.randomInt(7000),base='http://127.0.0.1:'+port;let server,db,output='',passed=0;
const token=owner=>jwt.sign({userId:owner,tier:'starter'},secret);
async function request(route,method='GET',body,owner='a',extraHeaders={}){
 const headers={...extraHeaders};if(owner)headers.Authorization='Bearer '+token(owner);
 if(body!==undefined)headers['Content-Type']='application/json';
 const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 let data=null;try{data=await response.json();}catch{} return {status:response.status,data,available:response.headers.get('X-QL-Relationships-Available')};
}
async function check(name,fn){await fn();passed++;console.log('PASS Phase 3A API: '+name);}
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
 fs.mkdirSync(path.join(tmp,'ql'));fs.copyFileSync(path.join(root,'ql/relationships.cjs'),path.join(tmp,'ql/relationships.cjs'));fs.copyFileSync(path.join(root,'ql/piece-history.cjs'),path.join(tmp,'ql/piece-history.cjs'));
 fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});
 for(const name of ['node_modules','public'])fs.symlinkSync(path.join(root,name),path.join(tmp,name),'dir');
 fs.writeFileSync(path.join(tmp,'loopback.cjs'),"const net=require('node:net');const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';return listen.apply(this,args);};");
 server=spawn(process.execPath,['--require','./loopback.cjs','server.js'],{cwd:tmp,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:String(port),APP_URL:base,JWT_SECRET:secret,ADMIN_API_KEY:adminKey},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
 for(let i=0;i<150&&!output.includes('running on');i++){if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
 assert.ok(output.includes('running on'),output);
 db=new Database(path.join(tmp,'data/pottery.db'));db.pragma('foreign_keys=ON');
 require('../ql/relationships.cjs').migrate(db);seed('a','a');seed('b','b');


 const route='/api/ql/pieces/a-p/pricing';
 const post=id=>request(route,'POST',{pricingId:id,userId:'b'});
 const del=id=>request(route+'/'+id,'DELETE');
 await check('empty array retains available signal',async()=>{const r=await request(route);assert.deepEqual(r.data,[]);assert.equal(r.available,'true');});
 await check('link creates only association',async()=>{const before=db.prepare('SELECT count(*) n FROM pricing_calculations').get().n;assert.equal((await post('a-pr')).status,201);assert.equal(db.prepare('SELECT count(*) n FROM pricing_calculations').get().n,before);});
 await check('one linked record',async()=>{assert.deepEqual((await request(route)).data.map(x=>x.id),['a-pr']);assert.deepEqual((await request('/api/ql/pieces/a-p/history')).data.pricing.map(x=>x.sourceRecordId),['a-pr']);});
 await check('repeat link idempotent',async()=>{await post('a-pr');assert.equal((await request(route)).data.length,1);});
 await check('multiple calculations and eligible saved records',async()=>{db.prepare("INSERT INTO pricing_calculations(id,user_id,name,inputs_json,result_json) VALUES('a-pr2','a','Second','{}','{}')").run();await post('a-pr2');assert.equal((await request(route)).data.length,2);const r=await request('/api/pricing-calculations');assert.ok(r.data.every(x=>x.id.startsWith('a-')));});
 await check('canonical detail serialization and protected photo metadata',async()=>{db.prepare("UPDATE pricing_calculations SET inputs_json=?,result_json=?,photo_filename='saved.jpg' WHERE id='a-pr'").run('{"clayCost":4}','{"suggestedPrice":25}');const r=await request('/api/pricing-calculations/a-pr');assert.deepEqual(r.data.inputs,{clayCost:4});assert.deepEqual(r.data.result,{suggestedPrice:25});assert.equal(r.data.photoDelivery,'owner-protected');assert.equal(r.data.photo_filename,'saved.jpg');assert.equal(r.data.inputs_json,undefined);const linked=(await request(route)).data.find(x=>x.id==='a-pr');assert.deepEqual(linked.inputs,r.data.inputs);assert.deepEqual(linked.result,r.data.result);assert.equal(linked.inputs_json,'{"clayCost":4}');assert.equal(linked.photoDelivery,'owner-protected');});
 await check('edits update referenced record',async()=>{db.prepare("UPDATE pricing_calculations SET name='Edited' WHERE id='a-pr'").run();assert.equal((await request('/api/pricing-calculations/a-pr')).data.name,'Edited');assert.equal((await request(route)).data.length,2);});
 for(const id of ['missing','b-p'])await check('Piece unavailable '+id,async()=>{for(const method of ['GET','POST','DELETE']){const r=await request('/api/ql/pieces/'+id+'/pricing'+(method==='DELETE'?'/a-pr':''),method,method==='POST'?{pricingId:'a-pr'}:undefined);assert.equal(r.status,404);assert.equal(r.data.error,'Relationship unavailable');}});
 for(const id of ['missing','b-pr'])await check('Pricing unavailable '+id,async()=>{assert.equal((await post(id)).status,404);assert.equal((await del(id)).status,404);});
 await check('cross-account and supplied owner ignored',async()=>{assert.equal(db.prepare("SELECT user_id FROM ql_piece_pricing WHERE pricing_id='a-pr'").get().user_id,'a');assert.equal((await request(route,'POST',{pricingId:'a-pr'},'b')).status,404);});
 await check('unlink preserves endpoints and other pair',async()=>{assert.equal((await del('a-pr')).data.removed,true);assert.equal((await request('/api/pricing-calculations/a-pr')).status,200);assert.equal((await request('/api/pieces/a-p')).status,200);assert.deepEqual((await request(route)).data.map(x=>x.id),['a-pr2']);assert.deepEqual((await request('/api/ql/pieces/a-p/history')).data.pricing.map(x=>x.sourceRecordId),['a-pr2']);});
 await check('repeat unlink harmless',async()=>{assert.equal((await del('a-pr')).data.removed,false);});
 await check('Pricing deletion preserves Piece and unrelated associations',async()=>{await post('a-pr');assert.equal((await request('/api/pricing-calculations/a-pr','DELETE')).status,200);assert.equal((await request('/api/pieces/a-p')).status,200);assert.deepEqual((await request(route)).data.map(x=>x.id),['a-pr2']);assert.deepEqual((await request('/api/ql/pieces/a-p/history')).data.pricing.map(x=>x.sourceRecordId),['a-pr2']);});
 await check('deleted target cannot be linked',async()=>{assert.equal((await post('a-pr')).status,404);});
 await check('Piece deletion preserves Pricing and unrelated associations',async()=>{await request('/api/ql/pieces/b-p/pricing','POST',{pricingId:'b-pr'},'b');assert.equal((await request('/api/pieces/a-p','DELETE')).status,200);assert.equal((await request('/api/pricing-calculations/a-pr2')).status,200);assert.equal(db.prepare("SELECT count(*) n FROM ql_piece_pricing WHERE user_id='a'").get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM ql_piece_pricing WHERE user_id='b'").get().n,1);});
 await check('stale targets filtered without repair',async()=>{db.pragma('foreign_keys=OFF');db.exec("DROP TRIGGER ql_piece_pricing_update; UPDATE ql_piece_pricing SET pricing_id='deleted' WHERE user_id='b'");db.pragma('foreign_keys=ON');assert.deepEqual((await request('/api/ql/pieces/b-p/pricing','GET',undefined,'b')).data,[]);assert.equal(db.prepare("SELECT count(*) n FROM ql_piece_pricing WHERE pricing_id='deleted'").get().n,1);});
 await check('legacy database list clearly unavailable and mutations fail safely',async()=>{db.exec('DROP TABLE ql_piece_pricing');const r=await request('/api/ql/pieces/b-p/pricing','GET',undefined,'b');assert.deepEqual(r.data,[]);assert.equal(r.available,'false');for(const method of ['POST','DELETE'])assert.equal((await request('/api/ql/pieces/b-p/pricing'+(method==='DELETE'?'/b-pr':''),method,{pricingId:'b-pr'},'b')).status,409);});
 await check('legacy still rejects foreign Piece',async()=>{assert.equal((await request('/api/ql/pieces/b-p/pricing')).status,404);});
 console.log('PASS '+passed+' Phase 3A relationship service/API checks');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{try{db?.close();}catch{}if(server&&!server.killed)server.kill('SIGTERM');});
