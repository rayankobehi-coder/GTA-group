/* ==========================================================================
   Verifie que chaque image referencee dans les pages existe reellement.
   Un chemin casse ne produit aucune erreur visible : juste une image vide.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const racineProjet = path.join(__dirname, '..');
const pagesDir = path.join(racineProjet, 'page');
// index.html est servi depuis la racine du projet, les autres pages sont dans page/.
const pages = ['index.html', ...fs.readdirSync(pagesDir).filter(f => f.endsWith('.html')).sort()];
const cheminPage = page => (page === 'index.html' ? path.join(racineProjet, 'index.html') : path.join(pagesDir, page));

let echecs = 0;
const check = (label, ok, detail = '') => {
  if (!ok) echecs++;
  console.log(`${ok ? 'PASS' : 'ECHEC'}  ${label}${detail ? `  ${detail}` : ''}`);
};

const utilisees = new Map();
const EXTENSIONS_IMAGE = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i;

// Enregistre une reference : nom court (« logo.jpg ») = dossier Image/, sinon
// le chemin est resolu depuis le dossier de la page qui l'ecrit.
function ajouterReference(valeur, page, dossierPage) {
  const src = String(valeur || '').trim();
  if (!src || /^(https?:)?\/\//i.test(src) || src.startsWith('data:') || src.startsWith('#')) return;
  if (!EXTENSIONS_IMAGE.test(src.split('?')[0])) return;
  const absolu = /[/\\]/.test(src) ? path.resolve(dossierPage, src) : path.resolve(racineProjet, 'Image', src);
  const existe = fs.existsSync(absolu) && fs.statSync(absolu).isFile();
  if (!utilisees.has(src)) utilisees.set(src, { pages: new Set(), existe });
  utilisees.get(src).pages.add(page);
}

for (const page of pages) {
  const html = fs.readFileSync(cheminPage(page), 'utf8');
  const dossierPage = path.dirname(cheminPage(page));
  // Attributs src des balises img (les URL http et les data: sont ignorees).
  for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) ajouterReference(m[1], page, dossierPage);
  // Fonds d'images des blocs <style> : les grandes photos du site.
  for (const m of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) ajouterReference(m[2], page, dossierPage);
}

console.log(`--- ${utilisees.size} images locales referencees ---`);
for (const [src, info] of [...utilisees.entries()].sort()) {
  check(`${src}`, info.existe, info.existe ? `utilisee par ${[...info.pages].join(', ')}` : `INTROUVABLE (${[...info.pages].join(', ')})`);
}

// Les icones installees mais pas encore utilisees : utile pour la suite.
const dossierImage = path.join(__dirname, '..', 'Image');
const referencees = new Set([...utilisees.keys()].map(s => path.basename(s).toLowerCase()));
const inutilisees = fs.readdirSync(dossierImage).filter(f => !referencees.has(f.toLowerCase()));
console.log(`\n--- Images presentes mais non referencees (${inutilisees.length}) ---`);
console.log('  ' + inutilisees.join(', '));

console.log(echecs === 0 ? '\nRESULTAT : toutes les images referencees existent' : `\nRESULTAT : ${echecs} image(s) introuvable(s)`);
process.exitCode = echecs === 0 ? 0 : 1;
