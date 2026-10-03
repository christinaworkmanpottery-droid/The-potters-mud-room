'use strict';
const {DOMAINS, DESTINATIONS, validQuery, resolve} = require('./intents.cjs');
const {createContextStore, followup, createConversationTools} = require('./conversation.cjs');
const {envelope,interpret}=require('./language.cjs');
const {dictationBody,noteStart,isNoteText,noteBody,confirmation,cancellation,unclearNoteCommand,createNoteDrafts}=require('./notes.cjs');
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
  const valid = (value.name === 'studio.note.begin' && exact(args,['topic']) && typeof args.topic==='string' && args.topic.length<=200 && !/[\x00-\x1f\x7f]/.test(args.topic)) || (value.name === 'studio.note.draft' && exact(args,['body']) && typeof args.body==='string' && args.body.trim().length>0 && args.body.length<=200 && !/[\x00-\x1f\x7f]/.test(args.body)) ||
    (['studio.language.clarify','studio.note.confirm','studio.note.cancel','studio.note.review'].includes(value.name) && exact(args,[])) || (['studio.piece.glazes','studio.piece.firings','studio.piece.open','studio.piece.clarifyGlazes','studio.piece.repeatName'].includes(value.name) && exact(args, [])) ||
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
    const start=noteStart(text);
    if(start) return {name:'studio.note.begin',arguments:start};
    const body=noteBody(text);
    if(body) return {name:'studio.note.draft',arguments:{body}};
    if(confirmation(text)) return {name:'studio.note.confirm',arguments:{}};
    if(cancellation(text)) return {name:'studio.note.cancel',arguments:{}};
    try { return followup(text) || resolve(text, fail); }
    catch(error) {
      if(!['UNSUPPORTED_INTENT','ACTION_NOT_AVAILABLE'].includes(error.code))throw error;
      const flexible=interpret(text);
      if(flexible?.intent)return flexible.intent;
      // Same command grammar after stripping only conversational scaffolding.
      const clean=envelope(text);
      if(clean && clean!==text.toLowerCase().trim())return followup(clean) || resolve(clean,fail);
      throw error;
    }
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
  const notes = createNoteDrafts(db);
  const search = options => { searchService ||= require('../studio-search.cjs').createStudioSearchService(db); return searchService.search(options); };
  const conversation = createConversationTools(db,{search,validDate});
  return Object.freeze({
    // authorize is a server-owned callback, never a JSON field. Rechecked after await.
    async turn({request, authorize, signal}) {
      const userId = authorize(); requireAccount(db, userId);
      const {requestId, input} = validateRequest(request);
      if (signal?.aborted) fail(409, 'CANCELLED', 'Assistant request cancelled.');
      const context = request.context ? contexts.read(request.context.token,userId) : null;
      const activeDraft=notes.wantsText(userId,context);
      let language = !input.command && intentProvider===deterministicProvider && !noteStart(input.text) && !noteBody(input.text) && !confirmation(input.text,activeDraft) && !cancellation(input.text) ? interpret(input.text,context) : null;
      // A bare feature name can be literal note dictation. Only explicit read
      // requests may leave a draft; shorthand navigation is for read context.
      if(activeDraft && language?.intent?.name==='studio.navigate' && !/\b(?:open|show|bring|pull|go|take|look|see)\b/i.test(input.text))language=null;
      if(activeDraft && context?.languagePending?.kind==='write-target' && confirmation(input.text,true))
        language={clarification:'Please clarify the revised note text first. Nothing was saved.',pending:context.languagePending};
      const politeRequest=/^(?:(?:okay|ok|hey|um|uh)[, ]+)?(?:can|could|would|will) you\b/i.test(input.text || '');
      const capture=activeDraft && !language && isNoteText(input.text) && (!politeRequest || isNoteText(envelope(input.text)));
      let clarifyNote=unclearNoteCommand(input.text);
      let proposed;
      try { proposed = language?.clarification ? {name:'studio.language.clarify',arguments:{}} :
        clarifyNote ? {name:'studio.note.review',arguments:{}} :
        activeDraft && confirmation(input.text,true) ? {name:'studio.note.confirm',arguments:{}} :
        capture ? {name:'studio.note.draft',arguments:{body:dictationBody(input.text)}} :
        language?.intent ? language.intent :
        input.command || await intentProvider.resolveIntent({text: input.text}, {signal}); }
      catch (error) {
        if(error.code==='UNSUPPORTED_INTENT' && context?.languagePending && intentProvider===deterministicProvider){
          language={clarification:'I still have your earlier request. '+(context.languageQuestion || 'Which did you mean?'),pending:context.languagePending};
          proposed={name:'studio.language.clarify',arguments:{}};
        } else if(['UNSUPPORTED_INTENT','ACTION_NOT_AVAILABLE'].includes(error.code) && activeDraft){
          clarifyNote=true;
          proposed={name:'studio.note.review',arguments:{}};
        } else {
          notes.clear(userId);
          if (error.code !== 'UNSUPPORTED_INTENT' || context?.scope !== 'piece' ||
            !/^(?:please )?(?:open|show(?: me)?) /i.test(input.text || '')) throw error;
          proposed = {name:'studio.piece.repeatName',arguments:{}};
        }
      }
      const intent = validateIntent(proposed);
      if (signal?.aborted) fail(409, 'CANCELLED', 'Assistant request cancelled.');
      if (authorize() !== userId) fail(401, 'SESSION_CHANGED', 'Account session changed.');
      requireAccount(db, userId);
      let result, response, nextState = {};
      if (intent.name === 'studio.language.clarify') {
        if(!language?.clarification)fail(400,'INVALID_REQUEST','No language clarification is pending.');
        result={tool:'studio.language',status:'clarification'};
        response={text:language.clarification};
        nextState={...(context || {}),languagePending:language.pending,languageQuestion:language.clarification};
        if(activeDraft){const review=notes.review(userId,context);result=review.result;response.text+=' '+review.response.text;}
      } else if (intent.name === 'studio.note.review') {
        if(!clarifyNote)fail(400,'INVALID_REQUEST','No note clarification is pending.');
        ({result,response,state:nextState}=notes.review(userId,context));
      } else if (intent.name === 'studio.note.begin') {
        if(!request.context || noteStart(input.text)?.topic!==intent.arguments.topic) fail(400,'INVALID_REQUEST','Please request a note using your own words.');
        ({result,response,state:nextState}=notes.begin(userId,intent.arguments.topic));
      } else if (intent.name === 'studio.note.draft') {
        if(/^(?:replace (?:the )?note with|change (?:the )?note to) /i.test(input.text || '') && !notes.wantsText(userId,context)) fail(400,'ACTION_NOT_AVAILABLE','There is no pending note draft to replace. Saved notes can be edited in the existing form.');
        if (!request.context || (capture ? dictationBody(input.text) : noteBody(input.text))!==intent.arguments.body) fail(400,'INVALID_REQUEST','A note draft requires your exact dictated text and an active conversation.');
        ({result,response,state:nextState}=notes.draft(userId,intent.arguments.body));
      } else if (['studio.note.confirm','studio.note.cancel'].includes(intent.name)) {
        const save=intent.name==='studio.note.confirm';
        if (!(save?confirmation(input.text,activeDraft):cancellation(input.text))) fail(400,'INVALID_REQUEST','Please explicitly confirm or cancel the note.');
        if(context?.noteDraftId || save && confirmation(input.text) && !/^yes(?: please)?[.!?]?$/i.test(input.text.trim()) || /^(?:cancel (?:the )?note|(?:yes[,]? )?use .+|keep .+)[.!]?$/i.test(input.text.trim())) ({result,response,state:nextState}=notes.confirm(userId,context,save,input.text));
        else ({result,response,state:nextState}=conversation.execute({name:'studio.piece.confirmRead',arguments:{confirmed:save}},userId,context));
      } else if (intent.name.startsWith('studio.piece.')) {
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
        if(['glazes','firings'].includes(context?.pendingRead)) {
          if(nextState.pieceId)({result,response,state:nextState}=conversation.execute({name:'studio.piece.'+context.pendingRead,arguments:{}},userId,nextState));
          else nextState.pendingRead=context.pendingRead;
        }
      } else {
        searchService ||= require('../studio-search.cjs').createStudioSearchService(db);
        const {type,query}=intent.arguments;
        result={tool:intent.name,...searchService.search({userId,q:query,...(type==='all'?{}:{types:type})})};
        response={text:result.lockedTypes.includes(type) ? 'Test Tiles are unavailable on your current plan.' :
          result.results.length ? 'Opening your matching saved studio records.' : 'No matching saved records. Opening Studio Search.',
          navigation:{kind:'search',type,query}};
      }
      if (!intent.name.startsWith('studio.note.') && intent.name!=='studio.language.clarify') notes.clear(userId);
      return {version: 1, requestId, accountId: userId, intent, result, response,
        ...(request.context ? {context:contexts.save(userId,nextState)} : {})};
    }
  });
}
module.exports = {INTENT, AssistantError, validateIntent, validateRequest, deterministicProvider,
  validDate, requireAccount, latestRecordedFiring, formatResult, createAssistantCore};
