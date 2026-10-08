// Piece-only relationship mutation contract. No historical normalization.
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k) && o[k] !== undefined;
const fail = message => { throw Object.assign(new Error(message), {status:400}); };
const text = v => { if(v === null) return null; if(typeof v !== 'string') fail('Expected text'); return v; };
function alias(o, keys, normalize = v => v) {
  const values = keys.filter(k=>own(o,k)).map(k=>normalize(o[k]));
  if(values.some(v=>JSON.stringify(v)!==JSON.stringify(values[0]))) fail('Conflicting aliases: '+keys.join('/'));
  return values.length ? {present:true,value:values[0]} : {present:false};
}
function clay(body, existing = {}, validate) {
  const id=alias(body,['clayBodyId','clay_body_id'],v=>text(v)||null);
  const label=alias(body,['clay'],text), studio=alias(body,['studio'],text);
  const intent=alias(body,['clayIntent','clay_intent'],text).value;
  let nextId=existing.clay_body_id ?? null, nextText=existing.studio ?? null;
  if(intent && !['untouched','manual','saved','clear'].includes(intent)) fail('Invalid Clay intent');
  if(intent==='untouched') { if(id.present||label.present) fail('Untouched Clay has mutation fields'); }
  else if(intent==='manual') {
    if(!label.present || id.value) fail('Manual Clay requires text and no saved ID');
    nextId=null; nextText=label.value;
    // studio is the old compatibility value; explicit Clay intent wins.
  } else if(intent==='saved') {
    if(!id.value) fail('Saved Clay requires an ID');
    nextId=id.value; nextText=studio.present ? studio.value : existing.clay_body_id ? existing.studio ?? null : null;
  } else if(intent==='clear') {
    if(id.value || label.value) fail('Conflicting Clay clear');
    nextId=null; nextText=studio.present ? studio.value : null;
  } else {
    if(label.present && studio.present && label.value!==studio.value) fail('Conflicting Clay/Studio values; explicit Clay intent required');
    if(id.present) nextId=id.value;
    if(label.present || studio.present) nextText=label.present ? label.value : studio.value;
    // Legacy text-only writes must not silently retain a saved relationship.
    if(label.present && !id.present && nextId && label.value!==existing.studio) fail('Manual Clay replacement requires explicit intent or a cleared Clay ID');
  }
  if(intent==='untouched' && studio.present) nextText=studio.value;
  if(id.present && nextId) validate('clay_bodies',nextId);
  return {id:nextId,text:nextText};
}
function layer(raw) {
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) fail('Invalid Glaze layer');
  const out={};
  for(const [key,keys,normalize] of [
    ['id',['id','layerId','layer_id'],v=>text(v)||null], ['glazeId',['glazeId','glaze_id'],v=>text(v)||null],
    ['customName',['customName','custom_name'],text], ['method',['method','applicationMethod','application_method'],v=>text(v)||null],
    ['notes',['notes'],text], ['coats',['coats'],v=>{if(v===null)return null;if(v===''||typeof v==='boolean'||!Number.isInteger(Number(v))||Number(v)<0)fail('Invalid coats');return Number(v)}],
    ['layerOrder',['layerOrder','layer_order'],v=>{if(v===null)return null;if(!Number.isInteger(Number(v))||v===null||v==='')fail('Invalid layer order');return Number(v)}]
  ]) { const a=alias(raw,keys,normalize); if(a.present) out[key]=a.value; }
  if(own(out,'method') && out.method!==null && !['dip','brush','spray','pour','wax-resist','other'].includes(out.method)) fail('Invalid application method');
  return out;
}
function layers(body, existing, validate) {
  const a=alias(body,['glazeIds','glaze_ids'],v=>{
    if(typeof v==='string'){try{v=JSON.parse(v)}catch{fail('Malformed Glaze array')}}
    if(!Array.isArray(v)) fail('Glazes must be an array');
    return v.map(layer);
  });
  if(!a.present) return undefined;
  const used=new Set();
  return a.value.map((g,i)=>{
    let old;
    if(g.id!==undefined && g.id!==null) {
      old=existing.find(r=>r.id===g.id);
      if(!old || used.has(g.id)) fail('Existing Glaze layer unavailable; reload Piece');
      used.add(g.id);
    }
    if(!old && existing.length && !['glazeId','customName','coats','method','notes'].every(k=>own(g,k))) fail('Ambiguous Glaze replacement; reload Piece with full layer metadata');
    const result={};
    for(const [key,col,defaultValue] of [['glazeId','glaze_id',null],['customName','custom_name',null],['coats','coats',1],['method','application_method',null],['notes','notes',null],['layerOrder','layer_order',i]]) {
      result[key]=own(g,key)?g[key]:old?old[col]:defaultValue;
    }
    if(result.glazeId) validate('glazes',result.glazeId);
    return result;
  });
}
module.exports={clay,layers,layer};
