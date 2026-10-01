/* ==========================================================================
   Controle responsive : verifie que chaque page reste utilisable sur
   telephone, tablette et ordinateur.
     1. balise viewport presente (sinon le mobile affiche une page dezoomee)
     2. au moins deux points de rupture, dont un pour telephone
     3. images bornees a la largeur de leur conteneur
     4. aucune hauteur figee >= 300 px sans adaptation en media query
     5. notifications et modales bornees (uniquement si la page en contient)
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
const info = (label, detail = '') => console.log(`INFO   ${label}${detail ? `  ${detail}` : ''}`);

const sansCommentaires = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

// Separe les regles de base du contenu des @media (blocs equilibres).
function separer(css) {
  let base = '';
  const medias = [];
  let i = 0;
  while (i < css.length) {
    const idx = css.indexOf('@media', i);
    if (idx === -1) { base += css.slice(i); break; }
    base += css.slice(i, idx);
    const ouvrante = css.indexOf('{', idx);
    if (ouvrante === -1) { base += css.slice(idx); break; }
    const condition = css.slice(idx + 6, ouvrante).trim().replace(/\s+/g, ' ');
    let j = ouvrante + 1;
    let profondeur = 1;
    while (j < css.length && profondeur > 0) {
      if (css[j] === '{') profondeur++;
      else if (css[j] === '}') profondeur--;
      j++;
    }
    medias.push({
      condition,
      max: Number((condition.match(/max-width:\s*(\d+)px/) || [])[1] || 0),
      contenu: css.slice(ouvrante + 1, j - 1),
    });
    i = j;
  }
  return { base, medias };
}

for (const page of pages) {
  const html = fs.readFileSync(cheminPage(page), 'utf8');
  const css = sansCommentaires([...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n'));
  const { base, medias } = separer(css);
  const contenuMedia = medias.map(b => b.contenu).join('\n');

  console.log(`\n=== ${page} ===`);

  // 1. viewport
  const viewport = html.match(/<meta[^>]+name="viewport"[^>]+content="([^"]+)"/i);
  check('balise viewport presente', Boolean(viewport), viewport ? `"${viewport[1]}"` : 'ABSENTE');

  // 2. points de rupture
  const maxs = medias.map(b => b.max).filter(Boolean);
  check('au moins 2 points de rupture', medias.length >= 2, `${medias.length} : ${medias.map(b => b.condition).join(' | ')}`);
  check('point de rupture telephone (<= 640px)', maxs.some(m => m <= 640), `max = ${[...new Set(maxs)].join(', ')}`);

  // 3. images bornees
  check('images bornees (img { max-width: 100% })', /img\s*\{[^}]*max-width:\s*100%/s.test(css));

  // 4. hauteurs figees >= 300px, cherchees UNIQUEMENT hors @media
  const figees = [];
  let selecteur = '';
  for (const ligne of base.split('\n')) {
    const t = ligne.trim();
    if (t.endsWith('{')) selecteur = t.slice(0, -1).trim();
    const m = t.match(/height:\s*(\d{3,})px/);
    if (m && Number(m[1]) >= 300 && selecteur) figees.push({ selecteur, hauteur: Number(m[1]) });
  }
  const nonAdaptees = figees.filter(f => {
    const principal = f.selecteur.split(',')[0].trim().replace(/^\./, '');
    return !new RegExp(`\\.${principal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(contenuMedia);
  });
  check('hauteurs figees >= 300px adaptees', nonAdaptees.length === 0,
    nonAdaptees.length ? nonAdaptees.map(f => `${f.selecteur} (${f.hauteur}px)`).join(' | ') : `${figees.length} hauteur(s) figee(s) trouvee(s), toutes adaptees`);

  // 5. notifications et modales, seulement si la page en contient
  if (/\.toast\s*\{/.test(css)) {
    check('notifications bornees sur petit ecran', /\.toast\s*\{[^}]*max-width:\s*none/s.test(contenuMedia));
  } else {
    info('notifications : aucune sur cette page');
  }
  const aModale = /\.modal\s*\{/.test(css) || /\.modal-box\s*\{/.test(css);
  if (aModale) {
    // Deux motifs acceptables : max-width en unités viewport, ou largeur en %
    // plafonnée par un max-width en pixels.
    const regle = (base.match(/\.(?:modal|modal-box)\s*\{[^}]*\}/s) || [''])[0];
    const bornee = /max-width:\s*\d+vw/.test(regle) || (/width:\s*\d+%/.test(regle) && /max-width:\s*\d+px/.test(regle));
    const borneeMedia = /\.(?:modal|modal-box)\s*\{[^}]*width:\s*\d+vw/s.test(contenuMedia);
    check('modales bornees a la largeur de l\'ecran', bornee || borneeMedia,
      bornee ? '' : `regle lue : ${regle.replace(/\s+/g, ' ').slice(0, 90)}`);
  } else {
    info('modales : aucune sur cette page');
  }
}

console.log(echecs === 0 ? '\nRESULTAT : les 6 pages sont adaptees aux trois supports' : `\nRESULTAT : ${echecs} point(s) a corriger`);
process.exitCode = echecs === 0 ? 0 : 1;
