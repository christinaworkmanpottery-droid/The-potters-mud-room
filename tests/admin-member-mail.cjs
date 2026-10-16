'use strict';
const assert=require('node:assert/strict');
const express=require('express');
const Database=require('better-sqlite3');
const {register,personal}=require('../lib/admin-member-mail');
const {createReliableMailer}=require('../lib/reliable-mail');
(async()=>{
 const db=new Database(':memory:');
 db.exec('CREATE TABLE users(id TEXT,email TEXT,display_name TEXT,tier TEXT,billing_period TEXT,stripe_subscription_id TEXT,stripe_customer_id TEXT,is_beta_tester INTEGER,plan_expires_at TEXT)');
 db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?)').run('member','member@potter.test','Erin Ascher','starter','yearly','sub','cus',0,new Date(Date.now()+86400000).toISOString());
 const sub={id:'sub',userId:'member',paid:true,billingPeriod:'yearly',email:'member@potter.test'};
 let customerEmail='member@potter.test',accessStatus=200,failUnknown=false;
 const sent=[];
 const mailer=createReliableMailer(db,{createTransport:()=>({sendMail:async m=>{if(failUnknown)throw Error('Connection lost after DATA');sent.push(m);return {accepted:[m.to],messageId:m.messageId,response:'250 2.0.0 OK synthetic'};},close(){}})},{auth:{user:'owner@potter.test',pass:'synthetic'}},{noTimer:true,sleep:async()=>{}});
 const stripe={customers:{retrieve:async()=>({id:'cus',livemode:true,email:customerEmail})},subscriptions:{retrieve:async()=>({id:'sub',livemode:true,customer:'cus',status:'active',latest_invoice:'inv',items:{data:[{price:{recurring:{interval:'year'}}}]}})},invoices:{retrieve:async()=>({id:'inv',livemode:true,customer:'cus',status:'paid',amount_paid:6950,currency:'usd'})}};
 const app=express();app.use(express.json());
 register({app,db,stripe,auth:(req,res,next)=>next(),isAdmin:req=>req.headers['x-test-admin']==='yes',billing:{readState:()=>({subscriptions:[sub]})},getTransporter:()=>mailer,getSender:()=> 'owner@potter.test',adminEmail:'owner@potter.test',verifyAccess:async()=>[{path:'/api/test-tiles',status:accessStatus}]});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(action,admin=true)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/admin/member-mail/'+action,{method:'POST',headers:{'content-type':'application/json',...(admin?{'x-test-admin':'yes'}:{})},body:JSON.stringify({email:'member@potter.test'})});return {status:r.status,data:await r.json()};};
 try {
  assert.equal((await call('send',false)).status,403);assert.equal(sent.length,0);
  customerEmail='wrong@potter.test';assert.equal((await call('send')).status,409);customerEmail='member@potter.test';
  accessStatus=403;assert.equal((await call('send')).status,409);assert.equal(sent.length,0);accessStatus=200;
  const v=await call('verify');assert.equal(v.data.recipient,'member@potter.test');assert.equal(v.data.paymentAmount,69.5);assert.equal(sent.length,0);
  const first=await call('send');assert.equal(first.data.delivery.status,'accepted');assert.match(first.data.delivery.message_id,/@thepottersmudroom.com/);assert.match(first.data.delivery.smtp_response,/250/);
  await call('send');assert.equal(sent.length,1);assert.equal(first.data.delivery.attempts,1);
  assert.equal(sent[0].subject,'A Personal Thank You from The Potter’s Mud Room');assert.match(sent[0].text,/Hi Erin,/);assert.match(sent[0].text,/https:\/\/thepottersmudroom.com/);assert.match(sent[0].html,/<a href="https:\/\/thepottersmudroom.com"/);
  const test=await call('welcome-test');assert.equal(test.data.delivery.status,'accepted');assert.equal(test.data.duplicateWebhookSuppressed,true);assert.equal(sent.length,2);assert.equal(sent[1].to,'owner@potter.test');await call('welcome-test');assert.equal(sent.length,2);
  assert.equal(db.prepare('SELECT tier FROM users').get().tier,'starter');
  failUnknown=true;await assert.rejects(()=>mailer.sendMail({deliveryKey:'unknown-test',to:'owner@potter.test',text:'test'}));assert.equal(db.prepare("SELECT status FROM smtp_delivery_log WHERE id='unknown-test'").get().status,'unknown');
  failUnknown=false;await mailer.work();assert.equal(sent.length,2);
  const dedup=await mailer.sendMail({deliveryKey:'personal-annual-thanks:sub',to:'member@potter.test'});assert.equal(dedup.messageId,first.data.delivery.message_id);assert.equal(sent.length,2);
  assert.doesNotMatch(personal('<script>').html,/<script>/);
  console.log('PASS admin membership email: admin authorization, identity/access gates, no-send verification, exact template, persisted SMTP receipt, duplicate suppression, Admin-only live test fixture, unknown-outcome hold');
 }finally{server.close();mailer.close();db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
