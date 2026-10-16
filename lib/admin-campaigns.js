'use strict';
const {randomUUID}=require('crypto');
const jwt=require('jsonwebtoken');
const {parseScheduledAt}=require('./blog-scheduler');
const {sendDueCampaigns,eligibleRecipients,snapshotRecipients,ensureRetrySchema,recoverAuthenticationFailures}=require('./email-scheduler');
module.exports=function installCampaigns(app,db,auth,isAdmin,getTransporter,secret) {
  ensureRetrySchema(db);
  const preview=process.env.PREVIEW_MODE==='true';
  db.exec('CREATE TABLE IF NOT EXISTS preview_email_outbox (id TEXT PRIMARY KEY, recipient TEXT, subject TEXT, html TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  // An interrupted SMTP attempt is never retried automatically: delivery may have occurred.
  db.prepare("UPDATE scheduled_email_campaigns SET status='failed',error_message='Delivery interrupted; inspect recipient outcomes before any manual follow-up' WHERE status='sending'").run();
  const guard=(req,res,next)=>isAdmin(req)?next():res.status(403).json({error:'Admin only'});
  const capture={sendMail:async mail=>{
    if (!String(mail.to).endsWith('@example.invalid')) throw Error('Preview accepts example.invalid recipients only');
    db.prepare('INSERT INTO preview_email_outbox (id,recipient,subject,html) VALUES (?,?,?,?)').run(randomUUID(),mail.to,mail.subject,mail.html);
    return {accepted:[mail.to]};
  }};
  const mailer=()=>preview?capture:getTransporter();
  const opts=()=>({from:process.env.SMTP_USER || db.prepare("SELECT value FROM site_settings WHERE key='smtp_user'").get()?.value,
    unsubscribeUrl:email=>(process.env.APP_URL || 'https://thepottersmudroom.com')+'/api/campaign-unsubscribe?token='+encodeURIComponent(jwt.sign({purpose:'campaign-unsubscribe',email},secret))});
  app.get('/api/campaign-unsubscribe',(req,res)=>{
    try { const token=jwt.verify(req.query.token,secret); if(token.purpose!=='campaign-unsubscribe') throw Error();
      // GET shows confirmation so security scanners do not unsubscribe users.
      res.type('html').send('<meta name="viewport" content="width=device-width"><h1>Email preferences</h1><form method="post"><input type="hidden" name="token" value="'+String(req.query.token).replace(/[^a-zA-Z0-9_.-]/g,'')+'"><button>Unsubscribe from emails</button></form>');
    } catch {res.status(400).send('Invalid unsubscribe link');}
  });
  app.post('/api/campaign-unsubscribe',require('express').urlencoded({extended:false}),(req,res)=>{
    try {const token=jwt.verify(req.body.token,secret);if(token.purpose!=='campaign-unsubscribe')throw Error();db.prepare('UPDATE users SET newsletter_subscribed=0 WHERE lower(trim(email))=?').run(token.email);res.send('You are unsubscribed.');}catch{res.status(400).send('Invalid unsubscribe link');}
  });
  app.get('/api/admin/email-campaigns/eligibility',auth,guard,(req,res)=>res.json({recipients:eligibleRecipients(db),preview,configured:!!mailer(),deliveryMode:preview?'Preview mailbox only — no real emails sent':'SMTP acceptance (inbox delivery not guaranteed)'}));
  app.get('/api/admin/email-campaigns/outbox',auth,guard,(req,res)=>res.json(preview?db.prepare('SELECT * FROM preview_email_outbox ORDER BY created_at DESC LIMIT 50').all():[]));
  app.get('/api/admin/email-campaigns/delivery-log',auth,guard,(req,res)=>{
    if(!getTransporter())return res.json([]);
    res.json(db.prepare('SELECT id,recipient,status,error_message,retry_at,attempts,created_at,updated_at FROM smtp_delivery_log ORDER BY created_at DESC LIMIT 250').all());
  });
  app.post('/api/admin/email-campaigns/sender-check',auth,guard,async(req,res)=>{
    try {
      if(!mailer())throw Error('Email delivery is not configured');
      const admin=db.prepare('SELECT email FROM users WHERE id=?').get(req.userId);
      await mailer().sendMail({deliveryKey:'sender-check:'+req.userId+':'+Math.floor(Date.now()/300000),from:opts().from,to:admin.email,subject:'The Potter’s Mud Room — email delivery check',text:'This diagnostic confirms SMTP acceptance for the email system repair. It is not a survey invitation.',expiresAt:Date.now()+900000});
      res.json({message:'Sender check accepted by SMTP. Inbox delivery is not confirmed.'});
    }catch(e){res.status(409).json({error:e.message});}
  });
  app.get('/api/admin/email-campaigns',auth,guard,(req,res)=>{
    const campaigns=db.prepare('SELECT * FROM scheduled_email_campaigns ORDER BY created_at DESC LIMIT 100').all();
    const responses=db.prepare("SELECT name FROM sqlite_master WHERE name='member_survey_responses'").get()?db.prepare('SELECT COUNT(*) AS n FROM member_survey_responses').get().n:0;
    res.json(campaigns.map(c=>({...c,...db.prepare("SELECT SUM(status='sent') AS accepted_count,SUM(status='failed') AS actual_failed_count,SUM(status IN ('pending','retry_pending')) AS pending_count,SUM(status='attempted') AS uncertain_count,SUM(status='skipped') AS skipped_count FROM scheduled_email_recipients WHERE campaign_id=?").get(c.id),confirmed_delivered:null,reliable_opens:null,survey_responses:/survey\.html|member-survey/.test(c.html)?responses:null})));
  });
  app.get('/api/admin/email-campaigns/:id/recipients',auth,guard,(req,res)=>res.json(db.prepare('SELECT email,status,error_message,sent_at,attempts,retry_at FROM scheduled_email_recipients WHERE campaign_id=?').all(req.params.id)));
  function save(req,res) {
    try {
      const existing=req.params.id?db.prepare('SELECT * FROM scheduled_email_campaigns WHERE id=?').get(req.params.id):null;
      if(req.params.id&&!existing)return res.status(404).json({error:'Campaign not found'});
      if(existing&&!['draft','scheduled'].includes(existing.status))return res.status(409).json({error:'Campaign is already processing or completed'});
      const {subject,html,text,scheduledAt,cancel}=req.body;
      if(cancel&&existing){db.prepare("UPDATE scheduled_email_campaigns SET status='cancelled',scheduled_at=NULL WHERE id=? AND status IN ('draft','scheduled')").run(existing.id);return res.json({status:'cancelled'});}
      if(typeof subject!=='string'||!subject.trim()||subject.length>200||typeof html!=='string'||!html.trim()||html.length>100000)throw Error('Subject and email HTML required (maximum 200 / 100,000 characters)');
      if(req.body.audience&&req.body.audience!=='subscribers')throw Error('Unsupported audience');
      const scheduled=scheduledAt?parseScheduledAt(scheduledAt):null;
      if(scheduled&&!mailer())throw Error('Email delivery is not configured');
      if(scheduled&&req.body.recipientCount!==eligibleRecipients(db).length)throw Error('Review the current recipient audience before scheduling');
      const id=existing?.id||randomUUID();
      db.transaction(()=>{
        if(existing)db.prepare("UPDATE scheduled_email_campaigns SET subject=?,html=?,text=?,status=?,scheduled_at=?,updated_at=datetime('now') WHERE id=?").run(subject.trim(),html,text||null,scheduled?'scheduled':'draft',scheduled,id);
        else db.prepare('INSERT INTO scheduled_email_campaigns (id,subject,html,text,audience,status,scheduled_at,created_by) VALUES (?,?,?,?,?,?,?,?)').run(id,subject.trim(),html,text||null,'subscribers',scheduled?'scheduled':'draft',scheduled,req.userId);
        if(scheduled)snapshotRecipients(db,id);
      })();
      res.json({id,status:scheduled?'scheduled':'draft'});
    }catch(e){res.status(400).json({error:e.message});}
  }
  app.post('/api/admin/email-campaigns',auth,guard,save);
  app.put('/api/admin/email-campaigns/:id',auth,guard,save);
  app.post('/api/admin/email-campaigns/:id/test',auth,guard,async(req,res)=>{
    try{const c=db.prepare('SELECT * FROM scheduled_email_campaigns WHERE id=?').get(req.params.id);if(!c)return res.status(404).json({error:'Campaign not found'});
      const admin=db.prepare('SELECT email FROM users WHERE id=?').get(req.userId);
      if(!mailer())throw Error('Email delivery is not configured');
      await mailer().sendMail({from:opts().from,to:admin.email,subject:'[TEST] '+c.subject,html:c.html});
      res.json({message:preview?'Test captured in Preview Mailbox; no email sent':'Test accepted by mail provider for '+admin.email});
    }catch(e){res.status(400).json({error:e.message});}
  });
  app.post('/api/admin/email-campaigns/:id/recover',auth,guard,(req,res)=>{
    try {
      if(req.body.confirm!==true)throw Error('Explicit recovery confirmation required');
      if(!mailer())throw Error('Email delivery is not configured');
      const health=mailer().state?.();
      if(!preview&&(!health?.last_success||Date.now()-health.last_success>900000||health.blocked_until>Date.now()||health.disabled))throw Error('Run Check sender successfully before recovery');
      const count=recoverAuthenticationFailures(db,req.params.id,req.body.failedCount);
      res.json({queued:count,message:'Queued only verified authentication failures; accepted recipients excluded.'});
    }catch(e){res.status(409).json({error:e.message});}
  });
  app.post('/api/admin/email-campaigns/:id/send',auth,guard,async(req,res)=>{
    try{
      if(req.body.confirm!==true)throw Error('Explicit send confirmation required');
      if(!mailer())throw Error('Email delivery is not configured');
      if(req.body.recipientCount!==eligibleRecipients(db).length)throw Error('Recipient count changed; review the audience again');
      db.transaction(()=>{
        const changed=db.prepare("UPDATE scheduled_email_campaigns SET status='scheduled',scheduled_at=? WHERE id=? AND status='draft'").run(new Date().toISOString(),req.params.id);
        if(!changed.changes)throw Error('Only a draft can be sent immediately');
        snapshotRecipients(db,req.params.id);
      })();
      await work();res.json({message:preview?'Processed in Preview Mailbox; no real emails sent':'Campaign processed; review recipient results'});
    }catch(e){res.status(400).json({error:e.message});}
  });
  let busy=false;
  async function work(){if(busy)return;busy=true;try{await sendDueCampaigns(db,mailer(),new Date(),opts());}finally{busy=false;}}
  const timer=setInterval(()=>work().catch(e=>console.error('[campaign worker]',e.message)),10000);timer.unref();
};
