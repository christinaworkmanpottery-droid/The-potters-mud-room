const assert = require('node:assert/strict');
const { sendDueCampaigns } = require('../lib/email-scheduler');
(async () => {
  const rows = [{id:'campaign-1',subject:'Survey',html:'<p>Survey</p>',text:null}];
  let claimed=false, recipientStatus='pending', campaignStatus='scheduled', sendCount=0;
  const db = {
    transaction: fn => fn,
    prepare(sql) {
      if (sql.includes("FROM scheduled_email_campaigns WHERE status='scheduled'")) return {all:()=>campaignStatus==='scheduled'?rows:[]};
      if (sql.includes("SET status='sending'")) return {run:()=>{if(claimed)return {changes:0};claimed=true;campaignStatus='sending';return {changes:1}}};
      if (sql.includes('SELECT DISTINCT lower(trim(email))')) return {all:()=>[{email:'subscriber@example.com'}]};
      if (sql.includes('INSERT OR IGNORE INTO scheduled_email_recipients')) return {run:()=>({changes:1})};
      if (sql.includes('SELECT email FROM scheduled_email_recipients')) return {all:()=>recipientStatus==='pending'?[{email:'subscriber@example.com'}]:[]};
      if (sql.includes("SET status='attempted'")) return {run:()=>{recipientStatus='attempted';return {changes:1}}};
      if (sql.includes("SET status='sent',sent_at")) return {run:()=>{recipientStatus='sent';return {changes:1}}};
      if (sql.includes('SUM(CASE WHEN')) return {get:()=>({delivered:1,failed:0})};
      if (sql.includes('UPDATE scheduled_email_campaigns SET status=?')) return {run:status=>{campaignStatus=status;return {changes:1}}};
      return {run:()=>({changes:1})};
    }
  };
  const mailer={sendMail:async()=>{sendCount++}};
  assert.equal(await sendDueCampaigns(db,mailer,new Date('2026-10-14T17:00:00Z')),1);
  assert.equal(sendCount,1);
  assert.equal(campaignStatus,'sent');
  assert.equal(await sendDueCampaigns(db,mailer,new Date('2026-10-14T17:01:00Z')),0);
  assert.equal(sendCount,1);
  console.log('email scheduler tests passed');
})().catch(e=>{console.error(e);process.exitCode=1});
