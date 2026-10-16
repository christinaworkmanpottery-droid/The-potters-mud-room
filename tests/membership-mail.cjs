'use strict';
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const {createReliableMailer}=require('../lib/reliable-mail');
const {createMembershipMail,eligible,welcome}=require('../lib/membership-mail');
const {publicLinks}=require('../lib/public-links');
(async()=>{
 const db=new Database(':memory:');
 db.exec('CREATE TABLE users(id TEXT,email TEXT,tier TEXT,billing_period TEXT,stripe_subscription_id TEXT,is_beta_tester INTEGER,plan_expires_at TEXT); CREATE TABLE billing_state(id TEXT PRIMARY KEY,json TEXT)');
 const end=new Date(Date.now()+86400000).toISOString();
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('u','member@potter.test','starter','yearly','s',0,end);
 const sub={id:'s',userId:'u',customerId:'c',email:'member@potter.test',name:'Alex <script>',paid:true,billingPeriod:'yearly',periodEnd:end};
 const state={checkedAt:new Date().toISOString(),subscriptions:[sub]};
 const save=()=>db.prepare("INSERT INTO billing_state VALUES('reconciliation',?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(JSON.stringify(state));save();
 const sent=[];let fail=false;
 const smtp={createTransport:()=>({sendMail:async m=>{if(fail)throw Object.assign(Error('temporarily unavailable'),{responseCode:450,command:'MAIL FROM'});sent.push(m);return {accepted:[m.to]};},close(){}})};
 const mailer=createReliableMailer(db,smtp,{auth:{user:'sender',pass:'synthetic'}},{noTimer:true,sleep:async()=>{},eligible:m=>eligible(db,m)});
 let customerEmail=sub.email;
 const stripe={checkout:{sessions:{retrieve:async()=>({livemode:true,mode:'subscription',payment_status:'paid',subscription:'s'})}},customers:{retrieve:async()=>({livemode:true,email:customerEmail})},invoices:{retrieve:async()=>({livemode:true,billing_reason:'subscription_cycle',status:'paid',amount_paid:6950,subscription:'s'})}};
 const membership=createMembershipMail({db,stripe,getTransporter:()=>mailer,getSender:()=> 'sender@potter.test'});
 const event={type:'checkout.session.completed',object_id:'checkout'};
 await membership.queue(state,event);await mailer.work();
 assert.equal(sent.length,1);assert.match(sent[0].text,/annual Unlimited/);assert.match(sent[0].text,/https:\/\/thepottersmudroom.com/);
 await membership.queue(state,event);await mailer.work();assert.equal(sent.length,1);
 assert.equal(db.prepare("SELECT status FROM smtp_delivery_log WHERE id='membership-welcome:s'").get().status,'accepted');
 await membership.queue(state,{type:'invoice.paid',object_id:'invoice'});await mailer.work();assert.equal(sent.length,1);
 customerEmail='other@potter.test';await assert.rejects(()=>membership.queue(state,event),/identity mismatch/);customerEmail=sub.email;
 sub.paid=false;save();await membership.queue(state,event);assert.equal(sent.length,1);sub.paid=true;
 sub.cancelAtPeriodEnd=true;save();await membership.queue(state,event);assert.equal(sent.length,1);sub.cancelAtPeriodEnd=false;save();
 const probe={deliveryKind:'membership',membershipUserId:'u',membershipSubscriptionId:'s',to:sub.email};
 for(const patch of ["billing_period='promo'","is_beta_tester=1","tier='free'","stripe_subscription_id='other'","email='other@potter.test'"]){
  db.exec('UPDATE users SET '+patch);assert.equal(eligible(db,probe),false);
  db.prepare('UPDATE users SET email=?,tier=?,billing_period=?,stripe_subscription_id=?,is_beta_tester=0').run(sub.email,'starter','yearly','s');
 }
 state.checkedAt=new Date(Date.now()-3*3600000).toISOString();save();assert.throws(()=>eligible(db,probe),/stale/);state.checkedAt=new Date().toISOString();save();
 assert.match(welcome({...sub,billingPeriod:'monthly'}).text,/a monthly Unlimited/);
 assert.match(welcome({...sub,billingPeriod:'monthly'}).text,/billed monthly/);
 assert.doesNotMatch(welcome({...sub,name:'<script>'}).html,/<script>/);
 assert.equal(publicLinks('https://the-potters-mud-room.onrender.com/#pieces https://example.com'),'https://thepottersmudroom.com/#pieces https://example.com');
 // Pending messages already persisted with old links are corrected at send time.
 fail=true;await assert.rejects(()=>mailer.sendMail({deliveryKey:'retry',to:sub.email,text:'https://the-potters-mud-room.onrender.com/#pieces'}));
 assert.equal(db.prepare("SELECT status FROM smtp_delivery_log WHERE id='retry'").get().status,'retry_pending');
 fail=false;db.exec("UPDATE smtp_delivery_log SET retry_at=0 WHERE id='retry'");await mailer.work();assert.equal(sent.length,2);assert.match(sent[1].text,/https:\/\/thepottersmudroom.com/);
 mailer.close();db.close();console.log('PASS membership welcome: payment gate, identity, annual/monthly, duplicates, renewals, canceled/unpaid/gift/test exclusions, stale evidence, retry and public URLs');
})().catch(e=>{console.error(e);process.exitCode=1;});
