/* Gestion des outils - stockage local sur l'appareil (aucun serveur).
 *
 * Toutes les données sont enregistrées dans le téléphone (localStorage).
 * La fonction api(url, options) imite une petite API REST pour que
 * l'interface reste simple : api('/api/entites'), api('/api/entites/3', {method: 'PUT', body}), etc.
 */
'use strict';

(function (root) {
  const CLE = 'tm-donnees-v1';

  const TYPES = {
    societe: { label: 'Société', parents: [null] },
    site: { label: 'Site', parents: ['societe'] },
    zone: { label: 'Zone', parents: ['site'] },
    ligne: { label: 'Ligne', parents: ['zone'] },
    machine: { label: 'Machine', parents: ['ligne'] },
    outil: { label: 'Outil', parents: ['machine', null] },
    module: { label: 'Module', parents: ['outil'] },
    posage: { label: 'Posage', parents: ['module', 'outil'] },
    article: { label: 'Article / pièce de rechange', parents: ['machine', 'outil', 'module', 'posage', null] },
  };

  const FIELDS = ['nom', 'code', 'emplacement', 'adresse', 'localisation', 'process', 'objectif',
    'nb_coups', 'coups_max', 'motif', 'statut', 'description', 'reference', 'fournisseur', 'quantite', 'stock_min'];
  const INT_FIELDS = ['nb_coups', 'coups_max', 'quantite', 'stock_min'];
  const EQUIPEMENTS = ['machine', 'outil', 'module', 'posage'];

  const DEFAULT_LISTES = {
    statut: ['En service', 'En maintenance', "À l'arrêt", 'Hors service', 'En stock'],
    motif: ['Création', 'Maintenance préventive', 'Maintenance corrective', 'Usure', 'Casse',
      'Changement de série', 'Réglage', 'Remplacement de pièce', 'Inventaire', 'Autre'],
    process: ['Emboutissage', 'Découpe', 'Soudure', 'Usinage', 'Injection', 'Assemblage',
      'Peinture', 'Contrôle', 'Conditionnement'],
  };

  // Empreinte du mot de passe "admin" par défaut (SHA-256)
  const ADMIN_DEFAUT = '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918';

  let D = null; // données en mémoire
  let admin = false;

  const now = () => {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const copie = o => JSON.parse(JSON.stringify(o));

  class ErreurApi extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  const erreur = (msg, status = 400) => { throw new ErreurApi(msg, status); };

  function vide() {
    return { entites: [], historique: [], listes: copie(DEFAULT_LISTES), password: ADMIN_DEFAUT, prochainId: 1, prochainHist: 1 };
  }

  function charger() {
    if (D) return D;
    try { D = JSON.parse(root.localStorage.getItem(CLE)); } catch (e) { D = null; }
    if (!D || !Array.isArray(D.entites)) D = vide();
    return D;
  }
  function sauver() {
    root.localStorage.setItem(CLE, JSON.stringify(D));
  }

  async function sha256(txt) {
    const buf = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const parId = id => D.entites.find(e => e.id === id);
  const descendants = id => {
    const out = [];
    const pile = [id];
    while (pile.length) {
      const cur = pile.pop();
      D.entites.forEach(e => { if (e.parent_id === cur) { out.push(e.id); pile.push(e.id); } });
    }
    return out;
  };

  function log(e, action, details = '', motif = '') {
    D.historique.push({
      id: D.prochainHist++, entite_id: e ? e.id : null, entite_nom: e ? e.nom : '', entite_type: e ? e.type : '',
      action, details, motif: motif || '', utilisateur: admin ? 'admin' : 'lecteur', date: now(),
    });
    if (D.historique.length > 5000) D.historique.splice(0, D.historique.length - 5000);
  }

  function nettoyer(data, partiel) {
    const out = {};
    FIELDS.forEach(f => {
      if (!(f in data)) return;
      let v = data[f];
      if (INT_FIELDS.includes(f)) {
        if (v === '' || v === null || v === undefined) v = 0;
        if (!/^\d+$/.test(String(v).trim())) erreur(`Le champ « ${f} » doit être un nombre entier positif`);
        v = parseInt(v, 10);
      } else {
        v = String(v ?? '').trim();
      }
      out[f] = v;
    });
    if ((!partiel || 'nom' in out) && !out.nom) erreur('Le nom est obligatoire');
    return out;
  }

  function verifierParent(type, parentId, selfId) {
    const permis = TYPES[type].parents;
    if (parentId === null || parentId === undefined || parentId === '' || parentId === 0) {
      if (!permis.includes(null)) {
        erreur(`Un(e) ${TYPES[type].label} doit être rattaché(e) à : ` + permis.filter(Boolean).map(p => TYPES[p].label).join(', '));
      }
      return null;
    }
    const parent = parId(Number(parentId));
    if (!parent) erreur('Parent introuvable');
    if (!permis.includes(parent.type)) {
      erreur(`Un(e) ${TYPES[type].label} ne peut pas être rattaché(e) à un(e) ${TYPES[parent.type].label}`);
    }
    for (let p = parent; p; p = p.parent_id ? parId(p.parent_id) : null) {
      if (selfId !== undefined && p.id === selfId) erreur('Rattachement circulaire impossible');
    }
    return parent.id;
  }

  function exigerAdmin() { if (!admin) erreur('Mode administrateur requis', 403); }

  // ---------- Opérations ----------
  function creer(data) {
    exigerAdmin();
    if (!TYPES[data.type]) erreur('Type inconnu');
    const vals = nettoyer(data);
    const parent_id = verifierParent(data.type, data.parent_id);
    const e = {
      id: D.prochainId++, type: data.type, parent_id,
      nom: '', code: '', emplacement: '', adresse: '', localisation: '', process: '', objectif: '',
      nb_coups: 0, coups_max: 0, motif: '', statut: 'En service', description: '',
      reference: '', fournisseur: '', quantite: 0, stock_min: 0,
      ...vals, cree_le: now(), modifie_le: now(),
    };
    if (!e.statut) e.statut = 'En service';
    D.entites.push(e);
    log(e, 'Création', '', vals.motif);
    return copie(e);
  }

  function modifier(id, data) {
    exigerAdmin();
    const e = parId(id);
    if (!e) erreur('Introuvable', 404);
    const vals = nettoyer(data, true);
    if ('parent_id' in data) vals.parent_id = verifierParent(e.type, data.parent_id, id);
    const changes = Object.entries(vals)
      .filter(([k, v]) => String(e[k] ?? '') !== String(v ?? ''))
      .map(([k, v]) => `${k}: ${e[k] ?? ''} → ${v ?? ''}`);
    if (changes.length) {
      Object.assign(e, vals, { modifie_le: now() });
      log(e, 'Modification', changes.join('; '), data.motif);
    }
    return copie(e);
  }

  function supprimer(id, motif) {
    exigerAdmin();
    const e = parId(id);
    if (!e) erreur('Introuvable', 404);
    const ids = descendants(id);
    log(e, 'Suppression', ids.length ? `${ids.length} élément(s) rattaché(s) supprimé(s)` : '', motif);
    const aSuppr = new Set([id, ...ids]);
    D.entites = D.entites.filter(x => !aSuppr.has(x.id));
    return { ok: true, supprimes: aSuppr.size };
  }

  function coups(id, data) {
    exigerAdmin();
    const e = parId(id);
    if (!e) erreur('Introuvable', 404);
    const entier = v => { if (!/^\d+$/.test(String(v))) erreur('Valeur invalide'); return parseInt(v, 10); };
    if (data.reset) {
      log(e, 'Remise à zéro compteur', `${e.nb_coups} → 0`, data.motif);
      e.nb_coups = 0;
      e.modifie_le = now();
    } else if ('valeur' in data) {
      const v = entier(data.valeur);
      log(e, 'Compteur', `${e.nb_coups} → ${v}`, data.motif);
      e.nb_coups = v;
      e.modifie_le = now();
    } else {
      const inc = entier(data.increment ?? 1);
      // Le coup est aussi compté pour tout ce qui est monté dessous (outil, module, posage…)
      const ids = data.propager === false ? [id] : [id, ...descendants(id)];
      ids.forEach(i => { const x = parId(i); x.nb_coups += inc; x.modifie_le = now(); });
    }
    return copie(e);
  }

  function tableauDeBord() {
    const compte = {};
    Object.keys(TYPES).forEach(t => (compte[t] = 0));
    D.entites.forEach(e => compte[e.type]++);
    const statuts = {};
    D.entites.filter(e => EQUIPEMENTS.includes(e.type)).forEach(e => {
      const s = e.statut || '—';
      statuts[s] = (statuts[s] || 0) + 1;
    });
    const alertes = [];
    D.entites.filter(e => e.coups_max > 0 && e.nb_coups >= e.coups_max * 0.9)
      .sort((a, b) => b.nb_coups / b.coups_max - a.nb_coups / a.coups_max)
      .forEach(e => {
        const critique = e.nb_coups >= e.coups_max;
        alertes.push({ ...e, niveau: critique ? 'critique' : 'attention',
          alerte: critique ? 'Limite de coups atteinte' : 'Limite de coups proche (≥ 90 %)' });
      });
    D.entites.filter(e => e.type === 'article' && e.stock_min > 0 && e.quantite <= e.stock_min).forEach(e =>
      alertes.push({ ...e, niveau: e.quantite === 0 ? 'critique' : 'attention',
        alerte: `Stock bas (${e.quantite} / min ${e.stock_min})` }));
    D.entites.filter(e => EQUIPEMENTS.includes(e.type) && ['Hors service', "À l'arrêt", 'En maintenance'].includes(e.statut))
      .forEach(e => alertes.push({ ...e, niveau: e.statut === 'Hors service' ? 'critique' : 'info', alerte: e.statut }));
    const top = D.entites.filter(e => EQUIPEMENTS.includes(e.type) && e.nb_coups > 0)
      .sort((a, b) => b.nb_coups - a.nb_coups).slice(0, 10);
    return { compte, statuts, alertes: copie(alertes), top_coups: copie(top), historique: historique(25) };
  }

  const historique = (limit = 200) => copie(D.historique.slice(-limit).reverse());

  function restaurer(data) {
    exigerAdmin();
    if (!data || !Array.isArray(data.entites)) erreur('Fichier de sauvegarde invalide');
    const ents = data.entites.filter(e => e && TYPES[e.type] && e.id);
    D.entites = ents.map(e => {
      const x = { id: Number(e.id), type: e.type, parent_id: e.parent_id ? Number(e.parent_id) : null,
        cree_le: e.cree_le || now(), modifie_le: e.modifie_le || now() };
      FIELDS.forEach(f => { x[f] = INT_FIELDS.includes(f) ? (parseInt(e[f], 10) || 0) : String(e[f] ?? ''); });
      return x;
    });
    D.prochainId = Math.max(0, ...D.entites.map(e => e.id)) + 1;
    if (data.listes && typeof data.listes === 'object' && !Array.isArray(data.listes)) D.listes = copie(data.listes);
    log(null, 'Restauration', `${D.entites.length} élément(s) restauré(s)`);
    return { ok: true, entites: D.entites.length };
  }

  function sauvegarde() {
    return { application: 'Gestion des outils', date: now(), entites: copie(D.entites), listes: copie(D.listes) };
  }

  function demo() {
    exigerAdmin();
    if (D.entites.length) erreur("La base n'est pas vide");
    const add = (type, parent_id, nom, kw = {}) => creer({ type, parent_id, nom, ...kw }).id;
    const s = add('societe', null, 'Ma Société', { adresse: "12 rue de l'Industrie", localisation: 'Tunis', objectif: 'Production pièces métalliques' });
    const site = add('site', s, 'Usine Nord', { adresse: 'Zone industrielle', localisation: 'Ben Arous' });
    const z = add('zone', site, 'Atelier Presse', { emplacement: 'Bâtiment A' });
    const li = add('ligne', z, 'Ligne 1', { process: 'Emboutissage', objectif: '1200 pièces / poste' });
    const m = add('machine', li, 'Presse 400T', { code: 'PR-400', emplacement: 'L1-P1', process: 'Emboutissage', nb_coups: 152340, coups_max: 500000 });
    const o = add('outil', m, 'Outil capot AV', { code: 'OT-101', emplacement: 'L1-P1', process: 'Emboutissage', nb_coups: 48200, coups_max: 50000, objectif: 'Capot avant' });
    const mo = add('module', o, 'Module découpe', { code: 'MD-11', nb_coups: 48200, coups_max: 60000 });
    add('posage', mo, 'Posage 1', { code: 'PS-111', nb_coups: 48200, coups_max: 100000 });
    add('article', o, 'Poinçon Ø12', { reference: 'PN-12-HSS', fournisseur: 'Fournisseur X', quantite: 2, stock_min: 4, emplacement: 'Magasin A3', statut: 'En stock' });
    add('article', m, 'Joint vérin', { reference: 'JV-400', quantite: 10, stock_min: 3, emplacement: 'Magasin B1', statut: 'En stock' });
    const m2 = add('machine', li, 'Presse 250T', { code: 'PR-250', emplacement: 'L1-P2', process: 'Découpe', nb_coups: 90100, coups_max: 300000, statut: 'En maintenance', motif: 'Maintenance préventive' });
    add('outil', m2, 'Outil support', { code: 'OT-102', nb_coups: 12000, coups_max: 80000 });
    return { ok: true };
  }

  function csv() {
    const cols = ['id', 'type', 'parent_id', 'parent_nom', ...FIELDS, 'cree_le', 'modifie_le'];
    const q = v => {
      const s = String(v ?? '');
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lignes = [...D.entites].sort((a, b) => a.type.localeCompare(b.type) || a.nom.localeCompare(b.nom))
      .map(e => cols.map(c => q(c === 'parent_nom' ? (parId(e.parent_id) || {}).nom : e[c])).join(';'));
    return '﻿' + [cols.join(';'), ...lignes].join('\n');
  }

  // ---------- Routeur ----------
  async function traiter(url, method, body) {
    charger();
    const [chemin, qs] = url.split('?');
    const params = new URLSearchParams(qs || '');
    let m;

    if (chemin === '/api/meta') return { types: copie(TYPES), listes: copie(D.listes), admin, version: 0 };
    if (chemin === '/api/version') return { version: 0 };
    if (chemin === '/api/login') {
      if ((await sha256(body.password || '')) !== D.password) erreur('Mot de passe incorrect', 401);
      admin = true;
      return { admin: true };
    }
    if (chemin === '/api/logout') { admin = false; return { admin: false }; }
    if (chemin === '/api/password') {
      exigerAdmin();
      if ((body.password || '').length < 4) erreur('Mot de passe trop court (4 caractères minimum)');
      D.password = await sha256(body.password);
      return { ok: true };
    }
    if (chemin === '/api/entites' && method === 'GET') {
      return copie(D.entites.filter(e => (!params.get('type') || e.type === params.get('type'))
        && (!params.get('parent_id') || e.parent_id === Number(params.get('parent_id'))))
        .sort((a, b) => a.type.localeCompare(b.type) || a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' })));
    }
    if (chemin === '/api/entites' && method === 'POST') return creer(body);
    if ((m = chemin.match(/^\/api\/entites\/(\d+)\/coups$/))) return coups(Number(m[1]), body);
    if ((m = chemin.match(/^\/api\/entites\/(\d+)$/))) {
      const id = Number(m[1]);
      if (method === 'PUT') return modifier(id, body);
      if (method === 'DELETE') return supprimer(id, body.motif);
      const e = parId(id);
      if (!e) erreur('Introuvable', 404);
      return {
        ...copie(e),
        enfants: copie(D.entites.filter(x => x.parent_id === id)),
        historique: copie(D.historique.filter(h => h.entite_id === id).slice(-100).reverse()),
      };
    }
    if (chemin === '/api/dashboard') return tableauDeBord();
    if (chemin === '/api/historique') return historique(Math.min(parseInt(params.get('limit'), 10) || 200, 2000));
    if (chemin === '/api/listes') {
      exigerAdmin();
      const cat = String(body.categorie || '').trim(), val = String(body.valeur || '').trim();
      if (!cat || !val) erreur('Catégorie et valeur obligatoires');
      const liste = D.listes[cat] = D.listes[cat] || [];
      if (method === 'POST' && !liste.includes(val)) liste.push(val);
      if (method === 'DELETE') D.listes[cat] = liste.filter(v => v !== val);
      return { ok: true };
    }
    if (chemin === '/api/sauvegarde') { exigerAdmin(); return sauvegarde(); }
    if (chemin === '/api/restauration') return restaurer(body);
    if (chemin === '/api/demo') return demo();
    if (chemin === '/api/export.csv') return csv();
    erreur('Action inconnue : ' + chemin, 404);
  }

  async function api(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const body = opts.body ? (typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body) : {};
    const avant = JSON.stringify(charger());
    try {
      const r = await traiter(url, method, body);
      if (method !== 'GET') sauver();
      return r;
    } catch (e) {
      D = JSON.parse(avant); // annule toute modification partielle
      throw e;
    }
  }

  const exportsApi = { api, TYPES, _reset() { D = null; admin = false; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsApi;
  root.Stockage = exportsApi;
})(typeof window !== 'undefined' ? window : globalThis);
