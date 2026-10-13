const assert = require('node:assert/strict');
const { parseScheduledAt, publishDueBlogPosts } = require('../lib/blog-scheduler');
const now = Date.parse('2026-10-13T12:00:00Z');
assert.equal(parseScheduledAt('2026-10-14T10:00:00-07:00', now), '2026-10-14T17:00:00.000Z');
assert.throws(() => parseScheduledAt('2026-10-14T10:00:00', now), /timezone/);
assert.throws(() => parseScheduledAt('2026-10-12T10:00:00Z', now), /future/);
let changes = 1, notified = [];
const db = { prepare(sql) {
  if (sql.startsWith('SELECT')) return { all: () => [{id:'a', title:'A', slug:'a'}] };
  return { run: () => ({ changes: changes-- }) };
}};
assert.equal(publishDueBlogPosts(db, (...args) => notified.push(args), new Date('2026-10-14T17:00:00Z')), 1);
assert.deepEqual(notified, [['a','A','a']]);
assert.equal(publishDueBlogPosts(db, () => { throw Error('duplicate'); }, new Date('2026-10-14T17:00:00Z')), 0);
console.log('blog scheduling tests passed');
