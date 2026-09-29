// Shared deletion compatibility for existing APIs. Does not activate QL migrations.
const fs = require('node:fs');
const path = require('node:path');

// Includes every stored-file slot in the baseline schema, including pricing.
// Keep conservative references (even orphan metadata) until explicitly repaired.
const fileSlots = Object.freeze({
  users: ['avatar_filename', 'profile_photo'],
  piece_photos: ['filename'], clay_photos: ['filename'], glaze_photos: ['filename'],
  firing_photos: ['filename'], project_photos: ['filename'], forum_photos: ['filename'],
  glaze_clay_tests: ['photo_filename'], pricing_calculations: ['photo_filename'],
  sales: ['image_filename'], events: ['image_filename'],
  glaze_combos: ['photo_filename', 'photo_filename2'],
  test_tiles: ['photo_filename', 'photo_filename2', 'photo_filename3'],
  merchant_products: ['image_filename', 'download_filename']
});

function hasStoredFileReference(db, filename) {
  for (const [table, slots] of Object.entries(fileSlots)) {
    // Historical databases can lack newer optional slots; never swallow SQL errors.
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const column of slots.filter(c => columns.has(c))) {
      if (db.prepare(`SELECT 1 FROM ${table} WHERE ${column}=? LIMIT 1`).get(filename)) return true;
    }
  }
  return false;
}

function assertIsolatedPieceReferences(db, userId, pieceId) {
  // Old writes allowed cross-owner IDs. Do not let SET NULL change foreign records.
  for (const table of ['firing_logs', 'sales']) {
    if (db.prepare(`SELECT 1 FROM ${table} WHERE piece_id=? AND user_id IS NOT ? LIMIT 1`).get(pieceId, userId)) {
      const error = new Error('Piece has inconsistent references; deletion requires review');
      error.status = 409;
      throw error;
    }
  }
}

function createDeletionLifecycle(db, uploadsDir, warn = console.warn) {
  function requireForeignKeys() {
    if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('Deletion requires foreign_keys=ON');
    if (db.inTransaction) throw new Error('Deletion must own its transaction for post-commit file cleanup');
  }

  function cleanupFiles(filenames) {
    if (db.inTransaction) throw new Error('File cleanup requires committed metadata');
    for (const filename of new Set(filenames)) {
      // Only flat upload files. Never follow symlinks or accept paths from old metadata.
      if (typeof filename !== 'string' || !filename || filename === '.' || filename === '..' || /[/\\\0]/.test(filename)) continue;
      try {
        // Serialize the final reference check with SQLite writers. File removal follows
        // the committed metadata deletion; a failure leaves an unused file, never a live broken ref.
        db.transaction(() => {
          if (hasStoredFileReference(db, filename)) return;
          const target = path.join(uploadsDir, filename);
          if (fs.lstatSync(target).isFile()) fs.unlinkSync(target);
        }).immediate();
      } catch (error) {
        if (error.code !== 'ENOENT') warn('[deletion] Retained unused upload; cleanup failed:', error.message);
      }
    }
  }

  function deletePiece(userId, pieceId) {
    requireForeignKeys();
    const result = db.transaction(() => {
      if (!db.prepare('SELECT 1 FROM pieces WHERE id=? AND user_id=?').get(pieceId, userId)) return { changes: 0, files: [] };
      assertIsolatedPieceReferences(db, userId, pieceId);
      const files = db.prepare('SELECT filename FROM piece_photos WHERE piece_id=?').all(pieceId).map(p => p.filename);
      // Firings are independent history, including the last association. Only detach.
      db.prepare('UPDATE firing_logs SET piece_id=NULL WHERE piece_id=? AND user_id=?').run(pieceId, userId);
      db.prepare('UPDATE sales SET piece_id=NULL WHERE piece_id=? AND user_id=?').run(pieceId, userId);
      db.prepare('DELETE FROM piece_photos WHERE piece_id=?').run(pieceId);
      db.prepare('DELETE FROM piece_glazes WHERE piece_id=?').run(pieceId);
      // Existing FKs remove only this Piece's QL junctions, when installed.
      const { changes } = db.prepare('DELETE FROM pieces WHERE id=? AND user_id=?').run(pieceId, userId);
      return { changes, files };
    }).immediate();
    cleanupFiles(result.files);
    return result.changes;
  }

  function deleteFiring(userId, firingId) {
    requireForeignKeys();
    const result = db.transaction(() => {
      if (!db.prepare('SELECT 1 FROM firing_logs WHERE id=? AND user_id=?').get(firingId, userId)) return { changes: 0, files: [] };
      const files = db.prepare('SELECT filename FROM firing_photos WHERE firing_id=?').all(firingId).map(p => p.filename);
      db.prepare('DELETE FROM firing_photos WHERE firing_id=?').run(firingId);
      const { changes } = db.prepare('DELETE FROM firing_logs WHERE id=? AND user_id=?').run(firingId, userId);
      return { changes, files };
    }).immediate();
    cleanupFiles(result.files);
    return result.changes;
  }

  function deletePhoto(userId, photoId, kind) {
    requireForeignKeys();
    const [table, parent, column] = kind === 'piece'
      ? ['piece_photos', 'pieces', 'piece_id']
      : kind === 'firing' ? ['firing_photos', 'firing_logs', 'firing_id'] : [];
    if (!table) throw new Error('Unsupported photo kind');
    const photo = db.transaction(() => {
      const row = db.prepare(`SELECT ph.filename FROM ${table} ph JOIN ${parent} p ON p.id=ph.${column}
        WHERE ph.id=? AND p.user_id=?`).get(photoId, userId);
      if (row) db.prepare(`DELETE FROM ${table} WHERE id=?`).run(photoId);
      return row;
    }).immediate();
    if (photo) cleanupFiles([photo.filename]);
    return !!photo;
  }

  function assertAccountPieceIsolation(userId) {
    for (const piece of db.prepare('SELECT id FROM pieces WHERE user_id=?').all(userId)) {
      assertIsolatedPieceReferences(db, userId, piece.id);
    }
  }

  return { deletePiece, deleteFiring, deletePhoto, cleanupFiles, assertAccountPieceIsolation };
}

module.exports = { createDeletionLifecycle, hasStoredFileReference, fileSlots };
