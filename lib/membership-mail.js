'use strict';
const {PUBLIC_URL} = require('./public-links');
const norm = s => String(s || '').trim().toLowerCase();
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function welcome(member) {
  const annual = member.billingPeriod === 'yearly';
  const plan = annual ? 'Annual' : 'Monthly';
  const first = String(member.name || '').trim().split(/\s+/)[0];
  const text = `${first ? 'Hi '+first+',' : 'Hello,'}\n\nThank you for choosing ${annual ? 'an annual' : 'a monthly'} Unlimited Membership with The Potter’s Mud Room! Your membership is active, and you can now track unlimited pottery pieces and use the Unlimited studio features.\n\nYour membership is billed ${annual ? 'yearly' : 'monthly'}. You can review your payment details and manage your subscription in your account.\n\nOpen your studio: ${PUBLIC_URL}\n\nIf you have any trouble signing in or using your membership, please reply to this email. I’m happy to help.\n\nThank you for supporting this small, potter-built business.\n\nHappy making,\nChristina\nFounder, The Potter’s Mud Room`;
  return {subject:`Thank you for your ${plan} Unlimited Membership`,text,html:`<div style="background:#f5f1eb;padding:28px;font-family:Arial,sans-serif;color:#302c29"><div style="max-width:560px;margin:auto;background:#fffdf9;padding:28px;border-radius:12px">${text.split('\n\n').map(p=>`<p style="font-size:17px;line-height:1.65">${escape(p).replace(/\n/g,'<br>').replace(PUBLIC_URL,`<a href="${PUBLIC_URL}" style="color:#87432e">${PUBLIC_URL}</a>`)}</p>`).join('')}</div></div>`};
}
function eligible(db,mail,now=Date.now()) {
  if(mail.deliveryKind !== 'membership')return true;
  const raw=db.prepare("SELECT json FROM billing_state WHERE id='reconciliation'").get();
  if(!raw)return false;
  const state=JSON.parse(raw.json);
  // Stale evidence must defer, not permanently discard, queued mail.
  if(!state.checkedAt || now-Date.parse(state.checkedAt)>2*3600000)throw Object.assign(Error('Membership verification is stale'),{code:'EMAIL_DEFERRED',retryable:true,retryAt:now+60000});
  const s=state.subscriptions.find(s=>s.id===mail.membershipSubscriptionId);
  const u=db.prepare('SELECT * FROM users WHERE id=?').get(mail.membershipUserId);
  return !!(s?.paid && !s.cancelAtPeriodEnd && u && !u.is_beta_tester && u.billing_period!=='promo' && u.tier==='starter' && u.stripe_subscription_id===s.id && norm(u.email)===norm(mail.to) && Date.parse(u.plan_expires_at)>now);
}
function createMembershipMail({db,stripe,getTransporter,getSender}) {
  db.exec(`CREATE TABLE IF NOT EXISTS membership_mail_requests(subscription_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  async function queue(state,event) {
    // No historical backfill or renewal blast; only new paid subscription events.
    if(!['checkout.session.completed','checkout.session.async_payment_succeeded','invoice.paid','invoice.payment_succeeded'].includes(event.type))return;
    let subId;
    if(event.type.startsWith('checkout.')) {
      const session=await stripe.checkout.sessions.retrieve(event.object_id);
      if(session?.livemode!==true || session.mode!=='subscription' || session.payment_status!=='paid')return;
      subId=typeof session.subscription==='string'?session.subscription:session.subscription?.id;
    } else {
      const invoice=await stripe.invoices.retrieve(event.object_id);
      if(invoice.livemode!==true || invoice.billing_reason!=='subscription_create' || invoice.status!=='paid' || invoice.amount_paid<=0)return;
      subId=typeof invoice.subscription==='string'?invoice.subscription:invoice.subscription?.id || invoice.parent?.subscription_details?.subscription;
    }
    const sub=state.subscriptions.find(s=>s.id===subId);
    if(!sub?.paid || sub.cancelAtPeriodEnd)return;
    const customer=await stripe.customers.retrieve(sub.customerId);
    if(customer.deleted || customer.livemode!==true || norm(customer.email)!==norm(sub.email))throw Error('Membership customer identity mismatch');
    const mail={...welcome(sub),deliveryKey:'membership-welcome:'+sub.id,deliveryKind:'membership',membershipSubscriptionId:sub.id,membershipUserId:sub.userId,to:sub.email,from:getSender()};
    if(!eligible(db,mail))return;
    const transporter=getTransporter();
    if(!transporter)throw Error('Membership mail waiting for SMTP configuration');
    db.prepare('INSERT OR IGNORE INTO membership_mail_requests(subscription_id,user_id) VALUES(?,?)').run(sub.id,sub.userId);
    // Synchronous durable enqueue; delivery and controlled retries belong to the shared worker.
    transporter.sendMail(mail).catch(()=>{});
  }
  return {queue};
}
module.exports={welcome,eligible,createMembershipMail};
