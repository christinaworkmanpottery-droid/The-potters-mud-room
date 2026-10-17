'use strict';
const { snapshot, initBillingTables } = require('./billing-schema');
const { randomUUID } = require('node:crypto');
const id = value => typeof value === 'string' ? value : value?.id;
const iso = seconds => seconds ? new Date(seconds * 1000).toISOString() : null;
const unlimited = tier => ['starter','basic','mid','top'].includes(tier);
const testEmail = email => /\+test@|@example\.(invalid|com|org|net)$/i.test(email || '');
async function all(list, params = {}) {
  const rows = []; let starting_after;
  for (let page = 0; page < 100; page++) {
    const result = await list({ ...params, limit: 100, ...(starting_after ? { starting_after } : {}) });
    rows.push(...result.data);
    if (!result.has_more) return rows;
    if (!result.data.length) throw new Error('Invalid Stripe pagination');
    starting_after = result.data.at(-1).id;
  }
  throw new Error('Stripe history exceeds reconciliation page limit; no partial reconciliation applied');
}
function createBilling({ db, stripe, appUrl, adminEmail, onPaymentVerified }) {
  initBillingTables(db);
  const protection = require('./account-access'); protection.init(db);
  const hosts = new Set(['thepottersmudroom.com','www.thepottersmudroom.com','the-potters-mud-room.onrender.com']);
  try { hosts.add(new URL(appUrl).host); } catch (_) {}
  const owned = s => {
    try { return s.livemode === true && hosts.has(new URL(s.success_url).host) && !!s.metadata?.userId; }
    catch (_) { return false; }
  };
  function readState() {
    const row = db.prepare("SELECT json FROM billing_state WHERE id='reconciliation'").get();
    return row ? JSON.parse(row.json) : { checkedAt: null, subscriptions: [], payments: [], invoices: [], payouts: [], discrepancies: [] };
  }
  let running;
  let lastError = null;
  async function reconcile() {
    if (!stripe) throw new Error('Stripe is not configured');
    if (running) return running;
    running = build().catch(error => { lastError = 'Stripe reconciliation failed; retained last verified snapshot.'; throw error; }).finally(() => { running = null; });
    return running;
  }
  async function build() {
    // Read-only Stripe calls. Never create, cancel, refund, charge or send mail.
    const [sessions, subs, charges, invoices, payouts] = await Promise.all([
      all(p => stripe.checkout.sessions.list(p)), all(p => stripe.subscriptions.list(p), { status: 'all' }),
      all(p => stripe.charges.list(p)), all(p => stripe.invoices.list(p)), all(p => stripe.payouts.list(p))
    ]);
    const users = db.prepare('SELECT id,email,display_name,tier,billing_period,plan_expires_at,stripe_customer_id,stripe_subscription_id,is_beta_tester FROM users').all();
    const byUser = new Map(users.map(u => [u.id,u]));
    const appSessions = sessions.filter(owned);
    const bySubSession = new Map(appSessions.filter(s => s.mode === 'subscription' && id(s.subscription)).map(s => [id(s.subscription),s]));
    const byPI = new Map(appSessions.filter(s => id(s.payment_intent)).map(s => [id(s.payment_intent),s]));
    const invoiceById = new Map(invoices.map(i => [i.id,i]));
    const invoiceSub = i => id(i?.subscription) || id(i?.parent?.subscription_details?.subscription);
    const invoicePI = i => id(i?.payment_intent) || id(i?.payments?.data?.find(p => p.payment?.type === 'payment_intent')?.payment?.payment_intent);
    // The configured SDK uses the pinned existing API version, where charge.invoice
    // and invoice.payment_intent are present. Also support newer invoice shapes.
    const invoiceForCharge = c => invoiceById.get(id(c.invoice)) || invoices.find(i => invoicePI(i) && invoicePI(i) === id(c.payment_intent));
    const discrepancies = [];
    const subscriptionRows = [];
    const patches = [];
    const entitlementRows = [];
    for (const sub of subs.filter(s => s.livemode === true)) {
      const session = bySubSession.get(sub.id);
      const linked = users.find(u => u.stripe_subscription_id === sub.id);
      if (!session && !linked) continue;
      const userId = session?.metadata?.userId || linked.id;
      const user = byUser.get(userId);
      const item = sub.items?.data?.[0];
      const price = item?.price || item?.plan;
      const interval = price?.recurring?.interval || price?.interval;
      const product = price && await stripe.products.retrieve(id(price.product));
      const productName = product?.name || 'Unverified membership product';
      const end = sub.current_period_end || item?.current_period_end;
      const invoice = invoiceById.get(id(sub.latest_invoice));
      const invoiceCharges = charges.filter(c => invoiceForCharge(c)?.id === invoice?.id);
      const paymentConfirmed = !!invoice && invoice.status === 'paid' && invoice.amount_paid > 0 && invoiceCharges.some(c => c.paid && c.status === 'succeeded' && c.amount > c.amount_refunded && !c.disputed);
      const recognizedProduct = /^Unlimited Plan\b/.test(productName) && price?.currency === 'usd' && ['month','year'].includes(interval) && sub.items.data.length === 1 && item.quantity === 1;
      const payerEmail = session?.customer_details?.email?.trim().toLowerCase();
      const matchingUser = !!user && (!payerEmail || payerEmail === user.email.trim().toLowerCase()) && (!linked || linked.id === userId);
      const historicalInvoices = invoices.filter(i => invoiceSub(i) === sub.id && i.status === 'paid' && i.amount_paid > 0 && charges.some(c => invoiceForCharge(c)?.id === i.id && c.paid && c.status === 'succeeded' && c.amount > c.amount_refunded && !c.disputed));
      const paid = recognizedProduct && matchingUser && paymentConfirmed && sub.status === 'active' && !sub.test_clock && end * 1000 > Date.now() && !testEmail(user?.email) && user?.email?.toLowerCase() !== adminEmail.toLowerCase();
      const row = { id: sub.id, userId, customerId: id(sub.customer), name: user?.display_name || session?.customer_details?.name || '', email: user?.email || payerEmail || '', product: productName, status: sub.status, paid, paymentConfirmed, billingPeriod: interval === 'year' ? 'yearly' : 'monthly', periodEnd: iso(end), cancelAtPeriodEnd: !!sub.cancel_at_period_end, canceledAt: iso(sub.canceled_at), latestInvoice: id(sub.latest_invoice) };
      subscriptionRows.push(row);
      if (!matchingUser || !recognizedProduct) {
        discrepancies.push({ userId, subscriptionId: sub.id, reason: !matchingUser ? 'Checkout identity does not match exactly one application member' : 'Unrecognized membership product; access unchanged' });
        continue;
      }
      const oldLinked = subs.find(s => s.id === user.stripe_subscription_id);
      const replaceExpiredLink = paid && oldLinked && ['canceled','incomplete_expired'].includes(oldLinked.status);
      // Only real, identity-matched payment history can establish a lapsed paid account.
      // Unknown/test/legacy memberships remain unlocked and flagged for review.
      const prior = db.prepare('SELECT * FROM account_entitlements WHERE user_id=? AND source_id=?').get(userId,sub.id);
      const realPaidHistory = historicalInvoices.length > 0 && !sub.test_clock && !testEmail(user.email) && user.email.toLowerCase() !== adminEmail.toLowerCase();
      if (realPaidHistory) {
        const paidEnds = historicalInvoices.flatMap(i => (i.lines?.data || []).map(l => l.period?.end || 0));
        let paidThrough = iso(Math.max(0,...paidEnds)) || prior?.paid_through || (paymentConfirmed ? iso(end) : null);
        let graceUntil = null;
        let status = sub.cancel_at_period_end ? 'canceled' : sub.status;
        if (['past_due','unpaid'].includes(sub.status) || sub.status === 'canceled' && invoice?.status === 'open' && invoice?.billing_reason === 'subscription_cycle') {
          const failure = invoice && db.prepare('SELECT failed_at FROM renewal_failures WHERE invoice_id=?').get(invoice.id);
          // Historical failures with no signed first-failure event start conservatively at first observation.
          graceUntil = prior?.grace_until || new Date((failure?.failed_at || Date.now()) + 14*protection.DAY).toISOString();
        }
        if (['active','past_due','unpaid','canceled'].includes(status)) entitlementRows.push({userId,sourceId:sub.id,provider:'stripe',status,paidThrough,graceUntil,verifiedAt:new Date().toISOString()});
      }
      if (user.stripe_subscription_id && user.stripe_subscription_id !== sub.id && !replaceExpiredLink) {
        discrepancies.push({ userId, subscriptionId: sub.id, reason: 'Member has a different linked subscription; access unchanged' });
        continue;
      }
      // Restore only proven paid access. Never remove gifted, beta, IAP or other
      // existing access during this repair. Non-paying access is flagged for review.
      const continued=entitlementRows.find(r=>r.sourceId===sub.id && (Date.parse(r.paidThrough)>Date.now() || Date.parse(r.graceUntil)>Date.now()));
      if (paid || continued) {
        const after = { tier: 'starter', billing_period: row.billingPeriod, plan_expires_at: paid ? row.periodEnd : (continued.graceUntil || continued.paidThrough), stripe_customer_id: row.customerId, stripe_subscription_id: row.id };
        if (Object.entries(after).some(([key,value]) => user[key] !== value)) patches.push({ user, after });
      } else if (unlimited(user.tier) && user.stripe_subscription_id === sub.id && !user.is_beta_tester && user.billing_period !== 'promo') {
        discrepancies.push({ userId, subscriptionId: sub.id, reason: `Stripe ${sub.status}; paid evidence ${paymentConfirmed ? 'present' : 'absent'}. Existing access preserved for review.` });
      }
    }
    // Multiple active subscriptions must never silently overwrite a member link.
    const safePatches = patches.filter(p => {
      if (subscriptionRows.filter(s => s.userId === p.user.id && s.paid).length <= 1) return true;
      discrepancies.push({ userId: p.user.id, reason: 'Multiple paid subscriptions; manual review required, no Stripe changes made' }); return false;
    });
    const subMap = new Map(subscriptionRows.map(s => [s.id,s]));
    const payoutByTransaction = new Map();
    const payoutRows = [];
    for (const p of payouts.filter(p => p.livemode && p.automatic)) {
      const transactions = await all(q => stripe.balanceTransactions.list(q), { payout: p.id });
      for (const t of transactions) payoutByTransaction.set(t.id, p);
      // Payouts are account-wide; label separately, never invent per-charge fees.
      payoutRows.push({ id: p.id, amount: p.amount, currency: p.currency, status: p.status, arrivalDate: iso(p.arrival_date)?.slice(0,10), adjustments: transactions.filter(t => !['charge','payment','payout'].includes(t.type)).map(t => ({ description: t.description, amount: t.amount, fee: t.fee, net: t.net, currency: t.currency })) });
    }
    const paymentRows = [];
    for (const charge of charges.filter(c => c.livemode)) {
      const invoice = invoiceForCharge(charge);
      const sub = subMap.get(invoiceSub(invoice));
      const session = byPI.get(id(charge.payment_intent));
      if (!sub && !session) continue;
      const balance = charge.balance_transaction ? await stripe.balanceTransactions.retrieve(id(charge.balance_transaction)) : null;
      const payout = balance && payoutByTransaction.get(balance.id);
      let product = sub?.product;
      if (!product && session) {
        const items = await all(p => stripe.checkout.sessions.listLineItems(session.id,p));
        product = items.map(i => i.description).join(', ');
      }
      paymentRows.push({ id: charge.id, userId: sub?.userId || session?.metadata?.userId, name: charge.billing_details?.name || sub?.name || '', email: charge.billing_details?.email || sub?.email || '', product: product || 'Purchase', createdAt: iso(charge.created), gross: charge.amount, fee: balance?.fee ?? null, net: balance?.net ?? null, currency: charge.currency, refunded: charge.amount_refunded, disputed: charge.disputed, status: charge.refunded ? 'refunded' : charge.amount_refunded ? 'partially_refunded' : charge.status, failure: charge.failure_message, subscriptionId: sub?.id || null, subscriptionStatus: sub?.status || null, renewalDate: sub?.status === 'active' && !sub.cancelAtPeriodEnd ? sub.periodEnd : null, expirationDate: sub?.periodEnd || null, payoutId: payout?.id || null, payoutStatus: payout?.status || 'not_matched', depositDate: iso(payout?.arrival_date)?.slice(0,10) || null });
    }
    const invoiceRows = invoices.filter(i => subMap.has(invoiceSub(i))).map(i => ({ id:i.id, userId:subMap.get(invoiceSub(i)).userId, email:i.customer_email, name:i.customer_name, product:subMap.get(invoiceSub(i)).product, status:i.status, amountDue:i.amount_due, amountPaid:i.amount_paid, currency:i.currency, createdAt:iso(i.created), attempts:i.attempt_count, nextAttempt:iso(i.next_payment_attempt) }));
    for (const user of users.filter(u => u.stripe_subscription_id && !subMap.has(u.stripe_subscription_id))) discrepancies.push({ userId:user.id, reason:'Linked Stripe subscription could not be verified; access unchanged' });
    for (const user of users.filter(u => !u.stripe_subscription_id && /^stripe-/.test(u.billing_period || ''))) discrepancies.push({ userId:user.id, reason:'Legacy billing label without a verified subscription link. Existing access preserved; not counted as paying.' });
    const state = { checkedAt:new Date().toISOString(), subscriptions:subscriptionRows, payments:paymentRows, invoices:invoiceRows, payouts:payoutRows, discrepancies, repaired:safePatches.length };
    if (safePatches.length) snapshot(db, 'before-membership-reconciliation');
    db.transaction(() => {
      for (const row of entitlementRows) protection.record(db,row);
      for (const {user,after} of safePatches) {
        // Re-read after network I/O to avoid overriding concurrent manual changes.
        const current = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        if (!current || Object.keys(after).some(k => current[k] !== user[k])) {
          state.discrepancies.push({userId:user.id,reason:'Member changed during reconciliation; deferred to next check'}); continue;
        }
        db.prepare('INSERT INTO billing_audit(user_id,reason,before_json,after_json) VALUES(?,?,?,?)').run(user.id,'Verified live paid Stripe subscription',JSON.stringify(user),JSON.stringify(after));
        db.prepare('UPDATE users SET tier=?,billing_period=?,plan_expires_at=?,stripe_customer_id=?,stripe_subscription_id=? WHERE id=?').run(after.tier,after.billing_period,after.plan_expires_at,after.stripe_customer_id,after.stripe_subscription_id,user.id);
      }
      db.prepare("INSERT INTO billing_state(id,json) VALUES('reconciliation',?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(JSON.stringify(state));
    })();
    lastError = null;
    console.log('[billing] Reconciled',JSON.stringify({ paidSubscriptions:subscriptionRows.filter(s=>s.paid).length, repaired:safePatches.length, discrepancies:state.discrepancies.length, counts:membershipReport().stats.byTier }));
    return state;
  }
  function membershipReport() {
    const state = readState();
    const fresh = !!state.checkedAt && Date.now() - Date.parse(state.checkedAt) < 2*60*60*1000 && !lastError;
    const members = db.prepare('SELECT id,email,display_name,tier,billing_period,plan_expires_at,avatar_filename,created_at,updated_at,stripe_customer_id,stripe_subscription_id,is_beta_tester FROM users ORDER BY created_at DESC').all();
    const iapUsers = new Set(db.prepare("SELECT DISTINCT user_id FROM iap_purchases WHERE environment='production' AND expires_at > CAST(strftime('%s','now') AS INTEGER)").all().map(r=>r.user_id));
    const stats = { activeNativeReceiptsAwaitingPaymentVerification:iapUsers.size, total:members.length, byTier:{free:0,paid:0,gifted:0,review:0}, recent7d:0, recent30d:0, paidCountVerifiedByStripe:fresh, verifiedAt:state.checkedAt };
    for (const m of members) {
      const sub = state.subscriptions.find(s=>s.userId===m.id && s.id===m.stripe_subscription_id);
      const excluded = testEmail(m.email) || m.email.toLowerCase()===adminEmail.toLowerCase();
      m.accountAccess = protection.access(db,m.id);
      m.billingClassification = !excluded && unlimited(m.tier) && (fresh && sub?.paid) ? 'paid'
        : !unlimited(m.tier) ? 'free'
        : m.is_beta_tester || m.billing_period==='promo' && (!m.plan_expires_at || Date.parse(m.plan_expires_at)>Date.now()) ? 'gifted'
        : m.plan_expires_at && Date.parse(m.plan_expires_at)<=Date.now() ? 'review'
        : iapUsers.has(m.id) || m.stripe_subscription_id || /^stripe-/.test(m.billing_period || '') ? 'review' : 'gifted';
      if (m.billingClassification === 'review') m.reviewReasons = [...new Set((state.discrepancies || []).filter(d=>d.userId===m.id).map(d=>d.reason))];
      stats.byTier[m.billingClassification]++;
      const age=Date.now()-Date.parse(m.created_at); if(age>=0 && age<7*86400000)stats.recent7d++;if(age>=0 && age<30*86400000)stats.recent30d++;
    }
    return {members,stats};
  }
  async function fulfill(sessionId) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!owned(session) || session.payment_status !== 'paid') return;
    if (session.metadata.purchaseType === 'subscription') return;
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(session.metadata.userId);
    if (!user) throw new Error('Checkout member missing');
    db.transaction(() => {
      if (db.prepare('SELECT 1 FROM billing_fulfillments WHERE session_id=?').get(session.id)) return;
      if (session.metadata.purchaseType === 'merchant') {
        if (!db.prepare('SELECT 1 FROM merchant_orders WHERE stripe_session_id=?').get(session.id)) db.prepare('INSERT INTO merchant_orders(id,user_id,product_id,price_paid,status,stripe_session_id) VALUES(?,?,?,?,?,?)').run(randomUUID(),user.id,session.metadata.productId,session.amount_total/100,'completed',session.id);
      } else if (session.metadata.purchaseType === 'ai_tokens') {
        const quantity=Number(session.metadata.questions);
        if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Invalid token purchase quantity');
        db.prepare('UPDATE users SET ai_tokens=COALESCE(ai_tokens,0)+? WHERE id=?').run(quantity,user.id);
      } else return;
      db.prepare('INSERT INTO billing_fulfillments(session_id) VALUES(?)').run(session.id);
    })();
  }
  let draining = false;
  async function drain() {
    if (draining || !stripe) return;
    draining=true;
    try {
      const events=db.prepare("SELECT * FROM billing_events WHERE status!='done' AND next_attempt<=? ORDER BY created_at LIMIT 20").all(Date.now());
      for(const event of events) {
        try {
          if (event.type.startsWith('checkout.session.')) await fulfill(event.object_id);
          const state = await reconcile();
          if (onPaymentVerified) await onPaymentVerified(state,event);
          db.prepare("UPDATE billing_events SET status='done',processed_at=datetime('now'),last_error=NULL WHERE id=?").run(event.id);
        } catch(error) {
          db.prepare("UPDATE billing_events SET status='retry',attempts=attempts+1,next_attempt=?,last_error=? WHERE id=?").run(Date.now()+Math.min(3600000,30000*2**Math.min(event.attempts,7)),'Processing failed; retry scheduled',event.id);
          console.error('[billing] Event processing failed; retry scheduled:',error.type || error.code || error.name);
        }
      }
    } finally {draining=false;}
  }
  function acceptEvent(event) {
    if (event.livemode !== true) return false;
    const object=event.data.object;
    if(event.type==='invoice.payment_failed' && object.billing_reason==='subscription_cycle') {
      const subId=id(object.subscription)||id(object.parent?.subscription_details?.subscription);
      if(subId) db.prepare('INSERT OR IGNORE INTO renewal_failures(invoice_id,subscription_id,failed_at) VALUES(?,?,?)').run(object.id,subId,Number(event.created)*1000 || Date.now());
    }
    db.prepare('INSERT OR IGNORE INTO billing_events(id,type,object_id) VALUES(?,?,?)').run(event.id,event.type,event.data.object.id);
    setImmediate(()=>drain().catch(()=>{}));return true;
  }
  function dashboard() {
    const state=readState();
    return {...state,accountProtection:protection.audit(db),error:lastError,nativeReceiptNote:'Native store receipts require separate payment verification; active receipts alone are not counted as paying customers.',pendingEvents:db.prepare("SELECT id,type,status,attempts,last_error,created_at FROM billing_events WHERE status!='done'").all(),...membershipReport()};
  }
  function start() {
    if(!stripe)return;
    const run=()=>reconcile().catch(e=>console.error('[billing] Reconciliation failed; existing access preserved:',e.type || e.code || e.name));
    setImmediate(run);
    const timer=setInterval(run,60*60*1000);timer.unref();
    const retries=setInterval(()=>drain().catch(()=>{}),30000);retries.unref();
  }
  return {reconcile,membershipReport,dashboard,acceptEvent,drain,start,readState};
}
module.exports={createBilling,all};
