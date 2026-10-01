// Inventaire de tous les emojis des pages, avec numero de ligne et contexte,
// pour identifier lesquels peuvent recevoir une icone fournie.
const fs = require('fs');
const path = require('path');

const racineProjet = path.join(__dirname, '..');
const pagesDir = path.join(racineProjet, 'page');
// index.html est servi depuis la racine du projet, les autres pages sont dans page/.
const pages = ['index.html', ...fs.readdirSync(pagesDir).filter(f => f.endsWith('.html')).sort()];
const cheminPage = page => (page === 'index.html' ? path.join(racineProjet, 'index.html') : path.join(pagesDir, page));
const EMOJI = /\p{Extended_Pictographic}(\uFE0F)?(\u200D\p{Extended_Pictographic}(\uFE0F)?)*/gu;

const global = new Map();

for (const page of pages) {
  const html = fs.readFileSync(cheminPage(page), 'utf8');
  const lignes = html.split('\n');
  const trouves = [];

  lignes.forEach((ligne, i) => {
    for (const m of ligne.matchAll(EMOJI)) {
      const emoji = m[0];
      const avant = ligne.slice(0, m.index);
      // Ignore les emojis situes dans un commentaire.
      if (avant.lastIndexOf('<!--') > avant.lastIndexOf('-->')) continue;
      const contexte = ligne.trim().slice(0, 110);
      trouves.push({ emoji, ligne: i + 1, contexte });
      if (!global.has(emoji)) global.set(emoji, []);
      global.get(emoji).push(`${page}:${i + 1}`);
    }
  });

  if (trouves.length) {
    console.log(`\n=== ${page} (${trouves.length} emojis) ===`);
    for (const t of trouves) console.log(`  ligne ${String(t.ligne).padStart(4)}  ${t.emoji}  ${t.contexte}`);
  }
}

console.log('\n=== RECAPITULATIF PAR EMOJI ===');
for (const [emoji, lieux] of [...global.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${String(lieux.length).padStart(3)} x  ${emoji}   ${lieux.join(' ')}`);
}
