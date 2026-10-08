// Only synthetic databases in temporary directories; never open checkout/production data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const Database = require('better-sqlite3'), jwt = require('jsonwebtoken');
const root = path.resolve(__dirname, '..');
const fields = [['events', 'contact_id'], ...['role', 'address', 'instagram', 'website'].map(c => ['contacts', c])];
const cleanEnv = { PATH: process.env.PATH, NODE_ENV: 'test' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-events-contact-init-'));
  fs.copyFileSync(path.join(root, 'database.js'), path.join(dir, 'database.js'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = () => {
    const r = spawnSync(process.execPath, ['-e', "const db=require('./database').initDB();db.close()"], { cwd: dir, env: cleanEnv, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stderr, /duplicate column|no such table|no such column|Error:/i);
  };
  const open = () => new Database(path.join(dir, 'data/pottery.db'));
  return { dir, run, open };
}
function shape(db) {
  for (const [table, column] of fields) {
    const cols = db.pragma(`table_info(${table})`).filter(c => c.name === column);
    assert.equal(cols.length, 1, table + '.' + column);
    assert.equal(cols[0].type, 'TEXT'); assert.equal(cols[0].notnull, 0); assert.equal(cols[0].dflt_value, null);
    assert.ok(!db.pragma(`foreign_key_list(${table})`).some(f => f.from === column));
  }
}
const schema = db => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
const rows = db => Object.fromEntries(['contacts', 'events'].map(n => [n, db.prepare(`SELECT * FROM ${n} ORDER BY id`).all()]));
function seed(db) {
  db.exec("INSERT INTO users(id,email,password_hash) VALUES('a','a@example.invalid','synthetic'),('b','b@example.invalid','synthetic'); INSERT INTO contacts(id,user_id,name,email,notes,created_at,updated_at) VALUES('ca','a','Keep','a@example.invalid','Original','2020-01-01','2020-01-02'); INSERT INTO events(id,user_id,title,event_date,start_time,end_time,location,image_filename,created_at,updated_at) VALUES('ea','a','Keep event','2026-10-01','09:15','10:30','City','unchanged.jpg','2020-01-01','2020-01-02')");
  for (const [table, col] of fields) if (db.pragma(`table_info(${table})`).some(c => c.name === col)) db.prepare(`UPDATE ${table} SET ${col}=?`).run(col === 'contact_id' ? 'ca' : 'Keep ' + col);
  // Abort even value-identical writes: additions must not rewrite existing Contact/Event rows.
  for (const table of ['contacts', 'events']) for (const op of ['UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER guard_${table}_${op} BEFORE ${op} ON ${table} BEGIN SELECT RAISE(ABORT,'unexpected row rewrite'); END`);
}
for (const [table, col] of fields) test(`first init creates nullable TEXT ${table}.${col}`, t => {
  const f = fixture(t); f.run(); const db = f.open(); try { shape(db); assert.ok(db.pragma(`table_info(${table})`).some(c => c.name === col)); } finally { db.close(); }
});
// Every missing-column subset, including all absent and all present, plus 3 repeated starts.
for (let mask = 0; mask < 32; mask++) test(`existing install additive repair mask ${mask}; rows/indexes/triggers and repeated startup preserved`, t => {
  const f = fixture(t); f.run(); let db = f.open();
  for (let i = 0; i < fields.length; i++) if (!(mask & (1 << i))) db.exec(`ALTER TABLE ${fields[i][0]} DROP COLUMN ${fields[i][1]}`);
  seed(db); const before = rows(db), objects = schema(db).filter(o => o.type !== 'table'); db.close();
  f.run(); db = f.open(); shape(db);
  const repaired = rows(db);
  for (const table of ['contacts', 'events']) for (let i = 0; i < before[table].length; i++) {
    for (const [key, value] of Object.entries(before[table][i])) assert.equal(repaired[table][i][key], value);
    for (const [tbl, col] of fields) if (tbl === table && !(col in before[table][i])) assert.equal(repaired[table][i][col], null);
  }
  assert.deepEqual(schema(db).filter(o => o.type !== 'table'), objects);
  const stable = schema(db); db.close();
  for (let n = 0; n < 3; n++) { f.run(); db = f.open(); shape(db); assert.deepEqual(rows(db), repaired); assert.deepEqual(schema(db), stable); assert.deepEqual(db.pragma('integrity_check'), [{ integrity_check: 'ok' }]); assert.deepEqual(db.pragma('foreign_key_check'), []); db.close(); }
});

let dir, server, db, base, tokenA, tokenB;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ql-events-contact-api-'));
  for (const file of ['server.js', 'database.js', 'iap.js', 'directory-search.js', 'calendar-export.js', 'deletion-lifecycle.cjs']) fs.copyFileSync(path.join(root, file), path.join(dir, file));
  fs.mkdirSync(path.join(dir, 'ql'));
  for (const file of ['relationships.cjs', 'piece-history.cjs', 'piece-editor.cjs', 'photo-query-safety.cjs','photo-result-confidence.cjs']) fs.copyFileSync(path.join(root, 'ql', file), path.join(dir, 'ql', file));
  fs.cpSync(path.join(root, 'geodata'), path.join(dir, 'geodata'), { recursive: true });
  for (const file of ['node_modules', 'public']) fs.symlinkSync(path.join(root, file), path.join(dir, file), 'dir');
  fs.writeFileSync(path.join(dir, 'loopback.cjs'), "const net=require('node:net'),listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[1]==='0.0.0.0')args[1]='127.0.0.1';this.once('listening',()=>require('fs').writeFileSync(require('path').join(__dirname,'port'),String(this.address().port)));return listen.apply(this,args)};");
  const secret = crypto.randomBytes(32).toString('hex'); let log = '';
  // Port 0 reserves a free port atomically, preventing test-server collisions.
  server = spawn(process.execPath, ['--require', './loopback.cjs', 'server.js'], { cwd: dir, env: { ...cleanEnv, PORT: '0', JWT_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', c => log += c); server.stderr.on('data', c => log += c);
  for (let n = 0; n < 150 && !log.includes('running on'); n++) { if (server.exitCode !== null) throw new Error(log); await new Promise(r => setTimeout(r, 50)); }
  assert.ok(log.includes('running on'), log);
  // server logs the configured port, so identify its bound port in the isolated preload.
  const portFile = path.join(dir, 'port');
  // Filled by the preload listening hook below.
  assert.ok(fs.existsSync(portFile), log); base = 'http://127.0.0.1:' + fs.readFileSync(portFile, 'utf8');
  db = new Database(path.join(dir, 'data/pottery.db')); shape(db);
  db.exec("INSERT INTO users(id,email,password_hash,tier) VALUES('a','a@example.invalid','synthetic','starter'),('b','b@example.invalid','synthetic','starter')");
  tokenA = jwt.sign({ userId: 'a' }, secret); tokenB = jwt.sign({ userId: 'b' }, secret);
});
test.after(async () => { if (db?.open) db.close(); if (server && server.exitCode === null) { const done = new Promise(r => server.once('exit', r)); server.kill(); await done; } if (dir) fs.rmSync(dir, { recursive: true, force: true }); });
async function request(url, method = 'GET', body, token = tokenA) {
  const r = await fetch(base + url, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = text; } return { status: r.status, data };
}
async function createContact(body = {}, token = tokenA) { const r = await request('/api/contacts', 'POST', { name: 'Contact', ...body }, token); assert.equal(r.status, 200, JSON.stringify(r)); return r.data.id; }
const eventBody = { title: 'Market', description: 'Keep', eventDate: '2026-10-01', startTime: '09:15', endTime: '10:30', location: 'City', venue: 'Venue', address: 'Address', website: 'https://example.invalid' };
async function createEvent(body = {}, token = tokenA) { const r = await request('/api/events', 'POST', { ...eventBody, ...body }, token); assert.equal(r.status, 200, JSON.stringify(r)); return r.data.id; }
const contactRow = id => db.prepare('SELECT * FROM contacts WHERE id=?').get(id);
const eventRow = id => db.prepare('SELECT * FROM events WHERE id=?').get(id);
const link = (event, contact) => db.prepare('UPDATE events SET contact_id=? WHERE id=?').run(contact, event);
test('first server startup supports basic Contact create/list/detail with NULL optional fields', async () => {
  const id = await createContact({ name: 'Basic' }); const row = contactRow(id);
  for (const col of ['role', 'address', 'instagram', 'website', 'email', 'phone', 'notes']) assert.equal(row[col], null);
  const list = await request('/api/contacts'); assert.equal(list.status, 200); assert.ok(list.data.some(c => c.id === id && c.eventsCount === 0));
  const detail = await request('/api/contacts/' + id); assert.equal(detail.status, 200); assert.equal(detail.data.name, 'Basic'); assert.deepEqual(detail.data.events, []); assert.deepEqual(detail.data.sales, []);
});
for (const col of ['role', 'address', 'instagram', 'website']) test(`Contact ${col} create/list/detail/update/clear on first startup`, async () => {
  const original = col === 'website' ? 'https://example.invalid/original' : 'original';
  const changed = col === 'website' ? 'https://example.invalid/changed' : 'changed';
  const id = await createContact({ [col]: original }); assert.equal(contactRow(id)[col], original);
  assert.equal((await request('/api/contacts/' + id)).data[col], original); assert.equal((await request('/api/contacts')).data.find(c => c.id === id)[col], original);
  assert.equal((await request('/api/contacts/' + id, 'PUT', { name: 'Updated', [col]: changed })).status, 200); assert.equal(contactRow(id)[col], changed);
  for (const value of [null, '']) { assert.equal((await request('/api/contacts/' + id, 'PUT', { name: 'Updated', [col]: value })).status, 200); assert.equal(contactRow(id)[col], null); }
});
test('Contact ownership: list/detail scoped, foreign/missing updates and deletes retain existing no-op behavior', async () => {
  const id = await createContact({ name: 'Foreign private', role: 'buyer' }, tokenB), before = contactRow(id);
  assert.ok(!(await request('/api/contacts')).data.some(c => c.id === id));
  for (const target of [id, 'missing']) { assert.equal((await request('/api/contacts/' + target)).status, 404); assert.equal((await request('/api/contacts/' + target, 'PUT', { name: 'No' })).status, 200); assert.equal((await request('/api/contacts/' + target, 'DELETE')).status, 200); }
  assert.deepEqual(contactRow(id), before);
});
test('Event without Contact create/read/update retains serialization and times', async () => {
  const id = await createEvent(); assert.equal(eventRow(id).contact_id, null);
  const list = await request('/api/events'); assert.equal(list.status, 200); const ev = list.data.find(e => e.id === id); assert.equal(ev.event_date, eventBody.eventDate); assert.equal(ev.start_time, '09:15');
  assert.equal((await request('/api/events/' + id, 'PUT', { ...eventBody, title: 'Updated' })).status, 200); assert.equal(eventRow(id).title, 'Updated'); assert.equal(eventRow(id).contact_id, null);
});
test('persisted owned Event Contact resolves by scoped detail and Contact counts/detail queries', async () => {
  const cid = await createContact(), eid = await createEvent(); link(eid, cid);
  const ev = (await request('/api/events')).data.find(e => e.id === eid); assert.equal(ev.contact_id, cid);
  const detail = await request('/api/contacts/' + ev.contact_id); assert.equal(detail.status, 200); assert.ok(detail.data.events.some(e => e.id === eid));
  assert.equal((await request('/api/contacts')).data.find(c => c.id === cid).eventsCount, 1);
  assert.equal((await request('/api/events/' + eid, 'PUT', eventBody)).status, 200); assert.equal(eventRow(eid).contact_id, cid);
});
test('Event API retains existing ignored Contact input semantics; no new linking/clearing endpoint', async () => {
  const cid = await createContact(), eid = await createEvent({ contactId: cid, contact_id: cid }); assert.equal(eventRow(eid).contact_id, null);
  link(eid, cid); assert.equal((await request('/api/events/' + eid, 'PUT', { ...eventBody, contactId: null, contact_id: null })).status, 200); assert.equal(eventRow(eid).contact_id, cid);
  link(eid, null); assert.equal((await request('/api/contacts')).data.find(c => c.id === cid).eventsCount, 0); assert.deepEqual((await request('/api/contacts/' + cid)).data.events, []);
});
for (const foreign of [false, true]) test(`Event ${foreign ? 'foreign' : 'missing'} Contact pointer preserves legacy TEXT storage and scoped lookup`, async () => {
  const cid = foreign ? await createContact({}, tokenB) : 'missing', eid = await createEvent(); link(eid, cid);
  assert.equal(eventRow(eid).contact_id, cid); assert.equal((await request('/api/contacts/' + cid)).status, 404);
  if (foreign) assert.ok(!(await request('/api/contacts/' + cid, 'GET', undefined, tokenB)).data.events.some(e => e.id === eid));
});
test('Contact deletion detaches owned Event without deleting Event or media metadata', async () => {
  const cid = await createContact(), eid = await createEvent(); link(eid, cid); db.prepare("UPDATE events SET image_filename='keep.jpg' WHERE id=?").run(eid); const before = eventRow(eid);
  assert.equal((await request('/api/contacts/' + cid, 'DELETE')).status, 200); assert.equal(contactRow(cid), undefined); assert.deepEqual(eventRow(eid), { ...before, contact_id: null });
});
test('Contact deletion rejects inconsistent foreign Event reference atomically', async () => {
  const cid = await createContact(), eid = await createEvent({}, tokenB); link(eid, cid); const before = contactRow(cid), ev = eventRow(eid);
  assert.equal((await request('/api/contacts/' + cid, 'DELETE')).status, 409); assert.deepEqual(contactRow(cid), before); assert.deepEqual(eventRow(eid), ev);
});
test('Event ownership and deletion unchanged', async () => {
  const eid = await createEvent({}, tokenB), before = eventRow(eid);
  assert.ok(!(await request('/api/events')).data.some(e => e.id === eid)); assert.equal((await request('/api/events/' + eid, 'PUT', eventBody)).status, 404); assert.equal((await request('/api/events/' + eid, 'DELETE')).status, 404); assert.deepEqual(eventRow(eid), before);
  assert.equal((await request('/api/events/' + eid, 'DELETE', undefined, tokenB)).status, 200); assert.equal(eventRow(eid), undefined);
});
test('Contact full values and basic fields survive unrelated initialization', async () => {
  const values = { name: 'Full', email: 'full@example.invalid', phone: 'synthetic', notes: 'Notes', role: 'gallery', address: 'Address', instagram: '@example', website: 'https://example.invalid' };
  const id = await createContact(values), before = contactRow(id);
  const r = spawnSync(process.execPath, ['-e', "const db=require('./database').initDB();db.close()"], { cwd: dir, env: cleanEnv, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); assert.deepEqual(contactRow(id), before);
});
test('iCal export/feed output is Contact-independent and unchanged across additive initialization', async () => {
  const cid = await createContact(), eid = await createEvent(); const get = url => fetch(base + url, { headers: { Authorization: 'Bearer ' + tokenA } }).then(r => r.text()).then(s => s.replace(/^DTSTAMP:.*$/gm, 'DTSTAMP:<generated>'));
  const before = await get('/api/events/export/ics?eventId=' + eid); link(eid, cid); assert.equal(await get('/api/events/export/ics?eventId=' + eid), before);
  const feed = await get('/api/events/subscribe/a');
  const r = spawnSync(process.execPath, ['-e', "const db=require('./database').initDB();db.close()"], { cwd: dir, env: cleanEnv, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  assert.equal(await get('/api/events/subscribe/a'), feed); assert.equal(await get('/api/events/export/ics?eventId=' + eid), before); assert.match(before, /DTSTART:20261001T091500/); assert.match(before, /DTEND:20261001T103000/);
});
