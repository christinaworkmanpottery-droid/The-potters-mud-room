'use strict';
const {randomBytes}=require('node:crypto');
const {generateNoteTitle}=require('../studio-notes.cjs');
const clean=s=>s.trim().replace(/[.!?]+$/,'').replace(/^(?:(?:hey|hi|okay|ok)[, ]+)?(?:clayton[, ]+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?/i,'').replace(/\s+please$/i,'');
const norm=s=>s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const yes=s=>/^(?:yes|yes please|confirm|go ahead|yes[,]? (?:delete it|send it|go ahead))$/i.test(s);
const no=s=>/^(?:no|no thanks|cancel(?: (?:sending|sharing|deletion))?|never mind|nevermind)$/i.test(s);
function social(text){
 const s=clean(text).replace(/[, ]+clayton$/i,'');
 if(/^(?:thanks|thank you)(?: so much)?$/i.test(s))return "You’re welcome!";
 if(/^you(?:'|’)re welcome$/i.test(s))return 'Thanks!';
 if(/^(?:okay|ok|perfect|great)$/i.test(s))return 'Okay!';
 if(/^(?:that(?:'|’)s all|that is all)$/i.test(s))return 'All set. I’m here when you need me.';
 if(/^(?:goodbye|bye|stop listening|end (?:the )?(?:session|conversation))$/i.test(s))return 'Goodbye!';
 return null;
}
function parse(text){
 const s=clean(text);let m;
 if((m=s.match(/^(delete|remove)\s+((?:(?:my|the|that|this)\s+)?(?:(?:last|latest|previous)\s+)?(?:studio\s+)?note(?:\s+(?:about|I created|I made|from)\s+.+)?|(?:my|the)\s+.+\s+note)$/i)))return {action:'delete',query:m[2]};
 if((m=s.match(/^(open|find|read|show|edit)\s+(?:me\s+)?(.+\bnote\b.*)$/i)))return {action:m[1].toLowerCase()==='edit'?'edit':m[1].toLowerCase()==='read'?'read':'open',query:m[2]};
 if((m=s.match(/^show (?:me )?(?:my )?(?:most recent|latest|last) (five|\d+) notes$/i)))return {action:'list',limit:Math.min(20,Math.max(1,Number(m[1])||5))};
 if((m=s.match(/^rename\s+(.+?note)(?:\s+to\s+(.+))?$/i)))return {action:'rename',query:m[1],title:m[2]};
 if((m=s.match(/^(?:generate|create|give)\s+(?:a )?title (?:for |to )?(.+note)$/i)))return {action:'title',query:m[1]};
 if((m=s.match(/^add (?:something|more|content) to (.+note)$/i)))return {action:'append',query:m[1]};
 if((m=s.match(/^add (.+) to (.+note)$/i)))return {action:'append',query:m[2],addition:m[1]};
 if((m=s.match(/^(send|email|text|share)\s+(.+?)\s+(?:to|with)\s+(.+)$/i)))return {action:'share',query:m[2],recipient:m[3],method:/^(email|text)$/i.test(m[1])?m[1].toLowerCase():null};
 return null;
}
function createNoteManagement(db,notes,{now=Date.now}={}){
 const pending=new Map();
 const reply=(text,state={},status='clarification',extra={})=>({result:{tool:'studio.note.manage',status,...extra},response:{text},state});
 function remember(userId,state,operation,text,status='clarification'){
  for(const [u,p] of pending)if(p.expires<=now())pending.delete(u);
  while(pending.size>=1000)pending.delete(pending.keys().next().value);
  const ref=randomBytes(24).toString('hex');pending.set(userId,{...operation,ref,expires:now()+5*60*1000});
  return reply(text,{...state,noteManagementRef:ref},status);
 }
 function get(userId,id){return db.prepare('SELECT * FROM studio_notes WHERE id=? AND user_id=?').get(id,userId);}
 function all(userId){return db.prepare('SELECT * FROM studio_notes WHERE user_id=?').all(userId).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')) || String(b.id).localeCompare(String(a.id)));}
 function focus(userId,note){return notes.selectSaved(userId,note.id);}
 const label=n=>n.title || generateNoteTitle(n.body);
 function matches(userId,query,state,timeZone){
  const q=norm(query), rows=all(userId);
  if(/^(?:that|this|the|my)? ?(?:studio )?note$/.test(q)){
   const selected=notes.selectedId(userId,state);return selected?rows.filter(n=>n.id===selected):[];
  }
  if(/\b(?:last|latest|previous|most recent)\b/.test(q)){
   if(!rows.length)return [];
   // Timestamp ties remain ambiguous rather than guessing an identity.
   return rows.filter(n=>n.created_at===rows[0].created_at);
  }
  if(/\b(?:yesterday|today)\b/.test(q)){
   const localDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);
   const today=localDate(new Date(now()));
   const date=/yesterday/.test(q)?new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10):today;
   return rows.filter(n=>{const value=new Date(String(n.created_at||'').replace(' ','T')+(/Z$|[+-]\d\d:\d\d$/.test(n.created_at||'')?'':'Z'));return Number.isFinite(value.getTime())&&localDate(value)===date;});
  }
  const terms=q.replace(/^(?:my|the) /,'').replace(/\b(?:studio|note|notes|about|where|i|mentioned)\b/g,' ').trim().split(/\s+/).filter(Boolean);
  return terms.length?rows.filter(n=>terms.every(t=>norm((n.title||'')+' '+n.body).includes(t))):[];
 }
 function contactChoices(userId,op,state){
  if(/\b(?:phone|device)(?: contacts)?\b/i.test(op.recipient))return remember(userId,state,{...op,step:'confirm',device:true},'Use your phone’s contact picker where available, or choose the recipient in your email or text app. Prepare '+op.title+' for '+(op.method||'native sharing')+'? Say yes or cancel.');
  const query=norm(op.recipient).replace(/^(?:my|the) /,'').replace(/ (?:from|in) (?:my |your )?(?:mud room|app)(?: contacts)?$/,'');
  const rows=db.prepare('SELECT id,name,email,phone,role,notes FROM contacts WHERE user_id=?').all(userId).filter(c=>norm(c.name).includes(query)||norm(c.role||'')===query||norm(c.email||'')===query||norm(c.phone||'')===query||norm(c.notes||'').split(' ').includes(query));
  if(!rows.length)return remember(userId,state,{...op,step:'recipient'},'No matching Mud Room contact. Say another saved contact name, “from my phone”, or “cancel sending”.');
  return remember(userId,state,{...op,step:'contact',candidates:rows.slice(0,10).map(c=>c.id)},rows.length+' Mud Room contact'+(rows.length===1?' matches: ':'s match: ')+rows.slice(0,10).map((c,i)=>(i+1)+'. '+c.name+(c.role?' ('+c.role+')':'')).join('; ')+'. Choose a number, or say “from my phone” for device contacts.');
 }
 function shareReady(userId,op,state){
  if(!op.method)return remember(userId,state,{...op,step:'method'},'Would you like to text, email, or use native sharing?');
  const c=op.contactId&&db.prepare('SELECT id,name,email,phone FROM contacts WHERE id=? AND user_id=?').get(op.contactId,userId);
  if(!op.device&&!c)return reply('That contact is no longer available. Please choose the recipient again.',state);
  if(c&&op.method!=='native'&&!(op.method==='email'?c.email:c.phone))return remember(userId,state,{...op,step:'method'},'That contact has no '+(op.method==='email'?'email address':'phone number')+'. Choose another delivery method or cancel.');
  const address=c?(op.method==='email'?c.email:op.method==='text'?c.phone:'recipient selected in share sheet'):'';
  return remember(userId,state,{...op,step:'confirm',address,contactName:c?.name},'Prepare “'+op.title+'” '+(c?'for '+c.name+' ('+address+') ':'with a recipient selected on your device ')+'by '+op.method+'? Say yes or cancel. You will review and send in the compose/share interface.');
 }
 function perform(userId,note,op,state){
  const selected=focus(userId,note), title=label(note);
  if(op.action==='delete')return remember(userId,selected,{...op,step:'delete',id:note.id,body:note.body,title:note.title},'Do you want me to delete “'+title+'”? Say yes or cancel.');
  if(op.action==='rename'||op.action==='title'){
   const newTitle=op.action==='title'?generateNoteTitle(note.body):op.title;
   if(op.action==='title'&&note.title&&note.title!=='Untitled Note')return reply('This note already has a title. Say “rename that note to” followed by the new title.',selected);
   if(!newTitle)return remember(userId,selected,{...op,step:'rename',id:note.id},'What should I call “'+title+'”?');
   if(!newTitle.trim()||newTitle.length>100)return reply('Please use a title of 1 to 100 characters.',selected);
   db.prepare('UPDATE studio_notes SET title=? WHERE id=? AND user_id=?').run(newTitle.trim(),note.id,userId);
   return reply('Renamed to “'+newTitle.trim()+'”.',selected,'renamed',{noteId:note.id,title:newTitle.trim()});
  }
  if(op.action==='share')return contactChoices(userId,{...op,id:note.id,body:note.body,title,step:'recipient'},selected);
  if(op.action==='append')return op.addition?notes.amend(userId,selected,{body:op.addition}):remember(userId,selected,{step:'append',id:note.id},'What would you like to add to “'+title+'”?');
  if(op.action==='edit')return notes.edit(userId,selected,{kind:'review'});
  const r=reply((op.action==='read'?title+': '+note.body:'Opening “'+title+'”.'),selected,'found',{noteId:note.id});
  r.response.navigation={kind:'record',type:'studio-note',id:note.id};return r;
 }
 function handle(text,userId,state={},timeZone='UTC'){
  if(/[\x00-\x1f\x7f]/.test(text))return null;
  state=state||{};const s=clean(text), greeting=social(text);
  if(greeting){const r=reply(greeting,state,'conversation');if(greeting==='Goodbye!'){pending.delete(userId);r.response.endSession=true;}return r;}
  const held=pending.get(userId);
  const p=held && held.ref===state.noteManagementRef&&held.expires>now()?held:null;
  if(no(s)&&p){pending.delete(userId);return reply('Canceled. Nothing was deleted or sent.',{savedNoteRef:state.savedNoteRef},'canceled');}
  if(p&&/^(?:actually[,]? )?(?:send (?:it|that) |use )?(?:by )?(?:text(?: her| him)?|email(?: her| him)?|native sharing)(?: instead)?$/i.test(s)&&p.action==='share'){
   return shareReady(userId,{...p,method:/email/i.test(s)?'email':/text/i.test(s)?'text':'native'},state);
  }
  if(p&&p.action==='share'&&/^(?:from my phone|phone contacts|device contacts)$/i.test(s))return shareReady(userId,{...p,device:true,contactId:null,method:p.method||'native'},state);
  const op=parse(text);
  if(op){
   if(['open','edit','append'].includes(op.action)&&/^(?:(?:the|my|this|that) )?(?:(?:last|latest|current|previous|live) )?note$/i.test(op.query)&& (notes.wantsText(userId,state)||notes.canAmend(userId,state)))return null;
   pending.delete(userId);
   if(notes.wantsText(userId,state))return reply('Please save or cancel the current draft before managing another saved note.',state);
   if(op.action==='list'){
    const rows=all(userId).slice(0,op.limit);
    return remember(userId,state,{step:'note',action:'open',candidates:rows.map(n=>n.id)},rows.length?rows.map((n,i)=>(i+1)+'. '+label(n)+' — '+String(n.created_at||'date unavailable')).join('; ')+'. Which note?':'You have no saved notes.','choices');
   }
   const rows=matches(userId,op.query,state,timeZone);
   if(rows.length===1)return perform(userId,rows[0],op,state);
   if(!rows.length)return reply('Which note do you mean? I could not find that saved note. Try words from its title or content.',state,'clarification');
   return remember(userId,state,{...op,step:'note',candidates:rows.slice(0,10).map(n=>n.id)},rows.length+' notes match'+(/yesterday|today/i.test(op.query)?' the '+timeZone+' date':'')+': '+rows.slice(0,10).map((n,i)=>(i+1)+'. '+label(n)+' — '+String(n.created_at||'date unavailable')).join('; ')+'. Which number, or a more specific search?','choices');
  }
  if(!p){if(/^(?:never mind|nevermind|cancel sending|cancel sharing)$/i.test(s)&&!notes.wantsText(userId,state))return reply('Okay. Nothing sent.',state,'canceled');return null;}
  const number=s.match(/^(?:(?:the|number|option) )?(first|second|third|fourth|fifth|\d+)(?: one)?$/i);
  const index=number?({first:1,second:2,third:3,fourth:4,fifth:5}[number[1].toLowerCase()]||Number(number[1]))-1:-1;
  if(p.step==='note'){
   const rows=p.candidates.map(id=>get(userId,id));
   const exact=rows.filter(n=>n&&norm(label(n))===norm(s));const n=index>=0?rows[index]:exact.length===1?exact[0]:null;
   if(!n)return reply('Please choose a listed number or search with more specific words.',state);
   pending.delete(userId);return perform(userId,n,p,state);
  }
  if(p.step==='contact'){
   const rows=p.candidates.map(id=>db.prepare('SELECT id,name FROM contacts WHERE id=? AND user_id=?').get(id,userId));
   const exact=rows.filter(c=>c&&norm(c.name)===norm(s));const c=index>=0?rows[index]:exact.length===1?exact[0]:null;
   if(!c)return reply('Please choose the contact number, or say “from my phone”.',state);
   return shareReady(userId,{...p,contactId:c.id,device:false},state);
  }
  if(p.step==='recipient')return contactChoices(userId,{...p,recipient:s},state);
  if(p.step==='method')return reply('Please choose email, text, or native sharing.',state);
  if(p.step==='rename'){
   const note=get(userId,p.id);pending.delete(userId);
   return note?perform(userId,note,{action:'rename',title:s.replace(/^(?:call it|name it) /i,'')},state):reply('That note is no longer available.',state);
  }
  if(p.step==='append'){
   if(/^(?:save|delete|remove|send|cancel|edit|replace)\b/i.test(s))return reply('Tell me the words to add, or cancel.',state);
   pending.delete(userId);return notes.amend(userId,state,{body:text});
  }
  if(p.step==='delete'){
   if(!yes(s))return reply('Say yes to delete the identified note, or cancel.',state);
   pending.delete(userId);
   const result=db.prepare('DELETE FROM studio_notes WHERE id=? AND user_id=? AND body=? AND title IS ?').run(p.id,userId,p.body,p.title);
   notes.clear(userId);
   return reply(result.changes===1?'Deleted “'+(p.title||generateNoteTitle(p.body))+'”.':'The note changed or is unavailable. Nothing was deleted.',{},result.changes===1?'deleted':'failed',{noteId:p.id});
  }
  if(p.step==='confirm'){
   if(!yes(s))return reply('Say yes to prepare sharing, or cancel sending.',state);
   pending.delete(userId);const note=get(userId,p.id);
   if(!note||note.body!==p.body||label(note)!==p.title)return reply('That note changed. Please start sharing again.',state,'failed');
   if(!p.device){
    const c=db.prepare('SELECT name,email,phone FROM contacts WHERE id=? AND user_id=?').get(p.contactId,userId);
    if(!c||c.name!==p.contactName||(p.method!=='native'&&(p.method==='email'?c.email:c.phone)!==p.address))return reply('That contact changed. Please choose the recipient again.',state,'failed');
   }
   const r=reply('Sharing prepared. Tap the sharing card to review the recipient and open your compose/share interface. Nothing has been sent.',{...focus(userId,note)},'prepared');
   r.response.share={noteId:note.id,title:p.title,body:p.body,method:p.method||'native',device:!!p.device,recipient:p.contactName||'',address:p.address||''};return r;
  }
  return null;
 }
 return {handle};
}
module.exports={createNoteManagement,parse,social};
