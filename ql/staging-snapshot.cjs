'use strict';
// Run on the staging host with application writes stopped. Never prints records.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const STAGING = 'https://mudroom-ql-integrated-oct14.onrender.com';
function inventory(root, prefix = '') {
  const result = {};
  for (const name of fs.readdirSync(path.join(root, prefix)).sort()) {
    const relative = path.posix.join(prefix, name);
    const full = path.join(root, relative);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw Error('Snapshot refuses symbolic links.');
    if (stat.isDirectory()) Object.assign(result, inventory(root, relative));
    else if (stat.isFile()) result[relative] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    else throw Error('Snapshot refuses special files.');
  }
  return result;
}
function checkDatabase(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw Error('SQLite integrity check failed.');
    if (db.pragma('foreign_key_check').length) throw Error('SQLite foreign key check failed.');
  } finally { db.close(); }
}
function verify(snapshot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || manifest.source !== STAGING) throw Error('Not an integrated staging snapshot.');
  const actual = inventory(path.join(snapshot, 'data'));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw Error('Snapshot checksum mismatch.');
  if (!actual['pottery.db']) throw Error('Snapshot database missing.');
  checkDatabase(path.join(snapshot, 'data', 'pottery.db'));
  return manifest;
}
async function backup(data, destination, env = process.env) {
  if (env.APP_URL !== STAGING || env.QL_STAGING_WRITES_STOPPED !== '1') {
    throw Error('Requires isolated staging URL and confirmed stopped application writes.');
  }
  data = fs.realpathSync(data);
  destination = path.resolve(destination);
  const parent = fs.realpathSync(path.dirname(destination));
  destination = path.join(parent, path.basename(destination));
  if (destination === data || destination.startsWith(data + path.sep)) throw Error('Snapshot must be outside data directory.');
  // Exclusive directory creation: never replace an existing backup.
  fs.mkdirSync(destination, { mode: 0o700 });
  const target = path.join(destination, 'data');
  fs.mkdirSync(target, { mode: 0o700 });
  let db;
  try {
    const before = inventory(data);
    db = new Database(path.join(data, 'pottery.db'), { readonly: true, fileMustExist: true });
    await db.backup(path.join(target, 'pottery.db'));
    db.close(); db = null;
    for (const relative of Object.keys(before)) {
      if (['pottery.db', 'pottery.db-wal', 'pottery.db-shm', 'pottery.db-journal'].includes(relative)) continue;
      const file = path.join(target, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.copyFileSync(path.join(data, relative), file, fs.constants.COPYFILE_EXCL);
    }
    // Do not certify a backup made while the app changed its records or media.
    // SQLite may change shared-memory bookkeeping merely by opening a reader.
    const stable = files => Object.fromEntries(Object.entries(files).filter(([name]) => name !== 'pottery.db-shm'));
    if (JSON.stringify(stable(before)) !== JSON.stringify(stable(inventory(data)))) throw Error('Staging data changed during snapshot; stop writes and retry.');
    const manifest = { version: 1, source: STAGING, createdAt: new Date().toISOString(), files: inventory(target) };
    fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
    verify(destination);
    return manifest;
  } catch (error) {
    if (db) db.close();
    fs.rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
async function main() {
  const [command, source, destination] = process.argv.slice(2);
  if (command === 'verify' && source && !destination) verify(source);
  else if (command === 'backup' && source && destination) await backup(source, destination);
  else throw Error('Usage: staging-snapshot.cjs backup DATA NEW_SNAPSHOT | verify SNAPSHOT');
  process.stdout.write('Staging snapshot verified. No application data printed.\n');
}
if (require.main === module) main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
module.exports = { backup, verify };
