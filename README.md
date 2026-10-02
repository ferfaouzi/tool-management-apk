# Gestion des outils

Application web légère de gestion du parc outillage, pensée pour tourner sur un **Raspberry Pi 3**
et utilisable depuis un PC, une tablette ou un téléphone Android (**APK**).

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
- **Mode admin** protégé par mot de passe : ajouter, modifier, supprimer, remettre un compteur à zéro,
  avec motif enregistré dans l'**historique**.
- **Synchronisation** : tous les postes partagent la base du Raspberry Pi et se mettent à jour
  automatiquement (toutes les 5 s). Les machines / automates peuvent envoyer leurs coups via l'API.
- **4 thèmes lisibles** : industriel (sombre), clair, bleu acier, contraste élevé.
- Export CSV (Excel), sauvegarde / restauration JSON.

## Installation sur Raspberry Pi 3

```sh
git clone https://github.com/ferfaouzi/tool-management-apk.git
cd tool-management-apk
sudo sh raspberry/install.sh
```

Le script installe Python, crée l'environnement, et démarre le service `toolmanager` au démarrage du Pi.
Ouvrez ensuite `http://<adresse-du-pi>:8080` depuis n'importe quel appareil du réseau.

- Mot de passe admin par défaut : **admin** (à changer dans *Administration*).
- Les données sont dans `data/outils.db` (SQLite).
- Affichage plein écran sur l'écran du Pi : `raspberry/kiosk.sh`.

Lancement manuel (Pi ou PC) :

```sh
pip install -r requirements.txt
python3 app.py          # http://0.0.0.0:8080
```

Variables d'environnement : `TM_PORT`, `TM_DB` (chemin de la base), `TM_ADMIN_PASSWORD`
(mot de passe initial), `TM_API_KEY` (clé pour les machines).

## Application Android (.apk)

Le dossier `android/` contient une application Capacitor : au premier lancement elle demande
l'adresse du Raspberry Pi (ex. `http://192.168.1.50:8080`), puis ouvre l'application en plein écran.
Les données restent sur le Pi, donc tous les téléphones sont synchronisés.

**APK prêt à installer** : onglet *Actions* de GitHub › workflow *APK Android* › artefact
`gestion-outils-apk` (lancement manuel possible avec *Run workflow*).

Compilation locale (Node 20+, JDK 21, Android SDK) :

```sh
cd android
npm install
npx cap add android
sed -i 's#<application#<application android:usesCleartextTraffic="true"#' android/app/src/main/AndroidManifest.xml
npx cap sync android
cd android && ./gradlew assembleDebug
# APK : android/android/app/build/outputs/apk/debug/app-debug.apk
```

## Envoi des coups par une machine

```sh
curl -X POST http://<pi>:8080/api/entites/<id>/coups \
  -H "X-API-Key: <TM_API_KEY>" -H "Content-Type: application/json" \
  -d '{"increment": 1}'
```

Le coup est ajouté à l'élément et à tout ce qui lui est rattaché (outil, module, posage…).
Autres corps possibles : `{"valeur": 12345}` ou `{"reset": true, "motif": "Maintenance préventive"}`.

## Tests

```sh
pip install pytest
pytest -q tests
```
