'use strict';
const {randomBytes}=require('node:crypto');
const {createStudioNote}=require('../studio-notes.cjs');
// Extract dictated words; command suffixes are not note content. Material
// alternatives are explicit proposals and never silently replace user words.
function dictationBody(text) {
  return text.trim().replace(/(?<!\bto)\s+(?:and\s+)?save(?:\s+(?:the\s+)?note)?[.!]?$/i, '').trim();
}
const materialChoice = text => {
  const n = (text || '').trim().replace(/[.!?]$/, '');
  if (/^(?:use|yes[,]? use) b[ -]?mix(?: clay)?$/i.test(n)) return 'suggested';
  if (/^(?:keep (?:the )?original words|use (?:the )?original words)$/i.test(n)) return 'original';
  return null;
};
function noteBody(text) {
  if(typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) return null;
  const correction=text.trim().match(/^(?:replace (?:the )?note with|change (?:the )?note to)\s+(.+)$/i);
  if(correction)return correction[1].trim();
  const match=text.trim().match(/^(?:please )?(?:add|create|make) (?:(?:a|another) )?(?:new )?(?:studio )?note(?: that| saying|:)?\s+(.+)$/i);
  return match ? dictationBody(match[1]) || null : null;
}
function noteStart(text) {
  if(typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) return null;
  const match=text.trim().match(/^(?:please )?(?:add|create|make) (?:(?:a|another) )?(?:new )?(?:studio )?note(?: about (.+?))?[.!]?$/i);
  return match ? {topic:match[1] || ''} : null;
}
const isNoteText=text=>typeof text==='string' && !materialChoice(text) && !/^(?:please )?(?:open|show|go|take|find|search|add|create|make|edit|update|change|replace|delete|remove|save|send|record|log|publish|what|which|when|yes|no|cancel|never mind)\b/i.test(text.trim());
const confirmation=text=>typeof text==='string' && (materialChoice(text) !== null || /^(?:yes|yes please|save|save (?:the )?note|confirm (?:the )?note)[.!]?$/i.test(text.trim()));
const cancellation=text=>typeof text==='string' && /^(?:no|no thanks|cancel|cancel (?:the )?note|never mind)[.!]?$/i.test(text.trim());
// Deliberately bounded fragment guard; exact saved text is never rewritten.
const incompleteNote = text => /(?:\b(?:and|or|because|with|for|to|the|my|buy|need)|\bi[’']ve been|\bi have been|\bi[’']m going to)[.!?]*$/i.test((text || '').trim());
function createNoteDrafts(db,{now=Date.now,ttl=5*60*1000,max=1000}={}) {
  const drafts=new Map();
  function clear(userId){drafts.delete(userId);}
  function prune(){for(const [owner,d] of drafts)if(d.expires<=now())drafts.delete(owner);}
  const reply=(text,status,state={})=>({result:{tool:'studio.note',status},response:{text},state});
  return {
    clear,
    wantsText(userId,state){prune();const d=drafts.get(userId);return !!(d && d.id===state?.noteDraftId && (d.collecting || d.body));},
    begin(userId,topic){
      prune();clear(userId);while(drafts.size>=max)drafts.delete(drafts.keys().next().value);
      const id=randomBytes(24).toString('hex');drafts.set(userId,{id,collecting:true,expires:now()+ttl});
      return reply('What would you like the note to say'+(topic?' about '+topic:'')+'? Speak the note text next, or say “cancel”. Nothing has been saved.','collecting',{noteDraftId:id});
    },
    draft(userId,body,{reviewMaterial=true}={}){
      prune();clear(userId);
      while(drafts.size>=max)drafts.delete(drafts.keys().next().value);
      const id=randomBytes(24).toString('hex');
      const suggestion=reviewMaterial && /\bbmx(?=\s+clay\b)/i.test(body) ? body.replace(/\bbmx(?=\s+clay\b)/gi,'B-Mix') : null;
      drafts.set(userId,{id,body,suggestion,expires:now()+ttl});
      if(suggestion){
        const result=reply('I heard “BMX clay”. Did you mean “B-Mix clay”? Your full note is: “'+body+'” Say “yes” or “use B mix” to correct the clay name, “keep original words”, or “replace note with” followed by the full corrected note. Nothing has been saved.','material-review',{noteDraftId:id});
        result.result.draftText=body;return result;
      }
      const result=reply('Draft studio note: “'+body+'” Check all the words. Say “save note” to save, “replace note with” followed by the full corrected text, or “cancel”. Nothing has been saved yet.','draft',{noteDraftId:id});
      result.result.draftText=body;return result;
    },
    confirm(userId,state,save,text=''){
      prune();const draft=drafts.get(userId);
      if(!draft || draft.id!==state?.noteDraftId)return reply('There is no current Studio Note draft to confirm. Please dictate the note again.','clarification');
      if(save && draft.suggestion){
        const choice=materialChoice(text);
        if(choice || /^yes(?: please)?[.!?]?$/i.test(text.trim())) return this.draft(userId,choice==='original'?draft.body:draft.suggestion,{reviewMaterial:false});
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
      try{note=createStudioNote(db,{userId,body:draft.body});}
      catch{return reply('The Studio Note could not be saved. Please dictate it again to retry.','failed');}
      const result=reply('Saved your Studio Note: “'+note.body+'”','saved');
      result.result.noteId=note.id;
      result.response.navigation={kind:'page',page:'studioNotes'};
      return result;
    }
  };
}
module.exports={dictationBody,materialChoice,noteStart,isNoteText,noteBody,confirmation,cancellation,createNoteDrafts};
