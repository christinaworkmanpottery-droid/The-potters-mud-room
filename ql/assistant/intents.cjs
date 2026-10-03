'use strict';
// Only these studio destinations and saved-record types are routable. No URLs,
// account selectors, SQL identifiers, or write tools come from user/provider input.
const DOMAINS = Object.freeze({
  piece: {label:'Pieces', page:'pieces', aliases:['pieces','piece']},
  clay: {label:'Clay', page:'clayBodies', aliases:['clay','clays','clay bodies','clay body']},
  glaze: {label:'Glazes', page:'glazes', aliases:['glazes','glaze']},
  'raw-material': {label:'Raw Materials', page:'chemicals', aliases:['raw materials','raw material','chemicals']},
  'test-tile': {label:'Test Tiles', page:'testTiles', aliases:['test tiles','test tile']},
  firing: {label:'Firings', page:'firings', aliases:['firings','firing logs','firing']},
  pricing: {label:'Pricing', page:'pricingCalculator', aliases:['pricing','pricing calculator','pricing calculations']},
  sale: {label:'Sales', page:'sales', aliases:['sales','sale']},
  project: {label:'Projects', page:'projects', aliases:['projects','project']},
  contact: {label:'Contacts', page:'contacts', aliases:['contacts','contact']},
  event: {label:'Events / Calendar', page:'events', aliases:['events','event','calendar']}
});
const aliases = Object.entries(DOMAINS).flatMap(([type,d]) => d.aliases.map(alias=>[alias,type])).sort((a,b)=>b[0].length-a[0].length);
const domain = text => aliases.find(([alias])=>alias===text)?.[1];
const command = (name,args={}) => ({name,arguments:name === 'studio.search' ? {...args, query:args.query.replace(/\bunderglazes\b/g,'underglaze')} : args});
const validQuery = q => typeof q === 'string' && q.trim().length >= 2 && q.length <= 120 &&
  !/[\x00-\x1f\x7f]/.test(q) && new Set(q.trim().toLowerCase().split(/\s+/)).size <= 8;
function resolve(text, fail) {
  if (/[\x00-\x1f\x7f]/.test(text)) fail(400,'INVALID_REQUEST','Invalid assistant input.');
  const n = text.trim().toLowerCase().replace(/[?.!]$/, '').replace(/\s+/g,' ').replace(/^please /,'').replace(/ please$/,'');
  if (['when was my last firing','when was my latest firing','latest recorded firing','last firing'].includes(n)) return command('studio.firing.latest');
  if (/^(?:open|show(?: me)?)(?: my| the)? (?:last|latest) firing$/.test(n)) return command('studio.firing.openLatest');
  if (/^(?:add|create|edit|update|change|delete|remove|save|send|buy|purchase|record|log|publish)\b/.test(n))
    fail(400,'ACTION_NOT_AVAILABLE','Studio changes are not available through this assistant yet. No changes were made. Use the existing forms.');
  const nav = n.match(/^(?:open|show(?: me)?|go to|take me to)(?: my| the)? (.+)$/);
  if (nav) {
    const type=domain(nav[1]);
    if (type) return command('studio.navigate',{destination:type});
    if (['photo lookup','photo search'].includes(nav[1])) return command('studio.navigate',{destination:'photo-lookup'});
    if (['search','studio search'].includes(nav[1])) return command('studio.navigate',{destination:'search'});
  }
  // Domain-first searches, including the real-device compound request.
  const filtered=n.match(/^(?:find(?: in)?|search(?: in)?|show(?: me)?|open)(?: my| the)? (.+?) (?:for|matching|and show(?: me)?) (.+)$/);
  if (filtered && domain(filtered[1]) && validQuery(filtered[2])) return command('studio.search',{type:domain(filtered[1]),query:filtered[2]});
  const suffix=n.match(/^(?:find|search for|show(?: me)?)(?: my| the)? (.+)$/);
  if (suffix) {
    for (const [alias,type] of aliases) {
      if (suffix[1].endsWith(' '+alias)) {
        const query=suffix[1].slice(0,-alias.length-1);
        if (validQuery(query)) return command('studio.search',{type,query});
      }
    }
    if (/^(?:find|search for)\b/.test(n) && validQuery(suffix[1])) return command('studio.search',{type:'all',query:suffix[1]});
  }
  fail(400,'UNSUPPORTED_INTENT','That command is not supported yet. Try opening a studio feature or searching saved records. No changes were made.');
}
module.exports={DOMAINS,validQuery,resolve};
