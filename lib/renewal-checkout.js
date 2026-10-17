'use strict';
const {randomUUID}=require('node:crypto');
const {access}=require('./account-access');
function createRenewal({db,stripe,billing,appUrl='https://thepottersmudroom.com'}) {
  const inFlight=new Map();
  const plans={starter:{amount:695,interval:'month'},'starter-yearly':{amount:6950,interval:'year'},'starter-founding':{amount:348,interval:'month'},'starter-founding-yearly':{amount:3475,interval:'year'}};
  function checkout(userId,plan) {
    if(inFlight.has(userId))return inFlight.get(userId);
    const task=start(userId,plan).finally(()=>inFlight.delete(userId));inFlight.set(userId,task);return task;
  }
  async function start(userId,plan) {
    if(!stripe)throw Error('Payments are temporarily unavailable. Your saved collection is safe.');
    const config=plans[plan];if(!config)throw Error('Invalid plan');
    // A failed read must never cause a second subscription to be created.
    const state=await billing.reconcile();
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(userId);if(!user)throw Error('Account not found');
    if(user.iap_platform && Number(user.iap_expires_at)*1000>Date.now())return {storeManaged:true,platform:user.iap_platform,error:'Manage this membership through the store where you subscribed.'};
    const linked=state.subscriptions.filter(s=>s.userId===userId);
    const live=linked.filter(s=>!['canceled','incomplete_expired'].includes(s.status));
    let customerId=user.stripe_customer_id || linked.at(-1)?.customerId;
    if(customerId){
      const customer=await stripe.customers.retrieve(customerId);
      if(customer.deleted || customer.livemode!==true || String(customer.email).toLowerCase()!==user.email.toLowerCase())throw Error('Billing identity needs review. Contact support; your account is safe.');
      const existing=await stripe.subscriptions.list({customer:customerId,status:'all',limit:100});
      if(existing.has_more)throw Error('Billing history needs review before renewal.');
      if(live.length || existing.data.some(s=>!['canceled','incomplete_expired'].includes(s.status))) {
        const portal=await stripe.billingPortal.sessions.create({customer:customerId,return_url:appUrl+'/reactivate'});
        return {url:portal.url,existingSubscription:true};
      }
    } else if(live.length)throw Error('Existing subscription requires billing review.');
    if(!customerId && access(db,userId).status==='legacy_review')throw Error('Your existing membership needs billing review before renewal. Contact support; your collection is safe.');
    // Reuse any existing live Checkout from any application entry point.
    const sessions=await stripe.checkout.sessions.list({limit:100,...(customerId?{customer:customerId}:{})});
    if(sessions.has_more && !customerId)throw Error('Billing identity needs review before checkout.');
    const open=sessions.data.find(s=>s.metadata?.userId===userId && s.mode==='subscription' && s.status==='open');
    if(open)return {url:open.url,reused:true};
    let attempt=db.prepare('SELECT * FROM renewal_checkouts WHERE user_id=?').get(userId);
    if(attempt?.session_id){
      const old=await stripe.checkout.sessions.retrieve(attempt.session_id);
      if(old.status==='open')return {url:old.url,reused:true};
      if(old.status==='complete'){const subId=typeof old.subscription==='string'?old.subscription:old.subscription?.id;const completed=linked.find(s=>s.id===subId);if(!completed || !['canceled','incomplete_expired'].includes(completed.status))throw Error('Payment is being verified. Please check membership status in a moment.');}
      attempt=null;
    }
    if(attempt && Date.now()-attempt.created_at>23*3600000)throw Error('A previous payment attempt needs review before another can be started.');
    if(!attempt){attempt={attempt_id:randomUUID(),plan,created_at:Date.now()};db.prepare('INSERT INTO renewal_checkouts(user_id,attempt_id,plan,created_at,session_id) VALUES(?,?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET attempt_id=excluded.attempt_id,plan=excluded.plan,created_at=excluded.created_at,session_id=NULL').run(userId,attempt.attempt_id,plan,attempt.created_at);}
    const chosen=plans[attempt.plan];
    const student=db.prepare('SELECT verified_until FROM student_membership_verifications WHERE user_id=?').get(userId);
    const discount=student && Date.parse(student.verified_until)>Date.now() && ['starter','starter-yearly'].includes(attempt.plan);
    const amount=discount?Math.round(chosen.amount*.75):chosen.amount;
    const session=await stripe.checkout.sessions.create({
      mode:'subscription',...(customerId?{customer:customerId}:{customer_email:user.email}),client_reference_id:userId,
      line_items:[{price_data:{currency:'usd',recurring:{interval:chosen.interval},product_data:{name:'Unlimited Plan'+(discount?' — Verified Student':'')},unit_amount:amount},quantity:1}],
      metadata:{userId,purchaseType:'subscription',tier:'starter',billing:chosen.interval==='year'?'yearly':'monthly'},
      subscription_data:{metadata:{userId}},
      success_url:appUrl+'/reactivate?payment=returned',cancel_url:appUrl+'/reactivate',
    },{idempotencyKey:'membership-checkout:'+attempt.attempt_id});
    db.prepare('UPDATE renewal_checkouts SET session_id=? WHERE user_id=? AND attempt_id=?').run(session.id,userId,attempt.attempt_id);
    return {url:session.url,studentDiscount:!!discount};
  }
  async function cancel(userId){
    await billing.reconcile();
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if(!user?.stripe_subscription_id)throw Error('No verified Stripe membership found. Store memberships must be managed in their store.');
    const sub=await stripe.subscriptions.retrieve(user.stripe_subscription_id);
    const customer=typeof sub.customer==='string'?sub.customer:sub.customer?.id;
    if(sub.livemode!==true || customer!==user.stripe_customer_id)throw Error('Membership identity needs review.');
    if(!['canceled','incomplete_expired'].includes(sub.status))await stripe.subscriptions.update(sub.id,{cancel_at_period_end:true},{idempotencyKey:'cancel-at-period-end:'+sub.id+':'+sub.current_period_end});
    await billing.reconcile();
    return {success:true,message:'Renewal canceled. Access continues through your paid period. Your collection will stay saved.',access:access(db,userId)};
  }
  return {checkout,cancel};
}
module.exports={createRenewal};
