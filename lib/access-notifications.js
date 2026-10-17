'use strict';
const {access}=require('./account-access');
function eligible(db,mail){
  if(mail.deliveryKind!=='account-access')return true;
  return access(db,mail.accessUserId).status===mail.accessStatus;
}
async function queue({db,transporter,from}){
  if(!transporter)return;
  const users=db.prepare('SELECT DISTINCT user_id FROM account_entitlements').all();
  for(const {user_id} of users){
    const state=access(db,user_id);if(!['grace','suspended'].includes(state.status))continue;
    const u=db.prepare('SELECT email FROM users WHERE id=?').get(user_id);if(!u)continue;
    const row=db.prepare('SELECT source_id,grace_until,paid_through FROM account_entitlements WHERE user_id=? ORDER BY verified_at DESC LIMIT 1').get(user_id);
    const text=state.status==='grace'?`Your Unlimited renewal payment needs attention. ${state.provider==='stripe'?'You have a 14-day grace period':'Your app-store billing grace period continues'}, through ${new Date(state.graceUntil).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'})}, with full access. Update your payment method to keep your membership active. Your pottery history will remain saved even if access pauses.`:'Your Pottery Collection Is Safe\n\nYour Unlimited membership is currently inactive. All your pottery records, photos, and studio history have been saved securely.\n\nRenew your membership to pick up right where you left off.';
    const deliveryKey=['account-access',user_id,row.source_id,state.status,row.grace_until || row.paid_through || 'inactive'].join(':');
    transporter.sendMail({deliveryKey,deliveryKind:'account-access',accessUserId:user_id,accessStatus:state.status,from,to:u.email,subject:state.status==='grace'?'Your Unlimited renewal needs attention':'Your Pottery Collection Is Safe',text:text+'\n\nSign in to your original account: https://thepottersmudroom.com/reactivate'}).catch(()=>{});
  }
}
module.exports={eligible,queue};
