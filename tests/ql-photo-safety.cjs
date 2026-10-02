'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const sharp = require('sharp');
const rt = require('../ql/photo-eval/runtime.cjs');
const { LIMITS, createPhotoQuerySafety } = require('../ql/photo-query-safety.cjs');
const corpus = path.resolve(__dirname, '../ql/photo-eval/corpus');
let s, png, initial;
const files = () => fs.readdirSync(path.join(s.dir,'data/uploads')).sort();
async function post(bytes, {owner='A',type='image/png',route='/api/pieces/photo-search',extra=false,filename='query-private.png'}={}) {
  const body = new FormData();
  if(bytes!==null) body.append('photo', new Blob([bytes],{type}),filename);
  if(extra) body.append('photo',new Blob([png],{type:'image/png'}),'extra.png');
  const headers=owner===null?{}:{Authorization:'Bearer '+(owner==='invalid'?'bad':s.token(owner))};
  const res=await fetch(s.base+route,{method:'POST',headers,body});
  const json=await res.json(); assert.deepEqual(files(),initial,'no query file written');
  return {res,json};
}
test.before(async()=>{s=await rt.start();rt.seed(s,corpus,JSON.parse(fs.readFileSync(path.join(corpus,'fixtures.json'))));png=fs.readFileSync(path.join(corpus,'images/B01-ref-0.png'));initial=files();});
test.after(async()=>{if(s)await rt.stop(s);});
test('valid search keeps API and protected candidate metadata',async()=>{const {res,json}=await post(png);assert.equal(res.status,200);assert.equal(json.total,json.matches.length);assert.ok(json.matches.length);assert.ok(json.matches.every(x=>x.user_id==='A'));assert.equal(res.headers.get('cache-control'),'private, no-store');});
for(const owner of [null,'invalid','missing'])test('reject unauthorized '+owner,async()=>assert.equal((await post(png,{owner})).res.status,401));
test('deleted account token rejected',async()=>{s.db.prepare("INSERT INTO users(id,email,password_hash) VALUES('gone','gone@example.invalid','x')").run();const token=s.token('gone');s.db.prepare("DELETE FROM users WHERE id='gone'").run();const res=await fetch(s.base+'/api/pieces/photo-search',{method:'POST',headers:{Authorization:'Bearer '+token}});assert.equal(res.status,401);});
for(const [name,bytes,type,status]of [['empty',Buffer.alloc(0),'image/png',400],['text disguised as PNG',Buffer.from('not an image'),'image/png',400],['truncated PNG',Buffer.from([137,80,78,71,13,10,26,10]),'image/png',400],['SVG',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),'image/svg+xml',415],['nonimage MIME',Buffer.from('x'),'text/plain',415]])test(name,async()=>assert.equal((await post(bytes,{type})).res.status,status));
test('missing photo',async()=>assert.equal((await post(null)).res.status,400));
test('multiple files rejected',async()=>assert.equal((await post(png,{extra:true})).res.status,400));
test('encoded size limit',async()=>assert.equal((await post(Buffer.alloc(LIMITS.bytes+1))).res.status,413));
test('dimension limit',async()=>{const b=await sharp({create:{width:12001,height:1,channels:3,background:'blue'}}).png().toBuffer();assert.equal((await post(b)).res.status,413);});
test('pixel count limit',async()=>{const b=await sharp({create:{width:6400,height:6400,channels:3,background:'blue'}}).png().toBuffer();assert.equal((await post(b)).res.status,413);});
test('actual decoder type cannot be hidden by MIME',async()=>{const b=await sharp(png).tiff().toBuffer();assert.equal((await post(b)).res.status,415);});
test('corrupt compressed image rejected',async()=>{const b=png.subarray(0,png.length-100);assert.equal((await post(b)).res.status,400);});
for(const owner of [null,'A','B'])test('retired debug uploader '+owner,async()=>assert.equal((await post(png,{owner,route:'/api/debug/extract-color'})).res.status,404));
test('stored debug colors require a live account',async()=>{for(const owner of [null,'missing']){const r=await fetch(s.base+'/api/debug/photo-colors',{headers:owner?{Authorization:'Bearer '+s.token(owner)}:{}});assert.equal(r.status,401);}});
test('query filename cannot be fetched by any account',async()=>{await post(png,{filename:'../../query-private.png'});for(const owner of [null,'A','B'])for(const route of ['/uploads/query-private.png','/api/ql/pieces/B01/photos/query-private.png']){const r=await fetch(s.base+route,{headers:owner?{Authorization:'Bearer '+s.token(owner)}:{}});assert.ok([401,404].includes(r.status));}});
test('two accounts retrieve only their own pieces',async()=>{const {json,res}=await post(png,{owner:'B'});assert.equal(res.status,200);assert.ok(json.matches.length);assert.ok(json.matches.every(x=>x.user_id==='B'&&x.id.startsWith('B-private-')));});
test('protected candidate media retains owner and foreign behavior',async()=>{const route='/api/ql/pieces/B01/photos/B01-ref-0';const own=await fetch(s.base+route,{headers:{Authorization:'Bearer '+s.token('A')}});assert.equal(own.status,200);for(const owner of [null,'B']){const r=await fetch(s.base+route,{headers:owner?{Authorization:'Bearer '+s.token(owner)}:{}});assert.ok([401,404].includes(r.status));}});
test('ranking failure cleans query and releases capacity',async()=>{s.db.exec('ALTER TABLE piece_photos RENAME TO safety_saved_photos');try{assert.equal((await post(png)).res.status,500);}finally{s.db.exec('ALTER TABLE safety_saved_photos RENAME TO piece_photos');}assert.equal((await post(png)).res.status,200);});
test('partial upload is private, same-account concurrency bounded, abort releases capacity',async()=>{let request;await new Promise((resolve,reject)=>{request=http.request(s.base+'/api/pieces/photo-search',{method:'POST',headers:{Authorization:'Bearer '+s.token('A'),'Content-Type':'multipart/form-data; boundary=safety','Content-Length':1000000}});request.on('error',()=>{});request.write('--safety\r\nContent-Disposition: form-data; name="photo"; filename="aborted.png"\r\nContent-Type: image/png\r\n\r\n');request.write(png.subarray(0,100));setTimeout(resolve,100);});assert.equal((await post(png)).res.status,429);assert.deepEqual(files(),initial);request.destroy();await new Promise(r=>setTimeout(r,100));assert.equal((await post(png)).res.status,200);});
test('malformed multipart cleans and permits retry',async()=>{const r=await fetch(s.base+'/api/pieces/photo-search',{method:'POST',headers:{Authorization:'Bearer '+s.token('A'),'Content-Type':'multipart/form-data; boundary=bad'},body:'--bad\r\nBroken'});assert.equal(r.status,400);assert.deepEqual(files(),initial);assert.equal((await post(png)).res.status,200);});
test('release wipes memory, is idempotent, and clears request reference',async()=>{
 const express=require('express');const app=express();const safety=createPhotoQuerySafety({prepare:()=>({get:()=>({})})});let held,request;
 app.post('/',(req,res,next)=>{req.userId='test';next();},safety.upload,(req,res)=>{held=req.file.buffer;request=req;req.releasePhotoQuery();req.releasePhotoQuery();res.json({ok:true});});
 const server=await new Promise(r=>{const v=app.listen(0,'127.0.0.1',()=>r(v));});
 try{const body=new FormData();body.append('photo',new Blob([png],{type:'image/png'}),'x.png');const r=await fetch('http://127.0.0.1:'+server.address().port,{method:'POST',body});assert.equal(r.status,200);assert.ok(held.every(b=>b===0));assert.equal(request.file.buffer,undefined);}finally{await new Promise(r=>server.close(r));}
});

test("frozen Eval-1 feature extraction, crops, weights and hashes",()=>{const s=fs.readFileSync(path.resolve(__dirname,"../ql/photo-features/frozen-safety-algorithm.txt"),"utf8");const a=s.indexOf("// ============ PHOTO SEARCH (Perceptual Hash + Color) ============");const b=s.indexOf("app.post('/api/pieces/photo-search'",a);assert.ok(a>=0&&b>a);assert.equal(require("node:crypto").createHash("sha256").update(s.slice(a,b)).digest("hex"),"d4b1d21166d04031607f65b0c2ceceaed4c4f4bd7c0fab4190dd2a7a54a7991d");});

test("frozen Eval-1 scoring, ordering and per-Piece selection",()=>{const s=fs.readFileSync(path.resolve(__dirname,"../ql/photo-features/frozen-safety-algorithm.txt"),"utf8");const a=s.indexOf("    // Find dominant cluster (highest weight) from search photo");const b=s.indexOf("    const matches = [];\n    for (const best of bestByPiece.values()) {",a);assert.ok(a>=0&&b>a);assert.equal(require("node:crypto").createHash("sha256").update(s.slice(a,b)).digest("hex"),"b50c3964197192ab6d6976ca740f6db826fad3b512d27721a739edc6f334294d");});
