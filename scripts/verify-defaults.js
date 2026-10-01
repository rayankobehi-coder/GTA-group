// Vérifie que les empreintes scrypt codées dans api/[...route].js correspondent
// réellement aux mots de passe attendus du document (PROMPT 1.txt).
const crypto = require('crypto');

const DEFAULT_HASHES = {
  ceejay: '89d507e782bae73f986aef886c306d88:e03e89d2d272e27b9d1bdcfb238070df96f532f8ae1230afc813a98e3f6553186b861183fda9c7b72f4bee03a159915413bb8923b44ca6f0f01e845059869321',
  lepere: 'ea7d1171511306965ec783a09822cc9a:af8f309691f5cba30d9c186537a10ba07390cb0ab85530e4253e62f300ec69f213b40cb175417c7a33cc39d7565dee13b06cd8a3db94e254dce7064830d43de0',
  eleve1: 'e9b8617a22ca4b89b24b1ca21ec1c0ab:847df8b225a55820e787a1a61f96642534d911fe6653234b0b7e1eb479e730910d9235c96286dca5e03ddf445992fda35a3bf4f1c09e5f7c6adcafaea8fd8882',
  prof1: '5c9a9b697e49644184e398213956f82a:02580938f8a5dac34e11ad8cd30a6bd6b55bba818e233d223cf92ccd86531bccaf6eb408575274a2586cef4b6b1f58f0ca8afcf9df31357f40fe33ed72811387',
};

// Reproduit exactement verifyPassword() de api/_lib/auth.js
function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

const ATTENDU = {
  ceejay: ['yajeec', 'ceejay'],
  lepere: ['peregta', 'lepere'],
  eleve1: ['eleve123'],
  prof1: ['prof123'],
};

let echecs = 0;
for (const [user, candidats] of Object.entries(ATTENDU)) {
  const ok = candidats.filter(p => verifyPassword(p, DEFAULT_HASHES[user]));
  const statut = ok.length ? `OK -> ${ok.join(', ')}` : 'ECHEC (aucun mot de passe ne correspond)';
  if (!ok.length) echecs++;
  console.log(`${user.padEnd(8)} ${statut}`);
}

// Contrôle négatif : un mauvais mot de passe ne doit jamais passer
const fauxPositif = verifyPassword('mauvais-mot-de-passe', DEFAULT_HASHES.ceejay);
console.log(`controle negatif (mauvais mdp refuse) : ${fauxPositif ? 'ECHEC' : 'OK'}`);
if (fauxPositif) echecs++;

console.log(echecs === 0 ? '\nRESULTAT: toutes les empreintes sont valides' : `\nRESULTAT: ${echecs} probleme(s)`);
process.exitCode = echecs === 0 ? 0 : 1;
