'use strict';
process.env.PREVIEW_MODE='true';
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const {createReliableMailer}=require('../lib/reliable-mail');
const {sendDueCampaigns,ensureRetrySchema,recoverAuthenticationFailures}=require('../lib/email-scheduler');
(async()=>{
 const db=new Database(':memory:');let now=1000000,calls=0,config,fail=true;
 const provider={createTransport(c){config=c;return {close(){},async sendMail(m){calls++;if(fail)throw Object.assign(Error('454-4.7.0 Too many login attempts'),{code:'EAUTH',command:'AUTH PLAIN',responseCode:454});return {accepted:[m.to]};}};}};
 const opts={noTimer:true,clock:()=>now,sleep:async ms=>{now+=ms;}};
 let mailer=createReliableMailer(db,provider,{auth:{user:'test@example.invalid',pass:'synthetic'}},opts);
 assert.equal(config.pool,true);assert.equal(config.maxConnections,1);
 await Promise.allSettled(Array.from({length:31},(_,i)=>mailer.sendMail({to:i+'@example.invalid'})));
 assert.equal(calls,1,'31 queued failures must cause only one authentication attempt');
 const first=mailer.state().blocked_until;assert.equal(first-now,3600000);
 mailer.close();mailer=createReliableMailer(db,provider,{auth:{user:'test@example.invalid'}},opts);
 await assert.rejects(mailer.sendMail({to:'restart@example.invalid'}),/paused/);assert.equal(calls,1);
 now=first+1;await assert.rejects(mailer.sendMail({to:'backoff@example.invalid'}));assert.equal(mailer.state().blocked_until-now,7200000);
 now=mailer.state().blocked_until+1;fail=false;
 await mailer.sendMail({deliveryKey:'stable',to:'ok@example.invalid'});const before=calls;
 await mailer.sendMail({deliveryKey:'stable',to:'ok@example.invalid'});assert.equal(calls,before);
 db.exec(`CREATE TABLE users(email TEXT,newsletter_subscribed INTEGER);CREATE TABLE scheduled_email_campaigns(id TEXT PRIMARY KEY,subject TEXT,html TEXT,text TEXT,status TEXT,scheduled_at TEXT,updated_at TEXT,sent_at TEXT,recipient_count INTEGER,delivered_count INTEGER,failed_count INTEGER,error_message TEXT);CREATE TABLE scheduled_email_recipients(campaign_id TEXT,email TEXT,status TEXT DEFAULT 'pending',sent_at TEXT,error_message TEXT,PRIMARY KEY(campaign_id,email));CREATE TABLE member_survey_responses(id INTEGER PRIMARY KEY,answers_json TEXT);`);
 ensureRetrySchema(db);
 db.exec("INSERT INTO scheduled_email_campaigns(id,subject,html,status,recipient_count) VALUES ('survey','Survey','Survey','failed',120)");
 for(let i=0;i<120;i++){const email=i+'@example.invalid';db.prepare('INSERT INTO users VALUES (?,1)').run(email);db.prepare('INSERT INTO scheduled_email_recipients(campaign_id,email,status,sent_at,error_message) VALUES (?,?,?,?,?)').run('survey',email,i<89?'sent':'failed',i<89?'2026-10-14':null,i<89?null:'454-4.7.0 Too many login attempts');}
 for(let i=0;i<4;i++)db.prepare('INSERT INTO member_survey_responses(answers_json) VALUES (?)').run('anonymous-'+i);
 const original=db.prepare('SELECT * FROM member_survey_responses').all();
 assert.throws(()=>recoverAuthenticationFailures(db,'survey',30),/count changed/);
 assert.equal(recoverAuthenticationFailures(db,'survey',31),31);
 assert.throws(()=>recoverAuthenticationFailures(db,'survey',31));
 let recipients=[];await sendDueCampaigns(db,{sendMail:async m=>{recipients.push(m.to);return {accepted:[m.to]};}},new Date(Date.now()+1000));
 assert.throws(()=>require('../lib/email-scheduler').snapshotRecipients(db,'survey'),/cannot be resnapshotted/);
 assert.equal(recipients.length,31);assert.equal(new Set(recipients).size,31);assert.ok(recipients.every(e=>Number(e.split('@')[0])>=89));
 await sendDueCampaigns(db,mailer,new Date(Date.now()+10000));assert.equal(recipients.length,31);
 assert.deepEqual(db.prepare('SELECT * FROM member_survey_responses').all(),original);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM scheduled_email_recipients WHERE status='sent'").get().n,120);
 // Durable replay of a non-campaign message after cooldown and mailer restart.
 fail=true;await assert.rejects(mailer.sendMail({deliveryKey:'welcome:fixture',to:'welcome@example.invalid'}));
 const resume=mailer.state().blocked_until;mailer.close();
 fail=false;now=resume+1;mailer=createReliableMailer(db,provider,{auth:{user:'test@example.invalid'}},opts);
 await mailer.work();await mailer.work();assert.equal(db.prepare("SELECT status FROM smtp_delivery_log WHERE id='welcome:fixture'").get().status,'accepted');
 const countAfter=calls;await mailer.work();assert.equal(calls,countAfter);
 // An unknown post-DATA disconnect must never be automatically replayed.
 const uncertain=createReliableMailer(db,{createTransport(){return {close(){},async sendMail(){throw Object.assign(Error('Socket lost after DATA'),{code:'ECONNECTION',command:'DATA'});}};}},{auth:{user:'uncertain@example.invalid'}},opts);
 await assert.rejects(uncertain.sendMail({deliveryKey:'uncertain',to:'x@example.invalid'}));
 assert.equal(db.prepare("SELECT status FROM smtp_delivery_log WHERE id='uncertain'").get().status,'unknown');await uncertain.work();uncertain.close();
 // Reserved test addresses are never eligible for real production campaigns.
 process.env.PREVIEW_MODE='false';assert.equal(require('../lib/email-scheduler').eligibleRecipients(db).length,0);
 db.prepare('INSERT INTO users VALUES (?,1)').run('member@fixture.test');assert.equal(require('../lib/email-scheduler').eligibleRecipients(db).length,1);
 mailer.close();db.close();console.log('PASS reliability: pooled single connection, burst circuit breaker, persisted cooldown, exponential backoff, idempotency, exact 31-of-120 recovery, repeat recovery protection, four synthetic anonymous responses preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
