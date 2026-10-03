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
// Navigation-only destinations do not widen saved-record search or write capabilities.
// Audited against public/index.html and the canonical navigate() map/loaders.
const DESTINATIONS = Object.freeze({
  ...DOMAINS,
  dashboard: {label:'Dashboard', page:'dashboard', aliases:['dashboard','home','studio dashboard']},
  casualties: {label:'Casualties', page:'casualties', aliases:['casualties','casualty']},
  community: {label:'Community Glaze Library', page:'community', aliases:['community','community library','community glaze library','glaze library','glaze combos','glaze combinations']},
  shop: {label:'Shop', page:'shop', aliases:['shop']},
  'ask-potter': {label:'Ask a Potter', page:'aiChat', aliases:['ask a potter','ask potter']},
  'photo-lookup': {label:'Photo Lookup', page:'visualSearch', aliases:['photo lookup','photo look up','photo search','find by photo']},
  search: {label:'Studio Search', page:'studioSearch', aliases:['search','studio search','search studio']},
  store: {label:'My Store', page:'myStore', aliases:['store','my store','stores']},
  shopping: {label:'Shopping List', page:'shoppingList', aliases:['shopping','shopping list','shopping lists']},
  goals: {label:'Goals', page:'goals', aliases:['goals','goal']},
  notes: {label:'Studio Notes', page:'studioNotes', aliases:['notes','studio notes','studio note']},
  members: {label:'Members', page:'communityMembers', aliases:['members','community members']},
  'find-potter': {label:'Find a Potter', page:'findPotter', aliases:['find a potter','find potter','potter directory']},
  forum: {label:'Forum', page:'forum', aliases:['forum','forums']},
  reviews: {label:'Reviews', page:'reviews', aliases:['reviews','review']},
  blog: {label:'Blog', page:'blog', aliases:['blog','blogs']},
  help: {label:'Help', page:'help', aliases:['help','help center']},
  plans: {label:'Plans', page:'upgrade', aliases:['plans','membership','membership plans','upgrade']},
  profile: {label:'Profile', page:'profile', aliases:['profile','account','account settings']},
  notifications: {label:'Notifications', page:'notifications', aliases:['notifications','notification']},
  messages: {label:'Messages', page:'messages', aliases:['messages','message','inbox']}
});
const navigationAliases = Object.entries(DESTINATIONS).flatMap(([type,d]) => d.aliases.map(alias=>[alias,type]));
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
    const type=navigationAliases.find(([alias])=>alias===nav[1])?.[1];
    if (type) return command('studio.navigate',{destination:type});
    if (['kiln share','kilnshare','kiln sharing'].includes(nav[1]))
      fail(400,'DESTINATION_UNAVAILABLE','Kiln Share is not available in this website build. No page was opened.');
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
module.exports={DOMAINS,DESTINATIONS,validQuery,resolve};
