// Verifie la syntaxe de tous les blocs <script> inline des pages HTML.
// Un bloc malforme casserait silencieusement une page entiere : ce controle
// compile chaque bloc sans l'executer.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const racineProjet = path.join(__dirname, '..');
const pagesDir = path.join(racineProjet, 'page');
// index.html, la page publique, est servi depuis la racine du projet ; les
// autres pages (connexion et dashboards) restent dans page/.
const pages = ['index.html', ...fs.readdirSync(pagesDir).filter(file => file.endsWith('.html')).sort()];
const cheminPage = page => (page === 'index.html' ? path.join(racineProjet, 'index.html') : path.join(pagesDir, page));

let echecs = 0;
let total = 0;

for (const page of pages) {
  const html = fs.readFileSync(cheminPage(page), 'utf8');
  const regex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  let index = 0;
  while ((match = regex.exec(html)) !== null) {
    const attributs = match[1] || '';
    const code = match[2] || '';
    if (/\bsrc\s*=/i.test(attributs)) continue; // script externe : deja couvert par node --check
    if (!code.trim()) continue;
    index++;
    total++;
    const ligne = html.slice(0, match.index).split('\n').length;
    try {
      new vm.Script(code, { filename: `${page}:bloc${index}` });
    } catch (error) {
      echecs++;
      console.error(`ECHEC  ${page} bloc #${index} (ligne ~${ligne}) : ${error.message}`);
    }
  }
}

console.log(echecs === 0
  ? `Syntaxe OK : ${total} blocs inline valides sur ${pages.length} pages (${pages.join(', ')}).`
  : `${echecs} bloc(s) invalide(s) sur ${total}.`);
process.exitCode = echecs === 0 ? 0 : 1;
