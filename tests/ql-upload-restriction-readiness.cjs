const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const server=fs.readFileSync('server.js','utf8');
const web=fs.readFileSync('public/app.js','utf8');
const schema=JSON.parse(fs.readFileSync('ql/schema.json','utf8'));
const inventory=fs.readFileSync('ql/PHASE2F-UPLOAD-CONSUMER-INVENTORY.md','utf8');
const migration=fs.readFileSync('ql/PHASE2F-UPLOAD-MIGRATION-PLAN.md','utf8');
const rollback=fs.readFileSync('ql/PHASE2F-UPLOAD-ROLLBACK.md','utf8');
const table=name=>schema.tables.find(t=>t.name===name);
const columns=name=>new Set((table(name)?.columns||[]).map(c=>c.name));

test('private Piece media remains protected and website honors explicit private visibility',()=>{
  assert.match(server,/app\.get\('\/api\/ql\/pieces\/:pieceId\/photos\/:photoId', auth/);
  assert.match(server,/privateOnly: true/);
  assert.match(web,/p\.photoVisibility === 'private'/);
  assert.match(server,/Cache-Control', 'private, no-store'/);
});
test('public and legacy-ambiguous Piece media remain anonymous compatibility paths',()=>{
  assert.match(server,/app\.use\('\/uploads', express\.static\(UPLOADS_DIR\)\)/);
  assert.match(server,/if \(piece && \(piece\.is_public === 1/);
  assert.match(server,/return 'legacy-ambiguous'/);
  assert.match(web,/privatePiecePhotos = p\.photoVisibility === 'private'/);
  assert.match(web,/src="\/uploads\/['"]? \+ ph\.filename|src="\/uploads\/.*ph\.filename/s);
});
test('Piece visibility semantics are metadata-based and do not infer from filenames',()=>{
  const start=server.indexOf('function classifyPiecePhotoVisibility');
  const end=server.indexOf('\n}',start)+2;
  const classifier=server.slice(start,end);
  assert.match(classifier,/is_public/);
  assert.doesNotMatch(classifier,/filename|uuid|extension/i);
});
test('at least one intentionally public community media surface remains public',()=>{
  assert.match(server,/SHAREABLE GLAZE COMBOS \(Public\)/);
  assert.match(server,/app\.get\('\/api\/combos\/public\/:shareId'/);
  assert.match(server,/gc\.is_public=1/);
  assert.match(web,/\/uploads\/['"]? \+ combo\.photo_filename|\/uploads\/.*combo\.photo_filename/s);
});
test('Clay remains account-owned with protected delivery and no invented publication metadata',()=>{
  assert.ok(columns('clay_bodies').has('user_id'));
  assert.ok(!columns('clay_bodies').has('is_public'));
  assert.ok(columns('clay_photos').has('filename'));
  assert.match(web,/api\/ql\/clay-bodies/);
  assert.match(web,/data-private-clay-photo/);
  assert.match(inventory,/Clay photos[\s\S]*private\/account-owned/);
});
test('other private studio media categories still lack explicit visibility fields',()=>{
  for(const name of ['test_tiles','pricing_calculations','sales','projects']){
    assert.ok(columns(name).has('user_id'),name+' owner linkage');
    assert.ok(!columns(name).has('is_public'),name+' has no publication flag');
  }
  for(const name of ['firing_photos','glaze_photos','project_photos']) assert.ok(columns(name).has('filename'));
});
test('Phase 2F leaves global uploads behavior unchanged',()=>{
  assert.match(server,/app\.use\('\/uploads', express\.static\(UPLOADS_DIR\)\)/);
  assert.doesNotMatch(server,/PHASE2F.*restrict|phase2f.*middleware/i);
});
test('Phase 2F documentation forbids automatic historical reclassification',()=>{
  assert.match(inventory,/No historical reclassification is performed in Phase 2F/);
  assert.match(inventory,/No filename shape, UUID entropy, or extension is used as visibility evidence/);
  assert.match(migration,/Never infer visibility from filename\/UUID/);
});
test('migration and rollback plans cover required readiness controls',()=>{
  for(const phrase of ['Old-client compatibility strategy','Historical\/ambiguous migration strategy','Cache invalidation','Backup\/restore prerequisites','Rollout ordering','Rollback criteria','Observability','Final restriction gate']) assert.match(migration,new RegExp(phrase,'i'));
  for(const phrase of ['Website','iOS','Android','Public\/community media','Legacy records','Existing direct links']) assert.match(rollback,new RegExp(phrase,'i'));
});
test('readiness conclusion and next slice are explicit',()=>{
  assert.match(inventory,/GLOBAL \`\/uploads\` IS NOT READY FOR RESTRICTION/);
  assert.match(inventory,/Phase 2G: protected delivery for Clay media only/);
});
