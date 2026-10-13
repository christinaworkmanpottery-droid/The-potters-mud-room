'use strict';
// A single worker claims a due campaign and records individual delivery outcomes.
async function sendDueCampaigns(db, transporter, now = new Date()) {
  if (!transporter) return 0;
  const due = db.prepare("SELECT * FROM scheduled_email_campaigns WHERE status='scheduled' AND scheduled_at<=? ORDER BY scheduled_at LIMIT 5").all(now.toISOString());
  let processed = 0;
  for (const campaign of due) {
    const claimed = db.prepare("UPDATE scheduled_email_campaigns SET status='sending',updated_at=datetime('now') WHERE id=? AND status='scheduled'").run(campaign.id);
    if (!claimed.changes) continue;
    processed++;
    try {
      const users = db.prepare("SELECT DISTINCT lower(trim(email)) AS email FROM users WHERE newsletter_subscribed=1 AND email IS NOT NULL AND trim(email)!=''").all();
      const add = db.prepare("INSERT OR IGNORE INTO scheduled_email_recipients (campaign_id,email) VALUES (?,?)");
      const createRecipients = db.transaction(() => users.forEach(u => add.run(campaign.id, u.email)));
      createRecipients();
      const recipients = db.prepare("SELECT email FROM scheduled_email_recipients WHERE campaign_id=? AND status='pending'").all(campaign.id);
      db.prepare("UPDATE scheduled_email_campaigns SET recipient_count=? WHERE id=?").run(recipients.length,campaign.id);
      for (const recipient of recipients) {
        // Mark before dispatch to prevent accidental duplicate delivery after restart.
        db.prepare("UPDATE scheduled_email_recipients SET status='attempted' WHERE campaign_id=? AND email=? AND status='pending'").run(campaign.id,recipient.email);
        try {
          await transporter.sendMail({
            from:process.env.SMTP_USER || 'thepottersmudroom@gmail.com',
            to:recipient.email, subject:campaign.subject, html:campaign.html,
            text:campaign.text || campaign.html.replace(/<[^>]+>/g,'')
          });
          db.prepare("UPDATE scheduled_email_recipients SET status='sent',sent_at=datetime('now') WHERE campaign_id=? AND email=?").run(campaign.id,recipient.email);
        } catch(err) {
          db.prepare("UPDATE scheduled_email_recipients SET status='failed',error_message=? WHERE campaign_id=? AND email=?").run(String(err.message).slice(0,500),campaign.id,recipient.email);
        }
      }
      const counts = db.prepare("SELECT SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS delivered,SUM(CASE WHEN status!='sent' THEN 1 ELSE 0 END) AS failed FROM scheduled_email_recipients WHERE campaign_id=?").get(campaign.id);
      db.prepare("UPDATE scheduled_email_campaigns SET status=?,sent_at=datetime('now'),delivered_count=?,failed_count=?,updated_at=datetime('now') WHERE id=?")
        .run(counts.failed ? 'failed':'sent',counts.delivered || 0,counts.failed || 0,campaign.id);
    } catch(err) {
      db.prepare("UPDATE scheduled_email_campaigns SET status='failed',error_message=?,updated_at=datetime('now') WHERE id=?").run(String(err.message).slice(0,500),campaign.id);
      console.error('[email scheduler]',err);
    }
  }
  return processed;
}
module.exports = { sendDueCampaigns };
