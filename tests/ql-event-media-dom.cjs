const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const app = fs.readFileSync(path.resolve(__dirname,'../public/app.js'),'utf8');

test('website Event cards use contract-aware image markup',()=>assert.match(app,/eventImageMarkup\(e, 'photo-thumb'/));
test('website Event detail uses contract-aware image markup',()=>assert.match(app,/eventImageMarkup\(e, 'detail-photo'/));
test('private Event images use authenticated blob loading',()=>{
  assert.match(app,/\/api\/ql\/events\/.*\/photos\//);
  assert.match(app,/Authorization: 'Bearer ' \+ token/);
  assert.match(app,/URL\.createObjectURL/);
});
test('website Event media has abort stale and cleanup guards',()=>{
  assert.match(app,/controller\.abort\(\)/);
  assert.match(app,/eventMediaGeneration/);
  assert.match(app,/URL\.revokeObjectURL/);
});
test('website clears Event media on logout session replacement and navigation',()=>{
  const matches=app.match(/clearEventMedia\(\)/g)||[];
  assert.ok(matches.length>=5);
});
test('legacy Event image loading remains static-compatible',()=>assert.match(app,/eventMediaVisibility\(event\) !== 'private'.*\/uploads\//s));
test('private failures do not silently fall back to static uploads',()=>{
  const p=app.indexOf('async function hydrateEventMedia');
  const q=app.indexOf('// ============ EVENTS',p);
  assert.doesNotMatch(app.slice(p,q),/\/uploads\//);
});
test('failed Event image stays local to its element',()=>assert.match(app,/onerror="this\.style\.display='none'"/));
