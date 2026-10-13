const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/ql-assistant.js'),'utf8');
test('voice visual signals are read-only and tied to actual session state',()=>{
  assert.match(source,/function sessionState\(state, message\)/);
  assert.match(source,/window\.dispatchEvent\(new CustomEvent\('clayton:' \+ visualEvent\)\)/);
  for(const state of ['listening','processing','speaking','ready','recovering','unavailable','stopped'])assert.match(source,new RegExp('\\b'+state+":'"));
});
test('TTS completion notifies visuals while preserving listening restart',()=>{
  assert.match(source,/window\.dispatchEvent\(new CustomEvent\('clayton:replyFinished'\)\);\s*listenAgain\(\)/);
});
test('speech interruption notifies visuals without starting overlapping microphone',()=>{
  assert.match(source,/turn\.interrupted = true;\s*window\.dispatchEvent\(new CustomEvent\('clayton:speechAborted'\)\)/);
  assert.match(source,/sole microphone owner until onend/);
});
test('visual event hooks never trigger note writes or recording',()=>{
  const block=source.match(/function sessionState\(state, message\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(block);
  assert.doesNotMatch(block,/fetch\(|startVoice\(|\.abort\(|\.start\(|saveNote\(/);
});
