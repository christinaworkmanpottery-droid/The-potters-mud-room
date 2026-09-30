const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),m=require('../ql/shop-release-asset.json'),bytes=fs.readFileSync(path.join(root,m.path));
test('release original uses exact built-in path',()=>assert.equal(m.path,'public/shop/the-potters-mud-log.pdf'));
test('release original preserves authoritative size and hash',()=>{assert.equal(bytes.length,91028);assert.equal(bytes.length,m.size);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),m.sha256);});
test('release original has PDF header and trailer',()=>{assert.equal(bytes.subarray(0,8).toString(),'%PDF-1.3');assert.match(bytes.subarray(-100).toString(),/%%EOF/);});
test('preview is distinct from original',()=>assert.notDeepEqual(bytes,fs.readFileSync(path.join(root,'public/shop/mud-log-preview.pdf'))));
test('rehearsal consumes tracked asset without generator',()=>{assert.doesNotMatch(fs.readFileSync(path.join(root,'ql/rehearsal/fixture.cjs'),'utf8'),/generateMudLogPDF|generate-pdf/);assert.equal(m.mime,'application/pdf');});
