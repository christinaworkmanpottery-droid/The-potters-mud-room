// Phase 1A: explicitly invoked on a disposable database, never on app startup.
// SQL identifiers below are internal constants, never request-supplied names.
const { randomUUID, createHash } = require('node:crypto');

const links = Object.freeze({
  firing: { table: 'ql_piece_firings', target: 'firing_logs', column: 'firing_id' },
  testTile: { table: 'ql_piece_test_tiles', target: 'test_tiles', column: 'test_tile_id' },
  pricing: { table: 'ql_piece_pricing', target: 'pricing_calculations', column: 'pricing_id' }
});
const migrationId = '001-piece-relationships';
const sql = Object.values(links).map(({ table, target, column }) => `
  CREATE TABLE ${table} (
    id TEXT PRIMARY KEY NOT NULL CHECK(length(id) > 0),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    piece_id TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
    ${column} TEXT NOT NULL REFERENCES ${target}(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, piece_id, ${column})
  );
  CREATE INDEX ${table}_target ON ${table}(${column});
  CREATE INDEX ${table}_piece ON ${table}(piece_id);
  ${['INSERT', 'UPDATE'].map(event => `
    CREATE TRIGGER ${table}_${event.toLowerCase()} BEFORE ${event} ON ${table}
    WHEN NOT EXISTS (SELECT 1 FROM pieces WHERE id=NEW.piece_id AND user_id=NEW.user_id)
      OR NOT EXISTS (SELECT 1 FROM ${target} WHERE id=NEW.${column} AND user_id=NEW.user_id)
    BEGIN SELECT RAISE(ABORT, 'QL relationship requires same-owner endpoints'); END;
  `).join('')}
  CREATE TRIGGER ${table}_piece_owner BEFORE UPDATE OF user_id ON pieces
    WHEN NEW.user_id IS NOT OLD.user_id AND EXISTS (SELECT 1 FROM ${table} WHERE piece_id=OLD.id)
    BEGIN SELECT RAISE(ABORT, 'QL linked Piece ownership cannot change'); END;
  CREATE TRIGGER ${table}_target_owner BEFORE UPDATE OF user_id ON ${target}
    WHEN NEW.user_id IS NOT OLD.user_id AND EXISTS (SELECT 1 FROM ${table} WHERE ${column}=OLD.id)
    BEGIN SELECT RAISE(ABORT, 'QL linked record ownership cannot change'); END;
`).join('\n');
const checksum = createHash('sha256').update(sql).digest('hex');

function manifest(db) {
  const prefixes = Object.values(links).map(x => x.table);
  return JSON.stringify(db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name GLOB 'ql_*' ORDER BY type,name`).all().filter(row =>
    row.name === 'ql_migrations' || prefixes.some(prefix => row.name === prefix || row.name.startsWith(prefix + '_'))));
}

function migrate(db) {
  if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('QL requires foreign_keys=ON');
  // Preflight only minimal endpoint columns: no dependency on modern optional fields.
  for (const table of ['users', 'pieces', ...Object.values(links).map(x => x.target)]) {
    const columns = db.pragma(`table_info(${table})`).map(x => x.name);
    for (const column of table === 'users' ? ['id'] : ['id', 'user_id']) {
      if (!columns.includes(column)) throw new Error(`QL prerequisite missing: ${table}.${column}`);
    }
  }
  return db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS ql_migrations (
      id TEXT PRIMARY KEY NOT NULL, checksum TEXT NOT NULL,
      schema_manifest TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const applied = db.prepare('SELECT * FROM ql_migrations WHERE id=?').get(migrationId);
    if (applied) {
      if (applied.checksum !== checksum || applied.schema_manifest !== manifest(db)) {
        throw new Error('QL migration/schema drift; refusing to repair implicitly');
      }
      return { applied: false, migrationId };
    }
    db.exec(sql);
    db.prepare('INSERT INTO ql_migrations(id,checksum,schema_manifest) VALUES(?,?,?)')
      .run(migrationId, checksum, manifest(db));
    return { applied: true, migrationId };
  }).immediate();
}

function kindConfig(kind) {
  if (!Object.hasOwn(links, kind)) throw new Error('Unsupported QL relationship');
  return links[kind];
}

function requireOwned(db, table, userId, id) {
  if (typeof userId !== 'string' || !userId || typeof id !== 'string' || !id ||
      !db.prepare(`SELECT 1 FROM ${table} WHERE id=? AND user_id=?`).get(id, userId)) {
    // Same response for absent and another account's records.
    const error = new Error('Record unavailable');
    error.code = 'QL_RECORD_UNAVAILABLE';
    error.status = 404;
    throw error;
  }
}

function link(db, { userId, pieceId, kind, targetId }) {
  const { table, target, column } = kindConfig(kind);
  return db.transaction(() => {
    requireOwned(db, 'pieces', userId, pieceId);
    requireOwned(db, target, userId, targetId);
    db.prepare(`INSERT INTO ${table}(id,user_id,piece_id,${column}) VALUES(?,?,?,?)
      ON CONFLICT(user_id,piece_id,${column}) DO NOTHING`).run(randomUUID(), userId, pieceId, targetId);
    return db.prepare(`SELECT * FROM ${table} WHERE user_id=? AND piece_id=? AND ${column}=?`)
      .get(userId, pieceId, targetId);
  }).immediate();
}

function unlink(db, { userId, pieceId, kind, targetId }) {
  const { table, target, column } = kindConfig(kind);
  return db.transaction(() => {
    requireOwned(db, 'pieces', userId, pieceId);
    requireOwned(db, target, userId, targetId);
    const explicit = db.prepare(`DELETE FROM ${table} WHERE user_id=? AND piece_id=? AND ${column}=?`)
      .run(userId, pieceId, targetId).changes;
    // Remove the association, not merely one storage representation. Never delete history.
    const legacy = kind === 'firing' ? db.prepare(`UPDATE firing_logs SET piece_id=NULL
      WHERE id=? AND user_id=? AND piece_id=?`).run(targetId, userId, pieceId).changes : 0;
    return Number(explicit > 0 || legacy > 0);
  }).immediate();
}

// Phase 1F compatibility contract (also see RELATIONSHIPS.md):
// A firing may belong to multiple Pieces. piece_id is an optional legacy selection,
// NOT an exclusive owner or a mirror of the full QL set. Effective links are the
// same-owner union. Different legacy/QL Pieces are valid additional associations.
// QL create adds only its pair; QL remove clears both forms of only its pair.
// A legacy selection replacement removes its old QL pair and adds the new pair;
// all other QL pairs survive. Reads never backfill or repair historical data.
// The trusted persistence callback writes non-relationship fields only. Keeping it
// inside this transaction makes record creation/edit and pair synchronization atomic.
function writeLegacyFiring(db, { userId, firingId, pieceId, create = false }, persist) {
  return db.transaction(() => {
    if (!create) requireOwned(db, 'firing_logs', userId, firingId);
    const next = pieceId || null; // Preserve the existing full-replacement PUT contract.
    if (next !== null) {
      try { requireOwned(db, 'pieces', userId, next); }
      catch (error) {
        if (error.code !== 'QL_RECORD_UNAVAILABLE') throw error;
        // Existing legacy API validation contract; foreign and absent are identical.
        error.status = 400;
        error.message = 'Related record unavailable';
        throw error;
      }
    }
    const previous = create ? null : db.prepare('SELECT piece_id FROM firing_logs WHERE id=? AND user_id=?')
      .get(firingId, userId).piece_id;
    persist();
    requireOwned(db, 'firing_logs', userId, firingId);
    db.prepare('UPDATE firing_logs SET piece_id=? WHERE id=? AND user_id=?').run(next, firingId, userId);
    if (relationshipTablesInstalled(db)) {
      // Narrow repair: only the selected old/new pair, even if old metadata is stale.
      if (previous !== null && previous !== next) {
        db.prepare('DELETE FROM ql_piece_firings WHERE user_id=? AND piece_id=? AND firing_id=?')
          .run(userId, previous, firingId);
      }
      if (next !== null) link(db, { userId, pieceId: next, kind: 'firing', targetId: firingId });
    }
  }).immediate();
}

function firingRelationships(db, userId, pieceId) {
  requireOwned(db, 'pieces', userId, pieceId);
  const legacy = db.prepare('SELECT * FROM firing_logs WHERE piece_id=? AND user_id=? ORDER BY id').all(pieceId, userId);
  return [...new Map([...legacy, ...related(db, userId, pieceId, 'firing')].map(row => [row.id, row])).values()]
    .sort((a, b) => a.id.localeCompare(b.id));
}

function related(db, userId, pieceId, kind) {
  const { table, target, column } = kindConfig(kind);
  const installed = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!installed) return []; // Legacy database: no startup migration required.
  return db.prepare(`SELECT t.* FROM ${target} t JOIN ${table} l ON l.${column}=t.id
    JOIN pieces p ON p.id=l.piece_id AND p.user_id=l.user_id
    WHERE l.user_id=? AND l.piece_id=? AND t.user_id=l.user_id ORDER BY t.id`).all(userId, pieceId);
}

// Internal read model, NOT an HTTP endpoint or an old-client response replacement.
// userId must eventually come from authenticated server context, never request body.
function readPiece(db, userId, pieceId) {
  return db.transaction(() => {
    requireOwned(db, 'pieces', userId, pieceId);
    const piece = db.prepare('SELECT * FROM pieces WHERE id=? AND user_id=?').get(pieceId, userId);
    const clay = db.prepare('SELECT * FROM clay_bodies WHERE id=? AND user_id=?').get(piece.clay_body_id, userId) || null;
    const glazes = db.prepare(`SELECT pg.* FROM piece_glazes pg LEFT JOIN glazes g ON g.id=pg.glaze_id
      WHERE pg.piece_id=? AND (pg.glaze_id IS NULL OR g.user_id=?) ORDER BY pg.layer_order,pg.id`).all(pieceId, userId);
    const firings = firingRelationships(db, userId, pieceId);
    return {
      piece, clay, glazes,
      photos: db.prepare('SELECT * FROM piece_photos WHERE piece_id=? ORDER BY sort_order,id').all(pieceId),
      firings,
      testTiles: related(db, userId, pieceId, 'testTile'),
      pricing: related(db, userId, pieceId, 'pricing'),
      sales: db.prepare('SELECT * FROM sales WHERE piece_id=? AND user_id=? ORDER BY id').all(pieceId, userId).map(sale =>
        sale.contact_id && !db.prepare('SELECT 1 FROM contacts WHERE id=? AND user_id=?').get(sale.contact_id, userId)
          ? { ...sale, contact_id: null } : sale)
    };
  })();
}

function relationshipTablesInstalled(db) {
  return Object.values(links).every(({ table }) =>
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function serviceUnavailable() {
  const error = new Error('QL relationships unavailable');
  error.code = 'QL_RELATIONSHIPS_UNAVAILABLE';
  error.status = 409;
  return error;
}

function createRelationshipService(db) {
  function ensureInstalled() {
    if (!relationshipTablesInstalled(db)) throw serviceUnavailable();
  }
  return Object.freeze({
    writeLegacyFiring(args, persist) { return writeLegacyFiring(db, args, persist); },
    create({ userId, pieceId, kind, targetId }) {
      ensureInstalled();
      return link(db, { userId, pieceId, kind, targetId });
    },
    remove({ userId, pieceId, kind, targetId }) {
      ensureInstalled();
      return unlink(db, { userId, pieceId, kind, targetId });
    },
    list({ userId, pieceId, kind }) {
      requireOwned(db, 'pieces', userId, pieceId);
      if (kind === 'firing') return firingRelationships(db, userId, pieceId);
      return related(db, userId, pieceId, kind);
    }
  });
}

// Read-only audit metadata; no new migration or runtime activation.
const auditMigrationContract = Object.freeze({ migrationId, checksum, readManifest: manifest });
module.exports = { migrate, link, unlink, readPiece, createRelationshipService, auditMigrationContract };
