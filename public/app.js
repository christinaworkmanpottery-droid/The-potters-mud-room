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
const STATUS_LABELS = { 'in-progress':'In Progress','leather-hard':'Leather Hard','bone-dry':'Bone Dry','bisque-fired':'Bisque Fired','glazed':'Glazed','glaze-fired':'Glaze Fired','done':'Done','sold':'Sold','broken':'Casualty','recycled':'Recycled' };
const CASUALTY_LABELS = { 'cracked':'Cracked','exploded':'Exploded / Blowout','warped':'Warped','s-crack':'S-Crack','glaze-crawl':'Glaze Crawl','glaze-pinhole':'Glaze Pinholing','glaze-shiver':'Glaze Shivering','glaze-crazing':'Glaze Crazing','glaze-runoff':'Glaze Ran Off','thermal-shock':'Thermal Shock','broke-trimming':'Broke While Trimming','broke-handling':'Broke While Handling','collapsed':'Collapsed','dunting':'Dunting','wrong-color':'Unexpected Color Result','other':'Other' };
function fmtStatus(s) { return s ? '<span class="status-badge status-' + s + '">' + (STATUS_LABELS[s]||s) + '</span>' : ''; }
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Check URL params for post-checkout messages and referral codes
function checkUrlParams() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('upgraded')) { toast('🎉 Welcome to ' + p.get('upgraded').toUpperCase() + ' tier! Enjoy your new features.', 'success'); }
  if (p.get('purchased')) { toast('🛍️ Purchase complete! Check your email for details.', 'success'); }
  if (p.get('cancelled')) { toast('Purchase cancelled.', ''); }
  // Detect referral code
  if (p.get('ref')) {
    sessionStorage.setItem('referral_code', p.get('ref'));
  }
  if (p.has('upgraded') || p.has('purchased') || p.has('cancelled') || p.has('ref')) {
    const ref = p.get('ref');
    const clean = window.location.pathname + (ref ? '?ref=' + ref : '');
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
  document.getElementById('authToggleLink').textContent = isSignUp ? 'Sign in' : "Create one — it's free!";
  document.getElementById('authError').classList.add('hidden');
}
document.getElementById('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('authEmail').value.trim().toLowerCase();
  document.getElementById('authEmail').value = email;
  const password = document.getElementById('authPassword').value;
  const name = document.getElementById('authName').value;
  const errEl = document.getElementById('authError');
  errEl.classList.add('hidden');
  try {
    const referredBy = sessionStorage.getItem('referral_code') || null;
    const data = await api(isSignUp ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST', body: isSignUp ? { email, password, displayName: name, referredBy } : { email, password }
    });
    if (isSignUp && referredBy) sessionStorage.removeItem('referral_code');
    token = data.token;
    localStorage.setItem('mudlog_token', token);
    currentUser = data.user;
    showApp();
  } catch (err) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
});
function logout() {
  token = null; currentUser = null;
  localStorage.removeItem('mudlog_token');
  document.getElementById('landingPage').style.display = '';
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainApp').classList.add('hidden');
}
async function checkAuth() {
  if (!token) { document.getElementById('landingPage').style.display = ''; return; }
  try { document.getElementById('landingPage').style.display = 'none'; const d = await api('/api/auth/me'); currentUser = d.user; showApp(); } catch { logout(); }
}
function showApp() {
  document.getElementById('landingPage').style.display = 'none';
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainApp').classList.remove('hidden');
  const badge = document.getElementById('navTier');
  const t = currentUser?.tier || 'free';
  badge.textContent = t.toUpperCase(); badge.className = 'tier-badge tier-' + t;
  // Show/hide tier-gated nav items
  const tier = currentUser?.tier || 'free';
  const tierLv = { free: 0, basic: 1, mid: 1, starter: 1, top: 1 };
  document.querySelectorAll('[data-min-tier]').forEach(el => {
    const min = el.getAttribute('data-min-tier');
    el.style.display = tierLv[tier] >= tierLv[min] ? '' : 'none';
  });
  checkUrlParams();
  loadDashboard(); loadClayBodies(); loadGlazes();
  pollNotificationBadges();
  // Show admin nav for Christina
  const adminNav = document.getElementById('navAdmin');
  if (adminNav && currentUser?.email === 'christinaworkmanpottery@gmail.com') adminNav.style.display = '';
  // Load profile photo in nav/profile
  loadProfilePhoto();
}

// ---- Navigation ----
let currentPage = 'dashboard';
function navigate(page) {
  try {
    currentPage = page;
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const map = {
      dashboard:'pageDashboard', pieces:'pagePieces', pieceDetail:'pagePieceDetail',
      clayBodies:'pageClayBodies', glazes:'pageGlazes', firings:'pageFirings',
      casualties:'pageCasualties',
      sales:'pageSales', goals:'pageGoals', projects:'pageProjects', events:'pageEvents',
      contacts:'pageContacts', community:'pageCommunity', forum:'pageForum',
      forumPost:'pageForumPost', profile:'pageProfile', shop:'pageShop',
      upgrade:'pageUpgrade', help:'pageHelp', admin:'pageAdmin',
      shoppingList:'pageShoppingList', chemicals:'pageChemicals',
      communityMembers:'pageCommunityMembers',
      memberProfile:'pageMemberProfile',
      notifications:'pageNotifications', messages:'pageMessages', messageThread:'pageMessageThread',
      blog:'pageBlog', blogPost:'pageBlogPost', publicCombo:'pagePublicCombo'
    };
    const el = document.getElementById(map[page]); if (el) el.classList.add('active');
    try { const nb = document.querySelector('.nav-link[data-page="' + page + '"]'); if (nb) nb.classList.add('active'); } catch(e) {}
  const loaders = {
    dashboard:loadDashboard, pieces:loadPieces, clayBodies:loadClayBodies,
    glazes:loadGlazes, firings:loadFirings, casualties:loadCasualties, sales:loadSales,
    goals:loadGoals, projects:loadProjects, events:loadEvents, contacts:loadContacts,
    community:loadCombos, forum:loadForum, profile:loadProfile,
    shop:loadShop, upgrade:loadUpgrade, admin:loadAdmin,
    shoppingList:loadShoppingList, chemicals:loadChemicals,
    communityMembers:loadCommunityMembers,
    notifications:loadNotifications, messages:loadMessages,
    blog:loadBlog
  };
  if (loaders[page]) loaders[page]();
    trackPageView('/' + page);
  } catch(navErr) { console.error('Navigation error:', navErr); }
}
function closeNav() {
  document.querySelector('.nav-dropdown')?.classList.remove('open');
  document.body.classList.remove('nav-open');
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
    // If "All Casualties" selected, load the casualties page instead
    if (st === 'casualties') { navigate('casualties'); return; }
    let u = '/api/pieces?';
    if (s) u += 'search=' + encodeURIComponent(s) + '&';
    if (st) u += 'status=' + encodeURIComponent(st) + '&';
    // Exclude casualties from main pieces list (they have their own view)
    if (!st) u += 'excludeCasualties=1&';
    const pieces = await api(u);
    const c = document.getElementById('piecesList'), em = document.getElementById('piecesEmpty');
    if (!pieces.length) { c.innerHTML = ''; em.classList.remove('hidden'); }
    else {
      em.classList.add('hidden');
      const mode = getViewMode('pieces');
      c.className = mode === 'list' ? '' : 'card-grid';
      c.innerHTML = pieces.map(p => mode === 'list' ? pieceListRow(p) : pieceCard(p)).join('');
    }
  } catch (err) { toast(err.message, 'error'); }
}
function pieceListRow(p) {
  return '<div class="card" style="padding:8px 14px;margin-bottom:4px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;cursor:pointer" onclick="viewPiece(\'' + p.id + '\')">' +
    '<strong style="min-width:150px">' + esc(p.title||'Untitled') + '</strong>' +
    '<span class="text-sm" style="color:var(--text-light);min-width:100px">' + esc(p.clay_body_name||'') + '</span>' +
    fmtStatus(p.status) +
    '<span class="text-sm" style="min-width:80px">' + esc(p.technique||'') + '</span>' +
    '<span class="text-sm" style="min-width:80px;color:var(--text-muted)">' + fmtDate(p.date_started) + '</span>' +
    '<span style="margin-left:auto;display:flex;gap:4px">' +
    '<button class="btn-ghost btn-sm" onclick="event.stopPropagation();duplicatePiece(\'' + p.id + '\')">📋</button></span></div>';
}
function debounceLoadPieces() { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadPieces, 300); }

// ---- Piece Detail ----
async function viewPiece(id) {
  try {
    const p = await api('/api/pieces/' + id);
    navigate('pieceDetail');
    const photos = (p.photos||[]).map(ph =>
      '<div class="detail-photo-wrap" style="position:relative">' +
      '<img class="detail-photo" src="/uploads/' + ph.filename + '" title="' + esc(ph.stage||'') + '" onclick="openLightbox(\'/uploads/' + ph.filename + '\')" style="cursor:zoom-in">' +
      '<span class="photo-stage-label">' + esc(ph.stage||'') + '</span>' +
      '<div style="position:absolute;top:4px;right:4px;display:flex;gap:2px">' +
      '<button class="btn-ghost btn-sm" onclick="event.stopPropagation();editPhotoStage(\'' + ph.id + '\',\'' + esc(ph.stage||'') + '\',\'' + p.id + '\')" title="Edit stage">✏️</button>' +
      '<button class="btn-ghost btn-sm" onclick="event.stopPropagation();deletePhoto(\'' + ph.id + '\',\'' + p.id + '\')" title="Delete photo">🗑️</button>' +
      '</div></div>'
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
      (f.firing_speed ? '<br><span class="text-sm"><strong>Speed:</strong> ' + esc(f.firing_speed) + (f.custom_speed_detail ? ' — ' + esc(f.custom_speed_detail) : '') + '</span>' : '') +
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
      '<button class="btn btn-secondary btn-sm" onclick="duplicatePiece(\'' + p.id + '\')">📋 Duplicate</button>' +
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
      (firings ? '<div class="card mb-16"><h3 style="margin-bottom:12px">Firings</h3>' + firings + '</div>' : '') +
      ((p.status === 'broken' || p.status === 'recycled') ? '<div class="card" style="border:2px solid var(--danger);background:rgba(220,53,69,0.05)"><h3 style="margin-bottom:12px;color:var(--danger)">' + (p.status === 'recycled' ? 'Recycle Report' : 'Casualty Report') + '</h3>' +
        df('What Happened', p.casualty_type ? CASUALTY_LABELS[p.casualty_type] || p.casualty_type : 'Not specified') +
        (p.casualty_notes ? df('What Went Wrong', p.casualty_notes) : '') +
        (p.casualty_lesson ? '<div class="detail-field" style="background:rgba(40,167,69,0.08);padding:10px;border-radius:var(--radius-sm);margin-top:8px"><div class="detail-label" style="color:var(--success)">🎓 Lesson Learned</div><div class="detail-value">' + esc(p.casualty_lesson) + '</div></div>' : '') +
        '</div>' : '') +
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
function toggleCasualtyFields() {
  const status = document.getElementById('pieceStatus').value;
  const show = (status === 'broken' || status === 'recycled');
  document.getElementById('casualtyFields').classList.toggle('hidden', !show);
  const title = document.getElementById('casualtyReportTitle');
  if (title) title.textContent = status === 'recycled' ? 'Recycle Report' : 'Casualty Report';
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
  // Casualty fields
  document.getElementById('pieceCasualtyType').value = p?.casualty_type||'';
  document.getElementById('pieceCasualtyNotes').value = p?.casualty_notes||'';
  document.getElementById('pieceCasualtyLesson').value = p?.casualty_lesson||'';
  toggleCasualtyFields();
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
    glazeIds: gIds,
    casualtyType: document.getElementById('pieceCasualtyType').value||null,
    casualtyNotes: document.getElementById('pieceCasualtyNotes').value||null,
    casualtyLesson: document.getElementById('pieceCasualtyLesson').value||null
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
function clayCardView(cl) {
  const stockBadge = cl.in_stock ? '' : '<span class="piece-meta-tag" style="background:rgba(220,53,69,0.1);color:var(--danger)">Out of Stock</span>';
  const photos = (cl.photos||[]).map(p =>
    '<div style="position:relative;display:inline-block"><img src="/uploads/' + p.filename + '" class="glaze-thumb" loading="lazy" onclick="openLightbox(\'/uploads/' + p.filename + '\')" style="cursor:zoom-in">' +
    '<div style="font-size:0.7rem;color:var(--text-muted);text-align:center">' + esc(p.photo_label||'') + '</div>' +
    (p.notes ? '<div style="font-size:0.65rem;color:var(--text-light)">' + esc(p.notes) + '</div>' : '') +
    '<button class="btn-ghost btn-sm" style="position:absolute;top:0;right:0;font-size:0.7rem" onclick="event.stopPropagation();deleteClayPhoto(\'' + p.id + '\')">×</button></div>'
  ).join('');
  return '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(cl.name) + ' ' + stockBadge + '</div>' +
    '<div class="text-sm" style="color:var(--text-light)">' + esc(cl.brand||'') + (cl.clay_type ? ' · ' + esc(cl.clay_type) : '') + '</div></div>' +
    '<div style="display:flex;gap:4px">' +
    '<button class="btn-ghost btn-sm" onclick="openClayPhotoUpload(\'' + cl.id + '\')" title="Add photo">📸</button>' +
    '<button class="btn-ghost btn-sm" onclick="duplicateClay(\'' + cl.id + '\')" title="Duplicate">📋</button>' +
    '<button class="btn-ghost btn-sm" onclick="editClayById(\'' + cl.id + '\')">✏️</button>' +
    '<button class="btn-ghost btn-sm" onclick="deleteClay(\'' + cl.id + '\')">🗑️</button></div></div>' +
    (photos ? '<div style="display:flex;gap:6px;margin-bottom:10px">' + photos + '</div>' : '') +
    '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
    (cl.color_wet ? '<div><span class="detail-label">Wet</span><div>' + esc(cl.color_wet) + '</div></div>' : '') +
    (cl.color_fired ? '<div><span class="detail-label">Fired</span><div>' + esc(cl.color_fired) + '</div></div>' : '') +
    (cl.cone_range ? '<div><span class="detail-label">Cone</span><div>' + esc(cl.cone_range) + '</div></div>' : '') +
    (cl.shrinkage_pct ? '<div><span class="detail-label">Shrinkage</span><div>' + cl.shrinkage_pct + '%</div></div>' : '') +
    (cl.absorption_pct ? '<div><span class="detail-label">Absorption</span><div>' + cl.absorption_pct + '%</div></div>' : '') +
    (cl.cost_per_bag ? '<div><span class="detail-label">Cost</span><div>$' + cl.cost_per_bag + (cl.bag_weight ? ' / ' + esc(cl.bag_weight) : '') + '</div></div>' : '') +
    '</div>' +
    (cl.source ? '<div class="text-sm mt-8">📍 ' + esc(cl.source) + (cl.source_url ? ' — <a href="' + esc(cl.source_url) + '" target="_blank" style="color:var(--primary)">visit</a>' : '') + '</div>' : '') +
    (cl.buy_url ? '<div class="text-sm mt-4"><a href="' + esc(cl.buy_url) + '" target="_blank" class="btn btn-primary btn-sm">🛒 Buy</a></div>' : '') +
    (cl.notes ? '<div class="text-sm mt-8" style="color:var(--text-light)">' + esc(cl.notes) + '</div>' : '') +
    '<div class="mt-8" style="display:flex;gap:4px"><button class="btn-ghost btn-sm" onclick="toggleClayStock(\'' + cl.id + '\',' + (cl.in_stock ? 'false' : 'true') + ')" style="font-size:0.75rem">' + (cl.in_stock ? '📦 Mark Out of Stock' : '✅ Mark In Stock') + '</button></div>' +
    '</div>';
}
function clayListView(cl) {
  const stock = cl.in_stock ? '✅' : '❌';
  return '<div class="card" style="padding:8px 14px;margin-bottom:4px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
    '<span style="min-width:24px">' + stock + '</span>' +
    '<strong style="min-width:150px">' + esc(cl.name) + '</strong>' +
    '<span class="text-sm" style="color:var(--text-light);min-width:100px">' + esc(cl.brand||'') + '</span>' +
    '<span class="text-sm" style="min-width:80px">' + esc(cl.clay_type||'') + '</span>' +
    '<span class="text-sm" style="min-width:60px">' + (cl.cone_range ? 'Cone ' + esc(cl.cone_range) : '') + '</span>' +
    '<span class="text-sm" style="min-width:70px">' + (cl.shrinkage_pct ? cl.shrinkage_pct + '% shrink' : '') + '</span>' +
    '<span style="margin-left:auto;display:flex;gap:4px">' +
    '<button class="btn-ghost btn-sm" onclick="duplicateClay(\'' + cl.id + '\')">📋</button>' +
    '<button class="btn-ghost btn-sm" onclick="editClayById(\'' + cl.id + '\')">✏️</button>' +
    '<button class="btn-ghost btn-sm" onclick="deleteClay(\'' + cl.id + '\')">🗑️</button></span></div>';
}
async function loadClayBodies() {
  try {
    clayBodies = await api('/api/clay-bodies');
    if (currentPage !== 'clayBodies') return;
    const c = document.getElementById('clayList'), em = document.getElementById('clayEmpty');
    if (!clayBodies.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    const mode = getViewMode('clay');
    c.className = mode === 'list' ? '' : 'card-grid';
    c.innerHTML = clayBodies.map(cl => mode === 'list' ? clayListView(cl) : clayCardView(cl)).join('');
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
  document.getElementById('clayAbsorption').value = c?.absorption_pct||'';
  document.getElementById('clayCost').value = c?.cost_per_bag||'';
  document.getElementById('clayWeight').value = c?.bag_weight||'';
  document.getElementById('claySource').value = c?.source||'';
  document.getElementById('claySourceUrl').value = c?.source_url||'';
  document.getElementById('clayBuyUrl').value = c?.buy_url||'';
  document.getElementById('clayInStock').checked = c?.in_stock !== 0;
  document.getElementById('clayNotes').value = c?.notes||'';
  openModal('clayModal');
}
async function saveClay(e) {
  e.preventDefault();
  const id = document.getElementById('clayId').value;
  const body = { name:document.getElementById('clayName').value, brand:document.getElementById('clayBrand').value||null, clayType:document.getElementById('clayType').value||null, colorWet:document.getElementById('clayColorWet').value||null, colorFired:document.getElementById('clayColorFired').value||null, coneRange:document.getElementById('clayConeRange').value||null, shrinkagePct:parseFloat(document.getElementById('clayShrinkage').value)||null, absorptionPct:parseFloat(document.getElementById('clayAbsorption').value)||null, costPerBag:parseFloat(document.getElementById('clayCost').value)||null, bagWeight:document.getElementById('clayWeight').value||null, source:document.getElementById('claySource').value||null, sourceUrl:document.getElementById('claySourceUrl').value||null, buyUrl:document.getElementById('clayBuyUrl').value||null, inStock:document.getElementById('clayInStock').checked, notes:document.getElementById('clayNotes').value||null };
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
const RECIPE_STATUS_LABELS = {'not-tested':'Not Tested','testing':'Testing','production':'Production','retired':'Retired','archived':'Archived'};
const STOCK_STATUS_LABELS = {'in-stock':'In Stock','need-to-buy':'Need to Buy','low-stock':'Low Stock','discontinued':'Discontinued'};

function glazeCardView(g) {
  const photos = (g.photos||[]).map(p =>
    '<div style="position:relative;display:inline-block">' +
    '<img src="/uploads/' + p.filename + '" class="glaze-thumb" loading="lazy" onclick="openLightbox(\'/uploads/' + p.filename + '\')" style="cursor:zoom-in">' +
    (p.photo_label ? '<div style="font-size:0.65rem;color:var(--text-muted);text-align:center">' + esc(p.photo_label) + '</div>' : '') +
    (p.notes ? '<div style="font-size:0.6rem;color:var(--text-light)">' + esc(p.notes) + '</div>' : '') +
    '<button class="btn-ghost btn-sm" style="position:absolute;top:0;right:0;font-size:0.7rem" onclick="event.stopPropagation();deleteGlazePhoto(\'' + p.id + '\')">×</button></div>'
  ).join('');
  const stockBadge = g.stock_status && g.stock_status !== 'in-stock' ? '<span class="piece-meta-tag" style="background:rgba(220,53,69,0.1);color:var(--danger)">' + esc(STOCK_STATUS_LABELS[g.stock_status]||g.stock_status) + '</span>' : '';
  const recipeStatusBadge = g.recipe_status && g.glaze_type === 'recipe' ? '<span class="piece-meta-tag" style="background:rgba(108,117,125,0.1);color:#6c757d">' + esc(RECIPE_STATUS_LABELS[g.recipe_status]||g.recipe_status) + '</span>' : '';
  let ingredientTotal = '';
  if (g.ingredients?.length) {
    const total = g.ingredients.reduce((s,i) => s + (i.percentage||0), 0);
    const color = Math.abs(total-100)<0.1 ? 'var(--success)' : (Math.abs(total-100)<5 ? '#F4A623' : 'var(--danger)');
    ingredientTotal = ' <span style="color:'+color+';font-weight:600;font-size:0.8rem">('+total.toFixed(1)+'%)</span>';
  }
  return '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(g.name) +
    ' <span class="glaze-tag' + (g.glaze_type==='recipe'?' recipe':'') + '">' + g.glaze_type + '</span> ' + stockBadge + ' ' + recipeStatusBadge + '</div>' +
    '<div class="text-sm" style="color:var(--text-light)">' + esc(g.brand||'') + (g.sku ? ' · SKU: ' + esc(g.sku) : '') + (g.color_description ? ' · ' + esc(g.color_description) : '') + '</div></div>' +
    '<div style="display:flex;gap:4px">' +
    '<button class="btn-ghost btn-sm" onclick="openGlazePhotoUpload(\'' + g.id + '\')" title="Add photo">📸</button>' +
    '<button class="btn-ghost btn-sm" onclick="duplicateGlaze(\'' + g.id + '\')" title="Duplicate">📋</button>' +
    '<button class="btn-ghost btn-sm" onclick="editGlazeById(\'' + g.id + '\')">✏️</button>' +
    '<button class="btn-ghost btn-sm" onclick="deleteGlaze(\'' + g.id + '\')">🗑️</button></div></div>' +
    (photos ? '<div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap">' + photos + '</div>' : '') +
    '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
    (g.cone_range ? '<div><span class="detail-label">Cone</span><div>' + esc(g.cone_range) + '</div></div>' : '') +
    (g.atmosphere ? '<div><span class="detail-label">Atmosphere</span><div>' + esc(g.atmosphere) + '</div></div>' : '') +
    (g.surface ? '<div><span class="detail-label">Surface</span><div>' + esc(g.surface) + '</div></div>' : '') +
    (g.opacity ? '<div><span class="detail-label">Opacity</span><div>' + esc(g.opacity) + '</div></div>' : '') +
    '</div>' +
    (g.source ? '<div class="text-sm mt-8">📍 ' + esc(g.source) + (g.source_url ? ' — <a href="' + esc(g.source_url) + '" target="_blank" style="color:var(--primary)">visit</a>' : '') + '</div>' : '') +
    (g.buy_url ? '<div class="text-sm mt-4"><a href="' + esc(g.buy_url) + '" target="_blank" class="btn btn-primary btn-sm">🛒 Buy</a></div>' : '') +
    (g.ingredients?.length ? '<div class="mt-8"><span class="detail-label">Recipe' + ingredientTotal + '</span><div class="text-sm">' + g.ingredients.map(i=>esc(i.ingredient_name) + (i.percentage ? ' '+i.percentage+'%' : '')).join(', ') + '</div></div>' : '') +
    (g.recipe_notes ? '<div class="text-sm mt-4" style="color:var(--text-light)">📝 ' + esc(g.recipe_notes) + '</div>' : '') +
    (g.notes ? '<div class="text-sm mt-8" style="color:var(--text-light)">' + esc(g.notes) + '</div>' : '') +
    '<div class="mt-8" style="display:flex;gap:4px;flex-wrap:wrap">' +
    '<select class="form-select" style="width:auto;font-size:0.75rem;padding:2px 6px" onchange="toggleGlazeStock(\'' + g.id + '\',this.value)">' +
    '<option value=""' + (!g.stock_status?' selected':'') + '>Stock…</option>' +
    '<option value="in-stock"' + (g.stock_status==='in-stock'?' selected':'') + '>In Stock</option>' +
    '<option value="need-to-buy"' + (g.stock_status==='need-to-buy'?' selected':'') + '>Need to Buy</option>' +
    '<option value="low-stock"' + (g.stock_status==='low-stock'?' selected':'') + '>Low Stock</option>' +
    '<option value="discontinued"' + (g.stock_status==='discontinued'?' selected':'') + '>Discontinued</option></select></div>' +
    // Clay Bodies Tested section
    '<div class="mt-8" style="border-top:1px solid var(--border);padding-top:12px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<span class="detail-label" style="margin:0">🪨 Clay Bodies Tested</span>' +
    '<button class="btn-ghost btn-sm" onclick="toggleClayTestForm(\'' + g.id + '\')" style="font-size:0.8rem">+ Add</button></div>' +
    ((g.clay_tests||[]).length ? (g.clay_tests||[]).map(t =>
      '<div style="background:var(--bg-light);border-radius:var(--radius-sm);padding:8px 10px;margin-bottom:6px;display:flex;gap:10px;align-items:flex-start">' +
      (t.photo_filename ? '<img src="/uploads/' + t.photo_filename + '" style="width:48px;height:48px;object-fit:cover;border-radius:var(--radius-sm);cursor:zoom-in;flex-shrink:0" onclick="openLightbox(\'/uploads/' + t.photo_filename + '\')">' : '') +
      '<div style="flex:1;min-width:0">' +
      '<div style="font-weight:600;font-size:0.85rem;color:var(--text)">' +
      (t.clay_body_id ? '<a href="#" onclick="event.preventDefault();navigate(\'clays\')" style="color:var(--primary);text-decoration:none">' + esc(t.clay_name) + '</a>' : esc(t.clay_name)) +
      '</div>' +
      (t.result_notes ? '<div class="text-sm" style="color:var(--text-light);margin-top:2px">' + esc(t.result_notes) + '</div>' : '') +
      '</div>' +
      '<button class="btn-ghost btn-sm" onclick="deleteClayTest(\'' + g.id + '\',\'' + t.id + '\')" style="color:var(--text-muted);font-size:0.8rem;flex-shrink:0" title="Remove">×</button>' +
      '</div>'
    ).join('') : '<div class="text-sm" style="color:var(--text-muted);font-style:italic">No clay bodies tested yet</div>') +
    '<div id="clayTestForm_' + g.id + '" class="hidden" style="margin-top:8px;background:var(--bg-light);padding:12px;border-radius:var(--radius-sm)">' +
    '<select id="clayTestSelect_' + g.id + '" class="form-select" style="margin-bottom:6px" onchange="toggleClayTestManual(\'' + g.id + '\')">' +
    '<option value="">— Select from your clay library —</option>' +
    '<option value="__manual__">✏️ Enter manually</option>' +
    '</select>' +
    '<input type="text" id="clayTestManualName_' + g.id + '" class="form-input hidden" placeholder="Clay name (e.g. Standard 266)" style="margin-bottom:6px">' +
    '<textarea id="clayTestNotes_' + g.id + '" class="form-input" placeholder="Results / Notes (e.g. Beautiful amber, no crawling)" rows="2" style="margin-bottom:6px"></textarea>' +
    '<input type="file" id="clayTestPhoto_' + g.id + '" accept="image/*" style="margin-bottom:6px;font-size:0.85rem">' +
    '<button class="btn btn-primary btn-sm" onclick="saveClayTest(\'' + g.id + '\')">Save Clay Test</button>' +
    '</div></div></div>';
}
function glazeListView(g) {
  const stock = g.stock_status === 'need-to-buy' ? '🛒' : (g.stock_status === 'low-stock' ? '⚠️' : (g.stock_status === 'discontinued' ? '❌' : '✅'));
  return '<div class="card" style="padding:8px 14px;margin-bottom:4px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
    '<span style="min-width:24px">' + stock + '</span>' +
    '<strong style="min-width:150px">' + esc(g.name) + '</strong>' +
    '<span class="glaze-tag' + (g.glaze_type==='recipe'?' recipe':'') + '" style="font-size:0.7rem">' + g.glaze_type + '</span>' +
    '<span class="text-sm" style="color:var(--text-light);min-width:80px">' + esc(g.brand||'') + '</span>' +
    '<span class="text-sm" style="min-width:60px">' + (g.cone_range ? 'Cone ' + esc(g.cone_range) : '') + '</span>' +
    '<span class="text-sm" style="min-width:60px">' + esc(g.surface||'') + '</span>' +
    '<span class="text-sm" style="min-width:70px">' + esc(g.opacity||'') + '</span>' +
    '<span style="margin-left:auto;display:flex;gap:4px">' +
    '<button class="btn-ghost btn-sm" onclick="duplicateGlaze(\'' + g.id + '\')">📋</button>' +
    '<button class="btn-ghost btn-sm" onclick="editGlazeById(\'' + g.id + '\')">✏️</button>' +
    '<button class="btn-ghost btn-sm" onclick="deleteGlaze(\'' + g.id + '\')">🗑️</button></span></div>';
}
async function loadGlazes() {
  try {
    glazes = await api('/api/glazes');
    if (currentPage !== 'glazes') return;
    const c = document.getElementById('glazeList'), em = document.getElementById('glazeEmpty');
    if (!glazes.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    const mode = getViewMode('glazes');
    c.className = mode === 'list' ? '' : 'card-grid';
    c.innerHTML = glazes.map(g => mode === 'list' ? glazeListView(g) : glazeCardView(g)).join('');
  } catch(e) { toast(e.message,'error'); }
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
  document.getElementById('glazeOpacity').value = g?.opacity||'';
  document.getElementById('glazeStockStatus').value = g?.stock_status||'';
  document.getElementById('glazeSource').value = g?.source||'';
  document.getElementById('glazeSourceUrl').value = g?.source_url||'';
  document.getElementById('glazeBuyUrl').value = g?.buy_url||'';
  document.getElementById('glazeInStock').checked = g?.in_stock !== 0;
  document.getElementById('glazeNotes').value = g?.notes||'';
  toggleRecipeFields();
  const rs = document.getElementById('glazeRecipeStatus'); if(rs) rs.value = g?.recipe_status||'';
  const rn = document.getElementById('glazeRecipeNotes'); if(rn) rn.value = g?.recipe_notes||'';
  document.getElementById('ingredientList').innerHTML = '';
  (g?.ingredients||[]).forEach(i => addIngredient(i.ingredient_name, i.percentage));
  updateIngredientTotal();
  // Clay tests section (only shown when editing existing glaze)
  const claySection = document.getElementById('glazeClayTestsSection');
  if (g?.id) {
    claySection.classList.remove('hidden');
    renderModalClayTests(g.clay_tests || []);
    populateModalClayTestDropdown();
    document.getElementById('modalClayTestForm').classList.add('hidden');
  } else {
    claySection.classList.add('hidden');
  }
  openModal('glazeModal');
}
function toggleRecipeFields() {
  document.getElementById('recipeFields').classList.toggle('hidden', document.getElementById('glazeType').value !== 'recipe');
}
function addIngredient(name, pct) {
  const c = document.getElementById('ingredientList');
  const r = document.createElement('div'); r.className = 'ingredient-row';
  r.innerHTML = '<input type="text" class="form-input ing-name" placeholder="Ingredient" value="' + esc(name||'') + '">' +
    '<input type="number" class="form-input ing-pct" placeholder="%" step="0.1" value="' + (pct||'') + '" style="width:80px;flex:none" oninput="updateIngredientTotal()">' +
    '<button type="button" class="remove-row" onclick="this.parentElement.remove();updateIngredientTotal()">×</button>';
  c.appendChild(r);
  updateIngredientTotal();
}
async function saveGlaze(e) {
  e.preventDefault();
  const id = document.getElementById('glazeId').value;
  const ings = []; document.querySelectorAll('.ingredient-row').forEach(r => {
    const n = r.querySelector('.ing-name').value; if(n) ings.push({name:n, percentage:parseFloat(r.querySelector('.ing-pct').value)||null});
  });
  const body = { name:document.getElementById('glazeName').value, glazeType:document.getElementById('glazeType').value, brand:document.getElementById('glazeBrand').value||null, sku:document.getElementById('glazeSku').value||null, colorDescription:document.getElementById('glazeColor').value||null, coneRange:document.getElementById('glazeCone').value||null, atmosphere:document.getElementById('glazeAtmosphere').value||null, surface:document.getElementById('glazeSurface').value||null, opacity:document.getElementById('glazeOpacity').value||null, recipeStatus:document.getElementById('glazeRecipeStatus')?.value||null, recipeNotes:document.getElementById('glazeRecipeNotes')?.value||null, stockStatus:document.getElementById('glazeStockStatus').value||null, source:document.getElementById('glazeSource').value||null, sourceUrl:document.getElementById('glazeSourceUrl').value||null, buyUrl:document.getElementById('glazeBuyUrl').value||null, inStock:document.getElementById('glazeInStock').checked, notes:document.getElementById('glazeNotes').value||null, ingredients:ings };
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
function printFiringLog() {
  const el = document.getElementById('firingList');
  const w = window.open('', '_blank');
  w.document.write('<html><head><title>Kiln Journal</title><style>body{font-family:Georgia,serif;padding:20px;max-width:800px;margin:0 auto}h1{font-size:1.4rem}.card{border:1px solid #ddd;padding:12px;margin-bottom:8px;border-radius:6px;page-break-inside:avoid}strong{color:#333}.text-sm{font-size:0.85rem;color:#666}@media print{body{padding:0}}</style></head><body>');
  w.document.write('<h1>🔥 Kiln Journal — The Potter\'s Mud Room</h1>');
  w.document.write(el ? el.innerHTML : '<p>No firing records</p>');
  w.document.write('</body></html>');
  w.document.close();
  w.print();
}
async function loadFirings() {
  try {
    const sort = document.getElementById('firingSort')?.value || 'firing_date';
    const firings = await api('/api/firing-logs?sort=' + encodeURIComponent(sort));
    const c = document.getElementById('firingList'), em = document.getElementById('firingEmpty');
    if (!firings.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    const mode = getViewMode('firings');
    c.className = mode === 'list' ? '' : 'card-grid';
    if (mode === 'list') {
      c.innerHTML = firings.map(f =>
        '<div class="card" style="padding:8px 14px;margin-bottom:4px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<strong style="min-width:100px">' + esc(f.firing_type||'Firing') + '</strong>' +
        '<span class="text-sm" style="min-width:60px">Cone ' + esc(f.cone||'?') + '</span>' +
        '<span class="text-sm" style="min-width:80px;color:var(--text-light)">' + esc(f.atmosphere||'') + '</span>' +
        '<span class="text-sm" style="min-width:80px">' + fmtDate(f.date) + '</span>' +
        (f.firing_time ? '<span class="text-sm" style="color:var(--text-muted)">⏱️ ' + esc(f.firing_time) + '</span>' : '') +
        (f.piece_title ? '<span class="piece-meta-tag">' + esc(f.piece_title) + '</span>' : '') +
        (f.kiln_name ? '<span class="text-sm" style="color:var(--text-muted)">' + esc(f.kiln_name) + '</span>' : '') +
        '<div style="margin-left:auto;display:flex;gap:6px;flex-shrink:0"><button onclick="editFiring(\'' + f.id + '\')" class="btn btn-sm btn-secondary" style="padding:2px 10px;font-size:0.8rem" title="Edit">✎ Edit</button><button onclick="deleteFiring(\'' + f.id + '\')" class="btn btn-sm btn-secondary" style="padding:2px 10px;font-size:0.8rem;color:var(--danger)" title="Delete">✕ Delete</button></div>' +
        '</div>'
      ).join('');
    } else {
      const photosHtml = (photos) => photos && photos.length > 0 ? '<div style="display:flex;gap:6px;margin:8px 0">' + photos.map(p => '<img src="/uploads/' + p.filename + '" style="width:80px;height:80px;object-fit:cover;border-radius:var(--radius-sm);cursor:zoom-in" onclick="openLightbox(\'/uploads/' + p.filename + '\')">').join('') + '</div>' : '';
      c.innerHTML = firings.map(f =>
        '<div class="card">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">' +
        '<div><div class="card-title">' + esc(f.firing_type||'Firing') + ' — Cone ' + esc(f.cone||'?') + '</div>' +
        '<div class="text-sm" style="color:var(--text-light)">' + (f.kiln_name ? esc(f.kiln_name) + ' · ' : '') + fmtDate(f.date) +
        (f.atmosphere ? ' · ' + esc(f.atmosphere) : '') +
        (f.firing_speed ? ' · ' + esc(f.firing_speed) : '') +
        (f.firing_time ? ' · ⏱️ ' + esc(f.firing_time) : '') +
        '</div></div>' +
        '<div style="display:flex;gap:4px;flex-shrink:0"><button onclick="editFiring(\'' + f.id + '\')" class="btn-small" title="Edit">✎</button><button onclick="deleteFiring(\'' + f.id + '\')" class="btn-small" title="Delete">✕</button></div>' +
        '</div>' +
        photosHtml(f.photos) +
        (f.piece_title ? '<div class="text-sm" style="margin-bottom:4px"><span class="piece-meta-tag">' + esc(f.piece_title) + '</span></div>' : '') +
        (f.hold_used ? '<div class="text-sm"><strong>Hold:</strong> Yes' + (f.hold_duration ? ' — ' + esc(f.hold_duration) : '') + '</div>' : '') +
        (f.load_description ? '<div class="text-sm mt-8"><strong>Load:</strong> ' + esc(f.load_description) + '</div>' : '') +
        (f.results ? '<div class="text-sm mt-8">' + esc(f.results) + '</div>' : '') +
        (f.notes ? '<div class="text-sm mt-8" style="color:var(--text-light)">' + esc(f.notes) + '</div>' : '') +
        '</div>'
      ).join('');
    }
  } catch(e) { toast(e.message,'error'); }
}
function openFiringModal(f = null) {
  document.getElementById('firingId').value = f?.id || '';
  document.getElementById('firingType').value = f?.firing_type || 'bisque';
  document.getElementById('firingDate').value = f?.date || new Date().toISOString().split('T')[0];
  document.getElementById('firingCone').value = f?.cone || '';
  document.getElementById('firingAtmosphere').value = f?.atmosphere || '';
  document.getElementById('firingKiln').value = f?.kiln_name || '';
  document.getElementById('firingSpeed').value = f?.firing_speed || '';
  document.getElementById('firingTime').value = f?.firing_time || '';
  document.getElementById('firingMode').value = f?.firing_mode || 'kiln-load';
  document.getElementById('firingLoadDescription').value = f?.load_description || '';
  document.getElementById('firingLoadDescription').parentElement.classList.toggle('hidden', (f?.firing_mode || 'kiln-load') !== 'kiln-load');
  document.getElementById('firingModeNotes').value = f?.firing_mode_notes || '';
  document.getElementById('firingModeNotesGroup').classList.toggle('hidden', (f?.firing_mode || 'kiln-load') !== 'other');
  document.getElementById('firingHoldUsed').value = f?.hold_used ? '1' : '0';
  document.getElementById('firingHoldDuration').value = f?.hold_duration || '';
  document.getElementById('firingHoldDuration').parentElement.classList.toggle('hidden', !f?.hold_used);
  document.getElementById('firingResults').value = f?.results || '';
  document.getElementById('firingNotes').value = f?.notes || '';
  const csd = document.getElementById('firingCustomSpeedDetail');
  if (csd) { csd.value = f?.custom_speed_detail || ''; csd.parentElement.classList.toggle('hidden', f?.firing_speed !== 'custom'); }
  api('/api/pieces').then(pieces => {
    const s = document.getElementById('firingPiece');
    s.innerHTML = '<option value="">Select piece (optional)...</option>' + pieces.map(p => '<option value="' + p.id + '"' + (f?.piece_id === p.id ? ' selected' : '') + '>' + esc(p.title||'Untitled') + '</option>').join('');
  });
  if (f?.id) {
    loadFiringPhotos(f.id);
  } else {
    document.getElementById('firingPhotosContainer').innerHTML = '';
  }
  openModal('firingModal');
}

async function loadFiringPhotos(firingId) {
  try {
    const photos = await api('/api/firing-logs/' + firingId + '/photos');
    const cont = document.getElementById('firingPhotosContainer');
    if (!photos || photos.length === 0) {
      cont.innerHTML = '';
      return;
    }
    cont.innerHTML = photos.map(p => 
      '<div style="position:relative;display:inline-block;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">' +
      '<img src="/uploads/' + p.filename + '" style="width:100px;height:100px;object-fit:cover;cursor:zoom-in" onclick="openLightbox(\'/uploads/' + p.filename + '\')">' +
      '<button class="btn-ghost btn-sm" style="position:absolute;top:0;right:0;font-size:0.8rem;background:rgba(0,0,0,0.5);color:white" onclick="deleteFiringPhoto(\'' + p.id + '\');loadFiringPhotos(\'' + firingId + '\')">×</button>' +
      '</div>'
    ).join('');
  } catch(e) { console.error('Error loading firing photos:', e); }
}

async function uploadFiringPhotos(event) {
  const firingId = document.getElementById('firingId').value;
  if (!firingId) { toast('Save firing first before adding photos', 'error'); return; }
  const files = event.target.files;
  if (!files.length) return;
  const formData = new FormData();
  for (let f of files) formData.append('photos', f);
  try {
    await api('/api/firing-logs/' + firingId + '/photos', { method: 'POST', body: formData });
    toast('Photos uploaded', 'success');
    await loadFiringPhotos(firingId);
    event.target.value = '';
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteFiringPhoto(photoId) {
  try {
    await api('/api/firing-photos/' + photoId, { method: 'DELETE' });
    toast('Photo deleted', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

function editFiring(id) {
  api('/api/firing-logs').then(firings => {
    const f = firings.find(f => f.id === id);
    if (f) openFiringModal(f);
  });
}

async function deleteFiring(id) {
  if (!confirm('Delete this firing record?')) return;
  try {
    await api('/api/firing-logs/' + id, { method: 'DELETE' });
    toast('Firing deleted', 'success');
    loadFirings();
  } catch(e) { toast(e.message, 'error'); }
}

async function saveFiring(e) {
  e.preventDefault();
  const firingId = document.getElementById('firingId').value;
  const body = {
    pieceId: document.getElementById('firingPiece').value || null,
    firingType: document.getElementById('firingType').value,
    cone: document.getElementById('firingCone').value || null,
    temperature: document.getElementById('firingTemperature')?.value || null,
    atmosphere: document.getElementById('firingAtmosphere').value || null,
    kilnName: document.getElementById('firingKiln').value || null,
    schedule: document.getElementById('firingSchedule')?.value || null,
    duration: document.getElementById('firingDuration')?.value || null,
    firingSpeed: document.getElementById('firingSpeed').value || null,
    customSpeedDetail: document.getElementById('firingCustomSpeedDetail')?.value || null,
    holdUsed: document.getElementById('firingHoldUsed').value === '1',
    holdDuration: document.getElementById('firingHoldDuration').value || null,
    date: document.getElementById('firingDate').value || null,
    firingTime: document.getElementById('firingTime').value || null,
    firingMode: document.getElementById('firingMode').value || 'kiln-load',
    loadDescription: document.getElementById('firingLoadDescription').value || null,
    firingModeNotes: document.getElementById('firingModeNotes').value || null,
    results: document.getElementById('firingResults').value || null,
    notes: document.getElementById('firingNotes').value || null
  };
  try {
    const method = firingId ? 'PUT' : 'POST';
    const url = firingId ? '/api/firing-logs/' + firingId : '/api/firing-logs';
    await api(url, { method, body });
    toast(firingId ? 'Firing updated!' : 'Firing logged!', 'success');
    closeModal('firingModal');
    document.getElementById('firingId').value = '';
    loadFirings();
  } catch(e) { toast(e.message, 'error'); }
}

// ---- Sales ----
async function loadCasualties() {
  try {
    const casualties = await api('/api/casualties');
    const c = document.getElementById('casualtyList'), em = document.getElementById('casualtyEmpty');
    const stats = document.getElementById('casualtyStats');
    if (!casualties.length) { c.innerHTML=''; stats.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');

    // Stats summary
    const broken = casualties.filter(p => p.status === 'broken').length;
    const recycled = casualties.filter(p => p.status === 'recycled').length;
    const typeCounts = {};
    casualties.forEach(p => { if (p.casualty_type) typeCounts[p.casualty_type] = (typeCounts[p.casualty_type]||0) + 1; });
    const topIssue = Object.entries(typeCounts).sort((a,b) => b[1]-a[1])[0];
    stats.innerHTML = '<div class="stat-box"><div class="stat-number">' + casualties.length + '</div><div class="stat-label">Total Casualties</div></div>' +
      '<div class="stat-box"><div class="stat-number">' + broken + '</div><div class="stat-label">Broken</div></div>' +
      '<div class="stat-box"><div class="stat-number">' + recycled + '</div><div class="stat-label">Recycled</div></div>' +
      (topIssue ? '<div class="stat-box"><div class="stat-number">⚠️</div><div class="stat-label">Top Issue: ' + esc(CASUALTY_LABELS[topIssue[0]]||topIssue[0]) + ' (' + topIssue[1] + ')</div></div>' : '');

    c.innerHTML = casualties.map(p => {
      const ph = p.primaryPhoto;
      const img = ph ? '<img class="piece-photo" src="/uploads/' + ph.filename + '" loading="lazy">' : '<div class="piece-photo-placeholder">🏺</div>';
      const gl = (p.glazes||[]).map(g => '<span class="glaze-tag">' + esc(g.glaze_name) + '</span>').join('');
      const typeLabel = p.casualty_type ? '<span class="piece-meta-tag" style="background:rgba(220,53,69,0.1);color:var(--danger)">⚠️ ' + esc(CASUALTY_LABELS[p.casualty_type]||p.casualty_type) + '</span>' : '';
      return '<div class="card piece-card" onclick="viewPiece(\'' + p.id + '\')">' + img +
        '<div class="card-header"><div><div class="card-title">' + esc(p.title||'Untitled') + '</div>' +
        '<div class="text-sm" style="color:var(--text-light)">' + esc(p.clay_body_name||'No clay specified') + '</div></div>' +
        fmtStatus(p.status) + '</div>' +
        (typeLabel ? '<div class="piece-meta">' + typeLabel + '</div>' : '') +
        (gl ? '<div class="piece-meta">' + gl + '</div>' : '') +
        (p.casualty_lesson ? '<div class="text-sm" style="color:var(--success);padding:8px 0;border-top:1px solid var(--border);margin-top:8px"><strong>🎓 Lesson:</strong> ' + esc(p.casualty_lesson.substring(0,120)) + (p.casualty_lesson.length > 120 ? '...' : '') + '</div>' : '') +
        '</div>';
    }).join('');
  } catch(e) { toast(e.message,'error'); }
}

async function loadSales() {
  try {
    const dateFrom = document.getElementById('salesDateFrom')?.value || '';
    const dateTo = document.getElementById('salesDateTo')?.value || '';
    let url = '/api/sales?';
    if (dateFrom) url += 'dateFrom=' + encodeURIComponent(dateFrom) + '&';
    if (dateTo) url += 'dateTo=' + encodeURIComponent(dateTo) + '&';
    const sales = await api(url);
    const c = document.getElementById('salesList'), em = document.getElementById('salesEmpty');
    const sum = document.getElementById('salesSummary');
    if (!sales.length) { c.innerHTML=''; sum.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    const total = sales.reduce((s,x) => s + ((x.price||0) * (x.quantity||1)), 0);
    sum.innerHTML = '<div class="stat-box"><div class="stat-number">' + sales.length + '</div><div class="stat-label">Sales</div></div>' +
      '<div class="stat-box"><div class="stat-number">$' + total.toFixed(0) + '</div><div class="stat-label">Revenue</div></div>' +
      '<div class="stat-box"><div class="stat-number">$' + (total/sales.length).toFixed(0) + '</div><div class="stat-label">Avg Price</div></div>';
    const mode = getViewMode('sales');
    c.className = mode === 'list' ? '' : 'card-grid';
    if (mode === 'list') {
      c.innerHTML = sales.map(s =>
        '<div class="card" style="padding:8px 14px;margin-bottom:4px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        '<strong style="min-width:150px">' + esc(s.item_description || s.piece_title || 'Unknown piece') + '</strong>' +
        (s.quantity && s.quantity > 1 ? '<span class="text-sm">Qty: ' + s.quantity + '</span>' : '') +
        '<span style="font-weight:700;color:var(--accent);min-width:60px">$' + ((s.price||0) * (s.quantity||1)).toFixed(0) + '</span>' +
        '<span class="text-sm" style="min-width:80px">' + fmtDate(s.date) + '</span>' +
        '<span class="text-sm" style="color:var(--text-light)">' + esc(s.venue_type||'') + '</span>' +
        '<span class="text-sm" style="color:var(--text-muted)">' + esc(s.venue||'') + '</span></div>'
      ).join('');
    } else {
      c.innerHTML = sales.map(s =>
        '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(s.item_description || s.piece_title || 'Unknown piece') + '</div>' +
        '<div class="text-sm" style="color:var(--text-light)">' + fmtDate(s.date) + (s.venue ? ' · ' + esc(s.venue) : '') + (s.event_name ? ' · ' + esc(s.event_name) : '') + '</div></div>' +
        '<div style="font-family:var(--font-display);font-size:1.2rem;font-weight:700;color:var(--accent)">$' + ((s.price||0) * (s.quantity||1)).toFixed(0) + (s.quantity && s.quantity > 1 ? ' (Qty: ' + s.quantity + ')' : '') + '</div></div>' +
        (s.venue_type ? '<span class="piece-meta-tag">' + esc(s.venue_type) + '</span>' : '') + '</div>'
      ).join('');
    }
  } catch(e) { toast(e.message,'error'); }
}
function openSaleModal() {
  document.getElementById('saleId').value = '';
  document.getElementById('salePrice').value = '';
  document.getElementById('saleDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('saleVenueType').value = '';
  document.getElementById('saleVenue').value = '';
  document.getElementById('saleQuantity').value = '1';
  document.getElementById('saleItemDescription').value = '';
  document.getElementById('saleEventName').value = '';
  api('/api/pieces').then(pieces => {
    const s = document.getElementById('salePiece');
    s.innerHTML = '<option value="">Select piece...</option>' + pieces.map(p => '<option value="' + p.id + '">' + esc(p.title||'Untitled') + '</option>').join('');
  });
  openModal('saleModal');
}

function openBulkSaleModal() {
  document.getElementById('bulkEventName').value = '';
  document.getElementById('bulkEventDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('bulkVenueType').value = '';
  document.getElementById('bulkLineItems').innerHTML = '<div class="bulk-line-item"><input type="text" placeholder="Item description" class="bulk-item-desc" /><input type="number" placeholder="Qty" class="bulk-qty" min="1" value="1" /><input type="number" placeholder="Price each" class="bulk-price-each" step="0.01" /><button onclick="removeBulkLineItem(this)" class="btn-small">✕</button></div>';
  openModal('bulkSaleModal');
}

function addBulkLineItem() {
  const container = document.getElementById('bulkLineItems');
  const item = document.createElement('div');
  item.className = 'bulk-line-item';
  item.innerHTML = '<input type="text" placeholder="Item description" class="bulk-item-desc" /><input type="number" placeholder="Qty" class="bulk-qty" min="1" value="1" /><input type="number" placeholder="Price each" class="bulk-price-each" step="0.01" /><button onclick="removeBulkLineItem(this)" class="btn-small">✕</button>';
  container.appendChild(item);
}

function removeBulkLineItem(btn) {
  btn.parentElement.remove();
}

async function saveBulkSale(e) {
  e.preventDefault();
  const eventName = document.getElementById('bulkEventName').value;
  const date = document.getElementById('bulkEventDate').value;
  const venueType = document.getElementById('bulkVenueType').value;
  const items = document.querySelectorAll('.bulk-line-item');
  const lineItems = [];
  items.forEach(item => {
    const desc = item.querySelector('.bulk-item-desc').value;
    const qty = parseInt(item.querySelector('.bulk-qty').value) || 1;
    const price = parseFloat(item.querySelector('.bulk-price-each').value) || 0;
    if (desc && price > 0) lineItems.push({ itemDescription: desc, quantity: qty, priceEach: price });
  });
  if (!lineItems.length) return toast('Add at least one line item', 'error');
  try {
    await api('/api/sales/bulk', { method: 'POST', body: { eventName, date, venueType, lineItems } });
    toast('Bulk sale recorded!', 'success');
    closeModal('bulkSaleModal');
    loadSales();
  } catch(e) { toast(e.message, 'error'); }
}

async function saveSale(e) {
  e.preventDefault();
  const saleId = document.getElementById('saleId').value;
  const body = {
    pieceId: document.getElementById('salePiece').value || null,
    price: parseFloat(document.getElementById('salePrice').value),
    date: document.getElementById('saleDate').value || null,
    venueType: document.getElementById('saleVenueType').value || null,
    venue: document.getElementById('saleVenue').value || null,
    quantity: parseInt(document.getElementById('saleQuantity').value) || 1,
    itemDescription: document.getElementById('saleItemDescription').value || null,
    eventName: document.getElementById('saleEventName').value || null
  };
  try {
    const method = saleId ? 'PUT' : 'POST';
    const url = saleId ? '/api/sales/' + saleId : '/api/sales';
    await api(url, { method, body });
    toast(saleId ? 'Sale updated!' : 'Sale logged!', 'success');
    closeModal('saleModal');
    document.getElementById('saleId').value = '';
    loadSales();
  } catch(e) { toast(e.message, 'error'); }
}

// ---- Community Combos ----
function debounceLoadCombos() { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadCombos, 300); }
async function loadCombos() {
  try {
    const search = document.getElementById('comboSearch')?.value||'';
    const cone = document.getElementById('comboConeFilter')?.value||'';
    const filter = document.getElementById('comboFilter')?.value||'community-shared';
    let u = '/api/community/combos?';
    if (search) u += 'search=' + encodeURIComponent(search) + '&';
    if (cone) u += 'cone=' + encodeURIComponent(cone) + '&';
    if (filter) u += 'filter=' + encodeURIComponent(filter) + '&';
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
      (cb.photo_filename || cb.photo_filename2 ? '<div style="display:flex;gap:8px;margin-bottom:12px">' + (cb.photo_filename ? '<img src="/uploads/' + cb.photo_filename + '" style="max-width:300px;max-height:300px;border-radius:var(--radius-sm);object-fit:cover;cursor:zoom-in" loading="lazy" onclick="openLightbox(\'/uploads/' + cb.photo_filename + '\')">' : '') + (cb.photo_filename2 ? '<img src="/uploads/' + cb.photo_filename2 + '" style="max-width:300px;max-height:300px;border-radius:var(--radius-sm);object-fit:cover;cursor:zoom-in" loading="lazy" onclick="openLightbox(\'/uploads/' + cb.photo_filename2 + '\')">' : '') + '</div>' : '') +
      '<div>' + (cb.layers||[]).map((l,i) => '<div style="margin-bottom:4px"><span style="color:var(--text-muted);font-size:0.8rem">Layer ' + (i+1) + ':</span> <span class="glaze-tag">' + esc(l.glaze_name) + '</span>' + (l.brand ? ' <span class="text-sm">(' + esc(l.brand) + ')</span>' : '') + (l.coats > 1 ? ' · ' + l.coats + ' coats' : '') + '</div>').join('') + '</div>' +
      (cb.description ? '<div class="text-sm mt-8" style="color:var(--text-light)">' + esc(cb.description) + '</div>' : '') +
      '<div style="display:flex;gap:12px;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">' +
      '<button class="btn-ghost btn-sm" onclick="toggleComboLike(\'' + cb.id + '\')" style="' + (cb.user_liked ? 'color:var(--danger)' : '') + '">' + (cb.user_liked ? '❤️' : '🤍') + ' ' + (cb.likes||0) + '</button>' +
      '<button class="btn-ghost btn-sm" onclick="toggleComboComments(\'' + cb.id + '\')">💬 ' + (cb.comment_count||0) + '</button>' +
      (cb.user_id === currentUser?.id ?
        '<button class="btn-ghost btn-sm" onclick="toggleComboPublic(\'' + cb.id + '\',' + (cb.is_public ? 'false' : 'true') + ')" title="' + (cb.is_public ? 'Make private' : 'Make public & shareable') + '">' + (cb.is_public ? '🔓 Public' : '🔒 Private') + '</button>' +
        (cb.is_public && cb.share_id ? '<button class="btn-ghost btn-sm" onclick="copyComboLink(\'' + cb.share_id + '\')" title="Copy share link">🔗 Share</button>' : '') +
        '<button class="btn-ghost btn-sm" onclick="editCombo(\'' + cb.id + '\')">✎ Edit</button><button class="btn-ghost btn-sm" onclick="deleteCombo(\'' + cb.id + '\')">✕ Delete</button>'
        : '<button class="btn-ghost btn-sm" onclick="navigate(\'messageThread\');loadMessageThread(\'' + cb.user_id + '\')">✉️ Message</button>') +
      '</div>' +
      '<div id="comboComments_' + cb.id + '" class="hidden" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)"></div>' +
      '</div>'
    ).join('');
  } catch(e) { toast(e.message,'error'); }
}

function editCombo(id) {
  api('/api/community/combos?filter=all-my').then(combos => {
    const combo = combos.find(c => c.id === id);
    if (combo) {
      document.getElementById('comboId').value = combo.id;
      document.getElementById('comboName').value = combo.name;
      document.getElementById('comboClay').value = combo.clay_body_name || '';
      document.getElementById('comboCone').value = combo.cone || '';
      document.getElementById('comboAtmosphere').value = combo.atmosphere || '';
      document.getElementById('comboDesc').value = combo.description || '';
      document.getElementById('comboShared').checked = combo.is_shared;
      document.getElementById('comboLayers').innerHTML = '';
      if (combo.layers && combo.layers.length) {
        combo.layers.forEach(l => addComboLayer(l.glaze_name, l.brand, l.coats));
      } else {
        addComboLayer(); addComboLayer();
      }
      openModal('comboModal');
    }
  });
}

async function deleteCombo(id) {
  if (!confirm('Delete this combo?')) return;
  try {
    await api('/api/community/combos/' + id, { method: 'DELETE' });
    toast('Combo deleted', 'success');
    loadCombos();
  } catch(e) { toast(e.message, 'error'); }
}
function addComboLayer(name, brand, coats) {
  const c = document.getElementById('comboLayers');
  const r = document.createElement('div'); r.className = 'combo-layer-row';
  r.innerHTML = '<input type="text" class="form-input cl-name" placeholder="Glaze name" value="' + esc(name||'') + '" list="comboGlazeNameList">' +
    '<input type="text" class="form-input cl-brand" placeholder="Brand" value="' + esc(brand||'') + '" style="width:120px;flex:none" list="comboGlazeBrandList">' +
    '<input type="number" class="form-input cl-coats" placeholder="Coats" min="1" value="' + (coats||1) + '" style="width:70px;flex:none">' +
    '<button type="button" class="remove-row" onclick="this.parentElement.remove()">×</button>';
  c.appendChild(r);
}
function populateComboDataLists() {
  const clayDL = document.getElementById('comboClayList');
  if (clayDL) clayDL.innerHTML = clayBodies.map(c => '<option value="' + esc(c.name + (c.brand ? ' (' + c.brand + ')' : '')) + '">').join('');
  let glazeNameDL = document.getElementById('comboGlazeNameList');
  if (!glazeNameDL) { glazeNameDL = document.createElement('datalist'); glazeNameDL.id = 'comboGlazeNameList'; document.body.appendChild(glazeNameDL); }
  glazeNameDL.innerHTML = glazes.map(g => '<option value="' + esc(g.name) + '">').join('');
  let brandDL = document.getElementById('comboGlazeBrandList');
  if (!brandDL) { brandDL = document.createElement('datalist'); brandDL.id = 'comboGlazeBrandList'; document.body.appendChild(brandDL); }
  const brands = [...new Set(glazes.map(g => g.brand).filter(Boolean))];
  brandDL.innerHTML = brands.map(b => '<option value="' + esc(b) + '">').join('');
}
function openComboModal() {
  document.getElementById('comboId').value = '';
  document.getElementById('comboName').value = '';
  document.getElementById('comboClay').value = '';
  document.getElementById('comboCone').value = '';
  document.getElementById('comboAtmosphere').value = '';
  document.getElementById('comboDesc').value = '';
  document.getElementById('comboShared').checked = true;
  document.getElementById('comboLayers').innerHTML = '';
  if (document.getElementById('comboPhotos')) document.getElementById('comboPhotos').value = '';
  populateComboDataLists();
  addComboLayer(); addComboLayer();
  openModal('comboModal');
}
async function saveCombo(e) {
  e.preventDefault();
  const comboId = document.getElementById('comboId').value;
  const layers = []; document.querySelectorAll('.combo-layer-row').forEach(r => {
    const n = r.querySelector('.cl-name').value; if(n) layers.push({glazeName:n, brand:r.querySelector('.cl-brand').value||null, coats:parseInt(r.querySelector('.cl-coats').value)||1});
  });
  const fd = new FormData();
  fd.append('name', document.getElementById('comboName').value);
  fd.append('clayBodyName', document.getElementById('comboClay').value || '');
  fd.append('cone', document.getElementById('comboCone').value || '');
  fd.append('atmosphere', document.getElementById('comboAtmosphere').value || '');
  fd.append('description', document.getElementById('comboDesc').value || '');
  fd.append('isShared', document.getElementById('comboShared').checked);
  fd.append('layers', JSON.stringify(layers));
  const files = document.getElementById('comboPhotos')?.files;
  if (files) { for (let i = 0; i < Math.min(files.length, 2); i++) fd.append('photos', files[i]); }
  try {
    const method = comboId ? 'PUT' : 'POST';
    const url = comboId ? '/api/community/combos/' + comboId : '/api/community/combos';
    const r = await fetch(url, { method, headers:{Authorization:'Bearer '+token}, body:fd });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    toast(comboId ? 'Combo updated!' : 'Combo saved!','success');
    closeModal('comboModal');
    document.getElementById('comboId').value = '';
    loadCombos();
  } catch(e) { toast(e.message,'error'); }
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
    loadForumPosts();
  } catch(e) {
    if (e.message.includes('Requires')) {
      document.getElementById('forumPosts').innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔒</div><div class="empty-state-title">Forum requires a paid plan</div><p>Upgrade to Basic or above to browse the forum.</p><button class="btn btn-primary mt-16" onclick="navigate(\'upgrade\')">View Plans</button></div>';
    } else { toast(e.message,'error'); }
  }
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
    const photos = (post.photos||[]).map(p => {
      const ext = (p.filename||'').split('.').pop().toLowerCase();
      if (['mp4','mov','webm'].includes(ext)) return '<video src="/uploads/' + p.filename + '" class="forum-photo" controls style="max-width:100%;max-height:400px;border-radius:var(--radius-sm)"></video>';
      return '<img src="/uploads/' + p.filename + '" class="forum-photo" style="max-width:100%;max-height:400px" onclick="window.open(\'/uploads/' + p.filename + '\',\'_blank\')">';
    }).join('');
    const replies = (post.replies||[]).map(r => {
      const ra = r.author_avatar ? '<img src="/uploads/' + r.author_avatar + '" class="forum-avatar">' : '<div class="forum-avatar-placeholder">' + (r.author_name||'?')[0].toUpperCase() + '</div>';
      const rPhotos = (r.photos||[]).map(p => {
        const ext = (p.filename||'').split('.').pop().toLowerCase();
        if (['mp4','mov','webm'].includes(ext)) return '<video src="/uploads/' + p.filename + '" class="forum-photo" controls style="max-width:300px;max-height:200px"></video>';
        return '<img src="/uploads/' + p.filename + '" class="forum-photo-sm">';
      }).join('');
      const deleteBtn = (r.user_id === currentUser?.id || currentUser?.email === 'christinaworkmanpottery@gmail.com') ? '<button class="btn-ghost btn-sm" onclick="deleteReply(\'' + r.id + '\',\'' + post.id + '\')" title="Delete reply">🗑️</button>' : '';
      return '<div class="forum-reply">' +
        '<div style="display:flex;gap:10px">' + ra +
        '<div style="flex:1"><div style="display:flex;justify-content:space-between"><strong>' + esc(r.author_name||'Anonymous') + '</strong>' +
        '<div>' + deleteBtn + '<span class="text-sm" style="color:var(--text-muted)">' + timeAgo(r.created_at) + '</span></div></div>' +
        '<div class="mt-8" style="white-space:pre-wrap">' + esc(r.body) + '</div>' +
        (rPhotos ? '<div class="forum-photos-row mt-8">' + rPhotos + '</div>' : '') +
        '</div></div></div>';
    }).join('');

    document.getElementById('forumPostContent').innerHTML =
      '<div class="card"><div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:16px">' + avatar +
      '<div><h2>' + esc(post.title) + '</h2>' +
      '<div class="text-sm" style="color:var(--text-light)">by <strong>' + esc(post.author_name||'Anonymous') + '</strong> · ' + timeAgo(post.created_at) +
      ' · 👁 ' + post.view_count + ' views · 💬 ' + post.reply_count + ' replies</div></div></div>' +
      ((post.user_id === currentUser?.id || currentUser?.email === 'christinaworkmanpottery@gmail.com') ? '<div style="margin-bottom:12px"><button class="btn btn-danger btn-sm" onclick="deleteForumPost(\'' + post.id + '\')">🗑️ Delete Post</button></div>' : '') +
      '<div style="white-space:pre-wrap;margin-bottom:16px">' + esc(post.body) + '</div>' +
      (photos ? '<div class="forum-photos-row mb-16">' + photos + '</div>' : '') +
      '</div>' +
      '<h3 class="mt-24 mb-16">Replies (' + (post.replies||[]).length + ')</h3>' +
      (replies || '<div class="text-sm" style="color:var(--text-muted)">No replies yet — be the first!</div>') +
      '<div class="card mt-16"><h3 style="margin-bottom:12px">Reply</h3>' +
      '<textarea class="form-textarea" id="replyBody" placeholder="Write your reply..." style="min-height:80px"></textarea>' +
      '<div class="form-group mt-8"><label class="text-sm" style="color:var(--text-muted);margin-bottom:4px;display:block">📸 Add photos or short videos (up to 3)</label><input type="file" id="replyPhotos" accept="image/*,video/mp4,video/mov,video/webm" multiple class="form-input" style="font-size:0.85rem"></div>' +
      '<div style="display:flex;justify-content:flex-end;margin-top:8px">' +
      '<button class="btn btn-primary" onclick="submitReply(\'' + post.id + '\')">Reply</button></div></div>';
  } catch(e) { toast(e.message,'error'); }
}

async function deleteForumPost(id) {
  if (!confirm('Delete this post and all its replies?')) return;
  try { await api('/api/forum/posts/' + id, { method: 'DELETE' }); toast('Post deleted', 'success'); navigate('forum'); } catch(e) { toast(e.message, 'error'); }
}

async function deleteReply(id, postId) {
  if (!confirm('Delete this reply?')) return;
  try { await api('/api/forum/replies/' + id, { method: 'DELETE' }); toast('Reply deleted', 'success'); viewForumPost(postId); } catch(e) { toast(e.message, 'error'); }
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
  if (files) { for (let i = 0; i < Math.min(files.length, 5); i++) fd.append('photos', files[i]); }
  try {
    const r = await fetch('/api/forum/posts', { method:'POST', headers:{Authorization:'Bearer '+token}, body:fd });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    toast('Post published!','success'); closeModal('forumPostModal'); loadForumPosts();
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
      const previewLink = p.product_type === 'pdf' ? '<a href="/shop/mud-log-preview.pdf" target="_blank" class="btn btn-secondary btn-sm mt-8" style="width:100%">📖 Preview Sample Pages</a>' : '';
      return '<div class="card shop-product-card">' + img +
        '<div class="card-title">' + esc(p.name) + '</div>' +
        (p.description ? '<div class="text-sm" style="color:var(--text-light);margin:6px 0">' + esc(p.description) + '</div>' : '') +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">' +
        '<div style="font-family:var(--font-display);font-size:1.3rem;font-weight:700;color:var(--primary)">$' + p.price.toFixed(2) + '</div>' +
        typeLabel + '</div>' +
        previewLink +
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
    document.getElementById('profileUsername').value = d.user.username || '';
    document.getElementById('profileBio').value = d.user.bio || '';
    document.getElementById('profileLocation').value = d.user.location || '';
    document.getElementById('profileWebsite').value = d.user.website || '';
    document.getElementById('profilePrivate').checked = !!d.user.is_private;
    document.getElementById('profileUnits').value = d.user.unit_system || 'imperial';
    document.getElementById('profileTemp').value = d.user.temp_unit || 'fahrenheit';

    // Profile photo
    const preview = document.getElementById('profilePhotoPreview');
    if (preview) {
      if (d.user.avatar_filename) {
        preview.innerHTML = '<img src="/uploads/' + d.user.avatar_filename + '" style="width:100%;height:100%;object-fit:cover">';
      } else {
        preview.innerHTML = '🏺';
      }
    }

    // Tier info
    const tier = d.user.tier || 'free';
    const tierNames = { free: 'Free', starter: 'Starter ($6.95/mo)', basic: 'Starter (Legacy Basic)', mid: 'Starter (Legacy Mid)', top: 'Starter (Legacy Top)' };
    let tierHtml = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><span class="tier-badge tier-' + tier + '" style="font-size:0.9rem;padding:4px 12px">' + (tier === 'free' ? 'FREE' : 'STARTER') + '</span> ' + (tierNames[tier] || tier) + '</div>';
    if (d.user.plan_expires_at) {
      const exp = new Date(d.user.plan_expires_at);
      const daysLeft = Math.ceil((exp - Date.now()) / 86400000);
      tierHtml += '<div class="text-sm" style="margin-bottom:8px;color:' + (daysLeft < 7 ? 'var(--danger)' : 'var(--text-light)') + '">Plan ' + (daysLeft > 0 ? 'expires ' + fmtDate(d.user.plan_expires_at) + ' (' + daysLeft + ' days left)' : 'expired') + '</div>';
    }
    if (d.user.billing_period && d.user.billing_period !== 'promo') {
      tierHtml += '<div class="text-sm" style="margin-bottom:8px;color:var(--text-light)">Billing: ' + d.user.billing_period + ' · Cancel anytime</div>';
    }
    tierHtml += (tier === 'free' ? '<button class="btn btn-primary" onclick="navigate(\'upgrade\')">Upgrade to Starter</button>' :
       '<div style="display:flex;gap:8px"><button class="btn btn-secondary btn-sm" onclick="navigate(\'upgrade\')">Change Plan</button><button class="btn btn-danger btn-sm" onclick="cancelSubscription()">Cancel Plan</button></div>');
    document.getElementById('profileTierInfo').innerHTML = tierHtml;

    // Referral section - Share & Earn
    const refCode = d.user.referral_code || '';
    const refCount = d.user.referralCount || 0;
    const freeMonths = d.user.freeMonthsRemaining || 0;
    const refLink = 'https://thepottersmudroom.com?ref=' + refCode;
    document.getElementById('profileReferralInfo').innerHTML =
      '<div style="background:var(--primary-light);border-radius:var(--radius);padding:16px;margin-bottom:12px">' +
      '<h4 style="margin-bottom:8px;color:var(--primary)">🎁 Share & Earn — Free Months!</h4>' +
      '<p class="text-sm" style="margin-bottom:12px;color:var(--text-light)">Share your link — when someone signs up, you BOTH get a <strong>free month</strong> of Starter!</p>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">' +
      '<input type="text" class="form-input" value="' + esc(refLink) + '" readonly id="refLinkInput" style="font-size:0.85rem;flex:1" onclick="this.select()">' +
      '<button class="btn btn-primary btn-sm" onclick="copyReferralLink()">📋 Copy</button></div>' +
      '<div style="display:flex;gap:20px">' +
      '<div class="text-sm"><strong>' + refCount + '</strong> friends referred</div>' +
      (freeMonths > 0 ? '<div class="text-sm" style="color:var(--accent)"><strong>' + freeMonths + '</strong> free month' + (freeMonths > 1 ? 's' : '') + ' earned 🎉</div>' : '') +
      '</div></div>';

    // Newsletter subscription toggle
    const isSubscribed = d.user.newsletter_subscribed ? 'checked' : '';
    document.getElementById('profileNewsletterInfo').innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;padding:12px;background:rgba(139,115,85,0.05);border-radius:var(--radius)">' +
      '<input type="checkbox" id="profileNewsletter" ' + isSubscribed + ' onchange="toggleNewsletterSubscription()">' +
      '<div>' +
      '<label for="profileNewsletter" style="cursor:pointer;font-weight:500">📬 Subscribe to newsletter</label>' +
      '<p class="text-sm" style="margin:4px 0 0 0;color:var(--text-light)">Get pottery tips, glazing advice, and studio news</p>' +
      '</div></div>';

    // Review section
    loadMyReview();
  } catch(e) { toast(e.message,'error'); }
}

async function toggleNewsletterSubscription() {
  try {
    const subscribed = document.getElementById('profileNewsletter').checked;
    await api('/api/profile/newsletter', { method: 'PUT', body: { subscribed } });
    toast(subscribed ? '✓ Newsletter subscription saved!' : '✓ Unsubscribed from newsletter', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

async function saveProfile() {
  try {
    await api('/api/profile', { method: 'PUT', body: {
      displayName: document.getElementById('profileName').value,
      username: document.getElementById('profileUsername').value || null,
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
    const tierLv = { free: 0, basic: 1, mid: 1, starter: 1, top: 1 };
    const founding = d.foundingMember;

    let html = '';

    // Founding Member Banner
    if (founding) {
      html += '<div class="founding-banner">' +
        '<h2>🔥 Founding Member Rates</h2>' +
        '<p>Lock in your discounted rate now — keep it as long as your membership stays active!</p>' +
        '<p style="font-size:0.85rem;opacity:0.8;margin-top:6px">Limited time only. If you cancel and come back, regular pricing applies.</p>' +
        '</div>';
    }

    html += '<div style="display:flex;gap:12px;margin-bottom:20px;justify-content:center"><button class="btn btn-primary billing-toggle active" id="btnMonthly" onclick="setBilling(\'monthly\')">Monthly</button><button class="btn btn-secondary billing-toggle" id="btnYearly" onclick="setBilling(\'yearly\')">Yearly (Save More!)</button></div>';
    window._plansData = d;
    window._billingMode = 'monthly';
    html += '<div id="plansGrid" class="upgrade-plans">';
    d.plans.forEach(p => {
      const isCurrent = p.id === tier;
      const isDowngrade = tierLv[p.id] < tierLv[tier];
      const hasFoundingPrice = founding && p.foundingPrice;
      const moSavePct = hasFoundingPrice ? Math.round((1 - p.foundingPrice / p.price) * 100) : 0;
      const yrSavePct = hasFoundingPrice ? Math.round((1 - p.foundingYearly / p.yearlyPrice) * 100) : 0;

      html += '<div class="upgrade-plan-card' + (isCurrent ? ' current' : '') + '">' +
        '<div class="plan-name">' + esc(p.name) + '</div>';

      if (hasFoundingPrice) {
        html += '<span class="founding-badge">Founding Rate</span>';
        // Monthly prices
        html += '<div class="monthly-price">' +
          '<div class="plan-price-regular">$' + p.price.toFixed(2) + '/mo</div>' +
          '<div class="plan-price-founding">$' + p.foundingPrice.toFixed(2) + '<span class="plan-period">/mo</span></div>' +
          '<div class="founding-savings">Save ' + moSavePct + '%!</div></div>';
        // Yearly prices
        html += '<div class="yearly-price hidden">' +
          '<div class="plan-price-regular">$' + p.yearlyPrice.toFixed(2) + '/yr</div>' +
          '<div class="plan-price-founding">$' + p.foundingYearly.toFixed(2) + '<span class="plan-period">/yr</span></div>' +
          '<div class="founding-savings">Save ' + yrSavePct + '%!</div></div>';
      } else {
        html += '<div class="plan-price monthly-price">' + (p.price ? '$' + p.price.toFixed(2) + '<span class="plan-period">/mo</span>' : 'Free') + '</div>' +
          (p.yearlyPrice ? '<div class="plan-price yearly-price hidden">$' + p.yearlyPrice.toFixed(2) + '<span class="plan-period">/yr</span></div>' : '');
      }

      html += '<ul class="plan-features">' + p.features.map(f => '<li>✓ ' + esc(f) + '</li>').join('') +
        '</ul>' +
        (isCurrent ? '<button class="btn btn-secondary" disabled>Current Plan</button>' :
         p.id === 'free' ? '' :
         isDowngrade ? '' :
         '<button class="btn btn-primary plan-subscribe-btn" data-plan="' + p.id + '" onclick="subscribePlan(window._billingMode===\'yearly\'?\'' + p.id + (founding && p.foundingPrice ? '-founding-yearly' : '-yearly') + '\':\'' + p.id + (founding && p.foundingPrice ? '-founding' : '') + '\')">' + (d.stripeEnabled ? 'Subscribe' : 'Coming Soon') + '</button>') +
        '</div>';
    });
    html += '</div>';

    // Promo code section
    html += '<div class="card mt-24" style="max-width:500px"><h3 style="margin-bottom:12px">🎟️ Have a Promo Code?</h3>' +
      '<div style="display:flex;gap:8px"><input type="text" class="form-input" id="promoCodeInput" placeholder="Enter code..." style="text-transform:uppercase">' +
      '<button class="btn btn-primary" onclick="redeemPromo()">Redeem</button></div></div>';

    // Promo code creation moved to Admin page

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

function togglePromoType() {
  const type = document.getElementById('newPromoType').value;
  document.getElementById('promoTierGroup').classList.toggle('hidden', type !== 'tier');
}

// Admin: create promo codes
async function createPromoCode() {
  const code = document.getElementById('newPromoCode').value.trim();
  const promoType = document.getElementById('newPromoType').value;
  const tier = document.getElementById('newPromoTier').value;
  const days = parseInt(document.getElementById('newPromoDays').value) || 30;
  const uses = parseInt(document.getElementById('newPromoUses').value) || 0;
  if (!code) { toast('Enter a code','error'); return; }
  try {
    const d = await api('/api/promo/create', { method:'POST', body: { code, promoType, tier, durationDays: days, maxUses: uses } });
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
    el.innerHTML = codes.map(c => {
      const desc = c.promo_type === 'tokens' ? 'Promo gift' : c.tier.toUpperCase() + ' for ' + c.duration_days + ' days';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div><strong>' + esc(c.code) + '</strong> — ' + desc + '</div>' +
      '<div class="text-sm" style="color:var(--text-muted)">Used: ' + c.times_used + (c.max_uses > 0 ? '/' + c.max_uses : '/∞') + '</div></div>';
    }).join('');
  } catch(e) {}
}

function setBilling(mode) {
  window._billingMode = mode;
  document.querySelectorAll('.monthly-price').forEach(el => el.classList.toggle('hidden', mode === 'yearly'));
  document.querySelectorAll('.yearly-price').forEach(el => el.classList.toggle('hidden', mode === 'monthly'));
  document.getElementById('btnMonthly').className = 'btn ' + (mode === 'monthly' ? 'btn-primary' : 'btn-secondary') + ' billing-toggle';
  document.getElementById('btnYearly').className = 'btn ' + (mode === 'yearly' ? 'btn-primary' : 'btn-secondary') + ' billing-toggle';
}

async function subscribePlan(plan) {
  try {
    const d = await api('/api/billing/checkout', { method:'POST', body: { plan } });
    if (d.url) window.location.href = d.url;
  } catch(e) { toast(e.message,'error'); }
}

async function cancelSubscription() {
  if (!confirm('Are you sure you want to cancel your subscription? You\'ll keep access until the end of your billing period.')) return;
  try {
    await api('/api/billing/cancel', { method:'POST' });
    toast('Subscription cancelled. You\'ll keep access until the end of your billing period.', 'success');
    const me = await api('/api/auth/me'); currentUser = me.user; loadProfile();
  } catch(e) { toast(e.message,'error'); }
}

// ---- Profile Photo ----
// Track page views for analytics
function trackPageView(pagePath) {
  try {
    const h = {};
    if (token) h['Authorization'] = 'Bearer ' + token;
    h['Content-Type'] = 'application/json';
    fetch('/api/analytics/pageview', {
      method: 'POST', headers: h,
      body: JSON.stringify({ path: pagePath || window.location.pathname, referrer: document.referrer })
    }).catch(() => {});
  } catch(e) {}
}
// Track landing page view immediately
trackPageView('/');

function loadProfilePhoto() {
  const preview = document.getElementById('profilePhotoPreview');
  if (preview && currentUser?.avatar_filename) {
    preview.innerHTML = '<img src="/uploads/' + currentUser.avatar_filename + '" style="width:100%;height:100%;object-fit:cover">';
  }
}
async function uploadProfilePhoto(input) {
  if (!input.files?.[0]) return;
  const fd = new FormData();
  fd.append('photo', input.files[0]);
  try {
    const r = await fetch('/api/profile/photo', { method:'POST', headers:{Authorization:'Bearer '+token}, body:fd });
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    toast('Profile photo updated!','success');
    currentUser.avatar_filename = d.filename;
    loadProfilePhoto();
  } catch(e) { toast(e.message,'error'); }
}

// ---- Export Data ----
async function exportData(endpoint) {
  try {
    const r = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error || 'Export failed');
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disp = r.headers.get('Content-Disposition') || '';
    const match = disp.match(/filename=([^;]+)/);
    a.download = match ? match[1] : 'export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast('Downloaded!', 'success');
  } catch(e) { toast(e.message, 'error'); }
}

// ---- Admin Dashboard ----
async function loadAdmin() {
  const el = document.getElementById('adminContent');
  if (currentUser?.email !== 'christinaworkmanpottery@gmail.com') {
    el.innerHTML = '<div class="card"><p>Admin access only.</p></div>';
    return;
  }
  try {
    let data;
    try {
      data = await api('/api/admin/members');
    } catch(fetchErr) {
      el.innerHTML = '<div class="card"><h3>Error loading admin data</h3><p>' + esc(fetchErr.message) + '</p></div>';
      return;
    }
    const m = data.members || [];
    const s = data.stats || { total: 0, byTier: { free: 0, basic: 0, mid: 0, top: 0 }, recent7d: 0, recent30d: 0 };
    
    let html = '<div class="card mb-16" style="padding:14px"><h3 style="margin-bottom:10px">🔍 Search Members</h3>' +
      '<div style="display:flex;gap:8px"><input type="text" class="form-input" id="adminSearchInput" placeholder="Search by name or email..." onkeydown="if(event.key===\'Enter\')adminSearchMembers()">' +
      '<button class="btn btn-primary btn-sm" onclick="adminSearchMembers()">Search</button></div>' +
      '<div id="adminSearchResults" class="mt-8"></div></div>';

    html += '<div class="stats-bar" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">' +
      '<div class="stat-box"><div class="stat-number">' + s.total + '</div><div class="stat-label">Total Members</div></div>' +
      '<div class="stat-box"><div class="stat-number">' + s.recent7d + '</div><div class="stat-label">Last 7 Days</div></div>' +
      '<div class="stat-box"><div class="stat-number">' + s.recent30d + '</div><div class="stat-label">Last 30 Days</div></div>' +
      '<div class="stat-box"><div class="stat-number" style="color:var(--accent)">' + s.byTier.basic + '</div><div class="stat-label">Basic</div></div>' +
      '<div class="stat-box"><div class="stat-number" style="color:var(--primary)">' + s.byTier.mid + '</div><div class="stat-label">Mid</div></div>' +
      '<div class="stat-box"><div class="stat-number" style="color:var(--success)">' + s.byTier.top + '</div><div class="stat-label">Top</div></div>' +
      '<div class="stat-box"><div class="stat-number">' + s.byTier.free + '</div><div class="stat-label">Free</div></div>' +
      '</div>';

    // Members table
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">All Members</h3>';
    html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.85rem">';
    html += '<tr style="border-bottom:2px solid var(--border);text-align:left"><th style="padding:8px">Name</th><th style="padding:8px">Email</th><th style="padding:8px">Tier</th><th style="padding:8px">Billing</th><th style="padding:8px">Joined</th><th style="padding:8px">Actions</th></tr>';
    m.forEach(u => {
      const tier = u.tier || 'free';
      html += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px">' + esc(u.display_name || '—') + '</td>' +
        '<td style="padding:8px">' + esc(u.email) + '</td>' +
        '<td style="padding:8px"><span class="tier-badge tier-' + tier + '" style="font-size:0.75rem">' + tier.toUpperCase() + '</span>' +
        (u.stripe_subscription_id ? ' 💳' : '') + '</td>' +
        '<td style="padding:8px">' + (u.billing_period || '—') + '</td>' +
        '<td style="padding:8px">' + fmtDate(u.created_at) + '</td>' +
        '<td style="padding:8px">' + (tier !== 'free' ? '<button class="btn btn-danger btn-sm" style="font-size:0.7rem" onclick="adminCancelMember(\'' + u.id + '\',\'' + esc(u.email).replace(/'/g,"\\'") + '\')">Cancel</button>' : '') + '</td></tr>';
    });
    html += '</table></div></div>';

    // Discount codes section
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">🏷️ Shop Discount Codes</h3>' +
      '<p class="text-sm mb-16" style="color:var(--text-light)">Create discount codes for professionals promoting your site. These give a % off in the shop.</p>' +
      '<div class="form-row" style="gap:8px">' +
      '<div class="form-group"><label>Code</label><input type="text" class="form-input" id="discountCode" placeholder="e.g., POTTER20" style="text-transform:uppercase"></div>' +
      '<div class="form-group"><label>Discount %</label><input type="number" class="form-input" id="discountPct" value="10" min="1" max="100"></div>' +
      '<div class="form-group"><label>Max Uses (0=∞)</label><input type="number" class="form-input" id="discountMaxUses" value="0"></div>' +
      '</div><button class="btn btn-primary btn-sm" onclick="createDiscountCode()">Create Discount Code</button>' +
      '<div id="discountCodesList" class="mt-16"></div></div>';

    // Promo codes section (gift tier upgrades to friends)
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">🎟️ Promo Codes</h3>' +
      '<p class="text-sm mb-16" style="color:var(--text-light)">Create promo codes to gift tier upgrades to friends. Users redeem these on the Plans page.</p>' +
      '<div class="form-group"><label>Type</label><select class="form-select" id="newPromoType" onchange="togglePromoType()">' +
      '<option value="tier">Tier Upgrade</option></select></div>' +
      '<div class="form-row" style="gap:8px"><div class="form-group"><label>Code</label><input type="text" class="form-input" id="newPromoCode" placeholder="e.g., FRIENDS2026" style="text-transform:uppercase"></div>' +
      '<div class="form-group" id="promoTierGroup"><label>Tier</label><select class="form-select" id="newPromoTier"><option value="basic">Basic</option><option value="mid">Mid</option><option value="top">Top</option></select></div></div>' +
      '<div class="form-row" style="gap:8px"><div class="form-group"><label>Days (tier duration)</label><input type="number" class="form-input" id="newPromoDays" value="30"></div>' +
      '<div class="form-group"><label>Max Uses (0=unlimited)</label><input type="number" class="form-input" id="newPromoUses" value="0"></div></div>' +
      '<button class="btn btn-primary btn-sm" onclick="createPromoCode()">Create Code</button>' +
      '<div id="promoCodesList" class="mt-16"></div></div>';

    // Orders section
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">🛍️ Recent Orders</h3><div id="adminOrders">Loading...</div></div>';

    // Analytics section
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">📊 Site Traffic</h3><div id="adminAnalytics">Loading...</div></div>';

    // Reviews section
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">⭐ Reviews</h3><div id="adminReviewsList">Loading...</div></div>';

    // Blog management section
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">📝 Blog Posts</h3>' +
      '<button class="btn btn-primary btn-sm mb-16" onclick="openBlogPostEditor()">+ New Post</button>' +
      '<div id="adminBlogList">Loading...</div></div>';

    // Featured potter section
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">🌟 Featured Potter</h3>' +
      '<p class="text-sm mb-16" style="color:var(--text-light)">Select a user to feature on the landing page.</p>' +
      '<div class="form-row" style="gap:8px">' +
      '<div class="form-group"><label>User Email</label><input type="text" class="form-input" id="featuredPotterEmail" placeholder="user@example.com"></div>' +
      '<div class="form-group"><label>Quote</label><input type="text" class="form-input" id="featuredPotterQuote" placeholder="A quote from the potter..."></div></div>' +
      '<button class="btn btn-primary btn-sm" onclick="setFeaturedPotter()">Set Featured Potter</button>' +
      '<div id="featuredPotterHistory" class="mt-16"></div></div>';

    // Newsletter section
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">📬 Newsletter</h3>' +
      '<div id="adminNewsletterContent">Loading...</div></div>';

    try {
      el.innerHTML = html;
    } catch(renderErr) {
      el.innerHTML = '<div class="card"><h3>Admin loaded but display error</h3><p>' + esc(String(renderErr)) + '</p><p>Members: ' + s.total + ' | Free: ' + s.byTier.free + ' | Basic: ' + s.byTier.basic + ' | Mid: ' + s.byTier.mid + ' | Top: ' + s.byTier.top + '</p></div>';
      return;
    }
    loadDiscountCodes();
    loadPromoCodes();
    loadAdminOrders();
    loadAdminAnalytics();
    loadAdminReviews();
    loadAdminBlogPosts();
    loadAdminFeaturedPotter();
    loadAdminNewsletter();
  } catch(e) { toast(e.message, 'error'); }
}

async function createDiscountCode() {
  const code = document.getElementById('discountCode').value.trim();
  const pct = parseFloat(document.getElementById('discountPct').value);
  const maxUses = parseInt(document.getElementById('discountMaxUses').value) || 0;
  if (!code || !pct) { toast('Code and discount % required', 'error'); return; }
  try {
    await api('/api/admin/discount/create', { method:'POST', body: { code, discountPct: pct, maxUses } });
    toast('Discount code ' + code.toUpperCase() + ' created!', 'success');
    document.getElementById('discountCode').value = '';
    loadDiscountCodes();
  } catch(e) { toast(e.message, 'error'); }
}

async function loadDiscountCodes() {
  try {
    const codes = await api('/api/admin/discount/codes');
    const el = document.getElementById('discountCodesList');
    if (!el) return;
    if (!codes.length) { el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No discount codes yet</div>'; return; }
    el.innerHTML = codes.map(c =>
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div><strong>' + esc(c.code) + '</strong> — ' + c.discount_pct + '% off</div>' +
      '<div class="text-sm" style="color:var(--text-muted)">Used: ' + c.times_used + (c.max_uses > 0 ? '/' + c.max_uses : '/∞') + (c.is_active ? '' : ' (inactive)') + '</div></div>'
    ).join('');
  } catch(e) {}
}

async function loadAdminOrders() {
  try {
    const orders = await api('/api/admin/orders');
    const el = document.getElementById('adminOrders');
    if (!orders.length) { el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No orders yet</div>'; return; }
    el.innerHTML = orders.map(o =>
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div><strong>' + esc(o.product_name || 'Unknown') + '</strong> — ' + esc(o.display_name || o.email) + '</div>' +
      '<div><span style="color:var(--accent);font-weight:700">$' + (o.price_paid || 0).toFixed(2) + '</span> · ' + fmtDate(o.created_at) + '</div></div>'
    ).join('');
  } catch(e) { document.getElementById('adminOrders').innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Could not load orders</div>'; }
}

async function loadAdminAnalytics() {
  try {
    const a = await api('/api/admin/analytics');
    const el = document.getElementById('adminAnalytics');
    let html = '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">' +
      '<div class="stat-box"><div class="stat-number">' + (a.today || 0) + '</div><div class="stat-label">Today</div></div>' +
      '<div class="stat-box"><div class="stat-number">' + (a.week || 0) + '</div><div class="stat-label">This Week</div></div>' +
      '<div class="stat-box"><div class="stat-number">' + (a.month || 0) + '</div><div class="stat-label">This Month</div></div>' +
      '<div class="stat-box"><div class="stat-number">' + (a.total || 0) + '</div><div class="stat-label">All Time</div></div>' +
      '<div class="stat-box"><div class="stat-number">' + (a.uniqueIPs || 0) + '</div><div class="stat-label">Unique Visitors (30d)</div></div>' +
      '</div>';

    // Signups by day
    if (a.signupsByDay?.length) {
      html += '<h4 style="margin:12px 0 8px">📈 Signups (Last 30 Days)</h4>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
      a.signupsByDay.forEach(d => {
        html += '<div style="text-align:center;padding:4px 8px;background:var(--primary-light);border-radius:4px;font-size:0.8rem"><div style="font-weight:700">' + d.signups + '</div><div style="color:var(--text-muted)">' + d.day.substring(5) + '</div></div>';
      });
      html += '</div>';
    }

    // Top referrers
    if (a.topReferrers?.length) {
      html += '<h4 style="margin:16px 0 8px">🔗 Where Traffic Comes From</h4>';
      a.topReferrers.forEach(r => {
        let source = r.referrer;
        try { source = new URL(r.referrer).hostname; } catch {}
        html += '<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:0.85rem"><span>' + esc(source) + '</span><strong>' + r.c + '</strong></div>';
      });
    }

    // Daily views
    if (a.byDay?.length) {
      html += '<h4 style="margin:16px 0 8px">👁️ Page Views (Last 30 Days)</h4>';
      const maxViews = Math.max(...a.byDay.map(d => d.views), 1);
      html += '<div style="display:flex;align-items:flex-end;gap:2px;height:80px">';
      a.byDay.forEach(d => {
        const pct = Math.max((d.views / maxViews) * 100, 3);
        html += '<div title="' + d.day + ': ' + d.views + ' views" style="flex:1;min-width:4px;background:var(--primary);border-radius:2px 2px 0 0;height:' + pct + '%"></div>';
      });
      html += '</div>';
    }

    el.innerHTML = html;
  } catch(e) {
    const el = document.getElementById('adminAnalytics');
    if (el) el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Analytics will start showing after some traffic</div>';
  }
}

async function loadAdminReviews() {
  try {
    const reviews = await api('/api/admin/reviews');
    const el = document.getElementById('adminReviewsList');
    if (!el) return;
    if (!reviews.length) { el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No reviews yet</div>'; return; }
    el.innerHTML = reviews.map(r =>
      '<div style="padding:12px 0;border-bottom:1px solid var(--border)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<div><strong>' + esc(r.display_name || r.email) + '</strong> · ' + '★'.repeat(r.rating) + '☆'.repeat(5-r.rating) + '</div>' +
      '<div class="text-sm" style="color:var(--text-muted)">' + fmtDate(r.created_at) + '</div></div>' +
      '<p style="color:var(--text-light);margin-bottom:8px">"' + esc(r.body) + '"</p>' +
      '<div style="display:flex;gap:6px">' +
      '<button class="btn btn-sm ' + (r.is_approved ? 'btn-success' : 'btn-secondary') + '" onclick="toggleApproveReview(\'' + r.id + '\')">' + (r.is_approved ? '✅ Approved' : 'Approve') + '</button>' +
      '<button class="btn btn-sm ' + (r.is_featured ? 'btn-primary' : 'btn-secondary') + '" onclick="toggleFeatureReview(\'' + r.id + '\')">' + (r.is_featured ? '⭐ Featured' : 'Feature') + '</button>' +
      '<button class="btn btn-sm btn-danger" onclick="deleteAdminReview(\'' + r.id + '\')">Delete</button></div></div>'
    ).join('');
  } catch(e) { const el = document.getElementById('adminReviewsList'); if (el) el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Error loading reviews</div>'; }
}

async function toggleApproveReview(id) {
  try { await api('/api/admin/reviews/' + id + '/approve', { method: 'POST' }); loadAdminReviews(); } catch(e) { toast(e.message, 'error'); }
}
async function toggleFeatureReview(id) {
  try { await api('/api/admin/reviews/' + id + '/feature', { method: 'POST' }); loadAdminReviews(); } catch(e) { toast(e.message, 'error'); }
}
async function deleteAdminReview(id) {
  if (!confirm('Delete this review?')) return;
  try { await api('/api/admin/reviews/' + id, { method: 'DELETE' }); loadAdminReviews(); toast('Review deleted', 'success'); } catch(e) { toast(e.message, 'error'); }
}

// ---- Reviews ----
async function loadMyReview() {
  try {
    const el = document.getElementById('profileReviewSection');
    if (!el) return;
    const review = await api('/api/reviews/mine');
    if (review) {
      el.innerHTML = '<div style="margin-bottom:12px"><strong>Your Review</strong> ' + '⭐'.repeat(review.rating) + '</div>' +
        '<p style="color:var(--text-light);margin-bottom:12px">"' + esc(review.body) + '"</p>' +
        '<div class="text-sm" style="color:var(--text-muted);margin-bottom:12px">' + (review.is_approved ? '✅ Approved' : '⏳ Pending approval') + '</div>' +
        '<button class="btn btn-secondary btn-sm" onclick="editReview(\'' + review.id + '\',' + review.rating + ',\'' + esc(review.body).replace(/'/g,"\\'") + '\')">Edit Review</button>';
    } else {
      el.innerHTML = '<div id="reviewForm">' +
        '<div style="margin-bottom:12px"><strong>Rate your experience:</strong></div>' +
        '<div id="starRating" style="font-size:1.8rem;cursor:pointer;margin-bottom:12px">' +
        '<span onclick="setStars(1)">☆</span><span onclick="setStars(2)">☆</span><span onclick="setStars(3)">☆</span><span onclick="setStars(4)">☆</span><span onclick="setStars(5)">☆</span></div>' +
        '<input type="hidden" id="reviewRating" value="0">' +
        '<textarea class="form-textarea" id="reviewBody" placeholder="Tell other potters what you think of The Potter\'s Mud Room..." style="margin-bottom:12px"></textarea>' +
        '<button class="btn btn-primary btn-sm" onclick="submitReview()">Submit Review</button></div>';
    }
  } catch(e) { /* ignore */ }
}

window._reviewRating = 0;
function setStars(n) {
  window._reviewRating = n;
  document.getElementById('reviewRating').value = n;
  const spans = document.getElementById('starRating').querySelectorAll('span');
  spans.forEach((s, i) => { s.textContent = i < n ? '★' : '☆'; s.style.color = i < n ? '#F4A623' : '#ccc'; });
}

async function submitReview() {
  try {
    const rating = parseInt(document.getElementById('reviewRating').value);
    const body = document.getElementById('reviewBody').value.trim();
    if (!rating || rating < 1) return toast('Please select a star rating', 'error');
    if (!body) return toast('Please write a review', 'error');
    await api('/api/reviews', { method: 'POST', body: { rating, body }});
    toast('Review submitted! It will appear once approved.', 'success');
    loadMyReview();
  } catch(e) { toast(e.message, 'error'); }
}

function editReview(id, rating, body) {
  const el = document.getElementById('profileReviewSection');
  el.innerHTML = '<div style="margin-bottom:12px"><strong>Edit your review:</strong></div>' +
    '<div id="starRating" style="font-size:1.8rem;cursor:pointer;margin-bottom:12px">' +
    '<span onclick="setStars(1)">☆</span><span onclick="setStars(2)">☆</span><span onclick="setStars(3)">☆</span><span onclick="setStars(4)">☆</span><span onclick="setStars(5)">☆</span></div>' +
    '<input type="hidden" id="reviewRating" value="' + rating + '">' +
    '<textarea class="form-textarea" id="reviewBody" style="margin-bottom:12px">' + body + '</textarea>' +
    '<div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="updateReview(\'' + id + '\')">Save</button>' +
    '<button class="btn btn-secondary btn-sm" onclick="loadMyReview()">Cancel</button></div>';
  setStars(rating);
}

async function updateReview(id) {
  try {
    const rating = parseInt(document.getElementById('reviewRating').value);
    const body = document.getElementById('reviewBody').value.trim();
    if (!rating || rating < 1) return toast('Please select a star rating', 'error');
    if (!body) return toast('Please write a review', 'error');
    await api('/api/reviews/' + id, { method: 'PUT', body: { rating, body }});
    toast('Review updated!', 'success');
    loadMyReview();
  } catch(e) { toast(e.message, 'error'); }
}

// ---- Admin: Blog Management ----
async function loadAdminBlogPosts() {
  try {
    const posts = await api('/api/admin/blog/posts');
    const el = document.getElementById('adminBlogList');
    if (!el) return;
    if (!posts.length) { el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No blog posts yet</div>'; return; }
    el.innerHTML = posts.map(p =>
      '<div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">' +
      '<div><strong>' + esc(p.title) + '</strong> <span class="text-sm" style="color:' + (p.is_published ? 'var(--success)' : 'var(--text-muted)') + '">' + (p.is_published ? '✅ Published' : '📝 Draft') + '</span>' +
      '<div class="text-sm" style="color:var(--text-muted)">' + fmtDate(p.published_at) + ' · /' + esc(p.slug) + '</div></div>' +
      '<div style="display:flex;gap:4px">' +
      '<button class="btn btn-sm btn-secondary" onclick="previewBlogPost(\'' + p.id + '\')" title="Preview">👁️</button>' +
      '<button class="btn btn-sm btn-secondary" onclick="editBlogPost(\'' + p.id + '\')">✏️</button>' +
      (p.is_published ? '' : '<button class="btn btn-sm btn-primary" onclick="publishBlogPost(\'' + p.id + '\')">📢 Publish</button>') +
      '<button class="btn btn-sm btn-danger" onclick="deleteBlogPost(\'' + p.id + '\')">🗑️</button></div></div>'
    ).join('');
  } catch(e) {}
}

let _editingBlogId = null;
function openBlogPostEditor(post) {
  _editingBlogId = post?.id || null;
  const html = '<div class="modal-overlay open" id="blogEditorOverlay" onclick="if(event.target===this){this.remove()}">' +
    '<div class="modal" style="max-width:700px">' +
    '<div class="modal-header"><h2>' + (post ? 'Edit Post' : 'New Blog Post') + '</h2><button class="modal-close" onclick="document.getElementById(\'blogEditorOverlay\').remove()">&times;</button></div>' +
    '<div class="form-group"><label>Title</label><input type="text" class="form-input" id="blogEdTitle" value="' + esc(post?.title || '') + '"></div>' +
    '<div class="form-group"><label>Slug</label><input type="text" class="form-input" id="blogEdSlug" value="' + esc(post?.slug || '') + '" placeholder="auto-generated from title"></div>' +
    '<div class="form-group"><label>Excerpt</label><input type="text" class="form-input" id="blogEdExcerpt" value="' + esc(post?.excerpt || '') + '"></div>' +
    '<div class="form-group"><label>Author</label><input type="text" class="form-input" id="blogEdAuthor" value="' + esc(post?.author || 'Christina Workman') + '"></div>' +
    '<div class="form-group"><label>Content (use **bold**, *italic*, ## headers, - lists)</label>' +
    '<textarea class="form-textarea" id="blogEdContent" rows="12" style="font-family:monospace;font-size:0.85rem">' + esc(post?.content || '') + '</textarea></div>' +
    '<div class="form-group"><label><input type="checkbox" id="blogEdPublished"' + (post?.is_published ? ' checked' : '') + '> Published</label></div>' +
    '<div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById(\'blogEditorOverlay\').remove()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveBlogPost()">Save Post</button></div></div></div>';
  document.body.insertAdjacentHTML('beforeend', html);
}

async function editBlogPost(id) {
  try {
    const posts = await api('/api/admin/blog/posts');
    const post = posts.find(p => p.id === id);
    if (post) openBlogPostEditor(post);
  } catch(e) { toast(e.message, 'error'); }
}

async function previewBlogPost(id) {
  try {
    const posts = await api('/api/admin/blog/posts');
    const post = posts.find(p => p.id === id);
    if (!post) return;
    const html = '<div class="modal-overlay open" id="blogPreviewOverlay" onclick="if(event.target===this){this.remove()}">' +
      '<div class="modal" style="max-width:700px;max-height:85vh;overflow-y:auto">' +
      '<div class="modal-header"><h2>' + esc(post.title) + '</h2><button class="modal-close" onclick="document.getElementById(\'blogPreviewOverlay\').remove()">&times;</button></div>' +
      '<div style="padding:20px;line-height:1.7;font-size:1rem">' + post.content + '</div>' +
      '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="document.getElementById(\'blogPreviewOverlay\').remove()">Close</button>' +
      '<button class="btn btn-secondary" onclick="document.getElementById(\'blogPreviewOverlay\').remove();editBlogPost(\'' + post.id + '\')">✏️ Edit</button>' +
      (post.is_published ? '' : '<button class="btn btn-primary" onclick="publishBlogPost(\'' + post.id + '\')">📢 Publish</button>') +
      '</div></div></div>';
    document.body.insertAdjacentHTML('beforeend', html);
  } catch(e) { toast(e.message, 'error'); }
}

async function publishBlogPost(id) {
  if (!confirm('Publish this post? It will be visible to all users on the blog.')) return;
  try {
    await api('/api/admin/blog/' + id + '/publish', 'PUT');
    toast('Post published!', 'success');
    // Close any preview overlay
    const overlay = document.getElementById('blogPreviewOverlay');
    if (overlay) overlay.remove();
    loadAdminBlogPosts();
  } catch(e) { toast(e.message, 'error'); }
}

async function saveBlogPost() {
  const body = {
    title: document.getElementById('blogEdTitle').value,
    slug: document.getElementById('blogEdSlug').value || null,
    excerpt: document.getElementById('blogEdExcerpt').value || null,
    author: document.getElementById('blogEdAuthor').value || null,
    content: document.getElementById('blogEdContent').value,
    isPublished: document.getElementById('blogEdPublished').checked
  };
  if (!body.title || !body.content) return toast('Title and content required', 'error');
  try {
    if (_editingBlogId) {
      await api('/api/admin/blog/posts/' + _editingBlogId, { method: 'PUT', body });
      toast('Post updated!', 'success');
    } else {
      await api('/api/admin/blog/posts', { method: 'POST', body });
      toast('Post created!', 'success');
    }
    document.getElementById('blogEditorOverlay').remove();
    loadAdminBlogPosts();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteBlogPost(id) {
  if (!confirm('Delete this blog post?')) return;
  try {
    await api('/api/admin/blog/posts/' + id, { method: 'DELETE' });
    toast('Post deleted', 'success');
    loadAdminBlogPosts();
  } catch(e) { toast(e.message, 'error'); }
}

// ---- Admin: Featured Potter ----
async function setFeaturedPotter() {
  const email = document.getElementById('featuredPotterEmail').value.trim();
  const quote = document.getElementById('featuredPotterQuote').value.trim();
  if (!email) return toast('Enter a user email', 'error');
  try {
    // Search for user by email
    const users = await api('/api/admin/members/search?q=' + encodeURIComponent(email));
    if (!users.length) return toast('User not found', 'error');
    const user = users.find(u => u.email === email) || users[0];
    await api('/api/admin/featured-potter', { method: 'POST', body: { userId: user.id, quote: quote || null } });
    toast('Featured potter set!', 'success');
    document.getElementById('featuredPotterEmail').value = '';
    document.getElementById('featuredPotterQuote').value = '';
    loadAdminFeaturedPotter();
  } catch(e) { toast(e.message, 'error'); }
}

async function loadAdminFeaturedPotter() {
  try {
    const history = await api('/api/admin/featured-potter');
    const el = document.getElementById('featuredPotterHistory');
    if (!el) return;
    if (!history.length) { el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No featured potters yet</div>'; return; }
    el.innerHTML = '<h4 style="margin-bottom:8px">Recent Featured Potters</h4>' +
      history.map(fp =>
        '<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:0.85rem">' +
        '<strong>' + esc(fp.display_name) + '</strong> (' + esc(fp.email) + ')' +
        (fp.quote ? ' — "' + esc(fp.quote) + '"' : '') +
        ' · ' + fmtDate(fp.featured_date) + '</div>'
      ).join('');
  } catch(e) {}
}

// ---- Admin: Newsletter ----
async function loadAdminNewsletter() {
  try {
    // Get subscriber count
    const subCount = await api('/api/admin/newsletter/subscribers');
    
    // Get newsletter history
    const history = await api('/api/admin/newsletter/history');
    
    // Get all blog posts for dropdown
    const posts = await api('/api/admin/blog/posts');
    
    let html = '<div class="mb-16">' +
      '<div class="stat-box" style="display:inline-block">' +
      '<div class="stat-number">' + subCount.count + '</div>' +
      '<div class="stat-label">Subscribed Users</div></div></div>';
    
    // Send Newsletter section
    html += '<div class="card mb-16"><h3 style="margin-bottom:12px">📨 Send Newsletter</h3>' +
      '<p class="text-sm mb-12" style="color:var(--text-light)">Select a published blog post to send as a newsletter to all subscribers.</p>' +
      '<div class="form-group"><label>Blog Post</label>' +
      '<select class="form-select" id="newsletterBlogSelect">' +
      '<option value="">— Select a post —</option>';
    
    posts.filter(p => p.is_published).forEach(p => {
      html += '<option value="' + p.id + '">' + esc(p.title) + ' (' + fmtDate(p.published_at) + ')</option>';
    });
    
    html += '</select></div>' +
      '<button class="btn btn-primary btn-sm" onclick="sendNewsletter()">Send to All Subscribers</button>' +
      '</div>';
    
    // Draft Posts section
    const draftPosts = posts.filter(p => !p.is_published);
    if (draftPosts.length > 0) {
      html += '<div class="card mb-16"><h3 style="margin-bottom:12px">📝 Draft Posts</h3>' +
        '<div style="display:flex;flex-direction:column;gap:8px">';
      
      draftPosts.forEach(p => {
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border:1px solid var(--border);border-radius:var(--radius)">' +
          '<div><strong>' + esc(p.title) + '</strong><div class="text-sm" style="color:var(--text-light)">Created ' + fmtDate(p.created_at) + '</div></div>' +
          '<button class="btn btn-success btn-sm" onclick="publishBlogPost(\'' + p.id + '\',\'' + esc(p.title).replace(/'/g,"\\'") + '\')">Publish</button>' +
          '</div>';
      });
      
      html += '</div></div>';
    }
    
    // Past Sends section
    html += '<div class="card"><h3 style="margin-bottom:12px">📤 Past Sends</h3>';
    if (history.length === 0) {
      html += '<p class="text-sm" style="color:var(--text-muted)">No newsletters sent yet.</p>';
    } else {
      html += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:0.85rem">' +
        '<tr style="border-bottom:2px solid var(--border);text-align:left">' +
        '<th style="padding:8px">Date</th>' +
        '<th style="padding:8px">Post Title</th>' +
        '<th style="padding:8px">Recipients</th>' +
        '</tr>';
      
      history.forEach(send => {
        html += '<tr style="border-bottom:1px solid var(--border)">' +
          '<td style="padding:8px">' + fmtDate(send.sent_at) + '</td>' +
          '<td style="padding:8px"><a href="/blog/' + send.slug + '" style="color:var(--primary);text-decoration:none">' + esc(send.title) + '</a></td>' +
          '<td style="padding:8px">' + send.recipients_count + '</td>' +
          '</tr>';
      });
      
      html += '</table></div>';
    }
    html += '</div>';
    
    document.getElementById('adminNewsletterContent').innerHTML = html;
  } catch(e) { console.error(e); }
}

async function sendNewsletter() {
  const postId = document.getElementById('newsletterBlogSelect').value;
  if (!postId) { toast('Select a blog post', 'error'); return; }
  
  try {
    const count = (await api('/api/admin/newsletter/subscribers')).count;
    if (!confirm('Send this newsletter to ' + count + ' subscribers?')) return;
    
    const result = await api('/api/admin/newsletter/send', { method: 'POST', body: { blogPostId: postId } });
    toast('Newsletter sent to ' + result.recipientCount + ' subscribers!', 'success');
    document.getElementById('newsletterBlogSelect').value = '';
    loadAdminNewsletter();
  } catch(e) { toast(e.message, 'error'); }
}

async function publishBlogPost(postId, title) {
  if (!confirm('Publish "' + title + '"?')) return;
  try {
    await api('/api/admin/blog/' + postId + '/publish', { method: 'PUT' });
    toast('Post published!', 'success');
    loadAdminNewsletter();
  } catch(e) { toast(e.message, 'error'); }
}

function exportNewsletterCSV() {
  exportData('/api/admin/newsletter/export');
}

// Landing page reviews
async function loadLandingReviews() {
  try {
    const el = document.getElementById('landingReviews');
    if (!el) return;
    const res = await fetch('/api/reviews?featured=1');
    const reviews = await res.json();
    if (!reviews.length) return;
    el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px">' +
      reviews.map(r => '<div class="card" style="text-align:left"><div style="color:#F4A623;margin-bottom:8px">' + '★'.repeat(r.rating) + '☆'.repeat(5-r.rating) + '</div>' +
        '<p style="color:var(--text);margin-bottom:8px;font-style:italic">"' + esc(r.body) + '"</p>' +
        '<div class="text-sm" style="color:var(--text-light)">— ' + esc(r.display_name || 'A Potter') + '</div></div>').join('') +
      '</div>';
  } catch(e) { /* ignore */ }
}
loadLandingReviews();

// ---- Init ----
// View toggle
function toggleView(section, mode) {
  localStorage.setItem('viewMode_' + section, mode);
  // Reload the section
  if (section === 'pieces') loadPieces();
  else if (section === 'clay') loadClayBodies();
  else if (section === 'glazes') loadGlazes();
  else if (section === 'firings') loadFirings();
  else if (section === 'sales') loadSales();
}
function getViewMode(section) { return localStorage.getItem('viewMode_' + section) || 'card'; }

// Lightbox
function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightboxModal').style.display = 'flex';
}
function closeLightbox() { document.getElementById('lightboxModal').style.display = 'none'; }

// Photo management
async function deletePhoto(photoId, pieceId) {
  if (!confirm('Delete this photo?')) return;
  try { await api('/api/photos/' + photoId, {method:'DELETE'}); toast('Photo deleted','success'); viewPiece(pieceId); } catch(e) { toast(e.message,'error'); }
}
async function editPhotoStage(photoId, currentStage, pieceId) {
  const stage = prompt('Enter stage (wet, leather-hard, bone-dry, bisque, glazed, finished, detail, other):', currentStage);
  if (stage === null) return;
  try { await api('/api/photos/' + photoId + '/stage', {method:'PUT', body:{stage}}); toast('Stage updated','success'); viewPiece(pieceId); } catch(e) { toast(e.message,'error'); }
}
async function deleteGlazePhoto(photoId) {
  if (!confirm('Delete this photo?')) return;
  try { await api('/api/glaze-photos/' + photoId, {method:'DELETE'}); toast('Photo deleted','success'); loadGlazes(); } catch(e) { toast(e.message,'error'); }
}
async function deleteClayPhoto(photoId) {
  if (!confirm('Delete this photo?')) return;
  try { await api('/api/clay-photos/' + photoId, {method:'DELETE'}); toast('Photo deleted','success'); loadClayBodies(); } catch(e) { toast(e.message,'error'); }
}

// Clay photo upload
function openClayPhotoUpload(clayId) {
  document.getElementById('clayPhotoClayId').value = clayId;
  document.getElementById('clayPhotoFile').value = '';
  document.getElementById('clayPhotoLabel').value = 'raw';
  document.getElementById('clayPhotoNotes').value = '';
  openModal('clayPhotoModal');
}
async function uploadClayPhoto(e) {
  e.preventDefault();
  const clayId = document.getElementById('clayPhotoClayId').value;
  const f = document.getElementById('clayPhotoFile').files[0]; if (!f) return;
  const fd = new FormData(); fd.append('photo', f);
  fd.append('label', document.getElementById('clayPhotoLabel').value);
  fd.append('notes', document.getElementById('clayPhotoNotes').value);
  try {
    const r = await fetch('/api/clay-bodies/' + clayId + '/photos', {method:'POST', headers:{Authorization:'Bearer '+token}, body:fd});
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    toast('Photo uploaded!','success'); closeModal('clayPhotoModal'); loadClayBodies();
  } catch(e) { toast(e.message,'error'); }
}

// Glaze photo modal upload
function openGlazePhotoUpload(glazeId) {
  document.getElementById('glazePhotoGlazeId').value = glazeId;
  document.getElementById('glazePhotoFile').value = '';
  document.getElementById('glazePhotoLabel').value = '';
  document.getElementById('glazePhotoNotes').value = '';
  openModal('glazePhotoModal');
}
async function uploadGlazePhotoModal(e) {
  e.preventDefault();
  const glazeId = document.getElementById('glazePhotoGlazeId').value;
  const f = document.getElementById('glazePhotoFile').files[0]; if (!f) return;
  const fd = new FormData(); fd.append('photo', f);
  fd.append('label', document.getElementById('glazePhotoLabel').value);
  fd.append('notes', document.getElementById('glazePhotoNotes').value);
  try {
    const r = await fetch('/api/glazes/' + glazeId + '/photos', {method:'POST', headers:{Authorization:'Bearer '+token}, body:fd});
    const d = await r.json(); if (!r.ok) throw new Error(d.error);
    toast('Photo uploaded!','success'); closeModal('glazePhotoModal'); loadGlazes();
  } catch(e) { toast(e.message,'error'); }
}

// Duplicate piece
async function duplicatePiece(id) {
  try {
    const p = await api('/api/pieces/' + id);
    openPieceModal({
      title: (p.title||'') + ' (copy)',
      clay_body_id: p.clay_body_id,
      status: 'in-progress',
      technique: p.technique,
      form: p.form,
      studio: p.studio,
      notes: p.notes,
      glazes: p.glazes
    });
  } catch(e) { toast(e.message,'error'); }
}

// Duplicate clay
function duplicateClay(id) {
  const c = clayBodies.find(x=>x.id===id);
  if (!c) return;
  openClayModal({...c, id: undefined, name: (c.name||'') + ' (copy)'});
}

// Duplicate glaze
function duplicateGlaze(id) {
  const g = glazes.find(x=>x.id===id);
  if (!g) return;
  openGlazeModal({...g, id: undefined, name: (g.name||'') + ' (copy)', ingredients: g.ingredients||[]});
}

// Ingredient total
function updateIngredientTotal() {
  const rows = document.querySelectorAll('.ingredient-row .ing-pct');
  let total = 0;
  rows.forEach(r => { total += parseFloat(r.value) || 0; });
  const el = document.getElementById('ingredientTotal');
  if (el) {
    const color = Math.abs(total - 100) < 0.1 ? 'var(--success)' : (Math.abs(total - 100) < 5 ? '#F4A623' : 'var(--danger)');
    el.innerHTML = '<span style="color:' + color + '">Total: ' + total.toFixed(1) + '%</span>' + (Math.abs(total-100) < 0.1 ? ' ✓' : '');
  }
}

// Shopping list
async function loadShoppingList() {
  try {
    const d = await api('/api/shopping-list');
    const el = document.getElementById('shoppingListContent');
    let html = '';
    if (d.clays.length) {
      html += '<h3 style="margin-bottom:12px">🪨 Clays to Buy</h3>';
      html += d.clays.map(c =>
        '<div class="card" style="margin-bottom:8px"><div class="card-header"><div><div class="card-title">' + esc(c.name) + '</div>' +
        '<div class="text-sm" style="color:var(--text-light)">' + esc(c.brand||'') + (c.source ? ' · ' + esc(c.source) : '') + '</div></div>' +
        (c.buy_url ? '<a href="' + esc(c.buy_url) + '" target="_blank" class="btn btn-primary btn-sm">Buy →</a>' :
         c.source_url ? '<a href="' + esc(c.source_url) + '" target="_blank" class="btn btn-secondary btn-sm">Source →</a>' : '') +
        '</div></div>'
      ).join('');
    }
    if (d.glazes.length) {
      html += '<h3 style="margin:20px 0 12px">🎨 Glazes to Buy</h3>';
      html += d.glazes.map(g =>
        '<div class="card" style="margin-bottom:8px"><div class="card-header"><div><div class="card-title">' + esc(g.name) + '</div>' +
        '<div class="text-sm" style="color:var(--text-light)">' + esc(g.brand||'') + (g.source ? ' · ' + esc(g.source) : '') + '</div></div>' +
        (g.buy_url ? '<a href="' + esc(g.buy_url) + '" target="_blank" class="btn btn-primary btn-sm">Buy →</a>' :
         g.source_url ? '<a href="' + esc(g.source_url) + '" target="_blank" class="btn btn-secondary btn-sm">Source →</a>' : '') +
        '</div></div>'
      ).join('');
    }
    if (!d.clays.length && !d.glazes.length) {
      html = '<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">All stocked up!</div><p>Mark items as out of stock or "need to buy" to see them here.</p></div>';
    }
    el.innerHTML = html;
  } catch(e) { toast(e.message,'error'); }
}

function copyShoppingList() {
  const el = document.getElementById('shoppingListContent');
  const items = el.querySelectorAll('.card-title');
  if (!items.length) { toast('Nothing to copy',''); return; }
  let text = '🛒 Potter\'s Mud Room Shopping List\n\n';
  items.forEach(i => { text += '• ' + i.textContent + '\n'; });
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard!','success')).catch(() => toast('Could not copy','error'));
}

function printShoppingList() {
  const el = document.getElementById('shoppingListContent');
  const w = window.open('', '_blank');
  w.document.write('<html><head><title>Shopping List</title><style>body{font-family:Georgia,serif;padding:20px;max-width:600px;margin:0 auto}h1{font-size:1.4rem}h3{margin:16px 0 8px}.item{padding:6px 0;border-bottom:1px solid #eee}.brand{color:#888;font-size:0.9rem}@media print{body{padding:0}}</style></head><body>');
  w.document.write('<h1>🛒 Potter\'s Mud Room Shopping List</h1>');
  w.document.write(el.innerHTML);
  w.document.write('</body></html>');
  w.document.close();
  w.print();
}

// Glaze chemicals
let chemicals = [];
async function loadChemicals() {
  try {
    chemicals = await api('/api/glaze-chemicals');
    const c = document.getElementById('chemicalList'), em = document.getElementById('chemicalEmpty');
    if (!chemicals.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = chemicals.map(ch =>
      '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(ch.name) +
      ' <span class="piece-meta-tag" style="' + (ch.in_stock ? 'background:rgba(40,167,69,0.1);color:var(--success)' : 'background:rgba(220,53,69,0.1);color:var(--danger)') + '">' +
      (ch.in_stock ? 'In Stock' : 'Out of Stock') + '</span></div>' +
      '<div class="text-sm" style="color:var(--text-light)">' +
      (ch.quantity ? ch.quantity + ' ' + (ch.unit||'oz') : '') +
      (ch.source ? ' · ' + esc(ch.source) : '') + '</div></div>' +
      '<div style="display:flex;gap:4px">' +
      (ch.source_url ? '<a href="' + esc(ch.source_url) + '" target="_blank" class="btn-ghost btn-sm" title="Source">🔗</a>' : '') +
      '<button class="btn-ghost btn-sm" onclick="editChemical(\'' + ch.id + '\')">✏️</button>' +
      '<button class="btn-ghost btn-sm" onclick="deleteChemical(\'' + ch.id + '\')">🗑️</button></div></div>' +
      (ch.notes ? '<div class="text-sm mt-8" style="color:var(--text-light)">' + esc(ch.notes) + '</div>' : '') +
      '</div>'
    ).join('');
  } catch(e) { toast(e.message,'error'); }
}

function openChemicalModal(ch) {
  document.getElementById('chemicalId').value = ch?.id||'';
  document.getElementById('chemicalModalTitle').textContent = ch ? 'Edit Chemical' : 'Add Chemical';
  document.getElementById('chemicalName').value = ch?.name||'';
  document.getElementById('chemicalQty').value = ch?.quantity||'';
  document.getElementById('chemicalUnit').value = ch?.unit||'oz';
  document.getElementById('chemicalSource').value = ch?.source||'';
  document.getElementById('chemicalSourceUrl').value = ch?.source_url||'';
  document.getElementById('chemicalInStock').checked = ch?.in_stock !== 0;
  document.getElementById('chemicalNotes').value = ch?.notes||'';
  openModal('chemicalModal');
}
function editChemical(id) { const ch = chemicals.find(x=>x.id===id); if(ch) openChemicalModal(ch); }
async function saveChemical(e) {
  e.preventDefault();
  const id = document.getElementById('chemicalId').value;
  const body = {
    name: document.getElementById('chemicalName').value,
    quantity: parseFloat(document.getElementById('chemicalQty').value)||null,
    unit: document.getElementById('chemicalUnit').value,
    source: document.getElementById('chemicalSource').value||null,
    sourceUrl: document.getElementById('chemicalSourceUrl').value||null,
    inStock: document.getElementById('chemicalInStock').checked,
    notes: document.getElementById('chemicalNotes').value||null
  };
  try {
    if (id) { await api('/api/glaze-chemicals/'+id, {method:'PUT',body}); toast('Chemical updated!','success'); }
    else { await api('/api/glaze-chemicals', {method:'POST',body}); toast('Chemical added!','success'); }
    closeModal('chemicalModal'); loadChemicals();
  } catch(e) { toast(e.message,'error'); }
}
async function deleteChemical(id) {
  if (!confirm('Delete this chemical?')) return;
  try { await api('/api/glaze-chemicals/'+id, {method:'DELETE'}); toast('Deleted','success'); loadChemicals(); } catch(e) { toast(e.message,'error'); }
}

// Glaze stock quick toggle
async function toggleGlazeStock(id, status) {
  try { await api('/api/glazes/'+id+'/stock', {method:'PUT', body:{stockStatus:status}}); loadGlazes(); } catch(e) { toast(e.message,'error'); }
}

// ============ GLAZE CLAY BODY TESTS ============
function toggleClayTestForm(glazeId) {
  const form = document.getElementById('clayTestForm_' + glazeId);
  if (!form) return;
  form.classList.toggle('hidden');
  // Populate the clay body dropdown when opening
  if (!form.classList.contains('hidden')) {
    populateClayTestDropdown(glazeId);
  }
}

async function populateClayTestDropdown(glazeId) {
  try {
    const clays = await api('/api/clay-bodies');
    const sel = document.getElementById('clayTestSelect_' + glazeId);
    if (!sel) return;
    // Keep first two options (placeholder + manual), remove rest
    while (sel.options.length > 2) sel.remove(2);
    clays.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name + (c.brand ? ' (' + c.brand + ')' : '') + (c.clay_type ? ' — ' + c.clay_type : '');
      sel.appendChild(opt);
    });
  } catch(e) { /* silent */ }
}

function toggleClayTestManual(glazeId) {
  const sel = document.getElementById('clayTestSelect_' + glazeId);
  const manual = document.getElementById('clayTestManualName_' + glazeId);
  if (!sel || !manual) return;
  if (sel.value === '__manual__') {
    manual.classList.remove('hidden');
    manual.focus();
  } else {
    manual.classList.add('hidden');
    manual.value = '';
  }
}

async function saveClayTest(glazeId) {
  const sel = document.getElementById('clayTestSelect_' + glazeId);
  const manualInput = document.getElementById('clayTestManualName_' + glazeId);
  const notesEl = document.getElementById('clayTestNotes_' + glazeId);
  const photoEl = document.getElementById('clayTestPhoto_' + glazeId);
  if (!sel) return;

  const formData = new FormData();
  if (sel.value === '__manual__') {
    if (!manualInput.value.trim()) return toast('Enter a clay name', 'error');
    formData.append('clay_name', manualInput.value.trim());
  } else if (sel.value) {
    formData.append('clay_body_id', sel.value);
  } else {
    return toast('Select a clay body or enter manually', 'error');
  }
  if (notesEl.value.trim()) formData.append('result_notes', notesEl.value.trim());
  if (photoEl.files.length) formData.append('photo', photoEl.files[0]);

  try {
    await api('/api/glazes/' + glazeId + '/clay-tests', { method: 'POST', body: formData });
    toast('Clay test added!', 'success');
    loadGlazes();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteClayTest(glazeId, testId) {
  if (!confirm('Remove this clay body test?')) return;
  try {
    await api('/api/glazes/' + glazeId + '/clay-tests/' + testId, { method: 'DELETE' });
    toast('Removed', 'success');
    loadGlazes();
  } catch(e) { toast(e.message, 'error'); }
}

// ---- Modal clay test functions ----
function renderModalClayTests(tests) {
  const el = document.getElementById('glazeClayTestsList');
  if (!el) return;
  if (!tests.length) {
    el.innerHTML = '<div class="text-sm" style="color:var(--text-muted);font-style:italic">No clay bodies tested yet</div>';
    return;
  }
  el.innerHTML = tests.map(t =>
    '<div style="background:var(--bg-light);border-radius:var(--radius-sm);padding:8px 10px;margin-bottom:6px;display:flex;gap:10px;align-items:flex-start">' +
    (t.photo_filename ? '<img src="/uploads/' + t.photo_filename + '" style="width:40px;height:40px;object-fit:cover;border-radius:var(--radius-sm);cursor:zoom-in;flex-shrink:0" onclick="openLightbox(\'/uploads/' + t.photo_filename + '\')">' : '') +
    '<div style="flex:1;min-width:0">' +
    '<div style="font-weight:600;font-size:0.85rem">' + esc(t.clay_name) + '</div>' +
    (t.result_notes ? '<div class="text-sm" style="color:var(--text-light)">' + esc(t.result_notes) + '</div>' : '') +
    '</div>' +
    '<button type="button" class="btn-ghost btn-sm" onclick="deleteModalClayTest(\'' + t.id + '\')" style="color:var(--text-muted);flex-shrink:0" title="Remove">×</button>' +
    '</div>'
  ).join('');
}

async function populateModalClayTestDropdown() {
  try {
    const clays = await api('/api/clay-bodies');
    const sel = document.getElementById('modalClayTestSelect');
    if (!sel) return;
    while (sel.options.length > 2) sel.remove(2);
    clays.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name + (c.brand ? ' (' + c.brand + ')' : '') + (c.clay_type ? ' — ' + c.clay_type : '');
      sel.appendChild(opt);
    });
  } catch(e) { /* silent */ }
}

function toggleModalClayTestForm() {
  const form = document.getElementById('modalClayTestForm');
  if (form) form.classList.toggle('hidden');
}

function toggleModalClayTestManual() {
  const sel = document.getElementById('modalClayTestSelect');
  const manual = document.getElementById('modalClayTestManualName');
  if (!sel || !manual) return;
  if (sel.value === '__manual__') {
    manual.classList.remove('hidden');
    manual.focus();
  } else {
    manual.classList.add('hidden');
    manual.value = '';
  }
}

async function saveModalClayTest() {
  const glazeId = document.getElementById('glazeId').value;
  if (!glazeId) return toast('Save the glaze first', 'error');
  const sel = document.getElementById('modalClayTestSelect');
  const manualInput = document.getElementById('modalClayTestManualName');
  const notesEl = document.getElementById('modalClayTestNotes');
  const photoEl = document.getElementById('modalClayTestPhoto');

  const formData = new FormData();
  if (sel.value === '__manual__') {
    if (!manualInput.value.trim()) return toast('Enter a clay name', 'error');
    formData.append('clay_name', manualInput.value.trim());
  } else if (sel.value) {
    formData.append('clay_body_id', sel.value);
  } else {
    return toast('Select a clay body or enter manually', 'error');
  }
  if (notesEl.value.trim()) formData.append('result_notes', notesEl.value.trim());
  if (photoEl.files.length) formData.append('photo', photoEl.files[0]);

  try {
    await api('/api/glazes/' + glazeId + '/clay-tests', { method: 'POST', body: formData });
    toast('Clay test added!', 'success');
    // Refresh the clay tests in both the modal and the card view
    const tests = await api('/api/glazes/' + glazeId + '/clay-tests');
    renderModalClayTests(tests);
    // Also update the glazes array in memory
    const g = glazes.find(x => x.id === glazeId);
    if (g) g.clay_tests = tests;
    // Reset form fields
    sel.value = '';
    manualInput.classList.add('hidden');
    manualInput.value = '';
    notesEl.value = '';
    photoEl.value = '';
    document.getElementById('modalClayTestForm').classList.add('hidden');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteModalClayTest(testId) {
  if (!confirm('Remove this clay body test?')) return;
  const glazeId = document.getElementById('glazeId').value;
  try {
    await api('/api/glazes/' + glazeId + '/clay-tests/' + testId, { method: 'DELETE' });
    toast('Removed', 'success');
    const tests = await api('/api/glazes/' + glazeId + '/clay-tests');
    renderModalClayTests(tests);
    const g = glazes.find(x => x.id === glazeId);
    if (g) g.clay_tests = tests;
  } catch(e) { toast(e.message, 'error'); }
}

// Clay stock quick toggle
async function toggleClayStock(id, val) {
  try { await api('/api/clay-bodies/'+id+'/stock', {method:'PUT', body:{inStock:val}}); loadClayBodies(); } catch(e) { toast(e.message,'error'); }
}

// ---- Combo Likes & Comments ----
async function toggleComboLike(comboId) {
  try { await api('/api/community/combos/' + comboId + '/like', {method:'POST'}); loadCombos(); } catch(e) { toast(e.message,'error'); }
}
async function toggleComboComments(comboId) {
  const el = document.getElementById('comboComments_' + comboId);
  if (!el) return;
  if (!el.classList.contains('hidden')) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">Loading...</div>';
  try {
    const comments = await api('/api/community/combos/' + comboId + '/comments');
    let html = comments.map(c => {
      const avatar = c.author_avatar ? '<img src="/uploads/' + c.author_avatar + '" style="width:28px;height:28px;border-radius:50%;object-fit:cover">' : '<div style="width:28px;height:28px;border-radius:50%;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-size:0.8rem">' + (c.author_name||'?')[0].toUpperCase() + '</div>';
      const deleteBtn = (c.user_id === currentUser?.id || currentUser?.email === 'christinaworkmanpottery@gmail.com') ? '<button class="btn-ghost btn-sm" onclick="deleteComboComment(\'' + c.id + '\',\'' + comboId + '\')" style="font-size:0.7rem">🗑️</button>' : '';
      return '<div style="display:flex;gap:8px;margin-bottom:10px">' + avatar +
        '<div style="flex:1"><div style="display:flex;justify-content:space-between"><strong class="text-sm">' + esc(c.author_name||'Anonymous') + '</strong><div>' + deleteBtn + '<span class="text-sm" style="color:var(--text-muted)">' + timeAgo(c.created_at) + '</span></div></div>' +
        '<div class="text-sm" style="margin-top:2px">' + esc(c.body) + '</div></div></div>';
    }).join('');
    html += '<div style="display:flex;gap:8px;margin-top:8px"><input type="text" class="form-input" id="comboComment_' + comboId + '" placeholder="Ask a question or comment..." style="font-size:0.85rem">' +
      '<button class="btn btn-primary btn-sm" onclick="postComboComment(\'' + comboId + '\')">Post</button></div>';
    el.innerHTML = html;
  } catch(e) { el.innerHTML = '<div class="text-sm" style="color:var(--danger)">' + esc(e.message) + '</div>'; }
}
async function postComboComment(comboId) {
  const input = document.getElementById('comboComment_' + comboId);
  if (!input?.value.trim()) return;
  try {
    await api('/api/community/combos/' + comboId + '/comments', {method:'POST', body:{body:input.value.trim()}});
    toggleComboComments(comboId); // reload
    toggleComboComments(comboId);
    loadCombos(); // update count
  } catch(e) { toast(e.message,'error'); }
}
async function deleteComboComment(commentId, comboId) {
  if (!confirm('Delete this comment?')) return;
  try { await api('/api/community/comments/' + commentId, {method:'DELETE'}); toggleComboComments(comboId); toggleComboComments(comboId); loadCombos(); } catch(e) { toast(e.message,'error'); }
}

// ---- Forum Like ----
async function toggleForumLike(postId) {
  try { const d = await api('/api/forum/posts/' + postId + '/like', {method:'POST'}); return d.liked; } catch(e) { toast(e.message,'error'); }
}

// ---- Notifications ----
async function pollNotificationBadges() {
  try {
    const n = await api('/api/notifications');
    const badge = document.getElementById('notifBadge');
    if (n.unread > 0) { badge.textContent = n.unread; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }
  } catch(e) {}
  try {
    const m = await api('/api/messages');
    const badge = document.getElementById('msgBadge');
    if (m.unread > 0) { badge.textContent = m.unread; badge.classList.remove('hidden'); } else { badge.classList.add('hidden'); }
  } catch(e) {}
  // Poll every 60 seconds
  setTimeout(pollNotificationBadges, 60000);
}

async function loadNotifications() {
  try {
    const d = await api('/api/notifications');
    const c = document.getElementById('notificationList'), em = document.getElementById('notificationsEmpty');
    if (!d.notifications.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = d.notifications.map(n => {
      const link = (n.link||'').replace(/'/g, "\\'");
      const isBlog = n.type === 'newsletter' || (n.link && n.link.startsWith('/blog/'));
      return '<div class="notif-item' + (n.is_read ? '' : ' unread') + '" onclick="handleNotifClick(\'' + esc(n.id) + '\',\'' + link + '\')" style="cursor:pointer">' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><div>' +
      (n.type==='combo_like' ? '❤️ ' : n.type==='combo_comment' ? '💬 ' : n.type==='forum_like' ? '❤️ ' : n.type==='forum_reply' ? '💬 ' : n.type==='message' ? '✉️ ' : n.type==='newsletter' ? '📰 ' : '🔔 ') +
      esc(n.message) + '</div><div style="display:flex;align-items:center;gap:8px"><span class="text-sm" style="color:var(--text-muted);white-space:nowrap">' + timeAgo(n.created_at) + '</span>' +
      (isBlog ? '<span style="color:var(--primary);font-size:0.85rem;font-weight:600;white-space:nowrap">Read →</span>' : '') +
      '</div></div></div>';
    }).join('');
    // Mark all as read
    api('/api/notifications/read', {method:'POST'}).then(() => {
      const badge = document.getElementById('notifBadge'); badge.classList.add('hidden');
    });
  } catch(e) { toast(e.message,'error'); }
}

function handleNotifClick(notifId, link) {
  if (!link) return;
  if (link === 'community') navigate('community');
  else if (link === 'forum') navigate('forum');
  else if (link.startsWith('forumPost_')) viewForumPost(link.replace('forumPost_',''));
  else if (link.startsWith('messages_')) { navigate('messageThread'); loadMessageThread(link.replace('messages_','')); }
  else if (link.startsWith('/blog/')) { viewBlogPost(link.replace('/blog/','')); }
}

async function markAllNotificationsRead() {
  try { await api('/api/notifications/read', {method:'POST'}); toast('All marked read','success'); loadNotifications(); } catch(e) { toast(e.message,'error'); }
}

// ---- In-App Messaging ----
async function loadMessages() {
  try {
    const d = await api('/api/messages');
    const c = document.getElementById('messageList'), em = document.getElementById('messagesEmpty');
    if (!d.conversations.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = d.conversations.map(m => {
      const avatar = m.partner_avatar ? '<img src="/uploads/' + m.partner_avatar + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover">' : '<div style="width:40px;height:40px;border-radius:50%;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-weight:700">' + (m.partner_name||'?')[0].toUpperCase() + '</div>';
      const isUnread = !m.is_read && m.to_user_id === currentUser?.id;
      return '<div class="notif-item' + (isUnread ? ' unread' : '') + '" onclick="navigate(\'messageThread\');loadMessageThread(\'' + m.partner_id + '\')">' +
        '<div style="display:flex;gap:12px;align-items:center">' + avatar +
        '<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between"><strong>' + esc(m.partner_name||'Unknown') + '</strong>' +
        '<span class="text-sm" style="color:var(--text-muted)">' + timeAgo(m.created_at) + '</span></div>' +
        '<div class="text-sm" style="color:var(--text-light);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.body.substring(0,80)) + '</div></div></div></div>';
    }).join('');
  } catch(e) { toast(e.message,'error'); }
}

async function loadMessageThread(userId) {
  try {
    const d = await api('/api/messages/' + userId);
    const el = document.getElementById('messageThreadContent');
    const partner = d.partner || {};
    const avatar = partner.avatar_filename ? '<img src="/uploads/' + partner.avatar_filename + '" style="width:36px;height:36px;border-radius:50%;object-fit:cover">' : '<div style="width:36px;height:36px;border-radius:50%;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-weight:700">' + (partner.display_name||'?')[0].toUpperCase() + '</div>';
    let html = '<div style="display:flex;gap:12px;align-items:center;margin-bottom:20px">' + avatar + '<h2>' + esc(partner.display_name||'Unknown') + '</h2></div>';
    html += '<div style="max-height:400px;overflow-y:auto;padding:12px;background:var(--bg);border-radius:var(--radius-sm);margin-bottom:16px" id="msgThreadScroll">';
    if (!d.messages.length) html += '<div class="text-sm" style="color:var(--text-muted);text-align:center;padding:20px">No messages yet. Start the conversation!</div>';
    d.messages.forEach(m => {
      const mine = m.from_user_id === currentUser?.id;
      html += '<div style="display:flex;' + (mine ? 'justify-content:flex-end' : '') + '">' +
        '<div class="msg-bubble ' + (mine ? 'msg-mine' : 'msg-theirs') + '">' + esc(m.body) +
        '<div style="font-size:0.7rem;opacity:0.7;margin-top:4px">' + timeAgo(m.created_at) + '</div></div></div>';
    });
    html += '</div>';
    html += '<div style="display:flex;gap:8px"><input type="text" class="form-input" id="msgInput" placeholder="Type a message..." onkeydown="if(event.key===\'Enter\')sendMessage(\'' + userId + '\')">' +
      '<button class="btn btn-primary" onclick="sendMessage(\'' + userId + '\')">Send</button></div>';
    el.innerHTML = html;
    // Scroll to bottom
    const scroll = document.getElementById('msgThreadScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    pollNotificationBadges();
  } catch(e) { toast(e.message,'error'); }
}

async function sendMessage(userId) {
  const input = document.getElementById('msgInput');
  if (!input?.value.trim()) return;
  try {
    await api('/api/messages/' + userId, {method:'POST', body:{body:input.value.trim()}});
    input.value = '';
    loadMessageThread(userId);
  } catch(e) { toast(e.message,'error'); }
}

// ---- Admin Search & Cancel ----
async function adminSearchMembers() {
  const q = document.getElementById('adminSearchInput')?.value;
  if (!q) return;
  try {
    const results = await api('/api/admin/members/search?q=' + encodeURIComponent(q));
    const el = document.getElementById('adminSearchResults');
    if (!results.length) { el.innerHTML = '<div class="text-sm" style="color:var(--text-muted)">No results</div>'; return; }
    el.innerHTML = results.map(u =>
      '<div class="card" style="padding:10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">' +
      '<div><strong>' + esc(u.display_name||'') + '</strong> · ' + esc(u.email) + ' · <span class="tier-badge tier-' + (u.tier||'free') + '" style="font-size:0.7rem">' + (u.tier||'free').toUpperCase() + '</span></div>' +
      '<div style="display:flex;gap:4px">' +
      (u.tier !== 'free' ? '<button class="btn btn-danger btn-sm" onclick="adminCancelMember(\'' + u.id + '\',\'' + esc(u.email) + '\')">Cancel Membership</button>' : '<span class="text-sm" style="color:var(--text-muted)">Free tier</span>') +
      '</div></div>'
    ).join('');
  } catch(e) { toast(e.message,'error'); }
}

async function adminCancelMember(userId, email) {
  if (!confirm('Cancel membership for ' + email + '? This will set them back to Free tier immediately.')) return;
  try { await api('/api/admin/members/' + userId + '/cancel', {method:'POST'}); toast('Membership cancelled for ' + email,'success'); adminSearchMembers(); loadAdmin(); } catch(e) { toast(e.message,'error'); }
}

// ============ GOALS ============
async function loadGoals() {
  try {
    const goals = await api('/api/goals');
    const c = document.getElementById('goalsList'), em = document.getElementById('goalsEmpty');
    if (!goals.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = goals.map(g =>
      '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(g.title) + '</div>' +
      '<div class="text-sm" style="color:var(--text-light)">' + (g.due_date ? 'Due: ' + fmtDate(g.due_date) : '') + '</div></div>' +
      '<span class="piece-meta-tag">' + (g.priority||'medium') + '</span></div>' +
      (g.description ? '<div class="text-sm mt-8">' + esc(g.description) + '</div>' : '') +
      '<div style="display:flex;gap:4px;margin-top:10px"><button onclick="editGoal(\'' + g.id + '\')" class="btn-small">✎</button><button onclick="deleteGoal(\'' + g.id + '\')" class="btn-small">✕</button></div>' +
      '</div>'
    ).join('');
  } catch(e) { toast(e.message,'error'); }
}

function openGoalModal(g = null) {
  document.getElementById('goalId').value = g?.id || '';
  document.getElementById('goalTitle').value = g?.title || '';
  document.getElementById('goalDescription').value = g?.description || '';
  document.getElementById('goalStatus').value = g?.status || 'active';
  document.getElementById('goalDueDate').value = g?.due_date || '';
  document.getElementById('goalPriority').value = g?.priority || 'medium';
  openModal('goalModal');
}

function editGoal(id) {
  api('/api/goals').then(goals => {
    const g = goals.find(x => x.id === id);
    if (g) openGoalModal(g);
  });
}

async function saveGoal(e) {
  e.preventDefault();
  const id = document.getElementById('goalId').value;
  const body = {
    title: document.getElementById('goalTitle').value,
    description: document.getElementById('goalDescription').value,
    status: document.getElementById('goalStatus').value,
    dueDate: document.getElementById('goalDueDate').value || null,
    priority: document.getElementById('goalPriority').value
  };
  try {
    if (id) { await api('/api/goals/' + id, {method:'PUT',body}); toast('Goal updated!','success'); }
    else { await api('/api/goals', {method:'POST',body}); toast('Goal added!','success'); }
    closeModal('goalModal');
    document.getElementById('goalId').value = '';
    loadGoals();
  } catch(e) { toast(e.message,'error'); }
}

async function deleteGoal(id) {
  if (!confirm('Delete this goal?')) return;
  try { await api('/api/goals/' + id, {method:'DELETE'}); toast('Deleted','success'); loadGoals(); } catch(e) { toast(e.message,'error'); }
}

// ============ PROJECTS ============
async function loadProjects() {
  try {
    const projects = await api('/api/projects');
    const c = document.getElementById('projectsList'), em = document.getElementById('projectsEmpty');
    if (!projects.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    const photosHtml = (photos) => photos && photos.length > 0 ? '<div style="display:flex;gap:6px;margin:8px 0;flex-wrap:wrap">' + photos.map(p => '<img src="/uploads/' + p.filename + '" style="width:80px;height:80px;object-fit:cover;border-radius:var(--radius-sm);cursor:zoom-in" onclick="openLightbox(\'/uploads/' + p.filename + '\')">').join('') + '</div>' : '';
    c.innerHTML = projects.map(p =>
      '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(p.title) + '</div>' +
      '<div class="text-sm" style="color:var(--text-light)">' + (p.due_date ? 'Due: ' + fmtDate(p.due_date) : '') + '</div></div>' +
      '<span class="piece-meta-tag">' + (p.status||'active') + '</span></div>' +
      photosHtml(p.photos) +
      (p.description ? '<div class="text-sm mt-8">' + esc(p.description) + '</div>' : '') +
      '<div style="display:flex;gap:4px;margin-top:10px"><button onclick="openProjectPhotoUpload(\'' + p.id + '\')" class="btn-small" title="Add photos">📸</button><button onclick="editProject(\'' + p.id + '\')" class="btn-small">✎</button><button onclick="deleteProject(\'' + p.id + '\')" class="btn-small">✕</button></div>' +
      '</div>'
    ).join('');
  } catch(e) { toast(e.message,'error'); }
}

function openProjectModal(p = null) {
  document.getElementById('projectId').value = p?.id || '';
  document.getElementById('projectTitle').value = p?.title || '';
  document.getElementById('projectDescription').value = p?.description || '';
  document.getElementById('projectStatus').value = p?.status || 'active';
  document.getElementById('projectDueDate').value = p?.due_date || '';
  openModal('projectModal');
}

function editProject(id) {
  api('/api/projects').then(projects => {
    const p = projects.find(x => x.id === id);
    if (p) openProjectModal(p);
  });
}

async function saveProject(e) {
  e.preventDefault();
  const id = document.getElementById('projectId').value;
  const body = {
    title: document.getElementById('projectTitle').value,
    description: document.getElementById('projectDescription').value,
    status: document.getElementById('projectStatus').value,
    dueDate: document.getElementById('projectDueDate').value || null
  };
  try {
    if (id) { await api('/api/projects/' + id, {method:'PUT',body}); toast('Project updated!','success'); }
    else { await api('/api/projects', {method:'POST',body}); toast('Project added!','success'); }
    closeModal('projectModal');
    document.getElementById('projectId').value = '';
    loadProjects();
  } catch(e) { toast(e.message,'error'); }
}

async function deleteProject(id) {
  if (!confirm('Delete this project?')) return;
  try { await api('/api/projects/' + id, {method:'DELETE'}); toast('Deleted','success'); loadProjects(); } catch(e) { toast(e.message,'error'); }
}

function openProjectPhotoUpload(projectId) {
  document.getElementById('projectPhotoProjectId').value = projectId;
  document.getElementById('projectPhotoFile').value = '';
  openModal('projectPhotoModal');
}

async function uploadProjectPhotos(event) {
  event.preventDefault();
  const projectId = document.getElementById('projectPhotoProjectId').value;
  const files = document.getElementById('projectPhotoFile').files;
  if (!files.length) return;
  const formData = new FormData();
  for (let f of files) formData.append('photos', f);
  try {
    await api('/api/projects/' + projectId + '/photos', { method: 'POST', body: formData });
    toast('Photos uploaded', 'success');
    closeModal('projectPhotoModal');
    loadProjects();
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteProjectPhoto(photoId) {
  try {
    await api('/api/project-photos/' + photoId, { method: 'DELETE' });
    toast('Photo deleted', 'success');
    loadProjects();
  } catch(e) { toast(e.message, 'error'); }
}

// ============ EVENTS ============
async function loadEvents() {
  try {
    const events = await api('/api/events');
    const c = document.getElementById('eventsList'), em = document.getElementById('eventsEmpty');
    if (!events.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = events.map(e => {
      const start = e.event_date + (e.start_time ? 'T' + e.start_time : 'T00:00');
      const end = e.event_date + (e.end_time ? 'T' + e.end_time : 'T23:59');
      const gCalUrl = 'https://calendar.google.com/calendar/r/eventedit?text=' + encodeURIComponent(e.title) + '&dates=' + start.replace(/[-:]/g,'') + '/' + end.replace(/[-:]/g,'') + (e.location ? '&location=' + encodeURIComponent(e.location) : '') + (e.description ? '&details=' + encodeURIComponent(e.description) : '');
      return '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(e.title) + '</div>' +
      '<div class="text-sm" style="color:var(--text-light)">' + fmtDate(e.event_date) + (e.start_time ? ' at ' + e.start_time : '') + '</div></div></div>' +
      (e.location ? '<div class="text-sm"><strong>Location:</strong> ' + esc(e.location) + '</div>' : '') +
      (e.description ? '<div class="text-sm mt-8">' + esc(e.description) + '</div>' : '') +
      '<div style="display:flex;gap:4px;margin-top:10px"><a href="' + gCalUrl + '" target="_blank" class="btn btn-sm btn-secondary" style="text-decoration:none">📱 Add to Google Calendar</a><button onclick="editEvent(\'' + e.id + '\')" class="btn-small">✎</button><button onclick="deleteEvent(\'' + e.id + '\')" class="btn-small">✕</button></div>' +
      '</div>';
    }).join('');
  } catch(e) { toast(e.message,'error'); }
}

function openEventModal(e = null) {
  document.getElementById('eventId').value = e?.id || '';
  document.getElementById('eventTitle').value = e?.title || '';
  document.getElementById('eventDescription').value = e?.description || '';
  document.getElementById('eventDate').value = e?.event_date || '';
  document.getElementById('eventStartTime').value = e?.start_time || '';
  document.getElementById('eventEndTime').value = e?.end_time || '';
  document.getElementById('eventLocation').value = e?.location || '';
  openModal('eventModal');
}

function editEvent(id) {
  api('/api/events').then(events => {
    const e = events.find(x => x.id === id);
    if (e) openEventModal(e);
  });
}

async function saveEvent(e) {
  e.preventDefault();
  const id = document.getElementById('eventId').value;
  const body = {
    title: document.getElementById('eventTitle').value,
    description: document.getElementById('eventDescription').value,
    eventDate: document.getElementById('eventDate').value,
    startTime: document.getElementById('eventStartTime').value || null,
    endTime: document.getElementById('eventEndTime').value || null,
    location: document.getElementById('eventLocation').value || null
  };
  try {
    if (id) { await api('/api/events/' + id, {method:'PUT',body}); toast('Event updated!','success'); }
    else { await api('/api/events', {method:'POST',body}); toast('Event added!','success'); }
    closeModal('eventModal');
    document.getElementById('eventId').value = '';
    loadEvents();
  } catch(e) { toast(e.message,'error'); }
}

async function deleteEvent(id) {
  if (!confirm('Delete this event?')) return;
  try { await api('/api/events/' + id, {method:'DELETE'}); toast('Deleted','success'); loadEvents(); } catch(e) { toast(e.message,'error'); }
}

async function downloadEventsiCal() {
  try {
    const res = await fetch('/api/events/export/ics', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) throw new Error('Download failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'pottery-events.ics'; a.click();
    URL.revokeObjectURL(url);
    toast('Calendar downloaded! Open the .ics file to add to your calendar app.', 'success');
  } catch(e) { toast(e.message, 'error'); }
}
function printEvents() {
  const el = document.getElementById('eventsList');
  const w = window.open('', '_blank');
  w.document.write('<html><head><title>Events Calendar</title><style>body{font-family:Georgia,serif;padding:20px;max-width:700px;margin:0 auto}h1{font-size:1.4rem}.card{border:1px solid #ddd;padding:12px;margin-bottom:8px;border-radius:6px}@media print{body{padding:0}}</style></head><body>');
  w.document.write('<h1>📅 Events Calendar</h1>');
  w.document.write(el ? el.innerHTML : '<p>No events</p>');
  w.document.write('</body></html>');
  w.document.close();
  w.print();
}

// ============ CONTACTS ============
async function loadContacts() {
  try {
    const contacts = await api('/api/contacts');
    const c = document.getElementById('contactsList'), em = document.getElementById('contactsEmpty');
    if (!contacts.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    c.innerHTML = contacts.map(ct =>
      '<div class="card"><div class="card-header"><div><div class="card-title">' + esc(ct.name) + '</div>' +
      (ct.email ? '<div class="text-sm" style="color:var(--text-light)">' + esc(ct.email) + '</div>' : '') +
      (ct.phone ? '<div class="text-sm" style="color:var(--text-light)">' + esc(ct.phone) + '</div>' : '') + '</div></div>' +
      (ct.notes ? '<div class="text-sm mt-8">' + esc(ct.notes) + '</div>' : '') +
      '<div style="display:flex;gap:4px;margin-top:10px"><button onclick="editContact(\'' + ct.id + '\')" class="btn-small">✎</button><button onclick="deleteContact(\'' + ct.id + '\')" class="btn-small">✕</button></div>' +
      '</div>'
    ).join('');
  } catch(e) { toast(e.message,'error'); }
}

function openContactModal(ct = null) {
  document.getElementById('contactId').value = ct?.id || '';
  document.getElementById('contactName').value = ct?.name || '';
  document.getElementById('contactEmail').value = ct?.email || '';
  document.getElementById('contactPhone').value = ct?.phone || '';
  document.getElementById('contactNotes').value = ct?.notes || '';
  openModal('contactModal');
}

function editContact(id) {
  api('/api/contacts').then(contacts => {
    const ct = contacts.find(x => x.id === id);
    if (ct) openContactModal(ct);
  });
}

async function saveContact(e) {
  e.preventDefault();
  const id = document.getElementById('contactId').value;
  const body = {
    name: document.getElementById('contactName').value,
    email: document.getElementById('contactEmail').value || null,
    phone: document.getElementById('contactPhone').value || null,
    notes: document.getElementById('contactNotes').value || null
  };
  try {
    if (id) { await api('/api/contacts/' + id, {method:'PUT',body}); toast('Contact updated!','success'); }
    else { await api('/api/contacts', {method:'POST',body}); toast('Contact added!','success'); }
    closeModal('contactModal');
    document.getElementById('contactId').value = '';
    loadContacts();
  } catch(e) { toast(e.message,'error'); }
}

async function deleteContact(id) {
  if (!confirm('Delete this contact?')) return;
  try { await api('/api/contacts/' + id, {method:'DELETE'}); toast('Deleted','success'); loadContacts(); } catch(e) { toast(e.message,'error'); }
}

// ============ COMMUNITY MEMBERS ============
let allMembers = [];
async function loadCommunityMembers() {
  try {
    allMembers = await api('/api/community/members');
    document.getElementById('memberSearch').value = '';
    renderMembers(allMembers);
  } catch(e) { toast(e.message,'error'); }
}
function filterMembers() {
  const q = (document.getElementById('memberSearch').value || '').toLowerCase();
  if (!q) return renderMembers(allMembers);
  renderMembers(allMembers.filter(u => (u.display_name||'').toLowerCase().includes(q) || (u.location||'').toLowerCase().includes(q) || (u.bio||'').toLowerCase().includes(q)));
}
function renderMembers(members) {
  const c = document.getElementById('membersList'), em = document.getElementById('membersEmpty');
  if (!members.length) { c.innerHTML=''; em.classList.remove('hidden'); return; }
  em.classList.add('hidden');
  c.innerHTML = members.map(u =>
    '<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--bg-card)">' +
    '<div style="cursor:pointer;flex-shrink:0" onclick="viewMemberProfile(\'' + u.id + '\')">' +
    (u.avatar_filename ? '<img src="/uploads/' + u.avatar_filename + '" style="width:44px;height:44px;border-radius:50%;object-fit:cover">' : '<div style="width:44px;height:44px;border-radius:50%;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.1rem;color:var(--primary)">' + (u.display_name||'?')[0].toUpperCase() + '</div>') +
    '</div>' +
    '<div style="flex:1;min-width:0;cursor:pointer" onclick="viewMemberProfile(\'' + u.id + '\')">' +
    '<div style="font-weight:600;font-size:0.95rem;color:var(--primary)">' + esc(u.display_name||'Member') +
    (u.is_private ? ' <span style="font-size:0.75rem;color:var(--text-muted);font-weight:normal">🔒 Private</span>' : '') + '</div>' +
    (u.location ? '<div class="text-sm" style="color:var(--text-light)">📍 ' + esc(u.location) + '</div>' : '') +
    (u.bio ? '<div class="text-sm" style="color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(u.bio) + '</div>' : '') +
    '</div>' +
    '<button onclick="navigate(\'messageThread\');loadMessageThread(\'' + u.id + '\')" class="btn btn-sm btn-secondary" style="flex-shrink:0">✉️</button>' +
    '</div>'
  ).join('');
}

async function viewMemberProfile(userId) {
  try {
    const d = await api('/api/profile/' + userId);
    const u = d.user;
    const c = document.getElementById('memberProfileContent');
    if (u.isPrivate) {
      c.innerHTML = '<div class="card" style="text-align:center;padding:40px 20px">' +
        '<div style="font-size:3rem;margin-bottom:12px">🔒</div>' +
        '<h2>' + esc(u.displayName || 'Member') + '</h2>' +
        '<p style="color:var(--text-light);margin-top:8px">This profile is private.</p>' +
        '<button onclick="navigate(\'messageThread\');loadMessageThread(\'' + u.id + '\')" class="btn btn-primary mt-16">✉️ Send Message</button>' +
        '</div>';
    } else {
      c.innerHTML = '<div class="card" style="max-width:500px">' +
        '<div style="display:flex;gap:16px;align-items:center;margin-bottom:16px">' +
        (u.avatar_filename ? '<img src="/uploads/' + u.avatar_filename + '" style="width:80px;height:80px;border-radius:50%;object-fit:cover">' : '<div style="width:80px;height:80px;border-radius:50%;background:var(--primary-light);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:2rem;color:var(--primary)">' + (u.displayName||u.display_name||'?')[0].toUpperCase() + '</div>') +
        '<div><h2 style="margin:0">' + esc(u.displayName || u.display_name || 'Member') + '</h2>' +
        (u.location ? '<div class="text-sm" style="color:var(--text-light);margin-top:4px">📍 ' + esc(u.location) + '</div>' : '') +
        '</div></div>' +
        (u.bio ? '<p style="margin-bottom:12px">' + esc(u.bio) + '</p>' : '') +
        (u.website ? '<p class="text-sm"><a href="' + esc(u.website) + '" target="_blank" style="color:var(--primary)">' + esc(u.website) + '</a></p>' : '') +
        '<div class="text-sm" style="color:var(--text-muted);margin-top:12px">Member since ' + fmtDate(u.created_at) + '</div>' +
        '<button onclick="navigate(\'messageThread\');loadMessageThread(\'' + u.id + '\')" class="btn btn-primary mt-16">✉️ Send Message</button>' +
        '</div>';
    }
    navigate('memberProfile');
  } catch(e) { toast(e.message, 'error'); }
}

// ============ PROFILE - CHANGE PASSWORD ============
async function changePassword(e) {
  e.preventDefault();
  const current = document.getElementById('currentPassword').value;
  const newPwd = document.getElementById('newPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  if (newPwd !== confirm) return toast('Passwords do not match', 'error');
  try {
    await api('/api/auth/password', { method: 'PUT', body: { currentPassword: current, newPassword: newPwd } });
    toast('Password changed successfully!', 'success');
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    closeModal('changePasswordModal');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteAccount() {
  const confirm = document.getElementById('deleteAccountConfirm').value.trim();
  if (confirm !== 'DELETE') { toast('Please type DELETE to confirm', 'error'); return; }
  try {
    await api('/api/account', { method: 'DELETE' });
    closeModal('deleteAccountModal');
    toast('Account deleted. Goodbye! 🏺', 'success');
    logout();
  } catch(e) { toast(e.message, 'error'); }
}

// ============ REFERRAL LINK COPY ============
function copyReferralLink() {
  const input = document.getElementById('refLinkInput');
  if (input) {
    navigator.clipboard.writeText(input.value).then(() => toast('Referral link copied!', 'success')).catch(() => {
      input.select(); document.execCommand('copy'); toast('Referral link copied!', 'success');
    });
  }
}

function copyBlogLink(url, title) {
  const text = title + '\n\nCheck it out: ' + url + '\n\n#pottery #ceramics #potterymudroom #handmade #pottersofinstagram';
  navigator.clipboard.writeText(text).then(() => toast('Link + hashtags copied! Paste into your Instagram/TikTok post or bio 📋', 'success')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    toast('Link + hashtags copied! Paste into your Instagram/TikTok post or bio 📋', 'success');
  });
}

// ============ NEWSLETTER SIGNUP ============
async function subscribeNewsletter(e) {
  e.preventDefault();
  const email = document.getElementById('newsletterEmail').value.trim();
  const btn = document.getElementById('newsletterBtn');
  const msg = document.getElementById('newsletterMsg');
  if (!email) return;
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await fetch('/api/newsletter/subscribe', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ email })
    });
    const d = await res.json();
    if (d.success) {
      msg.textContent = d.message || '🎉 Subscribed!';
      msg.style.color = 'var(--success)';
      msg.style.display = '';
      document.getElementById('newsletterEmail').value = '';
    } else {
      msg.textContent = d.error || 'Something went wrong';
      msg.style.color = 'var(--danger)';
      msg.style.display = '';
    }
  } catch(err) {
    msg.textContent = 'Something went wrong. Try again.';
    msg.style.color = 'var(--danger)';
    msg.style.display = '';
  }
  btn.disabled = false; btn.textContent = 'Subscribe';
}

// ============ BLOG ============
async function loadBlog() {
  try {
    const posts = await api('/api/blog/posts');
    const el = document.getElementById('blogPostsList');
    const em = document.getElementById('blogEmpty');
    if (!posts.length) { el.innerHTML = ''; em.classList.remove('hidden'); return; }
    em.classList.add('hidden');
    el.innerHTML = posts.map(p =>
      '<div class="card" style="cursor:pointer" onclick="viewBlogPost(\'' + esc(p.slug) + '\')">' +
      '<h3 style="margin-bottom:8px;color:var(--primary)">' + esc(p.title) + '</h3>' +
      '<p style="color:var(--text-light);font-size:0.9rem;margin-bottom:8px">' + esc(p.excerpt || '') + '</p>' +
      '<div class="text-sm" style="color:var(--text-muted)">By ' + esc(p.author || 'Christina Workman') + ' · ' + fmtDate(p.published_at) + '</div>' +
      '</div>'
    ).join('');
  } catch(e) { toast(e.message, 'error'); }
}

async function viewBlogPost(slug) {
  try {
    const post = await api('/api/blog/posts/' + slug);
    navigate('blogPost');
    const el = document.getElementById('blogPostContent');
    // Render content - if it contains HTML tags, use as-is; otherwise run through markdown renderer
    const content = post.content || '';
    const isHtml = /<[a-z][\s\S]*>/i.test(content);
    const rendered = isHtml ? content : renderMarkdown(content);
    const postUrl = 'https://thepottersmudroom.com/#blog/' + slug;
    const postTitle = post.title;
    const postExcerpt = post.excerpt || post.title;
    const shareButtons = '<div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border)">' +
      '<p style="color:var(--text-light);margin-bottom:12px;font-weight:600">📤 Share This Post</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
      '<button class="btn btn-sm" onclick="window.open(\'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(postUrl) + '\',\'_blank\',\'width=600,height=400\')" style="background:#1877F2;color:#fff;border:none">📘 Facebook</button>' +
      '<button class="btn btn-sm" onclick="window.open(\'https://pinterest.com/pin/create/button/?url=' + encodeURIComponent(postUrl) + '&description=' + encodeURIComponent(postTitle + ' — ' + postExcerpt) + '&media=' + encodeURIComponent('https://thepottersmudroom.com/og-image.png') + '\',\'_blank\',\'width=600,height=400\')" style="background:#E60023;color:#fff;border:none">📌 Pinterest</button>' +
      '<button class="btn btn-sm" onclick="window.open(\'https://twitter.com/intent/tweet?url=' + encodeURIComponent(postUrl) + '&text=' + encodeURIComponent(postTitle) + '\',\'_blank\',\'width=600,height=400\')" style="background:#000;color:#fff;border:none">𝕏 Post</button>' +
      '<button class="btn btn-sm" onclick="copyBlogLink(\'' + esc(postUrl) + '\',\'' + esc(postTitle) + '\')" style="background:#E1306C;color:#fff;border:none">📋 Copy for Instagram / TikTok</button>' +
      '</div>' +
      '<p class="text-sm" style="color:var(--text-muted);margin-top:8px">Tip: For Instagram & TikTok, copy the link and paste it in your bio or story!</p></div>';
    el.innerHTML = '<article class="card" style="max-width:700px">' +
      '<h1 style="font-size:1.8rem;font-family:Georgia,serif;margin-bottom:12px;color:var(--text)">' + esc(post.title) + '</h1>' +
      '<div class="text-sm" style="color:var(--text-muted);margin-bottom:24px">By ' + esc(post.author || 'Christina Workman') + ' · ' + fmtDate(post.published_at) + '</div>' +
      '<div style="line-height:1.8;color:var(--text);font-size:1rem">' + rendered + '</div>' +
      shareButtons +
      '<div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border);text-align:center">' +
      '<p style="color:var(--text-light);margin-bottom:12px">Ready to start tracking your pottery?</p>' +
      '<button class="btn btn-primary" onclick="navigate(\'dashboard\')">Start Tracking — It\'s Free 🏺</button></div>' +
      '</article>' +
      '<script type="application/ld+json">' + JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": post.title,
        "author": { "@type": "Person", "name": post.author || "Christina Workman" },
        "datePublished": post.published_at,
        "dateModified": post.updated_at || post.published_at,
        "publisher": { "@type": "Organization", "name": "The Potter's Mud Room", "url": "https://thepottersmudroom.com" },
        "mainEntityOfPage": "https://thepottersmudroom.com/#blog/" + post.slug,
        "image": "https://thepottersmudroom.com/og-image.png",
        "description": post.excerpt || post.title
      }) + '<\/script>';
  } catch(e) { toast(e.message, 'error'); }
}

// Simple markdown renderer (bold, italic, headers, newlines, lists)
function renderMarkdown(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 style="margin:20px 0 8px;font-size:1.1rem">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="margin:24px 0 10px;font-size:1.3rem;font-family:Georgia,serif">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="margin:24px 0 12px;font-size:1.5rem;font-family:Georgia,serif">$1</h1>')
    .replace(/^- (.+)$/gm, '<li style="margin-left:20px;margin-bottom:4px">$1</li>')
    .replace(/\n\n/g, '</p><p style="margin-bottom:16px">')
    .replace(/\n/g, '<br>');
}

// Landing page blog posts
async function loadLandingBlogPosts() {
  try {
    const res = await fetch('/api/blog/posts');
    const posts = await res.json();
    const el = document.getElementById('landingBlogPosts');
    if (!el || !posts.length) return;
    el.innerHTML = posts.slice(0, 3).map(p =>
      '<div class="card" style="cursor:pointer" onclick="showBlogPostFromLanding(\'' + esc(p.slug) + '\')">' +
      '<h3 style="margin-bottom:8px;color:var(--primary);font-size:1.05rem">' + esc(p.title) + '</h3>' +
      '<p style="color:var(--text-light);font-size:0.85rem;margin-bottom:8px;line-height:1.5">' + esc((p.excerpt || '').substring(0, 140)) + '...</p>' +
      '<div class="text-sm" style="color:var(--text-muted)">By ' + esc(p.author || 'Christina Workman') + '</div>' +
      '</div>'
    ).join('');
  } catch(e) { /* ignore */ }
}

// Show blog from landing page (before login)
function showBlogFromLanding() {
  document.getElementById('landingPage').style.display = 'none';
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainApp').classList.remove('hidden');
  navigate('blog');
  // If not logged in, just show blog publicly
  if (!token) {
    loadBlog();
  }
}

function showBlogPostFromLanding(slug) {
  document.getElementById('landingPage').style.display = 'none';
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('mainApp').classList.remove('hidden');
  viewBlogPost(slug);
}

// ============ FEATURED POTTER ============
async function loadFeaturedPotter() {
  try {
    const res = await fetch('/api/featured-potter');
    const data = await res.json();
    const section = document.getElementById('featuredPotterSection');
    const card = document.getElementById('featuredPotterCard');
    if (!data || !section || !card) return;
    section.style.display = '';
    const avatar = data.avatar_filename
      ? '<img src="/uploads/' + data.avatar_filename + '" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--primary)">'
      : '<div style="width:80px;height:80px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:2rem;color:#fff">' + ((data.display_name||'?')[0]).toUpperCase() + '</div>';
    card.innerHTML = '<div class="card" style="max-width:500px;margin:0 auto;text-align:center;padding:24px">' +
      '<div style="margin-bottom:16px">' + avatar + '</div>' +
      '<h3 style="color:var(--primary);margin-bottom:8px">' + esc(data.display_name || 'A Potter') + '</h3>' +
      (data.quote ? '<p style="font-style:italic;color:var(--text);margin-bottom:12px;font-size:1.05rem">"' + esc(data.quote) + '"</p>' : '') +
      '<div class="text-sm" style="color:var(--text-light)">' + (data.pieceCount || 0) + ' pieces logged in The Potter\'s Mud Room</div>' +
      '</div>';
  } catch(e) { /* ignore */ }
}

// ============ SHAREABLE COMBOS ============
async function toggleComboPublic(comboId, isPublic) {
  try {
    const d = await api('/api/community/combos/' + comboId + '/public', { method: 'PUT', body: { isPublic } });
    if (d.shareId && isPublic) {
      const link = 'https://thepottersmudroom.com/combo/' + d.shareId;
      toast('Combo is now public! Link: ' + link, 'success');
    } else {
      toast('Combo is now private.', 'success');
    }
    loadCombos();
  } catch(e) { toast(e.message, 'error'); }
}

function copyComboLink(shareId) {
  const link = 'https://thepottersmudroom.com/combo/' + shareId;
  navigator.clipboard.writeText(link).then(() => toast('Share link copied!', 'success')).catch(() => toast('Could not copy', 'error'));
}

async function loadPublicCombo(shareId) {
  try {
    const res = await fetch('/api/combos/public/' + shareId);
    const combo = await res.json();
    if (res.status === 404) { document.getElementById('publicComboContent').innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔒</div><div class="empty-state-title">Combo not found</div><p>This combo may be private or doesn\'t exist.</p></div>'; return; }
    navigate('publicCombo');
    const el = document.getElementById('publicComboContent');
    let html = '<div class="card" style="max-width:600px;margin:0 auto">';
    if (combo.photo_filename) html += '<img src="/uploads/' + combo.photo_filename + '" style="width:100%;max-height:400px;object-fit:cover;border-radius:var(--radius-sm);margin-bottom:16px">';
    html += '<h2 style="color:var(--primary);margin-bottom:8px">' + esc(combo.name) + '</h2>';
    html += '<div class="text-sm" style="color:var(--text-muted);margin-bottom:16px">By ' + esc(combo.author || 'A Potter') + '</div>';
    if (combo.clay_body_name) html += '<div style="margin-bottom:8px"><strong>Clay:</strong> ' + esc(combo.clay_body_name) + '</div>';
    if (combo.cone) html += '<div style="margin-bottom:8px"><strong>Cone:</strong> ' + esc(combo.cone) + '</div>';
    if (combo.atmosphere) html += '<div style="margin-bottom:8px"><strong>Atmosphere:</strong> ' + esc(combo.atmosphere) + '</div>';
    if (combo.layers?.length) {
      html += '<div style="margin:16px 0"><strong>Glaze Layers:</strong>';
      combo.layers.forEach((l, i) => {
        html += '<div style="background:var(--bg-light);padding:8px 12px;border-radius:var(--radius-sm);margin-top:6px">' +
          '<span style="font-weight:600">Layer ' + (i+1) + ':</span> ' + esc(l.glaze_name) +
          (l.brand ? ' (' + esc(l.brand) + ')' : '') +
          ' · ' + (l.coats || 1) + ' coat' + ((l.coats||1) > 1 ? 's' : '') +
          (l.application_method ? ' · ' + esc(l.application_method) : '') + '</div>';
      });
      html += '</div>';
    }
    if (combo.description) html += '<div style="margin-top:12px"><strong>Description:</strong> ' + esc(combo.description) + '</div>';
    if (combo.notes) html += '<div style="margin-top:8px"><strong>Notes:</strong> ' + esc(combo.notes) + '</div>';
    // Share buttons
    const comboUrl = 'https://thepottersmudroom.com/combo/' + shareId;
    const comboTitle = combo.name + ' — Glaze Combo on The Potter\'s Mud Room';
    html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border)">' +
      '<p style="color:var(--text-light);margin-bottom:10px;font-weight:600;font-size:0.9rem">📤 Share This Combo</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">' +
      '<button class="btn btn-sm" onclick="window.open(\'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(comboUrl) + '\',\'_blank\',\'width=600,height=400\')" style="background:#1877F2;color:#fff;border:none">📘 Facebook</button>' +
      '<button class="btn btn-sm" onclick="window.open(\'https://pinterest.com/pin/create/button/?url=' + encodeURIComponent(comboUrl) + '&description=' + encodeURIComponent(comboTitle) + (combo.photo_filename ? '&media=' + encodeURIComponent('https://thepottersmudroom.com/uploads/' + combo.photo_filename) : '') + '\',\'_blank\',\'width=600,height=400\')" style="background:#E60023;color:#fff;border:none">📌 Pinterest</button>' +
      '<button class="btn btn-sm" onclick="window.open(\'https://twitter.com/intent/tweet?url=' + encodeURIComponent(comboUrl) + '&text=' + encodeURIComponent(comboTitle) + '\',\'_blank\',\'width=600,height=400\')" style="background:#000;color:#fff;border:none">𝕏 Post</button>' +
      '<button class="btn btn-sm" onclick="copyBlogLink(\'' + esc(comboUrl) + '\',\'' + esc(combo.name) + '\')" style="background:#E1306C;color:#fff;border:none">📋 Copy for Instagram / TikTok</button>' +
      '</div></div>';
    html += '<div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border);text-align:center">' +
      '<p style="color:var(--text-light);margin-bottom:12px">Track your own glaze combos in The Potter\'s Mud Room</p>' +
      '<button class="btn btn-primary btn-lg" onclick="document.getElementById(\'landingPage\').style.display=\'\';document.getElementById(\'mainApp\').classList.add(\'hidden\')">Join The Potter\'s Mud Room — Free 🏺</button></div>';
    html += '</div>';
    el.innerHTML = html;
  } catch(e) { toast(e.message || 'Error loading combo', 'error'); }
}

// ============ INIT LANDING PAGE FEATURES ============
// Detect referral code from URL on page load
(function() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('ref')) sessionStorage.setItem('referral_code', p.get('ref'));
  // Detect /combo/SHAREID route
  const path = window.location.pathname;
  if (path.startsWith('/combo/')) {
    const shareId = path.replace('/combo/', '');
    if (shareId) {
      document.getElementById('landingPage').style.display = 'none';
      document.getElementById('mainApp').classList.remove('hidden');
      loadPublicCombo(shareId);
    }
  }
  // Detect #blog hash
  if (window.location.hash === '#blog') {
    showBlogFromLanding();
  }
})();

// Load landing page features
loadLandingBlogPosts();
loadFeaturedPotter();

checkAuth();
