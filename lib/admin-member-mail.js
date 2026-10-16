'use strict';
const {PUBLIC_URL}=require('./public-links');
const {createMembershipMail,eligible}=require('./membership-mail');
const norm=s=>String(s||'').trim().toLowerCase();
const id=s=>typeof s==='string'?s:s?.id;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function personal(name) {
  const first=String(name||'').trim().split(/\s+/)[0];
  if(!first)throw Error('Member name is required');
  const text=`Hi ${first},

I wanted to personally thank you for becoming an Annual Unlimited member of The Potter’s Mud Room!

As the creator of The Potter’s Mud Room, it means so much to me that you’ve chosen to support something I’ve worked so hard to build for our pottery community.

I also wanted to check in and make sure everything is working properly for you. Are you able to access your Unlimited membership and use the features without any issues?

If you’ve run into any problems, have questions, or have suggestions for improvements, I’d genuinely love to hear from you. Your feedback helps me make The Potter’s Mud Room better for everyone.

You can access your membership anytime at:

Visit The Potter’s Mud Room

Thank you again for being part of this journey. I truly appreciate your support!

Warmly,
Christina
Founder, The Potter’s Mud Room`;
  const html='<div style="background:#f5f1eb;padding:28px 16px;font-family:Arial,sans-serif;color:#302c29"><div style="max-width:560px;margin:auto;background:#fffdf9;padding:28px;border-radius:12px">'+text.split('\n\n').map(p=>p==='Visit The Potter’s Mud Room'?`<p style="margin:24px 0"><a href="${PUBLIC_URL}" style="display:inline-block;background:#794330;color:#ffffff;padding:14px 20px;border-radius:6px;text-decoration:none;font-weight:bold">${p}</a></p>`:`<p style="font-size:17px;line-height:1.65;margin:0 0 18px">${esc(p).replace(/\n/g,'<br>')}</p>`).join('')+'</div></div>';
  return {subject:'A Personal Thank You from The Potter’s Mud Room',html,text:text.replace('Visit The Potter’s Mud Room','Visit The Potter’s Mud Room\n'+PUBLIC_URL)};
}
function register({app,auth,isAdmin,db,stripe,billing,getTransporter,getSender,adminEmail,verifyAccess}) {
  const guard=(req,res,next)=>isAdmin(req)?next():res.status(403).json({error:'Admin only'});
  const log=key=>db.prepare('SELECT id,recipient,status,attempts,created_at,updated_at,message_id,smtp_response,accepted_recipients,error_message,retry_at FROM smtp_delivery_log WHERE id=?').get(key)||null;
  async function verify(email) {
    const users=db.prepare('SELECT * FROM users WHERE LOWER(TRIM(email))=?').all(norm(email));
    if(users.length!==1)throw Error('Exactly one authenticated account must match the recipient');
    const u=users[0],s=billing.readState().subscriptions.find(s=>s.userId===u.id&&s.id===u.stripe_subscription_id);
    if(!s?.paid||s.billingPeriod!=='yearly'||u.tier!=='starter'||u.is_beta_tester||u.billing_period!=='yearly'||Date.parse(u.plan_expires_at)<=Date.now())throw Error('Verified Annual Unlimited entitlement required');
    const [customer,sub]=await Promise.all([stripe.customers.retrieve(u.stripe_customer_id),stripe.subscriptions.retrieve(u.stripe_subscription_id)]);
    if(customer.deleted||customer.livemode!==true||norm(customer.email)!==norm(u.email)||norm(s.email)!==norm(u.email)||id(sub.customer)!==customer.id||sub.livemode!==true||sub.status!=='active'||sub.cancel_at_period_end)throw Error('Live Stripe identity or subscription does not match the account');
    const invoice=await stripe.invoices.retrieve(id(sub.latest_invoice));
    if(invoice.livemode!==true||invoice.status!=='paid'||invoice.amount_paid<=0||id(invoice.customer)!==customer.id||!sub.items?.data.some(i=>i.price?.recurring?.interval==='year'))throw Error('Successful annual payment could not be verified');
    const checks=await verifyAccess(u);
    if(checks.some(c=>c.status!==200||c.active===false))throw Error('Authenticated Unlimited access check failed: '+JSON.stringify(checks));
    const deliveryKey='personal-annual-thanks:'+s.id;
    const history=db.prepare('SELECT id,status,created_at,updated_at,message_id FROM smtp_delivery_log WHERE LOWER(recipient)=? ORDER BY created_at').all(norm(u.email));
    return {recipient:u.email,name:u.display_name,userId:u.id,subscriptionId:s.id,expiresAt:u.plan_expires_at,paymentAmount:invoice.amount_paid/100,currency:invoice.currency,verifiedAt:new Date().toISOString(),accessMethod:'Server-internal short-lived authenticated session; read-only protected endpoints. Not a test of the member’s own device or password.',checks,deliveryKey,delivery:log(deliveryKey),history,preview:personal(u.display_name)};
  }
  app.post('/api/admin/member-mail/verify',auth,guard,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{res.json(await verify(req.body.email));}catch(e){res.status(409).json({error:e.message});}
  });
  app.post('/api/admin/member-mail/send',auth,guard,async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const v=await verify(req.body.email);
      if(v.delivery)return res.json({verification:v,delivery:v.delivery,message:'Existing request retained; no new send attempted.'});
      // Earlier unkeyed targeted messages lose their body after acceptance: never guess.
      if(v.history.some(r=>!r.id.startsWith('membership-welcome:')&&!r.id.startsWith('campaign:')))throw Error('Existing recipient delivery requires manual duplicate review; no send attempted');
      const mailer=getTransporter();if(!mailer)throw Error('Mail delivery is not configured');
      try{await mailer.sendMail({...v.preview,to:v.recipient,from:getSender(),deliveryKey:v.deliveryKey});}catch(e){return res.json({verification:v,delivery:log(v.deliveryKey),error:e.message});}
      res.json({verification:{recipient:v.recipient,verifiedAt:v.verifiedAt,checks:v.checks,accessMethod:v.accessMethod},delivery:log(v.deliveryKey)});
    }catch(e){res.status(409).json({error:e.message});}
  });
  app.post('/api/admin/member-mail/welcome-test',auth,guard,async(req,res)=>{
    res.set('Cache-Control','no-store');
    const key='annual-welcome-live-verification:v1';
    const prior=log(key);if(prior)return res.json({delivery:prior,message:'Existing test retained; no resend attempted.'});
    let fixture;
    try{
      const mailer=getTransporter();if(!mailer)throw Error('Mail delivery is not configured');
      // Isolated fixture exercises the existing payment/activation gates, with real SMTP
      // delivery restricted to the configured owner. No real Stripe write or webhook.
      fixture=new (require('better-sqlite3'))(':memory:');
      fixture.exec('CREATE TABLE users(id TEXT,email TEXT,tier TEXT,billing_period TEXT,stripe_subscription_id TEXT,is_beta_tester INTEGER,plan_expires_at TEXT); CREATE TABLE billing_state(id TEXT PRIMARY KEY,json TEXT)');
      const end=new Date(Date.now()+86400000).toISOString();
      fixture.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').run('diagnostic',adminEmail,'starter','yearly','diagnostic-sub',0,end);
      const sub={id:'diagnostic-sub',userId:'diagnostic',customerId:'diagnostic-customer',email:adminEmail,name:'Christina',paid:true,billingPeriod:'yearly',periodEnd:end};
      const state={checkedAt:new Date().toISOString(),subscriptions:[sub]};
      fixture.prepare("INSERT INTO billing_state VALUES('reconciliation',?)").run(JSON.stringify(state));
      const simulatedStripe={customers:{retrieve:async()=>({livemode:true,email:adminEmail})},invoices:{retrieve:async()=>({livemode:true,billing_reason:'subscription_create',status:'paid',amount_paid:6950,subscription:sub.id})}};
      const pending=[];
      const adapter={sendMail:mail=>{
        if(!eligible(fixture,mail))throw Error('Activation gate failed');
        const p=mailer.sendMail({from:getSender(),to:adminEmail,subject:'[Delivery verification] '+mail.subject,html:mail.html,text:mail.text,deliveryKey:key});pending.push(p);return p;
      }};
      const flow=createMembershipMail({db:fixture,stripe:simulatedStripe,getTransporter:()=>adapter,getSender});
      const event={type:'invoice.paid',object_id:'diagnostic-invoice'};
      await flow.queue(state,event);await Promise.all(pending);
      await flow.queue(state,event);await Promise.all(pending);
      const delivery=log(key);
      res.json({mode:'Isolated successful-payment and activation fixtures; real production SMTP; Admin recipient only',delivery,duplicateWebhookSuppressed:delivery?.status==='accepted'&&delivery.attempts===1,officialLink:PUBLIC_URL,customerPaymentsChanged:false,customerSubscriptionsChanged:false});
    }catch(e){res.json({delivery:log(key),error:e.message});}finally{fixture?.close();}
  });
}
module.exports={register,personal};
