// Real route, synthetic databases only; no production environment or credentials.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto'), Database = require('better-sqlite3'), jwt = require('jsonwebtoken');
const root = path.resolve(__dirname, '..');
const adminEmail = 'christinaworkmanpottery@gmail.com'; // Established source identity.
const columns = ['id','display_name','email','potter_type','years_experience','studio_type','location','created_at'];
const empty = { users: [], summary: { total: 0, byType: {}, byExperience: {}, byStudio: {}, byLocation: {} } };
for (const mode of ['fresh', 'initialized', 'existing-populated']) {
  test(mode + ' demographics contract', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-demographics-'));
    let server, db, log = '';
    t.after(async () => {
      if (db?.open) db.close();
      if (server && server.exitCode === null) { const done = new Promise(r => server.once('exit', r)); server.kill(); await done; }
      fs.rmSync(dir, { recursive: true, force: true });
    });
    for (const file of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs']) fs.copyFileSync(path.join(root,file),path.join(dir,file));
    for (const folder of ['ql','geodata']) fs.cpSync(path.join(root,folder),path.join(dir,folder),{recursive:true,filter:p=>!p.includes('/evidence')});
    for (const folder of ['node_modules','public']) fs.symlinkSync(path.join(root,folder),path.join(dir,folder),'dir');
    const secret = crypto.randomBytes(32).toString('hex'), key = crypto.randomBytes(32).toString('hex');
    const env = { PATH: process.env.PATH, NODE_ENV:'test', PORT:'0', JWT_SECRET:secret, ADMIN_API_KEY:key };
    const snapshot = () => ({ schema: db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(), users: db.prepare('SELECT * FROM users ORDER BY id').all() });
    if (mode !== 'fresh') {
      const init = spawnSync(process.execPath,['-e',"require('./database').initDB().close()"],{cwd:dir,env,encoding:'utf8'});
      assert.equal(init.status,0,init.stderr);

    } else assert.ok(!fs.existsSync(path.join(dir,'data')));
    fs.writeFileSync(path.join(dir,'port.cjs'),"const net=require('net'),original=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){args[1]='127.0.0.1';this.once('listening',()=>require('fs').writeFileSync(require('path').join(__dirname,'port'),String(this.address().port)));return original.apply(this,args)}");
    let base;
    async function boot() {
      log='';
    server = spawn(process.execPath,['--require','./port.cjs','server.js'],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',c=>log+=c); server.stderr.on('data',c=>log+=c);
    for(let i=0;i<300&&!/\[Startup\] (All .*photos already|Backfill complete:)/.test(log);i++){if(server.exitCode!==null)throw Error(log);await new Promise(r=>setTimeout(r,50));}
    assert.match(log,/running on/,log);
    base='http://127.0.0.1:'+fs.readFileSync(path.join(dir,'port'),'utf8');
    }
    await boot();
    if (mode === 'existing-populated') {
        db = new Database(path.join(dir,'data/pottery.db'));
        db.exec("INSERT INTO users(id,email,password_hash,display_name,potter_type,years_experience,studio_type,location,created_at,referral_code,stores_migrated,is_private) VALUES('a','a@example.invalid','secret-a','Private A','hobby','1-3','home','Los Angeles','2020-01-01','SYNTHETIC-A',1,1),('b','b@example.invalid','secret-b','Private B','hobby','1-3','shared','Los Angeles','2021-01-01','SYNTHETIC-B',1,1),('c','c@example.invalid','secret-c',NULL,NULL,NULL,NULL,NULL,'2019-01-01','SYNTHETIC-C',1,0)");
        db.close();
        const stopped=new Promise(r=>server.once('exit',r));server.kill();await stopped;
        await boot();
      }
    db = new Database(path.join(dir,'data/pottery.db'));
    const token = id => jwt.sign({userId:id},secret,{expiresIn:'5m'});
    const request = async (headers={}) => { const r=await fetch(base+'/api/admin/demographics',{headers}); return {status:r.status,data:await r.json()}; };
    const auth = id => ({Authorization:'Bearer '+token(id)});
    const before=snapshot();
    await t.test('source-defined schema has no is_admin; key-only authorization works',async()=>{
      assert.ok(!db.pragma('table_info(users)').some(c=>c.name==='is_admin'));
      const r=await request({'x-admin-key':key});assert.equal(r.status,200);
      if(mode!=='existing-populated') assert.deepEqual(r.data,empty);
      else {assert.equal(r.data.summary.total,3);assert.deepEqual(r.data.summary.byType,{hobby:2});assert.deepEqual(r.data.summary.byExperience,{'1-3':2});assert.deepEqual(r.data.summary.byStudio,{shared:1,home:1});assert.deepEqual(r.data.summary.byLocation,{'Los Angeles':2});assert.deepEqual(r.data.users.map(u=>u.id),['b','a','c']);}
    });
    await t.test('no authentication is 401 with no demographics disclosure',async()=>assert.deepEqual(await request(),{status:401,data:{error:'Not authenticated'}}));
    await t.test('incorrect admin key is not authentication',async()=>assert.equal((await request({'x-admin-key':'wrong'})).status,401));
    await t.test('expired JWT is denied',async()=>assert.equal((await request({Authorization:'Bearer '+jwt.sign({userId:'a'},secret,{expiresIn:-1})})).status,401));
    await t.test('key-authorized read does not mutate schema or user rows',()=>assert.deepEqual(snapshot(),before));
    // Insert established admin identity after startup so this slice does not exercise or repair
    // the separate special-account billing CHECK startup blocker.
    db.prepare('INSERT INTO users(id,email,password_hash) VALUES(?,?,?)').run('admin',adminEmail,'admin-private-hash');
    db.prepare('INSERT INTO users(id,email,password_hash,tier) VALUES(?,?,?,?)').run('ordinary','ordinary@example.invalid','ordinary-private-hash','starter');
    const seeded=snapshot();
    await t.test('established admin identity JWT succeeds without key',async()=>assert.equal((await request(auth('admin'))).status,200));
    await t.test('authenticated paid non-admin is 403 and receives no other accounts',async()=>assert.deepEqual(await request(auth('ordinary')),{status:403,data:{error:'Admin only'}}));
    await t.test('non-admin with incorrect key remains denied',async()=>assert.equal((await request({...auth('ordinary'),'x-admin-key':'wrong'})).status,403));
    await t.test('valid existing key authorizes ordinary JWT consistently',async()=>assert.equal((await request({...auth('ordinary'),'x-admin-key':key})).status,200));
    await t.test('JWT claims cannot impersonate admin email or privilege',async()=>assert.equal((await request({Authorization:'Bearer '+jwt.sign({userId:'ordinary',email:adminEmail,is_admin:true,tier:'top'},secret)})).status,403));
    await t.test('unknown identity does not gain admin access',async()=>assert.equal((await request(auth('missing'))).status,403));
    await t.test('response keys, selected fields, NULLs, ordering and totals match legacy SQL contract',async()=>{
      const r=await request(auth('admin'));assert.deepEqual(Object.keys(r.data).sort(),['summary','users']);
      assert.deepEqual(Object.keys(r.data.summary).sort(),['byExperience','byLocation','byStudio','byType','total']);
      const expected=db.prepare('SELECT '+columns.join(',')+' FROM users ORDER BY created_at DESC').all();
      assert.deepEqual(r.data.users,expected);assert.equal(r.data.summary.total,expected.length);
      for(const u of r.data.users)assert.deepEqual(Object.keys(u),columns);
      assert.equal(r.data.users.find(u=>u.id==='ordinary').potter_type,null);
      assert.deepEqual((await request({'x-admin-key':key})).data,r.data);
    });
    await t.test('admin access follows current database email, not stale JWT privilege',async()=>{
      const headers=auth('admin');db.prepare('UPDATE users SET email=? WHERE id=?').run('former-admin@example.invalid','admin');
      try{assert.equal((await request(headers)).status,403);}finally{db.prepare('UPDATE users SET email=? WHERE id=?').run(adminEmail,'admin');}
    });
    await t.test('all requests preserve database and avoid missing-column errors',()=>{assert.deepEqual(snapshot(),seeded);assert.doesNotMatch(log,/no such column: is_admin/);});
  });
}
