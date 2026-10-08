// Synthetic, loopback-only API checks. Runs with and without the opt-in QL migration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { migrate, link } = require('../ql/relationships.cjs');
const root = path.resolve(__dirname,'..');
const migrated = process.env.QL_TEST_MIGRATION === '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'ql-delete-api-'));
let server, db, output = '', passed = 0;
const secret = crypto.randomBytes(32).toString('hex');
const adminKey = crypto.randomBytes(32).toString('hex');
const port = 41000 + crypto.randomInt(10000);
const base = `http://127.0.0.1:${port}`;
async function request(route,method='DELETE',body,owner='a',admin=false) {
  const headers={Authorization:'Bearer '+jwt.sign({userId:owner,tier:'starter'},secret)};
  if(admin)headers['x-admin-key']=adminKey;
  if(body)headers['Content-Type']='application/json';
  const response=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined});
  const data=await response.json();return {status:response.status,data};
}
const get=(table,id)=>db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const file=name=>path.join(tmp,'data/uploads',name);
function seed(prefix,owner='a') {
  const first=prefix+'-1', second=prefix+'-2', firing=prefix+'-f', filename=prefix+'.jpg';
  for(const id of [first,second])db.prepare('INSERT INTO pieces(id,user_id,title) VALUES(?,?,?)').run(id,owner,id);
  db.prepare('INSERT INTO firing_logs(id,user_id,piece_id,notes) VALUES(?,?,?,?)').run(firing,owner,first,'Keep history');
  db.prepare('INSERT INTO piece_photos(id,piece_id,filename) VALUES(?,?,?)').run(prefix+'-p',first,filename);
  db.prepare('INSERT INTO firing_photos(id,firing_id,filename) VALUES(?,?,?)').run(prefix+'-fp',firing,filename);
  db.prepare('INSERT INTO sales(id,user_id,piece_id,price,quantity) VALUES(?,?,?,1.5,2)').run(prefix+'-s',owner,first);
  fs.writeFileSync(file(filename),'synthetic-photo');
  if(migrated)for(const pieceId of [first,second])link(db,{userId:owner,pieceId,kind:'firing',targetId:firing});
  return {first,second,firing,filename};
}
async function check(name,fn){await fn();passed++;console.log(`PASS ${migrated?'QL':'legacy'} API: ${name}`);}
(async()=>{
  for(const name of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,name),path.join(tmp,name));
  fs.mkdirSync(path.join(tmp,'ql'), {recursive:true}); fs.copyFileSync(path.join(root,'ql/relationships.cjs'),path.join(tmp,'ql/relationships.cjs'));fs.copyFileSync(path.join(root,'ql/piece-editor.cjs'),path.join(tmp,'ql/piece-editor.cjs'));fs.copyFileSync(path.join(root,'ql/photo-query-safety.cjs'),path.join(tmp,'ql/photo-query-safety.cjs'));
  fs.copyFileSync(path.join(root,'ql/photo-result-confidence.cjs'),path.join(tmp,'ql/photo-result-confidence.cjs'));
  fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});
  for(const name of ['node_modules','public'])fs.symlinkSync(path.join(root,name),path.join(tmp,name),'dir');
  fs.writeFileSync(path.join(tmp,'loopback.cjs'),"const net=require('node:net');const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';return listen.apply(this,args);};");
  server=spawn(process.execPath,['--require','./loopback.cjs','server.js'],{cwd:tmp,env:{PATH:process.env.PATH,NODE_ENV:'test',PORT:String(port),APP_URL:base,JWT_SECRET:secret,ADMIN_API_KEY:adminKey},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',c=>output+=c);server.stderr.on('data',c=>output+=c);
  for(let i=0;i<150&&!output.includes('running on');i++){if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}
  assert.ok(output.includes('running on'),output);
  db=new Database(path.join(tmp,'data/pottery.db'));db.pragma('foreign_keys=ON');
  if(migrated)migrate(db);
  for(const id of ['a','b','delete-self','delete-admin'])db.prepare('INSERT INTO users(id,email,password_hash,tier) VALUES(?,?,?,?)').run(id,id+'@example.invalid','synthetic','starter');
  await check('single Piece delete retains firing/photo/sale, repeat succeeds',async()=>{
    const s=seed('single');const before=get('firing_logs',s.firing);
    assert.equal((await request('/api/pieces/'+s.first)).status,200);
    assert.deepEqual(get('firing_logs',s.firing),{...before,piece_id:null});
    assert.ok(get('firing_photos','single-fp'));assert.ok(fs.existsSync(file(s.filename)));
    assert.equal(get('sales','single-s').piece_id,null);
    assert.equal((await request('/api/pieces/'+s.first)).status,200);
    if(migrated)assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings WHERE firing_id=?').get(s.firing).n,1);
  });
  for(const type of ['pieces','casualties'])await check(`${type} bulk order and foreign IDs are safe`,async()=>{
    const own=seed(type),foreign=seed(type+'-foreign','b');
    const before=get('pieces',foreign.first);
    const result=await request('/api/bulk-delete','POST',{type,ids:[own.second,foreign.first,own.first,own.first]});
    assert.deepEqual(result.data,{success:true,deleted:2,errors:[]});
    assert.deepEqual(get('pieces',foreign.first),before);assert.ok(get('piece_photos',type+'-foreign-p'));
    assert.ok(fs.existsSync(file(foreign.filename)));assert.ok(get('firing_logs',own.firing));
    assert.equal(get('firing_logs',own.firing).piece_id,null);assert.ok(fs.existsSync(file(own.filename)));
    if(migrated)assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings WHERE firing_id=?').get(own.firing).n,0);
  });
  await check('Piece-only file removed; another account file reference preserved',async()=>{
    const s=seed('private');db.prepare('DELETE FROM firing_photos WHERE firing_id=?').run(s.firing);
    assert.equal((await request('/api/pieces/'+s.first)).status,200);assert.equal(fs.existsSync(file(s.filename)),false);
    const shared=seed('cross-photo');db.prepare('DELETE FROM firing_photos WHERE firing_id=?').run(shared.firing);
    const foreign=seed('cross-photo-b','b');db.prepare('UPDATE piece_photos SET filename=? WHERE piece_id=?').run(shared.filename,foreign.first);
    await request('/api/pieces/'+shared.first);assert.ok(fs.existsSync(file(shared.filename)));assert.ok(get('piece_photos','cross-photo-b-p'));
    assert.equal((await request('/api/pieces/'+foreign.first)).status,200);assert.ok(get('pieces',foreign.first));
  });
  await check('direct Piece/firing photo routes enforce ownership and reference counts',async()=>{
    const s=seed('photo');
    assert.equal((await request('/api/photos/photo-p','DELETE',undefined,'b')).status,404);
    assert.equal((await request('/api/photos/photo-p')).status,200);assert.ok(fs.existsSync(file(s.filename)));
    assert.equal((await request('/api/firing-photos/photo-fp','DELETE',undefined,'b')).status,403);
    assert.equal((await request('/api/firing-photos/photo-fp')).status,200);assert.equal(fs.existsSync(file(s.filename)),false);
  });
  await check('explicit single/bulk firing deletion cleans links and respects shared files',async()=>{
    for(const bulk of [false,true]) {
      const prefix='fire-'+bulk,s=seed(prefix);
      await request('/api/firing-logs/'+s.firing,'DELETE',undefined,'b');assert.ok(get('firing_logs',s.firing));
      const response=bulk?await request('/api/bulk-delete','POST',{type:'firing-logs',ids:[s.firing]}):await request('/api/firing-logs/'+s.firing);
      assert.equal(response.status,200);assert.equal(get('firing_logs',s.firing),undefined);assert.equal(get('firing_photos',prefix+'-fp'),undefined);
      assert.ok(get('pieces',s.first));assert.ok(fs.existsSync(file(s.filename)));
      if(migrated)assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings WHERE firing_id=?').get(s.firing).n,0);
    }
  });
  await check('cross-owner legacy reference blocks Piece and account deletion before mutations',async()=>{
    const s=seed('invalid');db.prepare("INSERT INTO firing_logs(id,user_id,piece_id) VALUES('invalid-foreign','b',?)").run(s.first);
    assert.equal((await request('/api/pieces/'+s.first)).status,409);
    const result=await request('/api/bulk-delete','POST',{type:'pieces',ids:[s.first]});assert.equal(result.data.deleted,0);assert.equal(result.data.errors.length,1);
    assert.ok(get('piece_photos','invalid-p'));assert.ok(fs.existsSync(file(s.filename)));
    const before=get('users','a');assert.ok((await request('/api/account')).status>=400);assert.deepEqual(get('users','a'),before);
    assert.equal(get('firing_logs','invalid-foreign').piece_id,s.first);
    db.prepare("DELETE FROM firing_logs WHERE id='invalid-foreign'").run();
  });
  await check('account SQL failure rolls back all prior cleanup for self and admin',async()=>{
    for(const admin of [false,true]) {
      const owner=admin?'delete-admin':'delete-self',prefix='rollback-'+owner,s=seed(prefix,owner);
      db.exec(`CREATE TRIGGER prevent_account_delete BEFORE DELETE ON users WHEN OLD.id='${owner}' BEGIN SELECT RAISE(ABORT,'injected failure'); END;`);
      const photo=get('piece_photos',prefix+'-p'),firing=get('firing_logs',s.firing);
      const result=admin?await request('/api/admin/members/'+owner,'DELETE',undefined,'a',true):await request('/api/account','DELETE',undefined,owner);
      assert.equal(result.status,500);assert.ok(get('users',owner));assert.deepEqual(get('piece_photos',prefix+'-p'),photo);
      assert.deepEqual(get('firing_logs',s.firing),firing);assert.ok(fs.existsSync(file(s.filename)));
      db.exec('DROP TRIGGER prevent_account_delete');
    }
  });
  for(const admin of [false,true])await check(`${admin?'admin':'self'} account deletion cleans QL rows; preserves other account and files`,async()=>{
    const owner=admin?'delete-admin':'delete-self',s=seed(owner,owner),other=seed(owner+'-other','b');
    db.prepare('UPDATE piece_photos SET filename=? WHERE piece_id=?').run(s.filename,other.first);
    const before=get('pieces',other.first);
    const result=admin?await request('/api/admin/members/'+owner,'DELETE',undefined,'a',true):await request('/api/account','DELETE',undefined,owner);
    assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(get('users',owner),undefined);
    assert.equal(get('firing_logs',s.firing),undefined);assert.equal(get('piece_photos',owner+'-p'),undefined);
    assert.deepEqual(get('pieces',other.first),before);assert.ok(fs.existsSync(file(s.filename)));
    if(migrated)assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_firings WHERE user_id=?').get(owner).n,0);
  });
  assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
  console.log(`PASS ${passed} deletion API checks (${migrated?'QL':'legacy'})`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(db)db.close();if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
  fs.rmSync(tmp,{recursive:true,force:true});
});
