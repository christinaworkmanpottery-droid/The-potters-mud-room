'use strict';
// Query bytes are request-local only: no filename, filesystem write or delivery route.
const multer = require('multer');
const sharp = require('sharp');
const LIMITS = Object.freeze({ bytes: 12 * 1024 * 1024, pixels: 40e6, dimension: 12000, concurrent: 4, uploadMs: 30000 });
const types = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','image/heif']);
const formats = new Set(['jpeg','png','webp','gif','heif','avif']);
const storage = {
  _handleFile(req, file, cb) {
    let chunks = [], size = 0, done = false;
    const wipe = () => { for (const b of chunks) b.fill(0); chunks = []; };
    const finish = (err) => {
      if (done) return; done = true;
      req.removeListener('aborted', abort);
      if (err) { wipe(); return cb(err); }
      const buffer = Buffer.concat(chunks, size); wipe();
      cb(null, { buffer, size });
    };
    const abort = () => { finish(new Error('Upload interrupted')); file.stream.destroy(); };
    req.once('aborted', abort);
    file.stream.on('data', b => { if (!done) { chunks.push(b); size += b.length; } else b.fill(0); });
    file.stream.once('error', finish);
    file.stream.once('end', () => finish());
  },
  _removeFile(req, file, cb) { file.buffer?.fill(0); delete file.buffer; cb(null); }
};
function createPhotoQuerySafety(db) {
  const active = new Set();
  const exists = id => typeof id === 'string' && !!db.prepare('SELECT 1 FROM users WHERE id=?').get(id);
  function account(req, res, next) {
    res.set('Cache-Control', 'private, no-store');
    if (!exists(req.userId)) return res.status(401).json({ error: 'Account authentication required' });
    next();
  }
  const parse = multer({ storage, limits: { fileSize: LIMITS.bytes, files: 1, fields: 8, fieldSize: 1024, parts: 9 },
    fileFilter(req, file, cb) { cb(types.has(file.mimetype) ? null : Object.assign(new Error('Unsupported image type'), { status: 415 }), types.has(file.mimetype)); }
  }).single('photo');
  function upload(req, res, next) {
    if (active.has(req.userId) || active.size >= LIMITS.concurrent) return res.status(429).json({ error: 'Photo search busy. Please try again.' });
    active.add(req.userId);
    let processing = false, released = false;
    const release = () => {
      // Multer can finish after a socket closes: always wipe even on repeated cleanup.
      req.file?.buffer?.fill(0);
      if (req.file) delete req.file.buffer;
      if (!released) { released = true; active.delete(req.userId); }
    };
    req.releasePhotoQuery = release;
    const closed = () => { if (!processing) release(); };
    res.once('close', closed);
    const timer = setTimeout(() => req.destroy(), LIMITS.uploadMs); timer.unref();
    parse(req, res, async err => {
      clearTimeout(timer);
      if (req.aborted || res.destroyed) { release(); return; }
      processing = true;
      try {
        if (err) throw err;
        if (!req.file?.buffer?.length) throw Object.assign(new Error('No photo provided'), { status: 400 });
        const image = sharp(req.file.buffer, { limitInputPixels: LIMITS.pixels, failOn: 'warning' });
        const meta = await image.metadata();
        if (!formats.has(meta.format)) throw Object.assign(new Error('Unsupported image type'), { status: 415 });
        if (!meta.width || !meta.height || meta.width > LIMITS.dimension || meta.height > LIMITS.dimension || meta.width * meta.height > LIMITS.pixels || (meta.pages || 1) > 1) throw Object.assign(new Error('Image dimensions or frame count exceed limits'), { status: 413 });
        // Force decoding before the legacy extractors (which can swallow decode errors).
        await image.resize(1, 1, { kernel: 'nearest' }).raw().toBuffer();
        if (req.aborted || res.destroyed) { release(); return; }
        if (!exists(req.userId)) throw Object.assign(new Error('Account authentication required'), { status: 401 });
        next();
      } catch (e) {
        release();
        if (!res.destroyed) res.status(e.status || (e.code === 'LIMIT_FILE_SIZE' || /pixel limit/i.test(e.message) ? 413 : 400)).json({ error: e.status ? e.message : 'Invalid or oversized photo upload' });
      }
    });
  }
  return { account, upload, exists };
}
module.exports = { createPhotoQuerySafety, LIMITS };
