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

  const studioKinds = {
    clay: { table: 'clay_bodies', photos: 'clay_photos', parent: 'clay_id' },
    glaze: { table: 'glazes', photos: 'glaze_photos', parent: 'glaze_id' },
    testTile: { table: 'test_tiles' }
  };

  function conflict() {
    const error = new Error('Studio record has inconsistent or unsupported references; deletion requires review');
    error.status = 409;
    throw error;
  }

  function assertStudioIsolation(userId, id, kind) {
    const check = (sql, ...args) => { if (db.prepare(sql).get(...args)) conflict(); };
    const endpoint = (table, targetId) => {
      if (targetId != null) check(`SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE id=? AND user_id=?)`, targetId, userId);
    };
    if (kind === 'clay') {
      for (const table of ['pieces', 'test_tiles']) {
        check(`SELECT 1 FROM ${table} WHERE clay_body_id=? AND user_id IS NOT ?`, id, userId);
      }
      check(`SELECT 1 FROM glaze_clay_tests t LEFT JOIN glazes g ON g.id=t.glaze_id
        WHERE t.clay_body_id=? AND g.user_id IS NOT ?`, id, userId);
    }
    if (kind === 'glaze') {
      check(`SELECT 1 FROM piece_glazes l LEFT JOIN pieces p ON p.id=l.piece_id
        WHERE l.glaze_id=? AND p.user_id IS NOT ?`, id, userId);
      check('SELECT 1 FROM test_tiles WHERE glaze_id=? AND user_id IS NOT ?', id, userId);
      for (const row of db.prepare('SELECT clay_body_id FROM glaze_clay_tests WHERE glaze_id=?').all(id)) endpoint('clay_bodies', row.clay_body_id);
      // Very old schemas cannot detach a glaze layer. Reject instead of losing its history.
      const columns = db.pragma('table_info(piece_glazes)');
      if (columns.find(c => c.name === 'glaze_id')?.notnull || !columns.some(c => c.name === 'custom_name')) {
        check('SELECT 1 FROM piece_glazes WHERE glaze_id=?', id);
      }
    }
    if (kind === 'testTile') {
      const tile = db.prepare('SELECT * FROM test_tiles WHERE id=?').get(id);
      endpoint('clay_bodies', tile.clay_body_id);
      endpoint('glazes', tile.glaze_id);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ql_piece_test_tiles'").get()) {
        check(`SELECT 1 FROM ql_piece_test_tiles l LEFT JOIN pieces p ON p.id=l.piece_id
          WHERE l.test_tile_id=? AND (l.user_id IS NOT ? OR p.user_id IS NOT ?)`, id, userId, userId);
      }
    }
  }

  function deleteStudioRecord(userId, id, kind) {
    requireForeignKeys();
    const config = studioKinds[kind];
    if (!config) throw new Error('Unsupported studio kind');
    const result = db.transaction(() => {
      const row = db.prepare(`SELECT * FROM ${config.table} WHERE id=? AND user_id=?`).get(id, userId);
      if (!row) return { changes: 0, files: [] };
      assertStudioIsolation(userId, id, kind);
      const files = config.photos
        ? db.prepare(`SELECT filename FROM ${config.photos} WHERE ${config.parent}=?`).all(id).map(p => p.filename)
        : [row.photo_filename, row.photo_filename2, row.photo_filename3];
      if (kind === 'clay') {
        db.prepare('UPDATE pieces SET clay_body_id=NULL WHERE clay_body_id=? AND user_id=?').run(id, userId);
        db.prepare("UPDATE test_tiles SET clay_name=COALESCE(NULLIF(clay_name,''),?), clay_body_id=NULL WHERE clay_body_id=? AND user_id=?").run(row.name, id, userId);
        db.prepare('UPDATE glaze_clay_tests SET clay_body_id=NULL WHERE clay_body_id=?').run(id);
      }
      if (kind === 'glaze') {
        // Preserve application/coats/order/notes as an existing manual glaze layer.
        if (db.prepare('SELECT 1 FROM piece_glazes WHERE glaze_id=?').get(id)) {
          db.prepare("UPDATE piece_glazes SET custom_name=COALESCE(NULLIF(custom_name,''),?), glaze_id=NULL WHERE glaze_id=?").run(row.name, id);
        }
        db.prepare("UPDATE test_tiles SET glaze_name=COALESCE(NULLIF(glaze_name,''),?), glaze_id=NULL WHERE glaze_id=? AND user_id=?").run(row.name, id, userId);
        files.push(...db.prepare('SELECT photo_filename FROM glaze_clay_tests WHERE glaze_id=?').all(id).map(t => t.photo_filename));
        // Recipe ingredients and embedded clay tests belong exclusively to this glaze.
        db.prepare('DELETE FROM glaze_clay_tests WHERE glaze_id=?').run(id);
        db.prepare('DELETE FROM glaze_ingredients WHERE glaze_id=?').run(id);
      }
      if (config.photos) db.prepare(`DELETE FROM ${config.photos} WHERE ${config.parent}=?`).run(id);
      // Tile FKs remove only its QL junctions, never their Piece endpoints.
      const { changes } = db.prepare(`DELETE FROM ${config.table} WHERE id=? AND user_id=?`).run(id, userId);
      return { changes, files };
    }).immediate();
    cleanupFiles(result.files);
    return result.changes;
  }

  function deleteClayTest(userId, glazeId, testId) {
    requireForeignKeys();
    const row = db.transaction(() => {
      const test = db.prepare(`SELECT t.* FROM glaze_clay_tests t JOIN glazes g ON g.id=t.glaze_id
        WHERE t.id=? AND t.glaze_id=? AND g.user_id=?`).get(testId, glazeId, userId);
      if (!test) return null;
      if (test.clay_body_id != null && !db.prepare('SELECT 1 FROM clay_bodies WHERE id=? AND user_id=?').get(test.clay_body_id, userId)) conflict();
      db.prepare('DELETE FROM glaze_clay_tests WHERE id=? AND glaze_id=?').run(testId, glazeId);
      return test;
    }).immediate();
    if (row) cleanupFiles([row.photo_filename]);
    return !!row;
  }

  function deletePhoto(userId, photoId, kind) {
    requireForeignKeys();
    const [table, parent, column] = kind === 'piece'
      ? ['piece_photos', 'pieces', 'piece_id']
      : kind === 'firing' ? ['firing_photos', 'firing_logs', 'firing_id']
      : kind === 'clay' ? ['clay_photos', 'clay_bodies', 'clay_id']
      : kind === 'glaze' ? ['glaze_photos', 'glazes', 'glaze_id'] : [];
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

  function accountConflict() {
    const error = new Error('Account has inconsistent relationships; deletion requires review');
    error.status = 409;
    throw error;
  }

  function preflightAccountDeletion(userId) {
    requireForeignKeys();
    const bad = (sql, ...args) => { if (db.prepare(sql).get(...args)) accountConflict(); };
    assertAccountPieceIsolation(userId);

    bad(`SELECT 1 FROM pieces p WHERE p.user_id=? AND p.clay_body_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM clay_bodies c WHERE c.id=p.clay_body_id AND c.user_id=?) LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM piece_glazes pg JOIN pieces p ON p.id=pg.piece_id
      WHERE p.user_id=? AND pg.glaze_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM glazes g WHERE g.id=pg.glaze_id AND g.user_id=?) LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM test_tiles t WHERE t.user_id=? AND t.clay_body_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM clay_bodies c WHERE c.id=t.clay_body_id AND c.user_id=?) LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM test_tiles t WHERE t.user_id=? AND t.glaze_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM glazes g WHERE g.id=t.glaze_id AND g.user_id=?) LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM firing_logs f WHERE f.user_id=? AND f.piece_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pieces p WHERE p.id=f.piece_id AND p.user_id=?) LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM sales s WHERE s.user_id=? AND s.piece_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM pieces p WHERE p.id=s.piece_id AND p.user_id=?) LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM glaze_clay_tests t JOIN glazes g ON g.id=t.glaze_id
      WHERE g.user_id=? AND t.clay_body_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM clay_bodies c WHERE c.id=t.clay_body_id AND c.user_id=?) LIMIT 1`, userId, userId);

    bad(`SELECT 1 FROM pieces p JOIN clay_bodies c ON c.id=p.clay_body_id WHERE c.user_id=? AND p.user_id<>? LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM piece_glazes pg JOIN pieces p ON p.id=pg.piece_id JOIN glazes g ON g.id=pg.glaze_id
      WHERE g.user_id=? AND p.user_id<>? LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM test_tiles t JOIN clay_bodies c ON c.id=t.clay_body_id WHERE c.user_id=? AND t.user_id<>? LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM test_tiles t JOIN glazes g ON g.id=t.glaze_id WHERE g.user_id=? AND t.user_id<>? LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM firing_logs f JOIN pieces p ON p.id=f.piece_id WHERE p.user_id=? AND f.user_id<>? LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM sales s JOIN pieces p ON p.id=s.piece_id WHERE p.user_id=? AND s.user_id<>? LIMIT 1`, userId, userId);
    bad(`SELECT 1 FROM glaze_clay_tests t JOIN glazes g ON g.id=t.glaze_id JOIN clay_bodies c ON c.id=t.clay_body_id
      WHERE c.user_id=? AND g.user_id<>? LIMIT 1`, userId, userId);

    for (const [table, target, column] of [
      ['ql_piece_firings', 'firing_logs', 'firing_id'],
      ['ql_piece_test_tiles', 'test_tiles', 'test_tile_id'],
      ['ql_piece_pricing', 'pricing_calculations', 'pricing_id']
    ]) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
      bad(`SELECT 1 FROM ${table} l LEFT JOIN pieces p ON p.id=l.piece_id LEFT JOIN ${target} t ON t.id=l.${column}
        WHERE (l.user_id=? OR p.user_id=? OR t.user_id=?)
          AND (p.id IS NULL OR t.id IS NULL OR p.user_id<>l.user_id OR t.user_id<>l.user_id) LIMIT 1`,
        userId, userId, userId);
    }

    const files = [];
    const add = (sql, ...args) => {
      for (const row of db.prepare(sql).all(...args)) for (const value of Object.values(row)) if (value) files.push(value);
    };
    add('SELECT avatar_filename,profile_photo FROM users WHERE id=?', userId);
    add('SELECT ph.filename FROM piece_photos ph JOIN pieces p ON p.id=ph.piece_id WHERE p.user_id=?', userId);
    add('SELECT ph.filename FROM clay_photos ph JOIN clay_bodies c ON c.id=ph.clay_id WHERE c.user_id=?', userId);
    add('SELECT ph.filename FROM glaze_photos ph JOIN glazes g ON g.id=ph.glaze_id WHERE g.user_id=?', userId);
    add('SELECT ph.filename FROM firing_photos ph JOIN firing_logs f ON f.id=ph.firing_id WHERE f.user_id=?', userId);
    add('SELECT t.photo_filename FROM glaze_clay_tests t JOIN glazes g ON g.id=t.glaze_id WHERE g.user_id=?', userId);
    add('SELECT photo_filename,photo_filename2,photo_filename3 FROM test_tiles WHERE user_id=?', userId);
    add('SELECT photo_filename FROM pricing_calculations WHERE user_id=?', userId);
    add('SELECT image_filename FROM sales WHERE user_id=?', userId);
    return files;
  }

  return { deletePiece, deleteFiring, deletePhoto, deleteStudioRecord, deleteClayTest, cleanupFiles, assertAccountPieceIsolation, preflightAccountDeletion };
}

module.exports = { createDeletionLifecycle, hasStoredFileReference, fileSlots };
