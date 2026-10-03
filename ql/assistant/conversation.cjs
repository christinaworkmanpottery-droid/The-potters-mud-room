'use strict';
const {randomBytes} = require('node:crypto');
// Opaque, owner-bound, expiring references. No transcripts, credentials, media,
// provider memory, database writes, or client-supplied record IDs.
function createContextStore({now = Date.now, ttl = 15 * 60 * 1000, max = 1000} = {}) {
  const entries = new Map();
  function prune() { for (const [key, value] of entries) if (value.expires <= now()) entries.delete(key); }
  return {
    read(token, owner) {
      prune(); const entry = entries.get(token);
      return entry?.owner === owner ? entry.state : null;
    },
    save(owner, state) {
      prune(); while (entries.size >= max) entries.delete(entries.keys().next().value);
      const token = randomBytes(24).toString('hex');
      entries.set(token, {owner, expires:now() + ttl, state:structuredClone(state)});
      return {token};
    }
  };
}
const normalized = text => text.trim().toLowerCase().replace(/[?.!]$/, '').replace(/\s+/g,' ').replace(/^please /,'').replace(/ please$/,'');
function followup(text) {
  if (/[\x00-\x1f\x7f]/.test(text)) return null;
  const n = normalized(text);
  const intent = (name,args={}) => ({name,arguments:args});
  if (/^(?:what|which) glazes? did i use on (?:that|it|this)(?: piece)?$/.test(n)) return intent('studio.piece.glazes');
  if (/^(?:when did i fire (?:it|that|this)(?: piece)?|when was (?:it|that|this)(?: piece)? fired)$/.test(n)) return intent('studio.piece.firings');
  if (/^(?:open|show(?: me)?) (?:it|that|this)(?: piece)?$/.test(n)) return intent('studio.piece.open');
  const ordinal = n.match(/^(?:(?:open|show(?: me)?|choose|select) )?(?:the )?(first|second|third|fourth|fifth|1|2|3|4|5)(?: one| piece)?$/);
  if (ordinal) return intent('studio.piece.choose',{index:({'first':1,'second':2,'third':3,'fourth':4,'fifth':5}[ordinal[1]] || Number(ordinal[1]))});
  const refine = n.match(/^(?:open|show(?: me)?|find) (?:the )?(.+?) (?:one|ones)$/);
  if (refine) return intent('studio.piece.refine',{query:refine[1]});
  return null;
}
function createConversationTools(db, {search, validDate}) {
  const history = require('../piece-history.cjs').createPieceHistoryService(db);
  const missing = 'Which Piece do you mean? Say “Open my pieces”, then “Find blue pieces” using words saved in its title, description or notes.';
  const answer = (text,state={},navigation) => ({result:{tool:'studio.conversation',status:'clarification'},response:{text,...(navigation?{navigation}:{})},state});
  function selected(id) { return db.prepare('SELECT id,title FROM pieces WHERE id=? AND user_id=?').get(id.pieceId,id.userId); }
  function choose(userId, id) {
    const piece = selected({pieceId:id,userId});
    if (!piece) return answer('That Piece is no longer available. Please search again.',{scope:'piece'});
    return {result:{tool:'studio.piece.open',status:'found',pieceId:piece.id},
      response:{text:'Opening '+(piece.title || 'Untitled piece')+'. You can ask what glaze you used on it or when you fired it.',navigation:{kind:'record',type:'piece',id:piece.id}},
      state:{scope:'piece',pieceId:piece.id}};
  }
  function matches(userId, query) {
    const found = search({userId,q:query,types:'piece',limit:'5'});
    const ids = found.results.map(r=>r.sourceRecordId);
    if (ids.length === 1 && !found.hasMore) return choose(userId,ids[0]);
    const state = {scope:'piece',candidates:ids};
    const text = !ids.length ? 'No matching saved Pieces. Try another word saved in the title, description or notes. I cannot identify a color from photos in this slice.' :
      (found.hasMore ? 'More than five Pieces match. Here are the first five. ' : ids.length+' Pieces match. ') +
      found.results.map((r,i)=>(i+1)+'. '+r.title).join('; ') + '. Say “the first one”, another listed number, or search with a more specific saved word.';
    return {...answer(text,state,{kind:'search',type:'piece',query}),result:{tool:'studio.piece.matches',status:ids.length?'choices':'empty',...found}};
  }
  function execute(intent, userId, state) {
    if (intent.name === 'studio.piece.refine') {
      if (state?.scope !== 'piece') return answer(missing);
      return matches(userId,intent.arguments.query);
    }
    if (intent.name === 'studio.piece.choose') {
      const id = state?.candidates?.[intent.arguments.index-1];
      return id ? choose(userId,id) : answer('There is no current choice with that number. Please search for a Piece again.',state || {});
    }
    if (!state?.pieceId) return answer(missing,state || {});
    const piece = selected({pieceId:state.pieceId,userId});
    if (!piece) return answer('That Piece is no longer available. Please search again.',{scope:'piece'});
    if (intent.name === 'studio.piece.open') return choose(userId,piece.id);
    // Reuse canonical owner-filtered relationship reads. Do not retrieve entitled
    // Test Tile content, media paths, or unrelated history in the response.
    const saved = history.get({userId,pieceId:piece.id,testTilesAccess:'unavailable'});
    if (intent.name === 'studio.piece.glazes') {
      const names = saved.glazeLayers.map(r=>r.values.glaze?.name || r.values.layer.custom_name || 'Unnamed saved glaze layer');
      const text = names.length ? 'Saved glaze layers on '+(piece.title || 'this Piece')+': '+names.slice(0,12).join('; ')+'.'+(names.length>12?' More layers are saved; open the Piece to see them all.':'') : 'No glaze layers are saved on '+(piece.title || 'this Piece')+'.';
      return {result:{tool:intent.name,status:names.length?'found':'empty',pieceId:piece.id,glazes:names.slice(0,12),hasMore:names.length>12},response:{text},state};
    }
    const dates = [...new Set(saved.firings.map(r=>r.values.date).filter(validDate))].sort().reverse();
    const invalid = saved.firings.some(r=>!validDate(r.values.date));
    const text = dates.length ? 'Saved firing dates linked to '+(piece.title || 'this Piece')+': '+dates.slice(0,12).join(', ')+'.'+(dates.length>12?' More dates are saved; open the Piece to see them all.':'')+(invalid?' Some linked firings have no valid saved date.':'') :
      saved.firings.length ? 'The firings linked to this Piece have no valid saved firing date.' : 'No firings are linked to this Piece. I cannot tell when you fired it from your saved records.';
    return {result:{tool:intent.name,status:dates.length?'found':'empty',pieceId:piece.id,dates:dates.slice(0,12),hasMore:dates.length>12,invalidDates:invalid},response:{text},state};
  }
  return {matches,execute};
}
module.exports={createContextStore,followup,createConversationTools};
