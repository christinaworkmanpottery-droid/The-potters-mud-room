'use strict';
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
  if (!exact(value, ['name', 'arguments']) || value.name !== INTENT || !exact(value.arguments, []))
    fail(400, 'UNSUPPORTED_INTENT', 'Unsupported assistant intent.');
  return { name: INTENT, arguments: {} };
}
function validateRequest(value) {
  if (!exact(value, ['version', 'requestId', 'input']) || value.version !== 1 ||
      typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.requestId))
    fail(400, 'INVALID_REQUEST', 'Invalid assistant request.');
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
    const normalized = text.trim().toLowerCase().replace(/\?$/, '').replace(/\s+/g, ' ');
    if (!['when was my last firing', 'when was my latest firing', 'latest recorded firing', 'last firing'].includes(normalized))
      fail(400, 'UNSUPPORTED_INTENT', 'Unsupported question. Try “When was my last firing?”');
    return {name: INTENT, arguments: {}};
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
  return Object.freeze({
    // authorize is a server-owned callback, never a JSON field. Rechecked after await.
    async turn({request, authorize, signal}) {
      const userId = authorize(); requireAccount(db, userId);
      const {requestId, input} = validateRequest(request);
      if (signal?.aborted) fail(409, 'CANCELLED', 'Assistant request cancelled.');
      const intent = validateIntent(input.command || await intentProvider.resolveIntent({text: input.text}, {signal}));
      if (signal?.aborted) fail(409, 'CANCELLED', 'Assistant request cancelled.');
      if (authorize() !== userId) fail(401, 'SESSION_CHANGED', 'Account session changed.');
      const result = latestRecordedFiring(db, userId, intent);
      return {version: 1, requestId, accountId: userId, intent, result, response: formatResult(result)};
    }
  });
}
module.exports = {INTENT, AssistantError, validateIntent, validateRequest, deterministicProvider,
  validDate, requireAccount, latestRecordedFiring, formatResult, createAssistantCore};
