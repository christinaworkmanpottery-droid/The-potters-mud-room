const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx={};vm.runInNewContext(fs.readFileSync(__dirname+'/clayton-avatar-state-bridge.js','utf8'),ctx);
const {createAvatarController,AVATARS,STATES}=ctx.ClaytonAvatar;
function element(){const attrs={};return {dataset:{},setAttribute(k,v){attrs[k]=v},getAttribute(k){return attrs[k]}}}
test('six nonhuman avatar choices available',()=>assert.deepEqual(Array.from(AVATARS),['bag','bowl','buddy','pebble','moon','microphone']));
test('only supported states are accepted',()=>assert.deepEqual(Array.from(STATES),['idle','listening','thinking','speaking','success','error']));
test('defaults to Bag of Clay and idle',()=>{const el=element();const c=createAvatarController({element:el});assert.equal(c.getSnapshot().avatar,'bag');assert.equal(el.dataset.state,'idle')});
test('member avatar selection persists',()=>{const data={};const storage={getItem:k=>data[k],setItem:(k,v)=>{data[k]=v}};const c=createAvatarController({element:element(),storage});c.setAvatar('moon');assert.equal(data['ql-clayton-avatar'],'moon');const next=createAvatarController({element:element(),storage});assert.equal(next.getSnapshot().avatar,'moon')});
test('rejects invalid avatar and state without executing commands',()=>{const el=element();const c=createAvatarController({element:el});assert.equal(c.setAvatar('human'),'bag');assert.equal(c.setState('recording'),'idle');assert.equal(el.getAttribute('aria-label'),'Clayton: bag, idle')});
test('handles unavailable browser storage',()=>{const storage={getItem(){throw Error('denied')},setItem(){throw Error('denied')}};const c=createAvatarController({element:element(),storage});assert.equal(c.setAvatar('microphone'),'microphone')});
test('updates aria label for real state',()=>{const el=element();const c=createAvatarController({element:el});c.setState('listening');assert.equal(el.getAttribute('aria-label'),'Clayton: bag, listening')});
