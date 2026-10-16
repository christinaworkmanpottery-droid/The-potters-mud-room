'use strict';
const {randomUUID,createHash}=require('crypto');
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
  db.exec(`CREATE TABLE IF NOT EXISTS smtp_account_state(account TEXT PRIMARY KEY,blocked_until INTEGER DEFAULT 0,failures INTEGER DEFAULT 0,last_attempt INTEGER DEFAULT 0,disabled INTEGER DEFAULT 0,config_hash TEXT,last_success INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS smtp_delivery_log(id TEXT PRIMARY KEY,account TEXT,recipient TEXT,status TEXT,error_message TEXT,payload TEXT,retry_at INTEGER,attempts INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  const fingerprint=createHash('sha256').update(JSON.stringify(config)).digest('hex');
  db.prepare('INSERT OR IGNORE INTO smtp_account_state(account,config_hash) VALUES (?,?)').run(account,fingerprint);
  // Changed credentials can clear a permanent error, but never clear a temporary throttle.
  db.prepare('UPDATE smtp_account_state SET disabled=0,config_hash=? WHERE account=? AND config_hash!=?').run(fingerprint,account,fingerprint);
  const raw=nodemailer.createTransport({...config,pool:true,maxConnections:1,maxMessages:100,rateDelta:1000,rateLimit:1,maxRequeues:0});
  let tail=Promise.resolve(),closed=false,working=false;
  function state(){return db.prepare('SELECT blocked_until,failures,last_attempt,disabled,last_success FROM smtp_account_state WHERE account=?').get(account);}
  function paused(){const s=state();if(s.disabled){const e=Error('SMTP credentials need attention; automatic sign-in is paused');e.code='EMAIL_DISABLED';throw e;}if(s.blocked_until>clock()){const e=Error('SMTP sending paused until '+new Date(s.blocked_until).toISOString());e.code='EMAIL_COOLDOWN';e.retryable=true;e.retryAt=s.blocked_until;throw e;}}
  function enqueue(mail){
    const id=mail.deliveryKey||randomUUID();
    const payload={...mail,deliveryKey:id,messageId:mail.messageId||'<'+randomUUID()+'@thepottersmudroom.com>'};
    db.prepare("INSERT OR IGNORE INTO smtp_delivery_log(id,account,recipient,status,payload) VALUES (?,?,?,'pending',?)").run(id,account,String(mail.to),JSON.stringify(payload));
    return id;
  }
  async function send(id){
    const row=db.prepare('SELECT * FROM smtp_delivery_log WHERE id=? AND account=?').get(id,account);
    if(row.status==='accepted')return {accepted:[row.recipient],deduplicated:true};
    if(['attempted','unknown','skipped'].includes(row.status))throw Error('Previous SMTP outcome uncertain or skipped; manual review required');
    const mail=JSON.parse(row.payload);
    try {
      if(closed)throw Object.assign(Error('Email settings changed; pending mail retained'),{code:'EMAIL_CLOSED'});
      if(mail.expiresAt && mail.expiresAt<=clock() || options.eligible && !options.eligible(mail)){
        db.prepare("UPDATE smtp_delivery_log SET status='skipped',payload=NULL,error_message='Expired or no longer eligible',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
        throw Object.assign(Error('Expired or no longer eligible'),{code:'EMAIL_SKIPPED'});
      }
      paused();await sleep(Math.max(0,1000-(clock()-state().last_attempt)));paused();
      db.prepare("UPDATE smtp_delivery_log SET status='attempted',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      db.prepare('UPDATE smtp_account_state SET last_attempt=? WHERE account=?').run(clock(),account);
      const {deliveryKey,deliveryKind,welcomeUserId,expiresAt,...payload}=mail;
      const info=await raw.sendMail(payload);
      if(info?.rejected?.length){const e=Error('Mail provider rejected recipient');e.responseCode=550;e.command='RCPT TO';throw e;}
      db.prepare("UPDATE smtp_delivery_log SET status='accepted',payload=NULL,retry_at=NULL,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
      db.prepare('UPDATE smtp_account_state SET failures=0,blocked_until=0,last_success=? WHERE account=?').run(clock(),account);
      if(options.accepted)options.accepted(mail);
      return info;
    } catch(err) {
      if(['EMAIL_SKIPPED','EMAIL_CLOSED'].includes(err.code))throw err;
      const c=classify(err);
      if(c.auth){const failures=state().failures+1;const delay=Math.min(24*3600000,3600000*2**Math.min(failures-1,5));
        db.prepare('UPDATE smtp_account_state SET failures=?,blocked_until=?,disabled=? WHERE account=?').run(failures,clock()+delay,c.retryable?0:1,account);
        err.retryAt=clock()+delay;
      }
      err.retryable=err.retryable||c.retryable;
      if(err.retryable&&!err.retryAt)err.retryAt=clock()+Math.min(3600000,60000*2**row.attempts);
      const uncertain=!err.retryable&&!c.auth&&!err.responseCode&&!['EMAIL_DISABLED','EMAIL_COOLDOWN'].includes(err.code);
      const attempts=db.prepare('SELECT attempts FROM smtp_delivery_log WHERE id=?').get(id).attempts;
      const retry=err.retryable&&attempts<5;
      db.prepare('UPDATE smtp_delivery_log SET status=?,error_message=?,retry_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(retry?'retry_pending':uncertain?'unknown':'failed',c.summary,retry?err.retryAt:null,id);
      throw err;
    }
  }
  function run(id){const result=tail.then(()=>send(id));tail=result.catch(()=>{});return result;}
  async function work(){
    if(working||closed)return;working=true;
    try {paused();const rows=db.prepare("SELECT id FROM smtp_delivery_log WHERE account=? AND id NOT LIKE 'campaign:%' AND (status='pending' OR (status='retry_pending' AND retry_at<=?)) ORDER BY created_at LIMIT 25").all(account,clock());
      for(const row of rows){try{await run(row.id);}catch(e){if(e.retryAt||e.code==='EMAIL_DISABLED')break;}}
    }catch(e){if(!['EMAIL_COOLDOWN','EMAIL_DISABLED'].includes(e.code))console.error('[mail worker]',e.message);}finally{working=false;}
  }
  const timer=options.noTimer?null:setInterval(()=>work(),10000);timer?.unref();
  return {sendMail(mail){return run(enqueue(mail));},work,state,close(){closed=true;if(timer)clearInterval(timer);raw.close();}};
}
module.exports={createReliableMailer,classify};
