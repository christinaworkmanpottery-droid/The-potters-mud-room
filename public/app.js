// ============ The Potter's Mud Room ============
const API = '';
let token = localStorage.getItem('mudlog_token');
let currentUser = null;
let clayBodies = [];
let glazes = [];
let debounceTimer = null;
let forumCategories = [];

// ---- Helpers ----
async function api(path, opts = {}) {
  const h = {};
  if (token) h['Authorization'] = 'Bearer ' + token;
  if (opts.body && !(opts.body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(API + path, { ...opts, headers: opts.body instanceof FormData ? { Authorization: 'Bearer ' + token } : h });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }
function timeAgo(d) {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  if (s < 604800) return Math.floor(s/86400) + 'd ago';
  return fmtDate(d);
}
const STATUS_LABELS = { 'in-progress':'In Progress','leather-hard':'Leather Hard','bone-dry':'Bone Dry','bisque-fired':'Bisque Fired','glazed':'Glazed','glaze-fired':'Glaze Fired','done':'Done','sold':'Sold','broken':'Broken','recycled':'Recycled' };
function fmtStatus(s) { return s ? '<span class="status-badge status-' + s + '">' + (STATUS_LABELS[s]||s) + '</span>' : ''; }
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Check URL params for post-checkout messages
function checkUrlParams() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('upgraded')) { toast('🎉 Welcome to ' + p.get('upgraded').toUpperCase() + ' tier! Enjoy your new features.', 'success'); }
  if (p.get('tokens') === 'purchased') { toast('🪙 Forum tokens added to your account!', 'success'); }
  if (p.get('pass') === 'purchased') { toast('✨ Unlimited posting pass activated for 30 days!', 'success'); }
  if (p.get('purchased')) { toast('🛍️ Purchase complete! Check your email for details.', 'success'); }
  if (p.get('cancelled')) { toast('Purchase cancelled.', ''); }
  if (p.has('upgraded') || p.has('tokens') || p.has('pass') || p.has('purchased') || p.has('cancelled')) {
    window.history.replaceState({}, '', window.location.pathname);
  }
}

// ---- Auth ----
let isSignUp = false;
function toggleAuth() {
  isSignUp = !isSignUp;
  document.getElementById('nameField').classList.toggle('hidden', !isSignUp);
  document.getElementById('authSubmit').textContent = isSignUp ? 'Create Account' : 'Sign In';
  document.getElementById('authToggleText').textContent = isSignUp ? 'Already have an account?' : "Don't have an account?";
  document.getElementById('authToggleLink').textContent = isSignUp ? 'Sign in' : 'Create one';
  document.getElementById('authError').classList.add('hidden');
}
document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value;
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('authName').value;
  const errEl = document.getElementById('authError');
  errEl.classList.add('hidden');
  try {
    const data = await api(isSignUp ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST', body: isSignUp ? { email, password, displayName: name } : { email, password }
    });
    token = data.token;
    localStorage.setItem('mudlog_token', token);
    currentUser = data.user;
    showApp();
  } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
});
function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('mudlog_token');
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('mainApp').classList.add('hidden');
}
async function checkAuth() {
  if (!token) return;
  try { const d = await api('/api/auth/me'); currentUser = d.user; showApp(); } catch { logout(); }
}
function showApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainApp').classList.remove('hidden');
  const badge = document.getElementById('navTier');
  const t = currentUser?.tier || 'free';
  badge.textContent = t.toUpperCase(); badge.className = 'tier-badge tier-' + t;
  // Show/hide tier-gated nav items
  const tier = currentUser?.tier || 'free';
  const tierLv = { free: 0, basic: 1, mid: 2, top: 3 };
  document.querySelectorAll('[data-min-tier]').forEach(el => {
    const min = el.getAttribute('data-min-tier');
    el.style.display = tierLv[tier] >= tierLv[min] ? '' : 'none';
  });
  checkUrlParams();
  loadDashboard(); loadClayBodies(); loadGlazes();
}

// ---- Navigation ----
let currentPage = 'dashboard';
function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const map = {
    dashboard:'pageDashboard', pieces:'pagePieces', pieceDetail:'pagePieceDetail',
    clayBodies:'pageClayBodies', glazes:'pageGlazes', firings:'pageFirings',
    sales:'pageSales', community:'pageCommunity', forum:'pageForum',
    forumPost:'pageForumPost', profile:'pageProfile', shop:'pageShop',
    upgrade:'pageUpgrade'
  };
  const el = document.getElementById(map[page]); if (el) el.classList.add('active');
  const nb = document.querySelector('.nav-link[data-page="' + page + '"]'); if (nb) nb.classList.add('active');
  document.querySelector('.nav-links')?.classList.remove('open');
  const loaders = {
    dashboard:loadDashboard, pieces:loadPieces, clayBodies:loadClayBodies,
    glazes:loadGlazes, firings:loadFirings, sales:loadSales,
    community:loadCombos, forum:loadForum, profile:loadProfile,
    shop:loadShop, upgrade:loadUpgrade
  };
  if (loaders[page]) loaders[page]();
}

// ---- Dashboard ----
async function loadDashboard() {
  try {
    const d = await api('/api/dashboard');
    document.getElementById('statPieces').textContent = d.totalPieces;
    document.getElementById('statClays').textContent = d.totalClays;
    document.getElementById('statGlazes').textContent = d.totalGlazes;
    const sb = document.getElementById('statSalesBox');
    if (d.sales?.total) { document.getElementById('statSales').textContent = '$' + (d.sales.total||0).toFixed(0); sb.style.display=''; } else { sb.style.display='none'; }
    const ban = document.getElementById('upgradeBanner');
    if (d.tier === 'free') { ban.classList.remove('hidden'); document.getElementById('pieceCountText').textContent = d.totalPieces + '/20 pieces used'; } else { ban.classList.add('hidden'); }
    const c = document.getElementById('recentPieces'), em = document.getElementById('dashboardEmpty');
    if (!d.recentPieces.length) { c.innerHTML = ''; em.classList.remove('hidden'); }
    else { em.classList.add('hidden'); c.innerHTML = d.recentPieces.map(pieceCard).join(''); }
  } catch (err) { toast(err.message, 'error'); }
}

// ---- Piece Card ----
function pieceCard(p) {
  const ph = p.primaryPhoto || (p.photos && p.photos[0]);
  const img = ph ? '<img class="piece-photo" src="/uploads/' + ph.filename + '" loading="lazy">' : '<div class="piece-photo-placeholder">🏺</div>';
  const gl = (p.glazes||[]).map(g => '<span class="glaze-tag">' + esc(g.glaze_name) + '</span>').join('');
  return '<div class="card piece-card" onclick="viewPiece(\'' + p.id + '\')">' + img +
    '<div class="card-header"><div><div class="card-title">' + esc(p.title||'Untitled') + '</div>' +
    '<div class="text-sm" style="color:var(--text-light)">' + esc(p.clay_body_name||'No clay specified') + '</div></div>' +
    fmtStatus(p.status) + '</div>' +
    (gl ? '<div class="piece-meta">' + gl + '</div>' : '') +
    '<div class="piece-meta">' +
    (p.studio ? '<span class="piece-meta-tag">📍 ' + esc(p.studio) + '</span>' : '') +
    (p.technique ? '<span class="piece-meta-tag">' + esc(p.technique) + '</span>' : '') +
    (p.date_started ? '<span class="piece-meta-tag">' + fmtDate(p.date_started) + '</span>' : '') +
    '</div></div>';
}

// ---- Pieces ----
async function loadPieces() {
  try {
    const s = document.getElementById('pieceSearch')?.value||'';
    const st = document.getElementById('pieceStatusFilter')?.value||'';
    let u = '/api/pieces?';
    if (s) u += 'search=' + encodeURIComponent(s) + '&';
    if (st) u += 'status=' + encodeURIComponent(st) + '&';
    const pieces = await api(u);
    const c = document.getElementById('piecesList'), em = document.getElementById('piecesEmpty');
    if (!pieces.length) { c.innerHTML = ''; em.classList.remove('hidden'); }
    else { em.classList.add('hidden'); c.innerHTML = pieces.map(pieceCard).join(''); }
  } catch (err) { toast(err.message, 'error'); }
}
function debounceLoadPieces() { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadPieces, 300); }

// ---- Piece Detail ----
async function viewPiece(id) {
  try {
    const p = await api('/api/pieces/' + id);
    navigate('pieceDetail');
    const photos = (p.photos||[]).map(ph =>
      '<div class="detail-photo-wrap"><img class="detail-photo" src="/uploads/' + ph.filename + '" title="' + esc(ph.stage||'') + '">' +
      '<span class="photo-stage-label">' + esc(ph.stage||'') + '</span></div>'
    ).join('');
    const glist = (p.glazes||[]).map(g =>
      '<div style="margin-bottom:6px"><span class="glaze-tag' + (g.glaze_type==='recipe'?' recipe':'') + '">' + esc(g.glaze_name) + '</span>' +
      (g.brand ? ' <span class="text-sm" style="color:var(--text-light)">— ' + esc(g.brand) + '</span>' : '') +
      (g.coats > 1 ? ' <span class="text-sm" style="color:var(--text-light)">(' + g.coats + ' coats)</span>' : '') +
      (g.application_method ? ' <span class="text-sm" style="color:var(--text-light)">— ' + esc(g.application_method) + '</span>' : '') +
      '</div>'
    ).join('') || '<span style="color:var(--text-muted)">No glazes recorded</span>';
    const firings = (p.firings||[]).map(f =>
      '<div class="card" style="padding:14px;margin-bottom:8px"><strong>' + esc(f.firing_type||'Firing') + '</strong> — Cone ' + esc(f.cone||'?') +
      (f.atmosphere ? ' (' + esc(f.atmosphere) + ')' : '') + (f.kiln_name ? ' — ' + esc(f.kiln_name) : '') +
      (f.firing_speed ? '<br><span class="text-sm"><strong>Speed:</strong> ' + esc(f.firing_speed) + '</span>' : '') +
      (f.hold_used ? '<br><span class="text-sm"><strong>Hold:</strong> Yes' + (f.hold_duration ? ' — ' + esc(f.hold_duration) : '') + '</span>' : '') +
      (f.date ? '<br><span class="text-sm" style="color:var(--text-light)">' + fmtDate(f.date) + '</span>' : '') +
      (f.results ? '<br><span class="text-sm">' + esc(f.results) + '</span>' : '') + '</div>'
    ).join('');

    const maxPhotos = (currentUser?.tier || 'free') === 'free' ? 1 : 3;
    const canAddPhoto = (p.photos||[]).length < maxPhotos;

    document.getElementById('pieceDetailContent').innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px"><div>' +
      '<h1>' + esc(p.title||'Untitled') + '</h1>' +
      '<div class="text-sm" style="color:var(--text-light);margin-top:4px">' + esc(p.clay_body_name||'') + ' ' + fmtStatus(p.status) + '</div></div>' +
      '<div style="display:flex;gap:8px">' +
      (canAddPhoto ? '<button class="btn btn-secondary btn-sm" onclick="openPhotoUpload(\'' + p.id + '\')">📸 Photo</button>' : '') +
      '<button class="btn btn-primary btn-sm" onclick="editPiece(\'' + p.id + '\')">✏️ Edit</button>' +
      '<button class="btn btn-danger btn-sm" onclick="deletePiece(\'' + p.id + '\')">🗑️</button></div></div>' +
      (photos ? '<div class="detail-photos mb-16">' + photos + '</div>' : '') +
      '<div class="detail-grid"><div class="card"><h3 style="margin-bottom:16px">Details</h3>' +
      df('Clay Body', p.clay_body_name) + df('Technique', p.technique) + df('Form', p.form) +
      df('Studio', p.studio) + df('Dimensions', p.dimensions) + df('Weight', p.weight) +
      df('Started', fmtDate(p.date_started)) +
      (p.date_completed ? df('Completed', fmtDate(p.date_completed)) : '') +
      (p.material_cost ? df('Material Cost', '$' + p.material_cost) : '') +
      (p.firing_cost ? df('Firing Cost', '$' + p.firing_cost) : '') +
      (p.sale_price ? df('Sale Price', '$' + p.sale_price) : '') +
      (p.notes ? df('Notes', p.notes) : '') + '</div>' +
      '<div><div class="card mb-16"><h3 style="margin-bottom:12px">Glazes</h3>' + glist + '</div>' +
      (firings ? '<div class="card"><h3 style="margin-bottom:12px">Firings</h3>' + firings + '</div>' : '') +
      '</div></div>';
  } catch (err) { toast(err.message, 'error'); }
}
function df(label, val) {
  return '<div class="detail-field"><div class="detail-label">' + label + '</div><div class="detail-value">' + (val ? esc(String(val)) : '—') + '</div></div>';
}

// ---- Piece CRUD ----
function populateClaySelect(selId, selVal) {
  const s = document.getElementById(selId);
  s.innerHTML = '<option value="">Select clay...</option>' + clayBodies.map(c => '<option value="' + c.id + '"' + (c.id===selVal?' selected':'') + '>' + esc(c.name) + (c.brand?' ('+esc(c.brand)+')':'') + '</option>').join('');
}
function glazeOpts() {
  return '<option value="">Select glaze...</option>' + glazes.map(g => '<option value="' + g.id + '">' + esc(g.name) + (g.brand?' ('+esc(g.brand)+')':'') + '</option>').join('');
}
function addGlazeSelector(gId, coats, method) {
  const c = document.getElementById('pieceGlazeSelectors');
  const r = document.createElement('div'); r.className = 'glaze-selector-row';
  r.innerHTML = '<select class="form-select gs">' + glazeOpts() + '</select>' +
    '<input type="number" class="form-input gc" placeholder="Coats" min="1" value="' + (coats||1) + '" style="width:80px;flex:none">' +
    '<select class="form-select gm" style="width:100px;flex:none"><option value="">Method</option><option value="dip"' + (method==='dip'?' selected':'') + '>Dip</option><option value="brush"' + (method==='brush'?' selected':'') + '>Brush</option><option value="spray"' + (method==='spray'?' selected':'') + '>Spray</option><option value="pour"' + (method==='pour'?' selected':'') + '>Pour</option><option value="wax-resist"' + (method==='wax-resist'?' selected':'') + '>Wax Resist</option></select>' +
    '<button type="button" class="remove-row" onclick="this.parentElement.remove()">×</button>';
  if (gId) r.querySelector('.gs').value = gId;
  c.appendChild(r);
}
function openPieceModal(p) {
  document.getElementById('pieceId').value = p?.id||'';
  document.getElementById('pieceModalTitle').textContent = p ? 'Edit Piece' : 'Add New Piece';
  document.getElementById('pieceTitle').value = p?.title||'';
  document.getElementById('pieceStatus').value = p?.status||'in-progress';
  document.getElementById('pieceTechnique').value = p?.technique||'';
  document.getElementById('pieceForm_').value = p?.form||'';
  document.getElementById('pieceStudio').value = p?.studio||'';
  document.getElementById('pieceDateStarted').value = p?.date_started||'';
  document.getElementById('pieceNotes').value = p?.notes||'';
  populateClaySelect('pieceClay', p?.clay_body_id);
  document.getElementById('pieceGlazeSelectors').innerHTML = '';
  (p?.glazes||[]).forEach(g => addGlazeSelector(g.glaze_id, g.coats, g.application_method));
  openModal('pieceModal');
}
async function editPiece(id) { try { openPieceModal(await api('/api/pieces/'+id)); } catch(e) { toast(e.message,'error'); } }
async function savePiece(e) {
  e.preventDefault();
  const id = document.getElementById('pieceId').value;
  const gRows = document.querySelectorAll('.glaze-selector-row');
  const gIds = [];
  gRows.forEach(r => { const v = r.querySelector('.gs').value; if (v) gIds.push({ glazeId:v, coats:parseInt(r.querySelector('.gc').value)||1, method:r.querySelector('.gm').value||null }); });
  const body = {
    title: document.getElementById('pieceTitle').value,
    clayBodyId: document.getElementById('pieceClay').value||null,
    status: document.getElementById('pieceStatus').value,
    technique: document.getElementById('pieceTechnique').value||null,
    form: document.getElementById('pieceForm_').value||null,
    studio: document.getElementById('pieceStudio').value||null,
    dateStarted: document.getElementById('pieceDateStarted').value||null,
    notes: document.getElementById('pieceNotes').value||null,
    glazeIds: gIds
  };
  try {
    if (id) { await api('/api/pieces/'+id, {method:'PUT',body}); toast('Piece updated!','success'); }
    else { await api('/api/pieces', {method:'POST',body}); toast('Piece added!','success'); }
    closeModal('pieceModal');
    if (currentPage==='dashboard') loadDashboard(); else if (currentPage==='pieces') loadPieces(); else if (currentPage==='pieceDetail'&&id) viewPiece(id);
  } catch(err) { toast(err.message,'error'); }
}
async function deletePiece(id) {
  if (!confirm('Delete this piece? This cannot be undone.')) return;
  try { await api('/api/pieces/'+id, {method:'DELETE'}); toast('Piece deleted','success'); navigate('pieces'); } catch(e) { toast(e.message,'error'); }
}

// ---- Photos ----
function openPhotoUpload(pid) {
  document.getElementById('photoPieceId').value = pid;
  document.getElementById('photoFile').value = '';
  document.getElementById('photoPreview').innerHTML = '';
  document.getElementById('photoPreview').classList.add('hidden');
  document.getElementById('photoSubmitBtn').disabled = true;
  openModal('photoModal');
}
function handlePhotoSelect(input) {
  if (input.files?.[0]) {
    const r = new FileReader();
    r.onload = e => {
      const p = document.getElementById('photoPreview');
      p.innerHTML = '<img src="' + e.target.result + '" style="max-width:100%;max-height:200px;border-radius:var(--radius-sm)">';
      p.classList.remove('hidden');
      document.getElementById('photoSubmitBtn').disabled = false;
    };
    r.readAsDataURL(input.files[0]);
  }
}
const dz = document.getElementById('photoDropZone');
if (dz) {
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('dragover'); const i = document.getElementById('photoFile'); i.files = e.dataTransfer.files; handlePhotoSelect(i); });
}
async function uploadPhoto(e) {
  e.preventDefault();
  const pid = document.getElementById('photoPieceId').value;
  const f = document.getElementById('photoFile').files[0]; if (!f) return;
  const fd = new FormData(); fd.append('photo', f); fd.append('stage', document.getElementById('photoStage').value);
  try {
    const r = await fetch('/api/pieces/' + pid + '/photos', { method:'POST', headers:{Authorization:'Bearer '+token}, body:fd });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    toast('Photo uploaded!','success'); closeModal('photoModal'); viewPiece(pid);
  } catch(err) { toast(err.message,'error'); }
}

// ---- Clay Bodies ----
async function loadClayBodies() {
  try {
    clayBodies = await api('/api/clay-bodies');
    if (currentPage !== 'clayBodies') return;
    const c = document.getElementById('clayList'), em = document.getElementById('clayEmpty');
    if (!clayBodies.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = clayBodies.map(cl => {
      return '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(cl.name) + '</div>' +
        '<div class="text-sm" style="color:var(--text-light)">' + esc(cl.brand||'') + (cl.clay_type ? ' · ' + esc(cl.clay_type) : '') + '</div></div>' +
        '<div style="display:flex;gap:4px"><button class="btn-ghost btn-sm" onclick="editClayById(\'' + cl.id + '\')">✏️</button>' +
        '<button class="btn-ghost btn-sm" onclick="deleteClay(\'' + cl.id + '\')">🗑️</button></div></div>' +
        '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
        (cl.color_wet ? '<div><span class="detail-label">Wet</span><div>' + esc(cl.color_wet) + '</div></div>' : '') +
        (cl.color_fired ? '<div><span class="detail-label">Fired</span><div>' + esc(cl.color_fired) + '</div></div>' : '') +
        (cl.cone_range ? '<div><span class="detail-label">Cone</span><div>' + esc(cl.cone_range) + '</div></div>' : '') +
        (cl.shrinkage_pct ? '<div><span class="detail-label">Shrinkage</span><div>' + cl.shrinkage_pct + '%</div></div>' : '') +
        (cl.cost_per_bag ? '<div><span class="detail-label">Cost</span><div>$' + cl.cost_per_bag + (cl.bag_weight ? ' / ' + esc(cl.bag_weight) : '') + '</div></div>' : '') +
        '</div>' + (cl.notes ? '<div class="text-sm mt-8" style="color:var(--text-light)">' + esc(cl.notes) + '</div>' : '') + '</div>';
    }).join('');
  } catch(e) { toast(e.message,'error'); }
}
function editClayById(id) { const c = clayBodies.find(x=>x.id===id); if(c) openClayModal(c); }
function openClayModal(c) {
  document.getElementById('clayId').value = c?.id||'';
  document.getElementById('clayModalTitle').textContent = c ? 'Edit Clay Body' : 'Add Clay Body';
  document.getElementById('clayName').value = c?.name||'';
  document.getElementById('clayBrand').value = c?.brand||'';
  document.getElementById('clayType').value = c?.clay_type||'';
  document.getElementById('clayColorWet').value = c?.color_wet||'';
  document.getElementById('clayColorFired').value = c?.color_fired||'';
  document.getElementById('clayConeRange').value = c?.cone_range||'';
  document.getElementById('clayShrinkage').value = c?.shrinkage_pct||'';
  document.getElementById('clayCost').value = c?.cost_per_bag||'';
  document.getElementById('clayWeight').value = c?.bag_weight||'';
  document.getElementById('clayNotes').value = c?.notes||'';
  openModal('clayModal');
}
async function saveClay(e) {
  e.preventDefault();
  const id = document.getElementById('clayId').value;
  const body = { name:document.getElementById('clayName').value, brand:document.getElementById('clayBrand').value||null, clayType:document.getElementById('clayType').value||null, colorWet:document.getElementById('clayColorWet').value||null, colorFired:document.getElementById('clayColorFired').value||null, coneRange:document.getElementById('clayConeRange').value||null, shrinkagePct:parseFloat(document.getElementById('clayShrinkage').value)||null, costPerBag:parseFloat(document.getElementById('clayCost').value)||null, bagWeight:document.getElementById('clayWeight').value||null, notes:document.getElementById('clayNotes').value||null };
  try {
    if (id) { await api('/api/clay-bodies/'+id, {method:'PUT',body}); toast('Clay updated!','success'); }
    else { await api('/api/clay-bodies', {method:'POST',body}); toast('Clay added!','success'); }
    closeModal('clayModal'); loadClayBodies();
  } catch(e) { toast(e.message,'error'); }
}
async function deleteClay(id) {
  if (!confirm('Delete this clay body?')) return;
  try { await api('/api/clay-bodies/'+id, {method:'DELETE'}); toast('Deleted','success'); loadClayBodies(); } catch(e) { toast(e.message,'error'); }
}

// ---- Glazes ----
async function loadGlazes() {
  try {
    glazes = await api('/api/glazes');
    if (currentPage !== 'glazes') return;
    const c = document.getElementById('glazeList'), em = document.getElementById('glazeEmpty');
    if (!glazes.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = glazes.map(g => {
      const photos = (g.photos||[]).map(p => '<img src="/uploads/' + p.filename + '" class="glaze-thumb" loading="lazy">').join('');
      return '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(g.name) +
        ' <span class="glaze-tag' + (g.glaze_type==='recipe'?' recipe':'') + '">' + g.glaze_type + '</span></div>' +
        '<div class="text-sm" style="color:var(--text-light)">' + esc(g.brand||'') + (g.sku ? ' · SKU: ' + esc(g.sku) : '') + (g.color_description ? ' · ' + esc(g.color_description) : '') + '</div></div>' +
        '<div style="display:flex;gap:4px"><button class="btn-ghost btn-sm" onclick="editGlazeById(\'' + g.id + '\')">✏️</button>' +
        '<button class="btn-ghost btn-sm" onclick="deleteGlaze(\'' + g.id + '\')">🗑️</button></div></div>' +
        (photos ? '<div style="display:flex;gap:6px;margin-bottom:10px">' + photos + '</div>' : '') +
        '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
        (g.cone_range ? '<div><span class="detail-label">Cone</span><div>' + esc(g.cone_range) + '</div></div>' : '') +
        (g.atmosphere ? '<div><span class="detail-label">Atmosphere</span><div>' + esc(g.atmosphere) + '</div></div>' : '') +
        (g.surface ? '<div><span class="detail-label">Surface</span><div>' + esc(g.surface) + '</div></div>' : '') +
        '</div>' +
        (g.ingredients?.length ? '<div class="mt-8"><span class="detail-label">Recipe</span><div class="text-sm">' + g.ingredients.map(i=>esc(i.ingredient_name) + (i.percentage ? ' '+i.percentage+'%' : '')).join(', ') + '</div></div>' : '') +
        (g.notes ? '<div class="text-sm mt-8" style="color:var(--text-light)">' + esc(g.notes) + '</div>' : '') +
        (currentUser?.tier !== 'free' && (g.photos||[]).length < 3 ? '<button class="btn btn-secondary btn-sm mt-8" onclick="uploadGlazePhoto(\'' + g.id + '\')">📸 Add Photo</button>' : '') +
        '</div>';
    }).join('');
  } catch(e) { toast(e.message,'error'); }
}

function uploadGlazePhoto(gId) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('photo', f);
    try {
      const r = await fetch('/api/glazes/' + gId + '/photos', { method:'POST', headers:{Authorization:'Bearer '+token}, body:fd });
      const d = await r.json(); if (!r.ok) throw new Error(d.error);
      toast('Glaze photo uploaded!','success'); loadGlazes();
    } catch(e) { toast(e.message,'error'); }
  };
  input.click();
}

function editGlazeById(id) { const g = glazes.find(x=>x.id===id); if(g) openGlazeModal(g); }
function openGlazeModal(g) {
  document.getElementById('glazeId').value = g?.id||'';
  document.getElementById('glazeModalTitle').textContent = g ? 'Edit Glaze' : 'Add Glaze';
  document.getElementById('glazeName').value = g?.name||'';
  document.getElementById('glazeType').value = g?.glaze_type||'commercial';
  document.getElementById('glazeBrand').value = g?.brand||'';
  document.getElementById('glazeSku').value = g?.sku||'';
  document.getElementById('glazeColor').value = g?.color_description||'';
  document.getElementById('glazeCone').value = g?.cone_range||'';
  document.getElementById('glazeAtmosphere').value = g?.atmosphere||'';
  document.getElementById('glazeSurface').value = g?.surface||'';
  document.getElementById('glazeNotes').value = g?.notes||'';
  toggleRecipeFields();
  document.getElementById('ingredientList').innerHTML = '';
  (g?.ingredients||[]).forEach(i => addIngredient(i.ingredient_name, i.percentage));
  openModal('glazeModal');
}
function toggleRecipeFields() {
  document.getElementById('recipeFields').classList.toggle('hidden', document.getElementById('glazeType').value !== 'recipe');
}
function addIngredient(name, pct) {
  const c = document.getElementById('ingredientList');
  const r = document.createElement('div'); r.className = 'ingredient-row';
  r.innerHTML = '<input type="text" class="form-input ing-name" placeholder="Ingredient" value="' + esc(name||'') + '">' +
    '<input type="number" class="form-input ing-pct" placeholder="%" step="0.1" value="' + (pct||'') + '" style="width:80px;flex:none">' +
    '<button type="button" class="remove-row" onclick="this.parentElement.remove()">×</button>';
  c.appendChild(r);
}
async function saveGlaze(e) {
  e.preventDefault();
  const id = document.getElementById('glazeId').value;
  const ings = []; document.querySelectorAll('.ingredient-row').forEach(r => {
    const n = r.querySelector('.ing-name').value; if(n) ings.push({name:n, percentage:parseFloat(r.querySelector('.ing-pct').value)||null});
  });
  const body = { name:document.getElementById('glazeName').value, glazeType:document.getElementById('glazeType').value, brand:document.getElementById('glazeBrand').value||null, sku:document.getElementById('glazeSku').value||null, colorDescription:document.getElementById('glazeColor').value||null, coneRange:document.getElementById('glazeCone').value||null, atmosphere:document.getElementById('glazeAtmosphere').value||null, surface:document.getElementById('glazeSurface').value||null, notes:document.getElementById('glazeNotes').value||null, ingredients:ings };
  try {
    if (id) { await api('/api/glazes/'+id, {method:'PUT',body}); toast('Glaze updated!','success'); }
    else { await api('/api/glazes', {method:'POST',body}); toast('Glaze added!','success'); }
    closeModal('glazeModal'); loadGlazes();
  } catch(e) { toast(e.message,'error'); }
}
async function deleteGlaze(id) {
  if (!confirm('Delete this glaze?')) return;
  try { await api('/api/glazes/'+id, {method:'DELETE'}); toast('Deleted','success'); loadGlazes(); } catch(e) { toast(e.message,'error'); }
}

// ---- Firings ----
async function loadFirings() {
  try {
    const firings = await api('/api/firing-logs');
    const c = document.getElementById('firingList'), em = document.getElementById('firingEmpty');
    if (!firings.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = firings.map(f =>
      '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(f.firing_type||'Firing') + ' — Cone ' + esc(f.cone||'?') + '</div>' +
      '<div class="text-sm" style="color:var(--text-light)">' + (f.kiln_name ? esc(f.kiln_name) + ' · ' : '') + fmtDate(f.date) +
      (f.atmosphere ? ' · ' + esc(f.atmosphere) : '') +
      (f.firing_speed ? ' · ' + esc(f.firing_speed) : '') +
      '</div></div>' +
      (f.piece_title ? '<span class="piece-meta-tag">' + esc(f.piece_title) + '</span>' : '') + '</div>' +
      (f.hold_used ? '<div class="text-sm"><strong>Hold:</strong> Yes' + (f.hold_duration ? ' — ' + esc(f.hold_duration) : '') + '</div>' : '') +
      (f.results ? '<div class="text-sm mt-8">' + esc(f.results) + '</div>' : '') +
      (f.notes ? '<div class="text-sm mt-8" style="color:var(--text-light)">' + esc(f.notes) + '</div>' : '') +
      '</div>'
    ).join('');
  } catch(e) { toast(e.message,'error'); }
}
function openFiringModal() {
  document.getElementById('firingType').value = 'bisque';
  document.getElementById('firingDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('firingCone').value = '';
  document.getElementById('firingAtmosphere').value = '';
  document.getElementById('firingKiln').value = '';
  document.getElementById('firingSpeed').value = '';
  document.getElementById('firingHoldUsed').value = '0';
  document.getElementById('firingHoldDuration').value = '';
  document.getElementById('firingHoldDuration').parentElement.classList.add('hidden');
  document.getElementById('firingNotes').value = '';
  api('/api/pieces').then(pieces => {
    const s = document.getElementById('firingPiece');
    s.innerHTML = '<option value="">Select piece (optional)...</option>' + pieces.map(p => '<option value="' + p.id + '">' + esc(p.title||'Untitled') + '</option>').join('');
  });
  openModal('firingModal');
}
async function saveFiring(e) {
  e.preventDefault();
  const body = {
    pieceId:document.getElementById('firingPiece').value||null,
    firingType:document.getElementById('firingType').value,
    cone:document.getElementById('firingCone').value||null,
    atmosphere:document.getElementById('firingAtmosphere').value||null,
    kilnName:document.getElementById('firingKiln').value||null,
    firingSpeed:document.getElementById('firingSpeed').value||null,
    holdUsed:document.getElementById('firingHoldUsed').value==='1',
    holdDuration:document.getElementById('firingHoldDuration').value||null,
    date:document.getElementById('firingDate').value||null,
    notes:document.getElementById('firingNotes').value||null
  };
  try { await api('/api/firing-logs', {method:'POST',body}); toast('Firing logged!','success'); closeModal('firingModal'); loadFirings(); }
  catch(e) { toast(e.message,'error'); }
}

// ---- Sales ----
async function loadSales() {
  try {
    const sales = await api('/api/sales');
    const c = document.getElementById('salesList'), em = document.getElementById('salesEmpty');
    const sum = document.getElementById('salesSummary');
    if (!sales.length) { c.innerHTML=''; sum.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    const total = sales.reduce((s,x) => s + (x.price||0), 0);
    sum.innerHTML = '<div class="stat-box"><div class="stat-number">' + sales.length + '</div><div class="stat-label">Sales</div></div>' +
      '<div class="stat-box"><div class="stat-number">$' + total.toFixed(0) + '</div><div class="stat-label">Revenue</div></div>' +
      '<div class="stat-box"><div class="stat-number">$' + (total/sales.length).toFixed(0) + '</div><div class="stat-label">Avg Price</div></div>';
    c.innerHTML = sales.map(s =>
      '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(s.piece_title||'Unknown piece') + '</div>' +
      '<div class="text-sm" style="color:var(--text-light)">' + fmtDate(s.date) + (s.venue ? ' · ' + esc(s.venue) : '') + '</div></div>' +
      '<div style="font-family:var(--font-display);font-size:1.2rem;font-weight:700;color:var(--accent)">$' + (s.price||0).toFixed(0) + '</div></div>' +
      (s.venue_type ? '<span class="piece-meta-tag">' + esc(s.venue_type) + '</span>' : '') + '</div>'
    ).join('');
  } catch(e) { toast(e.message,'error'); }
}
function openSaleModal() {
  document.getElementById('salePrice').value = '';
  document.getElementById('saleDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('saleVenueType').value = '';
  document.getElementById('saleVenue').value = '';
  api('/api/pieces').then(pieces => {
    const s = document.getElementById('salePiece');
    s.innerHTML = '<option value="">Select piece...</option>' + pieces.map(p => '<option value="' + p.id + '">' + esc(p.title||'Untitled') + '</option>').join('');
  });
  openModal('saleModal');
}
async function saveSale(e) {
  e.preventDefault();
  const body = { pieceId:document.getElementById('salePiece').value||null, price:parseFloat(document.getElementById('salePrice').value), date:document.getElementById('saleDate').value||null, venueType:document.getElementById('saleVenueType').value||null, venue:document.getElementById('saleVenue').value||null };
  try { await api('/api/sales', {method:'POST',body}); toast('Sale logged!','success'); closeModal('saleModal'); loadSales(); }
  catch(e) { toast(e.message,'error'); }
}

// ---- Community Combos ----
function debounceLoadCombos() { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadCombos, 300); }
async function loadCombos() {
  try {
    const search = document.getElementById('comboSearch')?.value||'';
    const cone = document.getElementById('comboConeFilter')?.value||'';
    let u = '/api/community/combos?';
    if (search) u += 'search=' + encodeURIComponent(search) + '&';
    if (cone) u += 'cone=' + encodeURIComponent(cone) + '&';
    const combos = await api(u);
    const c = document.getElementById('comboList'), em = document.getElementById('communityEmpty');
    if (!combos.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = combos.map(cb =>
      '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(cb.name) + '</div>' +
      '<div class="text-sm" style="color:var(--text-light)">by ' + esc(cb.author||'Anonymous') + '</div></div>' +
      '<div style="display:flex;gap:8px;align-items:center">' +
      (cb.cone ? '<span class="piece-meta-tag">Cone ' + esc(cb.cone) + '</span>' : '') +
      (cb.atmosphere ? '<span class="piece-meta-tag">' + esc(cb.atmosphere) + '</span>' : '') +
      '</div></div>' +
      (cb.clay_body_name ? '<div class="text-sm mb-16"><strong>Clay:</strong> ' + esc(cb.clay_body_name) + '</div>' : '') +
      '<div>' + (cb.layers||[]).map((l,i) => '<div style="margin-bottom:4px"><span style="color:var(--text-muted);font-size:0.8rem">Layer ' + (i+1) + ':</span> <span class="glaze-tag">' + esc(l.glaze_name) + '</span>' + (l.brand ? ' <span class="text-sm">(' + esc(l.brand) + ')</span>' : '') + (l.coats > 1 ? ' · ' + l.coats + ' coats' : '') + '</div>').join('') + '</div>' +
      (cb.description ? '<div class="text-sm mt-8" style="color:var(--text-light)">' + esc(cb.description) + '</div>' : '') + '</div>'
    ).join('');
  } catch(e) { toast(e.message,'error'); }
}
function addComboLayer(name, brand, coats) {
  const c = document.getElementById('comboLayers');
  const r = document.createElement('div'); r.className = 'combo-layer-row';
  r.innerHTML = '<input type="text" class="form-input cl-name" placeholder="Glaze name" value="' + esc(name||'') + '">' +
    '<input type="text" class="form-input cl-brand" placeholder="Brand" value="' + esc(brand||'') + '" style="width:120px;flex:none">' +
    '<input type="number" class="form-input cl-coats" placeholder="Coats" min="1" value="' + (coats||1) + '" style="width:70px;flex:none">' +
    '<button type="button" class="remove-row" onclick="this.parentElement.remove()">×</button>';
  c.appendChild(r);
}
function openComboModal() {
  document.getElementById('comboName').value = '';
  document.getElementById('comboClay').value = '';
  document.getElementById('comboCone').value = '';
  document.getElementById('comboDesc').value = '';
  document.getElementById('comboShared').checked = true;
  document.getElementById('comboLayers').innerHTML = '';
  addComboLayer(); addComboLayer();
  openModal('comboModal');
}
async function saveCombo(e) {
  e.preventDefault();
  const layers = []; document.querySelectorAll('.combo-layer-row').forEach(r => {
    const n = r.querySelector('.cl-name').value; if(n) layers.push({glazeName:n, brand:r.querySelector('.cl-brand').value||null, coats:parseInt(r.querySelector('.cl-coats').value)||1});
  });
  const body = { name:document.getElementById('comboName').value, clayBodyName:document.getElementById('comboClay').value||null, cone:document.getElementById('comboCone').value||null, description:document.getElementById('comboDesc').value||null, isShared:document.getElementById('comboShared').checked, layers };
  try { await api('/api/community/combos', {method:'POST',body}); toast('Combo saved!','success'); closeModal('comboModal'); loadCombos(); }
  catch(e) { toast(e.message,'error'); }
}

// ---- Forum ----
function debounceLoadForum() { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadForumPosts, 300); }
async function loadForum() {
  try {
    forumCategories = await api('/api/forum/categories');
    // Populate category filter
    const sel = document.getElementById('forumCategoryFilter');
    sel.innerHTML = '<option value="">All Categories</option>' + forumCategories.map(c => '<option value="' + c.id + '">' + c.icon + ' ' + esc(c.name) + ' (' + c.postCount + ')</option>').join('');
    // Populate post modal category
    const postSel = document.getElementById('forumPostCategory');
    if (postSel) postSel.innerHTML = forumCategories.map(c => '<option value="' + c.id + '">' + c.icon + ' ' + esc(c.name) + '</option>').join('');
    // Category cards
    const catEl = document.getElementById('forumCategories');
    catEl.innerHTML = forumCategories.map(c =>
      '<div class="stat-box forum-cat-card" onclick="document.getElementById(\'forumCategoryFilter\').value=\'' + c.id + '\';loadForumPosts()" style="cursor:pointer">' +
      '<div style="font-size:1.5rem">' + c.icon + '</div>' +
      '<div class="stat-label" style="font-weight:600;color:var(--text)">' + esc(c.name) + '</div>' +
      '<div class="text-sm" style="color:var(--text-muted)">' + c.postCount + ' posts</div></div>'
    ).join('');
    // Load token balance
    loadTokenBalance();
    loadForumPosts();
  } catch(e) {
    if (e.message.includes('Requires')) {
      document.getElementById('forumPosts').innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔒</div><div class="empty-state-title">Forum requires a paid plan</div><p>Upgrade to Basic or above to browse the forum.</p><button class="btn btn-primary mt-16" onclick="navigate(\'upgrade\')">View Plans</button></div>';
    } else { toast(e.message,'error'); }
  }
}
async function loadTokenBalance() {
  try {
    const b = await api('/api/tokens/balance');
    const el = document.getElementById('tokenBalance');
    if (b.hasUnlimited) { el.textContent = '✨ Unlimited posting'; el.className = 'piece-meta-tag'; }
    else { el.textContent = '🪙 ' + b.tokens + ' tokens'; el.className = 'piece-meta-tag'; }
  } catch(e) {}
}
async function loadForumPosts() {
  try {
    const search = document.getElementById('forumSearch')?.value||'';
    const cat = document.getElementById('forumCategoryFilter')?.value||'';
    let u = '/api/forum/posts?limit=30&';
    if (search) u += 'search=' + encodeURIComponent(search) + '&';
    if (cat) u += 'categoryId=' + encodeURIComponent(cat) + '&';
    const posts = await api(u);
    const c = document.getElementById('forumPosts'), em = document.getElementById('forumEmpty');
    if (!posts.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = posts.map(p => {
      const avatar = p.author_avatar ? '<img src="/uploads/' + p.author_avatar + '" class="forum-avatar">' : '<div class="forum-avatar-placeholder">' + (p.author_name||'?')[0].toUpperCase() + '</div>';
      const photos = (p.photos||[]).length ? '<span class="piece-meta-tag">📷 ' + p.photos.length + '</span>' : '';
      return '<div class="card forum-post-card" onclick="viewForumPost(\'' + p.id + '\')">' +
        '<div style="display:flex;gap:12px;align-items:flex-start">' + avatar +
        '<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
        '<div><div class="card-title">' + (p.is_pinned ? '📌 ' : '') + esc(p.title) + '</div>' +
        '<div class="text-sm" style="color:var(--text-light)">' + esc(p.author_name||'Anonymous') +
        (p.category_name ? ' in <strong>' + esc(p.category_name) + '</strong>' : '') +
        ' · ' + timeAgo(p.created_at) + '</div></div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0">' +
        '<span class="piece-meta-tag">💬 ' + (p.reply_count||0) + '</span>' +
        '<span class="piece-meta-tag">👁 ' + (p.view_count||0) + '</span>' + photos + '</div></div>' +
        '<div class="text-sm mt-8" style="color:var(--text-light);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">' + esc(p.body.substring(0, 200)) + '</div>' +
        '</div></div></div>';
    }).join('');
  } catch(e) { toast(e.message,'error'); }
}

async function viewForumPost(id) {
  try {
    const post = await api('/api/forum/posts/' + id);
    navigate('forumPost');
    const avatar = post.author_avatar ? '<img src="/uploads/' + post.author_avatar + '" class="forum-avatar-lg">' : '<div class="forum-avatar-placeholder forum-avatar-lg">' + (post.author_name||'?')[0].toUpperCase() + '</div>';
    const photos = (post.photos||[]).map(p => '<img src="/uploads/' + p.filename + '" class="forum-photo" onclick="window.open(\'/uploads/' + p.filename + '\',\'_blank\')">').join('');
    const replies = (post.replies||[]).map(r => {
      const ra = r.author_avatar ? '<img src="/uploads/' + r.author_avatar + '" class="forum-avatar">' : '<div class="forum-avatar-placeholder">' + (r.author_name||'?')[0].toUpperCase() + '</div>';
      const rPhotos = (r.photos||[]).map(p => '<img src="/uploads/' + p.filename + '" class="forum-photo-sm">').join('');
      return '<div class="forum-reply">' +
        '<div style="display:flex;gap:10px">' + ra +
        '<div style="flex:1"><div style="display:flex;justify-content:space-between"><strong>' + esc(r.author_name||'Anonymous') + '</strong>' +
        '<span class="text-sm" style="color:var(--text-muted)">' + timeAgo(r.created_at) + '</span></div>' +
        '<div class="mt-8" style="white-space:pre-wrap">' + esc(r.body) + '</div>' +
        (rPhotos ? '<div class="forum-photos-row mt-8">' + rPhotos + '</div>' : '') +
        '</div></div></div>';
    }).join('');

    document.getElementById('forumPostContent').innerHTML =
      '<div class="card"><div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:16px">' + avatar +
      '<div><h2>' + esc(post.title) + '</h2>' +
      '<div class="text-sm" style="color:var(--text-light)">by <strong>' + esc(post.author_name||'Anonymous') + '</strong> · ' + timeAgo(post.created_at) +
      ' · 👁 ' + post.view_count + ' views · 💬 ' + post.reply_count + ' replies</div></div></div>' +
      '<div style="white-space:pre-wrap;margin-bottom:16px">' + esc(post.body) + '</div>' +
      (photos ? '<div class="forum-photos-row mb-16">' + photos + '</div>' : '') +
      '</div>' +
      '<h3 class="mt-24 mb-16">Replies (' + (post.replies||[]).length + ')</h3>' +
      (replies || '<div class="text-sm" style="color:var(--text-muted)">No replies yet — be the first!</div>') +
      '<div class="card mt-16"><h3 style="margin-bottom:12px">Reply</h3>' +
      '<textarea class="form-textarea" id="replyBody" placeholder="Write your reply..." style="min-height:80px"></textarea>' +
      '<div class="form-group mt-8"><input type="file" id="replyPhotos" accept="image/*" multiple class="form-input" style="font-size:0.85rem"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">' +
      '<span class="text-sm" style="color:var(--text-muted)">🪙 Uses 1 forum token</span>' +
      '<button class="btn btn-primary" onclick="submitReply(\'' + post.id + '\')">Reply</button></div></div>';
  } catch(e) { toast(e.message,'error'); }
}

async function submitReply(postId) {
  const body = document.getElementById('replyBody').value;
  if (!body.trim()) { toast('Write something first!','error'); return; }
  const fd = new FormData();
  fd.append('body', body);
  const files = document.getElementById('replyPhotos').files;
  for (let i = 0; i < Math.min(files.length, 3); i++) fd.append('photos', files[i]);
  try {
    const r = await fetch('/api/forum/posts/' + postId + '/reply', { method:'POST', headers:{Authorization:'Bearer '+token}, body:fd });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    toast('Reply posted!','success'); viewForumPost(postId);
  } catch(e) { toast(e.message,'error'); }
}
// ---- app3.js: final section ----
// Forum post modal, save, shop, profile, upgrade, init

function openForumPostModal() {
  document.getElementById('forumPostTitle').value = '';
  document.getElementById('forumPostBody').value = '';
  if (document.getElementById('forumPostPhotos')) document.getElementById('forumPostPhotos').value = '';
  openModal('forumPostModal');
}

async function saveForumPost(e) {
  e.preventDefault();
  const fd = new FormData();
  fd.append('title', document.getElementById('forumPostTitle').value);
  fd.append('body', document.getElementById('forumPostBody').value);
  fd.append('categoryId', document.getElementById('forumPostCategory').value);
  const files = document.getElementById('forumPostPhotos')?.files;
  if (files) { for (let i = 0; i < Math.min(files.length, 3); i++) fd.append('photos', files[i]); }
  try {
    const r = await fetch('/api/forum/posts', { method:'POST', headers:{Authorization:'Bearer '+token}, body:fd });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    toast('Post published!','success'); closeModal('forumPostModal'); loadForumPosts(); loadTokenBalance();
  } catch(e) { toast(e.message,'error'); }
}

// ---- Shop ----
async function loadShop() {
  try {
    const products = await api('/api/shop/products');
    const c = document.getElementById('shopProducts');
    if (!products.length) {
      c.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🛍️</div><div class="empty-state-title">Shop coming soon!</div><p>Stickers, journals, and pottery resources — stay tuned.</p></div>';
      return;
    }
    c.innerHTML = products.map(p => {
      const img = p.image_filename ? '<img src="/uploads/' + p.image_filename + '" class="shop-product-img">' : '<div class="shop-product-placeholder">' + (p.product_type === 'sticker' ? '🏷️' : p.product_type === 'journal' ? '📓' : p.product_type === 'pdf' ? '📄' : '🎁') + '</div>';
      const typeLabel = p.is_digital ? '<span class="piece-meta-tag">Digital Download</span>' : '<span class="piece-meta-tag">Physical</span>';
      return '<div class="card shop-product-card">' + img +
        '<div class="card-title">' + esc(p.name) + '</div>' +
        (p.description ? '<div class="text-sm" style="color:var(--text-light);margin:6px 0">' + esc(p.description) + '</div>' : '') +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">' +
        '<div style="font-family:var(--font-display);font-size:1.3rem;font-weight:700;color:var(--primary)">$' + p.price.toFixed(2) + '</div>' +
        typeLabel + '</div>' +
        '<button class="btn btn-primary btn-sm mt-8" style="width:100%" onclick="buyProduct(\'' + p.id + '\')">Buy Now</button></div>';
    }).join('');
  } catch(e) { toast(e.message,'error'); }
}

async function buyProduct(id) {
  try {
    const d = await api('/api/shop/checkout', { method:'POST', body: { productId: id } });
    if (d.url) window.location.href = d.url;
  } catch(e) { toast(e.message,'error'); }
}

// ---- Profile ----
async function loadProfile() {
  try {
    const d = await api('/api/auth/me');
    currentUser = d.user;
    document.getElementById('profileName').value = d.user.display_name || '';
    document.getElementById('profileBio').value = d.user.bio || '';
    document.getElementById('profileLocation').value = d.user.location || '';
    document.getElementById('profileWebsite').value = d.user.website || '';
    document.getElementById('profilePrivate').checked = !!d.user.is_private;
    document.getElementById('profileUnits').value = d.user.unit_system || 'imperial';
    document.getElementById('profileTemp').value = d.user.temp_unit || 'fahrenheit';

    // Tier info
    const tier = d.user.tier || 'free';
    const tierNames = { free: 'Free', basic: 'Basic ($9.95/mo)', mid: 'Mid ($12.95/mo)', top: 'Top ($19.95/mo)' };
    document.getElementById('profileTierInfo').innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span class="tier-badge tier-' + tier + '" style="font-size:0.9rem;padding:4px 12px">' + tier.toUpperCase() + '</span> ' + tierNames[tier] + '</div>' +
      (tier === 'free' ? '<button class="btn btn-primary" onclick="navigate(\'upgrade\')">Upgrade Your Plan</button>' :
       '<button class="btn btn-secondary btn-sm" onclick="navigate(\'upgrade\')">Change Plan</button>');

    // Token info
    const tb = await api('/api/tokens/balance');
    document.getElementById('profileTokenInfo').innerHTML =
      '<div style="margin-bottom:8px">🪙 <strong>' + tb.tokens + '</strong> tokens' +
      (tb.hasUnlimited ? ' + <strong>Unlimited posting</strong> until ' + fmtDate(tb.unlimitedUntil) : '') + '</div>' +
      (tier !== 'free' ? '<button class="btn btn-secondary btn-sm" onclick="navigate(\'upgrade\')">Buy Tokens</button>' : '<div class="text-sm" style="color:var(--text-muted)">Upgrade to a paid plan to purchase forum tokens</div>');
  } catch(e) { toast(e.message,'error'); }
}

async function saveProfile() {
  try {
    await api('/api/profile', { method: 'PUT', body: {
      displayName: document.getElementById('profileName').value,
      bio: document.getElementById('profileBio').value || null,
      location: document.getElementById('profileLocation').value || null,
      website: document.getElementById('profileWebsite').value || null,
      isPrivate: document.getElementById('profilePrivate').checked,
      unitSystem: document.getElementById('profileUnits').value,
      tempUnit: document.getElementById('profileTemp').value
    }});
    toast('Profile saved!', 'success');
  } catch(e) { toast(e.message,'error'); }
}

// ---- Upgrade / Billing ----
async function loadUpgrade() {
  try {
    const d = await api('/api/billing/plans');
    const tier = currentUser?.tier || 'free';
    const tierLv = { free: 0, basic: 1, mid: 2, top: 3 };

    let html = '<div class="upgrade-plans">';
    d.plans.forEach(p => {
      const isCurrent = p.id === tier;
      const isDowngrade = tierLv[p.id] < tierLv[tier];
      html += '<div class="upgrade-plan-card' + (isCurrent ? ' current' : '') + '">' +
        '<div class="plan-name">' + esc(p.name) + '</div>' +
        '<div class="plan-price">' + (p.price ? '$' + p.price.toFixed(2) + '<span class="plan-period">/mo</span>' : 'Free') + '</div>' +
        '<ul class="plan-features">' + p.features.map(f => '<li>✓ ' + esc(f) + '</li>').join('') + '</ul>' +
        (isCurrent ? '<button class="btn btn-secondary" disabled>Current Plan</button>' :
         p.id === 'free' ? '' :
         isDowngrade ? '' :
         '<button class="btn btn-primary" onclick="subscribePlan(\'' + p.id + '\')">' + (d.stripeEnabled ? 'Subscribe' : 'Coming Soon') + '</button>') +
        '</div>';
    });
    html += '</div>';

    // Token packs section (only for paid users)
    if (tierLv[tier] >= 1) {
      html += '<h2 class="mt-24 mb-16">🪙 Forum Tokens</h2>' +
        '<p class="text-sm mb-16" style="color:var(--text-light)">Tokens let you post and reply in the forum. 1 token = 1 post or reply. Tokens roll over as long as your membership is active.</p>' +
        '<div class="upgrade-plans">';
      d.tokenPacks.forEach(tp => {
        html += '<div class="upgrade-plan-card">' +
          '<div class="plan-name">' + tp.tokens + ' Tokens</div>' +
          '<div class="plan-price">$' + tp.price.toFixed(2) + '</div>' +
          '<button class="btn btn-primary btn-sm" onclick="buyTokens(\'' + tp.id + '\')">' + (d.stripeEnabled ? 'Buy' : 'Coming Soon') + '</button></div>';
      });
      html += '<div class="upgrade-plan-card">' +
        '<div class="plan-name">Unlimited Pass</div>' +
        '<div class="plan-price">$' + d.unlimitedPass.price.toFixed(2) + '<span class="plan-period">/30 days</span></div>' +
        '<div class="text-sm mb-16" style="color:var(--text-light)">Post and reply unlimited for 30 days. No token cost.</div>' +
        '<button class="btn btn-primary btn-sm" onclick="buyUnlimitedPass()">' + (d.stripeEnabled ? 'Buy Pass' : 'Coming Soon') + '</button></div>';
      html += '</div>';
    }

    // Promo code section
    html += '<div class="card mt-24" style="max-width:500px"><h3 style="margin-bottom:12px">🎟️ Have a Promo Code?</h3>' +
      '<div style="display:flex;gap:8px"><input type="text" class="form-input" id="promoCodeInput" placeholder="Enter code..." style="text-transform:uppercase">' +
      '<button class="btn btn-primary" onclick="redeemPromo()">Redeem</button></div></div>';

    // Admin promo creation (show for everyone for now — Christina can use it)
    html += '<div class="card mt-24" style="max-width:500px"><h3 style="margin-bottom:12px">🔧 Create Promo Codes</h3>' +
      '<div class="form-row"><div class="form-group"><label>Code</label><input type="text" class="form-input" id="newPromoCode" placeholder="e.g., FRIENDS2026" style="text-transform:uppercase"></div>' +
      '<div class="form-group"><label>Tier</label><select class="form-select" id="newPromoTier"><option value="basic">Basic</option><option value="mid">Mid</option><option value="top">Top</option></select></div></div>' +
      '<div class="form-row"><div class="form-group"><label>Days</label><input type="number" class="form-input" id="newPromoDays" value="30"></div>' +
      '<div class="form-group"><label>Max Uses (0=unlimited)</label><input type="number" class="form-input" id="newPromoUses" value="0"></div></div>' +
      '<button class="btn btn-primary btn-sm" onclick="createPromoCode()">Create Code</button>' +
      '<div id="promoCodesList" class="mt-16"></div></div>';

    document.getElementById('upgradeContent').innerHTML = html;
    loadPromoCodes();
  } catch(e) { toast(e.message,'error'); }
}

// Promo code redemption
async function redeemPromo() {
  const code = document.getElementById('promoCodeInput').value.trim();
  if (!code) { toast('Enter a promo code','error'); return; }
  try {
    const d = await api('/api/promo/redeem', { method:'POST', body: { code } });
    toast(d.message, 'success');
    if (d.token) { token = d.token; localStorage.setItem('mudlog_token', d.token); }
    const me = await api('/api/auth/me'); currentUser = me.user; showApp(); navigate('upgrade');
  } catch(e) { toast(e.message,'error'); }
}

// Admin: create promo codes
async function createPromoCode() {
  const code = document.getElementById('newPromoCode').value.trim();
  const tier = document.getElementById('newPromoTier').value;
  const days = parseInt(document.getElementById('newPromoDays').value) || 30;
  const uses = parseInt(document.getElementById('newPromoUses').value) || 0;
  if (!code) { toast('Enter a code','error'); return; }
  try {
    const d = await api('/api/promo/create', { method:'POST', body: { code, tier, durationDays: days, maxUses: uses } });
    toast('Promo code ' + d.code + ' created!', 'success');
    document.getElementById('newPromoCode').value = '';
    loadPromoCodes();
  } catch(e) { toast(e.message,'error'); }
}

async function loadPromoCodes() {
  try {
    const codes = await api('/api/promo/codes');
    const el = document.getElementById('promoCodesList');
    if (!el) return;
    if (!codes.length) { el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No promo codes yet</div>'; return; }
    el.innerHTML = codes.map(c =>
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div><strong>' + esc(c.code) + '</strong> — ' + c.tier.toUpperCase() + ' for ' + c.duration_days + ' days</div>' +
      '<div class="text-sm" style="color:var(--text-muted)">Used: ' + c.times_used + (c.max_uses > 0 ? '/' + c.max_uses : '/∞') + '</div></div>'
    ).join('');
  } catch(e) {}
}

async function subscribePlan(plan) {
  try {
    const d = await api('/api/billing/checkout', { method:'POST', body: { plan } });
    if (d.url) window.location.href = d.url;
  } catch(e) { toast(e.message,'error'); }
}

async function buyTokens(packId) {
  try {
    const d = await api('/api/billing/tokens', { method:'POST', body: { packId } });
    if (d.url) window.location.href = d.url;
  } catch(e) { toast(e.message,'error'); }
}

async function buyUnlimitedPass() {
  try {
    const d = await api('/api/billing/unlimited-pass', { method:'POST' });
    if (d.url) window.location.href = d.url;
  } catch(e) { toast(e.message,'error'); }
}

// ---- Init ----
checkAuth();
