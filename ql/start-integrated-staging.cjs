'use strict';
const fs=require('node:fs');
const path=require('node:path');
const STAGING='https://mudroom-ql-integrated-oct14.onrender.com';
function validateStaging(env,mounts,dataPath){
  if(env.APP_URL!==STAGING)throw Error('Integrated staging requires its exact isolated URL.');
  if(!env.JWT_SECRET || !env.QL_PREVIEW_PASSWORD)throw Error('Staging secrets are required.');
  if(env.QL_REQUIRE_DURABLE_STORAGE!=='1')throw Error('Durable staging storage must be required.');
  if(['STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','SMTP_PASS','GMAIL_APP_PASSWORD'].some(k=>env[k]))throw Error('Do not attach production billing or email credentials to staging.');
  // An existing directory alone does not prove that a persistent volume is mounted.
  const mounted=mounts.split('\n').some(line=>line.split(' ')[4]===dataPath);
  if(!mounted)throw Error('Staging data directory is not a mounted volume. Refusing ephemeral startup.');
}
function start(){
  const dataPath=path.resolve(__dirname,'../data');
  validateStaging(process.env,fs.readFileSync('/proc/self/mountinfo','utf8'),dataPath);
  const db=require('../database').initDB();
  try {db.prepare('INSERT OR IGNORE INTO users (id,email,password_hash,display_name,tier,billing_period) VALUES (?,?,?,?,?,?)').run('ql-integration-owner','ql-preview@example.invalid',require('bcryptjs').hashSync(process.env.QL_PREVIEW_PASSWORD,10),'Christina — Quantum Leap Preview','starter','promo');}
  finally{db.close();}
  require('../server');
}
if(require.main===module)start();
module.exports={validateStaging};
