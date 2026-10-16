'use strict';
function ensureRetrySchema(db) {
  db.exec('CREATE TABLE IF NOT EXISTS email_recovery_audit (campaign_id TEXT, email TEXT, original_error TEXT, recovered_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(campaign_id,email))');
  const columns=db.prepare('PRAGMA table_info(scheduled_email_recipients)').all().map(c=>c.name);
  for(const [name,type] of [['attempts','INTEGER NOT NULL DEFAULT 0'],['retry_at','TEXT']])
    if(!columns.includes(name))db.exec('ALTER TABLE scheduled_email_recipients ADD COLUMN '+name+' '+type);
}
function recoverAuthenticationFailures(db,id,expectedCount) {
  ensureRetrySchema(db);
  return db.transaction(()=>{
    const c=db.prepare('SELECT status FROM scheduled_email_campaigns WHERE id=?').get(id);
    if(!c||!['failed','sent'].includes(c.status))throw Error('Campaign is not eligible for recovery');
    const rows=db.prepare("SELECT email,error_message FROM scheduled_email_recipients WHERE campaign_id=? AND status='failed' AND sent_at IS NULL AND attempts=0").all(id)
      .filter(r=>/454[ -]4\.7\.0|too many login attempts/i.test(r.error_message||''));
    if(!rows.length||rows.length!==expectedCount)throw Error('Verified failure count changed; review recipient records');
    for(const r of rows)db.prepare('INSERT OR IGNORE INTO email_recovery_audit(campaign_id,email,original_error) VALUES (?,?,?)').run(id,r.email,r.error_message);
    for(const r of rows)db.prepare("UPDATE scheduled_email_recipients SET status='retry_pending',retry_at=? WHERE campaign_id=? AND email=? AND status='failed' AND sent_at IS NULL").run(new Date().toISOString(),id,r.email);
    db.prepare("UPDATE scheduled_email_campaigns SET status='scheduled',scheduled_at=?,error_message=NULL WHERE id=?").run(new Date().toISOString(),id);
    return rows.length;
  })();
}
function eligibleRecipients(db) {
  return db.prepare("SELECT lower(trim(email)) AS email FROM users WHERE email IS NOT NULL AND trim(email)!='' GROUP BY lower(trim(email)) HAVING MIN(newsletter_subscribed)=1").all().filter(u => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email) && (process.env.PREVIEW_MODE==='true'|| !/@(?:example\.(?:com|net|org)|.*\.invalid)$/i.test(u.email)));
}
function snapshotRecipients(db, id) {
  if(db.prepare("SELECT 1 FROM scheduled_email_recipients WHERE campaign_id=? AND status!='pending' LIMIT 1").get(id))throw Error('A campaign with delivery history cannot be resnapshotted or resent');
  const users = eligibleRecipients(db);
  db.prepare('DELETE FROM scheduled_email_recipients WHERE campaign_id=?').run(id);
  const insert = db.prepare('INSERT INTO scheduled_email_recipients (campaign_id,email) VALUES (?,?)');
  users.forEach(u=>insert.run(id,u.email));
  db.prepare('UPDATE scheduled_email_campaigns SET recipient_count=? WHERE id=?').run(users.length,id);
  return users.length;
}
async function sendDueCampaigns(db, transporter, now = new Date(), options = {}) {
  if (!transporter) return 0;
  ensureRetrySchema(db);
  const due = db.prepare("SELECT * FROM scheduled_email_campaigns WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 5").all(now.toISOString());
  let processed=0;
  for (const campaign of due) {
    if (!db.prepare("UPDATE scheduled_email_campaigns SET status='sending',updated_at=datetime('now') WHERE id=? AND status='scheduled'").run(campaign.id).changes) continue;
    processed++;
    try {
      const recipients=db.prepare("SELECT email,attempts FROM scheduled_email_recipients WHERE campaign_id=? AND (status='pending' OR (status='retry_pending' AND retry_at<=?))").all(campaign.id,now.toISOString());
      for (const {email,attempts} of recipients) {
        if (db.prepare('SELECT status FROM scheduled_email_campaigns WHERE id=?').get(campaign.id).status==='cancelled') break;
        if (!eligibleRecipients(db).some(u=>u.email===email)) {
          db.prepare("UPDATE scheduled_email_recipients SET status='skipped',error_message='No longer subscribed or reserved test address' WHERE campaign_id=? AND email=?").run(campaign.id,email); continue;
        }
        if (!db.prepare("UPDATE scheduled_email_recipients SET status='attempted',attempts=attempts+1 WHERE campaign_id=? AND email=? AND status IN ('pending','retry_pending')").run(campaign.id,email).changes) continue;
        try {
          const footer=options.unsubscribeUrl ? options.unsubscribeUrl(email) : '';
          const info=await transporter.sendMail({deliveryKey:'campaign:'+campaign.id+':'+email,from:options.from || process.env.SMTP_USER || 'preview@example.invalid',to:email,subject:campaign.subject,
            html:campaign.html+(footer?'<hr><p><a href="'+footer+'">Unsubscribe</a></p>':''),text:(campaign.text || campaign.html.replace(/<[^>]+>/g,''))+(footer?'\nUnsubscribe: '+footer:''),
            ...(footer?{headers:{'List-Unsubscribe':'<'+footer+'>'}}:{})});
          if (info?.rejected?.length) throw new Error('Mail provider rejected recipient');
          db.prepare("UPDATE scheduled_email_recipients SET status='sent',sent_at=datetime('now'),error_message=NULL,retry_at=NULL WHERE campaign_id=? AND email=?").run(campaign.id,email);
        } catch(err) {
          const retry=err.retryable&&attempts<4;
          const retryAt=new Date(Math.max(err.retryAt||0,Date.now()+60000*2**attempts)).toISOString();
          db.prepare("UPDATE scheduled_email_recipients SET status=?,error_message=?,retry_at=? WHERE campaign_id=? AND email=?").run(retry?'retry_pending':'failed',String(err.message).slice(0,500),retry?retryAt:null,campaign.id,email);
          if(err.retryAt)break; // Account-wide restriction: do not try the next recipient.
        }
      }
      const waiting=db.prepare("SELECT COUNT(*) AS n,MIN(retry_at) AS next FROM scheduled_email_recipients WHERE campaign_id=? AND status IN ('pending','retry_pending')").get(campaign.id);
      if(waiting.n){db.prepare("UPDATE scheduled_email_campaigns SET status='scheduled',scheduled_at=? WHERE id=? AND status!='cancelled'").run(waiting.next||new Date(Date.now()+60000).toISOString(),campaign.id);continue;}
      const counts=db.prepare("SELECT SUM(status='sent') AS delivered,SUM(status IN ('failed','attempted')) AS failed FROM scheduled_email_recipients WHERE campaign_id=?").get(campaign.id);
      db.prepare("UPDATE scheduled_email_campaigns SET status=?,sent_at=datetime('now'),delivered_count=?,failed_count=?,updated_at=datetime('now') WHERE id=? AND status!='cancelled'").run(counts.failed?'failed':'sent',counts.delivered||0,counts.failed||0,campaign.id);
    } catch(err) { db.prepare("UPDATE scheduled_email_campaigns SET status='failed',error_message=?,updated_at=datetime('now') WHERE id=?").run(String(err.message).slice(0,500),campaign.id); }
  }
  return processed;
}
module.exports={sendDueCampaigns,eligibleRecipients,snapshotRecipients,ensureRetrySchema,recoverAuthenticationFailures};
