const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// Charge .env.local (non versionne) avant de require l'API : les modules
// api/_lib/*.js lisent process.env au chargement du module.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
  return true;
}
const envFiles = ['.env.local', '.env'].filter(loadEnvFile);
if (!envFiles.length) {
  console.warn('[GTA] Aucun fichier .env.local trouve : SUPABASE_URL et SUPABASE_SECRET_KEY sont obligatoires.');
}

const handler = require('../api/[...route].js');

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
// Les pages peuvent n'ecrire que le nom du fichier : ces extensions sont alors
// cherchees dans le dossier Image/.
const EXTENSIONS_IMAGE = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    // Filet de securite : meme si une route rejette, le processus ne doit pas mourir.
    Promise.resolve(handler(req, res)).catch(error => {
      console.error('[GTA local API]', error);
      if (res.headersSent) return res.end();
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Erreur serveur.' }));
    });
    return;
  }
  const requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = requested === '/' ? '/index.html' : requested;
  let file = path.resolve(root, `.${relative}`);
  // Une image écrite avec son seul nom (« logo.jpg ») est servie depuis Image/ :
  // c'est ce que fait aussi gta-cloud.js côté navigateur, mais le serveur évite
  // ainsi la requête perdue, y compris si le JavaScript est désactivé.
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    const candidat = path.join(root, 'Image', path.basename(file));
    if (EXTENSIONS_IMAGE.test(path.extname(candidat)) && fs.existsSync(candidat) && fs.statSync(candidat).isFile()) file = candidat;
  }
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('Not found'); }
  // extname conserve la casse (ex: Image/Fond.JPG) : on normalise avant la recherche MIME.
  res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
server.on('error', error => { console.error('[GTA local server]', error.message); process.exitCode = 1; });
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`GTA local server on http://127.0.0.1:${process.env.PORT || 3000}`));
