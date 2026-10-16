'use strict';
const {randomUUID}=require('crypto');
function classify(err) {
  const message=String(err.message||err);
  const auth=err.code==='EAUTH'||/^AUTH/i.test(err.command||'')||/too many login attempts/i.test(message);
  const temporary=Number(err.responseCode)>=400&&Number(err.responseCode)<500 || /454[ -]4\.7\.0/.test(message);
  const beforeData=/^(CONN|CONNECT|EHLO|HELO|STARTTLS|AUTH|MAIL FROM|RCPT TO)/i.test(err.command||'');
  return {auth,retryable:temporary&&(auth||beforeData),summary:auth?(temporary?'Gmail temporarily restricted sign-in. Sending paused; retry after cooldown.':'SMTP sign-in failed. Check email settings before retrying.'):'Email send failed. '+message.replace(/[\r\n]+/g,' ').slice(0,180)};
}
function createReliableMailer(db,nodemailer,config,options={}) {
  const clock=options.clock||Date.now, sleep=options.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
  const account=String(config.auth.user).toLowerCase();
  db.exec(`CREATE TABLE IF NOT EXISTS smtp_account_state(account TEXT PRIMARY KEY,blocked_until INTEGER DEFAULT 0,failures INTEGER DEFAULT 0,last_attempt INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS smtp_delivery_log(id TEXT PRIMARY KEY,account TEXT,recipient TEXT,status TEXT,error_message TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  db.prepare('INSERT OR IGNORE INTO smtp_account_state(account) VALUES (?)').run(account);
  const raw=nodemailer.createTransport({...config,pool:true,maxConnections:1,maxMessages:100,rateDelta:1000,rateLimit:1,maxRequeues:0});
  let tail=Promise.resolve(),closed=false;
  function state(){return db.prepare('SELECT * FROM smtp_account_state WHERE account=?').get(account);}
  function paused(){const s=state();if(s.blocked_until>clock()){const e=Error('SMTP sending paused until '+new Date(s.blocked_until).toISOString());e.code='EMAIL_COOLDOWN';e.retryable=true;e.retryAt=s.blocked_until;throw e;}}
  async function send(mail){
    const id=mail.deliveryKey||randomUUID();
    const previous=db.prepare('SELECT * FROM smtp_delivery_log WHERE id=?').get(id);
    if(previous?.status==='accepted')return {accepted:[mail.to],deduplicated:true};
    if(previous?.status==='attempted'||previous?.status==='unknown')throw Error('Previous SMTP outcome uncertain; manual review required');
    db.prepare("INSERT OR IGNORE INTO smtp_delivery_log(id,account,recipient,status) VALUES (?,?,?,'pending')").run(id,account,String(mail.to));
    try {
      if(closed)throw Error('Email settings changed; retry with current configuration');
      paused();await sleep(Math.max(0,1000-(clock()-state().last_attempt)));paused();
      db.prepare("UPDATE smtp_delivery_log SET status='attempted',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      db.prepare('UPDATE smtp_account_state SET last_attempt=? WHERE account=?').run(clock(),account);
      const {deliveryKey,...payload}=mail;
      const info=await raw.sendMail(payload);
      if(info?.rejected?.length){const e=Error('Mail provider rejected recipient');e.responseCode=550;e.command='RCPT TO';throw e;}
      db.prepare("UPDATE smtp_delivery_log SET status='accepted',error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      db.prepare('UPDATE smtp_account_state SET failures=0,blocked_until=0 WHERE account=?').run(account);
      return info;
    } catch(err) {
      const c=classify(err);
      if(c.auth){const failures=state().failures+1;const delay=Math.min(24*3600000,3600000*2**Math.min(failures-1,5));
        db.prepare('UPDATE smtp_account_state SET failures=?,blocked_until=? WHERE account=?').run(failures,clock()+delay,account);
        err.retryAt=clock()+delay;
      }
      err.retryable=err.retryable||c.retryable;
      if(err.retryable&&!err.retryAt)err.retryAt=clock()+60000;
      const uncertain=!err.retryable&&!c.auth&&!err.responseCode;
      db.prepare('UPDATE smtp_delivery_log SET status=?,error_message=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(uncertain?'unknown':'failed',c.summary,id);
      throw err;
    }
  }
  return {sendMail(mail){const result=tail.then(()=>send(mail));tail=result.catch(()=>{});return result;},state,close(){closed=true;raw.close();}};
}
module.exports={createReliableMailer,classify};
