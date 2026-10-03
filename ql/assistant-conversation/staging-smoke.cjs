'use strict';
// Explicit operator-only script. Never loaded by the app or production startup.
// Creates labeled disposable fixtures only in the existing isolated Safari account.
const assert=require('node:assert/strict');
const base='https://potters-ql-phase4f-safari.onrender.com';
(async()=>{
 const password=process.env.QL_SAFARI_TEST_PASSWORD;
 if(!password)throw Error('Synthetic staging test password required');
 let token;
 async function api(path,body){
  const r=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Error('Staging request failed: '+path+' ('+r.status+')');
  return r.json();
 }
 const login=await api('/api/auth/login',{email:'safari-test@example.invalid',password});token=login.token;assert.ok(token);
 const me=await api('/api/auth/me');assert.equal(me.user.id,'phase4f-safari');assert.equal(me.user.email,'safari-test@example.invalid');
 const existing=await api('/api/pieces');const glazes=await api('/api/glazes');
 const glazeName='QL 4I Ocean (synthetic)';
 const glaze=glazes.find(g=>g.name===glazeName)||await api('/api/glazes',{name:glazeName,notes:'Synthetic Phase 4I acceptance fixture. Not a production record.'});
 const titles=['QL 4I Blue Bowl (synthetic)','QL 4I Blue Vase (synthetic)','QL 4I Green Cup (synthetic)'];const pieces=[];
 for(const [i,title] of titles.entries())pieces.push(existing.find(p=>p.title===title)||await api('/api/pieces',{title,description:'Synthetic Phase 4I conversation test fixture.',glazeIds:i===0?[{glazeId:glaze.id,coats:2}]:[]}));
 const firings=await api('/api/firing-logs');
 if(!firings.some(f=>f.piece_id===pieces[0].id&&f.notes==='Synthetic Phase 4I acceptance fixture'))await api('/api/firing-logs',{pieceId:pieces[0].id,firingType:'glaze',date:'2026-10-01',kilnName:'QL 4I synthetic kiln',notes:'Synthetic Phase 4I acceptance fixture'});
 let context={token:null};let serial=0;
 async function turn(text){const r=await api('/api/ql/assistant/turn',{version:1,requestId:'staging-'+(++serial),input:{text},context});context=r.context;assert.ok(context?.token);return r;}
 assert.equal((await turn('Open my pieces')).response.navigation.page,'pieces');
 const blue=await turn('Show me the QL 4I blue one');assert.equal(blue.result.status,'choices');assert.equal(blue.result.results.length,2);
 const chosen=await turn('The first one');assert.equal(chosen.response.navigation.id,pieces[0].id);
 assert.deepEqual((await turn('What glaze did I use on that?')).result.glazes,[glazeName]);
 assert.deepEqual((await turn('When did I fire it?')).result.dates,['2026-10-01']);
 await turn('Show me the QL 4I green one');assert.equal((await turn('What glaze did I use on that?')).result.status,'empty');assert.equal((await turn('When did I fire it?')).result.status,'empty');
 assert.equal((await turn('Go back to my glazes')).response.navigation.page,'glazes');
 assert.equal((await turn('When did I fire it?')).result.status,'clarification');
 assert.equal((await turn('Open blue vase')).response.navigation.id,pieces[1].id);
 assert.equal((await turn('What glaze is on it?')).result.status,'empty');
 assert.equal((await turn('Open the blue bowl')).response.navigation.id,pieces[0].id);
 assert.deepEqual((await turn('What glaze did I use on that one?')).result.glazes,[glazeName]);
 assert.deepEqual((await turn('When did I fire that one?')).result.dates,['2026-10-01']);
 await turn('Find QL 4I blue pieces');
 assert.equal((await turn('The 1st one')).response.navigation.id,pieces[0].id);
 assert.equal((await turn('Open blue vase')).response.navigation.id,pieces[1].id);
 const proposed=await turn('What way is on blue phase');
 assert.equal(proposed.result.status,'clarification');assert.equal(proposed.response.navigation,undefined);assert.match(proposed.response.text,/Say yes or no/);
 assert.equal((await turn('Yes')).result.status,'empty');
 assert.deepEqual((await turn('What glaze is on blue bowl?')).result.glazes,[glazeName]);
 assert.equal((await turn('What glaze is on blue phase?')).result.status,'clarification');
 assert.match((await turn('No')).response.text,/Canceled/);
 assert.deepEqual((await turn('What glaze is on it?')).result.glazes,[glazeName]);
 const config=await api('/api/ql/assistant/config');assert.deepEqual(config,{enabled:true,voiceEnabled:true,handsFreeEnabled:true});
 console.log(JSON.stringify({staging:base,checks:serial,fixtures:titles,glaze:glazeName,firingDate:'2026-10-01',result:'PASS',realMicrophone:false}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
