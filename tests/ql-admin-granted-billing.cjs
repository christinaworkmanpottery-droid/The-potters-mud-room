// Synthetic-only regression coverage for the bounded special-account startup billing compatibility rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const iap = require('../iap');

const root = path.resolve(__dirname, '..');
const special = iap.SPECIAL_GRANDFATHERED_EMAILS;
const pause = ms => new Promise(r => setTimeout(r, ms));

test('Admin grants: constrained schema, both routes, preservation and compatibility', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-special-billing-'));
  let server = null, log = '', base = '', db = null;
  const secret = crypto.randomBytes(32).toString('hex');
  const adminKey = crypto.randomBytes(32).toString('hex');
  const password = 'synthetic-password';
  const hash = bcrypt.hashSync(password, 8);
  const env = { PATH:process.env.PATH, NODE_ENV:'test', PORT:'0', JWT_SECRET:secret, ADMIN_API_KEY:adminKey, ADMIN_BLOG_PASSWORD:adminKey };

  async function stop() {
    if (server && server.exitCode === null) {
      const done = new Promise(r => server.once('exit', r));
      server.kill('SIGTERM');
      await done;
    }
    server = null;
  }
  async function boot() {
    log = '';
    fs.rmSync(path.join(dir, 'port'), { force:true });
    server = spawn(process.execPath, ['--require','./loopback.cjs','server.js'], { cwd:dir, env, stdio:['ignore','pipe','pipe'] });
    server.stdout.on('data', x => log += x);
    server.stderr.on('data', x => log += x);
    for (let i=0;i<600;i++) {
      if (server.exitCode !== null) throw Error(log);
      if (fs.existsSync(path.join(dir,'port')) && /\[Startup\] (All .*photos already|Backfill complete:)/.test(log)) {
        base = 'http://127.0.0.1:' + fs.readFileSync(path.join(dir,'port'),'utf8');
        return;
      }
      await pause(25);
    }
    throw Error('startup did not settle: '+log);
  }
  async function req(url, token, options={}) {
    const r = await fetch(base+url, { ...options, headers:{ ...(token?{Authorization:'Bearer '+token}:{}), ...(options.headers||{}) } });
    const bytes = Buffer.from(await r.arrayBuffer());
    let data; try { data = JSON.parse(bytes); } catch { data = bytes.toString(); }
    return { status:r.status, data };
  }
  async function login(email) {
    const r = await req('/api/auth/login', null, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email,password}) });
    assert.equal(r.status,200,JSON.stringify(r.data));
    return r.data.token;
  }

  t.after(async () => {
    if (db?.open) db.close();
    await stop();
    fs.rmSync(dir,{recursive:true,force:true});
  });

  for (const file of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs']) {
    fs.copyFileSync(path.join(root,file),path.join(dir,file));
  }
  fs.cpSync(path.join(root,'ql'),path.join(dir,'ql'),{recursive:true,filter:p=>!p.includes(path.sep+'evidence')});
  fs.cpSync(path.join(root,'geodata'),path.join(dir,'geodata'),{recursive:true});
  for (const folder of ['node_modules','public']) fs.symlinkSync(path.join(root,folder),path.join(dir,folder),'dir');
  fs.writeFileSync(path.join(dir,'loopback.cjs'), "const net=require('net'),o=net.Server.prototype.listen;net.Server.prototype.listen=function(...a){a[1]='127.0.0.1';this.once('listening',()=>require('fs').writeFileSync(require('path').join(__dirname,'port'),String(this.address().port)));return o.apply(this,a)}");

  const init = spawnSync(process.execPath,['-e',"require('./database').initDB().close()"],{cwd:dir,env,encoding:'utf8'});
  assert.equal(init.status,0,init.stderr);
  db = new Database(path.join(dir,'data/pottery.db'));
  db.pragma('foreign_keys=ON');

  const add = (id,tier='free',billing='monthly') => db.prepare('INSERT INTO users(id,email,password_hash,display_name,tier,billing_period,referral_code,stores_migrated) VALUES(?,?,?,?,?,?,?,1)').run(id,id+'@example.invalid',hash,id,tier,billing,id);
  const row = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  add('admin'); add('unrelated','starter');
  await boot();
  const admin = jwt.sign({userId:'admin'},secret,{expiresIn:'1h'});
  const post = (url,body,token=admin) => req(url,token,{method:'POST',headers:{'Content-Type':'application/json',...(token===admin?{'X-Admin-Key':adminKey}:{})},body:JSON.stringify(body)});
  const upgrade = (route,id,body={tier:'starter'}) => route==='member' ? post('/api/admin/members/'+id+'/upgrade',body) : post('/api/admin/upgrade-tier/remote',{password:adminKey,email:id+'@example.invalid',...body});
  await t.test('fresh schema constrained field exists first startup',()=>{
    const c=db.pragma('table_info(users)').find(x=>x.name==='admin_granted_access');
    assert.equal(c.notnull,1);assert.equal(c.dflt_value,'0');assert.equal(row('unrelated').admin_granted_access,0);
    assert.throws(()=>db.prepare('UPDATE users SET admin_granted_access=2').run(),/CHECK/);
  });
  for (const route of ['member','remote']) {
    for (const [label,tier,billing,extra] of [
      ['free','free','monthly',{}],['monthly','starter','monthly',{}],['yearly','starter','yearly',{}],['promo','starter','promo',{}],['null','starter',null,{}],
      ['legacy','starter','stripe-monthly',{}],
      ['stripe','starter','yearly',{stripe_customer_id:'cus_synthetic',stripe_subscription_id:'sub_synthetic'}],
      ['iap-active','starter','monthly',{iap_platform:'ios',iap_transaction_id:'synthetic-active',iap_expires_at:4102444800}],
      ['iap-expired','starter','yearly',{iap_platform:'android',iap_transaction_id:'synthetic-expired',iap_expires_at:1}],
      ['future-plan','starter','monthly',{plan_expires_at:'2099-01-01'}],['expired-plan','starter','yearly',{plan_expires_at:'2000-01-01'}],
    ]) await t.test(route+' grant preserves '+label,async()=>{
      const id=route+'-'+label;
      if(billing==='stripe-monthly')db.pragma('ignore_check_constraints=ON');
      add(id,tier,billing);db.pragma('ignore_check_constraints=OFF');
      for(const [k,v] of Object.entries(extra))db.prepare('UPDATE users SET '+k+'=? WHERE id=?').run(v,id);
      const before=row(id),other=row('unrelated');
      const r=await upgrade(route,id);assert.equal(r.status,200,JSON.stringify(r));
      assert.deepEqual(row(id),{...before,tier:'starter',billing_period:billing==='stripe-monthly'?'monthly':billing,admin_granted_access:1});assert.deepEqual(row('unrelated'),other);
      assert.equal(iap.hasPremiumAccess(db,id),true);
      const token=jwt.sign({userId:id},secret);const sub=await req('/api/user/subscription',token),me=await req('/api/auth/me',token);
      assert.equal(sub.status,200);assert.equal(sub.data.status,'active');assert.equal(sub.data.hasStripeSubscription,!!extra.stripe_subscription_id);assert.equal(sub.data.hasIAPSubscription,label==='iap-active');
      assert.equal(me.data.user.billing_period,'stripe-monthly');assert.equal(sub.data.billingPeriod,'stripe-monthly');
      assert.equal(sub.data.expiresAt,extra.plan_expires_at||null);
      const search=await req('/api/admin/members/search?q='+id,admin,{headers:{'X-Admin-Key':adminKey}});assert.equal(search.status,200);assert.equal(search.data[0].billing_period,'stripe-monthly');
    });
    for(const bad of ['stripe-monthly','bad','',null,3,{},[]])await t.test(route+' rejects billing '+JSON.stringify(bad),async()=>{
      const before=row(route+'-free');assert.equal((await upgrade(route,route+'-free',{tier:'starter',billingPeriod:bad})).status,400);assert.deepEqual(row(route+'-free'),before);
    });
    for(const bad of ['premium','',null,3,{},[]])await t.test(route+' rejects tier '+JSON.stringify(bad),async()=>{
      const before=row(route+'-free');assert.equal((await upgrade(route,route+'-free',{tier:bad})).status,400);assert.deepEqual(row(route+'-free'),before);
    });
    await t.test(route+' missing target 404',async()=>assert.equal((await upgrade(route,'missing')).status,404));
    await t.test(route+' failed statement atomic and CHECK remains enforced',async()=>{
      const id=route+'-free',before=row(id);
      db.exec("CREATE TRIGGER reject_admin_grant BEFORE UPDATE ON users WHEN NEW.id='"+id+"' BEGIN SELECT RAISE(ABORT,'injected write failure'); END");
      assert.equal((await upgrade(route,id)).status,500);assert.deepEqual(row(id),before);db.exec('DROP TRIGGER reject_admin_grant');
      // An AFTER trigger executes the invalid write on the server's own connection.
      db.exec("CREATE TRIGGER probe_check AFTER UPDATE ON users WHEN NEW.id='"+id+"' BEGIN UPDATE users SET billing_period='invalid' WHERE id='unrelated'; END");
      assert.equal((await upgrade(route,id)).status,500);assert.deepEqual(row(id),before);db.exec('DROP TRIGGER probe_check');
      assert.equal(db.pragma('ignore_check_constraints',{simple:true}),0);assert.throws(()=>db.exec("UPDATE users SET billing_period='invalid' WHERE id='unrelated'"),/CHECK/);assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
    });
    await t.test(route+' downgrade re-upgrade and eleventh Piece',async()=>{
      const id=route+'-yearly',token=jwt.sign({userId:id},secret);
      for(let n=0;n<10;n++)db.prepare('INSERT INTO pieces(id,user_id,title) VALUES(?,?,?)').run(id+n,id,'Piece');
      assert.equal((await post('/api/pieces',{title:'Eleventh'},token)).status,200);
      assert.equal((await upgrade(route,id,{tier:'free'})).status,200);assert.equal(row(id).admin_granted_access,0);assert.equal(iap.hasPremiumAccess(db,id),false);assert.equal(row(id).billing_period,'yearly');
      assert.equal((await post('/api/pieces',{title:'Blocked'},token)).status,403);
      assert.equal((await upgrade(route,id)).status,200);assert.equal(row(id).admin_granted_access,1);assert.equal(iap.hasPremiumAccess(db,id),true);assert.equal(row(id).billing_period,'yearly');
    });
  }
  await t.test('ungranted monthly Starter remains limited and Free flag alone cannot grant',async()=>{
    for(let n=0;n<10;n++)db.prepare('INSERT INTO pieces(id,user_id,title) VALUES(?,?,?)').run('u'+n,'unrelated','Piece');
    assert.equal((await post('/api/pieces',{title:'Blocked'},jwt.sign({userId:'unrelated'},secret))).status,403);
    db.exec("UPDATE users SET admin_granted_access=1,tier='free' WHERE id='unrelated'");assert.equal(iap.hasPremiumAccess(db,'unrelated'),false);
    db.exec("UPDATE users SET admin_granted_access=0,tier='starter' WHERE id='unrelated'");
  });
  await t.test('explicit provider update and null clear; omitted values preserved',async()=>{
    assert.equal((await upgrade('member','member-stripe',{tier:'starter',stripeCustomerId:'cus_new'})).status,200);assert.equal(row('member-stripe').stripe_subscription_id,'sub_synthetic');
    assert.equal((await upgrade('member','member-stripe',{tier:'starter',stripeSubscriptionId:null})).status,200);assert.equal(row('member-stripe').stripe_customer_id,'cus_new');assert.equal(row('member-stripe').stripe_subscription_id,null);
    for(const bad of ['',false,{},[]])assert.equal((await upgrade('member','member-stripe',{tier:'starter',stripeCustomerId:bad})).status,400);
  });
  await t.test('explicit interval edit only on member route; remote preserves interval',async()=>{
    assert.equal((await upgrade('member','member-yearly',{tier:'starter',billingPeriod:'promo'})).status,200);assert.equal(row('member-yearly').billing_period,'promo');
    assert.equal((await upgrade('remote','remote-yearly',{tier:'starter',billingPeriod:'monthly'})).status,200);assert.equal(row('remote-yearly').billing_period,'yearly');
  });
  await t.test('Admin paid/gifted counts and unchanged web paid filter',async()=>{
    const r=await req('/api/admin/members',admin,{headers:{'X-Admin-Key':adminKey}});assert.equal(r.status,200);
    const paid=r.data.members.filter(x=>(x.stripe_subscription_id&&x.stripe_subscription_id!=='')||x.billing_period==='stripe-monthly');
    assert.equal(r.data.stats.byTier.paid,22);assert.equal(paid.length,22);assert.equal(r.data.stats.byTier.gifted,1);
  });
  await t.test('two restarts preserve grants and all interval/provider fields',async()=>{
    const before=db.prepare('SELECT * FROM users ORDER BY id').all();await stop();await boot();await stop();await boot();assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(),before);
    assert.equal(iap.hasPremiumAccess(db,'remote-yearly'),true);
  });
  await t.test('authentication, missing email, default remote Starter and supported tier enum',async()=>{
    assert.equal((await req('/api/admin/members/member-free/upgrade',null,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:'starter'})})).status,401);
    assert.equal((await req('/api/admin/members/member-free/upgrade',jwt.sign({userId:'unrelated'},secret),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tier:'starter'})})).status,403);
    assert.equal((await post('/api/admin/upgrade-tier/remote',{password:'wrong',email:'member-free@example.invalid'})).status,401);
    for(const email of [null,'',{},[]])assert.equal((await post('/api/admin/upgrade-tier/remote',{password:adminKey,email})).status,400);
    assert.equal((await upgrade('member','member-free',{})).status,400);
    assert.equal((await upgrade('remote','remote-free',{})).status,200);
    for(const route of ['member','remote'])for(const tier of ['basic','mid','top','starter','free'])assert.equal((await upgrade(route,route+'-free',{tier})).status,200);
  });
  await t.test('existing schema additive migration defaults zero without inference; idempotent',async()=>{
    await stop();db.exec('ALTER TABLE users DROP COLUMN admin_granted_access');
    const before=db.prepare('SELECT * FROM users ORDER BY id').all();
    await boot();const after=db.prepare('SELECT * FROM users ORDER BY id').all();for(let n=0;n<before.length;n++)assert.deepEqual(after[n],{...before[n],admin_granted_access:0});
    await stop();await boot();assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(),after);
    assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
  });
});

test('unchanged mobile subscription display derives provider only from evidence',async()=>{
  const {subscriptionDisplay}=await import('./fixtures/admin-billing-mobile-parity.mjs');
  for(const billingPeriod of ['stripe-monthly','monthly','yearly','promo']) {
    const subscription={plan:'starter',status:'active',billingPeriod,hasStripeSubscription:false,hasIAPSubscription:false,expiresAt:null};
    assert.equal(subscriptionDisplay(subscription).provider,null);
    assert.equal(subscriptionDisplay({...subscription,hasStripeSubscription:true}).provider,'stripe');
    assert.equal(subscriptionDisplay({...subscription,hasIAPSubscription:true,iapPlatform:'ios'}).provider,'apple');
    assert.equal(subscriptionDisplay({...subscription,hasIAPSubscription:true,iapPlatform:'android'}).provider,'google');
  }
});
