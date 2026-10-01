// Verifie que les dates de index.html sont bien auto-actualisees.
// Le code teste est EXTRAIT du fichier : si quelqu'un le casse, le test echoue.
// La regle de session est verifiee avec des dates simulees, pas seulement avec
// la date du jour.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// Le balisage seul : les scripts contiennent legitimement les jetons (cles de
// l'objet « jetons » et expression reguliere).
const balisage = html.replace(/<script[\s\S]*?<\/script>/gi, '');

let echecs = 0;
const check = (label, condition, detail = '') => {
  if (!condition) echecs++;
  console.log(`${condition ? 'PASS' : 'ECHEC'}  ${label}${detail ? `  ${detail}` : ''}`);
};

console.log('--- 1. Plus aucune annee figee dans le balisage ---');
for (const motif of [/PREPABAC \d{4}/, /© \d{4}/, /Depuis \d+ ans/, /">\d+\+</]) {
  const trouve = balisage.match(motif);
  check(`aucune occurrence de ${motif}`, !trouve, trouve ? `trouve="${trouve[0]}"` : '');
}

console.log('--- 2. Les jetons sont bien repartis dans le balisage ---');
const nbSession = (balisage.match(/\{\{ANNEE_SESSION\}\}/g) || []).length;
const nbAnnee = (balisage.match(/\{\{ANNEE\}\}/g) || []).length;
const nbAnciennete = (balisage.match(/\{\{ANCIENNETE\}\}/g) || []).length;
// 4 mentions de session dans le balisage actuel : 2 dans le bandeau défilant,
// 1 dans la carte « PREPABAC … ouvert », 1 dans le pied de page.
// Les paragraphes « Les inscriptions … » des sections inscription et contact
// ne portent plus le jeton : le nombre attendu suit le contenu réel de la page.
// 1 annee civile : la mention de copyright.
// 4 anciennetes : badge, 2 cartes de chiffres, texte du pied de page.
check('jetons {{ANNEE_SESSION}} (PREPABAC)', nbSession === 4, `trouves=${nbSession}`);
check('jetons {{ANNEE}} (copyright seulement)', nbAnnee === 1, `trouves=${nbAnnee}`);
check('jetons {{ANCIENNETE}}', nbAnciennete === 4, `trouves=${nbAnciennete}`);

console.log('--- 3. La regle de session, verifiee sur des dates simulees ---');
const bloc = html.match(/\(function actualiserDates\(\)[\s\S]*?\}\)\(\);/);
check('fonction actualiserDates() trouvee dans la page', Boolean(bloc));

// Rejoue le moteur de la page avec une date imposee.
function simuler(iso) {
  const noeuds = [
    { nodeValue: 'Les inscriptions au PREPABAC {{ANNEE_SESSION}} ont débuté' },
    { nodeValue: '© {{ANNEE}} Groupe GTA' },
    { nodeValue: 'Depuis {{ANCIENNETE}} ans' },
    { nodeValue: 'sans jeton ici' },
    { nodeValue: 'deux jetons {{ANNEE_SESSION}} et {{ANCIENNETE}}' },
  ];
  let curseur = -1;
  const documentStub = {
    title: 'Groupe GTA {{ANNEE_SESSION}}',
    body: {},
    createTreeWalker: () => ({
      nextNode() { curseur++; return curseur < noeuds.length ? noeuds[curseur] : null; },
      get currentNode() { return noeuds[curseur]; },
    }),
  };
  // Date figee : new Date() dans la page renvoie la date simulee.
  const DateFige = class extends Date {
    constructor(...args) { if (args.length === 0) super(iso); else super(...args); }
  };
  vm.runInNewContext(bloc[0], { document: documentStub, NodeFilter: { SHOW_TEXT: 4 }, Date: DateFige });
  return { noeuds, titre: documentStub.title };
}

if (bloc) {
  const cas = [
    ['2026-09-30T12:00:00', 2027, 2026, 18, 'rentree 2026 : on vise la session 2027'],
    ['2027-02-15T12:00:00', 2027, 2027, 19, 'fevrier 2027 : la session 2027 est en cours'],
    ['2026-05-10T12:00:00', 2026, 2026, 18, 'mai 2026 : la session 2026 est encore en cours'],
    ['2027-09-01T12:00:00', 2028, 2027, 19, 'rentree 2027 : on vise la session 2028'],
  ];
  for (const [iso, sessionAttendue, anneeAttendue, ancienneteAttendue, libelle] of cas) {
    const { noeuds, titre } = simuler(iso);
    const session = noeuds[0].nodeValue.match(/PREPABAC (\d{4})/)?.[1];
    const copyright = noeuds[1].nodeValue.match(/© (\d{4})/)?.[1];
    const anciennete = noeuds[2].nodeValue.match(/Depuis (\d+) ans/)?.[1];
    const ok = session === String(sessionAttendue) && copyright === String(anneeAttendue) && anciennete === String(ancienneteAttendue);
    check(libelle, ok, `session=${session} copyright=${copyright} anciennete=${anciennete} (attendu ${sessionAttendue}/${anneeAttendue}/${ancienneteAttendue})`);
    check(`  titre de l'onglet (${iso.slice(0, 10)})`, titre === `Groupe GTA ${sessionAttendue}`, `"${titre}"`);
    check('  texte sans jeton intact', noeuds[3].nodeValue === 'sans jeton ici');
    check('  deux jetons dans un meme noeud', noeuds[4].nodeValue === `deux jetons ${sessionAttendue} et ${ancienneteAttendue}`, `"${noeuds[4].nodeValue}"`);
    check('  aucun jeton residuel', !noeuds.some(n => n.nodeValue.includes('{{')));
  }
}

const maintenant = new Date();
const anneeCivile = maintenant.getFullYear();
const sessionCourante = maintenant.getMonth() >= 8 ? anneeCivile + 1 : anneeCivile;
console.log(`\nDate systeme : ${maintenant.toISOString().slice(0, 10)} — session visee : ${sessionCourante}, copyright : ${anneeCivile}`);
console.log(echecs === 0 ? 'RESULTAT : dates auto-actualisees operationnelles' : `RESULTAT : ${echecs} echec(s)`);
process.exitCode = echecs === 0 ? 0 : 1;
