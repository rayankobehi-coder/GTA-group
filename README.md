# Groupe GTA — Plateforme d’encadrement

Cette version conserve les pages HTML, les styles et les interactions fournis dans l’archive. La couche ajoutée `gta-cloud.js` relie les six pages existantes à une API serverless, tandis que `api/[...route].js` centralise l’authentification, les rôles, la persistance, les documents, les profils, les notifications, les suggestions, les statistiques et l’inscription Telegram.

## Fonctionnalités intégrées

La page d’accueil (`index.html`, à la racine du projet, anciennement `page/index.html`) enregistre chaque demande dans `gta_registrations` puis transmet la demande au bot Telegram côté serveur. Le token Telegram n’est donc plus exposé dans le navigateur. Le bouton d’appel conserve le lien `tel:0173045519`.

### Dates auto-actualisées

Aucune année n’est écrite en dur dans `index.html` (racine du projet). Le balisage contient des jetons remplacés au chargement à partir de la date de l’appareil :

| Jeton | Valeur | Emploi |
|---|---|---|
| `{{ANNEE_SESSION}}` | Session PREPABAC visée | 7 mentions (bandeau, sections, pied de page) |
| `{{ANNEE}}` | Année civile courante | Mention de copyright |
| `{{ANCIENNETE}}` | Années depuis la fondation en 2008 | Badge, cartes de chiffres, pied de page |

**Règle de session :** une session « PREPABAC N » désigne l’examen de l’année N. Les inscriptions s’ouvrant à la rentrée de septembre pour l’examen de l’année suivante, le jeton vaut `N+1` à partir de septembre et `N` de janvier à août. En septembre 2026, la page affiche donc **PREPABAC 2027** ; en février 2027, elle affichera toujours 2027. Aucune intervention n’est nécessaire d’une année sur l’autre.

### Images : le nom du fichier suffit

Les pages écrivent uniquement le nom du fichier — `<img src="logo.jpg">`, `url("Fond.JPG")`, `href="logo.jpg"` pour le favicon. `gta-cloud.js` complète le chemin à partir de son propre emplacement : le dossier `Image/` est retrouvé tout seul, que la page soit à la racine, dans `page/` ou dans un sous-dossier. Déplacer une page ne casse donc plus ses images.
Un chemin déjà complet (`Image/…`, `../Image/…`, `https://…`, `data:…`) n’est jamais modifié : les deux écritures fonctionnent. Les noms courts sont résolus par `gta-cloud.js`, qui doit donc rester chargé par la page.

Les horloges des dashboards (`#liveClock`) affichent déjà la date et l’heure en temps réel, rafraîchies chaque seconde.

### Aucune donnée de démonstration

Les versions précédentes écrivaient dans le navigateur sept comptes inventés (`admin_maitre`, `staff_gta`, `eleve_emma`, `prof_litterature`…) et de faux profils, ce qui gonflait artificiellement les statistiques. Ces valeurs ont été supprimées : les listes démarrent vides et ne se remplissent qu’avec les données réelles de l’API. Les compteurs affichent donc **0** quand la base est vide, et uniquement les comptes réellement présents. Une purge unique (`gta_demo_purge_v1`) efface les anciennes données factices déjà enregistrées dans les navigateurs.

La page de connexion utilise une session HttpOnly signée par le serveur. Les rôles `admin`, `parent`, `prof`, `staff` et `eleve` redirigent vers leur dashboard dédié. Les pages dashboard vérifient la session et le rôle avant d’afficher les données cloud. Les mots de passe sont hachés avec scrypt et ne sont jamais renvoyés au client.

L’administrateur absolu dispose de la création, de la modification et de la suppression des comptes, de la consultation des élèves, du suivi des statistiques, de la gestion des documents et de la réinitialisation des données opérationnelles. Les profils, préférences, avatars, documents, suggestions, activités et notifications sont conservés dans Supabase. Les fichiers sont stockés dans des buckets privés et servis par URL signée temporaire. Les documents et les photos de profil sont envoyés directement vers Supabase Storage avec une limite serveur de 15 Mo. Chaque photo est enregistrée sous le dossier de l’identifiant du compte dans `gta-avatars`; lors de chaque connexion, une nouvelle URL signée est générée, ce qui permet de retrouver la même photo depuis n’importe quel appareil ou navigateur. Ce fonctionnement s’applique aux comptes existants et à tous les comptes créés ultérieurement.

L’envoi de documents est ouvert à tous les comptes connectés, élèves compris (`roleCanWriteShared` dans `api/_lib/auth.js`) : chaque dashboard possède la zone de dépôt « Espace Documentaire ». La suppression reste encadrée — un élève ne peut pas supprimer de document, un autre rôle ne peut supprimer que ses propres envois, l’administrateur absolu gère tout.
Les compteurs de volumétrie de la plateforme (nombre d’élèves inscrits, total d’utilisateurs) sont réservés aux rôles `admin` et `staff`; les dashboards élève, professeur et parent ne les affichent plus.
Chaque dashboard dispose d’un onglet **Suggestions** : le bouton « Envoyer » est lui-même le lien WhatsApp (`https://wa.me/2250173045519`, soit `+225 01 73 04 55 19`) et transmet le sujet et le message saisis au propriétaire du numéro, tout en conservant la suggestion dans Supabase pour l’historique. Le bouton d’inscription de la page publique ouvre lui aussi WhatsApp avec toutes les informations du formulaire pré-remplies.

## Configuration locale

Copier `.env.example` vers `.env.local`, puis renseigner les valeurs réelles. `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN` et `SESSION_SECRET` sont exclusivement des variables serveur et ne doivent jamais être ajoutées au code client ni au dépôt GitHub.

### Windows : démarrage en un clic

Double-cliquez sur `DEMARRER-GTA.cmd`. Le script démarre le serveur local puis ouvre directement la page de connexion sur `http://127.0.0.1:3000/page/formulaire.html`.

| Rôle | Identifiant | Mot de passe |
|---|---|---|
| Administrateur absolu | `ceejay` | `yajeec` |
| Admin secondaire (le père) | `lepere` | `peregta` |
| Démonstration élève | `eleve1` | `eleve123` |
| Démonstration professeur | `prof1` | `prof123` |

> **Important :** ne double-cliquez jamais directement les fichiers `.html` du dossier `page`. Ouverts depuis le disque, ils n'ont accès à aucune API. L'application le détecte et bascule automatiquement en **mode hors-ligne** : les quatre comptes du tableau ci-dessus restent utilisables et les données sont conservées dans le navigateur, mais elles ne sont ni partagées ni synchronisées avec Supabase. Ce mode est **silencieux à l'écran** — aucun bandeau n'est affiché ; seul un message est écrit dans la console du navigateur (`[GTA] Mode hors-ligne…`). Pour le mode complet, passez toujours par `DEMARRER-GTA.cmd`.

### Ligne de commande

`scripts/local-server.js` charge lui-même `.env.local` avant d'initialiser l'API : aucune exportation manuelle n'est nécessaire.

```bash
node scripts/local-server.js
```

Le serveur écoute alors sur `http://127.0.0.1:3000`. Au premier accès à l'authentification, les quatre comptes initiaux sont créés dans `gta_users` s'ils n'existent pas déjà.

### Vérifications

```bash
node scripts/verify-defaults.js   # empreintes scrypt des 4 comptes par défaut
node scripts/test-login.js        # API : connexion, refus, session, cookie falsifié
node scripts/test-client.js       # navigateur simulé : file:// et http://
node scripts/test-dates.js        # dates auto-actualisées de la page d'accueil
node scripts/check-scripts.js     # syntaxe des scripts inline des 6 pages
node scripts/check-images.js      # chaque image référencée existe bien
node scripts/check-assets-casse.js # casse des chemins (Windows OK / Linux KO)
node scripts/check-responsive.js  # adaptation téléphone / tablette / ordinateur
node scripts/lister-emojis.js     # inventaire des emojis (pour les icônes à venir)
node scripts/check-project.js     # présence des pages et modules
```

Équivalents npm : `test:login`, `test:client`, `test:dates`, `check:scripts`, `check:images`, `check:casse`, `check:responsive`, `lister:emojis`, `check`, `verify-defaults`.

### Adaptation aux écrans

Chaque page porte en fin de `<style>` un bloc **« ADAPTATION AUX ÉCRANS »** qui ne contient que des `@media` : l'affichage ordinateur est donc strictement inchangé.

| Point de rupture | Traitement |
|---|---|
| ≤ 968 px (tablette) | menu burger sur l'accueil, grilles en colonnes, blocs d'image réduits à 340 px |
| ≤ 768 px | blocs d'image à 280 px, pied de page sur une colonne |
| ≤ 640 px | onglets des dashboards en icônes, notifications pleine largeur, cibles tactiles à 40 px |
| ≤ 480 px / 420 px | blocs d'image à 220 px, grilles sur une colonne, marges resserrées |

Deux pièges corrigés, tous deux **invisibles sous Windows** :

- **Casse des chemins.** `logo.JPG` était référencé 13 fois alors que le fichier est `logo.jpg`, et `../image/fond.JPG` alors que le dossier est `Image/`. Windows est insensible à la casse, Linux (Vercel) non : ces 17 références auraient donné des images manquantes en production. `check-assets-casse.js` détecte ce cas.
- **Débordement des notifications.** Les toasts mesuraient 400 px de large : sur un téléphone de 360 px ils sortaient de l'écran. Les cibles tactiles de 32 px sont passées à 40 px sur petit écran.

### Icônes illustrées

Les emplacements prévus pour une icône (`.icone-service`, `.icone-contact`, `.icone-titre`) utilisent des **PNG 512×512 à fond transparent** stockés dans `Image/`, au lieu des emojis d'origine. Le fond transparent est indispensable : un fond blanc opaque produirait un carré clair sur le thème sombre.

Les emojis restants se répartissent en deux catégories :

- **Emplacements d'icône encore libres** — `🎯 📊 👨‍🏫 🏆` (cartes « piliers ») et `📞` (téléphone, dans contact et sur le bouton d'appel). Ils attendent une icône.
- **Emojis de texte, non remplaçables par une image** — les horloges `📅 🕐`, les indicateurs d'état des boutons (`⏳ ✅ ❌ ⚠️`) et les emojis du message Telegram (`📋 👤 💬`), qui partent tels quels vers l'API Telegram.

`node scripts/lister-emojis.js` affiche l'inventaire avec le numéro de ligne et le contexte de chaque emoji.

`test-client.js` couvre les deux modes de fonctionnement décrits ci-dessus. Si le serveur local n'est pas démarré, la partie HTTP est ignorée avec un message explicite.

`test-dates.js` exécute la fonction `actualiserDates()` **extraite de `index.html`** (racine du projet) : si quelqu'un casse la substitution des jetons, le test échoue.

## Configuration Telegram

Le serveur tente d’utiliser `TELEGRAM_CHAT_ID` lorsqu’il est renseigné. Sinon, il recherche le dernier chat ayant écrit au bot via `getUpdates`. Il faut donc envoyer au moins un message au bot avant le premier formulaire public, puis conserver le token uniquement dans les variables serveur Vercel. Il est recommandé de régénérer le token du bot et la clé secrète Supabase si elles ont été partagées dans un canal non confidentiel.

## Supabase

La migration principale est `supabase/migrations/202608220001_gta_platform.sql`. La migration complémentaire `supabase/migrations/202608220002_gta_user_settings.sql` tient compte des tables GTA métier déjà présentes dans le projet Supabase et évite de modifier la table `gta_profiles` existante. Les données applicatives utilisent notamment `gta_users`, `gta_user_settings`, `gta_documents`, `gta_registrations`, `gta_activity`, `gta_notifications`, `gta_suggestions` et `gta_presence`.

Les tables applicatives sont protégées par RLS et l’accès passe par l’API serveur qui utilise la clé secrète. Les buckets `gta-documents` et `gta-avatars` sont privés. Après déploiement, vérifier les alertes de sécurité Supabase et conserver les recommandations concernant les politiques RLS des tables déjà présentes dans le projet.

## Déploiement Vercel

Importer le dépôt GitHub privé dans Vercel, sélectionner la racine du projet et conserver le framework en détection automatique. Aucune commande de build n’est nécessaire pour les pages statiques et les fonctions serverless. Ajouter les variables suivantes dans les environnements Preview et Production :

| Variable | Valeur | Visibilité |
|---|---|---|
| `SUPABASE_URL` | URL du projet Supabase | Serveur |
| `SUPABASE_SECRET_KEY` | Clé secrète Supabase | Serveur uniquement |
| `TELEGRAM_BOT_TOKEN` | Token réel du bot Telegram | Serveur uniquement |
| `TELEGRAM_CHAT_ID` | Identifiant du chat administrateur, facultatif | Serveur |
| `SESSION_SECRET` | Valeur longue et aléatoire | Serveur uniquement |

Après le premier déploiement, tester dans cet ordre : ouverture de l’accueil, demande d’inscription, connexion `ceejay`, accès refusé à un dashboard sans session, création d’un compte élève, connexion avec ce compte, téléversement d’un document et fonctionnement de la cloche de notifications.

## Contrôles effectués

`npm run check` vérifie la présence des six pages, de la couche d’intégration, des modules API, des migrations et de la configuration Vercel. `node --check` a été exécuté sur les modules JavaScript ajoutés. Les routes locales de connexion, session, statistiques, lecture des utilisateurs, documents, inscriptions, validation publique et CRUD utilisateur ont été testées. Le flux URL signée Supabase a également été validé pour les documents et les avatars : génération de l’URL, upload direct, enregistrement du chemin par compte, lecture depuis deux sessions distinctes, contrôle de la limite 15 Mo et suppression de nettoyage.
