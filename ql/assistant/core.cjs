'use strict';
const {DOMAINS, DESTINATIONS, validQuery, resolve} = require('./intents.cjs');
const {createContextStore, followup, createConversationTools} = require('./conversation.cjs');
const INTENT = 'studio.firing.latest';
class AssistantError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new AssistantError(status, code, message); };
function exact(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function validateIntent(value) {
  if (!exact(value, ['name', 'arguments'])) fail(400, 'UNSUPPORTED_INTENT', 'Unsupported assistant intent.');
  const args = value.arguments;
  const valid = (['studio.piece.glazes','studio.piece.firings','studio.piece.open','studio.piece.clarifyGlazes'].includes(value.name) && exact(args, [])) ||
    (value.name === 'studio.piece.choose' && exact(args,['index']) && Number.isInteger(args.index) && args.index >= 1 && args.index <= 5) ||
    (value.name === 'studio.piece.confirmRead' && exact(args,['confirmed']) && typeof args.confirmed === 'boolean') ||
    (['studio.piece.namedGlazes','studio.piece.clarifyOpen'].includes(value.name) && exact(args,['query']) && validQuery(args.query)) ||
    (value.name === 'studio.piece.refine' && exact(args,['query']) && validQuery(args.query)) ||
    ([INTENT, 'studio.firing.openLatest'].includes(value.name) && exact(args, [])) ||
    (value.name === 'studio.navigate' && exact(args, ['destination']) && typeof args.destination === 'string' &&
      Object.hasOwn(DESTINATIONS,args.destination)) ||
    (value.name === 'studio.search' && exact(args, ['type','query']) && typeof args.type === 'string' &&
      (Object.hasOwn(DOMAINS,args.type) || args.type === 'all') && validQuery(args.query));
  if (!valid) fail(400, 'UNSUPPORTED_INTENT', 'Unsupported assistant intent.');
  return {name:value.name, arguments:{...args}};
}
function validateRequest(value) {
  if (!(exact(value, ['version', 'requestId', 'input']) || exact(value, ['version', 'requestId', 'input', 'context'])) || value.version !== 1 ||
      typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.requestId))
    fail(400, 'INVALID_REQUEST', 'Invalid assistant request.');
  if (Object.hasOwn(value,'context') && (!exact(value.context,['token']) ||
      !(value.context.token === null || typeof value.context.token === 'string' && /^[a-f0-9]{48}$/.test(value.context.token))))
    fail(400, 'INVALID_REQUEST', 'Invalid conversation reference.');
  const input = value.input;
  if (exact(input, ['command'])) validateIntent(input.command);
  else if (!exact(input, ['text']) || typeof input.text !== 'string' || !input.text.trim() || input.text.length > 200)
    fail(400, 'INVALID_REQUEST', 'Invalid assistant input.');
  return value;
}
// IntentProvider.resolveIntent({text}, {signal}) -> Promise<{name, arguments}>.
// Trusted server adapters receive no principal, credentials, history or studio data.
// Adapter output is untrusted; the core always validates it before dispatch.
const deterministicProvider = Object.freeze({
  id: 'deterministic-v1',
  resolveIntent({text}) {
    return followup(text) || resolve(text, fail);
  }
});
function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.startsWith('0000')) return false;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function requireAccount(db, userId) {
  if (typeof userId !== 'string' || userId === 'admin-key' || !userId ||
      !db.prepare('SELECT 1 FROM users WHERE id=?').get(userId))
    fail(401, 'UNAUTHENTICATED', 'Not authenticated');
}
// No caller-selected record IDs. Same table/owner predicate/date ordering as firing-logs.
// Only dates are read: no notes, media, kiln, cone, Piece IDs or invented completion state.
function latestRecordedFiring(db, userId, intent) {
  requireAccount(db, userId);
  validateIntent(intent);
  if (intent.name !== INTENT) fail(400, 'UNSUPPORTED_INTENT', 'Unsupported firing intent.');
  let date = null, tiedRecords = 0, unorderableRecords = 0, records = 0;
  for (const row of db.prepare('SELECT date FROM firing_logs WHERE user_id=? ORDER BY date DESC').iterate(userId)) {
    records++;
    if (!validDate(row.date)) { unorderableRecords++; continue; }
    if (date === null) date = row.date;
    if (row.date === date) tiedRecords++;
  }
  return Object.freeze({tool: INTENT, status: !records ? 'empty' : date ? 'found' : 'undated',
    date, tiedRecords, unorderableRecords});
}
function formatResult(result) {
  if (!exact(result, ['tool', 'status', 'date', 'tiedRecords', 'unorderableRecords']) || result.tool !== INTENT ||
      !Number.isSafeInteger(result.tiedRecords) || result.tiedRecords < 0 ||
      !Number.isSafeInteger(result.unorderableRecords) || result.unorderableRecords < 0)
    fail(500, 'INVALID_TOOL_RESULT', 'Assistant result unavailable.');
  const {status, date, tiedRecords, unorderableRecords} = result;
  if (status === 'empty' && date === null && tiedRecords === 0 && unorderableRecords === 0)
    return {text: 'No recorded firing was found.'};
  if (status === 'undated' && date === null && tiedRecords === 0 && unorderableRecords > 0)
    return {text: 'Your firing records have no valid saved firing date, so I cannot determine the latest.'};
  if (status !== 'found' || !validDate(date) || tiedRecords < 1)
    fail(500, 'INVALID_TOOL_RESULT', 'Assistant result unavailable.');
  let text = `Your latest recorded firing date is ${date}.`;
  if (tiedRecords > 1) text += ` ${tiedRecords} firing records share that date.`;
  if (unorderableRecords) text += ' Some firing records have no valid saved date and cannot be ordered.';
  return {text};
}
function createAssistantCore(db, {intentProvider = deterministicProvider} = {}) {
  if (typeof intentProvider?.resolveIntent !== 'function') throw new TypeError('Intent provider required');
  let searchService;
  const contexts = createContextStore();
  const search = options => { searchService ||= require('../studio-search.cjs').createStudioSearchService(db); return searchService.search(options); };
  const conversation = createConversationTools(db,{search,validDate});
  return Object.freeze({
    // authorize is a server-owned callback, never a JSON field. Rechecked after await.
    async turn({request, authorize, signal}) {
      const userId = authorize(); requireAccount(db, userId);
      const {requestId, input} = validateRequest(request);
      if (signal?.aborted) fail(409, 'CANCELLED', 'Assistant request cancelled.');
      const intent = validateIntent(input.command || await intentProvider.resolveIntent({text: input.text}, {signal}));
      if (signal?.aborted) fail(409, 'CANCELLED', 'Assistant request cancelled.');
      if (authorize() !== userId) fail(401, 'SESSION_CHANGED', 'Account session changed.');
      requireAccount(db, userId);
      let result, response, nextState = {};
      const context = request.context ? contexts.read(request.context.token,userId) : null;
      if (intent.name.startsWith('studio.piece.')) {
        ({result,response,state:nextState} = conversation.execute(intent,userId,context));
      } else if (intent.name === INTENT || intent.name === 'studio.firing.openLatest') {
        result = latestRecordedFiring(db, userId, {name:INTENT,arguments:{}});
        response = formatResult(result);
        if (intent.name === 'studio.firing.openLatest' && result.status === 'found') {
          if (result.tiedRecords === 1) {
            const row=db.prepare('SELECT id FROM firing_logs WHERE user_id=? AND date=?').get(userId,result.date);
            response.navigation={kind:'record',type:'firing',id:row.id};
          } else {
            response.text += ' Opening matching firings so you can choose.';
            response.navigation={kind:'search',type:'firing',query:result.date};
          }
        }
      } else if (intent.name === 'studio.navigate') {
        const destination=intent.arguments.destination;
        const {page,label}=DESTINATIONS[destination];
        result={tool:intent.name,destination};
        nextState = destination === 'piece' ? {scope:'piece'} : {};
        // Feature loaders and canonical record APIs retain their normal entitlement gates.
        response={text:'Opening '+label+'.',
          navigation:{kind:'page',page}};
      } else if (request.context && intent.name === 'studio.search' && intent.arguments.type === 'piece') {
        ({result,response,state:nextState} = conversation.matches(userId,intent.arguments.query));
      } else {
        searchService ||= require('../studio-search.cjs').createStudioSearchService(db);
        const {type,query}=intent.arguments;
        result={tool:intent.name,...searchService.search({userId,q:query,...(type==='all'?{}:{types:type})})};
        response={text:result.lockedTypes.includes(type) ? 'Test Tiles are unavailable on your current plan.' :
          result.results.length ? 'Opening your matching saved studio records.' : 'No matching saved records. Opening Studio Search.',
          navigation:{kind:'search',type,query}};
      }
      return {version: 1, requestId, accountId: userId, intent, result, response,
        ...(request.context ? {context:contexts.save(userId,nextState)} : {})};
    }
  });
}
module.exports = {INTENT, AssistantError, validateIntent, validateRequest, deterministicProvider,
  validDate, requireAccount, latestRecordedFiring, formatResult, createAssistantCore};
