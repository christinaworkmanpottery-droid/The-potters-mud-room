'use strict';
const {randomBytes}=require('node:crypto');
const {createStudioNote,updateStudioNote}=require('../studio-notes.cjs');
// Extract dictated words; command suffixes are not note content. Material
// alternatives are explicit proposals and never silently replace user words.
function dictationBody(text) {
  return text.trim().replace(/(?<!\bto)\s+(?:and\s+)?(?:please\s+)?save(?:\s+(?:(?:the|this)\s+)?note)?(?:\s+please)?[.!?]*$/i, '').trim();
}
const materialChoice = text => {
  const n = (text || '').trim().replace(/[.!?]$/, '');
  if (/^(?:(?:use|yes[,]?(?: use)?|i said|i meant|no[,]? i said) )?b[ -]?mix(?: clay)?$/i.test(n)) return 'suggested';
  if (/^(?:keep (?:the )?original words|use (?:the )?original words)$/i.test(n)) return 'original';
  return null;
};
// Parse the request separately from its payload; preserve the user's exact body.
const notePrefix = /^(?:(?:(?:okay|ok|hey|hi)(?:\s+clayton)?|clayton)[, ]+)?(?:(?:can|could|would) you\s+|i (?:want|need|would like) to\s+|i[’']d like to\s+)?(?:please\s+)?(?:(?:add|create|make|start|take|write|record)\s+(?:(?:me\s+)?(?:a|another)\s+)?(?:new\s+)?(?:studio\s+)?note|(?:a\s+)?new\s+(?:studio\s+)?note|(?:jot|write)\s+(?:this\s+)?down)\b/i;
function noteRequest(text) {
  if(typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) return null;
  const match=text.trim().match(notePrefix);
  if(!match)return null;
  return text.trim().slice(match[0].length).replace(/^\s+for me\b/i, '').replace(/^(?:\s+(?:that|saying|of)\b)?\s*[:,.!?]?\s*/, '').trim();
}
// Physical studio plans can be offered as note drafts, never executed as record
// creation. Strip conversational scaffolding for classification only.
function studioPlan(text) {
  if(typeof text!=='string' || /[\x00-\x1f\x7f]/.test(text))return false;
  let n=text.trim().toLowerCase();
  // Classification only: preserve the original dictated body byte-for-byte.
  n=n.replace(/\b(?:um|uh)\b[, ]*/g,'').replace(/,\s*/g,' ').replace(/\s+/g,' ');
  n=n.replace(/^(?:in|using|with)\s+[^.!?]{1,60}?\bclay\s+(?=(?:i\s|make\s|throw\s|trim\s|decorate\s))/,'');
  for(let i=0;i<4;i++)n=n.replace(/^(?:(?:okay|ok|hey|um|uh|well)[, ]+|please\s+|(?:can|could|would) you\s+|i (?:need|want|have|would like) to\s+|i['’]d like to\s+)/,'');
  if(!/^(?:make|throw|trim|decorate)\s+/.test(n))return false;
  if(/\b(?:record|records|entry|entries|account|delete|remove|update|publish|send)\b/.test(n))return false;
  return /^(?:make|throw|trim|decorate)\s+(?:\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|some|more|another)\b.{0,100}\b(?:dish|dishes|bowl|bowls|cup|cups|mug|mugs|plate|plates|vase|vases|planter|planters|pitcher|pitchers|jar|jars|sculpture|sculptures)\b/.test(n);
}
function noteBody(text) {
  if(typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) return null;
  const correction=text.trim().match(/^(?:replace (?:the )?note with|change (?:the )?note to)\s+(.+)$/i);
  if(correction)return correction[1].trim();
  const body=noteRequest(text);
  return body ? dictationBody(body) || null : studioPlan(text) ? dictationBody(text) : null;
}
function noteStart(text) {
  if(typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) return null;
  const body=noteRequest(text);
  if(body===null)return null;
  if(!body || /^please[.!?]*$/i.test(body) || confirmation(body))return {topic:''};
  const topic=body.match(/^about\s+(.+?)[.!?]?$/i);
  return topic ? {topic:topic[1]} : null;
}
const commandWords=text=>typeof text==='string' ? text.trim().replace(/[.!?]+$/,'').replace(/^(?:(?:okay|ok|hey|hi)(?:\s+clayton)?|clayton)[, ]+/i,'').replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?/i,'').replace(/\s+please$/i,'') : '';
const confirmation=(text,hasDraft=false)=>typeof text==='string' && (materialChoice(text) !== null || /^(?:yes|save|done|that(?:'|’)s it|that is it|save (?:(?:the|this|my) )?(?:note|draft)|confirm (?:(?:the|this) )?(?:note|draft))$/i.test(commandWords(text)) || hasDraft && /^(?:save (?:it|that|this)|yes[,]? (?:save (?:it|that|this)|go ahead)|go ahead and save(?: (?:it|that|this))?)$/i.test(commandWords(text)));
// Misheard save-like speech asks for clarification, never a guessed write.
const unclearNoteCommand=text=>typeof text==='string' && /^(?:\S+\s+){0,3}(?:save|confirm)\s+(?:(?:the|this|my)\s+)?note[.!?]*$/i.test(text.trim()) && !confirmation(text) && noteBody(text)===null && !cancellation(text);
const isNoteText=text=>typeof text==='string' && noteRequest(text)===null && !confirmation(text,true) && !cancellation(text) && !unclearNoteCommand(text) && !materialChoice(text) && !noteEdit(text) && !/^(?:please )?(?:open|show|go|take|find|search|add|create|make|edit|update|change|replace|delete|remove|save|send|record|log|publish|what|which|when|yes|no|cancel|never mind)\b/i.test(text.trim());
const cancellation=text=>typeof text==='string' && /^(?:no|no thanks|cancel|cancel (?:(?:the|this|my) )?(?:note|draft)|never mind|discard (?:it|that|this|(?:(?:the|my|this) )?(?:note|draft))|do not save(?: (?:it|that|(?:(?:the|my|this) )?(?:note|draft)))?|don[’']t save(?: (?:it|that|(?:(?:the|my|this) )?(?:note|draft)))?)$/i.test(commandWords(text));
// Deliberately bounded fragment guard; exact saved text is never rewritten.
const incompleteNote = text => /(?:\b(?:and|or|because|with|for|to|the|my|buy|need)|\bi[’']ve been|\bi have been|\bi[’']m going to)[.!?]*$/i.test((text || '').trim());
// Follow-up content stays literal. Explicit non-note destinations never become text.
function conversationalCommand(text){
  return commandWords(text)
    .replace(/^(?:(?:please|hey|hi|okay|ok)(?:\s+clayton)?\s+)+/i,'')
    .replace(/^(?:(?:can|could|would|will)\s+you\s+)/i,'')
    .replace(/^i\s+(?:need|want|would like)\s+you\s+to\s+/i,'')
    .replace(/\s+(?:please|thanks|thank you)$/i,'')
    .trim();
}
function noteReplacement(text) {
  if(typeof text!=='string' || /[\x00-\x1f\x7f]/.test(text))return null;
  const n=conversationalCommand(text);
  const reference='(?:(?:the|my|this|that)\\s+)?(?:(?:last|latest|previous|current|most recent)\\s+)?(?:studio\\s+)?note';
  let m=n.match(/^(?:remove|delete|take out)\s+(.+?)\s+and\s+(?:put|say|use|replace (?:it|that) with)\s+(.+?)(?:\s+instead)?$/i) || n.match(/^instead of\s+(.+?),?\s+(?:say|put|use)\s+(.+)$/i);
  if(!m)m=n.match(new RegExp('^(?:change|replace)\\s+'+reference+'\\s+(.+?)\\s+(?:to|with)\\s+(.+)$','i'));
  if(!m)m=n.match(new RegExp('^(?:on|in)\\s+'+reference+'[,]?\\s+(?:change|replace)\\s+(.+?)\\s+(?:to|with)\\s+(.+)$','i'));
  if(!m)m=n.match(/^(?:change|replace|correct|fix|update)\s+(I (?:need|want|plan|have) to [\p{L}]+)\s+(?:to|with|so it says)\s+(.+)$/iu);
  if(!m)m=n.match(/^(?:change|replace|correct|fix|update)\s+(.+?)\s+(?:to|with|so it says)\s+(.+)$/i);
  if(!m)return null;
  m[1]=m[1].replace(/,$/,'');
  const from=m[1].trim().replace(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/,(_,x,y)=>x ?? y);
  const to=m[2].trim().replace(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/,(_,x,y)=>x ?? y);
  if(!from || !to || from.length>200 || to.length>200)return null;
  // Generic field words are not safe literal replacements. "Change clay to X"
  // is semantically ambiguous and must be clarified rather than producing text
  // such as "B mix Electric Brown" from "B mix clay".
  if(/^(?:clay|glaze|piece|firing|note|body)$/i.test(from))return null;
  return {from,to};
}
function noteInsertion(text) {
  if(typeof text!=='string' || /[\x00-\x1f\x7f]/.test(text))return null;
  const n=conversationalCommand(text);
  const m=n.match(/^(?:add|insert|put|place|include)\s+(.+?)\s+(before|after|in front of|following)\s+(.+)$/i);
  if(!m)return null;
  const body=m[1].trim().replace(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/,(_,x,y)=>x ?? y);
  const anchor=m[3].trim().replace(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/,(_,x,y)=>x ?? y);
  if(!body || !anchor || body.length>200 || anchor.length>200)return null;
  return {body,position:/^(?:before|in front of)$/i.test(m[2])?'before':'after',anchor};
}
function noteAddition(text) {
  if(typeof text!=='string' || /[\x00-\x1f\x7f]/.test(text))return null;
  const words=conversationalCommand(text).replace(/^(?:and\s+)?(?:also\s+)?/i,'');
  const reference='(?:(?:the|my|this|that)\\s+)?(?:(?:last|latest|previous|current|most recent)\\s+)?(?:studio\\s+)?note(?:\\s+(?:I|we)\\s+(?:just\\s+)?saved)?';
  const destinationFirst=new RegExp('^(?:add(?:\\s+in)?|append|include|mention)\\s+(?:to|in|into|on)\\s+'+reference+'[,:]?\\s+(.+)$','i');
  const m=words.match(destinationFirst) || words.match(/^(?:add(?:\s+in)?|append|include|mention)\s+(.+)$/i);
  if(!m)return null;
  const suffix=new RegExp('\\s+(?:to|in|into|on)\\s+'+reference+'[.!?]*$','i');
  const prefix=new RegExp('^(?:to|in|into|on)\\s+'+reference+'[,:]?\\s+','i');
  let body=m[1].trim();
  if(!/^(?:"[\s\S]*"|“[\s\S]*”)$/.test(body))body=body.replace(suffix,'').replace(prefix,'').replace(/\s+to\s+(?:that|it|this)[.!?]*$/i,'').trim();
  body=body.replace(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/,(_,x,y)=>x ?? y);
  if(/\b(?:to|in|on|into)\s+[^.!?]*\bnote\b/i.test(body) && !/^(?:"|“)/.test(m[1]))return {body:'',ambiguous:true,clarification:'Which note do you mean? I can add to the note just saved in this conversation; I will not choose a different note for you.'};
  if(/\b(?:to|on|into|in)\s+(?:(?:the|my|a|this|that)\s+)?(?:piece|glaze collection|glaze library|shopping list|inventory|bowl|vase)\b/i.test(body))return null;
  if(/^(?:a |another |new |studio )*note\b/i.test(body))return null;
  return {body,ambiguous:!body || /^(?:that|it|this)[.!?]*$/i.test(body)};
}
// Commands are parsed before dictation in collecting/draft/editing/saved states.
const noteReference = '(?:(?:the|my|this|that)\\s+)?(?:(?:live|current|last|latest|previous|most recent)\\s+)?(?:studio\\s+)?(?:note(?:\\s+draft)?|draft)';
function noteEdit(text) {
  if(typeof text!=='string' || /[\x00-\x1f\x7f]/.test(text))return null;
  const n=conversationalCommand(text).replace(new RegExp('^(?:on|in)\\s+'+noteReference+'[, ]+','i'),'');
  if(new RegExp('^(?:edit|change|update|correct|fix|reopen|open|show(?: me)?)\\s+'+noteReference+'$','i').test(n))return {kind:'review'};
  const full=n.match(new RegExp('^(?:replace|change|rewrite)\\s+'+noteReference+'\\s+(?:with|to|so it says)\\s+(.+)$','i'));
  if(full)return {kind:'full',body:full[1]+(text.trim().match(/[.!?]+$/)?.[0] || '')};
  const beginning=n.match(/^(?:change|replace|update)\s+(?:the\s+)?(?:beginning|start|opening)(?: of (?:the |my )?note)?\s+(?:to|with|so it says)\s+(.+)$/i);
  if(beginning)return {kind:'beginning',to:beginning[1]};
  if(/^(?:remove|delete|take out|instead of)\b/i.test(n) && noteReplacement(text))return null;
  const remove=n.match(/^(?:remove|delete|take out)\s+(.+)$/i);
  if(remove)return {kind:'remove',from:remove[1].replace(new RegExp('\\s+from\\s+'+noteReference+'$','i'),'').replace(/^["“]|["”]$/g,'')};
  const correction=n.match(/^(?:no[, ]+)?(?:i said|i meant|it should (?:say|be)|correct that to)\s+(.+)$/i);
  if(correction)return {kind:'correction',body:correction[1]};
  if(noteReplacement(text))return null;
  if(/^(?:instead of|change|replace|remove|delete|take out)\b/i.test(n))return {kind:'clarify'};
  if(/^(?:safe draft|shut up|stop talking|stop speaking|(?:i said|i meant|correct|fix|edit)\b.*)$/i.test(n))return {kind:'clarify'};
  return null;
}
const potterySlots = [
  {canonical:/^b[ -]?mix(?: clay)?$/i,heard:/\b(?:b[ -]?mix(?:ed)?|bm\s+mix|bmx|v[ -]?mix|bee\s+mix|the\s+mix)(?:\s+clay)?\b/gi},
  {canonical:/^soy sauce dishes$/i,heard:/\bsoy (?:sauce|subs|saucer) dishes\b/gi},
  {canonical:/^sapphire float(?: glaze)?$/i,heard:/\bsapphire (?:float|flow|float phone)(?: (?:glaze|blaze))?\b/gi},
  {canonical:/^cone (?:0?[0-9]+|zero [a-z]+|[a-z]+)$/i,heard:/\bcone (?:0?[0-9]+|zero [a-z]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi}
];
function createNoteDrafts(db,{now=Date.now,ttl=5*60*1000,max=1000}={}) {
  const drafts=new Map();
  const saved=new Map();
  function clear(userId){drafts.delete(userId);saved.delete(userId);}
  function prune(){for(const entries of [drafts,saved])for(const [owner,d] of entries)if(d.expires<=now())entries.delete(owner);}
  const reply=(text,status,state={})=>({result:{tool:'studio.note',status},response:{text},state});
  return {
    clear,
    selectedId(userId,state){prune();return saved.get(userId)?.ref===state?.savedNoteRef?saved.get(userId)?.noteId:null;},
    selectSaved(userId,id){
      const note=db.prepare('SELECT id,body FROM studio_notes WHERE id=? AND user_id=?').get(id,userId);
      if(!note)return {};
      clear(userId);const ref=randomBytes(24).toString('hex');
      saved.set(userId,{ref,noteId:note.id,originalBody:note.body,expires:now()+ttl});
      return {savedNoteRef:ref};
    },
    pendingEdit(userId,state,text){
      prune();
      const holder=state?.noteDraftId && drafts.get(userId)?.id===state.noteDraftId ? drafts.get(userId) : saved.get(userId)?.ref===state?.savedNoteRef ? saved.get(userId) : null;
      if(!holder?.pendingEdit)return null;
      if(/^(?:yes|yes please|that's right|that is right|correct)$/i.test(commandWords(text))){
        const operation=holder.pendingEdit;delete holder.pendingEdit;return operation;
      }
      delete holder.pendingEdit;
      return null;
    },
    edit(userId,state,operation){
      prune();
      const d=drafts.get(userId)?.id===state?.noteDraftId ? drafts.get(userId) : null;
      const target=d ? d.target : saved.get(userId)?.ref===state?.savedNoteRef ? saved.get(userId) : null;
      if(!d && !target)return reply('Which note should I edit? There is no current note in this conversation.','clarification');
      let body=d?.body || '';
      if(!d && target){
        const current=db.prepare('SELECT body FROM studio_notes WHERE id=? AND user_id=?').get(target.noteId,userId);
        if(!current || current.body!==target.originalBody){clear(userId);return reply('That note changed or is no longer available. Nothing changed.','clarification');}
        body=current.body;
      }
      const clarify=message=>{
        const r=reply(message+' Nothing changed.',d?.suggestion?'material-review':d?.collecting?'collecting':d?'draft':'clarification',state);
        if(body)r.result.draftText=body;
        return r;
      };
      if(operation.expectedBody && operation.expectedBody!==body)return clarify('That note changed. Please repeat the correction.');
      const propose=(from,to)=>{
        (d || target).pendingEdit={kind:'replace',from,to,expectedBody:body};
        return clarify('Replace “'+from+'” with “'+to+'”?');
      };
      if(operation.kind==='beginning'){
        // Bound the opening to a recognizable planning phrase; never guess how
        // much of an arbitrary sentence the speaker wants removed.
        const opening=body.match(/^I (?:need|want|plan|have) to [\p{L}]+\b/iu)?.[0];
        return opening ? propose(opening,operation.to) : clarify('Which opening words should I replace with “'+operation.to+'”?');
      }
      if(operation.kind==='review'){
        if(!body)return clarify('What should the note say?');
        const r=this.draft(userId,body,{target,reviewMaterial:false});
        r.response.text='Your note: “'+body+'”. What would you like to change?';
        // Preserve pending material/fragment reviews when simply opening a draft.
        if(d){drafts.set(userId,d);r.state=state;r.result.status=d.suggestion?'material-review':'draft';}
        return r;
      }
      if(operation.kind==='clarify')return clarify('What would you like to change, save, or cancel?');
      if(operation.kind==='full')return this.draft(userId,operation.body,{target});
      let from=operation.from,to=operation.to || '';
      if(operation.kind==='correction'){
        to=operation.body;
        const slot=potterySlots.find(x=>x.canonical.test(to));
        const matches=slot ? [...body.matchAll(slot.heard)] : [];
        if(matches.length!==1)return clarify('Which words should I replace with “'+to+'”?');
        from=matches[0][0];
        if(slot===potterySlots[0])to='B-Mix'+(/clay$/i.test(to) || /clay$/i.test(from)?' clay':'');
      }
      if(!from || !body)return clarify('Please tell me the exact words to change.');
      const escaped=from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const pattern=new RegExp('(?<![\\p{L}\\p{N}])'+escaped+'(?![\\p{L}\\p{N}])','giu');
      const matches=[...body.matchAll(pattern)];
      if(matches.length===0 && operation.kind==='replace'){
        const words=from.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
        const tokens=[...body.matchAll(/[\p{L}\p{N}]+/gu)];
        const candidates=[];
        // A single misheard word in a multi-word target is a proposal only.
        if(words.length>=3)for(let i=0;i<=tokens.length-words.length;i++){
          let differences=0;
          for(let j=0;j<words.length;j++)if(tokens[i+j][0].toLowerCase()!==words[j])differences++;
          if(differences<=1)candidates.push(body.slice(tokens[i].index,tokens[i+words.length-1].index+tokens[i+words.length-1][0].length));
        }
        if(candidates.length===1)return propose(candidates[0],to);
      }
      if(matches.length!==1)return clarify(matches.length?'Those words occur more than once. Which occurrence?':'I could not find “'+from+'”. Which words should I change?');
      const revised=body.replace(pattern,()=>to).replace(/ {2,}/g,' ').trim();
      if(!revised)return clarify('Removing that would empty the note. Would you like to cancel the draft?');
      return this.draft(userId,revised,{target});
    },
    canAmend(userId,state){prune();return !!(saved.get(userId)?.ref===state?.savedNoteRef && state?.savedNoteRef || state?.noteDraftId && drafts.get(userId)?.id===state.noteDraftId && drafts.get(userId)?.target);},
    reviewSaved(userId,state){
      prune();const target=saved.get(userId);
      if(!target || target.ref!==state?.savedNoteRef)return reply('I no longer have a current saved note in this conversation. Nothing changed.','clarification');
      const current=db.prepare('SELECT body FROM studio_notes WHERE id=? AND user_id=?').get(target.noteId,userId);
      if(!current || current.body!==target.originalBody){clear(userId);return reply('That note changed or is no longer available. Please open it to review the latest text. Nothing changed.','clarification');}
      return reply('Your note is already saved: “'+current.body+'” I still have it for follow-ups. Tell me what to add, for example “Also mention sapphire glaze”. Nothing changed.','clarification',state);
    },
    replaceSaved(userId,state,replacement){
      return this.edit(userId,state,{kind:'replace',...replacement});
    },
    insert(userId,state,insertion){
      prune();
      const d=drafts.get(userId);
      const savedTarget=saved.get(userId)?.ref===state?.savedNoteRef ? saved.get(userId) : null;
      const target=d && d.id===state?.noteDraftId ? d.target : savedTarget;
      let body=d && d.id===state?.noteDraftId && d.body ? d.body : null;
      if(!body && savedTarget){
        const current=db.prepare('SELECT body FROM studio_notes WHERE id=? AND user_id=?').get(savedTarget.noteId,userId);
        if(!current || current.body!==savedTarget.originalBody){clear(userId);return reply('That note changed or is no longer available. Please open it to review the latest text. Nothing changed.','clarification');}
        body=current.body;
      }
      if(!body)return reply('Which note should I change? I do not have a current note in this conversation. Nothing changed.','clarification');
      const needle=insertion?.anchor || '', addition=insertion?.body || '';
      if(!needle || !addition || !['before','after'].includes(insertion?.position))
        return reply('Please tell me what words to add and where they belong. Nothing changed.','clarification',state);
      const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const matches=body.match(new RegExp(escaped,'gi')) || [];
      if(matches.length===0)return reply('I could not find “'+needle+'” in that note. Please say the exact nearby words. Nothing changed.','clarification',state);
      if(matches.length>1)return reply('I found “'+needle+'” more than once. Please tell me which occurrence you mean. Nothing changed.','clarification',state);
      const replacement=insertion.position==='before' ? addition+' '+matches[0] : matches[0]+' '+addition;
      const revised=body.replace(new RegExp(escaped,'i'),replacement);
      return this.draft(userId,revised,{target});
    },
    amend(userId,state,addition){
      prune();
      const d=drafts.get(userId);
      const target=d && d.id===state?.noteDraftId ? d.target : saved.get(userId)?.ref===state?.savedNoteRef ? saved.get(userId) : null;
      if(d && d.id===state?.noteDraftId && !target){
        if(addition.ambiguous)return this.edit(userId,state,{kind:'clarify'});
        return this.draft(userId,(d.body ? d.body+'\n' : '')+addition.body);
      }
      if(!target)return reply('Which note should I add that to? I do not have a current saved note in this conversation. Nothing changed.','clarification');
      if(addition.ambiguous)return reply(addition.clarification || 'What words should I add to your note? Please say the words you want included. Nothing changed.','clarification',state);
      const current=db.prepare('SELECT body FROM studio_notes WHERE id=? AND user_id=?').get(target.noteId,userId);
      if(!current || current.body!==target.originalBody){clear(userId);return reply('That note changed or is no longer available. Please open it to review the latest text. Nothing changed.','clarification');}
      const base=d && d.id===state?.noteDraftId && d.target?.noteId===target.noteId ? d.body : current.body;
      const body=base+'\n'+addition.body;
      if(body.length>10000)return reply('This addition would make the note too long. Nothing changed.','clarification',state);
      return this.draft(userId,body,{target});
    },
    wantsText(userId,state){prune();const d=drafts.get(userId);return !!(d && d.id===state?.noteDraftId && (d.collecting || d.body));},
    review(userId,state){
      prune();const d=drafts.get(userId);
      if(!d || d.id!==state?.noteDraftId)return reply('I heard a note-saving request, but I do not have a current note draft. Nothing was saved. Please say “new note” followed by the full note.','clarification');
      if(d.fragment)return this.fragmentReview(userId,state);
      const result=reply('I did not understand that last command. '+(d.body?'Your draft is still: “'+d.body+'”. Say “save note” to save, “replace note with” and the corrected text, or “cancel”.':'Please tell me what the note should say, or say “cancel”.')+' Nothing has been saved.',d.suggestion?'material-review':d.collecting?'collecting':'draft',state);
      if(d.body)result.result.draftText=d.body;
      return result;
    },
    fragmentChoice(userId,state,text){
      prune();const d=drafts.get(userId);
      if(!d || d.id!==state?.noteDraftId || !d.fragment)return null;
      const n=commandWords(text);
      if(/^(?:add|append|include)(?: (?:it|that|those words))?(?: to (?:it|the note|my note|this note))?$/i.test(n))return 'append';
      if(/^(?:replace (?:it|the note|my note|this note)(?: with (?:that|those words))?|use (?:that|those words) instead)$/i.test(n))return 'replace';
      if(/^(?:keep (?:the )?original(?: note| words)?|discard (?:that fragment|those words)|ignore (?:that|those words))$/i.test(n))return 'discard';
      return null;
    },
    fragmentReview(userId,state){
      const d=drafts.get(userId);
      const result=reply('Your draft is still: “'+d.body+'”. I also heard “'+d.fragment+'”. Should I add those words, replace the draft with them, or keep the original? Nothing has been saved.','draft',state);
      result.result.draftText=d.body;return result;
    },
    resolveFragment(userId,state,choice){
      prune();const d=drafts.get(userId);
      if(!d || d.id!==state?.noteDraftId || !d.fragment)return reply('There is no current fragment to resolve. Nothing changed.','clarification');
      const body=choice==='append'?d.body+' '+d.fragment:choice==='replace'?d.fragment:d.body;
      return this.draft(userId,body,{target:d.target});
    },
    capture(userId,state,body){
      prune();const d=drafts.get(userId);
      if(d && d.id===state?.noteDraftId && d.collecting && /^[0-9\s.,:+/-]+$/.test(body))return reply('I only received “'+body+'”. Please repeat the full note so I do not save a stray number. Nothing was saved.','collecting',state);
      if(d && d.id===state?.noteDraftId && d.body){
        // Dictation can arrive in several recognition sessions. Continue the draft;
        // only an explicit replacement command may discard existing words.
        if(d.fragment || /^[0-9\s.,:+/-]+$/.test(body)){d.fragment=body;return this.fragmentReview(userId,state);}
        const combined=d.body+' '+body;
        if(combined.length>10000)return this.review(userId,state);
        return this.draft(userId,combined,{target:d.target});
      }
      return this.revise(userId,state,body);
    },
    revise(userId,state,body){
      const d=drafts.get(userId);
      const target=d && d.id===state?.noteDraftId ? d.target : saved.get(userId)?.ref===state?.savedNoteRef ? saved.get(userId) : null;
      return this.draft(userId,body,{target});
    },
    begin(userId,topic){
      prune();clear(userId);while(drafts.size>=max)drafts.delete(drafts.keys().next().value);
      const id=randomBytes(24).toString('hex');drafts.set(userId,{id,collecting:true,expires:now()+ttl});
      return reply('What would you like the note to say'+(topic?' about '+topic:'')+'? Speak the note text next, or say “cancel”. Nothing has been saved.','collecting',{noteDraftId:id});
    },
    draft(userId,body,{reviewMaterial=true,target=null}={}){
      prune();
      // A preview of an edit to the just-saved note must keep the saved target
      // alive until explicit Save/Cancel. Starting an unrelated new draft still
      // clears that focus through begin()/the caller's normal lifecycle.
      drafts.delete(userId);
      while(drafts.size>=max)drafts.delete(drafts.keys().next().value);
      const id=randomBytes(24).toString('hex');
      const uncertainClay=/\b(?:bmx|(?:v[ -]?mix|b[ -]?mixed)|bm\s+mix|the\s+mix|bee\s+mix)(?=\s+clay\b)/gi;
      const heard=reviewMaterial ? body.match(uncertainClay)?.[0] : null;
      const suggestion=heard ? body.replace(uncertainClay,'B-Mix') : null;
      drafts.set(userId,{id,body,suggestion,target,expires:now()+ttl});
      if(suggestion){
        const result=reply('I heard “'+heard+' clay”. Did you mean “B-Mix clay”? Your full note is: “'+body+'” Say “yes” or “use B mix” to correct the clay name, “keep original words”, or “replace note with” followed by the full corrected note. Nothing has been saved.','material-review',{noteDraftId:id});
        result.result.draftText=body;return result;
      }
      const result=reply((target?'Updated note preview: “':'Draft studio note: “')+body+'” Check all the words. Say “save note” to save, “replace note with” followed by the full corrected text, or “cancel”. Nothing has been saved yet.','draft',{noteDraftId:id});
      result.result.draftText=body;return result;
    },
    confirm(userId,state,save,text=''){
      prune();const draft=drafts.get(userId);
      if(!draft || draft.id!==state?.noteDraftId){
        if(this.canAmend(userId,state))return this.reviewSaved(userId,state);
        return reply('There is no current Studio Note draft to confirm. Please dictate the note again.','clarification');
      }
      if(save && draft.fragment)return this.fragmentReview(userId,state);
      if(save && draft.suggestion){
        const choice=materialChoice(text);
        if(choice || /^yes$/i.test(commandWords(text))) return this.draft(userId,choice==='original'?draft.body:draft.suggestion,{reviewMaterial:false,target:draft.target});
        const result=reply('Please clarify the clay name first. Say “yes” to use B-Mix or “keep original words”. Your note is still: “'+draft.body+'” Nothing has been saved.','material-review',state);
        result.result.draftText=draft.body;return result;
      }
      if(save && materialChoice(text))return reply('There is no clay-name clarification pending. Please check the draft and say “save note”, or say “replace note with” and the full corrected text. Nothing has been saved.','clarification',state);
      if(draft.collecting && save)return reply('Please tell me what the note should say before saving. Nothing has been saved.','collecting',state);
      if(save && incompleteNote(draft.body))return reply('That sounds incomplete: “'+draft.body+'”. Please say the full note again. Nothing has been saved.','incomplete',state);
      // Consume before the synchronous transaction: retries/concurrent confirmations
      // cannot duplicate a note. A failed save requires an explicit new draft.
      clear(userId);
      if(!save)return reply('Canceled the Studio Note draft. Nothing was saved.','canceled');
      let note;
      try{note=draft.target ? updateStudioNote(db,{userId,id:draft.target.noteId,originalBody:draft.target.originalBody,body:draft.body}) : createStudioNote(db,{userId,body:draft.body});}
      catch{return reply('The Studio Note could not be saved, or it changed since your preview. Please open the note and review it before retrying.','failed');}
      const ref=randomBytes(24).toString('hex');
      while(saved.size>=max)saved.delete(saved.keys().next().value);
      saved.set(userId,{ref,noteId:note.id,originalBody:note.body,expires:now()+ttl});
      const result=reply((draft.target?'Updated your Studio Note: “':'Saved your Studio Note: “')+note.body+'”','saved',{savedNoteRef:ref});
      result.result.noteId=note.id;
      result.response.navigation={kind:'page',page:'studioNotes'};
      return result;
    }
  };
}
module.exports={noteEdit,noteAddition,noteReplacement,noteInsertion,dictationBody,materialChoice,noteStart,isNoteText,noteBody,confirmation,cancellation,unclearNoteCommand,createNoteDrafts};
