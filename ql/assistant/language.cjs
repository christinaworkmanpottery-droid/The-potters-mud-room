'use strict';
// Compositional read-command layer: speech envelope, action, domain, query and
// context are separate slots. Never executes tools or rewrites dictated payloads.
const {DESTINATIONS,DOMAINS,validQuery}=require('./intents.cjs');
const intent=(name,args={})=>({intent:{name,arguments:args}});
const clarify=(text,pending)=>({clarification:text,pending});
function envelope(text) {
  if(typeof text!=='string' || /[\x00-\x1f\x7f]/.test(text))return '';
  let n=text.toLowerCase().trim().replace(/[.!?]+$/,'').replace(/\s+/g,' ');
  // Remove conversational scaffolding only at the edges, never within a name.
  for(let i=0;i<4;i++)n=n.replace(/^(?:(?:okay|ok|hey|um|uh|well)[, ]+|please\s+|(?:can|could|would|will) you\s+|i (?:want|need|would like) to\s+|i['’]d like to\s+)/,'');
  return n.replace(/[, ]+(?:please|thanks|thank you)$/,'').trim();
}
const strip=text=>text.replace(/^(?:(?:my|the|some|all|of|a|an)\s+)+/,'').trim();
const vocabulary=Object.entries(DESTINATIONS).flatMap(([type,d])=>d.aliases.map(alias=>({type,alias})))
  .concat([{type:'firing',alias:'kiln firings'},{type:'clay',alias:'clay inventory'},{type:'glaze',alias:'glaze inventory'}])
  .sort((a,b)=>b.alias.length-a.alias.length);
const exactDomain=text=>vocabulary.find(x=>x.alias===strip(text))?.type;
const forms=/\b(?:bowl|bowls|cup|cups|mug|mugs|plate|plates|vase|vases|planter|planters|pitcher|pitchers|jar|jars|sculpture|sculptures|dish|dishes)\b/;
function interpret(text,state={}) {
  const n=envelope(text);if(!n)return null;
  // Negative, compound and mutation requests must never degrade into a read.
  if(/\b(?:not|never|don't|don’t|except|instead)\b/.test(n))return null;
  if(/^(?:add|apply|put)\b/.test(n) && /\b(?:that|it|this)(?: one| piece| note)?$/.test(n)) {
    const target=state?.noteDraftId?'note':state?.pieceId?'piece':null;
    return clarify(target==='note'?'For your current note, what should the complete revised text say? Nothing was changed.':
      target==='piece'?'I kept that request for the selected Piece. Adding a glaze still needs its existing form; nothing was changed.':
      'Do you mean a Studio Note or a Piece? I kept your request. Nothing was changed.',{kind:'write-target',text,target});
  }
  if(/\b(?:add|create|make|edit|update|change|replace|delete|remove|save|send|buy|purchase|record|log|publish|apply|put)\b/.test(n))return null;
  const pending=state?.languagePending;
  if(pending?.kind==='domain') {
    const chosen=exactDomain(n);
    if(chosen && pending.types.includes(chosen))return intent(pending.query?'studio.search':'studio.navigate',pending.query?{type:chosen,query:pending.query}:{destination:chosen});
  }
  if(pending?.kind==='query' && validQuery(n) && !/\b(?:open|show|find|search|go|take|what|which|when)\b/.test(n))
    return intent('studio.search',{type:pending.type,query:n});
  if(pending?.kind==='write-target' && /^(?:the |my )?(?:piece|note|studio note)$/.test(n))
    return clarify('I kept “'+pending.text+'”. Please use the Piece form for a Piece change, or dictate the complete replacement note. Nothing was changed.',pending);
  // Relation nouns identify the requested saved fact; references identify focus.
  const reference=/\b(?:it|that|this)(?: one| piece)?\b/.test(n);
  const glaze=/\bglazes?\b/.test(n), firing=/\b(?:firings?|fired|fire|kiln)\b/.test(n);
  const question=/^(?:what|which|when|tell|remind|how|and|about)\b/.test(n);
  const shortFact=/^(?:and )?(?:its |the )?(?:glazes?|firings?|firing dates?|glaze layers?)(?: on (?:it|that|this))?$/.test(n);
  if((reference && question || shortFact && state?.scope==='piece') && (glaze||firing)) {
    if(/\bor\b/.test(n))return clarify('Which Piece do you mean? Your question is still here.',{kind:'reference',text});
    if(glaze&&firing)return clarify('Would you like its glazes or its firing dates first?',{kind:'fact'});
    const rest=n.replace(/\b(?:what|which|when|tell|remind|how|and|about|me|my|i|its|it|that|this|one|piece|the|a|on|in|of|did|do|is|are|was|were|has|have|had|use|used|been|go|went|into|glazes?|layers?|firings?|dates?|fired|fire|kiln)\b/g,'').replace(/[, ]/g,'');
    if(rest)return clarify('Do you mean the saved glazes or firing dates for the current Piece?',{kind:'fact',text});
    return intent(glaze?'studio.piece.glazes':'studio.piece.firings');
  }
  if(firing && /\b(?:last|latest|most recent)\b/.test(n) && !reference && !/\b(?:and|or|then)\b/.test(n)) {
    const remainder=n.replace(/\b(?:when|what|was|is|the|my|date|of|last|latest|most recent|recorded|firing|firings|fired|did|i|fire|tell|me|about|remind)\b/g,'').trim();
    if(!remainder)return intent('studio.firing.latest');
  }
  // Action verbs are shared across all existing domains, rather than a phrase
  // list per feature. A domain may appear before or after its query.
  let action,body=n;
  const prefix=n.match(/^(open|show(?: me)?|bring up|pull up|go (?:back )?to|take me (?:back )?to|look (?:at|for)|find|search(?: (?:in|for))?|let me see)\s+/);
  if(prefix){action=/^(find|search|look for)/.test(prefix[1])?'search':'open';body=strip(n.slice(prefix[0].length));}
  else {
    const suffix=n.match(/^(.+?)[, ]+(?:show(?: me)?|open|please open|bring up)$/);
    if(suffix){action='open';body=strip(suffix[1]);}
  }
  if(!action && exactDomain(body))return intent('studio.navigate',{destination:exactDomain(body)});
  if(!action)return null;
  if(/^(?:last|latest|most recent) firing$/.test(body))return intent('studio.firing.openLatest');
  if(/^(?:it|that|this)(?: one| piece)?$/.test(body))return intent('studio.piece.open');
  const alternatives=body.split(/\s+(?:or|and)\s+/).map(exactDomain);
  if(alternatives.length>1 && alternatives.every(Boolean))return clarify('Which would you like: '+[...new Set(alternatives)].map(t=>DESTINATIONS[t].label).join(' or ')+'?',{kind:'domain',types:[...new Set(alternatives)]});
  if(exactDomain(body))return intent('studio.navigate',{destination:exactDomain(body)});
  for(const {type,alias} of vocabulary) {
    if(!Object.hasOwn(DOMAINS,type))continue;
    if(new RegExp('^'+alias+' (?:for|matching|with|called|named)$').test(body))
      return clarify('What should I look for in '+DESTINATIONS[type].label+'?',{kind:'query',type});
  }
  const choice=body.match(/^(.+?)\s+(\S+)\s+or\s+(.+)$/);
  if(choice) {
    const types=[exactDomain(choice[2]),exactDomain(choice[3])];
    if(types.every(t=>t && Object.hasOwn(DOMAINS,t)) && validQuery(choice[1]))
      return clarify('Look for “'+choice[1]+'” in '+types.map(t=>DESTINATIONS[t].label).join(' or ')+'?',{kind:'domain',types,query:choice[1]});
  }
  // Compound actions are not silently truncated or interpreted as search terms.
  if(/\b(?:and|or|then)\b/.test(body))return null;
  for(const {type,alias} of vocabulary) {
    if(!Object.hasOwn(DOMAINS,type))continue;
    let query;
    if(body.startsWith(alias+' ') && (action==='search' || /^(?:for|matching|with|called|named)\s+/.test(body.slice(alias.length).trim())))query=body.slice(alias.length).trim().replace(/^(?:for|matching|with|called|named)\s+/,'');
    else if(body.endsWith(' in '+alias))query=body.slice(0,-(' in '+alias).length).trim();
    else if(body.endsWith(' '+alias))query=body.slice(0,-alias.length).trim();
    if(query && validQuery(query))return intent('studio.search',{type,query:query.replace(/\bunderglazes\b/g,'underglaze')});
  }
  if(forms.test(body) && validQuery(body))return intent('studio.search',{type:'piece',query:body});
  if(action==='search' && validQuery(body))return intent('studio.search',{type:'all',query:body});
  return null;
}
module.exports={envelope,interpret};
