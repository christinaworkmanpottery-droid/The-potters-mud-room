'use strict';
const {randomUUID}=require('node:crypto');
// Canonical create operation shared by the existing HTTP/manual form and assistant.
function createStudioNote(db,{userId,title,body}) {
  if(typeof body !== 'string' || !body.trim()) {
    const error=new Error('Body is required');error.status=400;throw error;
  }
  return db.transaction(()=>{
    const id=randomUUID();
    db.prepare('INSERT INTO studio_notes (id, user_id, title, body) VALUES (?, ?, ?, ?)').run(id,userId,title || null,body);
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
module.exports={createStudioNote,updateStudioNote};
