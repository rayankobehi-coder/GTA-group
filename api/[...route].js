const crypto = require('crypto');
const { json, methodNotAllowed, readJson } = require('./_lib/http');
const { supabaseRest, storageCreateSignedUploadUrl, storageUpload, storageSignedUrl, storageRemove } = require('./_lib/supabase');
const { hashPassword, verifyPassword, issueSession, clearSession, getUserBySession, roleCanManageUsers, roleCanWriteShared } = require('./_lib/auth');

const DEFAULT_HASHES = {
  ceejay: '89d507e782bae73f986aef886c306d88:e03e89d2d272e27b9d1bdcfb238070df96f532f8ae1230afc813a98e3f6553186b861183fda9c7b72f4bee03a159915413bb8923b44ca6f0f01e845059869321',
  lepere: 'ea7d1171511306965ec783a09822cc9a:af8f309691f5cba30d9c186537a10ba07390cb0ab85530e4253e62f300ec69f213b40cb175417c7a33cc39d7565dee13b06cd8a3db94e254dce7064830d43de0',
  eleve1: 'e9b8617a22ca4b89b24b1ca21ec1c0ab:847df8b225a55820e787a1a61f96642534d911fe6653234b0b7e1eb479e730910d9235c96286dca5e03ddf445992fda35a3bf4f1c09e5f7c6adcafaea8fd8882',
  prof1: '5c9a9b697e49644184e398213956f82a:02580938f8a5dac34e11ad8cd30a6bd6b55bba818e233d223cf92ccd86531bccaf6eb408575274a2586cef4b6b1f58f0ca8afcf9df31357f40fe33ed72811387',
};

const DEFAULT_USERS = [
  { username: 'ceejay', full_name: 'CEEJAY - Administrateur absolu', email: 'master@gta.com', phone: '0173045519', role: 'admin', password_hash: DEFAULT_HASHES.ceejay, permissions: { all: true } },
  { username: 'lepere', full_name: 'Le Père GTA', email: 'parent@gta.com', phone: '0173045519', role: 'parent', password_hash: DEFAULT_HASHES.lepere, permissions: { documents: true, students: true } },
  { username: 'eleve1', full_name: 'Élève GTA', email: 'eleve@gta.com', phone: '0173045519', role: 'eleve', password_hash: DEFAULT_HASHES.eleve1, permissions: { documents: true, suggestions: true } },
  { username: 'prof1', full_name: 'Professeur GTA', email: 'prof@gta.com', phone: '0173045519', role: 'prof', password_hash: DEFAULT_HASHES.prof1, permissions: { documents: true, students: true } },
];

const PAGE_BY_ROLE = { admin: 'CEEJAY.html', parent: 'lepere.html', eleve: 'élève.html', prof: 'prof.html', staff: 'prof.html' };
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const MAX_AVATAR_BYTES = 15 * 1024 * 1024;

function routeParts(req) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const routedPath = requestUrl.searchParams.get('route') || requestUrl.pathname.replace(/^\/api\/?/, '');
  return routedPath.split('/').filter(Boolean).map(decodeURIComponent);
}
function clean(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function escapeTelegram(value) { return clean(value, 1500).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function asPublicUser(user) {
  return { id: user.id, username: user.username, full_name: user.full_name, fullName: user.full_name, email: user.email, phone: user.phone, role: user.role, permissions: user.permissions || {}, is_active: user.is_active, last_login_at: user.last_login_at, created_at: user.created_at, page: PAGE_BY_ROLE[user.role] || 'formulaire.html' };
}
function roleLabel(role) { return ({ admin: 'Administrateur', parent: 'Parent', prof: 'Professeur', eleve: 'Élève', staff: 'Staff' })[role] || role; }
function canReadDocuments(user) { return ['admin', 'parent', 'prof', 'staff', 'eleve'].includes(user.role); }

async function ensureDefaultUsers() {
  const { response } = await supabaseRest('gta_users', { method: 'HEAD', query: 'select=id&limit=1', prefer: 'count=exact' });
  const contentRange = response.headers.get('content-range') || '';
  const total = Number((contentRange.split('/')[1] || '0'));
  if (total > 0) return;
  const { data } = await supabaseRest('gta_users', { method: 'POST', body: DEFAULT_USERS, prefer: 'resolution=merge-duplicates,return=representation' });
  if (Array.isArray(data)) {
    await supabaseRest('gta_user_settings', { method: 'POST', body: data.map(user => ({ user_id: user.id, full_name: user.full_name, email: user.email, phone: user.phone, username: user.username })), prefer: 'resolution=merge-duplicates,return=minimal' });
  }
}

async function requireUser(req, res) {
  const user = await getUserBySession(req);
  if (!user) { json(res, 401, { error: 'Session invalide ou expirée.' }); return null; }
  return user;
}
function requireAdmin(user, res) { if (!roleCanManageUsers(user.role)) { json(res, 403, { error: 'Droits administrateur requis.' }); return false; } return true; }

async function countRows(table, query) {
  const { response } = await supabaseRest(table, { method: 'HEAD', query: `${query ? `${query}&` : ''}select=id&limit=1`, prefer: 'count=exact' });
  const range = response.headers.get('content-range') || '';
  return Number(range.split('/')[1] || 0);
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { sent: false, error: 'TELEGRAM_BOT_TOKEN non configuré.' };
  let chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    const updatesResponse = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const updates = await updatesResponse.json();
    const last = updates?.result?.[updates.result.length - 1];
    chatId = last?.message?.chat?.id || last?.channel_post?.chat?.id;
  }
  if (!chatId) return { sent: false, error: 'Aucun chat Telegram trouvé. Envoyez d’abord un message au bot.' };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
  const data = await response.json();
  return data.ok ? { sent: true } : { sent: false, error: data.description || 'Erreur Telegram.' };
}

async function logActivity(user, action, details = {}) {
  try { await supabaseRest('gta_activity', { method: 'POST', body: { actor_id: user?.id || null, action, details }, prefer: 'return=minimal' }); } catch {}
}
async function notify(userId, title, message, type = 'info') {
  if (!userId) return;
  try { await supabaseRest('gta_notifications', { method: 'POST', body: { recipient_id: userId, title, message, type }, prefer: 'return=minimal' }); } catch {}
}

async function authLogin(req, res) {
  const body = await readJson(req, 20000);
  const username = clean(body.username, 80).toLowerCase();
  const password = String(body.password || '');
  await ensureDefaultUsers();
  if (!username || !password) return json(res, 400, { error: 'Identifiant et mot de passe requis.' });
  const { data } = await supabaseRest('gta_users', { query: `username=eq.${encodeURIComponent(username)}&select=id,username,full_name,email,phone,role,permissions,is_active,password_hash,last_login_at,created_at&limit=1` });
  const user = Array.isArray(data) ? data[0] : null;
  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) return json(res, 401, { error: 'Identifiant ou mot de passe incorrect.' });
  await supabaseRest('gta_users', { method: 'PATCH', query: `id=eq.${encodeURIComponent(user.id)}`, body: { last_login_at: new Date().toISOString() }, prefer: 'return=minimal' });
  await supabaseRest('gta_presence', { method: 'POST', body: { user_id: user.id, last_seen_at: new Date().toISOString(), user_agent: req.headers['user-agent'] || '' }, prefer: 'resolution=merge-duplicates,return=minimal' });
  issueSession(res, user, req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket?.encrypted));
  await logActivity(user, 'connexion', { page: PAGE_BY_ROLE[user.role] });
  return json(res, 200, { user: asPublicUser(user) });
}

async function authMe(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  await supabaseRest('gta_presence', { method: 'POST', body: { user_id: user.id, last_seen_at: new Date().toISOString(), user_agent: req.headers['user-agent'] || '' }, prefer: 'resolution=merge-duplicates,return=minimal' });
  const { data: profiles } = await supabaseRest('gta_user_settings', { query: `user_id=eq.${encodeURIComponent(user.id)}&select=full_name,email,phone,username,avatar_path,preferences&limit=1` });
  const profile = profiles?.[0] || null;
  if (profile?.avatar_path) {
    try {
      profile.avatar_url = await storageSignedUrl('gta-avatars', profile.avatar_path, 3600);
    } catch (error) {
      console.warn('[GTA avatar stale path]', user.id, error.message);
      profile.avatar_url = null;
      profile.avatar_path = null;
      await supabaseRest('gta_user_settings', { method: 'PATCH', query: `user_id=eq.${encodeURIComponent(user.id)}`, body: { avatar_path: null }, prefer: 'return=minimal' }).catch(() => {});
    }
  }
  return json(res, 200, { user: asPublicUser(user), profile });
}

async function listUsers(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const query = roleCanManageUsers(user.role) ? 'select=id,username,full_name,email,phone,role,permissions,is_active,last_login_at,created_at&order=created_at.desc&limit=1000' : 'role=eq.eleve&select=id,username,full_name,email,phone,role,permissions,is_active,last_login_at,created_at&order=created_at.desc&limit=1000';
  const { data } = await supabaseRest('gta_users', { query });
  return json(res, 200, { users: (data || []).map(asPublicUser) });
}

async function createUser(req, res) {
  const actor = await requireUser(req, res); if (!actor || !requireAdmin(actor, res)) return;
  const body = await readJson(req, 30000);
  const username = clean(body.username, 80).toLowerCase();
  const password = String(body.password || '');
  const role = ['admin', 'parent', 'prof', 'eleve', 'staff'].includes(body.role) ? body.role : 'eleve';
  const fullName = clean(body.full_name || body.fullName, 150);
  if (!username || password.length < 4 || !fullName) return json(res, 400, { error: 'Nom d’utilisateur, mot de passe (4 caractères minimum) et nom complet requis.' });
  const { data } = await supabaseRest('gta_users', { method: 'POST', body: { username, password_hash: hashPassword(password), full_name: fullName, email: clean(body.email, 160) || null, phone: clean(body.phone, 60) || null, role, permissions: body.permissions || {}, is_active: true }, prefer: 'return=representation' });
  const created = data?.[0];
  if (!created) return json(res, 500, { error: 'Création du compte impossible.' });
  await supabaseRest('gta_user_settings', { method: 'POST', body: { user_id: created.id, full_name: created.full_name, email: created.email, phone: created.phone, username: created.username }, prefer: 'return=minimal' });
  await notify(created.id, 'Bienvenue sur GTA', 'Votre compte a été créé par l’administrateur.', 'success');
  await logActivity(actor, 'creation_utilisateur', { user_id: created.id, username });
  return json(res, 201, { user: asPublicUser(created) });
}

async function updateUser(req, res, id) {
  const actor = await requireUser(req, res); if (!actor || !requireAdmin(actor, res)) return;
  const body = await readJson(req, 30000);
  const patch = {};
  if (body.full_name || body.fullName) patch.full_name = clean(body.full_name || body.fullName, 150);
  if (body.email !== undefined) patch.email = clean(body.email, 160) || null;
  if (body.phone !== undefined) patch.phone = clean(body.phone, 60) || null;
  if (body.username) patch.username = clean(body.username, 80).toLowerCase();
  if (body.role && ['admin', 'parent', 'prof', 'eleve', 'staff'].includes(body.role)) patch.role = body.role;
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
  if (body.password !== undefined && body.password !== '') {
    if (String(body.password).length < 4) return json(res, 400, { error: 'Le nouveau mot de passe doit contenir au moins 4 caractères.' });
    patch.password_hash = hashPassword(String(body.password));
  }
  const { data } = await supabaseRest('gta_users', { method: 'PATCH', query: `id=eq.${encodeURIComponent(id)}&select=id,username,full_name,email,phone,role,permissions,is_active,last_login_at,created_at`, body: patch, prefer: 'return=representation' });
  const updated = data?.[0];
  if (!updated) return json(res, 404, { error: 'Utilisateur introuvable.' });
  await supabaseRest('gta_user_settings', { method: 'PATCH', query: `user_id=eq.${encodeURIComponent(id)}`, body: { full_name: updated.full_name, email: updated.email, phone: updated.phone, username: updated.username }, prefer: 'return=minimal' });
  await logActivity(actor, 'modification_utilisateur', { user_id: id, patch: Object.keys(patch) });
  return json(res, 200, { user: asPublicUser(updated) });
}

async function deleteUser(req, res, id) {
  const actor = await requireUser(req, res); if (!actor || !requireAdmin(actor, res)) return;
  if (id === actor.id) return json(res, 400, { error: 'Impossible de supprimer la session administrateur actuelle.' });
  await supabaseRest('gta_users', { method: 'DELETE', query: `id=eq.${encodeURIComponent(id)}`, prefer: 'return=minimal' });
  await logActivity(actor, 'suppression_utilisateur', { user_id: id });
  return json(res, 200, { ok: true });
}

async function dashboard(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const [users, students, documents, online, registrations, unread] = await Promise.all([
    countRows('gta_users'), countRows('gta_users', 'role=eq.eleve'), countRows('gta_documents'), countRows('gta_users', `last_login_at=gte.${encodeURIComponent(new Date(Date.now() - 5 * 60 * 1000).toISOString())}`), roleCanManageUsers(user.role) ? countRows('gta_registrations', 'status=eq.new') : Promise.resolve(0), countRows('gta_notifications', `recipient_id=eq.${encodeURIComponent(user.id)}&is_read=eq.false`),
  ]);
  return json(res, 200, { stats: { users, students, documents, online, registrations, unread }, database: 'operational', server_time: new Date().toISOString() });
}

async function listDocuments(req, res) {
  const user = await requireUser(req, res); if (!user || !canReadDocuments(user)) return;
  const query = user.role === 'eleve' ? `or=(visibility.eq.shared,owner_id.eq.${encodeURIComponent(user.id)})&select=id,name,storage_path,mime_type,size_bytes,uploaded_by,visibility,owner_id,created_at&order=created_at.desc&limit=200` : 'select=id,name,storage_path,mime_type,size_bytes,uploaded_by,visibility,owner_id,created_at&order=created_at.desc&limit=200';
  const { data } = await supabaseRest('gta_documents', { query });
  const docs = await Promise.all((data || []).map(async doc => ({ ...doc, download_url: await storageSignedUrl('gta-documents', doc.storage_path, 3600) })));
  return json(res, 200, { documents: docs });
}

async function createDocumentUploadUrl(req, res) {
  const user = await requireUser(req, res); if (!user || !roleCanWriteShared(user.role)) return;
  const body = await readJson(req, 20000);
  const name = clean(body.name, 180);
  const size = Number(body.size || 0);
  if (!name || !Number.isFinite(size) || size <= 0 || size > MAX_DOCUMENT_BYTES) return json(res, 400, { error: 'Fichier invalide ou supérieur à 15 Mo.' });
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${user.id}/${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${safeName}`;
  const upload = await storageCreateSignedUploadUrl('gta-documents', path, false);
  return json(res, 200, { upload: { path: upload.path, signedUrl: upload.signedUrl } });
}

async function uploadDocument(req, res) {
  const user = await requireUser(req, res); if (!user || !roleCanWriteShared(user.role)) return;
  const body = await readJson(req, 20 * 1024 * 1024);
  const name = clean(body.name, 180);
  const size = Number(body.size || 0);
  if (!name || !Number.isFinite(size) || size <= 0 || size > MAX_DOCUMENT_BYTES) return json(res, 400, { error: 'Fichier invalide ou supérieur à 15 Mo.' });
  let path = clean(body.storagePath, 500);
  if (path) {
    if (!path.startsWith(`${user.id}/`)) return json(res, 403, { error: 'Chemin de stockage non autorisé.' });
  } else {
    const base64 = String(body.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) return json(res, 400, { error: 'Fichier manquant.' });
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    path = `${user.id}/${Date.now()}-${crypto.randomBytes(5).toString('hex')}-${safeName}`;
    await storageUpload('gta-documents', path, Buffer.from(base64, 'base64'), body.type || 'application/octet-stream');
  }
  const { data } = await supabaseRest('gta_documents', { method: 'POST', body: { name, storage_path: path, mime_type: clean(body.type, 120) || null, size_bytes: size, uploaded_by: user.id, visibility: body.visibility === 'private' ? 'private' : 'shared', owner_id: body.visibility === 'private' ? user.id : null }, prefer: 'return=representation' });
  await logActivity(user, 'upload_document', { name });
  return json(res, 201, { document: data?.[0] || null });
}

async function deleteDocument(req, res, id) {
  const user = await requireUser(req, res); if (!user || !roleCanWriteShared(user.role)) return;
  const { data } = await supabaseRest('gta_documents', { query: `id=eq.${encodeURIComponent(id)}&select=id,storage_path,uploaded_by&limit=1` });
  const doc = data?.[0];
  if (!doc) return json(res, 404, { error: 'Document introuvable.' });
  if (user.role === 'eleve' || (user.role !== 'admin' && doc.uploaded_by !== user.id)) return json(res, 403, { error: 'Vous ne pouvez pas supprimer ce document.' });
  await storageRemove('gta-documents', [doc.storage_path]);
  await supabaseRest('gta_documents', { method: 'DELETE', query: `id=eq.${encodeURIComponent(id)}`, prefer: 'return=minimal' });
  await logActivity(user, 'suppression_document', { document_id: id });
  return json(res, 200, { ok: true });
}

async function createAvatarUploadUrl(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const body = await readJson(req, 20000);
  const name = clean(body.name, 180) || 'avatar.jpg';
  const size = Number(body.size || 0);
  if (!Number.isFinite(size) || size <= 0 || size > MAX_AVATAR_BYTES) return json(res, 400, { error: 'Photo de profil invalide ou supérieure à 15 Mo.' });
  const type = clean(body.type, 120) || 'image/jpeg';
  if (!type.startsWith('image/')) return json(res, 400, { error: 'La photo de profil doit être une image.' });
  const extension = (name.match(/\.([a-zA-Z0-9]+)$/)?.[1] || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${user.id}/avatar-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.${extension}`;
  const upload = await storageCreateSignedUploadUrl('gta-avatars', path, false);
  return json(res, 200, { upload: { path: upload.path, signedUrl: upload.signedUrl, type, size } });
}

async function profile(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  if (req.method === 'GET') {
    const { data } = await supabaseRest('gta_user_settings', { query: `user_id=eq.${encodeURIComponent(user.id)}&select=full_name,email,phone,username,avatar_path,preferences&limit=1` });
    const result = data?.[0] || { full_name: user.full_name, email: user.email, phone: user.phone, username: user.username, preferences: {} };
    if (result.avatar_path) {
      try {
        result.avatar_url = await storageSignedUrl('gta-avatars', result.avatar_path, 3600);
      } catch (error) {
        console.warn('[GTA avatar stale path]', user.id, error.message);
        result.avatar_url = null;
        result.avatar_path = null;
        await supabaseRest('gta_user_settings', { method: 'PATCH', query: `user_id=eq.${encodeURIComponent(user.id)}`, body: { avatar_path: null }, prefer: 'return=minimal' }).catch(() => {});
      }
    }
    return json(res, 200, { profile: result });
  }
  if (req.method !== 'PATCH') return methodNotAllowed(res, ['GET', 'PATCH']);
  const body = await readJson(req, 20000);
  const { data: existingSettings } = await supabaseRest('gta_user_settings', { query: `user_id=eq.${encodeURIComponent(user.id)}&select=avatar_path&limit=1` });
  const oldAvatarPath = existingSettings?.[0]?.avatar_path || null;
  const avatarChangeRequested = Object.prototype.hasOwnProperty.call(body, 'storagePath') || Object.prototype.hasOwnProperty.call(body, 'avatarData') || Boolean(body.removeAvatar);
  const patch = { full_name: clean(body.full_name || body.fullName, 150) || user.full_name, email: clean(body.email, 160) || null, phone: clean(body.phone, 60) || null, username: clean(body.username, 80).toLowerCase() || user.username, preferences: body.preferences || {} };
  if (body.storagePath) {
    const path = clean(body.storagePath, 500);
    if (!path.startsWith(`${user.id}/`)) return json(res, 403, { error: 'Chemin avatar non autorisé.' });
    patch.avatar_path = path;
  } else if (body.avatarData) {
    const base64 = String(body.avatarData).replace(/^data:[^;]+;base64,/, '');
    const estimatedSize = Math.floor(base64.length * 0.75);
    if (estimatedSize > MAX_AVATAR_BYTES) return json(res, 400, { error: 'Photo de profil supérieure à 15 Mo.' });
    const path = `${user.id}/avatar-${Date.now()}.bin`;
    await storageUpload('gta-avatars', path, Buffer.from(base64, 'base64'), body.avatarType || 'image/jpeg');
    patch.avatar_path = path;
  } else if (body.removeAvatar) patch.avatar_path = null;
  const settingsPatch = { ...patch };
  if (!avatarChangeRequested) delete settingsPatch.avatar_path;
  if (existingSettings?.length) {
    await supabaseRest('gta_user_settings', { method: 'PATCH', query: `user_id=eq.${encodeURIComponent(user.id)}`, body: settingsPatch, prefer: 'return=minimal' });
  } else {
    await supabaseRest('gta_user_settings', { method: 'POST', body: { user_id: user.id, ...settingsPatch }, prefer: 'return=minimal' });
  }
  if (oldAvatarPath && avatarChangeRequested && patch.avatar_path !== oldAvatarPath) await storageRemove('gta-avatars', [oldAvatarPath]).catch(() => {});
  await supabaseRest('gta_users', { method: 'PATCH', query: `id=eq.${encodeURIComponent(user.id)}`, body: { full_name: patch.full_name, email: patch.email, phone: patch.phone, username: patch.username }, prefer: 'return=minimal' });
  await logActivity(user, 'mise_a_jour_profil');
  return json(res, 200, { ok: true, profile: patch });
}

async function changePassword(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  const body = await readJson(req, 20000);
  const { data } = await supabaseRest('gta_users', { query: `id=eq.${encodeURIComponent(user.id)}&select=id,password_hash&limit=1` });
  if (!data?.[0] || !verifyPassword(String(body.oldPassword || ''), data[0].password_hash)) return json(res, 400, { error: 'Ancien mot de passe incorrect.' });
  if (String(body.newPassword || '').length < 4 || body.newPassword !== body.confirmPassword) return json(res, 400, { error: 'Nouveau mot de passe invalide ou confirmation différente.' });
  await supabaseRest('gta_users', { method: 'PATCH', query: `id=eq.${encodeURIComponent(user.id)}`, body: { password_hash: hashPassword(body.newPassword) }, prefer: 'return=minimal' });
  await logActivity(user, 'changement_mot_de_passe');
  return json(res, 200, { ok: true });
}

async function registrations(req, res) {
  if (req.method !== 'POST') { const user = await requireUser(req, res); if (!user || !requireAdmin(user, res)) return; const { data } = await supabaseRest('gta_registrations', { query: 'select=id,first_name,last_name,target_class,phone,email,message,status,telegram_sent,created_at&order=created_at.desc&limit=200' }); return json(res, 200, { registrations: data || [] }); }
  const body = await readJson(req, 30000);
  const registration = { first_name: clean(body.prenom, 100), last_name: clean(body.nom, 100), target_class: clean(body.classe, 80), phone: clean(body.telephone, 60), email: clean(body.email, 160) || null, message: clean(body.message, 1500) || null };
  if (!registration.first_name || !registration.last_name || !registration.target_class || !registration.phone) return json(res, 400, { error: 'Veuillez remplir tous les champs obligatoires.' });
  const { data } = await supabaseRest('gta_registrations', { method: 'POST', body: registration, prefer: 'return=representation' });
  const text = `📋 <b>NOUVELLE INSCRIPTION — GROUPE GTA</b>\n\n👤 <b>Prénom :</b> ${escapeTelegram(registration.first_name)}\n👤 <b>Nom :</b> ${escapeTelegram(registration.last_name)}\n📚 <b>Classe visée :</b> ${escapeTelegram(registration.target_class)}\n📞 <b>Téléphone :</b> ${escapeTelegram(registration.phone)}\n📧 <b>Email :</b> ${escapeTelegram(registration.email || 'Non renseigné')}\n💬 <b>Message :</b> ${escapeTelegram(registration.message || 'Aucun message')}\n\n🕐 <i>Reçu le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' })}</i>`;
  const telegram = await sendTelegram(text);
  const id = data?.[0]?.id;
  if (id) await supabaseRest('gta_registrations', { method: 'PATCH', query: `id=eq.${encodeURIComponent(id)}`, body: { telegram_sent: telegram.sent, telegram_error: telegram.error || null }, prefer: 'return=minimal' });
  return json(res, 201, { ok: true, stored: true, telegram_sent: telegram.sent, telegram_error: telegram.error || null });
}

async function notifications(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  if (req.method === 'GET') { const { data } = await supabaseRest('gta_notifications', { query: `recipient_id=eq.${encodeURIComponent(user.id)}&select=id,title,message,type,is_read,created_at&order=created_at.desc&limit=50` }); return json(res, 200, { notifications: data || [] }); }
  if (req.method === 'PATCH') { const body = await readJson(req, 10000); const query = body.id ? `id=eq.${encodeURIComponent(body.id)}&recipient_id=eq.${encodeURIComponent(user.id)}` : `recipient_id=eq.${encodeURIComponent(user.id)}&is_read=eq.false`; await supabaseRest('gta_notifications', { method: 'PATCH', query, body: { is_read: true }, prefer: 'return=minimal' }); return json(res, 200, { ok: true }); }
  return methodNotAllowed(res, ['GET', 'PATCH']);
}

async function suggestions(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  if (req.method === 'GET') { const query = user.role === 'admin' ? 'select=id,author_id,subject,message,status,created_at&order=created_at.desc&limit=200' : `author_id=eq.${encodeURIComponent(user.id)}&select=id,author_id,subject,message,status,created_at&order=created_at.desc&limit=100`; const { data } = await supabaseRest('gta_suggestions', { query }); return json(res, 200, { suggestions: data || [] }); }
  if (req.method !== 'POST') return methodNotAllowed(res, ['GET', 'POST']);
  const body = await readJson(req, 30000); const subject = clean(body.subject, 160); const message = clean(body.message, 2000); if (!subject || !message) return json(res, 400, { error: 'Objet et message requis.' });
  const { data } = await supabaseRest('gta_suggestions', { method: 'POST', body: { author_id: user.id, subject, message }, prefer: 'return=representation' });
  if (user.role !== 'admin') { const admins = await supabaseRest('gta_users', { query: 'role=eq.admin&select=id&limit=20' }); await Promise.all((admins.data || []).map(admin => notify(admin.id, 'Nouveau message', `${user.full_name} a envoyé une suggestion.`, 'info'))); }
  await logActivity(user, 'nouvelle_suggestion', { subject }); return json(res, 201, { suggestion: data?.[0] || null });
}

async function presence(req, res) {
  const user = await requireUser(req, res); if (!user) return;
  await supabaseRest('gta_presence', { method: 'POST', body: { user_id: user.id, last_seen_at: new Date().toISOString(), user_agent: req.headers['user-agent'] || '' }, prefer: 'resolution=merge-duplicates,return=minimal' });
  return json(res, 200, { ok: true });
}

async function resetPlatform(req, res) {
  const user = await requireUser(req, res); if (!user || !requireAdmin(user, res)) return;
  await supabaseRest('gta_documents', { method: 'DELETE', query: 'id=not.is.null', prefer: 'return=minimal' });
  await supabaseRest('gta_registrations', { method: 'DELETE', query: 'id=not.is.null', prefer: 'return=minimal' });
  await supabaseRest('gta_activity', { method: 'DELETE', query: 'id=not.is.null', prefer: 'return=minimal' });
  await supabaseRest('gta_notifications', { method: 'DELETE', query: 'id=not.is.null', prefer: 'return=minimal' });
  await supabaseRest('gta_suggestions', { method: 'DELETE', query: 'id=not.is.null', prefer: 'return=minimal' });
  await logActivity(user, 'reinitialisation_plateforme');
  return json(res, 200, { ok: true });
}

// IMPORTANT : chaque route doit être "awaitée". Un simple `return maRoute(req, res)`
// fait échapper le rejet de la promesse au try/catch ci-dessous, ce qui provoquait un
// "unhandled rejection" et l'arrêt complet du processus Node (donc du site entier).
async function dispatch(req, res) {
  const parts = routeParts(req);
  const [first, second] = parts;
  if (first === 'auth' && second === 'login' && req.method === 'POST') return authLogin(req, res);
  if (first === 'auth' && second === 'me' && req.method === 'GET') return authMe(req, res);
  if (first === 'auth' && second === 'logout' && req.method === 'POST') { clearSession(res, req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket?.encrypted)); return json(res, 200, { ok: true }); }
  if (first === 'users' && !second && req.method === 'GET') return listUsers(req, res);
  if (first === 'users' && !second && req.method === 'POST') return createUser(req, res);
  if (first === 'users' && second && req.method === 'PATCH') return updateUser(req, res, second);
  if (first === 'users' && second && req.method === 'DELETE') return deleteUser(req, res, second);
  if (first === 'dashboard' && req.method === 'GET') return dashboard(req, res);
  if (first === 'documents' && !second && req.method === 'GET') return listDocuments(req, res);
  if (first === 'documents' && second === 'upload-url' && req.method === 'POST') return createDocumentUploadUrl(req, res);
  if (first === 'documents' && !second && req.method === 'POST') return uploadDocument(req, res);
  if (first === 'documents' && second && req.method === 'DELETE') return deleteDocument(req, res, second);
  if (first === 'profile' && second === 'avatar-upload-url' && req.method === 'POST') return createAvatarUploadUrl(req, res);
  if (first === 'profile' && second === 'password' && req.method === 'POST') return changePassword(req, res);
  if (first === 'profile') return profile(req, res);
  if (first === 'registrations') return registrations(req, res);
  if (first === 'notifications') return notifications(req, res);
  if (first === 'suggestions') return suggestions(req, res);
  if (first === 'presence' && req.method === 'POST') return presence(req, res);
  if (first === 'admin' && second === 'reset' && req.method === 'POST') return resetPlatform(req, res);
  return json(res, 404, { error: 'Route API introuvable.' });
}

async function handler(req, res) {
  try {
    return await dispatch(req, res);
  } catch (error) {
    console.error('[GTA API]', error.message);
    if (res.headersSent) return;
    return json(res, error.status || 500, { error: error.status ? error.message : 'Erreur serveur. Vérifiez la configuration Supabase.' });
  }
}

module.exports = handler;
