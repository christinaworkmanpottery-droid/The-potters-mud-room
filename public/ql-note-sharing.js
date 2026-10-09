/* Compose handoff only. Device contacts stay on this page; never uploaded. */
(() => {
 'use strict';
 let panel=null, version=0;
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 function clear(){version++;panel?.remove();panel=null;}
 function present(data,{active,onHandoff=()=>{}}){
  clear();
  if(!data||typeof data.title!=='string'||typeof data.body!=='string'||data.body.length>10000||!['email','text','native'].includes(data.method))return;
  const own=version, expires=Date.now()+5*60*1000;
  const valid=()=>own===version&&Date.now()<expires&&active();
  panel=node('section');panel.id='qlNoteSharing';panel.setAttribute('aria-label','Review note sharing');
  Object.assign(panel.style,{position:'fixed',top:'12px',left:'12px',right:'12px',zIndex:'10002',maxHeight:'55vh',overflow:'auto',background:'#fff',color:'#252525',border:'2px solid #654536',borderRadius:'12px',padding:'16px'});
  const title=node('h3','Share '+data.title), status=node('p','Prepared — nothing sent.'), preview=node('details'), summary=node('summary','Review saved note'), body=node('p',data.body);body.style.whiteSpace='pre-wrap';preview.append(summary,body);
  const recipientLabel=node('label','Recipient'), recipient=node('input');recipient.type='text';recipient.value=data.recipient;recipient.setAttribute('aria-label','Recipient name');
  const address=node('input');address.type='text';address.value=data.address;address.setAttribute('aria-label','Recipient email or phone');
  const method=node('select');method.setAttribute('aria-label','Delivery method');
  for(const [value,label] of [['email','Email'],['text','Text message'],['native','Native sharing']]){const option=node('option',label);option.value=value;method.append(option);}method.value=data.method;
  const picker=node('button','Choose phone contact');picker.type='button';
  const review=node('button','Review recipient and method');review.type='button';
  const launch=node('button','Confirm and open compose');launch.type='button';launch.hidden=true;
  const cancel=node('button','Cancel sharing');cancel.type='button';cancel.onclick=clear;
  const reset=()=>{launch.hidden=true;status.textContent='Prepared — review your choices. Nothing sent.';};
  for(const field of [recipient,address,method])field.addEventListener('input',reset);
  const supportsPicker=!!navigator.contacts?.select;
  picker.hidden=!supportsPicker;
  if(!supportsPicker)panel.append(node('p','Phone contact access is unavailable in this browser. Enter a recipient here, or choose Native sharing and select them in your device’s share interface.'));
  picker.onclick=async()=>{
   if(!valid()){clear();return;}
   reset();
   try{
    const fields=await navigator.contacts.getProperties?.()||['name','email','tel'];
    // Request only the chosen method’s field; never import the address book.
    const wanted=['name',method.value==='email'?'email':'tel'].filter(f=>fields.includes(f));
    const contacts=await navigator.contacts.select(wanted,{multiple:false});
    if(!valid())return;
    if(!contacts.length){status.textContent='Contact selection canceled. Nothing sent.';return;}
    const c=contacts[0];recipient.value=c.name?.[0]||'';
    const addresses=method.value==='email'?c.email:c.tel;
    if(addresses?.length===1)address.value=addresses[0];
    else {address.value='';status.textContent='Choose one of this contact’s addresses: '+(addresses||[]).join('; ')+'. Enter the intended one above.';}
   }catch(e){if(valid())status.textContent=e.name==='AbortError'?'Contact selection canceled. Nothing sent.':'Contact access was denied or unavailable. Enter a recipient or use native sharing.';}
  };
  function safeAddress(){const a=address.value.trim();return method.value==='native'||(method.value==='email'?/^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+\.[^\s@,;<>\r\n]+$/.test(a):/^\+?[0-9 ()-]{3,30}$/.test(a));}
  review.onclick=()=>{
   if(!valid()){clear();return;}
   if(!safeAddress()){status.textContent='Enter one valid '+(method.value==='email'?'email address':'phone number')+'. Nothing sent.';return;}
   status.textContent='Confirm: “'+data.title+'” by '+method.value+(method.value==='native'?' — choose and verify the recipient in the share interface.':' to '+(recipient.value.trim()||address.value.trim())+' ('+address.value.trim()+').');
   launch.textContent=method.value==='native'?'Confirm and open share interface':'Confirm and open '+method.value+' compose';launch.hidden=false;
  };
  launch.onclick=async()=>{
   if(!valid()||!safeAddress()){clear();return;}
   const delivery=method.value,a=address.value.trim();launch.hidden=true;
   // Caller deliberately pauses microphone before handing control to another app.
   onHandoff();
   if(delivery==='native'){
    if(!navigator.share){status.textContent='Native sharing unavailable. Choose email or text instead.';return;}
    try{await navigator.share({title:data.title,text:data.title+'\n\n'+data.body});if(own===version)status.textContent='Returned from sharing. Delivery is not confirmed.';}
    catch(e){if(own===version)status.textContent=e.name==='AbortError'?'Sharing canceled. Nothing sent by Clayton.':'Sharing failed. Nothing sent by Clayton. Please review and try again.';}
   }else{
    const text=data.title+'\n\n'+data.body;
    const url=delivery==='email'?'mailto:'+encodeURIComponent(a)+'?subject='+encodeURIComponent(data.title)+'&body='+encodeURIComponent(text):'sms:'+a.replace(/[^+0-9]/g,'')+(/iPad|iPhone|iPod/.test(navigator.userAgent)?'&':'?')+'body='+encodeURIComponent(text);
    const link=node('a');link.href=url;panel.append(link);link.click();link.remove();
    status.textContent='Compose requested. Review and send in your messaging app. Delivery is not confirmed.';
   }
  };
  panel.append(title,preview,recipientLabel,recipient,address,method,picker,review,launch,cancel,status);document.body.append(panel);
 }
 window.QLNoteSharing={present,clear};
})();
