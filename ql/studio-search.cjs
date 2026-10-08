'use strict';

// Direct saved-record search only. Identifiers come from this allowlist, never input.
const SOURCES = Object.freeze([
  ['piece', 'pieces', 'title', ['title','description','studio','form','status','notes']],
  ['clay', 'clay_bodies', 'name', ['name','brand','color_wet','color_fired','cone_range','notes']],
  ['glaze', 'glazes', 'name', ['name','brand','sku','color_description','cone_range','notes']],
  ['raw-material', 'glaze_chemicals', 'name', ['name','source','notes']],
  ['test-tile', 'test_tiles', 'name', ['name','glaze_name','clay_name','cone','color_result','surface_result','tags','notes']],
  ['firing', 'firing_logs', 'kiln_name', ['kiln_name','firing_type','cone','date','results','notes']],
  ['pricing', 'pricing_calculations', 'name', ['name','description']],
  ['sale', 'sales', 'venue', ['venue','buyer_name','date','notes']],
  ['project', 'projects', 'title', ['title','description','status']],
  ['contact', 'contacts', 'name', ['name','email','phone','notes']],
  ['event', 'events', 'title', ['title','description','event_date','location']]
].map(([type,table,title,fields]) => Object.freeze({type,table,title,fields:Object.freeze(fields)})));
const fold = value => String(value ?? '').normalize('NFC').toLowerCase();
function invalid() { const error = new Error('Invalid search options'); error.status = 400; return error; }
function options(input) {
  if (typeof input.q !== 'string' || input.q.length > 120 || /[\x00-\x1f\x7f]/.test(input.q)) throw invalid();
  const query = input.q.trim().replace(/\s+/gu, ' ').normalize('NFC');
  const tokens = [...new Set(fold(query).split(' ').filter(Boolean))];
  if (query.length < 2 || tokens.length > 8) throw invalid();
  const integer = (value, fallback) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^(0|[1-9]\d{0,3})$/.test(value)) throw invalid();
    return Number(value);
  };
  const limit = integer(input.limit, 25), offset = integer(input.offset, 0);
  if (limit < 1 || limit > 50 || offset + limit > 1000) throw invalid();
  if (input.types !== undefined && typeof input.types !== 'string') throw invalid();
  const types = input.types === undefined ? SOURCES.map(s => s.type) : [...new Set(input.types.split(','))];
  if (!types.length || types.some(type => !SOURCES.some(s => s.type === type))) throw invalid();
  return {query,tokens,limit,offset,types};
}
const binaryCompare = (a,b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
function excerpt(value,tokens) {
  const text = String(value ?? '').normalize('NFC').replace(/\s+/gu,' ');
  const positions = tokens.map(token => fold(text).indexOf(token)).filter(n => n >= 0);
  const start = Math.max(0, (positions.length ? Math.min(...positions) : 0) - 45);
  return (start ? '…' : '') + text.slice(start,start+180) + (text.length>start+180 ? '…' : '');
}

function createStudioSearchService(db) {
  db.function('ql_search_fold', {deterministic:true}, fold);
  function search({userId,...input}) {
    // Current DB account is mandatory, even if an old JWT still verifies.
    if (typeof userId !== 'string' || !userId) { const e = new Error('Not authenticated'); e.status=401; throw e; }
    return db.transaction(() => {
      const user = db.prepare('SELECT tier FROM users WHERE id=?').get(userId);
      if (!user) { const e = new Error('Not authenticated'); e.status=401; throw e; }
      const {query,tokens,limit,offset,types} = options(input);
      // Matches the existing Test Tile read contract, not JWT tier or billing labels.
      const tileAccess = ['starter','basic','mid','top'].includes(user.tier);
      const lockedTypes = !tileAccess && types.includes('test-tile') ? ['test-tile'] : [];
      const candidates = [];
      for (const source of SOURCES.filter(s => types.includes(s.type) && !lockedTypes.includes(s.type))) {
        const {type,table,title,fields} = source;
        const match = tokens.map(() => '(' + fields.map(f => `instr(ql_search_fold(${f}),?)>0`).join(' OR ') + ')').join(' AND ');
        const rows = db.prepare(`SELECT id,${fields.join(',')},ql_search_fold(${title}) AS sort_title,
          CASE WHEN ql_search_fold(${title})=? THEN 0 WHEN instr(ql_search_fold(${title}),?)>0 THEN 1 ELSE 2 END AS rank
          FROM ${table} WHERE user_id=? AND ${match}
          ORDER BY rank,sort_title COLLATE BINARY,id COLLATE BINARY LIMIT ?`)
          .all(fold(query),fold(query),userId,...tokens.flatMap(token => fields.map(() => token)),offset+limit+1);
        for (const row of rows) candidates.push({type,source,row});
      }
      candidates.sort((a,b) => a.row.rank-b.row.rank || binaryCompare(a.row.sort_title,b.row.sort_title)
        || binaryCompare(a.type,b.type) || binaryCompare(a.row.id,b.row.id));
      const hasMore = candidates.length > offset+limit;
      return {
        query,lockedTypes,hasMore,
        nextOffset:hasMore && offset+limit<1000 ? offset+limit : null,
        capped:hasMore && offset+limit>=1000,
        results:candidates.slice(offset,offset+limit).map(({type,source,row}) => {
          const matchedFields = source.fields.filter(f => tokens.some(token => fold(row[f]).includes(token)));
          return {recordType:type,sourceRecordId:row.id,title:row[source.title] || `Untitled ${type}`,
            matchedFields,excerpt:excerpt(row[matchedFields[0]],tokens)};
        })
      };
    }).deferred();
  }
  return Object.freeze({search});
}
module.exports = {createStudioSearchService};
