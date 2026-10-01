const crypto = require('crypto');
const { supabaseRest } = require('./supabase');
const { getCookies, setCookie } = require('./http');

const SESSION_COOKIE = 'gta_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_SECRET = process.env.SESSION_SECRET || 'gta-development-session-secret-change-me';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function readSession(req) {
  const value = getCookies(req)[SESSION_COOKIE];
  if (!value) return null;
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function issueSession(res, user) {
  const token = signSession({ sub: user.id, username: user.username, role: user.role, exp: Date.now() + SESSION_TTL_SECONDS * 1000 });
  setCookie(res, SESSION_COOKIE, token, { maxAge: SESSION_TTL_SECONDS });
}

function clearSession(res) {
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
}

async function getUserBySession(req) {
  const session = readSession(req);
  if (!session?.sub) return null;
  const { data } = await supabaseRest('gta_users', {
    query: `id=eq.${encodeURIComponent(session.sub)}&select=id,username,full_name,email,phone,role,permissions,is_active,last_login_at,created_at&limit=1`,
  });
  return Array.isArray(data) && data[0]?.is_active ? data[0] : null;
}

function roleCanManageUsers(role) { return role === 'admin'; }
// Envoi de documents partagés : tous les comptes connectés y ont droit
// (l'administrateur absolu, les parents, les professeurs, le staff et les
// élèves). Seule la suppression reste encadrée, voir deleteDocument().
function roleCanWriteShared(role) { return ['admin', 'parent', 'prof', 'staff', 'eleve'].includes(role); }

module.exports = { hashPassword, verifyPassword, issueSession, clearSession, readSession, getUserBySession, roleCanManageUsers, roleCanWriteShared };
