// Test de bout en bout de l'authentification GTA.
// Usage : node scripts/test-login.js  (le serveur local doit tourner sur :3000)
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';

let echecs = 0;
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) echecs++;
  console.log(`${ok ? 'PASS' : 'ECHEC'}  ${label}${detail ? `  ${detail}` : ''}`);
}

async function login(username, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: response.status, data, cookie: response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie') || '' };
}

(async () => {
  console.log('--- 1. Admin absolu : ceejay / yajeec ---');
  const ceejay = await login('ceejay', 'yajeec');
  check('connexion acceptee (200)', ceejay.status === 200, `status=${ceejay.status} ${JSON.stringify(ceejay.data).slice(0, 200)}`);
  check('role = admin', ceejay.data?.user?.role === 'admin', `role=${ceejay.data?.user?.role}`);
  check('redirection vers CEEJAY.html', ceejay.data?.user?.page === 'CEEJAY.html', `page=${ceejay.data?.user?.page}`);
  check('mot de passe jamais renvoye', !JSON.stringify(ceejay.data).includes('yajeec'));
  check('cookie de session emis', ceejay.cookie.includes('gta_session'));

  console.log('--- 2. Admin secondaire : lepere / peregta ---');
  const lepere = await login('lepere', 'peregta');
  check('connexion acceptee (200)', lepere.status === 200, `status=${lepere.status} ${JSON.stringify(lepere.data).slice(0, 200)}`);
  check('role = parent', lepere.data?.user?.role === 'parent', `role=${lepere.data?.user?.role}`);
  check('redirection vers lepere.html', lepere.data?.user?.page === 'lepere.html', `page=${lepere.data?.user?.page}`);

  console.log('--- 3. Mots de passe refuses ---');
  const mauvais = await login('ceejay', 'mauvais');
  check('mauvais mot de passe rejete (401)', mauvais.status === 401, `status=${mauvais.status}`);
  const croise = await login('ceejay', 'peregta');
  check('mot de passe croise rejete (401)', croise.status === 401, `status=${croise.status}`);
  const inconnu = await login('inconnu', 'yajeec');
  check('identifiant inconnu rejete (401)', inconnu.status === 401, `status=${inconnu.status}`);

  console.log('--- 4. Session et protection des dashboards ---');
  const cookie = ceejay.cookie.split(';')[0];
  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } });
  const meData = await me.json().catch(() => ({}));
  check('session valide sur /auth/me (200)', me.status === 200, `status=${me.status} ${JSON.stringify(meData).slice(0, 200)}`);
  check('/auth/me renvoie bien ceejay', meData?.user?.username === 'ceejay', `username=${meData?.user?.username}`);

  const sansSession = await fetch(`${BASE}/api/auth/me`);
  check('dashboard refuse sans session (401)', sansSession.status === 401, `status=${sansSession.status}`);

  const falsifie = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: 'gta_session=eyJzdWIiOiJmYWtlIn0.signaturebidon' } });
  check('cookie falsifie refuse (401)', falsifie.status === 401, `status=${falsifie.status}`);

  console.log(echecs === 0 ? '\nRESULTAT : tous les tests passent' : `\nRESULTAT : ${echecs} echec(s)`);
  process.exitCode = echecs === 0 ? 0 : 1;
})();
