'use strict';
// Scheduled publication utilities. All persisted timestamps are UTC ISO 8601.
function parseScheduledAt(value, now = Date.now()) {
  if (typeof value !== 'string' || !/^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('Provide a date and time with a timezone offset');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time <= now) throw new Error('Scheduled time must be in the future');
  return new Date(time).toISOString();
}
function publishDueBlogPosts(db, onPublished, now = new Date()) {
  const due = db.prepare("SELECT id, title, slug FROM blog_posts WHERE is_published=0 AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 50").all(now.toISOString());
  const claim = db.prepare("UPDATE blog_posts SET is_published=1, published_at=?, scheduled_at=NULL, updated_at=datetime('now') WHERE id=? AND is_published=0 AND scheduled_at IS NOT NULL AND scheduled_at <= ?");
  let count = 0;
  for (const post of due) {
    const publishedAt = now.toISOString();
    if (claim.run(publishedAt, post.id, publishedAt).changes === 1) {
      count++;
      try { onPublished(post.id, post.title, post.slug); } catch (err) { console.error('[blog scheduler] notification error', err); }
    }
  }
  return count;
}
module.exports = { parseScheduledAt, publishDueBlogPosts };
