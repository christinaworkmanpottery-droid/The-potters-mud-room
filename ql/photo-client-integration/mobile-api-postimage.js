import AsyncStorage from './storage';
import { Platform } from 'react-native';
import { API_BASE_URL, ENDPOINTS } from '../constants/api';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'user_data';

/**
 * Core API request helper. Attaches auth token automatically.
 * Handles token expiry by clearing stored credentials.
 */
/**
 * Build the correct "photo" entry for a FormData upload.
 * Native (iOS/Android): RN's fetch accepts the {uri, name, type} shorthand.
 * Web: FormData needs a real Blob/File — fetch the local blob: URI and
 * convert it, otherwise the browser silently sends an empty/invalid field
 * and the photo never actually uploads.
 */
export const appendPhotoToFormData = async (formData, imageUri) => {
  const filename = imageUri.split('/').pop().split('?')[0] || 'photo.jpg';
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `image/${match[1]}` : 'image/jpeg';

  if (Platform.OS === 'web') {
    const response = await fetch(imageUri);
    const blob = await response.blob();
    formData.append('photo', blob, filename);
  } else {
    formData.append('photo', {
      uri: Platform.OS === 'android' ? imageUri : imageUri.replace('file://', ''),
      name: filename,
      type,
    });
  }
};

// Replace an existing uploaded image. Legacy HEIC records may return a new JPEG filename.
export const replaceStoredPhoto = async (filename, imageUri) => {
  if (!filename || !imageUri) throw new Error('Photo filename and edited image are required.');
  const formData = new FormData();
  await appendPhotoToFormData(formData, imageUri);
  return apiRequest(`/api/photos/by-filename/${encodeURIComponent(filename)}`, {
    method: 'PUT',
    body: formData,
  });
};

// Helper for appending multiple photos with a custom field name
export const appendPhotosToFormData = async (formData, photos, fieldName = 'photos') => {
  if (Platform.OS === 'web') {
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      const ext = (photo.uri.split('.').pop() || 'jpg').toLowerCase();
      const filename = `${fieldName}_${i}.${ext}`;
      const response = await fetch(photo.uri);
      const blob = await response.blob();
      formData.append(fieldName, blob, filename);
    }
  } else {
    photos.forEach((photo, i) => {
      const ext = (photo.uri.split('.').pop() || 'jpg').toLowerCase();
      const mimeType = `image/${ext}`;
      formData.append(fieldName, { uri: photo.uri, name: `${fieldName}_${i}.${ext}`, type: mimeType });
    });
  }
};

export const profileSessionGuard = () => {
  const { getPrivatePieceMediaSession } = require('./pieceMedia');
  const generation = getPrivatePieceMediaSession().generation;
  return () => {
    if (generation !== getPrivatePieceMediaSession().generation) throw Object.assign(new Error('Profile request is no longer current.'), { code: 'STALE_PROFILE_REQUEST' });
  };
};
export const uploadProfileAvatar = async uri => {
  const validateSession = profileSessionGuard();
  const body = new FormData();
  await appendPhotoToFormData(body, uri);
  validateSession();
  return apiRequest('/api/profile/photo', { method: 'POST', body, validateSession });
};

export const apiRequest = async (endpoint, options = {}) => {
  const { timeoutMs: requestedTimeoutMs, responseType, includeResponseHeaders, validateSession: suppliedGuard, ...fetchOptions } = options;
  const validateSession = suppliedGuard || ((/^\/api\/(?:profile|user\/profile|users|forum)(?:[/?]|$)/.test(endpoint) || /test-tiles|photos\/by-filename|bulk-delete/.test(endpoint)) ? profileSessionGuard() : undefined);
  validateSession?.();
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  const tileSession = /test-tiles|photos\/by-filename|bulk-delete/.test(endpoint) ? require('./pieceMedia').getPrivatePieceMediaSession() : null;
  validateSession?.();

  const headers = {
    ...(fetchOptions.headers || {}),
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  const isFormData = fetchOptions.body && typeof fetchOptions.body !== 'string';
  // Only set Content-Type to JSON if body is a string (not FormData)
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const callerSignal = fetchOptions.signal;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  // Give multipart uploads more time, with an endpoint-specific override for
  // workflows that send several full-size photos in one request.
  const timeoutMs = requestedTimeoutMs || (isFormData ? 60000 : 15000);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...fetchOptions,
    headers,
    signal: controller.signal,
  }).catch(err => {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', abortFromCaller);
    if (callerSignal?.aborted) throw Object.assign(new Error('Request cancelled.'), { name: 'AbortError' });
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. The server may be waking up — please try again in a moment.');
    }
    throw new Error('Network error. Please check your connection and try again.');
  });
  clearTimeout(timeoutId);
  callerSignal?.removeEventListener('abort', abortFromCaller);

  validateSession?.();
  // Handle token expiry
  if (response.status === 401) {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(USER_KEY);
    const err = new Error('Session expired. Please sign in again.');
    err.status = 401;
    throw err;
  }

  // For 204 No Content (e.g. DELETE)
  if (response.status === 204) {
    return null;
  }

  // Safely parse JSON — handle cases where server returns HTML (e.g. cold start, 503)
  const contentType = response.headers.get('content-type') || '';
  if (responseType === 'text' && response.ok) {
    if (!/text\/(csv|calendar)|application\/(csv|octet-stream)/i.test(contentType)) {
      throw new Error('The server did not return an export. Please try again.');
    }
    return response.text();
  }
  let data;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    if (text.startsWith('{') || text.startsWith('[')) {
      try { data = JSON.parse(text); } catch {
        throw new Error('The server returned an unexpected response. Please try again in a moment.');
      }
    } else {
      // Server returned HTML or non-JSON (likely cold start or temporary error)
      throw new Error('The server is waking up — please try again in a few seconds.');
    }
  }

  validateSession?.();
  if (!response.ok) {
    const err = new Error(data.message || data.error || 'Something went wrong');
    err.status = response.status;
    err.code = data.code;
    if (response.status === 403 && data.code === 'TEST_TILE_ENTITLEMENT_REQUIRED' && tileSession && tileSession.generation === require('./pieceMedia').getPrivatePieceMediaSession().generation) require('./testTileAccess').invalidateTestTileAccess();
    throw err;
  }

  return includeResponseHeaders ? { data, headers: response.headers } : data;
};

// ─── Auth ────────────────────────────────────────────────────────────────────

export const login = async (email, password) => {
  const data = await apiRequest(ENDPOINTS.login, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (data.token) {
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user || data));
  }

  return data;
};

export const register = async (name, email, password, signupSource = 'mobile_app', newsletterSubscribed = true) => {
  const data = await apiRequest(ENDPOINTS.register, {
    method: 'POST',
    body: JSON.stringify({ displayName: name, email, password, signupSource, newsletterSubscribed }),
  });

  if (data.token) {
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user || data));
  }

  return data;
};

export const logout = async () => {
  await AsyncStorage.removeItem(TOKEN_KEY);
  await AsyncStorage.removeItem(USER_KEY);
};

export const getStoredUser = async () => {
  const userData = await AsyncStorage.getItem(USER_KEY);
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (userData && token) {
    return JSON.parse(userData);
  }
  return null;
};

export const getToken = async () => {
  return await AsyncStorage.getItem(TOKEN_KEY);
};

// ─── Pieces ──────────────────────────────────────────────────────────────────

export const getPieces = async () => {
  const data = await apiRequest(ENDPOINTS.pieces);
  return Array.isArray(data) ? data : data.pieces || [];
};

export const getPieceById = async (id, options = {}) => {
  return await apiRequest(`${ENDPOINTS.pieces}/${id}`, options);
};

// Map app field names to backend field names
const mapPieceFields = (pieceData) => {
  const statusMap = {
    'In Progress': 'in-progress',
    'Bisque Fired': 'bisque-fired',
    'Glazed': 'glazed',
    'Final Fired': 'glaze-fired',
    'Complete': 'done',
  };
  // Build notes: user notes + firing temp combined (server parses them back out)
  const noteParts = [];
  const userNotes = (pieceData.notes || pieceData.description || '').trim();
  if (userNotes) noteParts.push(userNotes);
  if (pieceData.firingTemp) noteParts.push(`Firing temp: ${pieceData.firingTemp}`);
  const combinedNotes = noteParts.length ? noteParts.join(' | ') : undefined;

  return {
    title: pieceData.name || pieceData.title,
    ...Object.fromEntries(['form', 'technique', 'dateStarted', 'dateCompleted', 'dateSold'].filter(key => pieceData[key] !== undefined).map(key => [key, pieceData[key] || null])),
    description: userNotes || undefined,
    status: statusMap[pieceData.status] || pieceData.status || 'in-progress',
    notes: combinedNotes,
    firingTemp: pieceData.firingTemp || undefined,
    ...require('./pieceEditor').pieceRelationshipFields(pieceData),
    ...(pieceData.materialCost !== undefined && { materialCost: pieceData.materialCost }),
    ...(pieceData.firingCost !== undefined && { firingCost: pieceData.firingCost }),
    ...(pieceData.laborHours !== undefined && { laborHours: pieceData.laborHours }),
    ...(pieceData.laborRate !== undefined && { laborRate: pieceData.laborRate }),
    ...(pieceData.salePrice !== undefined && { salePrice: pieceData.salePrice }),
    ...(pieceData.dimensions !== undefined && { dimensions: pieceData.dimensions }),
    ...(pieceData.weight !== undefined && { weight: pieceData.weight }),
  };
};

export const createPiece = async (pieceData, imageUri) => {
  const mappedData = mapPieceFields(pieceData);
  Object.keys(mappedData).forEach(k => mappedData[k] === undefined && delete mappedData[k]);

  const piece = await apiRequest(ENDPOINTS.pieces, {
    method: 'POST',
    body: JSON.stringify(mappedData),
  });

  let photoUploadSucceeded = !imageUri;

  if (imageUri && piece?.id) {
    try {
      const formData = new FormData();
      await appendPhotoToFormData(formData, imageUri);
      await apiRequest(`${ENDPOINTS.pieces}/${piece.id}/photos`, {
        method: 'POST',
        body: formData,
      });
      photoUploadSucceeded = true;
    } catch (photoErr) {
      console.warn('Photo upload failed:', photoErr.message);
      photoUploadSucceeded = false;
    }
  }

  return { ...piece, photoUploadSucceeded };
};

export const updatePiece = async (id, pieceData, imageUri) => {
  // Map fields and update piece data
  const mappedData = mapPieceFields(pieceData);
  Object.keys(mappedData).forEach(k => mappedData[k] === undefined && delete mappedData[k]);

  await apiRequest(`${ENDPOINTS.pieces}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(mappedData),
  });

  // Upload new photo if provided (and not an existing URL)
  if (imageUri && !imageUri.startsWith('http')) {
    try {
      const formData = new FormData();
      await appendPhotoToFormData(formData, imageUri);
      await apiRequest(`${ENDPOINTS.pieces}/${id}/photos`, {
        method: 'POST',
        body: formData,
      });
    } catch (photoErr) {
      console.warn('Photo upload failed:', photoErr.message);
    }
  }

  return { success: true };
};

export const deletePiece = async (id) => {
  return await apiRequest(`${ENDPOINTS.pieces}/${id}`, {
    method: 'DELETE',
  });
};

// ─── Piece Photos ────────────────────────────────────────────────────────────

export const addPhotoToPiece = async (pieceId, imageUri, stage = 'other') => {
  const formData = new FormData();
  await appendPhotoToFormData(formData, imageUri);
  if (stage) formData.append('stage', stage);
  return await apiRequest(`${ENDPOINTS.pieces}/${pieceId}/photos`, {
    method: 'POST',
    body: formData,
  });
};

export const deletePhoto = async (photoId) => {
  return await apiRequest(`/api/photos/${photoId}`, {
    method: 'DELETE',
  });
};

export const rotatePhoto = async (photoId, clockwise = true) => {
  return await apiRequest(`/api/photos/${photoId}/rotate`, {
    method: 'PUT',
    body: JSON.stringify({ clockwise }),
  });
};

// ─── Photo Search ────────────────────────────────────────────────────────────

export const searchByPhoto = async (imageUri, { signal, mimeType } = {}) => {
  const sessionGuard = profileSessionGuard();
  const validateSession = () => {
    sessionGuard();
    if (signal?.aborted) throw Object.assign(new Error('Photo query replaced.'), { name: 'AbortError' });
  };
  validateSession();
  const formData = new FormData();
  const filename = imageUri.split(/[?#]/)[0].split('/').pop() || 'search.jpg';
  const match = /\.(\w+)$/.exec(filename);
  const suppliedType = mimeType || (match ? `image/${match[1].toLowerCase()}` : 'image/jpeg');
  const type = /^image\/jpe?g$/i.test(suppliedType) ? 'image/jpeg' : suppliedType;
  if (Platform.OS === 'web') {
    // On web, convert blob URI to actual File object for FormData
    const response = await fetch(imageUri, { signal });
    const blob = await response.blob();
    formData.append('photo', blob, filename);
  } else {
    formData.append('photo', {
      uri: Platform.OS === 'android' ? imageUri : imageUri.replace('file://', ''),
      name: filename,
      type,
    });
  }
  return await apiRequest(ENDPOINTS.photoSearch, {
    signal,
    validateSession,
    method: 'POST',
    body: formData,
  });
};

// ─── Forum ───────────────────────────────────────────────────────────────────

export const getForumPosts = async () => {
  const data = await apiRequest(ENDPOINTS.forumPosts);
  return Array.isArray(data) ? data : data.posts || [];
};

export const getForumPostById = async (id) => {
  return await apiRequest(`${ENDPOINTS.forumPosts}/${id}`);
};

export const createForumPost = async (postData, photos = []) => {
  const validateSession = profileSessionGuard();

  // Backend expects 'body' not 'content'
  if (photos && photos.length > 0) {
    const formData = new FormData();
    formData.append('title', postData.title || '');
    formData.append('body', postData.body || postData.content || '');
    if (postData.categoryId) formData.append('categoryId', postData.categoryId);
    await appendPhotosToFormData(formData, photos, 'photos');
    return await apiRequest(ENDPOINTS.forumPosts, {
      validateSession,
      method: 'POST',
      body: formData,
      timeout: 60000,
    });
  }
  const payload = { ...postData };
  if (payload.content && !payload.body) {
    payload.body = payload.content;
    delete payload.content;
  }
  return await apiRequest(ENDPOINTS.forumPosts, {
    validateSession,
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const getForumCategories = async () => {
  const data = await apiRequest('/api/forum/categories');
  return Array.isArray(data) ? data : [];
};

export const replyToPost = async (postId, content, photo = null) => {
  const validateSession = profileSessionGuard();

  if (photo) {
    const formData = new FormData();
    formData.append('body', content);
    await appendPhotosToFormData(formData, [photo], 'photos');
    return await apiRequest(`${ENDPOINTS.forumPosts}/${postId}/reply`, {
      validateSession,
      method: 'POST',
      body: formData,
      timeout: 120000,
    });
  }
  return await apiRequest(`${ENDPOINTS.forumPosts}/${postId}/reply`, {
    validateSession,
    method: 'POST',
    body: JSON.stringify({ content, body: content }),
  });
};

export const updateForumPost = async (postId, postData, photos = []) => {
  const validateSession = profileSessionGuard();

  if (photos && photos.length > 0) {
    const formData = new FormData();
    formData.append('title', postData.title || '');
    formData.append('content', postData.content || postData.body || '');
    if (postData.categoryId) formData.append('categoryId', postData.categoryId);
    await appendPhotosToFormData(formData, photos, 'photos');
    return await apiRequest(`${ENDPOINTS.forumPosts}/${postId}`, {
      validateSession,
      method: 'PUT',
      body: formData,
      timeout: 120000,
    });
  }
  return await apiRequest(`${ENDPOINTS.forumPosts}/${postId}`, {
    validateSession,
    method: 'PUT',
    body: JSON.stringify(postData),
  });
};

export const deleteForumPost = async (postId) => {
  return await apiRequest(`${ENDPOINTS.forumPosts}/${postId}`, {
    method: 'DELETE',
  });
};

export const updateForumReply = async (replyId, content) => {
  return await apiRequest(`${ENDPOINTS.forumReplies}/${replyId}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
};

export const deleteForumReply = async (replyId) => {
  return await apiRequest(`${ENDPOINTS.forumReplies}/${replyId}`, {
    method: 'DELETE',
  });
};

// ─── Messages ────────────────────────────────────────────────────────────────

export const getConversations = async () => {
  const data = await apiRequest(ENDPOINTS.messages);
  return Array.isArray(data) ? data : data.conversations || [];
};

export const getMessagesWithUser = async (userId) => {
  const data = await apiRequest(`${ENDPOINTS.messages}/${userId}`);
  return Array.isArray(data) ? data : data.messages || [];
};

export const sendMessage = async (userId, content) => {
  return await apiRequest(`${ENDPOINTS.messages}/${userId}`, {
    method: 'POST',
    body: JSON.stringify({ body: content }),
  });
};

// ─── Members ─────────────────────────────────────────────────────────────────

export const getMembers = async () => {
  const data = await apiRequest(ENDPOINTS.communityMembers);
  return Array.isArray(data) ? data : data.members || data.users || [];
};

// ─── Profile ─────────────────────────────────────────────────────────────────

export const getProfile = async () => {
  const data = await apiRequest(ENDPOINTS.profile);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user || data));
  return data.user || data;
};

export const updateProfile = async (profileData) => {
  const data = await apiRequest('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(profileData),
  });
  const updated = data.user || data;
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(updated));
  return updated;
};

// ─── Materials Library ───────────────────────────────────────────────────────

export const getGlazes = async () => {
  const data = await apiRequest(ENDPOINTS.glazes);
  return Array.isArray(data) ? data : data.glazes || [];
};

export const createGlaze = async (glazeData) => apiRequest(ENDPOINTS.glazes, { method: 'POST', body: JSON.stringify(glazeData) });
export const updateGlaze = async (id, glazeData) => apiRequest(`${ENDPOINTS.glazes}/${id}`, { method: 'PUT', body: JSON.stringify(glazeData) });
export const deleteGlaze = async (id) => apiRequest(`${ENDPOINTS.glazes}/${id}`, { method: 'DELETE' });
export const addGlazePhoto = async (glazeId, imageUri, replacePhotoId = null) => {
  const formData = new FormData();
  await appendPhotoToFormData(formData, imageUri);
  if (replacePhotoId) formData.append('replacePhotoId', replacePhotoId);
  return apiRequest(`${ENDPOINTS.glazes}/${glazeId}/photos`, { method: 'POST', body: formData, timeoutMs: 60000 });
};
export const reorderGlazePhotos = async (glazeId, photoIds) => apiRequest(`${ENDPOINTS.glazes}/${glazeId}/photos/reorder`, { method: 'PUT', body: JSON.stringify({ photoIds }) });

export const getClays = async () => {
  const data = await apiRequest(ENDPOINTS.clays);
  return Array.isArray(data) ? data : data.clays || [];
};

// ─── Firing Logs ─────────────────────────────────────────────────────────────

export const getFiringLogs = async (sort) => {
  const query = sort ? `?sort=${sort}` : '';
  const data = await apiRequest(`${ENDPOINTS.firingLogs}${query}`);
  return Array.isArray(data) ? data : data.firingLogs || data.logs || [];
};

export const getFiringLogById = async (id) => {
  return await apiRequest(`${ENDPOINTS.firingLogs}/${id}`);
};

export const createFiringLog = async (logData) => {
  return await apiRequest(ENDPOINTS.firingLogs, {
    method: 'POST',
    body: JSON.stringify(logData),
  });
};

export const updateFiringLog = async (id, logData, validateSession) => {
  return await apiRequest(`${ENDPOINTS.firingLogs}/${id}`, {
    validateSession,
    method: 'PUT',
    body: JSON.stringify(logData),
  });
};

export const deleteFiringLog = async (id) => {
  return await apiRequest(`${ENDPOINTS.firingLogs}/${id}`, {
    method: 'DELETE',
  });
};

export const deleteFiringPhoto = async (photoId, validateSession) => apiRequest(`${ENDPOINTS.firingPhotos}/${photoId}`, { method: 'DELETE', validateSession });

export const uploadFiringPhoto = async (logId, imageUri, replacePhotoId = null, validateSession) => {
  const formData = new FormData();
  await appendPhotoToFormData(formData, imageUri);
  // Backend expects field 'photos' (upload.array), so rename after append
  // appendPhotoToFormData uses 'photo' — re-append with correct field name
  // Actually build separately to use correct field name 'photos'
  const formData2 = new FormData();
  const filename = imageUri.split('/').pop().split('?')[0] || 'photo.jpg';
  const match = /\.([\w]+)$/.exec(filename);
  const type = match ? `image/${match[1]}` : 'image/jpeg';
  if (Platform.OS === 'web') {
    const response = await fetch(imageUri);
    const blob = await response.blob();
    formData2.append('photos', blob, filename);
  } else {
    formData2.append('photos', {
      uri: Platform.OS === 'android' ? imageUri : imageUri.replace('file://', ''),
      name: filename,
      type,
    });
  }
  if (replacePhotoId) formData2.append('replacePhotoId', replacePhotoId);
  const result = await apiRequest(`${ENDPOINTS.firingLogs}/${logId}/photos`, {
    validateSession,
    method: 'POST',
    body: formData2,
  });
  return Array.isArray(result) ? result[0] : result;
};

// ─── Clay Bodies ─────────────────────────────────────────────────────────────

export const getClayBodies = async () => {
  const data = await apiRequest(ENDPOINTS.clayBodies);
  return Array.isArray(data) ? data : data.clayBodies || data.clays || [];
};

export const getClayBodyById = async (id) => {
  return await apiRequest(`${ENDPOINTS.clayBodies}/${id}`);
};

export const createClayBody = async (clayData) => {
  return await apiRequest(ENDPOINTS.clayBodies, {
    method: 'POST',
    body: JSON.stringify(clayData),
  });
};

export const updateClayBody = async (id, clayData) => {
  return await apiRequest(`${ENDPOINTS.clayBodies}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(clayData),
  });
};

export const deleteClayBody = async (id) => {
  return await apiRequest(`${ENDPOINTS.clayBodies}/${id}`, {
    method: 'DELETE',
  });
};

export const addClayBodyPhoto = async (clayId, imageUri, label, replace = false, replacePhotoId = null) => {
  const formData = new FormData();
  await appendPhotoToFormData(formData, imageUri);
  if (label) formData.append('label', label);
  if (replace) formData.append('replace', 'true');
  if (replacePhotoId) formData.append('replacePhotoId', replacePhotoId);
  return await apiRequest(`${ENDPOINTS.clayBodies}/${clayId}/photos`, {
    method: 'POST',
    body: formData,
  });
};

export const deleteClayPhoto = async (photoId) => {
  return await apiRequest(`${ENDPOINTS.clayPhotos}/${photoId}`, { method: 'DELETE' });
};

// Capture Pricing identity before async photo preparation or token reads.
const pricingSessionGuard = () => {
  const { getPrivatePieceMediaSession } = require('./pieceMedia');
  const generation = getPrivatePieceMediaSession().generation;
  return () => {
    if (generation !== getPrivatePieceMediaSession().generation) throw Object.assign(new Error('Pricing request is no longer current.'), { code: 'STALE_PRICING_REQUEST' });
  };
};
// ─── Pricing Calculator ──────────────────────────────────────────────────────

export const getPricingCalculations = async () => {
  const data = await apiRequest(ENDPOINTS.pricingCalculations, { validateSession: pricingSessionGuard() });
  return Array.isArray(data) ? data : data.calculations || [];
};

export const getPricingCalculation = async (id) => {
  return await apiRequest(`${ENDPOINTS.pricingCalculations}/${id}`, { validateSession: pricingSessionGuard() });
};

export const createPricingCalculation = async ({ name, description, inputs, result, photoUri }) => {
  const validateSession = pricingSessionGuard();
  const formData = new FormData();
  formData.append('name', name || '');
  formData.append('description', description || '');
  formData.append('inputs', JSON.stringify(inputs));
  formData.append('result', JSON.stringify(result));
  if (photoUri) await appendPhotoToFormData(formData, photoUri);
  return await apiRequest(ENDPOINTS.pricingCalculations, {
    validateSession,
    method: 'POST',
    body: formData,
    timeoutMs: 60000,
  });
};

export const updatePricingCalculation = async (id, { name, description, inputs, result, photoUri }) => {
  const validateSession = pricingSessionGuard();
  const formData = new FormData();
  formData.append('name', name || '');
  formData.append('description', description || '');
  formData.append('inputs', JSON.stringify(inputs));
  formData.append('result', JSON.stringify(result));
  if (photoUri) await appendPhotoToFormData(formData, photoUri);
  return await apiRequest(`${ENDPOINTS.pricingCalculations}/${id}`, {
    validateSession,
    method: 'PUT',
    body: formData,
    timeoutMs: 60000,
  });
};

export const deletePricingCalculation = async (id) => {
  return await apiRequest(`${ENDPOINTS.pricingCalculations}/${id}`, { method: 'DELETE', validateSession: pricingSessionGuard() });
};

// ─── Sales ───────────────────────────────────────────────────────────────────
export const saleSessionGuard = () => {
  const { getPrivatePieceMediaSession } = require('./pieceMedia');
  const generation = getPrivatePieceMediaSession().generation;
  return () => {
    if (generation !== getPrivatePieceMediaSession().generation) throw Object.assign(new Error('Sale request is no longer current.'), { code: 'STALE_SALE_REQUEST' });
  };
};
export const getSalePieces = async () => {
  const data = await apiRequest(ENDPOINTS.pieces, { validateSession: saleSessionGuard() });
  return Array.isArray(data) ? data : data.pieces || [];
};
export const getSales = async () => {
  const data = await apiRequest(ENDPOINTS.sales, { validateSession: saleSessionGuard() });
  return Array.isArray(data) ? data : data.sales || [];
};
export const createSalesBulk = async (salesData) => apiRequest(`${ENDPOINTS.sales}/bulk`, {
  method: 'POST', body: JSON.stringify(salesData), validateSession: saleSessionGuard(),
});
// Metadata and optional replacement image commit together in saveSaleRecord.
const saveSale = async (id, saleData, photoUri) => {
  const validateSession = saleSessionGuard();
  let body = JSON.stringify(saleData);
  if (photoUri) {
    body = new FormData();
    for (const [key, value] of Object.entries(saleData)) if (value !== undefined) body.append(key, value ?? '');
    await appendPhotoToFormData(body, photoUri);
  }
  return apiRequest(id ? `${ENDPOINTS.sales}/${id}` : ENDPOINTS.sales, {
    method: id ? 'PUT' : 'POST', body, validateSession, timeoutMs: 60000,
  });
};
export const createSale = (saleData, photoUri) => saveSale(null, saleData, photoUri);
export const updateSale = (id, saleData, photoUri) => saveSale(id, saleData, photoUri);
export const deleteSale = (id) => apiRequest(`${ENDPOINTS.sales}/${id}`, { method: 'DELETE', validateSession: saleSessionGuard() });

// ─── Community Combos ────────────────────────────────────────────────────────

export const getCommunityCombos = async (filter, { search, cone, atmosphere, clay, sort, type } = {}) => {
  const params = new URLSearchParams();
  if (filter) params.append('filter', filter);
  if (search) params.append('search', search);
  if (cone) params.append('cone', cone);
  if (atmosphere) params.append('atmosphere', atmosphere);
  if (clay) params.append('clay', clay);
  if (sort) params.append('sort', sort);
  if (type) params.append('type', type);
  const query = params.toString() ? `?${params.toString()}` : '';
  const data = await apiRequest(`${ENDPOINTS.communityCombos}${query}`);
  return Array.isArray(data) ? data : data.combos || [];
};

export const getCommunityComboById = async (id) => {
  return await apiRequest(`${ENDPOINTS.communityCombos}/${id}`);
};

export const createCommunityCombo = async (formData, layers, photos = []) => {
  const fd = new FormData();
  fd.append('name', formData.name || '');
  fd.append('clayBodyName', formData.clayBodyName || '');
  fd.append('cone', formData.cone || '');
  fd.append('atmosphere', formData.atmosphere || '');
  fd.append('description', formData.description || '');
  fd.append('notes', formData.notes || '');
  fd.append('isShared', formData.isShared ? 'true' : 'false');
  fd.append('layers', JSON.stringify(layers));
  const photoSlots = [];
  for (const photo of photos) {
    const uploadIndex = photoSlots.length;
    photoSlots.push(uploadIndex);
    await appendPhotosToFormData(fd, [photo], 'photos');
  }
  fd.append('photoSlots', JSON.stringify([photoSlots[0] ?? null, photoSlots[1] ?? null]));
  return await apiRequest(ENDPOINTS.communityCombos, {
    method: 'POST',
    body: fd,
    timeout: 60000,
  });
};

export const updateCommunityCombo = async (id, formData, layers, photos = []) => {
  const fd = new FormData();
  fd.append('name', formData.name || '');
  fd.append('clayBodyName', formData.clayBodyName || '');
  fd.append('cone', formData.cone || '');
  fd.append('atmosphere', formData.atmosphere || '');
  fd.append('description', formData.description || '');
  fd.append('notes', formData.notes || '');
  fd.append('isShared', formData.isShared ? 'true' : 'false');
  fd.append('layers', JSON.stringify(layers));
  const newPhotos = photos.filter(photo => !photo.existing);
  for (const photo of newPhotos) await appendPhotosToFormData(fd, [photo], 'photos');
  const slots = photos.slice(0, 2).map(photo => photo.existing ? photo.filename : newPhotos.indexOf(photo));
  while (slots.length < 2) slots.push(null);
  fd.append('photoSlots', JSON.stringify(slots));
  return await apiRequest(`${ENDPOINTS.communityCombos}/${id}`, {
    method: 'PUT',
    body: fd,
    timeout: 60000,
  });
};

export const deleteCommunityCombo = async (id) => {
  return await apiRequest(`${ENDPOINTS.communityCombos}/${id}`, {
    method: 'DELETE',
  });
};

export const getCommunityComments = async (comboId) => {
  return await apiRequest(`${ENDPOINTS.communityCombos}/${comboId}/comments`);
};

export const getCommunityMembers = async () => {
  const data = await apiRequest(ENDPOINTS.communityMembers);
  return Array.isArray(data) ? data : data.members || [];
};

// ─── Shopping List ───────────────────────────────────────────────────────────

export const getShoppingList = async () => {
  const data = await apiRequest(ENDPOINTS.shoppingList);
  return Array.isArray(data) ? data : data.items || [];
};

export const addShoppingListItem = async (itemData) => {
  return await apiRequest(ENDPOINTS.shoppingList, {
    method: 'POST',
    body: JSON.stringify(itemData),
  });
};

export const toggleShoppingListItem = async (itemId) => {
  return await apiRequest(`${ENDPOINTS.shoppingList}/${itemId}/toggle`, {
    method: 'PATCH',
  });
};

export const deleteShoppingListItem = async (itemId) => {
  return await apiRequest(`${ENDPOINTS.shoppingList}/${itemId}`, {
    method: 'DELETE',
  });
};

// ─── Shop ────────────────────────────────────────────────────────────────────

export const getShopProducts = async () => {
  const data = await apiRequest(ENDPOINTS.shopProducts);
  return Array.isArray(data) ? data : data.products || [];
};

export const shopCheckout = async (checkoutData) => {
  return await apiRequest(ENDPOINTS.shopCheckout, {
    method: 'POST',
    body: JSON.stringify(checkoutData),
  });
};

// ─── Casualties ──────────────────────────────────────────────────────────────

export const getCasualties = async () => {
  const data = await apiRequest(ENDPOINTS.casualties);
  return Array.isArray(data) ? data : data.casualties || [];
};

export const createCasualty = async (casualtyData, photo) => {
  // Casualties are pieces with status broken/recycled — create via pieces endpoint
  const formData = new FormData();
  formData.append('title', casualtyData.title || 'Casualty');
  formData.append('status', casualtyData.stage === 'recycled' ? 'recycled' : 'broken');
  formData.append('casualtyType', casualtyData.casualtyTypes ? casualtyData.casualtyTypes.join(',') : (casualtyData.casualtyType || ''));
  formData.append('casualtyNotes', casualtyData.casualtyNotes || '');
  formData.append('casualtyLesson', casualtyData.casualtyLesson || '');
  formData.append('notes', casualtyData.notes || '');
  if (casualtyData.clayBodyId) formData.append('clayBodyId', casualtyData.clayBodyId);
  else if (casualtyData.clay) formData.append('clay', casualtyData.clay);
  if (casualtyData.glaze) formData.append('glaze', casualtyData.glaze);
  if (casualtyData.glazeIds !== undefined) formData.append('glazeIds', JSON.stringify(casualtyData.glazeIds));
  if (casualtyData.form) formData.append('form', casualtyData.form);
  if (photo?.uri) {
    await appendPhotoToFormData(formData, photo.uri);
  }
  return await apiRequest(ENDPOINTS.pieces, {
    method: 'POST',
    body: formData,
    timeout: 60000,
  });
};

export const updateCasualty = async (id, casualtyData, photo) => {
  const formData = new FormData();
  formData.append('title', casualtyData.title || 'Casualty');
  formData.append('status', casualtyData.stage === 'recycled' ? 'recycled' : 'broken');
  formData.append('casualtyType', casualtyData.casualtyTypes ? casualtyData.casualtyTypes.join(',') : (casualtyData.casualtyType || ''));
  formData.append('casualtyNotes', casualtyData.casualtyNotes || '');
  formData.append('casualtyLesson', casualtyData.casualtyLesson || '');
  formData.append('notes', casualtyData.notes || '');
  if (casualtyData.clayBodyId) formData.append('clayBodyId', casualtyData.clayBodyId);
  else if (casualtyData.clay) formData.append('clay', casualtyData.clay);
  if (casualtyData.glaze) formData.append('glaze', casualtyData.glaze);
  if (casualtyData.glazeIds !== undefined) formData.append('glazeIds', JSON.stringify(casualtyData.glazeIds));
  if (casualtyData.form) formData.append('form', casualtyData.form);
  if (photo?.uri) {
    await appendPhotoToFormData(formData, photo.uri);
  }
  return await apiRequest(`${ENDPOINTS.pieces}/${id}`, {
    method: 'PUT',
    body: formData,
    timeout: 60000,
  });
};

export const deleteCasualty = async (id) => {
  return await apiRequest(`${ENDPOINTS.pieces}/${id}`, {
    method: 'DELETE',
  });
};

// ─── Projects ────────────────────────────────────────────────────────────────

export const projectSessionGuard = () => {
  const { getPrivatePieceMediaSession } = require('./pieceMedia');
  const generation = getPrivatePieceMediaSession().generation;
  return () => {
    if (generation !== getPrivatePieceMediaSession().generation) throw Object.assign(new Error('Project request is no longer current.'), { code: 'STALE_PROJECT_REQUEST' });
  };
};
export const getProjects = async () => {
  const data = await apiRequest(ENDPOINTS.projects, { validateSession: projectSessionGuard() });
  return Array.isArray(data) ? data : data.projects || [];
};

export const getProjectById = async (id) => {
  return await apiRequest(`${ENDPOINTS.projects}/${id}`, { validateSession: projectSessionGuard() });
};

export const createProject = async (projectData) => {
  return await apiRequest(ENDPOINTS.projects, {
    validateSession: projectSessionGuard(),
    method: 'POST',
    body: JSON.stringify(projectData),
  });
};

export const updateProject = async (id, projectData) => {
  return await apiRequest(`${ENDPOINTS.projects}/${id}`, {
    validateSession: projectSessionGuard(),
    method: 'PUT',
    body: JSON.stringify(projectData),
  });
};

export const deleteProject = async (id) => {
  return await apiRequest(`${ENDPOINTS.projects}/${id}`, {
    validateSession: projectSessionGuard(),
    method: 'DELETE',
  });
};

export const uploadProjectPhoto = async (projectId, imageUri, replacePhotoId = null) => {
  const validateSession = projectSessionGuard();
  const body = new FormData();
  await appendPhotosToFormData(body, [{ uri: imageUri }], 'photos');
  if (replacePhotoId) body.append('replacePhotoId', replacePhotoId);
  return apiRequest(`${ENDPOINTS.projects}/${projectId}/photos`, { method: 'POST', body, validateSession });
};

// ─── Goals ───────────────────────────────────────────────────────────────────

export const getGoals = async () => {
  const data = await apiRequest(ENDPOINTS.goals);
  return Array.isArray(data) ? data : data.goals || [];
};

export const createGoal = async (goalData) => {
  return await apiRequest(ENDPOINTS.goals, {
    method: 'POST',
    body: JSON.stringify(goalData),
  });
};

export const updateGoal = async (id, goalData) => {
  return await apiRequest(`${ENDPOINTS.goals}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(goalData),
  });
};

export const deleteGoal = async (id) => {
  return await apiRequest(`${ENDPOINTS.goals}/${id}`, {
    method: 'DELETE',
  });
};

// ─── Events ──────────────────────────────────────────────────────────────────

export const eventSessionGuard = () => {
  const { getPrivatePieceMediaSession } = require('./pieceMedia');
  const generation = getPrivatePieceMediaSession().generation;
  return () => {
    if (generation !== getPrivatePieceMediaSession().generation) throw Object.assign(new Error('Event request is no longer current.'), { code: 'STALE_EVENT_REQUEST' });
  };
};



export const getEvents = async () => {
  const data = await apiRequest(ENDPOINTS.events, { validateSession: eventSessionGuard() });
  return Array.isArray(data) ? data : data.events || [];
};

export const getEventById = async (id) => {
  return await apiRequest(`${ENDPOINTS.events}/${id}`, { validateSession: eventSessionGuard() });
};

export const createEvent = async (eventData) => {
  return await apiRequest(ENDPOINTS.events, {
    method: 'POST',
    body: JSON.stringify(eventData),
  });
};

export const updateEvent = async (id, eventData) => {
  return await apiRequest(`${ENDPOINTS.events}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(eventData),
  });
};

export const deleteEvent = async (id) => {
  return await apiRequest(`${ENDPOINTS.events}/${id}`, {
    method: 'DELETE',
  });
};

export const exportEventsICS = async () => {
  return await apiRequest(ENDPOINTS.eventsExport);
};

// ─── Notifications ───────────────────────────────────────────────────────────

export const getNotifications = async () => {
  const data = await apiRequest(ENDPOINTS.notifications);
  const notifications = Array.isArray(data) ? data : data?.notifications;
  return Array.isArray(notifications)
    ? notifications.filter(notification => notification && typeof notification === 'object')
    : [];
};

export const markNotificationsRead = async () => {
  return await apiRequest(`${ENDPOINTS.notifications}/read`, {
    method: 'POST',
  });
};

// ─── Blog ────────────────────────────────────────────────────────────────────

export const getBlogPosts = async () => {
  const data = await apiRequest(ENDPOINTS.blogPosts);
  return Array.isArray(data) ? data : data.posts || [];
};

export const getBlogPostBySlug = async (slug) => {
  return await apiRequest(`${ENDPOINTS.blogPosts}/${slug}`);
};

// ─── Reviews ─────────────────────────────────────────────────────────────────

export const getReviews = async () => {
  const data = await apiRequest(ENDPOINTS.reviews);
  return Array.isArray(data) ? data : data.reviews || [];
};

export const getMyReviews = async () => {
  const data = await apiRequest(ENDPOINTS.reviewsMine);
  return Array.isArray(data) ? data : data.reviews || [];
};

export const createReview = async (reviewData) => {
  return await apiRequest(ENDPOINTS.reviews, {
    method: 'POST',
    body: JSON.stringify({
      rating: reviewData.rating,
      body: reviewData.content || reviewData.body || reviewData.text,
    }),
  });
};

export const updateReview = async (id, reviewData) => {
  return await apiRequest(`${ENDPOINTS.reviews}/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      rating: reviewData.rating,
      body: reviewData.content || reviewData.body || reviewData.text,
    }),
  });
};

// ─── Contacts ────────────────────────────────────────────────────────────────

export const getContacts = async () => {
  const data = await apiRequest(ENDPOINTS.contacts);
  return Array.isArray(data) ? data : data.contacts || [];
};

export const getContactById = async (id) => {
  return await apiRequest(`${ENDPOINTS.contacts}/${id}`);
};

export const createContact = async (contactData) => {
  return await apiRequest(ENDPOINTS.contacts, {
    method: 'POST',
    body: JSON.stringify(contactData),
  });
};

export const updateContact = async (id, contactData) => {
  return await apiRequest(`${ENDPOINTS.contacts}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(contactData),
  });
};

export const deleteContact = async (id) => {
  return await apiRequest(`${ENDPOINTS.contacts}/${id}`, {
    method: 'DELETE',
  });
};

// ─── Glaze Chemistry ─────────────────────────────────────────────────────────

export const getGlazeChemicals = async () => {
  const data = await apiRequest(ENDPOINTS.glazeChemicals);
  return Array.isArray(data) ? data : data.chemicals || [];
};

export const createGlazeChemical = async (chemData) => {
  return await apiRequest(ENDPOINTS.glazeChemicals, {
    method: 'POST',
    body: JSON.stringify(chemData),
  });
};

export const updateGlazeChemical = async (id, chemData) => {
  return await apiRequest(`${ENDPOINTS.glazeChemicals}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(chemData),
  });
};

export const deleteGlazeChemical = async (id) => {
  return await apiRequest(`${ENDPOINTS.glazeChemicals}/${id}`, {
    method: 'DELETE',
  });
};

// ─── Test Tile Library ───────────────────────────────────────────────────────

export const getTestTiles = async () => {
  const data = await apiRequest(ENDPOINTS.testTiles);
  return Array.isArray(data) ? data : [];
};

export const getTestTile = async (id) => {
  return await apiRequest(`${ENDPOINTS.testTiles}/${id}`);
};

export const createTestTile = async (formData) => {
  return await apiRequest(ENDPOINTS.testTiles, {
    method: 'POST',
    body: formData,
    timeoutMs: 180000,
  });
};

export const updateTestTile = async (id, formData) => {
  return await apiRequest(`${ENDPOINTS.testTiles}/${id}`, {
    method: 'PUT',
    body: formData,
    timeoutMs: 180000,
  });
};

export const deleteTestTile = async (id) => {
  return await apiRequest(`${ENDPOINTS.testTiles}/${id}`, {
    method: 'DELETE',
  });
};

export const getTestTilesPreview = async () => {
  return await apiRequest(ENDPOINTS.testTilesPreview);
};

export const getTestTilesByGlaze = async (glazeId) => {
  return await apiRequest(`${ENDPOINTS.glazes}/${glazeId}/test-tiles`);
};

export const getTestTilesByClay = async (clayId) => {
  return await apiRequest(`${ENDPOINTS.clayBodies}/${clayId}/test-tiles`);
};

// AI Pottery Assistant
export const aiChat = async (message, history = []) => {
  return await apiRequest('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ message, history }),
  });
};


// ─── Admin ───────────────────────────────────────────────────────────────────

export const adminSearchMembers = async (query) => {
  return await apiRequest(`/api/admin/members/search?q=${encodeURIComponent(query)}`);
};

export const adminGetBetaSignups = async () => {
  return await apiRequest('/api/admin/beta-signups');
};

export const adminUpgradeAllBetaSignups = async () => {
  return await apiRequest('/api/admin/beta-signups/upgrade-all', {
    method: 'POST',
    body: JSON.stringify({}),
  });
};

export const adminGetFeaturedPotterHistory = async () => {
  return await apiRequest('/api/admin/featured-potter');
};

export const adminSetFeaturedPotter = async (userId, quote = '') => {
  return await apiRequest('/api/admin/featured-potter', {
    method: 'POST',
    body: JSON.stringify({ userId, quote }),
  });
};

export const adminGetBlogPosts = async () => {
  return await apiRequest('/api/admin/blog/posts');
};

export const adminPublishBlogPost = async (id) => {
  return await apiRequest(`/api/admin/blog/${id}/publish`, {
    method: 'PUT',
    body: JSON.stringify({}),
  });
};


export const adminGetOrders = async () => {
  return await apiRequest('/api/admin/orders');
};

export const adminGetReviews = async () => {
  return await apiRequest('/api/admin/reviews');
};

export const adminToggleReviewApprove = async (id) => {
  return await apiRequest(`/api/admin/reviews/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
};

export const adminToggleReviewFeature = async (id) => {
  return await apiRequest(`/api/admin/reviews/${id}/feature`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
};

export const adminDeleteReview = async (id) => {
  return await apiRequest(`/api/admin/reviews/${id}`, {
    method: 'DELETE',
  });
};


export const adminGetAnalytics = async () => {
  return await apiRequest('/api/admin/analytics');
};

export const adminGetActivitySummary = async () => {
  return await apiRequest('/api/admin/activity-summary');
};

export const adminGetNewsletterSubscriberCount = async () => {
  return await apiRequest('/api/admin/newsletter/subscribers');
};

export const adminGetNewsletterHistory = async () => {
  return await apiRequest('/api/admin/newsletter/history');
};

// ─── Report & Block ─────────────────────────────────────────────────────────

export const reportContent = async (contentType, contentId, reason, details = '') => {
  return await apiRequest('/api/reports', {
    method: 'POST',
    body: JSON.stringify({ contentType, contentId, reason, details }),
  });
};

export const blockUser = async (userId) => {
  return await apiRequest(`/api/users/${userId}/block`, {
    method: 'POST',
  });
};

export const unblockUser = async (userId) => {
  return await apiRequest(`/api/users/${userId}/unblock`, {
    method: 'POST',
  });
};

export const getBlockedUsers = async () => {
  return await apiRequest('/api/users/blocked');
};

// Push token registration
export const savePushToken = async (token, platform) => {
  return await apiRequest(ENDPOINTS.pushToken, {
    method: 'POST',
    body: JSON.stringify({ token, platform }),
  });
};

// ─── Activity Tracking ───────────────────────────────────────────────────────

let _activityThrottle = {};
export const trackActivity = async (action, page) => {
  if (!action) return;
  const key = `${action}_${page || ''}`;
  const now = Date.now();
  // Throttle: don't send same action more than once per 5 seconds
  if (_activityThrottle[key] && now - _activityThrottle[key] < 5000) return;
  _activityThrottle[key] = now;
  try {
    await apiRequest(ENDPOINTS.activity, {
      method: 'POST',
      body: JSON.stringify({ action, page: page || null }),
    });
  } catch (e) {
    // Silent fail — don't interrupt user flow for tracking
  }
};

export const deleteGlazePhoto = async id => apiRequest(`/api/glaze-photos/${encodeURIComponent(id)}`, { method: 'DELETE' });


export const replaceForumMedia = async (id, uri) => {
  const validateSession=profileSessionGuard(),body=new FormData();
  await appendPhotosToFormData(body,[{uri}], 'photos');validateSession();
  return apiRequest(`/api/forum/photos/${encodeURIComponent(id)}`,{method:'PUT',body,validateSession});
};
