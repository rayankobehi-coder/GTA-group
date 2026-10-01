const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
// index.html (la page publique) est servi depuis la racine ; les dashboards et
// la page de connexion restent dans page/ et chargent « ../gta-cloud.js ».
const pages = [
  { nom: 'index.html', fichier: path.join(root, 'index.html'), script: 'src="gta-cloud.js' },
  ...['formulaire.html', 'CEEJAY.html', 'lepere.html', 'élève.html', 'prof.html'].map(nom => ({ nom, fichier: path.join(root, 'page', nom), script: 'src="../gta-cloud.js' })),
];
const failures = [];
for (const { nom, fichier, script } of pages) {
  if (!fs.existsSync(fichier)) failures.push(`Page absente: ${nom}`);
  else if (!fs.readFileSync(fichier, 'utf8').includes(script)) failures.push(`Couche GTA absente: ${nom}`);
}
for (const file of ['gta-cloud.js', 'api/index.js', 'api/[...route].js', 'api/_lib/auth.js', 'api/_lib/http.js', 'api/_lib/supabase.js', 'supabase/migrations/202608220001_gta_platform.sql', 'supabase/migrations/202608220002_gta_user_settings.sql', 'supabase/migrations/202608220003_document_limit_15mb.sql', 'supabase/migrations/202608220004_avatar_limit_15mb.sql', 'vercel.json', '.env.example']) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Fichier requis absent: ${file}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Contrôle GTA réussi: ${pages.length} pages et fichiers d’intégration présents.`);
