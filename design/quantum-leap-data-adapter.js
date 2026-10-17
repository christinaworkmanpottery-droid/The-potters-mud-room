/* Quantum Leap read-only data adapter, isolated design branch.
   No production wiring. Caller supplies authenticated fetch function and token;
   never hardcode credentials, never cache private records. */
(function(root){
  'use strict';
  function normalizePieces(rows) {
    if (!Array.isArray(rows)) throw new TypeError('Expected pieces array');
    return rows.map(p => ({
      id: p.id,
      title: String(p.name || p.title || p.piece_name || 'Untitled piece'),
      status: String(p.status || 'Unspecified'),
      clay: String(p.clay_body_name || p.clay_body || p.clay_name || ''),
      glaze: String(p.glaze || p.glaze_name || ''),
      photoUrl: typeof p.photo_url === 'string' && p.photo_url.startsWith('/') ? p.photo_url : null
    }));
  }
  function normalizeMaterials(rows) {
    if (!Array.isArray(rows)) throw new TypeError('Expected raw materials array');
    return rows.map(m => ({
      id: m.id,
      name: String(m.name || 'Unnamed material'),
      category: String(m.category || m.type || 'Chemical'),
      inStock: m.in_stock === true || m.in_stock === 1,
      // Do not fabricate quantities when API only provides boolean stock status.
      quantity: Number.isFinite(m.quantity) ? m.quantity : null,
      unit: typeof m.unit === 'string' ? m.unit : ''
    }));
  }
  async function loadStudioData({fetchImpl,token,signal}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl required');
    if (typeof token !== 'string' || !token) throw new Error('Authenticated session required');
    async function read(path) {
      const response = await fetchImpl(path,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal,credentials:'same-origin'});
      if (!response.ok) throw new Error('Studio request failed ('+response.status+')');
      return response.json();
    }
    const [pieces,materials]=await Promise.all([read('/api/pieces?excludeCasualties=1'),read('/api/glaze-chemicals')]);
    return {pieces:normalizePieces(pieces),materials:normalizeMaterials(materials)};
  }
  root.QuantumLeapData={normalizePieces,normalizeMaterials,loadStudioData};
})(typeof globalThis!=='undefined'?globalThis:this);
