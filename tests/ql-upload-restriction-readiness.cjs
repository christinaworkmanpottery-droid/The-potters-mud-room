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
  assert.match(web,/pieceEdgePhotoAttrs/);
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
  assert.match(web,/publicImage/);
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

const closure=fs.readFileSync('ql/PHASE2T-UPLOAD-RESTRICTION-CLOSURE.md','utf8');
test('Phase 2T keeps anonymous uploads unchanged while recording current-source blockers',()=>{
  assert.match(server,/app\.use\('\/uploads', express\.static\(UPLOADS_DIR\)\)/);
  assert.match(closure,/GLOBAL \/uploads IS NOT READY FOR RESTRICTION/);
  assert.match(closure,/PHASE 2 IS NOT READY TO CLOSE/);
  assert.match(closure,/Website Piece cards\/dashboard\/list/);
  assert.match(closure,/Website Photo Lookup thumbnails/);
});
test('Phase 2T records protected and explicit-public contracts without auto-classifying history',()=>{
  for(const phrase of ['Clay','Glaze library','Glaze\/Clay Tests','Test Tiles','Firings','Pricing','Sales','Projects','Events','Profile\/avatar','Forum images\/videos','Shop'])
    assert.match(closure,new RegExp(phrase));
  assert.match(closure,/Never infer visibility from filename, UUID shape, extension, age or directory location/);
  assert.match(closure,/Shop paid originals remain exact-purchase protected/);
  assert.match(closure,/Forum media remains authenticated/);
  assert.match(closure,/Find a Potter\/public avatar rules and Calendar\/iCal regressions pass/);
});
test('Phase 2T public-media closure gaps and exact 2U slice are explicit',()=>{
  assert.match(closure,/Public Piece Gallery: NOT YET COMPLETE/);
  assert.match(closure,/public Glaze Combo page and Pinterest media URL/);
  assert.match(closure,/Phase 2U — Piece\/public-edge media closure/);
  assert.match(closure,/Do not restrict global \/uploads/);
});
