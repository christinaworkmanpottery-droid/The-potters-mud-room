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
async function check(name,fn){await fn();passed++;console.log(`PASS ${migrated?'QL':'legacy'} API: ${name}`);}
(async()=>{
  for(const name of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,name),path.join(tmp,name));
  fs.mkdirSync(path.join(tmp,'ql'), {recursive:true}); fs.copyFileSync(path.join(root,'ql/relationships.cjs'),path.join(tmp,'ql/relationships.cjs'));fs.copyFileSync(path.join(root,'ql/piece-editor.cjs'),path.join(tmp,'ql/piece-editor.cjs'));
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
  function studio(prefix,owner='a') {
    db.prepare('INSERT INTO clay_bodies(id,user_id,name) VALUES(?,?,?)').run(prefix+'-c',owner,'Clay history');
    db.prepare('INSERT INTO glazes(id,user_id,name) VALUES(?,?,?)').run(prefix+'-g',owner,'Glaze history');
    db.prepare('INSERT INTO pieces(id,user_id,clay_body_id) VALUES(?,?,?)').run(prefix+'-p',owner,prefix+'-c');
    db.prepare('INSERT INTO piece_glazes(id,piece_id,glaze_id,coats,notes) VALUES(?,?,?,3,?)').run(prefix+'-l',prefix+'-p',prefix+'-g','Keep notes');
    db.prepare('INSERT INTO test_tiles(id,user_id,clay_body_id,glaze_id,photo_filename,photo_filename2,photo_filename3) VALUES(?,?,?,?,?,?,?)').run(prefix+'-t',owner,prefix+'-c',prefix+'-g',prefix+'-t.jpg',prefix+'-t2.jpg',prefix+'-t3.jpg');
    db.prepare('INSERT INTO firing_logs(id,user_id,piece_id,notes) VALUES(?,?,?,?)').run(prefix+'-f',owner,prefix+'-p','Keep firing');
    db.prepare('INSERT INTO glaze_clay_tests(id,glaze_id,clay_body_id,clay_name,photo_filename) VALUES(?,?,?,?,?)').run(prefix+'-ct',prefix+'-g',prefix+'-c','Historical clay',prefix+'-ct.jpg');
    for(const [table,col,suffix]of [['clay_photos','clay_id','c'],['glaze_photos','glaze_id','g']])db.prepare(`INSERT INTO ${table}(id,${col},filename) VALUES(?,?,?)`).run(prefix+'-'+suffix+'photo',prefix+'-'+suffix,prefix+'-'+suffix+'.jpg');
    for(const suffix of ['c','g','t','t2','t3','ct'])fs.writeFileSync(file(prefix+'-'+suffix+'.jpg'),'synthetic');
    if(migrated){link(db,{userId:owner,pieceId:prefix+'-p',kind:'testTile',targetId:prefix+'-t'});link(db,{userId:owner,pieceId:prefix+'-p',kind:'firing',targetId:prefix+'-f'});}
  }
  async function form(route,method,values,owner='a') {
    const body=new FormData();for(const [k,v]of Object.entries(values))body.append(k,v);
    const response=await fetch(base+route,{method,headers:{Authorization:'Bearer '+jwt.sign({userId:owner,tier:'starter'},secret)},body});
    return {status:response.status,data:await response.json()};
  }
  const types=[['clay-bodies','clay_bodies','c'],['glazes','glazes','g'],['test-tiles','test_tiles','t']];
  for(const [route,table,suffix]of types){
    await check(`${route} single ownership, private cleanup, history and repeated 404`,async()=>{
      const p='single-'+suffix;studio(p);const firing=get('firing_logs',p+'-f');
      assert.equal((await request('/api/'+route+'/'+p+'-'+suffix,'DELETE',undefined,'b')).status,404);
      assert.ok(get(table,p+'-'+suffix));assert.ok(fs.existsSync(file(p+'-'+suffix+'.jpg')));
      assert.equal((await request('/api/'+route+'/'+p+'-'+suffix)).status,200);
      assert.equal((await request('/api/'+route+'/'+p+'-'+suffix)).status,404);
      assert.equal(get(table,p+'-'+suffix),undefined);assert.equal(fs.existsSync(file(p+'-'+suffix+'.jpg')),false);
      assert.ok(get('pieces',p+'-p'));assert.deepEqual(get('firing_logs',p+'-f'),firing);
      if(suffix==='c'){assert.equal(get('pieces',p+'-p').clay_body_id,null);assert.equal(get('test_tiles',p+'-t').clay_name,'Clay history');assert.ok(get('glaze_clay_tests',p+'-ct'));}
      if(suffix==='g'){assert.equal(get('piece_glazes',p+'-l').glaze_id,null);assert.equal(get('piece_glazes',p+'-l').notes,'Keep notes');assert.equal(get('test_tiles',p+'-t').glaze_name,'Glaze history');}
      if(migrated)assert.equal(db.prepare('SELECT count(*) n FROM ql_piece_test_tiles WHERE piece_id=?').get(p+'-p').n,suffix==='t'?0:1);
    });
    await check(`${route} bulk mixed ownership, duplicates, missing and shared files`,async()=>{
      const p='bulk-'+suffix,q=p+'-other',r=p+'-foreign';studio(p);studio(q);studio(r,'b');
      const slot=suffix==='t'?'test_tiles':suffix==='c'?'clay_photos':'glaze_photos';const col=suffix==='t'?'photo_filename':'filename';
      db.prepare(`UPDATE ${slot} SET ${col}=? WHERE id=?`).run(p+'-'+suffix+'.jpg',q+'-'+suffix+(suffix==='t'?'':'photo'));
      const before=get(table,r+'-'+suffix);
      let response=await request('/api/bulk-delete','POST',{type:route,ids:[p+'-'+suffix,r+'-'+suffix,'missing',p+'-'+suffix]});
      assert.deepEqual(response.data,{success:true,deleted:1,errors:[]});assert.ok(fs.existsSync(file(p+'-'+suffix+'.jpg')));assert.deepEqual(get(table,r+'-'+suffix),before);
      response=await request('/api/bulk-delete','POST',{type:route,ids:[q+'-'+suffix]});assert.equal(response.data.deleted,1);assert.equal(fs.existsSync(file(p+'-'+suffix+'.jpg')),false);
    });
    await check(`${route} single and bulk SQL failure roll back; bulk continues valid IDs`,async()=>{
      const p='rollback-'+suffix,q=p+'-ok';studio(p);studio(q);
      db.exec(`CREATE TRIGGER fail_studio BEFORE DELETE ON ${table} WHEN OLD.id='${p}-${suffix}' BEGIN SELECT RAISE(ABORT,'injected failure'); END;`);
      const before=get(table,p+'-'+suffix),layer=get('piece_glazes',p+'-l');
      assert.equal((await request('/api/'+route+'/'+p+'-'+suffix)).status,500);
      const response=await request('/api/bulk-delete','POST',{type:route,ids:[p+'-'+suffix,q+'-'+suffix]});assert.equal(response.data.deleted,1);assert.equal(response.data.errors.length,1);
      assert.deepEqual(get(table,p+'-'+suffix),before);assert.deepEqual(get('piece_glazes',p+'-l'),layer);assert.ok(fs.existsSync(file(p+'-'+suffix+'.jpg')));
      db.exec('DROP TRIGGER fail_studio');
    });
    await check(`${route} invalid relationship rejects single/bulk without changing either account`,async()=>{
      const p='invalid-'+suffix,q=p+'-foreign';studio(p);studio(q,'b');
      if(suffix==='c')db.prepare('UPDATE pieces SET clay_body_id=? WHERE id=?').run(p+'-c',q+'-p');
      if(suffix==='g')db.prepare('UPDATE piece_glazes SET glaze_id=? WHERE id=?').run(p+'-g',q+'-l');
      if(suffix==='t')db.prepare('UPDATE test_tiles SET glaze_id=? WHERE id=?').run(q+'-g',p+'-t');
      const before=get(table,p+'-'+suffix);
      assert.equal((await request('/api/'+route+'/'+p+'-'+suffix)).status,409);
      const response=await request('/api/bulk-delete','POST',{type:route,ids:[p+'-'+suffix]});assert.equal(response.data.deleted,0);assert.equal(response.data.errors.length,1);assert.deepEqual(get(table,p+'-'+suffix),before);
    });
  }
  await check('Clay and Glaze photo routes and embedded test protect shared file',async()=>{
    const p='direct';studio(p);db.prepare('UPDATE glaze_photos SET filename=? WHERE id=?').run(p+'-c.jpg',p+'-gphoto');db.prepare('UPDATE glaze_clay_tests SET photo_filename=? WHERE id=?').run(p+'-c.jpg',p+'-ct');
    for(const [route,id]of [['clay-photos',p+'-cphoto'],['glaze-photos',p+'-gphoto']]){
      assert.equal((await request('/api/'+route+'/'+id,'DELETE',undefined,'b')).status,404);assert.equal((await request('/api/'+route+'/'+id)).status,200);assert.ok(fs.existsSync(file(p+'-c.jpg')));
    }
    assert.equal((await request('/api/glazes/'+p+'-g/clay-tests/'+p+'-ct','DELETE',undefined,'b')).status,404);
    assert.equal((await request('/api/glazes/'+p+'-g/clay-tests/'+p+'-ct')).status,200);assert.equal(fs.existsSync(file(p+'-c.jpg')),false);
  });
  await check('Clay replacement checks owner, keeps shared file and rolls back failed insert',async()=>{
    const p='replace';studio(p);db.prepare('INSERT INTO firing_photos(id,firing_id,filename) VALUES(?,?,?)').run(p+'-fp',p+'-f',p+'-c.jpg');
    const photo=()=>new Blob(['synthetic-upload'],{type:'image/jpeg'});
    assert.equal((await form('/api/clay-bodies/'+p+'-c/photos','POST',{replace:'true',photo:photo()},'b')).status,404);assert.ok(get('clay_photos',p+'-cphoto'));
    db.exec("CREATE TRIGGER fail_photo BEFORE INSERT ON clay_photos BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
    assert.equal((await form('/api/clay-bodies/'+p+'-c/photos','POST',{replace:'true',photo:photo()})).status,500);assert.ok(get('clay_photos',p+'-cphoto'));assert.ok(fs.existsSync(file(p+'-c.jpg')));db.exec('DROP TRIGGER fail_photo');
    assert.equal((await form('/api/clay-bodies/'+p+'-c/photos','POST',{replace:'true',photo:photo()})).status,200);assert.equal(get('clay_photos',p+'-cphoto'),undefined);assert.ok(fs.existsSync(file(p+'-c.jpg')));
  });
  await check('Test Tile edit removal preserves shared file and rollback retains old slots',async()=>{
    const p='tile-edit';studio(p);db.prepare('INSERT INTO firing_photos(id,firing_id,filename) VALUES(?,?,?)').run(p+'-fp',p+'-f',p+'-t.jpg');
    db.exec(`CREATE TRIGGER fail_tile_update BEFORE UPDATE ON test_tiles WHEN OLD.id='${p}-t' BEGIN SELECT RAISE(ABORT,'injected failure'); END;`);
    assert.equal((await form('/api/test-tiles/'+p+'-t','PUT',{remove_photo:'true'})).status,500);assert.equal(get('test_tiles',p+'-t').photo_filename,p+'-t.jpg');assert.ok(fs.existsSync(file(p+'-t.jpg')));db.exec('DROP TRIGGER fail_tile_update');
    assert.equal((await form('/api/test-tiles/'+p+'-t','PUT',{remove_photo:'true'})).status,200);assert.equal(get('test_tiles',p+'-t').photo_filename,p+'-t2.jpg');assert.ok(fs.existsSync(file(p+'-t.jpg')));
  });
  assert.deepEqual(db.pragma('foreign_key_check'),[]);assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
  console.log(`PASS ${passed} studio deletion API checks (${migrated?'QL':'legacy'})`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(db)db.close();if(server&&server.exitCode===null)await new Promise(resolve=>{server.once('exit',resolve);server.kill();});
  fs.rmSync(tmp,{recursive:true,force:true});
});
