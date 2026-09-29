// Phase 0 tooling only. Never import the checkout's database.js/server.js in place.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const cleanEnv = { PATH: process.env.PATH, NODE_ENV: 'test' };
for (const file of ['tests/directory-calendar.cjs', 'tests/website-api.cjs', 'tests/website-dom.cjs']) {
  const result = spawnSync(process.execPath, [file], { cwd: root, env: cleanEnv, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mudroom-ql-phase0-'));
  let server, db, log = '';
  try {
    for (const file of ['server.js', 'database.js', 'iap.js', 'directory-search.js', 'calendar-export.js']) {
      fs.copyFileSync(path.join(root, file), path.join(tmp, file));
    }
    fs.cpSync(path.join(root, 'geodata'), path.join(tmp, 'geodata'), { recursive: true });
    fs.cpSync(path.join(root, 'public'), path.join(tmp, 'public'), { recursive: true });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
    // Only affects this disposable child process; production source is untouched.
    fs.writeFileSync(path.join(tmp, 'loopback.cjs'), `const net=require('node:net');const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';return listen.apply(this,args);};`);
    const port = 41000 + crypto.randomInt(10000);
    server = spawn(process.execPath, ['--require', './loopback.cjs', 'server.js'], {
      cwd: tmp,
      env: { ...cleanEnv, PORT: String(port), APP_URL: `http://127.0.0.1:${port}`, JWT_SECRET: crypto.randomBytes(32).toString('hex'), ADMIN_API_KEY: crypto.randomBytes(32).toString('hex') },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', c => log += c);
    server.stderr.on('data', c => log += c);
    for (let i = 0; i < 150 && !log.includes('running on'); i++) {
      if (server.exitCode !== null) throw new Error(log);
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(log.includes('running on'), 'disposable server started');
    const version = await (await fetch(`http://127.0.0.1:${port}/api/version`)).json();
    assert.equal(version.version, '47');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/auth/me`)).status, 401);
    const Database = require('better-sqlite3');
    db = new Database(path.join(tmp, 'data/pottery.db'), { readonly: true });
    assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }]);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => ({
      ...row,
      columns: db.pragma(`table_info('${row.name}')`),
      foreignKeys: db.pragma(`foreign_key_list('${row.name}')`)
    }));
    const inventory = JSON.stringify({ source: 'Fresh synthetic database after baseline server startup; not a production export', baseline: require('./baseline.json').website.sourceCommit, tables }, null, 2) + '\n';
    if (process.argv.includes('--write-schema')) fs.writeFileSync(path.join(__dirname, 'schema.json'), inventory);
    else assert.equal(inventory, fs.readFileSync(path.join(__dirname, 'schema.json'), 'utf8'), 'schema matches baseline inventory');
    console.log(`PASS disposable baseline: ${tables.length} tables; integrity, foreign keys, version and unauthenticated access checked`);
  } finally {
    if (db) db.close();
    if (server && server.exitCode === null) {
      await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
