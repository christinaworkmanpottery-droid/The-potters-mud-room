'use strict';
const normalize = value => String(value || '').trim().toLowerCase();
function init(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS email_suppressions(recipient TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS email_bounce_events(id INTEGER PRIMARY KEY,delivery_id TEXT NOT NULL,recipient TEXT NOT NULL,status_code TEXT NOT NULL,diagnostic TEXT NOT NULL,recorded_by TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(delivery_id,status_code,diagnostic));`);
}
function record(db, {deliveryId,recipient,statusCode,diagnostic}, actor) {
  init(db);
  recipient=normalize(recipient);
  if(!/^5\.\d{1,3}\.\d{1,3}$/.test(statusCode || '') || typeof diagnostic!=='string' || !diagnostic.trim() || diagnostic.length>4000) throw Error('A permanent 5.x.x status and the receiving server diagnostic are required');
  return db.transaction(()=>{
    const row=db.prepare('SELECT * FROM smtp_delivery_log WHERE id=?').get(deliveryId);
    if(!row || normalize(row.recipient)!==recipient)throw Error('Bounce recipient must match the selected delivery');
    if(!['accepted','bounced'].includes(row.status))throw Error('Only an SMTP-accepted message can receive a subsequent bounce');
    db.prepare('INSERT OR IGNORE INTO email_bounce_events(delivery_id,recipient,status_code,diagnostic,recorded_by) VALUES(?,?,?,?,?)').run(deliveryId,recipient,statusCode,diagnostic.trim(),actor);
    db.prepare('INSERT OR IGNORE INTO email_suppressions(recipient,reason) VALUES(?,?)').run(recipient,statusCode+' '+diagnostic.trim());
    db.prepare("UPDATE smtp_delivery_log SET status='bounced',error_message=?,retry_at=NULL,payload=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(statusCode+' '+diagnostic.trim(),deliveryId);
    db.prepare("UPDATE smtp_delivery_log SET status='suppressed',retry_at=NULL,payload=NULL,error_message='Recipient suppressed after permanent bounce',updated_at=CURRENT_TIMESTAMP WHERE lower(trim(recipient))=? AND status IN ('pending','retry_pending')").run(recipient);
    if(deliveryId.startsWith('welcome:') && db.prepare("SELECT name FROM sqlite_master WHERE name='welcome_email_deliveries'").get()) db.prepare("UPDATE welcome_email_deliveries SET status='bounced' WHERE user_id=?").run(deliveryId.slice(8));
    return {status:'bounced',suppressed:true};
  })();
}
module.exports={init,record,normalize};
