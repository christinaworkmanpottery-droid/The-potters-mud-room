const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root,'server.js'),'utf8');
const calendar = fs.readFileSync(path.join(root,'calendar-export.js'),'utf8');
const deletion = fs.readFileSync(path.join(root,'deletion-lifecycle.cjs'),'utf8');

test('Event owner media has authenticated protected route', () => {
  assert.match(server, /\/api\/ql\/events\/:eventId\/photos\/:filename',/);
  assert.match(server, /SELECT image_filename AS filename FROM events WHERE id=\? AND user_id=\? AND image_filename=\?/);
  assert.match(server, /Cache-Control', 'private, no-store'/);
  assert.match(server, /X-Content-Type-Options', 'nosniff'/);
});
test('foreign missing and collision failures are generic and fail closed', () => {
  assert.match(server, /Photo unavailable/);
  assert.match(server, /ownedPhotoSlots\(photo\.filename, req\.userId\)/);
  assert.match(server, /rows\.some\(row => !owned\.some/);
});
test('Event API marks current images protected without inventing publication state', () => {
  assert.match(server, /photoDelivery = event\.image_filename \? 'owner-protected'/);
  assert.match(server, /photoVisibility = event\.image_filename \? 'legacy-ambiguous'/);
  assert.doesNotMatch(server, /event\.image_filename.*public/i);
});
test('anonymous subscription remains metadata-only', () => {
  assert.match(server, /\/api\/events\/subscribe\/:userId/);
  assert.doesNotMatch(calendar, /image_filename|\/uploads\//);
});
test('Event share and iCal do not emit protected or static image URLs', () => {
  assert.doesNotMatch(calendar, /ATTACH|IMAGE|\/api\/ql\/events|\/uploads\//);
});
test('replacement commits reference before old-file cleanup', () => {
  const p=server.indexOf("app.post('/api/events/:id/photo'");
  const q=server.indexOf("app.put('/api/events/:id'",p);
  const block=server.slice(p,q);
  assert.ok(block.indexOf("UPDATE events SET image_filename") < block.indexOf("cleanupFiles([ev.image_filename])"));
  assert.match(block, /discardNew\(\).*404/);
});
test('Event deletion cleans only after committed metadata removal', () => {
  const p=server.indexOf("app.delete('/api/events/:id'");
  const q=server.indexOf("// Events export",p);
  const block=server.slice(p,q);
  assert.match(block,/db\.transaction/);
  assert.ok(block.indexOf("DELETE FROM events") < block.indexOf("cleanupFiles"));
});
test('shared-file reference protection still includes Event images', () => {
  assert.match(deletion,/events: \['image_filename'\]/);
  assert.match(deletion,/hasStoredFileReference/);
});
test('global uploads remains unrestricted by Phase 2P', () => {
  assert.match(server,/app\.use\('\/uploads', express\.static\(UPLOADS_DIR\)\)/);
});
test('Event metadata update is owner scoped and missing-equivalent', () => {
  const p=server.indexOf("app.put('/api/events/:id'");
  const q=server.indexOf("app.delete('/api/events/:id'",p);
  const block=server.slice(p,q);
  assert.match(block,/WHERE id=\? AND user_id=\?/);
  assert.match(block,/!result\.changes.*404/);
});
