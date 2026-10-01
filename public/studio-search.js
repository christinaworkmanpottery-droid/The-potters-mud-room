/* Saved Studio text search. Results are hints; only canonical API reads authorize viewers. */
(() => {
  'use strict';
  const types = {
    piece: ['Pieces', 'Piece', '/api/pieces/'],
    clay: ['Clay', 'Clay', '/api/clay-bodies/'],
    glaze: ['Glazes', 'Glaze', '/api/glazes', true],
    'raw-material': ['Raw Materials', 'Raw Material', '/api/glaze-chemicals', true],
    'test-tile': ['Test Tiles', 'Test Tile', '/api/test-tiles/'],
    firing: ['Firings', 'Firing', '/api/firing-logs/'],
    pricing: ['Pricing', 'Pricing', '/api/pricing-calculations/'],
    sale: ['Sales', 'Sale', '/api/sales', true],
    project: ['Projects', 'Project', '/api/projects/'],
    contact: ['Contacts', 'Contact', '/api/contacts/'],
    event: ['Events', 'Event', '/api/events', true]
  };
  const modalFor = {clay:'clayViewModal',glaze:'glazeViewModal','test-tile':'testTileViewModal',firing:'firingViewModal',sale:'saleDetailsModal'};
  const bodyFor = {clay:'clayViewBody',glaze:'glazeViewBody','test-tile':'testTileViewBody',firing:'firingViewBody',sale:'saleDetailsContent'};
  const el = id => document.getElementById(id);
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  const button = (text, action) => { const n = node('button',text,'btn btn-secondary'); n.type='button'; n.onclick=action; return n; };
  const key = () => JSON.stringify([token, currentUser?.id, localStorage.getItem('mudlog_token')]);
  let session = key(), epoch = 0, searchSerial = 0, detailSerial = 0;
  let searchController, detailController, selected = null, closing = false, lastFocus = null;
  let query = '', filter = '', nextOffset = null, hasMore = false, capped = false, pending = false, retryOffset = 0;
  let records = [], locked = new Set();
  const status = text => { el('studioSearchStatus').textContent = text; };
  const availableSession = () => Boolean(token && currentUser?.id && token === localStorage.getItem('mudlog_token'));

  function clearDetail() {
    detailSerial++; detailController?.abort();
    const old = selected; selected = null;
    closing = true;
    if (old) {
      const modal = modalFor[old.type];
      if (modal) { closeModal(modal); el(bodyFor[old.type]).replaceChildren(); const title = el(modal)?.querySelector('h2,h3'); if (title) title.textContent = types[old.type][1]; }
      if (old.type === 'piece') {
        clearPieceHistory();
        el('pieceDetailContent').replaceChildren();
        const back = el('pagePieceDetail').querySelector('.detail-back');
        back.textContent = '← Back to Pieces'; back.onclick = () => navigate('pieces');
      }
      if (old.type === 'pricing') clearPricingMedia('studioSearchDetail');
    }
    closing = false;
    el('studioSearchDetail').replaceChildren();
  }
  function invalidate(message = 'Search your saved studio records.') {
    epoch++; searchSerial++; searchController?.abort(); clearDetail();
    records = []; query = ''; filter = ''; nextOffset = null; hasMore = capped = pending = false;
    locked.clear(); lastFocus = null;
    el('studioSearchInput').value = ''; el('studioSearchType').value = '';
    el('studioSearchRetry').hidden = true;
    session = key(); render(); status(message);
  }
  function syncSession() { if (session !== key()) invalidate(); }
  function guard(serial, kind, identity, generation) {
    syncSession();
    return availableSession() && identity === session && generation === epoch && serial === (kind === 'search' ? searchSerial : detailSerial);
  }
  async function request(path, controller, active) {
    const response = await fetch(API + path, {cache:'no-store', signal:controller.signal, headers:{Authorization:'Bearer '+token}});
    if (!active()) throw Error('Session changed');
    if (response.status === 401) { invalidate('Your session has expired. Please sign in again.'); throw Error('Session expired'); }
    if (!response.ok) throw Object.assign(Error('Request failed'), {status:response.status});
    const data = await response.json();
    if (!active()) throw Error('Session changed');
    return data;
  }
  function lockTiles() {
    locked.add('test-tile'); records = records.filter(r => r.recordType !== 'test-tile'); render();
    status(records.length ? `${records.length} results shown.` : 'No available results. Try another record type.');
  }
  function render() {
    const list = el('studioSearchResults'); list.replaceChildren();
    for (const row of records) {
      if (!Object.hasOwn(types,row.recordType) || locked.has(row.recordType)) continue;
      const item = node('li'), b = button('', () => { lastFocus = b; void open(row.recordType,row.sourceRecordId); });
      b.className = 'studio-search-result';
      b.append(node('span',types[row.recordType][1],'record-type'),node('strong',row.title),node('span',row.excerpt));
      item.append(b); list.append(item);
    }
    list.setAttribute('aria-busy',String(pending));
    el('studioSearchMore').hidden = pending || !hasMore || capped || nextOffset == null;
    el('studioSearchLocked').textContent = locked.has('test-tile') ? 'Test Tiles are unavailable on your current plan.' : '';
    const option = el('studioSearchType').querySelector('[value="test-tile"]');
    option.textContent = locked.has('test-tile') ? 'Test Tiles — unavailable' : 'Test Tiles';
    // Leave the option selectable so users can read the explicit unavailable state.
  }
  async function search(offset = 0) {
    syncSession(); clearDetail();
    if (!availableSession()) { invalidate('Please sign in to search your studio.'); return; }
    const serial = ++searchSerial, identity = session, generation = epoch;
    searchController?.abort(); searchController = new AbortController();
    const controller = searchController, active = () => guard(serial,'search',identity,generation);
    if (!offset) { query = el('studioSearchInput').value; filter = el('studioSearchType').value; records = []; nextOffset = null; hasMore = capped = false; }
    retryOffset = offset; pending = true; el('studioSearchRetry').hidden = true; render(); status(offset ? 'Loading more…' : 'Searching your studio…');
    const params = new URLSearchParams({q:query,offset:String(offset),limit:String(Math.min(25,1000-offset))});
    if (filter) params.set('types',filter);
    try {
      const data = await request('/api/ql/search?'+params, controller, active);
      if (!active()) return;
      if (!Array.isArray(data.results)) throw Error('Invalid response');
      // A filtered response omits unrelated lockedTypes. Preserve a known lock until
      // an All/Test Tiles request actually rechecks that entitlement.
      if (!filter || filter === 'test-tile') locked = new Set(data.lockedTypes || []);
      else for (const type of data.lockedTypes || []) locked.add(type);
      records = (offset ? records : []).concat(data.results).filter(r => !locked.has(r.recordType));
      nextOffset = data.nextOffset; hasMore = data.hasMore === true; capped = data.capped === true;
      pending = false; render();
      status(capped ? 'Showing the first 1,000 matches. Narrow your search to see more.' : records.length ? `${records.length} results shown.` : 'No results. Try another word or record type.');
    } catch (error) {
      if (!active()) return;
      pending = false; render();
      status(error.status === 400 ? 'Use 2–120 characters and up to eight unique words. Search looks for saved text.' : 'Unable to search right now. Please try again.');
      el('studioSearchRetry').hidden = false;
    }
  }
  function back() {
    clearDetail();
    navigate('studioSearch',{fromHistory:true,searchDetail:true});
    history.replaceState({page:'studioSearch'},'',location.pathname+location.search+'#studioSearch');
    if (lastFocus?.isConnected) lastFocus.focus(); else el('studioSearchInput').focus();
  }
  function failure(error, active, type, id) {
    if (!active()) return;
    if (error.status === 403 && type === 'test-tile') {
      lockTiles();
    }
    // Remove failed metadata too: a deleted/denied record must not remain selectable.
    if ([403,404].includes(error.status)) { records = records.filter(r => !(r.recordType === type && r.sourceRecordId === id)); render(); }
    navigate('searchRecord',{fromHistory:true,searchDetail:true});
    const root = el('studioSearchDetail'); root.replaceChildren(node('h2','Record unavailable'),node('p',[403,404].includes(error.status) ? 'This record may have been removed or is no longer available to your account.' : 'Unable to open this record. Please try again.'));
    root.append(button('Retry',() => void open(type,id,true))); root.focus();
  }
  async function open(type,id,fromHistory = false) {
    syncSession();
    if (!availableSession()) { invalidate('Please sign in to open a record.'); return; }
    if (!Object.hasOwn(types,type) || typeof id !== 'string' || !id) { back(); return; }
    // Search payload is used only as an opaque locator. Never pass it to a viewer.
    searchSerial++; searchController?.abort(); pending = false;
    clearDetail(); selected = {type,id};
    const serial = detailSerial, identity = session, generation = epoch;
    const active = () => guard(serial,'detail',identity,generation) && selected?.type === type && selected?.id === id;
    detailController = new AbortController(); const controller = detailController;
    const route = 'studioSearch/'+type+'/'+encodeURIComponent(id);
    if (!fromHistory) history.pushState({page:'studioSearch',route},'',location.pathname+location.search+'#'+route);
    navigate('searchRecord',{fromHistory:true,searchDetail:true});
    el('studioSearchDetail').replaceChildren(node('p','Opening saved record…'));
    try {
      const [, , path, collection] = types[type];
      const data = await request(path+(collection ? '' : encodeURIComponent(id)),controller,active);
      const record = collection ? (Array.isArray(data) && data.find(r => String(r.id) === id)) : (type === 'clay' ? data.clay : data);
      if (!active()) return;
      // Pricing's existing authorized response deliberately omits user_id. Its
      // server route scopes id AND owner; all other canonical responses include it.
      if (!record || String(record.id) !== id || (record.user_id == null && type === 'pricing' ? false : String(record.user_id) !== String(currentUser.id))) throw Object.assign(Error('Unavailable'),{status:404});
      el('studioSearchDetail').replaceChildren();
      if (modalFor[type]) {
        navigate('studioSearch',{fromHistory:true,searchDetail:true});
        const options = {readOnly:true,searchOrigin:true,active};
        if (type === 'clay') openClayViewModal(record,options);
        if (type === 'glaze') openGlazeViewModal(record,options);
        if (type === 'test-tile') await viewTestTileById(id,options);
        if (type === 'firing') await viewFiring(id,options);
        if (type === 'sale') await viewSale(id,options);
        if (!active()) return;
        const body = el(bodyFor[type]); body.prepend(button('← Back to Search',back));
        body.querySelector('button')?.focus();
      } else if (type === 'piece') {
        await viewPiece(id,{active});
        if (!active()) return;
        const b = el('pagePieceDetail').querySelector('.detail-back'); b.textContent = '← Back to Search'; b.onclick = back; b.focus();
      } else {
        renderRecord(type,record); el('studioSearchDetail').focus();
      }
    } catch (error) { failure(error,active,type,id); }
  }
  function renderRecord(type,r) {
    const root = el('studioSearchDetail');
    root.append(node('p',types[type][1]),node('h2',r.name || r.title || 'Saved record'));
    const fields = {
      'raw-material':[['source','Source'],['cost_per_unit','Cost per unit'],['unit','Unit'],['notes','Notes']],
      project:[['description','Description'],['status','Status'],['due_date','Due date'],['notes','Notes']],
      contact:[['role','Role'],['email','Email'],['phone','Phone'],['address','Address'],['website','Website'],['instagram','Instagram'],['notes','Notes']],
      event:[['description','Description'],['event_date','Date'],['event_time','Time'],['location','Location']],
      pricing:[['description','Description'],['created_at','Saved']]
    };
    const dl = node('dl');
    for (const [key,label] of fields[type] || []) if (r[key] != null && r[key] !== '') dl.append(node('dt',label),node('dd',r[key]));
    root.append(dl);
    if (type === 'pricing') {
      const breakdown = node('div'); breakdown.innerHTML = pricingBreakdownMarkup(r.result,r.inputs); root.append(breakdown);
      // Existing Pricing renderer converts every interpolated value to a finite number.
    }
  }
  function restore(route) {
    const parts = route.split('/');
    if (parts.length !== 3) { back(); return; }
    try { void open(parts[1],decodeURIComponent(parts[2]),true); } catch (_) { back(); }
  }
  function onNavigate(page,options) {
    syncSession();
    if (options.searchDetail) return;
    clearDetail();
    searchSerial++; searchController?.abort(); pending = false;
    if (page !== 'studioSearch') { records = []; query = ''; nextOffset = null; hasMore = capped = false; }
    render();
  }
  function enter() {
    syncSession();
    if (!availableSession()) { invalidate('Please sign in to search your studio.'); return; }
    if (!query) status('Search your saved studio records.');
  }
  for (const [value,[label]] of Object.entries(types)) { const o = node('option',label); o.value=value; el('studioSearchType').append(o); }
  el('studioSearchForm').addEventListener('submit',e => { e.preventDefault(); void search(); });
  el('studioSearchClear').onclick = () => { invalidate(); el('studioSearchInput').focus(); };
  el('studioSearchType').onchange = () => { if (el('studioSearchInput').value.trim()) void search(); };
  el('studioSearchMore').onclick = () => { if (!pending && hasMore && !capped && Number.isInteger(nextOffset) && nextOffset > 0 && nextOffset < 1000) void search(nextOffset); };
  el('studioSearchRetry').onclick = () => void search(retryOffset);
  window.addEventListener('storage',e => { if (e.key === 'mudlog_token' || e.key == null) invalidate('Your session changed. Please sign in again.'); });
  window.addEventListener('pageshow',syncSession);
  document.addEventListener('visibilitychange',syncSession);
  window.StudioSearch = {invalidate,lockTiles,syncSession,onNavigate,enter,back,restore,open,
    closeViewer(id) { if (!closing && selected && modalFor[selected.type] === id) { back(); return true; } return false; }
  };
  render(); status('Search your saved studio records.');
  // Auth may complete before this external script finishes loading.
  if (availableSession() && location.hash.startsWith('#studioSearch/')) restore(location.hash.slice(1));
})();
