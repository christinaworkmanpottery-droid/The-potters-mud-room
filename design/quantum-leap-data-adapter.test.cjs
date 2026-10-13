/* Node's built-in test runner. Run: node --test design/quantum-leap-data-adapter.test.cjs */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ctx={};vm.runInNewContext(fs.readFileSync(__dirname+'/quantum-leap-data-adapter.js','utf8'),ctx);
const {normalizePieces,normalizeMaterials,loadStudioData}=ctx.QuantumLeapData;
test('normalizes pieces without inventing metadata',()=>{const p=normalizePieces([{id:1,name:'Ring Dish',status:'Glazing'}])[0];assert.equal(p.title,'Ring Dish');assert.equal(p.clay,'');assert.equal(p.photoUrl,null)});
test('normalizes stock without fabricated quantity',()=>{const m=normalizeMaterials([{id:2,name:'Silica',in_stock:1}])[0];assert.equal(m.inStock,true);assert.equal(m.quantity,null)});
test('rejects non-array responses',()=>{assert.throws(()=>normalizePieces({pieces:[]}),/array/);assert.throws(()=>normalizeMaterials(null),/array/)});
test('rejects missing authentication',async()=>{await assert.rejects(()=>loadStudioData({fetchImpl:async()=>{},token:''}),/Authenticated/)});
test('requests scoped endpoints with auth',async()=>{const seen=[];const result=await loadStudioData({token:'example',fetchImpl:async(path,options)=>{seen.push({path,options});return {ok:true,json:async()=>path.includes('pieces')?[{id:1,name:'Bowl'}]:[{id:2,name:'EPK',in_stock:false}]}}});assert.equal(result.pieces[0].title,'Bowl');assert.equal(result.materials[0].name,'EPK');assert.deepEqual(seen.map(x=>x.path),['/api/pieces?excludeCasualties=1','/api/glaze-chemicals']);assert.equal(seen[0].options.headers.Authorization,'Bearer example')});
test('surfaces request failure',async()=>{await assert.rejects(()=>loadStudioData({token:'example',fetchImpl:async()=>({ok:false,status:401})}),/401/)});
