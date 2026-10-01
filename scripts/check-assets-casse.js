/* ==========================================================================
   Verifie que chaque chemin d'asset reference respecte EXACTEMENT la casse du
   fichier reel. Windows est insensible a la casse, Linux (Vercel) non :
   une erreur ici passe inapercue en local et casse le site en production.
   ========================================================================== */
const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const pagesDir = path.join(racine, 'page');
// index.html est servi depuis la racine du projet, les autres pages sont dans page/.
const pages = ['index.html', ...fs.readdirSync(pagesDir).filter(f => f.endsWith('.html')).sort()];
const cheminPage = page => (page === 'index.html' ? path.join(racine, 'index.html') : path.join(pagesDir, page));

// Index des fichiers reellement presents, par chemin relatif normalise.
function lister(dossier, prefixe = '') {
  const resultat = new Map();
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const rel = prefixe ? `${prefixe}/${entree.name}` : entree.name;
    if (entree.isDirectory()) {
      if (entree.name === 'node_modules' || entree.name.startsWith('.')) continue;
      for (const [k, v] of lister(path.join(dossier, entree.name), rel)) resultat.set(k, v);
    } else {
      resultat.set(rel, entree.name);
    }
  }
  return resultat;
}
const fichiers = lister(racine);
// Table nom-de-fichier -> chemins reels (pour detecter une casse differente).
const parNomMinuscule = new Map();
for (const [rel, nom] of fichiers) {
  const cle = nom.toLowerCase();
  if (!parNomMinuscule.has(cle)) parNomMinuscule.set(cle, []);
  parNomMinuscule.get(cle).push(rel);
}

let echecs = 0;
const check = (label, ok, detail = '') => {
  if (!ok) echecs++;
  console.log(`${ok ? 'PASS' : 'ECHEC'}  ${label}${detail ? `  ${detail}` : ''}`);
};

const chemins = new Map();
for (const page of pages) {
  const html = fs.readFileSync(cheminPage(page), 'utf8');
  // Attributs src/href et url(...) dans le CSS. Un meme chemin peut apparaitre
  // dans plusieurs pages : on conserve donc TOUTES les pages concernees.
  const ajouter = brut => {
    if (!chemins.has(brut)) chemins.set(brut, new Set());
    chemins.get(brut).add(page);
  };
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/gi)) ajouter(m[1]);
  // Le lookbehind exclut les faux positifs du type readAsDataURL(file),
  // ou "URL(" fait partie d'un nom de fonction et non d'un url() CSS.
  for (const m of html.matchAll(/(?<![\w$.-])url\((['"]?)([^'")]+)\1\)/gi)) ajouter(m[2]);
}

console.log(`--- ${chemins.size} chemins references a verifier ---\n`);
for (const [brut, pagesConcernees] of [...chemins.entries()].sort()) {
  if (/^(https?:|mailto:|tel:|data:|#|\/)/i.test(brut)) continue;
  const sansAncre = brut.split('#')[0].split('?')[0];
  if (!sansAncre) continue;
  // Un nom court d'image (ex. "logo.jpg") designe le dossier Image/ ; tout le
  // reste (pages, scripts, chemins complets) est resolu depuis la page.
  const estImage = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i.test(sansAncre);
  const relatifs = (sansAncre.includes('/') || !estImage)
    ? [...pagesConcernees].map(page => {
        const base = page === 'index.html' ? '' : 'page';
        return base ? path.posix.normalize(path.posix.join(base, sansAncre)) : path.posix.normalize(sansAncre);
      })
    : [`Image/${sansAncre}`];
  if (relatifs.some(relatif => fichiers.has(relatif))) continue;

  const liste = [...pagesConcernees].join(', ');
  const relatif = relatifs[0];
  const nomVoulu = path.posix.basename(relatif).toLowerCase();
  const candidats = parNomMinuscule.get(nomVoulu) || [];
  const memeDossier = candidats.find(c => path.posix.dirname(c).toLowerCase() === path.posix.dirname(relatif).toLowerCase());
  if (memeDossier) {
    check(`casse incorrecte : ${brut}`, false, `pages: ${liste} — le fichier reel est "${memeDossier}"`);
  } else if (candidats.length) {
    check(`casse incorrecte : ${brut}`, false, `pages: ${liste} — fichier trouve ailleurs : ${candidats.join(', ')}`);
  } else {
    check(`chemin introuvable : ${brut}`, false, `pages: ${liste}`);
  }
}

if (echecs === 0) console.log('PASS  tous les chemins respectent la casse reelle des fichiers');
console.log(echecs === 0 ? '\nRESULTAT : aucun probleme de casse' : `\nRESULTAT : ${echecs} chemin(s) a corriger`);
process.exitCode = echecs === 0 ? 0 : 1;
