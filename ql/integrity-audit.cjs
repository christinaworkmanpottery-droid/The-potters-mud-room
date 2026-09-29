// Operator-only, read-only inspection. No database.js import, startup hook, repair,
// migration invocation, or implicit filesystem access. Call on a readonly SQLite handle.
const { createHash } = require('node:crypto');
const { fileSlots, createDeletionLifecycle } = require('../deletion-lifecycle.cjs');
const { auditMigrationContract } = require('./relationships.cjs');
const qlLinks = [
  ['ql_piece_firings', 'firing_logs', 'firing_id'],
  ['ql_piece_test_tiles', 'test_tiles', 'test_tile_id'],
  ['ql_piece_pricing', 'pricing_calculations', 'pricing_id']
];
const parents = {
  piece_glazes: ['pieces', 'piece_id'], piece_photos: ['pieces', 'piece_id'],
  clay_photos: ['clay_bodies', 'clay_id'], glaze_photos: ['glazes', 'glaze_id'],
  firing_photos: ['firing_logs', 'firing_id'], glaze_clay_tests: ['glazes', 'glaze_id'],
  glaze_ingredients: ['glazes', 'glaze_id'], project_photos: ['projects', 'project_id']
};
const edges = [
  ['pieces', 'clay_body_id', 'clay_bodies'],
  ['firing_logs', 'piece_id', 'pieces'], ['sales', 'piece_id', 'pieces'],
  ['sales', 'contact_id', 'contacts'],
  ['piece_glazes', 'glaze_id', 'glazes'],
  ['test_tiles', 'clay_body_id', 'clay_bodies'], ['test_tiles', 'glaze_id', 'glazes'],
  ['glaze_clay_tests', 'clay_body_id', 'clay_bodies']
];
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const token = value => createHash('sha256').update(String(value)).digest('hex');

function auditRelationships(db, { fileInventory } = {}) {
  // A deferred read transaction gives all SELECTs one SQLite snapshot. There are no
  // write statements, even when the caller supplied a writable test connection.
  return db.transaction(() => {
    const issues = [];
    const add = (type, table, id, detail = {}) => issues.push({ type, table, id: id ?? null, ...detail });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    const columns = new Map(); const data = new Map(); const indexes = new Map();
    const cols = table => {
      if (!columns.has(table)) columns.set(table, new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name)));
      return columns.get(table);
    };
    // Identifiers only originate in the fixed registry above/below.
    const rows = table => {
      if (!data.has(table)) data.set(table, tables.has(table) ? db.prepare(`SELECT * FROM "${table}"`).all() : []);
      return data.get(table);
    };
    const lookup = (table, id) => {
      if (!indexes.has(table)) indexes.set(table, new Map(rows(table).map(r => [r.id, r])));
      return indexes.get(table).get(id);
    };
    const owner = (table, row) => {
      if (!row) return null;
      if (table === 'users') return row.id;
      if (parents[table]) {
        const [parent, column] = parents[table]; return owner(parent, lookup(parent, row[column]));
      }
      if (table === 'forum_photos') {
        const p = row.reply_id != null ? lookup('forum_replies', row.reply_id) : lookup('forum_posts', row.post_id);
        return p?.user_id ?? null;
      }
      return row.user_id ?? null;
    };
    const scope = new Set(['users', 'glaze_chemicals', ...Object.keys(parents),
      ...Object.values(parents).map(p => p[0]), ...edges.flatMap(e => [e[0], e[2]]),
      ...qlLinks.flatMap(([table, target]) => [table, target]), ...Object.keys(fileSlots), 'forum_posts', 'forum_replies']);
    for (const table of scope) {
      if (table.startsWith('ql_')) continue;
      if (!tables.has(table)) add('schema_unavailable', table, null);
      else if (!cols(table).has('id')) add('schema_unavailable', table, null, { column: 'id' });
    }
    for (const table of scope) for (const row of rows(table)) {
      const id = owner(table, row);
      if (cols(table).has('user_id') && (!id || !lookup('users', id)))
        add('invalid_ownership_chain', table, row.id, { column: 'user_id' });
      if (parents[table]) {
        const [parent, column] = parents[table]; const p = lookup(parent, row[column]);
        if (!p) {
          add('orphaned_relationship_row', table, row.id, { column, target: { table: parent, id: row[column] ?? null } });
          add('invalid_ownership_chain', table, row.id, { column });
        } else if (!id || !lookup('users', id)) add('invalid_ownership_chain', table, row.id, { column });
      }
    }
    for (const [table, column, target] of edges) {
      if (tables.has(table) && !cols(table).has(column)) { add('schema_unavailable', table, null, { column }); continue; }
      for (const row of rows(table)) {
        if (row[column] == null) continue; // Manual/free-text records are valid.
        const endpoint = lookup(target, row[column]);
        const detail = { column, target: { table: target, id: row[column] } };
        if (!endpoint) {
          add('missing_record', table, row.id, detail); add('stale_legacy_relationship', table, row.id, detail);
        } else if (owner(table, row) !== owner(target, endpoint)) add('cross_account_relationship', table, row.id, detail);
        if (table === 'firing_logs' && (!endpoint || owner(table, row) !== owner(target, endpoint)))
          add('invalid_firing_compatibility', table, row.id, detail);
      }
    }
    function duplicates(table, key, type) {
      const groups = new Map();
      for (const row of rows(table)) {
        const k = JSON.stringify(key(row));
        if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row.id);
      }
      for (const ids of groups.values()) if (ids.length > 1) {
        ids.sort(cmp); add(type, table, ids[0], { rowIds: ids });
      }
    }
    for (const [table, target, column] of qlLinks) {
      for (const row of rows(table)) {
        const p = lookup('pieces', row.piece_id); const endpoint = lookup(target, row[column]);
        const detail = { endpoints: [{ table: 'pieces', id: row.piece_id }, { table: target, id: row[column] }] };
        if (!p || !endpoint) {
          add('missing_record', table, row.id, detail);
          add('stale_ql_relationship', table, row.id, detail);
          add('orphaned_relationship_row', table, row.id, detail);
        }
        if ((p && p.user_id !== row.user_id) || (endpoint && endpoint.user_id !== row.user_id)) {
          add('cross_account_relationship', table, row.id, detail);
          add('invalid_ownership_chain', table, row.id, detail);
        }
        if (table === 'ql_piece_firings' && (!p || !endpoint || p.user_id !== row.user_id || endpoint.user_id !== row.user_id))
          add('invalid_firing_compatibility', table, row.id, detail);
      }
      duplicates(table, r => [r.piece_id, r[column]], 'duplicate_relationship');
    }
    // Repeated applications at different layer positions are legitimate, as are the
    // same file on different parents and a legacy+QL copy of the same firing pair.
    duplicates('piece_glazes', r => [r.piece_id, r.glaze_id, r.custom_name, r.layer_order, r.coats, r.notes], 'duplicate_glaze_application');
    for (const table of ['piece_photos', 'clay_photos', 'glaze_photos', 'firing_photos', 'project_photos'])
      duplicates(table, r => [r[parents[table][1]], r.filename], 'duplicate_photo_reference');
    for (const row of rows('forum_photos')) {
      const p = lookup('forum_posts', row.post_id); const reply = lookup('forum_replies', row.reply_id);
      if ((row.post_id == null && row.reply_id == null) || (row.post_id != null && !p) || (row.reply_id != null && !reply))
        add('orphaned_relationship_row', 'forum_photos', row.id);
      if (p && reply && reply.post_id !== p.id) add('invalid_photo_parent_chain', 'forum_photos', row.id);
      if (!owner('forum_photos', row) || !lookup('users', owner('forum_photos', row))) add('invalid_ownership_chain', 'forum_photos', row.id);
    }
    const referenced = new Set(); const inventory = fileInventory === undefined ? null : new Set(fileInventory);
    for (const [table, slots] of Object.entries(fileSlots)) for (const row of rows(table)) for (const column of slots) {
      const filename = row[column];
      if (filename == null || filename === '') {
        if (column === 'filename' && cols(table).has(column)) add('suspicious_file_metadata', table, row.id, { column });
        continue;
      }
      referenced.add(filename);
      const detail = { column, fileToken: token(filename) };
      if (typeof filename !== 'string' || filename === '.' || filename === '..' || /[/\\\0]/.test(filename))
        add('suspicious_file_metadata', table, row.id, detail);
      else if (inventory && !inventory.has(filename)) add('missing_file', table, row.id, detail);
    }
    if (inventory) for (const filename of inventory) if (!referenced.has(filename))
      add('unreferenced_file', 'files', null, { fileToken: token(filename) });

    const installed = qlLinks.filter(([table]) => tables.has(table)).length;
    let migrationState = installed === 0 && !tables.has('ql_migrations') ? 'absent' : 'installed';
    const objects = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name GLOB 'ql_*' ORDER BY type,name").all();
    if (objects.length) {
      let valid = installed === 3 && tables.has('ql_migrations');
      if (valid) {
        try {
          const ledger = rows('ql_migrations'); const applied = ledger.find(r => r.id === auditMigrationContract.migrationId);
          valid = ledger.length === 1 && applied?.checksum === auditMigrationContract.checksum &&
            applied.schema_manifest === auditMigrationContract.readManifest(db);
          // Unknown QL artifacts are not silently accepted as the Phase 1 schema.
          valid = valid && objects.every(o => o.name === 'ql_migrations' || qlLinks.some(([table]) => o.name === table || o.name.startsWith(table + '_')));
        } catch { valid = false; }
      }
      if (!valid) { migrationState = 'drift'; add('ql_schema_drift', 'ql_migrations', null); }
    }
    // Calls the actual SELECT-only preflight, never an account-delete operation.
    const lifecycle = createDeletionLifecycle(db, '/unused-read-only-audit', () => {});
    for (const user of rows('users')) {
      try { lifecycle.preflightAccountDeletion(user.id); }
      catch (error) { add(error.status === 409 ? 'account_deletion_preflight_rejected' : 'account_preflight_unavailable', 'users', user.id); }
    }
    const firingStates = { legacyOnly: 0, qlOnly: 0, matchingPair: 0, additionalSharedPair: 0, unlinked: 0 };
    for (const f of rows('firing_logs')) {
      const legacy = lookup('pieces', f.piece_id);
      const validLegacy = legacy && legacy.user_id === f.user_id && lookup('users', f.user_id);
      const explicit = rows('ql_piece_firings').filter(l => l.firing_id === f.id && l.user_id === f.user_id &&
        lookup('pieces', l.piece_id)?.user_id === f.user_id && lookup('users', f.user_id));
      if (validLegacy && !explicit.length) firingStates.legacyOnly++;
      if (!validLegacy && explicit.length) firingStates.qlOnly++;
      if (validLegacy && explicit.some(l => l.piece_id === f.piece_id)) firingStates.matchingPair++;
      if (validLegacy && explicit.some(l => l.piece_id !== f.piece_id)) firingStates.additionalSharedPair++;
      if (!validLegacy && !explicit.length) firingStates.unlinked++;
    }
    issues.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)));
    const counts = {}; for (const issue of issues) counts[issue.type] = (counts[issue.type] || 0) + 1;
    return { formatVersion: 1, migrationState, fileInventoryChecked: inventory !== null, firingStates, counts, issues };
  })();
}

module.exports = { auditRelationships };
