'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

// A SQLite snapshot includes committed WAL contents. Never copy an open DB file.
function snapshot(db, label) {
  if (!db.name || db.name === ':memory:') return null;
  const dir = path.join(path.dirname(db.name), 'billing-backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${label}-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(file);
  fs.chmodSync(file, 0o600);
  const copy = new Database(file, { readonly: true });
  try {
    // Old production contains previously forced values violating old CHECKs.
    // Check structural integrity without reinterpreting those historic values.
    copy.pragma('ignore_check_constraints = ON');
    if (copy.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Billing backup integrity failed');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    for (const { name } of tables) {
      const quoted = '"' + name.replace(/"/g, '""') + '"';
      if (copy.prepare(`SELECT COUNT(*) n FROM ${quoted}`).get().n !== db.prepare(`SELECT COUNT(*) n FROM ${quoted}`).get().n) throw new Error('Billing backup row count mismatch');
    }
  } finally { copy.close(); }
  return file;
}

function migrateLegacyUsers(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!row) return;
  // Rebuild only these known constraints, retaining every column, row, index,
  // trigger and child reference. Never disable CHECK enforcement permanently.
  const tierCheck = /CHECK\s*\(tier\s+IN\s*\([^)]*\)\)/i;
  const billingCheck = /CHECK\s*\(billing_period\s+IN\s*\([^)]*\)\)/i;
  let sql = row.sql.replace(tierCheck, "CHECK(tier IN ('free','basic','mid','top','starter'))")
    .replace(billingCheck, "CHECK(billing_period IN ('monthly','yearly','promo','stripe-monthly','stripe-yearly'))");
  if (sql === row.sql) return;
  snapshot(db, 'before-membership-schema');
  const oldCount = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  const oldFK = JSON.stringify(db.pragma('foreign_key_check'));
  const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='users' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  const columns = db.pragma('table_info(users)').map(c => '"' + c.name.replace(/"/g,'""') + '"').join(',');
  sql = sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`\[]?users["`\]]?/i, 'CREATE TABLE billing_users_migration');
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(sql);
      db.exec(`INSERT INTO billing_users_migration (${columns}) SELECT ${columns} FROM users`);
      if (db.prepare('SELECT COUNT(*) n FROM billing_users_migration').get().n !== oldCount) throw new Error('Migration row count mismatch');
      db.exec('DROP TABLE users; ALTER TABLE billing_users_migration RENAME TO users;');
      for (const object of objects) db.exec(object.sql);
      if (JSON.stringify(db.pragma('foreign_key_check')) !== oldFK) throw new Error('Migration changed foreign key integrity');
    })();
  } finally { db.pragma('foreign_keys = ON'); }
  console.log('[billing] Membership schema migrated; backup verified; member rows preserved:', oldCount);
}

function initBillingTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_events (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, object_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt INTEGER NOT NULL DEFAULT 0, last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS billing_state (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS billing_audit (
      id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, reason TEXT NOT NULL,
      before_json TEXT NOT NULL, after_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS billing_fulfillments (session_id TEXT PRIMARY KEY, created_at TEXT DEFAULT (datetime('now')));
  `);
}
module.exports = { snapshot, migrateLegacyUsers, initBillingTables };
