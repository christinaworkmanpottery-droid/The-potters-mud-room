/* Admin-only data is fetched through authenticated server routes. */
async function showPaymentsRevenue(refresh = false) {
  const root = document.getElementById('adminContent');
  if (currentUser?.isAdmin !== true) return;
  root.innerHTML = '<div class="card" role="status">Loading payments…</div>';
  try {
    const data = await api('/api/admin/payments' + (refresh ? '/reconcile' : ''), { method: refresh ? 'POST' : 'GET' });
    window._billingAdminData = data;
    root.innerHTML = '<div class="card"><button class="btn btn-secondary" onclick="loadAdmin()">Back to members</button><h2 style="margin-top:16px">Payments &amp; Revenue</h2><p>Verified Stripe payments, membership access and deposit history.</p>' +
      '<button class="btn btn-primary" onclick="showPaymentsRevenue(true)">Refresh from Stripe</button>' +
      '<p class="text-sm">Last successful check: ' + esc(data.checkedAt ? new Date(data.checkedAt).toLocaleString() : 'Not yet verified') + '</p>' +
      (data.error || !data.stats.paidCountVerifiedByStripe ? '<p role="alert">Verification is pending or stale. Existing member access is preserved.</p>' : '') +
      '<div style="display:flex;gap:16px;flex-wrap:wrap"><strong>Paid: ' + data.stats.byTier.paid + '</strong><span>Gifted: ' + data.stats.byTier.gifted + '</span><span>Free: ' + data.stats.byTier.free + '</span><span>Needs review: ' + data.stats.byTier.review + '</span></div>' +
      '<label for="billingSearch" style="display:block;margin-top:20px">Find a customer, product or transaction</label><input id="billingSearch" class="form-input" type="search" oninput="renderBillingHistory()" placeholder="Name, email or reference">' +
      '<label for="billingStatus" style="display:block;margin-top:12px">Payment status</label><select id="billingStatus" class="form-select" onchange="renderBillingHistory()"><option value="">All payments</option value="succeeded">Successful</option><option value="failed">Failed</option><option value="refunded">Refunded</option><option value="partially_refunded">Partially refunded</option></select></div><div id="billingHistory"></div>';
    renderBillingHistory();
  } catch (error) {
    root.innerHTML = '<div class="card"><h3>Payments could not load</h3><p>' + esc(error.message) + '</p><button class="btn btn-primary" onclick="showPaymentsRevenue()">Try again</button></div>';
  }
}
function renderBillingHistory() {
  const data=window._billingAdminData, root=document.getElementById('billingHistory');
  if(!data || !root)return;
  const query=document.getElementById('billingSearch').value.toLowerCase().trim();
  const status=document.getElementById('billingStatus').value;
  const money=(c,currency='usd')=>c==null?'Not available':new Intl.NumberFormat(undefined,{style:'currency',currency:currency.toUpperCase()}).format(c/100);
  const date=value=>value?new Date(value).toLocaleString():'—';
  const matches=row=>!query || [row.name,row.email,row.product,row.id].join(' ').toLowerCase().includes(query);
  const field=(label,value)=>'<div style="min-width:0"><dt style="color:var(--text-light);font-size:.8rem">'+esc(label)+'</dt><dd style="margin:2px 0 12px;overflow-wrap:anywhere">'+esc(value ?? '—')+'</dd></div>';
  const review=data.discrepancies.concat((data.pendingEvents||[]).map(e=>({reason:'Webhook '+e.id+': '+e.status+' ('+e.attempts+' attempts)'})));
  let html=review.length?'<div class="card" role="status"><h3>Needs attention ('+review.length+')</h3>'+review.map(r=>{
    const m=data.members.find(m=>m.id===r.userId);
    return '<p>'+esc(m ? (m.display_name||m.email)+': ' : '')+esc(r.reason)+'</p>';
  }).join('')+'</div>':'';
  const rows=data.payments.filter(p=>matches(p)&&(!status||p.status===status));
  html+='<h3 style="margin:20px 0">Payment history ('+rows.length+')</h3>';
  if(!rows.length)html+='<div class="card">No matching payments in the verified history.</div>';
  for(const p of rows) {
    html+='<article class="card" style="margin-bottom:16px;overflow-wrap:anywhere"><h3>'+esc(p.name||p.email||'Customer')+'</h3><p>'+esc(p.email)+'</p><p><strong>'+esc(p.product)+'</strong></p><p>'+esc(p.status.replaceAll('_',' '))+' · '+esc(date(p.createdAt))+'</p>'+
      '<dl style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 16px">'+field('Gross payment',money(p.gross,p.currency))+field('Processing fees',money(p.fee,p.currency))+field('Net after processing',money(p.net,p.currency))+field('Refunded',money(p.refunded,p.currency))+'</dl>'+
      '<details><summary style="cursor:pointer;min-height:44px">Subscription, payout &amp; references</summary><dl>'+field('Subscription status',p.subscriptionStatus)+field('Next renewal',date(p.renewalDate))+field('Current period ends',date(p.expirationDate))+field('Payout status',p.payoutStatus)+field('Stripe arrival date',p.depositDate)+field('Payment reference',p.id)+field('Subscription reference',p.subscriptionId)+field('Payout reference',p.payoutId)+(p.failure?field('Failure reason',p.failure):'')+'</dl><a target="_blank" rel="noopener noreferrer" href="https://dashboard.stripe.com/payments/'+encodeURIComponent(p.id)+'">Open payment in Stripe</a></details></article>';
  }
  const invoices=data.invoices.filter(i=>i.status!=='paid'&&matches(i));
  html+='<details class="card"><summary style="min-height:44px;cursor:pointer">Unpaid, failed and void invoices ('+invoices.length+')</summary>'+invoices.map(i=>'<p><strong>'+esc(i.name||i.email||i.id)+'</strong><br>'+esc(i.product)+'<br>'+esc(i.status)+' · '+esc(money(i.amountDue,i.currency))+' · '+esc(i.attempts)+' payment attempts<br>'+esc(i.id)+'</p>').join('')+'</details>';
  const canceled=data.subscriptions.filter(s=>(s.status==='canceled'||s.cancelAtPeriodEnd)&&matches(s));
  html+='<details class="card"><summary style="min-height:44px;cursor:pointer">Cancellations ('+canceled.length+')</summary>'+canceled.map(s=>'<p>'+esc(s.name||s.email)+' — '+esc(s.product)+'<br>'+esc(s.status==='canceled'?'Canceled '+date(s.canceledAt):'Cancels at period end '+date(s.periodEnd))+'</p>').join('')+'</details>';
  html+='<details class="card"><summary style="min-height:44px;cursor:pointer">Bank payouts &amp; account fees</summary><p>Payouts cover the entire Stripe account. Billing fees and other adjustments are separate from card-processing fees. Stripe’s arrival date is not bank confirmation.</p>'+data.payouts.map(p=>'<section style="border-top:1px solid var(--border);padding:12px 0"><strong>'+esc(money(p.amount,p.currency))+'</strong> · '+esc(p.status)+' · '+esc(p.arrivalDate)+'<p style="overflow-wrap:anywhere">'+esc(p.id)+'</p>'+p.adjustments.map(a=>'<p>'+esc(a.description||'Account adjustment')+': '+esc(money(a.net,a.currency))+'</p>').join('')+'</section>').join('')+'</details>';
  root.innerHTML=html;
}

async function showAccountProtection(){
  if(currentUser?.isAdmin!==true)return;
  const root=document.getElementById('adminContent');root.innerHTML='<p role="status">Auditing account protection…</p>';
  try{
    const data=await api('/api/admin/account-protection');
    root.innerHTML='<div class="card"><button class="btn btn-secondary" onclick="loadAdmin()">Back to members</button><h2>Account Protection</h2><p>All '+data.total+' accounts audited. Nonpayment never deletes studio records or photos.</p><p>Last audit: '+esc(data.auditedAt)+'</p>'+Object.entries(data.counts).map(([status,count])=>'<p>'+esc(status)+': <strong>'+count+'</strong></p>').join('')+'<h3>Preserved studio records</h3>'+Object.entries(data.studioRecords||{}).map(([table,count])=>'<p>'+esc(table)+': '+count+'</p>').join('')+'<p>Unverified legacy memberships remain accessible for review. Native apps need an update to show the reactivation screen and restrict previously downloaded offline data.</p><details><summary>Account-by-account results</summary>'+data.members.map(m=>'<p style="overflow-wrap:anywhere">'+esc(m.userId)+' — '+esc(m.status)+' — '+(m.blocked?'Renewal only':'Access retained')+'</p>').join('')+'</details></div>';
  }catch(e){root.textContent=e.message;}
}
