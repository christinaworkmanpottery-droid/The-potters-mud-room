/* Isolated Clayton visual-state adapter.
 * Read-only visual notifications; never starts/stops speech recognition,
 * never saves notes, and never calls a backend.
 */
(function(root){
  'use strict';
  const EVENTS=Object.freeze({
    ready:'idle',listening:'listening',processing:'thinking',
    replyStarted:'speaking',replyFinished:'idle',\n    speechAborted:'error',speechUnavailable:'error',
    noteSaved:'success',noteUpdated:'success',noteDeleted:'success',\n    cancelled:'idle',failed:'error',
    stopped:'idle'
  });
  function connect({avatarController,source}={}){
    if(!avatarController||typeof avatarController.setState!=='function')throw new TypeError('avatarController required');
    if(!source||typeof source.addEventListener!=='function'||typeof source.removeEventListener!=='function')throw new TypeError('event source required');
    let connected=true;
    const listeners=[];
    for(const [event,state] of Object.entries(EVENTS)){
      const listener=()=>{if(connected)avatarController.setState(state)};
      source.addEventListener('clayton:'+event,listener);
      listeners.push(['clayton:'+event,listener]);
    }
    return Object.freeze({disconnect(){
      if(!connected)return;
      connected=false;
      for(const [event,listener] of listeners)source.removeEventListener(event,listener);
      avatarController.setState('idle');
    }});
  }
  root.ClaytonVisualStateAdapter=Object.freeze({EVENTS,connect});
})(typeof globalThis!=='undefined'?globalThis:this);
