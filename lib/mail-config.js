'use strict';
// Resolve once, before creating a transport. Legacy Admin saves predate the
// source marker, but must still survive a restart with stale environment values.
function resolveMailConfig(db, env) {
  const read = key => db.prepare('SELECT value FROM site_settings WHERE key=?').get(key)?.value;
  const user = read('smtp_user'), pass = read('smtp_pass');
  if (user && pass && read('smtp_config_source') !== 'environment') {
    return {user, pass, host: read('smtp_host'), port: Number(read('smtp_port')) || undefined, source:'database'};
  }
  if (env.SMTP_USER && env.SMTP_PASS) return {user:env.SMTP_USER, pass:env.SMTP_PASS, host:env.SMTP_HOST, port:Number(env.SMTP_PORT)||undefined, source:'environment'};
  return null;
}
module.exports = {resolveMailConfig};
