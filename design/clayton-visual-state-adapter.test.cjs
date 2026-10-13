const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx={};vm.runInNewContext(fs.readFileSync(__dirname+'/clayton-visual-state-adapter.js','utf8'),ctx);
const {connect,EVENTS}=ctx.ClaytonVisualStateAdapter;
function setup(){
  const listeners=new Map(),states=[];
  const source={
    addEventListener(name,fn){listeners.set(name,fn)},
    removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name)},
    emit(name){listeners.get('clayton:'+name)?.()}
  };
  const avatarController={setState(value){states.push(value)}};
  return {source,states,listeners,avatarController};
}
test('supports listening thinking speaking and idle events',()=>{
 const s=setup();connect(s);
 for(const event of ['listening','processing','replyStarted','replyFinished'])s.source.emit(event);
 assert.deepEqual(s.states,['listening','thinking','speaking','idle']);
});
test('note saved only updates visual state',()=>{
 const s=setup();connect(s);s.source.emit('noteSaved');assert.deepEqual(s.states,['success']);
});
test('failed cancelled and stopped return appropriate visual states',()=>{
 const s=setup();connect(s);
 ['failed','cancelled','stopped'].forEach(e=>s.source.emit(e));
 assert.deepEqual(s.states,['error','idle','idle']);
});
test('disconnect removes all handlers and returns idle',()=>{
 const s=setup();const adapter=connect(s);assert.equal(s.listeners.size,Object.keys(EVENTS).length);
 adapter.disconnect();assert.equal(s.listeners.size,0);assert.deepEqual(s.states,['idle']);
 s.source.emit('listening');assert.deepEqual(s.states,['idle']);
 adapter.disconnect();assert.deepEqual(s.states,['idle']);
});
test('requires explicit controller and event source',()=>{
 assert.throws(()=>connect({}),/avatarController required/);
 assert.throws(()=>connect({avatarController:{setState(){}}}),/event source required/);
});
