'use strict';
const {randomUUID}=require('node:crypto');
function generateNoteTitle(body) {
  const text=String(body||'').replace(/\s+/g,' ').trim();
  const subjects=[[/ring dishes?/i,'Ring Dishes'],[/soy sauce dishes?/i,'Soy Sauce Dishes'],[/sapphire float/i,'Sapphire Float'],[/tuscan blue/i,'Tuscan Blue'],[/kiln|firing/i,'Kiln Firing']];
  const subject=subjects.find(([pattern])=>pattern.test(text))?.[1];
  if(subject){
    const suffix=/shopping|buy|order|purchase/i.test(text)?'Shopping List':/test/i.test(text)?'Glaze Test':/b[ -]?mix/i.test(text)?'B-Mix'+(/glaze|float|tuscan/i.test(text)?' & Glazes':''):/make|production|throw/i.test(text)?'Production':'';
    return subject+(suffix?' — '+suffix:'');
  }
  const words=text.replace(/^(?:I (?:need|want|plan) to|remember to)\s+/i,'').split(' ').slice(0,8).join(' ').replace(/[.!?,;]+$/,'').slice(0,70);
  return words?words[0].toUpperCase()+words.slice(1):'Studio Note';
}
// Canonical create operation shared by the existing HTTP/manual form and assistant.
function createStudioNote(db,{userId,title,body}) {
  if(typeof body !== 'string' || !body.trim()) {
    const error=new Error('Body is required');error.status=400;throw error;
  }
  return db.transaction(()=>{
    const id=randomUUID();
    db.prepare('INSERT INTO studio_notes (id, user_id, title, body) VALUES (?, ?, ?, ?)').run(id,userId,title?.trim() || generateNoteTitle(body),body);
    return db.prepare('SELECT * FROM studio_notes WHERE id=? AND user_id=?').get(id,userId);
  })();
}
// Compare the reviewed body inside the owner-scoped transaction; preserve title.
function updateStudioNote(db,{userId,id,originalBody,body}) {
  if(typeof body!=='string' || !body.trim())throw new Error('Body is required');
  return db.transaction(()=>{
    const result=db.prepare('UPDATE studio_notes SET body=? WHERE id=? AND user_id=? AND body=?').run(body,id,userId,originalBody);
    if(result.changes!==1)throw new Error('Note changed or unavailable');
    return db.prepare('SELECT * FROM studio_notes WHERE id=? AND user_id=?').get(id,userId);
  })();
}
module.exports={createStudioNote,updateStudioNote,generateNoteTitle};
