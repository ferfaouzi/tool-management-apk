# Gestion des outils

Application **Android (APK)** autonome de gestion du parc outillage.
Elle fonctionne sans serveur et sans internet : toutes les données sont enregistrées dans le téléphone.

## Fonctions

- **Hiérarchie complète** : Société › Site › Zone › Ligne › Machine › Outil › Module › Posage,
  plus les **Articles / pièces de rechange** rattachables à une machine, un outil, un module ou un posage.
- Pour chaque élément : nom, code, emplacement, adresse, localisation, process, objectif,
  **nombre de coups** et limite de coups, statut, **motif**, description
  (et pour les articles : référence, fournisseur, quantité en stock, stock minimum).
- **Tableau de bord** lisible : compteurs par type, alertes (limite de coups proche ou atteinte,
  stock bas, machine en maintenance / hors service), états des équipements, plus gros compteurs,
  dernières actions.
- **Listes déroulantes** en cascade pour filtrer (Société › Site › Zone › Ligne › Machine),
  par type et par statut ; listes de statuts, motifs et process modifiables par l'admin.
- **Arborescence** dépliable de tout le parc.
- **Mode admin** protégé par mot de passe (par défaut **admin**) : ajouter, modifier, supprimer,
  compter un coup, remettre un compteur à zéro, avec motif enregistré dans l'**historique**.
  Un coup compté sur une machine est aussi compté pour ses outils, modules et posages.
- **4 thèmes lisibles** : industriel (sombre), clair, bleu acier, contraste élevé.
- Export CSV (Excel) et sauvegarde / restauration JSON, partagés via le menu Android
  (e-mail, Drive, WhatsApp…). La sauvegarde sert aussi à transférer les données vers un autre téléphone.

## Télécharger l'APK

Onglet *Actions* de GitHub › workflow *APK Android* › dernière exécution réussie › artefact
`gestion-outils-apk` (lancement manuel possible avec *Run workflow*).
Sur le téléphone, autorisez l'installation d'applications de sources inconnues, puis ouvrez le fichier `app-debug.apk`.

## Structure

- `android/www/` : l'application (HTML, CSS, JavaScript sans dépendance).
  `store.js` gère les données dans le téléphone, `app.js` l'interface.
- `android/capacitor.config.json` : configuration Capacitor qui transforme l'application en APK.
- `android/tests/` : tests de la gestion des données.

## Compiler soi-même

Prérequis : Node 20+, JDK 21, Android SDK.

```sh
cd android
npm install
npm test
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug
# APK : android/android/app/build/outputs/apk/debug/app-debug.apk
```

Pour essayer dans un navigateur : `cd android/www && python3 -m http.server 8000`, puis ouvrir `http://localhost:8000`.
