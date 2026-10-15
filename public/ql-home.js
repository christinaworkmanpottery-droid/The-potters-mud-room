/* Account-scoped Home presentation. Existing record loaders own all member data. */
(() => {
  'use strict';
  const select = document.getElementById('ql-home-images');
  const status = document.getElementById('ql-image-status');
  const grid = document.querySelector('.ql-studio-grid');
  let owner = null, revision = 0, queue = Promise.resolve(), records = [], mode = 'minimal';
  function render() {
    clearPieceEdgeMediaScope(grid);
    grid.querySelectorAll('img').forEach(img => img.remove());
    select.value = mode;
    if (mode !== 'mine') return;
    const withPhotos = records.filter(p => p.primaryPhoto || p.photos?.length);
    // Member imagery stays on the Pieces card; it never misrepresents materials.
    const piece = withPhotos[0];
    if (piece) {
      const template = document.createElement('template');
      template.innerHTML = '<img alt="" ' + pieceEdgePhotoAttrs(piece, piece.primaryPhoto || piece.photos[0]) + '>';
      grid.firstElementChild.prepend(template.content);
      void loadPieceEdgeMedia(grid);
    }
  }
  function invalidate() {
    owner = null; revision++; records = []; mode = 'minimal'; render(); status.textContent = '';
  }
  async function request(account, method, images) {
    const response = await fetch(API + '/api/ql/home/preferences', {method, cache:'no-store',headers:{Authorization:'Bearer '+account.token,...(method==='PUT'?{'Content-Type':'application/json'}:{})},...(method==='PUT'?{body:JSON.stringify({images})}:{})});
    if (!response.ok) throw Error('Could not save Home preferences');
    return response.json();
  }
  function sync() {
    if (!token || !currentUser?.id) { invalidate(); return; }
    if (owner?.token===token && owner?.id===currentUser.id) return;
    invalidate(); owner={token,id:currentUser.id};const account=owner,version=revision;
    request(account,'GET').then(data=>{
      if(owner!==account || revision!==version) return;
      mode=['minimal','mine','studio'].includes(data.images)?data.images:'minimal';render();
    }).catch(()=>{if(owner===account)status.textContent='Preferences could not load. Select a style to retry.';});
  }
  select.addEventListener('change',()=>{
    sync(); if(!owner)return;
    const account=owner,version=++revision,value=select.value;mode=value;render();status.textContent='Saving…';
    queue=queue.catch(()=>{}).then(async()=>{
      if(owner!==account)return;
      try {await request(account,'PUT',value);if(owner===account && revision===version)status.textContent=value==='studio'?'Saved. Studio photography is not yet available; slate cards are shown.':'Saved to your account.';}
      catch(_){if(owner===account && revision===version)status.textContent='Could not save. Select your style again to retry.';}
    });
  });
  const nav=document.createElement('nav');nav.className='ql-home-nav';nav.setAttribute('aria-label','Primary studio navigation');
  for(const [page,label] of [['dashboard','Home'],['pieces','Pieces'],['qlAssistant','Clayton'],['chemicals','Materials'],['profile','Settings']]) {
    const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.page=page;
    button.onclick=()=>navigate(page);nav.append(button);
  }
  document.getElementById('mainApp').append(nav);
  function update(page) {
    for(const button of nav.children) {
      if(button.dataset.page===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
      if(button.dataset.page==='qlAssistant')button.disabled=!window.QLAssistant?.available();
    }
    document.getElementById('ql-home-talk').disabled=!window.QLAssistant?.available();
  }
  window.QLHome={invalidate,sync,pieces(data){records=data;render();update(currentPage);},navigate:update};
  // Assistant feature configuration arrives asynchronously after the app mounts.
  const observer=new MutationObserver(()=>update(currentPage));
  observer.observe(document.querySelector('.nav-dropdown'),{childList:true});
  sync();update(currentPage);
})();
