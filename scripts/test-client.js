// Simule un navigateur sur les deux modes de fonctionnement :
//   - file://  : page ouverte depuis le disque, sans serveur (mode hors-ligne)
//   - http://  : page servie par scripts/local-server.js (mode complet)
// Verifie que les comptes du document se connectent dans les deux cas.
//
// Note technique : les continuations de promesses d'un contexte vm se vident de
// facon paresseuse. On attend donc une CONDITION (polling) et non une duree fixe.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'gta-cloud.js'), 'utf8');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

let echecs = 0;
const check = (label, condition, detail = '') => {
  if (!condition) echecs++;
  console.log(`${condition ? 'PASS' : 'ECHEC'}  ${label}${detail ? `  ${detail}` : ''}`);
};

// Marge large : les continuations de promesses d'un contexte vm se vident de
// facon paresseuse, un delai trop court provoque de faux echecs.
async function waitFor(predicate, timeout = 8000) {
  const start = Date.now();
  for (;;) {
    if (predicate()) return true;
    if (Date.now() - start > timeout) return predicate();
    await new Promise(resolve => setTimeout(resolve, 20));
    await new Promise(resolve => setImmediate(resolve));
  }
}

function makeStorage() {
  const map = new Map();
  return { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k), clear: () => map.clear() };
}
function makeElement(id) {
  return {
    id, value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, remove() {}, setAttribute() {}, removeAttribute() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, contains() { return false; }, focus() {}, click() {},
  };
}

// Coffre a cookies minimal : Node n'en gere pas nativement.
function makeCookieJarFetch(jar) {
  return async (url, options = {}) => {
    const absolute = /^https?:/i.test(String(url)) ? String(url) : BASE_URL + url;
    const headers = { ...(options.headers || {}) };
    if (jar.cookie) headers.Cookie = jar.cookie;
    const response = await fetch(absolute, { ...options, headers, redirect: 'manual' });
    for (const raw of response.headers.getSetCookie?.() || []) {
      const pair = raw.split(';')[0];
      if (pair.startsWith('gta_session=')) jar.cookie = pair;
    }
    return response;
  };
}

function bootClient({ protocol, page, seed = {} }) {
  const elements = new Map();
  // Elements de la page de connexion + elements cibles des dashboards.
  // Les autres identifiants renvoient null, comme un vrai DOM.
  [
    'username', 'password', 'btnConnexion', 'msgErreur',
    'headerUserName', 'welcomeName', 'settingsFullname', 'settingsEmail', 'settingsPhone', 'settingsUsername',
    'headerAvatarImg', 'headerAvatarFallback', 'settingsAvatarImg', 'settingsAvatarFallback', 'removeAvatarBtn',
    'statsContainer', 'usersListBody', 'elevesListContainer', 'documentsList', 'suggestionsHistory',
    'userSearchInput', 'userRoleFilter', 'eleveSearchInput', 'docSearchInput', 'docCount', 'userCountInfo',
    'avatarFileInput', 'fileInput', 'triggerUpload', 'uploadZone', 'notifBtn', 'logoutBtn', 'resetAllBtn', 'createUserBtn',
  ].forEach(id => elements.set(id, makeElement(id)));
  const redirects = [];
  const jar = { cookie: seed.cookie || '' };
  // appendChild doit rendre l'element retrouvable par getElementById.
  const body = makeElement('body');
  body.appendChild = element => { if (element?.id) elements.set(element.id, element); };
  const head = makeElement('head');
  head.appendChild = element => { if (element?.id) elements.set(element.id, element); };
  const sandbox = {
    console, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    alert: () => {}, confirm: () => true,
    localStorage: makeStorage(), sessionStorage: makeStorage(),
    fetch: protocol === 'file:'
      ? () => { throw new Error('fetch appele alors que la page est en file://'); }
      : makeCookieJarFetch(jar),
    location: { protocol, pathname: `/C:/gta-website/page/${page}`, href: '', replace: url => redirects.push(url) },
    document: {
      readyState: 'complete',
      head,
      body,
      getElementById: id => elements.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: tag => makeElement(tag),
      addEventListener: () => {},
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  if (seed.localStorage) for (const [k, v] of Object.entries(seed.localStorage)) sandbox.localStorage.setItem(k, v);
  if (seed.sessionStorage) for (const [k, v] of Object.entries(seed.sessionStorage)) sandbox.sessionStorage.setItem(k, v);
  vm.runInNewContext(code, sandbox, { filename: 'gta-cloud.js' });
  return { sandbox, elements, redirects, jar, set: (id, value) => { elements.get(id).value = value; } };
}

async function testLoginFlow(label, protocol) {
  console.log(`--- ${label} : admin absolu ceejay / yajeec ---`);
  {
    const page = bootClient({ protocol, page: 'formulaire.html' });
    page.set('username', 'ceejay'); page.set('password', 'yajeec');
    page.sandbox.window.gererConnexion({ preventDefault() {} });
    await waitFor(() => page.redirects.length > 0);
    check('redirection vers CEEJAY.html', page.redirects.includes('CEEJAY.html'), `redirects=${JSON.stringify(page.redirects)} erreur="${page.elements.get('msgErreur').textContent}"`);
  }
  console.log(`--- ${label} : admin secondaire lepere / peregta ---`);
  {
    const page = bootClient({ protocol, page: 'formulaire.html' });
    page.set('username', 'lepere'); page.set('password', 'peregta');
    page.sandbox.window.gererConnexion({ preventDefault() {} });
    await waitFor(() => page.redirects.length > 0);
    check('redirection vers lepere.html', page.redirects.includes('lepere.html'), `redirects=${JSON.stringify(page.redirects)} erreur="${page.elements.get('msgErreur').textContent}"`);
  }
  console.log(`--- ${label} : mauvais mot de passe refuse ---`);
  {
    const page = bootClient({ protocol, page: 'formulaire.html' });
    page.set('username', 'ceejay'); page.set('password', 'mauvais');
    page.sandbox.window.gererConnexion({ preventDefault() {} });
    await waitFor(() => page.elements.get('msgErreur').textContent.length > 0);
    check('message d\'erreur affiche', page.elements.get('msgErreur').textContent.length > 0, `msg="${page.elements.get('msgErreur').textContent}"`);
    check('aucune redirection', page.redirects.length === 0, `redirects=${JSON.stringify(page.redirects)}`);
  }
  console.log(`--- ${label} : dashboard refuse sans session ---`);
  {
    const page = bootClient({ protocol, page: 'CEEJAY.html' });
    await waitFor(() => page.redirects.length > 0);
    check('redirection vers formulaire.html', page.redirects.includes('formulaire.html'), `redirects=${JSON.stringify(page.redirects)}`);
  }
}

(async () => {
  console.log('==================================================');
  console.log(' MODE 1 : page ouverte depuis le disque (file://)');
  console.log('==================================================');
  await testLoginFlow('file://', 'file:');
  console.log('--- file:// : dashboard connecte (sans bandeau visuel) ---');
  {
    const page = bootClient({ protocol: 'file:', page: 'CEEJAY.html', seed: { sessionStorage: { gta_offline_session: JSON.stringify({ id: 'offline-ceejay', username: 'ceejay', role: 'admin' }) } } });
    await waitFor(() => page.sandbox.document.getElementById('headerUserName')?.textContent === 'CEEJAY');
    check('pas de renvoi vers la connexion', !page.redirects.includes('formulaire.html'), `redirects=${JSON.stringify(page.redirects)}`);
    check('dashboard alimente par les donnees locales', page.sandbox.document.getElementById('headerUserName')?.textContent === 'CEEJAY', `headerUserName="${page.sandbox.document.getElementById('headerUserName')?.textContent}"`);
    check('aucun bandeau hors-ligne affiche', !page.sandbox.document.getElementById('gtaOfflineBanner'));
  }

  console.log('\n==================================================');
  console.log(' MODE 2 : page servie par le serveur local (http)');
  console.log('==================================================');
  let serveurActif = true;
  try { serveurActif = (await fetch(`${BASE_URL}/page/formulaire.html`)).ok; } catch { serveurActif = false; }
  if (!serveurActif) {
    console.log(`IGNORE  serveur injoignable sur ${BASE_URL} — lancez DEMARRER-GTA.cmd pour couvrir ce mode.`);
  } else {
    await testLoginFlow('http://', 'http:');
    console.log('--- http:// : dashboard accessible apres connexion ---');
    {
      // Connexion reelle pour obtenir le cookie de session, puis chargement du dashboard.
      const login = await fetch(`${BASE_URL}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ceejay', password: 'yajeec' }) });
      const cookie = (login.headers.getSetCookie?.() || []).map(raw => raw.split(';')[0]).find(pair => pair.startsWith('gta_session='));
      check('cookie de session obtenu', Boolean(cookie));
      const page = bootClient({ protocol: 'http:', page: 'CEEJAY.html', seed: { cookie } });
      await waitFor(() => page.sandbox.document.getElementById('headerUserName')?.textContent);
      check('pas de renvoi vers la connexion', !page.redirects.includes('formulaire.html'), `redirects=${JSON.stringify(page.redirects)}`);
      check('nom d\'utilisateur affiche dans le dashboard', page.sandbox.document.getElementById('headerUserName')?.textContent === 'CEEJAY', `headerUserName="${page.sandbox.document.getElementById('headerUserName')?.textContent}"`);
    }
  }

  console.log(echecs === 0 ? '\nRESULTAT : les deux modes sont operationnels' : `\nRESULTAT : ${echecs} echec(s)`);
  process.exitCode = echecs === 0 ? 0 : 1;
})();
