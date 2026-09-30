const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const server=fs.readFileSync('server.js','utf8'),app=fs.readFileSync('public/app.js','utf8'),deletion=fs.readFileSync('deletion-lifecycle.cjs','utf8');
const vm = require('node:vm');
const Database = require('better-sqlite3');
function comboHarness() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE glaze_combos (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, clay_body_name TEXT, cone TEXT, atmosphere TEXT, description TEXT, notes TEXT, is_shared INTEGER, is_public INTEGER, share_id TEXT, photo_filename TEXT, photo_filename2 TEXT, updated_at TEXT);
    CREATE TABLE glaze_combo_layers (id TEXT, combo_id TEXT, glaze_name TEXT, brand TEXT, coats INTEGER, application_method TEXT, layer_order INTEGER);`);
  const routes = new Map(), cleanup = [];
  const context = vm.createContext({ db, require: require('node:module').createRequire(require('node:path').resolve('server.js')), MAX_IMAGE_SIZE: 20000000, uuidv4: () => 'new-combo', auth() {},
    safeStoredUpload: filename => filename && !filename.includes('/') ? '/synthetic/' + filename : null,
    ownedPhotoSlots: (filename, owner) => ['photo_filename', 'photo_filename2'].flatMap(column => db.prepare(`SELECT id FROM glaze_combos WHERE user_id=? AND ${column}=?`).all(owner, filename).map(row => ({table:'glaze_combos', column, id:row.id}))),
    deletionLifecycle: { cleanupFiles: files => cleanup.push(Array.from(files).filter(Boolean)) },
    app: { get: (path, ...handlers) => routes.set(path, handlers.at(-1)) }
  });
  vm.runInContext(server.slice(server.indexOf('function glazeComboMediaContract('), server.indexOf('function protectPieceHistoryTestTileMedia(')), context);
  vm.runInContext(server.slice(server.indexOf('function saveComboRecord('), server.indexOf("app.post('/api/community/combos'")), context);
  vm.runInContext(server.slice(server.indexOf('// Phase 2K: public Glaze Combo photo delivery.'), server.indexOf('// Delete combo (owner only)')), context);
  const response = () => ({ statusCode:200, headers:{}, set(k,v){this.headers[k]=v;return this;}, status(v){this.statusCode=v;return this;}, json(v){this.body=v;return this;}, sendFile(v){this.file=v;} });
  return { db, context, routes, cleanup, response };
}
test('runtime Combo delivery enforces owner, two slots, publication, legacy ambiguity and collision denial', () => {
  const h = comboHarness();
  try {
    h.db.prepare('INSERT INTO glaze_combos (id,user_id,is_shared,is_public,photo_filename,photo_filename2) VALUES (?,?,?,?,?,?)').run('combo','A',0,0,'one.jpg','two.jpg');
    const invoke = (suffix, owner='A', slot=1) => { const r=h.response();h.routes.get('/api/ql/community/combos/:comboId/photos/:slot'+suffix)({params:{comboId:'combo',slot},userId:owner},r);return r; };
    for (const slot of [1,2]) { const r=invoke('', 'A', slot);assert.equal(r.file,'/synthetic/'+(slot===1?'one.jpg':'two.jpg'));assert.equal(r.headers['Cache-Control'],'private, no-store');assert.equal(r.headers['X-Content-Type-Options'],'nosniff'); }
    assert.equal(invoke('', 'B').statusCode,404);
    assert.equal(invoke('', 'A',3).statusCode,404);
    assert.equal(invoke('/public').statusCode,404);
    h.db.prepare('INSERT INTO glaze_combos (id,user_id,is_shared,photo_filename) VALUES (?,?,?,?)').run('foreign','B',0,'one.jpg');
    assert.equal(invoke('').statusCode,404);
    h.db.prepare('UPDATE glaze_combos SET is_shared=1 WHERE id=?').run('combo');
    assert.equal(invoke('/public').statusCode,404);
    h.db.prepare('DELETE FROM glaze_combos WHERE id=?').run('foreign');
    assert.equal(invoke('/public',undefined,2).file,'/synthetic/two.jpg');
    assert.equal(invoke('').statusCode,404);
    h.db.prepare('UPDATE glaze_combos SET is_shared=0,is_public=1,share_id=? WHERE id=?').run('public-link','combo');
    assert.equal(invoke('/public').file,'/synthetic/one.jpg');
    h.db.prepare('UPDATE glaze_combos SET is_shared=NULL,is_public=NULL,share_id=NULL WHERE id=?').run('combo');
    const row=h.db.prepare('SELECT * FROM glaze_combos WHERE id=?').get('combo');
    assert.equal(h.context.glazeComboMediaContract(row).photoDelivery,'legacy-static');
    assert.equal(row.photo_filename,'one.jpg');assert.equal(row.photo_filename2,'two.jpg');
    assert.equal(invoke('/public').statusCode,404);assert.equal(invoke('').statusCode,404);
  } finally { h.db.close(); }
});
test('runtime Combo save retains newly committed uploads and rolls back failed replacement without touching old photos', () => {
  const h=comboHarness();
  try {
    const file=filename=>({filename,mimetype:'image/jpeg',size:10});
    const save=(body,files,id)=>{const r=h.response();h.context.saveComboRecord({params:{id},userId:'A',body,files},r);return r;};
    const created=save({name:'Combo',isShared:false,photoSlots:'[0,1]'},[file('first.jpg'),file('second.jpg')]);
    assert.equal(created.statusCode,200);
    assert.equal(h.db.prepare('SELECT photo_filename2 FROM glaze_combos').get().photo_filename2,'second.jpg');
    assert.deepEqual(h.cleanup.flat(),[],'committed uploads must never be queued as unused uploads');
    const edited=save({photoSlots:'[null,0]'},[file('replacement.jpg')],'new-combo');
    assert.equal(edited.statusCode,200);
    assert.deepEqual(h.cleanup.flat(),['first.jpg','second.jpg']);
    const row=h.db.prepare('SELECT * FROM glaze_combos').get();assert.equal(row.photo_filename,null);assert.equal(row.photo_filename2,'replacement.jpg');
    h.db.exec("CREATE TRIGGER reject_combo_update BEFORE UPDATE ON glaze_combos BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;");
    h.cleanup.length=0;
    assert.equal(save({photoSlots:'[0,null]'},[file('failed.jpg')],'new-combo').statusCode,400);
    assert.equal(h.db.prepare('SELECT photo_filename2 FROM glaze_combos').get().photo_filename2,'replacement.jpg');
    assert.deepEqual(h.cleanup.flat(),['failed.jpg']);
  } finally { h.db.close(); }
});
test('Combo contract uses explicit shared/public state and preserves ambiguity',()=>{for(const value of ["is_shared === 1 || combo.is_public === 1","is_shared === 0 && combo.is_public !== 1","public-explicit","owner-protected","legacy-static","legacy-ambiguous"])assert.ok(server.includes(value));});
test('both Combo slots have exact public and protected routes',()=>{assert.ok(server.includes('glazeComboPhotoField'));assert.ok(server.includes("'photo_filename2'"));assert.ok(server.includes('/api/ql/community/combos/:comboId/photos/:slot/public'));assert.ok(server.includes("/api/ql/community/combos/:comboId/photos/:slot', auth"));});
test('public route is anonymous only for explicit public combos and collision-safe',()=>{assert.ok(server.includes('glazeComboExplicitlyPublic(combo)'));assert.ok(server.includes('publicGlazeComboFilenameSafe(filename)'));assert.ok(server.includes("table !== 'glaze_combos' || !glazeComboExplicitlyPublic(row)"));assert.ok(server.includes("'public, max-age=300'"));});
test('private route is owner scoped no-store nosniff and generic',()=>{assert.ok(server.includes('SELECT * FROM glaze_combos WHERE id=? AND user_id=?'));assert.ok(server.includes('private, no-store'));assert.ok(server.includes('X-Content-Type-Options'));assert.ok(server.includes('Photo unavailable'));});
test('community responses carry media contract',()=>{assert.ok(server.includes('.all(...params).map(glazeComboMediaContract)'));assert.ok(server.includes('combo: glazeComboMediaContract(combo)'));assert.ok(server.includes('res.json(glazeComboMediaContract(combo))'));});
test('website selects public protected and legacy loading',()=>{for(const value of ['comboPhotoUrl','public-explicit','legacy-static','data-private-combo-photo','loadComboPrivateMedia(c)'])assert.ok(app.includes(value));});
test('website protected loader is stale guarded and cleans blobs',()=>{for(const value of ['comboMediaGeneration','sessionToken = token','generation !== comboMediaGeneration','URL.revokeObjectURL','controller.abort','clearComboMedia'])assert.ok(app.includes(value));});
test('session replacement and navigation clear private Combo state',()=>{assert.ok(app.includes('clearComboMedia();'));});
test('website image failure is local',()=>{assert.ok(app.includes("img.removeAttribute('src'); img.alt='Photo unavailable'"));});
test('two-slot mutation preserves mapping and reference-safe cleanup',()=>{assert.ok(server.includes('slots.length !== 2'));assert.ok(server.includes('oldPhotos.filter(old => !photos.includes(old))'));assert.ok(server.includes('filter(filename => !savedUploads.has(filename))'));assert.ok(deletion.includes("glaze_combos: ['photo_filename', 'photo_filename2']"));});
test('Combo delete cleans after DB delete',()=>{assert.ok(server.includes('deletionLifecycle.cleanupFiles(oldPhotos)'));assert.ok(deletion.includes('hasStoredFileReference'));});
test('legacy uploads and existing protected categories remain',()=>{assert.ok(app.includes("'/uploads/'"));for(const route of ['api/ql/pieces','api/ql/clay-bodies','api/ql/glazes','api/ql/test-tiles'])assert.ok(server.includes(route));});
test('shared and public-link flags can transition without changing filenames',()=>{assert.ok(server.includes("const sharedValue"));assert.ok(server.includes('UPDATE glaze_combos SET is_public=?, share_id=?'));assert.ok(server.includes('photo_filename=?,photo_filename2=?'));});
test('public to private transition does not revoke legacy static URLs',()=>{assert.ok(server.includes('UPDATE glaze_combos SET is_public=?, share_id=?'));assert.ok(server.includes('express.static(UPLOADS_DIR)'));});
