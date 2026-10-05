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
  if (/^(?:use|yes[,]? use) b[ -]?mix(?: clay)?$/i.test(n)) return 'suggested';
  if (/^(?:keep (?:the )?original words|use (?:the )?original words)$/i.test(n)) return 'original';
  return null;
};
// Parse the request separately from its payload; preserve the user's exact body.
const notePrefix = /^(?:(?:okay|ok|hey)[, ]+)?(?:(?:can|could|would) you\s+|i (?:want|need|would like) to\s+|i[’']d like to\s+)?(?:please\s+)?(?:(?:add|create|make|start|take|write|record)\s+(?:(?:me\s+)?(?:a|another)\s+)?(?:new\s+)?(?:studio\s+)?note|(?:a\s+)?new\s+(?:studio\s+)?note|(?:jot|write)\s+(?:this\s+)?down)\b/i;
function noteRequest(text) {
  if(typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) return null;
  const match=text.trim().match(notePrefix);
  if(!match)return null;
  return text.trim().slice(match[0].length).replace(/^(?:\s+(?:that|saying|of)\b)?\s*[:,.!?]?\s*/, '').trim();
}
// Physical studio plans can be offered as note drafts, never executed as record
// creation. Strip conversational scaffolding for classification only.
function studioPlan(text) {
  if(typeof text!=='string' || /[\x00-\x1f\x7f]/.test(text))return false;
  let n=text.trim().toLowerCase();
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
const commandWords=text=>typeof text==='string' ? text.trim().replace(/[.!?]+$/,'').replace(/^(?:okay|ok)[, ]+/i,'').replace(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?/i,'').replace(/\s+please$/i,'') : '';
const confirmation=(text,hasDraft=false)=>typeof text==='string' && (materialChoice(text) !== null || /^(?:yes|save|save (?:(?:the|this|my) )?note|confirm (?:(?:the|this) )?note)$/i.test(commandWords(text)) || hasDraft && /^(?:save (?:it|that|this)|yes[,]? (?:save (?:it|that|this)|go ahead)|go ahead and save(?: (?:it|that|this))?)$/i.test(commandWords(text)));
// Misheard save-like speech asks for clarification, never a guessed write.
const unclearNoteCommand=text=>typeof text==='string' && /^(?:\S+\s+){0,3}(?:save|confirm)\s+(?:(?:the|this|my)\s+)?note[.!?]*$/i.test(text.trim()) && !confirmation(text) && noteBody(text)===null && !cancellation(text);
const isNoteText=text=>typeof text==='string' && noteRequest(text)===null && !confirmation(text,true) && !cancellation(text) && !unclearNoteCommand(text) && !materialChoice(text) && !/^(?:please )?(?:open|show|go|take|find|search|add|create|make|edit|update|change|replace|delete|remove|save|send|record|log|publish|what|which|when|yes|no|cancel|never mind)\b/i.test(text.trim());
const cancellation=text=>typeof text==='string' && /^(?:no|no thanks|cancel|cancel (?:(?:the|this) )?note|never mind|discard (?:it|that|this|(?:the )?note)|do not save(?: (?:it|that|(?:the )?note))?|don[’']t save(?: (?:it|that|(?:the )?note))?)$/i.test(commandWords(text));
// Deliberately bounded fragment guard; exact saved text is never rewritten.
const incompleteNote = text => /(?:\b(?:and|or|because|with|for|to|the|my|buy|need)|\bi[’']ve been|\bi have been|\bi[’']m going to)[.!?]*$/i.test((text || '').trim());
// Follow-up content stays literal. Explicit non-note destinations never become text.
function noteAddition(text) {
  if(typeof text!=='string' || /[\x00-\x1f\x7f]/.test(text))return null;
  const words=commandWords(text).replace(/^(?:and\s+)?(?:also\s+)?/i,'');
  const m=words.match(/^(?:add(?:\s+in)?|append|include|mention)\s+(.+)$/i);
  if(!m)return null;
  const reference='(?:(?:the|my|this|that)\\s+)?(?:(?:last|latest|previous|current|most recent)\\s+)?(?:studio\\s+)?note(?:\\s+(?:I|we)\\s+(?:just\\s+)?saved)?';
  const suffix=new RegExp('\\s+(?:to|in|into|on)\\s+'+reference+'[.!?]*$','i');
  const prefix=new RegExp('^(?:to|in|into|on)\\s+'+reference+'[,:]?\\s+','i');
  // Parse destination separately from literal content, including destination-first
  // requests. A quoted payload is literal even if it mentions a note itself.
  let body=m[1].trim();
  if(!/^(?:"[\s\S]*"|“[\s\S]*”)$/.test(body))body=body.replace(suffix,'').replace(prefix,'').replace(/\s+to\s+(?:that|it|this)[.!?]*$/i,'').trim();
  body=body.replace(/^(?:"([\s\S]*)"|“([\s\S]*)”)$/,(_,a,b)=>a ?? b);
  if(/\b(?:to|in|on|into)\s+[^.!?]*\bnote\b/i.test(body) && !/^(?:"|“)/.test(m[1]))return {body:'',ambiguous:true,clarification:'Which note do you mean? I can add to the note just saved in this conversation; I will not choose a different note for you.'};
  if(/\b(?:to|on|into|in)\s+(?:(?:the|my|a|this|that)\s+)?(?:piece|glaze collection|glaze library|shopping list|inventory|bowl|vase)\b/i.test(body))return null;
  if(/^(?:a |another |new |studio )*note\b/i.test(body))return null;
  return {body,ambiguous:!body || /^(?:that|it|this)[.!?]*$/i.test(body)};
}
function createNoteDrafts(db,{now=Date.now,ttl=5*60*1000,max=1000}={}) {
  const drafts=new Map();
  const saved=new Map();
  function clear(userId){drafts.delete(userId);saved.delete(userId);}
  function prune(){for(const entries of [drafts,saved])for(const [owner,d] of entries)if(d.expires<=now())entries.delete(owner);}
  const reply=(text,status,state={})=>({result:{tool:'studio.note',status},response:{text},state});
  return {
    clear,
    canAmend(userId,state){prune();return !!(saved.get(userId)?.ref===state?.savedNoteRef && state?.savedNoteRef || state?.noteDraftId && drafts.get(userId)?.id===state.noteDraftId && drafts.get(userId)?.target);},
    reviewSaved(userId,state){
      prune();const target=saved.get(userId);
      if(!target || target.ref!==state?.savedNoteRef)return reply('I no longer have a current saved note in this conversation. Nothing changed.','clarification');
      const current=db.prepare('SELECT body FROM studio_notes WHERE id=? AND user_id=?').get(target.noteId,userId);
      if(!current || current.body!==target.originalBody){clear(userId);return reply('That note changed or is no longer available. Please open it to review the latest text. Nothing changed.','clarification');}
      return reply('Your note is already saved: “'+current.body+'” I still have it for follow-ups. Tell me what to add, for example “Also mention sapphire glaze”. Nothing changed.','clarification',state);
    },
    amend(userId,state,addition){
      prune();
      const d=drafts.get(userId);
      const target=d && d.id===state?.noteDraftId ? d.target : saved.get(userId)?.ref===state?.savedNoteRef ? saved.get(userId) : null;
      if(!target)return reply('Which note should I add that to? I do not have a current saved note in this conversation. Nothing changed.','clarification');
      if(addition.ambiguous)return reply(addition.clarification || 'What words should I add to your note? Please say the words you want included. Nothing changed.','clarification',state);
      const current=db.prepare('SELECT body FROM studio_notes WHERE id=? AND user_id=?').get(target.noteId,userId);
      if(!current || current.body!==target.originalBody){clear(userId);return reply('That note changed or is no longer available. Please open it to review the latest text. Nothing changed.','clarification');}
      const body=(d && d.id===state?.noteDraftId ? d.body : current.body)+'\n'+addition.body;
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
        // Incoming speech is not an implicit instruction to erase existing text.
        d.fragment=body;return this.fragmentReview(userId,state);
      }
      return this.revise(userId,state,body);
    },
    revise(userId,state,body){
      const d=drafts.get(userId);
      return this.draft(userId,body,{target:d && d.id===state?.noteDraftId ? d.target : null});
    },
    begin(userId,topic){
      prune();clear(userId);while(drafts.size>=max)drafts.delete(drafts.keys().next().value);
      const id=randomBytes(24).toString('hex');drafts.set(userId,{id,collecting:true,expires:now()+ttl});
      return reply('What would you like the note to say'+(topic?' about '+topic:'')+'? Speak the note text next, or say “cancel”. Nothing has been saved.','collecting',{noteDraftId:id});
    },
    draft(userId,body,{reviewMaterial=true,target=null}={}){
      prune();clear(userId);
      while(drafts.size>=max)drafts.delete(drafts.keys().next().value);
      const id=randomBytes(24).toString('hex');
      const suggestion=reviewMaterial && /\bbmx(?=\s+clay\b)/i.test(body) ? body.replace(/\bbmx(?=\s+clay\b)/gi,'B-Mix') : null;
      drafts.set(userId,{id,body,suggestion,target,expires:now()+ttl});
      if(suggestion){
        const result=reply('I heard “BMX clay”. Did you mean “B-Mix clay”? Your full note is: “'+body+'” Say “yes” or “use B mix” to correct the clay name, “keep original words”, or “replace note with” followed by the full corrected note. Nothing has been saved.','material-review',{noteDraftId:id});
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
module.exports={noteAddition,dictationBody,materialChoice,noteStart,isNoteText,noteBody,confirmation,cancellation,unclearNoteCommand,createNoteDrafts};
