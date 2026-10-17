/* Clayton avatar state bridge: safe, visual-only; never controls recording.
   Integrators must send the assistant's actual state transitions. */
(function(root){
  'use strict';
  const AVATARS=Object.freeze(['bag','bowl','buddy','pebble','moon','microphone']);
  const STATES=Object.freeze(['idle','listening','thinking','speaking','success','error']);
  function normalizeAvatar(value){return AVATARS.includes(value)?value:'bag'}
  function normalizeState(value){return STATES.includes(value)?value:'idle'}
  function createAvatarController({element,storage,key='ql-clayton-avatar',onChange}={}){
    if(!element || typeof element.setAttribute!=='function') throw new TypeError('Avatar element required');
    let saved=null;
    try{saved=storage?.getItem(key)}catch(_){}
    let avatar=normalizeAvatar(saved),state='idle';
    function paint(){
      element.dataset.avatar=avatar;
      element.dataset.state=state;
      element.setAttribute('aria-label','Clayton: '+avatar+', '+state);
      if(typeof onChange==='function')onChange({avatar,state});
    }
    function setAvatar(value){
      avatar=normalizeAvatar(value);
      try{storage?.setItem(key,avatar)}catch(_){}
      paint();return avatar;
    }
    function setState(value){state=normalizeState(value);paint();return state}
    function getSnapshot(){return Object.freeze({avatar,state})}
    paint();
    return Object.freeze({setAvatar,setState,getSnapshot});
  }
  root.ClaytonAvatar={AVATARS,STATES,createAvatarController};
})(typeof globalThis!=='undefined'?globalThis:this);
