'use strict';
// Run before npm ci/startup in a disposable clean checkout. No generation or restore.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),asset=require('./shop-release-asset.json');
function command(bin,args){const r=spawnSync(bin,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout;}
assert.equal(command('git',['status','--porcelain','--untracked-files=all']).trim(),'','Require a clean checkout');
assert.equal(command('git',['ls-files','--error-unmatch',asset.path]).trim(),asset.path);
const ignored=spawnSync('git',['check-ignore',asset.path],{cwd:root});assert.equal(ignored.status,1);
const bytes=fs.readFileSync(path.join(root,asset.path));assert.equal(bytes.length,asset.size);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256);
const head=spawnSync('git',['show','HEAD:'+asset.path],{cwd:root,maxBuffer:1024*1024});assert.equal(head.status,0);assert.deepEqual(head.stdout,bytes);
assert.match(command('pdfinfo',[asset.path]),new RegExp('Pages:\\s+'+asset.pages+'\\b'));
assert.match(command('pdftotext',[asset.path,'-']),/A Printable Pottery Journal/);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'shop-pdf-decode-'));
try {command('pdftoppm',['-scale-to','64','-png',asset.path,path.join(tmp,'page')]);assert.equal(fs.readdirSync(tmp).length,asset.pages);} finally {fs.rmSync(tmp,{recursive:true,force:true});}
assert.notDeepEqual(bytes,fs.readFileSync(path.join(root,'public/shop/mud-log-preview.pdf')));
console.log(JSON.stringify({result:'PASS',commit:command('git',['rev-parse','HEAD']).trim(),...asset,allPagesDecoded:true,generatorRequired:false,restoreRequired:false}));
