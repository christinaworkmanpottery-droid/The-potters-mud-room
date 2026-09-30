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

test('special-account canonical storage matrix and entitlement compatibility', async t => {
  for (const [stored, expected] of [
    ['monthly', 'monthly'],
    ['yearly', 'yearly'],
    ['promo', 'promo'],
    [null, 'monthly'],
    ['stripe-monthly', 'monthly'],
  ]) {
    await t.test(String(stored) + ' normalizes safely', () => {
      const db = new Database(':memory:');
      db.exec(`CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT,
        tier TEXT,
        billing_period TEXT DEFAULT 'monthly'
          CHECK(billing_period IN ('monthly','yearly','promo')),
        plan_expires_at TEXT,
        iap_expires_at INTEGER
      )`);
      db.pragma('ignore_check_constraints=ON');
      db.prepare('INSERT INTO users(id,email,tier,billing_period) VALUES(?,?,?,?)')
        .run('special', special[0].toUpperCase(), 'free', stored);
      db.prepare("INSERT INTO users(id,email,tier,billing_period) VALUES('ordinary','ordinary@example.invalid','starter','monthly')").run();
      db.pragma('ignore_check_constraints=OFF');

      iap.normalizeSpecialAccountBilling(db);
      const row = db.prepare("SELECT * FROM users WHERE id='special'").get();
      assert.equal(row.tier, 'starter');
      assert.equal(row.billing_period, expected);
      assert.equal(iap.hasPremiumAccess(db, 'special'), true);
      assert.equal(iap.hasPremiumAccess(db, 'ordinary'), false);
      assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
      const once = db.prepare("SELECT tier,billing_period FROM users WHERE id='special'").get();
      iap.normalizeSpecialAccountBilling(db);
      assert.deepEqual(db.prepare("SELECT tier,billing_period FROM users WHERE id='special'").get(), once);
      db.close();
    });
  }

  await t.test('unrelated historical marker remains readable and is not bulk-normalized', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT, tier TEXT, billing_period TEXT,
      plan_expires_at TEXT, iap_expires_at INTEGER
    )`);
    db.prepare("INSERT INTO users(id,email,tier,billing_period) VALUES('legacy','legacy@example.invalid','starter','stripe-monthly')").run();
    iap.normalizeSpecialAccountBilling(db);
    assert.equal(db.prepare("SELECT billing_period FROM users WHERE id='legacy'").get().billing_period,'stripe-monthly');
    assert.equal(iap.hasPremiumAccess(db,'legacy'),true);
    db.close();
  });

  await t.test('compatibility serialization preserves interval and promo meaning', () => {
    assert.equal(iap.compatibleBillingPeriod({ email:special[0], tier:'starter', billing_period:'monthly' }), 'stripe-monthly');
    assert.equal(iap.compatibleBillingPeriod({ email:special[0], tier:'starter', billing_period:'yearly' }), 'yearly');
    assert.equal(iap.compatibleBillingPeriod({ email:special[0], tier:'starter', billing_period:'promo' }), 'promo');
    assert.equal(iap.compatibleBillingPeriod({ email:'ordinary@example.invalid', tier:'starter', billing_period:'monthly' }), 'monthly');
    assert.equal(iap.compatibleBillingPeriod({ email:'legacy@example.invalid', tier:'starter', billing_period:'stripe-monthly' }), 'stripe-monthly');
  });

  await t.test('special exception is exact-email and tier-sensitive', () => {
    assert.equal(iap.isSpecialGrandfatheredEmail(' JGK1020@GMAIL.COM '), true);
    assert.equal(iap.isSpecialGrandfatheredEmail('jgk1020+other@gmail.com'), false);
    assert.equal(iap.isSpecialGrandfatheredUser({email:special[0],tier:'free'}), false);
    assert.equal(iap.isGrandfatheredPaidUser({email:special[0],tier:'starter',billing_period:'monthly'}), true);
    assert.equal(iap.isGrandfatheredPaidUser({email:special[0],tier:'starter',billing_period:'promo'}), false);
    assert.equal(iap.isGrandfatheredPaidUser({email:'ordinary@example.invalid',tier:'starter',billing_period:'monthly'}), false);
  });
});

test('fresh constrained server stores canonical values while preserving observable grandfathered behavior', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-special-billing-'));
  let server = null, log = '', base = '', db = null;
  const secret = crypto.randomBytes(32).toString('hex');
  const adminKey = crypto.randomBytes(32).toString('hex');
  const password = 'synthetic-password';
  const hash = bcrypt.hashSync(password, 8);
  const env = { PATH:process.env.PATH, NODE_ENV:'test', PORT:'0', JWT_SECRET:secret, ADMIN_API_KEY:adminKey };

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
  const insert = db.prepare('INSERT INTO users(id,email,password_hash,display_name,tier,billing_period,created_at,referral_code,stores_migrated) VALUES(?,?,?,?,?,?,?,?,1)');
  db.pragma('ignore_check_constraints=ON');
  insert.run('jg',special[0],hash,'JG','free','stripe-monthly','2020-01-01','SPECIAL-JG');
  insert.run('aw',special[1],hash,'AW','free','yearly','2020-01-02','SPECIAL-AW');
  insert.run('admin',special[2],hash,'Admin','free','promo','2020-01-03','SPECIAL-ADMIN');
  insert.run('ordinary','ordinary@example.invalid',hash,'Ordinary','starter','monthly','2020-01-04','ORDINARY');
  db.pragma('ignore_check_constraints=OFF');
  for (const id of ['jg','ordinary']) {
    for (let n=0;n<10;n++) db.prepare('INSERT INTO pieces(id,user_id,title,status) VALUES(?,?,?,?)').run(id+'-piece-'+n,id,'Piece '+n,'in-progress');
  }
  db.close(); db=null;

  await boot();
  db = new Database(path.join(dir,'data/pottery.db'));
  db.pragma('foreign_keys=ON');

  await t.test('startup canonicalizes only selected invalid/missing storage and preserves allowed values', () => {
    const rows = Object.fromEntries(db.prepare("SELECT id,tier,billing_period FROM users WHERE id IN ('jg','aw','admin','ordinary')").all().map(x=>[x.id,x]));
    assert.deepEqual(rows.jg,{id:'jg',tier:'starter',billing_period:'monthly'});
    assert.deepEqual(rows.aw,{id:'aw',tier:'starter',billing_period:'yearly'});
    assert.deepEqual(rows.admin,{id:'admin',tier:'starter',billing_period:'promo'});
    assert.deepEqual(rows.ordinary,{id:'ordinary',tier:'starter',billing_period:'monthly'});
    assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
  });

  const jg = await login(special[0]);
  const aw = await login(special[1]);
  const admin = await login(special[2]);
  const ordinary = await login('ordinary@example.invalid');

  await t.test('subscription and auth serialization preserve compatible observable meaning without fake provider state', async () => {
    const me = await req('/api/auth/me',jg);
    assert.equal(me.status,200); assert.equal(me.data.user.billing_period,'stripe-monthly');
    const jgSub = await req('/api/user/subscription',jg);
    assert.equal(jgSub.status,200); assert.equal(jgSub.data.status,'active'); assert.equal(jgSub.data.billingPeriod,'stripe-monthly');
    assert.equal(jgSub.data.hasStripeSubscription,false); assert.equal(jgSub.data.hasIAPSubscription,false);
    const awSub = await req('/api/user/subscription',aw);
    assert.equal(awSub.data.status,'active'); assert.equal(awSub.data.billingPeriod,'yearly'); assert.equal(awSub.data.hasStripeSubscription,false);
    const promo = await req('/api/user/subscription',admin);
    assert.equal(promo.data.status,'active'); assert.equal(promo.data.billingPeriod,'promo');
    const ordinarySub = await req('/api/user/subscription',ordinary);
    assert.equal(ordinarySub.data.status,'inactive'); assert.equal(ordinarySub.data.billingPeriod,'monthly');
  });

  await t.test('grandfathered account can create eleventh Piece while ordinary Starter cannot', async () => {
    const body = JSON.stringify({title:'Eleventh'});
    assert.equal((await req('/api/pieces',jg,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,200);
    assert.equal((await req('/api/pieces',ordinary,{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403);
  });

  await t.test('Admin paid/gifted classification recognizes special and historical grandfathering without broadening monthly Starter', async () => {
    const r = await req('/api/admin/members',admin);
    assert.equal(r.status,200);
    assert.equal(r.data.stats.byTier.paid,2); // JG + AW special compatibility accounts.
    assert.equal(r.data.stats.byTier.gifted,2); // promo Admin + ordinary Starter.
    const members=Object.fromEntries(r.data.members.map(x=>[x.id,x]));
    assert.equal(members.jg.billing_period,'stripe-monthly');
    assert.equal(members.aw.billing_period,'yearly');
    assert.equal(members.admin.billing_period,'promo');
    assert.equal(members.ordinary.billing_period,'monthly');
  });

  await t.test('tier sensitivity preserves cancellation semantics until existing startup regrant runs', async () => {
    db.prepare("UPDATE users SET tier='free',billing_period=NULL WHERE id='jg'").run();
    assert.equal(iap.hasPremiumAccess(db,'jg'),false);
    assert.equal((await req('/api/user/subscription',jg)).data.status,'inactive');
    await stop();
    db.close(); db=null;
    await boot();
    db=new Database(path.join(dir,'data/pottery.db')); db.pragma('foreign_keys=ON');
    const row=db.prepare("SELECT tier,billing_period FROM users WHERE id='jg'").get();
    assert.deepEqual(row,{tier:'starter',billing_period:'monthly'});
    assert.equal(iap.hasPremiumAccess(db,'jg'),true);
  });

  await t.test('immediate restart is idempotent and does not create invalid billing rows', async () => {
    const before=db.prepare("SELECT id,tier,billing_period FROM users ORDER BY id").all();
    await stop(); db.close(); db=null;
    await boot();
    db=new Database(path.join(dir,'data/pottery.db')); db.pragma('foreign_keys=ON');
    assert.deepEqual(db.prepare("SELECT id,tier,billing_period FROM users ORDER BY id").all(),before);
    assert.deepEqual(db.pragma('integrity_check'),[{integrity_check:'ok'}]);
    assert.doesNotMatch(log,/CHECK constraint failed in users/);
  });
});

test('source keeps the separate Admin upgrade billing-integrity blocker untouched', () => {
  const source = fs.readFileSync(path.join(root,'server.js'),'utf8');
  assert.match(source,/billingPeriod \|\| 'stripe-monthly'/);
  assert.match(source,/run\(targetTier, 'stripe-monthly', email\.toLowerCase\(\)\)/);
});
