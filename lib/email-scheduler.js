'use strict';
function eligibleRecipients(db) {
  return db.prepare("SELECT lower(trim(email)) AS email FROM users WHERE email IS NOT NULL AND trim(email)!='' GROUP BY lower(trim(email)) HAVING MIN(newsletter_subscribed)=1").all().filter(u => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email));
}
function snapshotRecipients(db, id) {
  const users = eligibleRecipients(db);
  db.prepare('DELETE FROM scheduled_email_recipients WHERE campaign_id=?').run(id);
  const insert = db.prepare('INSERT INTO scheduled_email_recipients (campaign_id,email) VALUES (?,?)');
  users.forEach(u=>insert.run(id,u.email));
  db.prepare('UPDATE scheduled_email_campaigns SET recipient_count=? WHERE id=?').run(users.length,id);
  return users.length;
}
async function sendDueCampaigns(db, transporter, now = new Date(), options = {}) {
  if (!transporter) return 0;
  const due = db.prepare("SELECT * FROM scheduled_email_campaigns WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 5").all(now.toISOString());
  let processed=0;
  for (const campaign of due) {
    if (!db.prepare("UPDATE scheduled_email_campaigns SET status='sending',updated_at=datetime('now') WHERE id=? AND status='scheduled'").run(campaign.id).changes) continue;
    processed++;
    try {
      const recipients=db.prepare("SELECT email FROM scheduled_email_recipients WHERE campaign_id=? AND status='pending'").all(campaign.id);
      for (const {email} of recipients) {
        if (db.prepare('SELECT status FROM scheduled_email_campaigns WHERE id=?').get(campaign.id).status==='cancelled') break;
        if (!eligibleRecipients(db).some(u=>u.email===email)) {
          db.prepare("UPDATE scheduled_email_recipients SET status='skipped',error_message='No longer subscribed' WHERE campaign_id=? AND email=?").run(campaign.id,email); continue;
        }
        if (!db.prepare("UPDATE scheduled_email_recipients SET status='attempted' WHERE campaign_id=? AND email=? AND status='pending'").run(campaign.id,email).changes) continue;
        try {
          const footer=options.unsubscribeUrl ? options.unsubscribeUrl(email) : '';
          const info=await transporter.sendMail({from:options.from || process.env.SMTP_USER || 'preview@example.invalid',to:email,subject:campaign.subject,
            html:campaign.html+(footer?'<hr><p><a href="'+footer+'">Unsubscribe</a></p>':''),text:(campaign.text || campaign.html.replace(/<[^>]+>/g,''))+(footer?'\nUnsubscribe: '+footer:''),
            ...(footer?{headers:{'List-Unsubscribe':'<'+footer+'>'}}:{})});
          if (info?.rejected?.length) throw new Error('Mail provider rejected recipient');
          db.prepare("UPDATE scheduled_email_recipients SET status='sent',sent_at=datetime('now') WHERE campaign_id=? AND email=?").run(campaign.id,email);
        } catch(err) { db.prepare("UPDATE scheduled_email_recipients SET status='failed',error_message=? WHERE campaign_id=? AND email=?").run(String(err.message).slice(0,500),campaign.id,email); }
      }
      const counts=db.prepare("SELECT SUM(status='sent') AS delivered,SUM(status IN ('failed','attempted')) AS failed FROM scheduled_email_recipients WHERE campaign_id=?").get(campaign.id);
      db.prepare("UPDATE scheduled_email_campaigns SET status=?,sent_at=datetime('now'),delivered_count=?,failed_count=?,updated_at=datetime('now') WHERE id=? AND status!='cancelled'").run(counts.failed?'failed':'sent',counts.delivered||0,counts.failed||0,campaign.id);
    } catch(err) { db.prepare("UPDATE scheduled_email_campaigns SET status='failed',error_message=?,updated_at=datetime('now') WHERE id=?").run(String(err.message).slice(0,500),campaign.id); }
  }
  return processed;
}
module.exports={sendDueCampaigns,eligibleRecipients,snapshotRecipients};
