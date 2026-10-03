'use strict';
const {randomBytes}=require('node:crypto');
const {createStudioNote}=require('../studio-notes.cjs');
// Extract exact dictated words; no provider rewriting or implicit Piece linking.
function noteBody(text) {
  if(typeof text !== 'string' || /[\x00-\x1f\x7f]/.test(text)) return null;
  const match=text.trim().match(/^(?:please )?(?:add|create|make) (?:a )?studio note(?: that| saying|:)?\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
const confirmation=text=>typeof text==='string' && /^(?:yes|yes please|save (?:the )?note|confirm (?:the )?note)[.!]?$/i.test(text.trim());
const cancellation=text=>typeof text==='string' && /^(?:no|no thanks|cancel|cancel (?:the )?note|never mind)[.!]?$/i.test(text.trim());
function createNoteDrafts(db,{now=Date.now,ttl=5*60*1000,max=1000}={}) {
  const drafts=new Map();
  function clear(userId){drafts.delete(userId);}
  function prune(){for(const [owner,d] of drafts)if(d.expires<=now())drafts.delete(owner);}
  const reply=(text,status,state={})=>({result:{tool:'studio.note',status},response:{text},state});
  return {
    clear,
    draft(userId,body){
      prune();clear(userId);
      while(drafts.size>=max)drafts.delete(drafts.keys().next().value);
      const id=randomBytes(24).toString('hex');
      drafts.set(userId,{id,body,expires:now()+ttl});
      return reply('Draft studio note: “'+body+'” Say “save note” to save these exact words, or “cancel”. Nothing has been saved yet.','draft',{noteDraftId:id});
    },
    confirm(userId,state,save){
      prune();const draft=drafts.get(userId);
      if(!draft || draft.id!==state?.noteDraftId)return reply('There is no current Studio Note draft to confirm. Please dictate the note again.','clarification');
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
module.exports={noteBody,confirmation,cancellation,createNoteDrafts};
