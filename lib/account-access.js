'use strict';
// Billing affects access only. This module never deletes or rewrites studio data.
const DAY = 86400000;
const MESSAGE = 'Your Unlimited membership is currently inactive. All your pottery records, photos, and studio history have been saved securely. Renew your membership to pick up right where you left off.';
function init(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_entitlements (
    user_id TEXT NOT NULL, source_id TEXT NOT NULL, provider TEXT NOT NULL,
    status TEXT NOT NULL, paid_through TEXT, grace_until TEXT, verified_at TEXT NOT NULL,
    PRIMARY KEY(user_id,source_id)
  );
  CREATE TABLE IF NOT EXISTS renewal_failures (invoice_id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL, failed_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS renewal_checkouts (user_id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, plan TEXT NOT NULL, session_id TEXT, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS student_membership_verifications (user_id TEXT PRIMARY KEY, verified_until TEXT NOT NULL, verified_by TEXT NOT NULL, verified_at TEXT NOT NULL, school TEXT NOT NULL);
  `);
}
function record(db, row) {
  db.prepare(`INSERT INTO account_entitlements(user_id,source_id,provider,status,paid_through,grace_until,verified_at)
    VALUES(@userId,@sourceId,@provider,@status,@paidThrough,@graceUntil,@verifiedAt)
    ON CONFLICT(user_id,source_id) DO UPDATE SET status=excluded.status,paid_through=excluded.paid_through,grace_until=excluded.grace_until,verified_at=excluded.verified_at`).run(row);
}
function access(db,userId,now=Date.now()) {
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if(!u)return {status:'missing',blocked:true,unlimited:false};
  const tier=['starter','basic','mid','top'].includes(u.tier);
  const gift=!!u.is_beta_tester || u.billing_period==='promo' && (!u.plan_expires_at || Date.parse(u.plan_expires_at)>now);
  if(u.email?.toLowerCase()==='christinaworkmanpottery@gmail.com' || gift) return {status:gift?'complimentary':'administrator',blocked:false,unlimited:true};
  const rows=db.prepare('SELECT * FROM account_entitlements WHERE user_id=?').all(userId);
  // Old native receipts are retained for review; only verified lifecycle rows can suspend.
  const nativeActive=Number(u.iap_expires_at)*1000>now;
  const active=rows.find(r=>Date.parse(r.paid_through)>now || Date.parse(r.grace_until)>now || r.status==='active');
  if(nativeActive || active) {
    const grace=active && Date.parse(active.grace_until)>now && (Date.parse(active.paid_through)||0)<=now;
    return {status:grace?'grace':'active',blocked:false,unlimited:true,graceUntil:grace?active.grace_until:null,provider:active?.provider || u.iap_platform};
  }
  // A renewal failure must be rechecked after grace before access is suspended.
  // A provider outage or delayed synchronization is never evidence of nonpayment.
  if(rows.some(r=>r.provider==='stripe' && r.grace_until && Date.parse(r.grace_until)<=now && Date.parse(r.verified_at)<Date.parse(r.grace_until)))return {status:'active',blocked:false,unlimited:true,verificationPending:true};
  if(rows.some(r=>['canceled','past_due','unpaid','expired','revoked'].includes(r.status)))return {status:'suspended',blocked:true,unlimited:false,reactivationUrl:'/reactivate',message:MESSAGE};
  return {status:tier?'legacy_review':'free',blocked:false,unlimited:tier};
}
const recoveryRoutes=new Set([
  'GET /api/auth/me','GET /api/user/subscription','GET /api/billing/access','GET /api/billing/plans',
  'POST /api/billing/checkout','POST /api/create-checkout-session','POST /api/create-portal-session',
  'POST /api/billing/refresh','POST /api/billing/cancel','PUT /api/auth/password','DELETE /api/account',
  'POST /api/iap/verify','POST /api/iap/apple/verify','POST /api/iap/android/verify','GET /api/iap/restore'
]);
function recoveryAllowed(req){return recoveryRoutes.has(req.method+' '+req.path.replace(/\/$/,''));}
function denial(res,state){return res.status(402).set('Cache-Control','no-store').json({error:MESSAGE,code:'MEMBERSHIP_INACTIVE',...state});}
function audit(db) {
  const users=db.prepare('SELECT id FROM users').all();
  const counts={};
  const members=users.map(u=>{const a=access(db,u.id);counts[a.status]=(counts[a.status]||0)+1;return {userId:u.id,...a};});
  const studioTables=['pieces','piece_photos','glazes','glaze_photos','clay_bodies','clay_photos','firing_logs','firing_photos','test_tiles','studio_notes','sales'];
  const studioRecords={};for(const table of studioTables)if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))studioRecords[table]=db.prepare('SELECT COUNT(*) count FROM '+table).get().count;
  return {policy:'preserve-until-explicit-deletion',auditedAt:new Date().toISOString(),total:users.length,counts,studioRecords,members};
}
// Build ownership lookup from the schema so all current and future direct media columns
// and photo child tables participate; no media is moved or renamed.
function mediaOwners(db) {
  const quote=s=>'"'+s.replace(/"/g,'""')+'"';
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name);
  const queries=[];
  for(const table of tables){
    const columns=db.pragma('table_info('+quote(table)+')').map(c=>c.name);
    const files=columns.filter(c=>/(^filename$|_filename\d*$)/.test(c));
    if(!files.length)continue;
    let owner=columns.includes('user_id')?'t.user_id':table==='users'?'t.id':null,join='';
    if(!owner){
      const fk=db.pragma('foreign_key_list('+quote(table)+')').find(f=>db.pragma('table_info('+quote(f.table)+')').some(c=>c.name==='user_id'));
      if(fk){owner='p.user_id';join=` JOIN ${quote(fk.table)} p ON t.${quote(fk.from)}=p.${quote(fk.to || 'id')}`;}
    }
    if(owner)queries.push(db.prepare(`SELECT ${owner} user_id FROM ${quote(table)} t${join} WHERE ${files.map(f=>'t.'+quote(f)+'=?').join(' OR ')}`));
  }
  return filename=>queries.flatMap(q=>q.all(...Array((q.source.match(/\?/g)||[]).length).fill(filename))).map(r=>r.user_id);
}
module.exports={init,record,access,audit,mediaOwners,recoveryAllowed,denial,DAY,MESSAGE};
