(function () {
  'use strict';

  // ===========================================================
  // MODE HORS-LIGNE
  // Si la page est ouverte directement depuis le disque (protocole
  // file://), aucun appel /api/... ne peut aboutir. On bascule alors
  // sur un backend local (localStorage) pour que les comptes du
  // document restent utilisables sans serveur.
  // ===========================================================
  const OFFLINE = location.protocol === 'file:';
  const OFFLINE_DB_KEY = 'gta_offline_db_v1';
  const OFFLINE_SESSION_KEY = 'gta_offline_session';
  const OFFLINE_PAGE_BY_ROLE = { admin: 'CEEJAY.html', parent: 'lepere.html', eleve: 'élève.html', prof: 'prof.html', staff: 'prof.html' };

  // Les stockages peuvent lever une exception (file://, navigation privée) :
  // on bascule alors sur une mémoire de session.
  const memoryStore = {};
  const getStore = kind => { try { return kind === 'local' ? window.localStorage : window.sessionStorage; } catch { return null; } };
  const storeRead = (kind, key) => {
    try { const s = getStore(kind); return s ? s.getItem(key) : (memoryStore[`${kind}:${key}`] ?? null); }
    catch { return memoryStore[`${kind}:${key}`] ?? null; }
  };
  const storeWrite = (kind, key, value) => {
    try { const s = getStore(kind); if (s) s.setItem(key, value); else memoryStore[`${kind}:${key}`] = value; }
    catch { memoryStore[`${kind}:${key}`] = value; }
  };
  const storeDrop = (kind, key) => {
    try { const s = getStore(kind); if (s) s.removeItem(key); } catch {}
    delete memoryStore[`${kind}:${key}`];
  };

  const OFFLINE_ACCOUNTS = [
    { username: 'ceejay', password: 'yajeec',   full_name: 'CEEJAY - Administrateur absolu', email: 'master@gta.com', phone: '0173045519', role: 'admin',  permissions: { all: true } },
    { username: 'lepere', password: 'peregta',  full_name: 'Le Père GTA',                    email: 'parent@gta.com', phone: '0173045519', role: 'parent', permissions: { documents: true, students: true } },
    { username: 'eleve1', password: 'eleve123', full_name: 'Élève GTA',                      email: 'eleve@gta.com',  phone: '0173045519', role: 'eleve',  permissions: { documents: true, suggestions: true } },
    { username: 'prof1',  password: 'prof123',  full_name: 'Professeur GTA',                 email: 'prof@gta.com',   phone: '0173045519', role: 'prof',   permissions: { documents: true, students: true } },
  ];

  function offlineDb() {
    try {
      const parsed = JSON.parse(storeRead('local', OFFLINE_DB_KEY) || 'null');
      if (parsed && Array.isArray(parsed.users) && parsed.users.length) return parsed;
    } catch {}
    const db = {
      users: OFFLINE_ACCOUNTS.map(account => ({ ...account, id: `offline-${account.username}`, is_active: true, last_login_at: null, created_at: new Date().toISOString() })),
      documents: [], notifications: [], suggestions: [], profiles: {},
    };
    storeWrite('local', OFFLINE_DB_KEY, JSON.stringify(db));
    return db;
  }
  const offlineSave = db => storeWrite('local', OFFLINE_DB_KEY, JSON.stringify(db));
  const offlinePublicUser = user => ({
    id: user.id, username: user.username, full_name: user.full_name, fullName: user.full_name,
    email: user.email, phone: user.phone, role: user.role, permissions: user.permissions || {},
    is_active: true, last_login_at: user.last_login_at, created_at: user.created_at,
    page: OFFLINE_PAGE_BY_ROLE[user.role] || 'formulaire.html',
  });
  const offlineError = (message, status) => { const error = new Error(message); error.status = status; return error; };
  const offlineSession = () => { try { return JSON.parse(storeRead('session', OFFLINE_SESSION_KEY) || 'null'); } catch { return null; } };

  // Accès tolérant aux pannes à sessionStorage : sur certaines configurations
  // (file://, navigation privée) toute lecture/écriture lève une exception.
  // Sans ce garde-fou, protectDashboard() échouait et renvoyait en boucle
  // vers la page de connexion.
  const safeSessionSet = (key, value) => { try { window.sessionStorage.setItem(key, value); } catch { memoryStore['s:' + key] = value; } };
  const safeSessionRemove = key => { try { window.sessionStorage.removeItem(key); } catch {} delete memoryStore['s:' + key]; };
  async function offlineApi(path, options = {}) {
    const route = String(path).replace(/^\//, '');
    const method = (options.method || 'GET').toUpperCase();
    let body = options.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
    body = body || {};
    const db = offlineDb();
    const session = offlineSession();
    const me = session ? db.users.find(user => user.id === session.id) : null;
    const need = () => { if (!me) throw offlineError('Session locale expirée. Reconnectez-vous.', 401); return me; };
    const adminOnly = () => { const user = need(); if (user.role !== 'admin') throw offlineError('Droits administrateur requis.', 403); return user; };

    if (route === 'auth/login' && method === 'POST') {
      const username = String(body.username || '').trim().toLowerCase();
      const found = db.users.find(user => String(user.username).toLowerCase() === username && user.password === String(body.password || ''));
      if (!found) throw offlineError('Identifiant ou mot de passe incorrect.', 401);
      found.last_login_at = new Date().toISOString();
      offlineSave(db);
      storeWrite('session', OFFLINE_SESSION_KEY, JSON.stringify({ id: found.id, username: found.username, role: found.role }));
      return { user: offlinePublicUser(found) };
    }
    if (route === 'auth/logout') { storeDrop('session', OFFLINE_SESSION_KEY); return { ok: true }; }
    if (route === 'auth/me') { const user = need(); return { user: offlinePublicUser(user), profile: db.profiles[user.id] || null }; }
    if (route === 'dashboard') {
      need();
      return { stats: { online: db.users.filter(user => user.last_login_at).length, students: db.users.filter(user => user.role === 'eleve').length, users: db.users.length, documents: db.documents.length } };
    }
    if (route === 'users' && method === 'GET') { need(); return { users: db.users.map(offlinePublicUser) }; }
    if (route === 'users' && method === 'POST') {
      adminOnly();
      const username = String(body.username || '').trim();
      if (!username) throw offlineError('Identifiant requis.', 400);
      if (db.users.some(user => String(user.username).toLowerCase() === username.toLowerCase())) throw offlineError('Cet identifiant existe déjà.', 409);
      const created = { id: `offline-${Date.now()}`, username, password: String(body.password || ''), full_name: body.full_name || username, email: body.email || null, phone: body.phone || null, role: body.role || 'eleve', permissions: {}, is_active: true, last_login_at: null, created_at: new Date().toISOString() };
      db.users.push(created); offlineSave(db);
      return { user: offlinePublicUser(created) };
    }
    if (route.startsWith('users/') && method === 'PATCH') {
      adminOnly();
      const target = db.users.find(user => user.id === route.split('/')[1]);
      if (!target) throw offlineError('Utilisateur introuvable.', 404);
      ['full_name', 'email', 'phone', 'role'].forEach(key => { if (body[key] !== undefined) target[key] = body[key]; });
      if (body.password) target.password = String(body.password);
      offlineSave(db);
      return { user: offlinePublicUser(target) };
    }
    if (route.startsWith('users/') && method === 'DELETE') {
      const user = adminOnly();
      const id = route.split('/')[1];
      if (id === user.id) throw offlineError('Impossible de supprimer votre propre compte.', 400);
      db.users = db.users.filter(candidate => candidate.id !== id); offlineSave(db);
      return { ok: true };
    }
    if (route === 'documents' && method === 'GET') { need(); return { documents: db.documents }; }
    if (route === 'documents' && method === 'POST') {
      const user = need();
      const doc = { id: `offline-doc-${Date.now()}`, name: body.name, size_bytes: body.size, mime_type: body.type, owner_id: user.id, created_at: new Date().toISOString(), download_url: null };
      db.documents.push(doc); offlineSave(db);
      return { document: doc };
    }
    if (route.startsWith('documents/') && method === 'DELETE') { need(); db.documents = db.documents.filter(doc => doc.id !== route.split('/')[1]); offlineSave(db); return { ok: true }; }
    if (route === 'documents/upload-url' || route === 'profile/avatar-upload-url') {
      throw offlineError("Le téléversement de fichiers nécessite le serveur local : lancez DEMARRER-GTA.cmd puis ouvrez http://127.0.0.1:3000", 501);
    }
    if (route === 'profile' && method === 'GET') {
      const user = need();
      return { profile: db.profiles[user.id] || { user_id: user.id, full_name: user.full_name, email: user.email, phone: user.phone, username: user.username, preferences: {} } };
    }
    if (route === 'profile' && method === 'PATCH') {
      const user = need();
      const profile = db.profiles[user.id] || { user_id: user.id };
      Object.assign(profile, body);
      if (body.fullName) { profile.full_name = body.fullName; user.full_name = body.fullName; }
      if (body.email !== undefined) user.email = body.email;
      if (body.phone !== undefined) user.phone = body.phone;
      if (body.removeAvatar) { profile.avatar_url = null; profile.avatar_path = null; }
      db.profiles[user.id] = profile; offlineSave(db);
      return { profile };
    }
    if (route === 'profile/password' && method === 'POST') {
      const user = need();
      if (String(body.oldPassword || '') !== String(user.password || '')) throw offlineError('Ancien mot de passe incorrect.', 400);
      const next = String(body.newPassword || '');
      if (!next) throw offlineError('Nouveau mot de passe requis.', 400);
      if (body.confirmPassword !== undefined && body.confirmPassword !== next) throw offlineError('Les deux mots de passe ne correspondent pas.', 400);
      user.password = next; offlineSave(db);
      return { ok: true };
    }
    if (route === 'notifications' && method === 'GET') { need(); return { notifications: db.notifications }; }
    if (route === 'notifications' && method === 'PATCH') { need(); db.notifications = db.notifications.map(item => ({ ...item, is_read: true })); offlineSave(db); return { ok: true }; }
    if (route === 'suggestions' && method === 'GET') { need(); return { suggestions: db.suggestions }; }
    if (route === 'suggestions' && method === 'POST') {
      const user = need();
      const suggestion = { id: `offline-sug-${Date.now()}`, subject: body.subject, message: body.message, status: 'nouveau', created_at: new Date().toISOString() };
      db.suggestions.push(suggestion); offlineSave(db);
      return { suggestion };
    }
    if (route === 'admin/reset' && method === 'POST') {
      adminOnly();
      db.documents = []; db.notifications = []; db.suggestions = []; db.activity = [];
      offlineSave(db);
      return { ok: true };
    }
    if (route === 'presence') return { ok: true };
    if (route === 'registrations') {
      throw offlineError("L'enregistrement d'une inscription nécessite le serveur local : lancez DEMARRER-GTA.cmd puis ouvrez http://127.0.0.1:3000", 501);
    }
    throw offlineError(`Action indisponible en mode hors-ligne (${route}).`, 501);
  }

  const api = async (path, options = {}) => {
    if (OFFLINE) return offlineApi(path, options);
    let response;
    try {
      response = await fetch(`/api/${path.replace(/^\//, '')}`, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
        body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
      });
    } catch {
      throw new Error("Serveur injoignable. Lancez DEMARRER-GTA.cmd, puis ouvrez http://127.0.0.1:3000/page/formulaire.html");
    }
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!response.ok) { const error = new Error(data.error || 'Une erreur est survenue.'); error.status = response.status; throw error; }
    return data;
  };

  const pageName = decodeURIComponent(location.pathname.split('/').pop() || '').toLowerCase();
  const pageKey = pageName.replace(/\.html$/, '');
  const isDashboard = ['ceejay', 'lepere', 'élève', 'eleve', 'prof'].includes(pageKey) || ['ceejay.html', 'lepere.html', 'élève.html', 'eleve.html', 'prof.html'].includes(pageName);
  const rolePages = { admin: 'CEEJAY.html', parent: 'lepere.html', prof: 'prof.html', staff: 'prof.html', eleve: 'élève.html' };
  const roleLabels = { admin: 'Administrateur', parent: 'Parent', prof: 'Professeur', staff: 'Staff', eleve: 'Élève' };
  let current = null;
  let profile = null;
  let users = [];
  let documents = [];
  let notifications = [];
  let suggestions = [];
  let notificationOutsideHandler = null;

  const toast = (message, type = 'info') => {
    if (typeof window.showToast === 'function' && !window.showToast.__gtaCloud) return window.showToast(message, type);
    const container = document.getElementById('toastContainer');
    if (!container) return window.alert(message);
    const node = document.createElement('div'); node.className = `toast ${type}`; node.textContent = message; container.appendChild(node);
    setTimeout(() => node.remove(), 4000);
  };
  const initials = name => String(name || 'GTA').trim().split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const displayRole = role => roleLabels[role] || role;
  const roleClass = role => ({ admin: 'admin', parent: 'staff', prof: 'prof', staff: 'staff', eleve: 'eleve' }[role] || 'staff');
  const formatDate = value => value ? new Date(value).toLocaleString('fr-FR') : '-';
  const pageForCurrent = role => rolePages[role] || 'formulaire.html';
  const legacyProfileKeys = { ceejay: 'gta_admin_profile', lepere: 'gta_admin2_profile', prof: 'gta_prof_profile', 'élève': 'gta_eleve_profile', eleve: 'gta_eleve_profile' };
  const getLegacyProfile = () => { try { return JSON.parse(localStorage.getItem(legacyProfileKeys[pageKey]) || 'null'); } catch { return null; } };
  const clearLegacyAvatar = () => { const key = legacyProfileKeys[pageKey]; if (!key) return; try { const value = JSON.parse(localStorage.getItem(key) || 'null'); if (value?.avatarData) { value.avatarData = null; localStorage.setItem(key, JSON.stringify(value)); } } catch {} };

  // ============================================================
  //  IMAGES : LE NOM DU FICHIER SUFFIT
  // ============================================================
  // Écrire « src="logo.jpg" » ou « url("Fond.JPG") » suffit : le dossier
  // Image/ est déduit de l'emplacement de gta-cloud.js lui-même. L'image
  // s'affiche donc que la page soit à la racine, dans page/ ou dans
  // n'importe quel sous-dossier, sans jamais écrire « ../Image/ ».
  // Un chemin déjà complet (Image/…, ../Image/…, https://…) n'est pas touché.
  const dossierImages = (() => {
    const source = document.currentScript?.src
      || [...document.scripts].find(script => /gta-cloud\.js/.test(script.src))?.src
      || '';
    return source ? source.replace(/[^/]*$/, '') + 'Image/' : 'Image/';
  })();

  // Un « nom court » = juste le fichier : pas de dossier, pas d'URL, une extension.
  function nomCourtVersChemin(valeur) {
    const brut = String(valeur ?? '').trim();
    if (!brut || brut.startsWith('#') || brut.startsWith('/') || brut.includes('/')) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(brut)) return '';
    if (!/\.[a-z0-9]{2,5}$/i.test(brut)) return '';
    return dossierImages + encodeURIComponent(brut);
  }

  function remplacerImagesCourtes(texte) {
    return String(texte ?? '').replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (entier, guillemet, valeur) => {
      const chemin = nomCourtVersChemin(valeur);
      return chemin ? `url(${guillemet}${chemin}${guillemet})` : entier;
    });
  }

  function corrigerImagesCourtes() {
    // 1. Les balises qui pointent vers un fichier.
    document.querySelectorAll('img[src], source[src], video[src], audio[src], link[rel~="icon"][href]').forEach(element => {
      const attribut = element.hasAttribute('src') ? 'src' : 'href';
      const chemin = nomCourtVersChemin(element.getAttribute(attribut));
      if (chemin) element.setAttribute(attribut, chemin);
    });
    // 2. Les fonds d'images des blocs <style>, dont les photos du site.
    document.querySelectorAll('style').forEach(bloc => {
      const corrige = remplacerImagesCourtes(bloc.textContent);
      if (corrige !== bloc.textContent) bloc.textContent = corrige;
    });
    // 3. Les fonds écrits dans un attribut style="…".
    document.querySelectorAll('[style*="url("]').forEach(element => {
      const style = element.getAttribute('style');
      const corrige = remplacerImagesCourtes(style);
      if (corrige !== style) element.setAttribute('style', corrige);
    });
  }

  // Tout de suite (les <style> déjà lus) puis après le chargement complet.
  corrigerImagesCourtes();
  // Exposé pour les pages qui ajoutent des images après coup, et pour les
  // attributs onerror qui veulent retenter avant d'afficher un remplacement.
  window.corrigerImagesCourtes = corrigerImagesCourtes;

  function setProfileUI(data) {
    profile = data || profile || {};
    const fullName = profile.full_name || current?.full_name || current?.username || 'Utilisateur';
    const shortName = fullName.split(' ')[0];
    ['headerUserName', 'welcomeName'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = shortName; });
    ['settingsFullname'].forEach(id => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = fullName; });
    const fields = { settingsEmail: profile.email || current?.email || '', settingsPhone: profile.phone || current?.phone || '', settingsUsername: profile.username || current?.username || '' };
    Object.entries(fields).forEach(([id, value]) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.value = value; });
    const avatar = profile.avatar_url;
    const headerImg = document.getElementById('headerAvatarImg'); const headerFallback = document.getElementById('headerAvatarFallback');
    const settingImg = document.getElementById('settingsAvatarImg'); const settingFallback = document.getElementById('settingsAvatarFallback'); const remove = document.getElementById('removeAvatarBtn');
    [headerFallback, settingFallback].forEach(el => { if (el) el.textContent = initials(fullName); });
    const avatarTargets = [[headerImg, headerFallback], [settingImg, settingFallback]];
    if (avatar) {
      avatarTargets.forEach(([img, fallback]) => {
        if (!img) return;
        img.dataset.gtaCloudAvatar = 'true';
        img.alt = `Photo de profil de ${fullName}`;
        img.loading = 'eager';
        img.referrerPolicy = 'no-referrer';
        img.style.display = 'block';
        if (fallback) fallback.style.display = 'none';
        img.onload = () => {
          img.style.display = 'block';
          if (fallback) fallback.style.display = 'none';
        };
        img.onerror = () => {
          img.style.display = 'none';
          img.removeAttribute('src');
          if (fallback) fallback.style.display = 'flex';
          if (remove) remove.style.display = 'none';
        };
        img.src = avatar;
        if (img.complete && img.naturalWidth > 0) {
          img.style.display = 'block';
          if (fallback) fallback.style.display = 'none';
        }
      });
      if (remove) remove.style.display = 'inline-flex';
    } else {
      avatarTargets.forEach(([img, fallback]) => {
        if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
        if (fallback) fallback.style.display = 'flex';
      });
      if (remove) remove.style.display = 'none';
    }
    const prefs = profile.preferences || {};
    ['soundEnabled', 'compactMode', 'confirmDelete'].forEach(key => { const el = document.querySelector(`[data-setting="${key}"]`); if (el) el.classList.toggle('active', Boolean(prefs[key])); });
  }

  async function protectDashboard() {
    try {
      const response = await api('auth/me');
      current = response.user;
      profile = response.profile || {};
      const expected = pageKey === 'ceejay' ? 'admin' : pageKey === 'lepere' ? 'parent' : pageKey === 'prof' ? 'prof' : 'eleve';
      const allowed = expected === 'prof' ? ['prof', 'staff'] : [expected];
      if (!allowed.includes(current.role)) { location.replace(pageForCurrent(current.role)); return null; }
      safeSessionSet('gta_user', JSON.stringify({ id: current.id, role: current.role, username: current.username }));
      setProfileUI(profile);
      return current;
    } catch (error) {
      safeSessionRemove('gta_user');
      location.replace('formulaire.html');
      return null;
    }
  }

  async function login(event) {
    event.preventDefault();
    const button = document.getElementById('btnConnexion'); const errorEl = document.getElementById('msgErreur');
    const username = document.getElementById('username')?.value.trim(); const password = document.getElementById('password')?.value || '';
    if (errorEl) errorEl.classList.remove('visible'); if (button) { button.disabled = true; button.textContent = 'Vérification…'; }
    try {
      const data = await api('auth/login', { method: 'POST', body: { username, password } });
      safeSessionSet('gta_user', JSON.stringify({ id: data.user.id, role: data.user.role, username: data.user.username }));
      if (button) { button.textContent = 'Connexion réussie — Redirection…'; button.style.background = 'linear-gradient(135deg, #10b981, #059669)'; }
      setTimeout(() => location.replace(data.user.page || pageForCurrent(data.user.role)), 250);
    } catch (error) {
      if (errorEl) { errorEl.textContent = error.message; errorEl.classList.add('visible'); }
      if (button) { button.disabled = false; button.textContent = 'Se connecter'; button.style.background = ''; }
    }
  }

  async function submitRegistration(event) {
    event.preventDefault();
    const form = event.target; const button = form.querySelector('.soumission-formulaire');
    const values = Object.fromEntries(['prenom', 'nom', 'classe', 'telephone', 'email', 'message'].map(id => [id, form.querySelector(`#${id}`)?.value.trim() || '']));
    // WhatsApp part en premier, et tout de suite : l'ouverture d'un nouvel onglet
    // n'est autorisée que pendant le geste de l'utilisateur, jamais après un await.
    // Toutes les informations saisies sont pré-remplies dans le message.
    const whatsAppOuvert = typeof window.ouvrirWhatsAppInscription === 'function'
      ? Boolean(window.ouvrirWhatsAppInscription(values))
      : false;
    if (button) { button.disabled = true; button.textContent = 'Enregistrement sécurisé…'; }
    try {
      const result = await api('registrations', { method: 'POST', body: values });
      if (result.telegram_sent) {
        if (button) button.textContent = whatsAppOuvert ? 'Demande envoyée sur WhatsApp + enregistrée !' : 'Inscription envoyée avec succès !';
      } else {
        if (button) button.textContent = whatsAppOuvert ? 'WhatsApp ouvert — demande enregistrée' : 'Demande enregistrée — appel de confirmation conseillé';
        toast('La demande est bien stockée. Telegram sera réessayé après configuration du bot.', 'warning');
      }
      form.reset();
    } catch (error) {
      if (button) button.textContent = whatsAppOuvert ? 'WhatsApp ouvert — pensez à envoyer le message' : 'Erreur — veuillez appeler le 01 73 04 55 19';
      toast(error.message, 'error');
    } finally {
      setTimeout(() => { if (button) { button.disabled = false; button.textContent = 'Envoyer ma demande d\'inscription →'; } }, 5000);
    }
  }

  // Le nombre d'élèves inscrits et le nombre total d'utilisateurs sont des
  // données de pilotage : elles restent réservées à l'administration.
  // Élèves, professeurs et parents ne doivent pas voir la volumétrie du site.
  const voitLesCompteursGlobaux = () => ['admin', 'staff'].includes(current?.role);

  function renderStats(stats) {
    const target = document.getElementById('statsContainer'); if (!target) return;
    const items = [
      { icone: 'fa-users', libelle: 'Utilisateurs en ligne', nombre: stats.online, sous: 'Présence des 5 dernières minutes' },
      { icone: 'fa-graduation-cap', libelle: 'Élèves inscrits', nombre: stats.students, sous: 'Profils actifs', reserveAdmin: true },
      { icone: 'fa-users-gear', libelle: 'Total utilisateurs', nombre: stats.users, sous: 'Tous rôles confondus', reserveAdmin: true },
      { icone: 'fa-file-lines', libelle: 'Documents', nombre: stats.documents, sous: 'Fichiers sécurisés' },
      // L'etat de la base doit refleter la realite : en mode hors-ligne il n'y
      // a aucune base distante joignable, afficher « OK » serait mensonger.
      { icone: 'fa-database', libelle: 'Base de données', nombre: OFFLINE ? 'Local' : 'OK', sous: OFFLINE ? 'Mode hors-ligne — données du navigateur' : 'Synchronisation opérationnelle' },
    ].filter(item => !item.reserveAdmin || voitLesCompteursGlobaux());
    target.innerHTML = items.map(({ icone, libelle, nombre, sous }) => `<div class="stat-card"><div class="stat-header"><div class="stat-icon"><i class="fa-solid ${icone}"></i></div><span class="stat-trend up"><i class="fa-solid fa-arrow-up"></i> Live</span></div><h3>${libelle}</h3><div class="number" data-target="${typeof nombre === 'number' ? nombre : 0}">${escapeHtml(nombre)}</div><p class="stat-sub">${sous}</p></div>`).join('');
  }

  function renderUsers() {
    const tbody = document.getElementById('usersListBody'); if (!tbody) return;
    const search = (document.getElementById('userSearchInput')?.value || '').toLowerCase(); const roleFilter = document.getElementById('userRoleFilter')?.value || '';
    const roleMap = { Administrateur: 'admin', Staff: 'staff', Professeur: 'prof', Élève: 'eleve', Parent: 'parent' };
    const filtered = users.filter(user => (!roleFilter || user.role === (roleMap[roleFilter] || roleFilter)) && (!search || [user.full_name, user.username, user.email].join(' ').toLowerCase().includes(search)));
    const count = document.getElementById('userCountInfo'); if (count) count.textContent = `${filtered.length} utilisateur(s) affiché(s) sur ${users.length} total`;
    tbody.innerHTML = filtered.length ? filtered.map(user => `<tr><td><div class="user-cell"><div class="user-cell-avatar ${roleClass(user.role)}">${escapeHtml(initials(user.full_name))}</div><div class="user-cell-info"><strong>${escapeHtml(user.full_name)}</strong><span>${escapeHtml(user.phone || '')}</span></div></div></td><td style="font-family:monospace;font-size:.8rem;color:var(--text-muted)">${escapeHtml(user.username)}</td><td>${escapeHtml(user.email || '-')}</td><td><span class="badge-role">${escapeHtml(displayRole(user.role))}</span></td><td><span class="status-dot ${user.last_login_at ? 'online' : 'offline'}"></span>${user.last_login_at ? 'Actif' : 'Jamais connecté'}</td><td><div class="action-btns"><button class="action-btn" title="Modifier" onclick="openEditUser('${user.id}')"><i class="fa-solid fa-pen"></i></button><button class="action-btn danger" title="Supprimer" onclick="deleteUserById('${user.id}')"><i class="fa-solid fa-trash"></i></button></div></td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:28px">Aucun utilisateur trouvé</td></tr>';
  }

  function renderStudents() {
    const container = document.getElementById('elevesListContainer'); if (!container) return;
    const search = (document.getElementById('eleveSearchInput')?.value || '').toLowerCase(); const list = users.filter(u => u.role === 'eleve' && (!search || [u.full_name, u.email, u.username].join(' ').toLowerCase().includes(search)));
    container.innerHTML = list.length ? `<div class="table-wrapper"><table class="user-table"><thead><tr><th>Élève</th><th>Email</th><th>Téléphone</th><th>Compte</th></tr></thead><tbody>${list.map(u => `<tr><td><div class="user-cell"><div class="user-cell-avatar eleve">${escapeHtml(initials(u.full_name))}</div><div class="user-cell-info"><strong>${escapeHtml(u.full_name)}</strong></div></div></td><td>${escapeHtml(u.email || '-')}</td><td>${escapeHtml(u.phone || '-')}</td><td style="font-family:monospace">${escapeHtml(u.username)}</td></tr>`).join('')}</tbody></table></div><p style="font-size:.75rem;color:var(--text-muted);margin-top:12px">${list.length} élève(s)</p>` : '<p style="color:var(--text-muted);text-align:center;padding:28px">Aucun élève trouvé.</p>';
  }

  function renderDocuments() {
    const container = document.getElementById('documentsList'); if (!container) return;
    const search = (document.getElementById('docSearchInput')?.value || '').toLowerCase(); const list = documents.filter(d => !search || d.name.toLowerCase().includes(search));
    const count = document.getElementById('docCount'); if (count) count.textContent = `${list.length} fichier(s) sur ${documents.length}`;
    container.innerHTML = list.length ? list.map(doc => `<div class="doc-item"><div class="doc-info"><i class="fa-solid fa-file-lines" style="font-size:1.3rem"></i><div class="doc-details"><strong>${escapeHtml(doc.name)}</strong><span>${(Number(doc.size_bytes || 0) / 1024).toFixed(1)} Ko — ${formatDate(doc.created_at)}</span></div></div><div class="doc-actions"><button class="action-btn" title="Télécharger" onclick="downloadDoc('${doc.id}')"><i class="fa-solid fa-download"></i></button>${current.role !== 'eleve' ? `<button class="action-btn danger" title="Supprimer" onclick="deleteDoc('${doc.id}')"><i class="fa-solid fa-trash"></i></button>` : ''}</div></div>`).join('') : '<p style="color:var(--text-muted);text-align:center;padding:20px">Aucun document trouvé.</p>';
  }

  function renderSuggestions() {
    const container = document.getElementById('suggestionsHistory'); if (!container) return;
    container.innerHTML = suggestions.length ? suggestions.map(s => `<div class="doc-item"><div class="doc-info"><i class="fa-solid fa-message" style="color:var(--bleu)"></i><div class="doc-details"><strong>${escapeHtml(s.subject)}</strong><span>${escapeHtml(s.message)} — ${formatDate(s.created_at)}</span></div></div><span class="badge-role">${escapeHtml(s.status)}</span></div>`).join('') : '<p style="color:var(--text-muted);text-align:center;padding:20px">Aucune suggestion envoyée.</p>';
  }

  // ============================================================
  //  WHATSAPP — SUGGESTIONS ET PLAINTES
  // ============================================================
  // Numéro du propriétaire du lien WhatsApp (indicatif +225 puis le numéro
  // local 01 73 04 55 19). wa.me refuse le « + », les espaces et les tirets.
  const NUMERO_WHATSAPP_GTA = '2250173045519';

  // Le sujet et le message saisis partent sur le WhatsApp du Groupe GTA.
  function construireLienWhatsAppSuggestion() {
    const sujet = (document.getElementById('suggestionSubject')?.value || '').trim();
    const message = (document.getElementById('suggestionMessage')?.value || '').trim();
    if (!sujet && !message) return '';
    const auteur = profile?.full_name || current?.full_name || current?.username || 'Utilisateur GTA';
    const role = displayRole(current?.role || '');
    const dateHeure = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Abidjan' });
    const texte = [
      '📩 *SUGGESTION / MESSAGE — GROUPE GTA*',
      '',
      '👤 *De :* ' + auteur + (role ? ' (' + role + ')' : ''),
      '📌 *Sujet :* ' + (sujet || 'Non renseigné'),
      '💬 *Message :* ' + (message || 'Non renseigné'),
      '',
      '🕐 _Envoyé le ' + dateHeure + '_'
    ].join('\n');
    return 'https://wa.me/' + NUMERO_WHATSAPP_GTA + '?text=' + encodeURIComponent(texte);
  }

  // Conserve la suggestion dans Supabase : l'historique affiché sur les
  // dashboards reste alimenté, même si le message part d'abord sur WhatsApp.
  async function enregistrerSuggestion() {
    const champSujet = document.getElementById('suggestionSubject');
    const champMessage = document.getElementById('suggestionMessage');
    try {
      await api('suggestions', { method: 'POST', body: { subject: champSujet?.value || '', message: champMessage?.value || '' } });
      if (champSujet) champSujet.value = '';
      if (champMessage) champMessage.value = '';
      const result = await api('suggestions');
      suggestions = result.suggestions || [];
      renderSuggestions();
      toast('Votre message a été transmis.', 'success');
    } catch (erreur) {
      toast(erreur.message, 'error');
    }
  }

  // Le bouton « Envoyer » de la partie suggestion est lui-même le lien
  // WhatsApp : le sujet et le message saisis partent sur le WhatsApp du
  // Groupe GTA. Renvoie true pour laisser le navigateur ouvrir le lien.
  window.envoyerSuggestionWhatsApp = element => {
    const url = construireLienWhatsAppSuggestion();
    if (!url) {
      toast('Renseignez le sujet et le message avant de les envoyer sur WhatsApp.', 'error');
      return false;
    }
    element.href = url;
    enregistrerSuggestion();
    return true;
  };

  function renderNotifications() {
    const badge = document.querySelector('.notif-badge'); const unread = notifications.filter(n => !n.is_read).length; if (badge) { badge.textContent = unread; badge.style.display = unread ? 'inline-flex' : 'none'; }
  }
  function closeNotificationsPanel() {
    document.getElementById('gtaNotificationPanel')?.remove();
    if (notificationOutsideHandler) {
      document.removeEventListener('click', notificationOutsideHandler, true);
      notificationOutsideHandler = null;
    }
  }
  function showNotifications() {
    if (document.getElementById('gtaNotificationPanel')) { closeNotificationsPanel(); return; }
    const panel = document.createElement('div');
    panel.id = 'gtaNotificationPanel';
    panel.style.cssText = 'position:fixed;z-index:7000;right:24px;top:80px;width:min(380px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:#111827;border:1px solid rgba(59,130,246,.35);border-radius:16px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.5);color:#fff';
    document.body.appendChild(panel);
    panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><strong>Notifications</strong><button class="action-btn" id="gtaCloseNotifications"><i class="fa-solid fa-xmark"></i></button></div>${notifications.length ? notifications.map(n => `<div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,.08);opacity:${n.is_read ? '.65' : '1'}"><strong>${escapeHtml(n.title)}</strong><p style="font-size:.8rem;color:#94a3b8;margin:5px 0">${escapeHtml(n.message)}</p><small style="color:#64748b">${formatDate(n.created_at)}</small></div>`).join('') : '<p style="color:#94a3b8">Aucune notification.</p>'}<button id="gtaReadNotifications" class="btn-secondary" style="margin-top:14px;width:100%;justify-content:center">Marquer comme lues</button>`;
    notificationOutsideHandler = event => {
      const bell = document.getElementById('notifBtn');
      if (!panel.contains(event.target) && !bell?.contains(event.target)) closeNotificationsPanel();
    };
    setTimeout(() => document.addEventListener('click', notificationOutsideHandler, true), 0);
    document.getElementById('gtaCloseNotifications')?.addEventListener('click', closeNotificationsPanel);
    document.getElementById('gtaReadNotifications')?.addEventListener('click', async () => {
      await api('notifications', { method: 'PATCH', body: {} });
      notifications = notifications.map(n => ({ ...n, is_read: true }));
      renderNotifications();
      closeNotificationsPanel();
    });
  }

  async function migrateLegacyLocalAvatar() {
    if (profile?.avatar_url || !current?.id) return;
    const legacy = getLegacyProfile();
    if (!legacy?.avatarData || !String(legacy.avatarData).startsWith('data:image/')) return;
    try {
      const blob = await fetch(legacy.avatarData).then(response => response.blob());
      if (!blob.size || blob.size > 15 * 1024 * 1024) return toast('L’ancienne photo de profil dépasse 15 Mo et doit être sélectionnée à nouveau.', 'warning');
      const signed = await api('profile/avatar-upload-url', { method: 'POST', body: { name: 'photo-profil-migree.jpg', size: blob.size, type: blob.type || 'image/jpeg' } });
      const uploadResponse = await fetch(signed.upload.signedUrl, { method: 'PUT', headers: { 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'false' }, body: blob });
      if (!uploadResponse.ok) throw new Error('Migration de la photo impossible.');
      await api('profile', { method: 'PATCH', body: { storagePath: signed.upload.path } });
      const result = await api('profile'); profile = result.profile || profile; setProfileUI(profile); clearLegacyAvatar();
      toast('Votre ancienne photo de profil a été synchronisée dans Supabase.', 'success');
    } catch (error) { console.warn('[GTA legacy avatar migration]', error.message); }
  }

  async function loadCloudData() {
    const [dashboard, userResult, docsResult, profileResult, notifResult] = await Promise.all([api('dashboard'), api('users'), api('documents'), api('profile'), api('notifications')]);
    users = userResult.users || []; documents = docsResult.documents || []; profile = profileResult.profile || profile; notifications = notifResult.notifications || [];
    renderStats(dashboard.stats); renderUsers(); renderStudents(); renderDocuments(); renderNotifications(); setProfileUI(profile);
    if (typeof window.renderActivity === 'function') { try { window.renderActivity(); } catch {} }
    if (document.getElementById('suggestionsHistory')) { const result = await api('suggestions'); suggestions = result.suggestions || []; renderSuggestions(); }
  }

  function bindDashboardActions() {
    window.renderUsersList = renderUsers; window.renderElevesList = renderStudents; window.renderDocumentsList = renderDocuments; window.downloadDoc = async id => { const doc = documents.find(d => d.id === id); if (doc?.download_url) window.open(doc.download_url, '_blank', 'noopener'); else toast('Fichier indisponible.', 'error'); };
    window.openEditUser = id => { const user = users.find(u => u.id === id); if (!user) return; document.getElementById('editUserId').value = id; document.getElementById('editFullname').value = user.full_name || ''; document.getElementById('editEmail').value = user.email || ''; document.getElementById('editPhone').value = user.phone || ''; document.getElementById('editRole').value = displayRole(user.role); document.getElementById('editPassword').value = ''; document.getElementById('editUserModal')?.classList.add('active'); };
    window.closeEditModal = () => document.getElementById('editUserModal')?.classList.remove('active');
    window.saveEditUser = async () => { const id = document.getElementById('editUserId').value; const roleLabelsReverse = { Administrateur: 'admin', Staff: 'staff', Professeur: 'prof', Élève: 'eleve', Parent: 'parent' }; try { await api(`users/${id}`, { method: 'PATCH', body: { full_name: document.getElementById('editFullname').value, email: document.getElementById('editEmail').value, phone: document.getElementById('editPhone').value, role: roleLabelsReverse[document.getElementById('editRole').value] || document.getElementById('editRole').value, password: document.getElementById('editPassword').value || undefined } }); toast('Utilisateur mis à jour.', 'success'); window.closeEditModal(); await loadCloudData(); } catch (e) { toast(e.message, 'error'); } };
    window.deleteUserById = async id => { if (!confirm('Confirmer la suppression de cet utilisateur ?')) return; try { await api(`users/${id}`, { method: 'DELETE' }); toast('Utilisateur supprimé.', 'success'); await loadCloudData(); } catch (e) { toast(e.message, 'error'); } };
    window.deleteDoc = async id => { if (!confirm('Confirmer la suppression de ce document ?')) return; try { await api(`documents/${id}`, { method: 'DELETE' }); toast('Document supprimé.', 'success'); await loadCloudData(); } catch (e) { toast(e.message, 'error'); } };
    const saveProfileToCloud = async event => {
      if (event?.preventDefault) event.preventDefault();
      if (event?.stopImmediatePropagation) event.stopImmediatePropagation();
      const fullName = document.getElementById('settingsFullname')?.value.trim() || '';
      const email = document.getElementById('settingsEmail')?.value.trim() || '';
      const phone = document.getElementById('settingsPhone')?.value.trim() || '';
      const username = document.getElementById('settingsUsername')?.value.trim() || profile?.username || current?.username || '';
      if (!fullName) return toast('Le nom complet est requis.', 'error');
      const button = document.querySelector('button[onclick*="saveProfileSettings"]');
      const originalText = button?.innerHTML;
      if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Enregistrement…'; }
      try {
        await api('profile', { method: 'PATCH', body: { fullName, email, phone, username, preferences: profile?.preferences || {} } });
        const result = await api('profile'); profile = result.profile || profile; setProfileUI(profile);
        clearLegacyAvatar();
        toast('Toutes les modifications ont été enregistrées dans Supabase.', 'success');
      } catch (e) { toast(e.message, 'error'); }
      finally { if (button) { button.disabled = false; button.innerHTML = originalText || 'Enregistrer les modifications'; } }
    };
    window.saveProfileSettings = saveProfileToCloud;
    // Les dashboards historiques possèdent encore updateAllAvatars(). Une fois
    // Supabase initialisé, cette fonction doit relire l’état cloud au lieu de
    // repeindre un ancien avatar local ou les initiales par-dessus l’image.
    window.updateAllAvatars = () => { if (profile) setProfileUI(profile); };
    document.querySelectorAll('[data-gta-save-profile], button[onclick*="saveProfileSettings"]').forEach(button => {
      button.addEventListener('click', saveProfileToCloud, true);
    });
    window.changePassword = async () => { try { await api('profile/password', { method: 'POST', body: { oldPassword: document.getElementById('settingsOldPwd')?.value, newPassword: document.getElementById('settingsNewPwd')?.value, confirmPassword: document.getElementById('settingsConfirmPwd')?.value } }); toast('Mot de passe modifié.', 'success'); ['settingsOldPwd', 'settingsNewPwd', 'settingsConfirmPwd'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); } catch (e) { toast(e.message, 'error'); } };
    window.toggleSetting = async element => { element.classList.toggle('active'); const key = element.dataset.setting; profile = profile || {}; profile.preferences = { ...(profile.preferences || {}), [key]: element.classList.contains('active') }; try { await api('profile', { method: 'PATCH', body: { preferences: profile.preferences } }); toast('Préférence enregistrée.', 'info'); } catch (e) { toast(e.message, 'error'); } };
    window.removeAvatar = async () => { try { await api('profile', { method: 'PATCH', body: { removeAvatar: true } }); profile.avatar_url = null; profile.avatar_path = null; clearLegacyAvatar(); setProfileUI(profile); toast('Photo supprimée.', 'success'); } catch (e) { toast(e.message, 'error'); } };
    window.sendSuggestion = enregistrerSuggestion;
    const createButton = document.getElementById('createUserBtn');
    createButton?.addEventListener('click', async event => { event.preventDefault(); event.stopImmediatePropagation(); try { await api('users', { method: 'POST', body: { username: document.getElementById('newUsername').value, password: document.getElementById('newPassword').value, full_name: document.getElementById('newFullname').value, email: document.getElementById('newEmail').value, phone: document.getElementById('newPhone').value, role: ({ Administrateur: 'admin', Staff: 'staff', Professeur: 'prof', Élève: 'eleve' })[document.getElementById('newRole').value] || 'eleve' } }); toast('Utilisateur créé et disponible immédiatement.', 'success'); ['newUsername', 'newPassword', 'newFullname', 'newEmail', 'newPhone'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; }); await loadCloudData(); } catch (e) { toast(e.message, 'error'); } }, true);
    const fileInput = document.getElementById('fileInput'); const trigger = document.getElementById('triggerUpload'); const zone = document.getElementById('uploadZone');
    const upload = async file => {
      const maxBytes = 15 * 1024 * 1024;
      if (file.size > maxBytes) return toast('Fichier trop volumineux (max 15 Mo).', 'error');
      try {
        toast(`Téléversement de « ${file.name} »…`, 'info');
        const signed = await api('documents/upload-url', { method: 'POST', body: { name: file.name, size: file.size, type: file.type } });
        const uploadResponse = await fetch(signed.upload.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file });
        if (!uploadResponse.ok) throw new Error('Le téléversement vers Supabase a échoué.');
        await api('documents', { method: 'POST', body: { name: file.name, size: file.size, type: file.type, storagePath: signed.upload.path } });
        toast(`« ${file.name} » enregistré dans Supabase.`, 'success');
        await loadCloudData();
      } catch (e) { toast(e.message, 'error'); }
    };
    const chooseFiles = event => { event.preventDefault(); event.stopImmediatePropagation(); Array.from(fileInput?.files || []).forEach(upload); if (fileInput) fileInput.value = ''; };
    fileInput?.addEventListener('change', chooseFiles, true); trigger?.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); fileInput?.click(); }, true); zone?.addEventListener('drop', event => { event.preventDefault(); event.stopImmediatePropagation(); Array.from(event.dataTransfer.files || []).forEach(upload); }, true);
    const avatarInput = document.getElementById('avatarFileInput'); avatarInput?.addEventListener('change', async event => {
      event.preventDefault(); event.stopImmediatePropagation();
      const file = avatarInput.files?.[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) return toast('Photo de profil trop lourde (max 15 Mo).', 'error');
      if (!file.type.startsWith('image/')) return toast('Sélectionnez une image valide.', 'error');
      try {
        toast('Téléversement de la photo…', 'info');
        const signed = await api('profile/avatar-upload-url', { method: 'POST', body: { name: file.name, size: file.size, type: file.type } });
        const uploadResponse = await fetch(signed.upload.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type, 'x-upsert': 'false' }, body: file });
        if (!uploadResponse.ok) throw new Error('Le téléversement de la photo vers Supabase a échoué.');
        await api('profile', { method: 'PATCH', body: { storagePath: signed.upload.path } });
        const result = await api('profile');
        profile = result.profile;
        setProfileUI(profile);
        toast('Photo de profil synchronisée sur tous vos appareils.', 'success');
      } catch (e) { toast(e.message, 'error'); }
      finally { if (avatarInput) avatarInput.value = ''; }
    }, true);
    const bell = document.getElementById('notifBtn'); bell?.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); showNotifications(); }, true);
    const logout = document.getElementById('logoutBtn'); logout?.addEventListener('click', async event => { event.preventDefault(); event.stopImmediatePropagation(); await api('auth/logout', { method: 'POST' }).catch(() => {}); safeSessionRemove('gta_user'); location.replace('formulaire.html'); }, true);
    const reset = document.getElementById('resetAllBtn'); reset?.addEventListener('click', async event => { event.preventDefault(); event.stopImmediatePropagation(); if (confirm('Réinitialiser les données opérationnelles de la plateforme ?')) { try { await api('admin/reset', { method: 'POST' }); toast('Données réinitialisées.', 'success'); await loadCloudData(); } catch (e) { toast(e.message, 'error'); } } }, true);
    setInterval(() => api('presence', { method: 'POST' }).catch(() => {}), 60000);
    setInterval(() => loadCloudData().catch(() => {}), 120000);
  }

  async function boot() {
    if (pageKey === 'index') window.gererSoumissionFormulaire = submitRegistration;
    if (pageKey === 'formulaire') window.gererConnexion = login;
    // Les images écrites avec leur seul nom sont complétées ici aussi : tout
    // ce qui a été ajouté après le premier passage est rattrapé.
    corrigerImagesCourtes();
    // Mode hors-ligne : signalé uniquement dans la console du navigateur, pour
    // ne pas afficher d'element visuel sur la page.
    if (OFFLINE) console.info('[GTA] Mode hors-ligne : page ouverte depuis le disque. Les données ne sont pas synchronisées avec le serveur.');
    if (isDashboard) {
      const user = await protectDashboard();
      if (!user) return;
      bindDashboardActions();
      // Une erreur de chargement ne doit jamais laisser la page vide sans explication.
      try { await loadCloudData(); } catch (error) { console.warn('[GTA cloud]', error.message); toast(error.message, 'warning'); }
      await migrateLegacyLocalAvatar();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
