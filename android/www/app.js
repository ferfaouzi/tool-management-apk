/* Gestion des outils - interface (JavaScript sans dépendance) */
'use strict';

const S = { meta: null, entites: [], byId: {}, version: -1, view: 'dashboard', filtres: {}, ouverts: new Set() };
const HIER = ['societe', 'site', 'zone', 'ligne', 'machine'];
const COMPTEUR = ['machine', 'outil', 'module', 'posage', 'article'];
const $ = (sel, el = document) => el.querySelector(sel);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmt = n => Number(n || 0).toLocaleString('fr-FR');
const TYPES = () => Object.keys(S.meta.types);
const label = t => (S.meta.types[t] || {}).label || t;
const isAdmin = () => S.meta && S.meta.admin;

const api = Stockage.api; // données stockées dans le téléphone (store.js)

/* Enregistre un fichier : partage Android dans l'APK, téléchargement dans un navigateur */
async function telecharger(nom, contenu, type) {
  const P = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins;
  if (P && P.Filesystem && P.Share) {
    const b64 = btoa(unescape(encodeURIComponent(contenu)));
    const { uri } = await P.Filesystem.writeFile({ path: nom, data: b64, directory: 'CACHE' });
    await P.Share.share({ title: nom, files: [uri] });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([contenu], { type }));
  a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const jour = () => new Date().toISOString().slice(0, 10);
async function exporterCsv() {
  try { await telecharger(`outils-${jour()}.csv`, await api('/api/export.csv'), 'text/csv'); } catch (e) { toast(e.message, true); }
}
async function exporterSauvegarde() {
  try { await telecharger(`sauvegarde-outils-${jour()}.json`, JSON.stringify(await api('/api/sauvegarde'), null, 1), 'application/json'); }
  catch (e) { toast(e.message, true); }
}

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.style.display = 'block';
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.style.display = 'none'), 3200);
}

/* ---------- Données ---------- */
async function charger() {
  S.meta = await api('/api/meta');
  S.entites = await api('/api/entites');
  S.byId = {};
  S.entites.forEach(e => (S.byId[e.id] = e));
  S.version = S.meta.version;
  document.body.classList.toggle('is-admin', isAdmin());
  $('#btn-login').textContent = isAdmin() ? 'Quitter admin' : 'Mode admin';
  render();
}

function chemin(e) {
  const parts = [];
  let p = e && S.byId[e.parent_id];
  while (p) { parts.unshift(p.nom); p = S.byId[p.parent_id]; }
  return parts.join(' › ');
}
function ancetre(e, type) {
  let p = e;
  while (p) { if (p.type === type) return p; p = S.byId[p.parent_id]; }
  return null;
}
const enfants = id => S.entites.filter(e => (e.parent_id || null) === id);

function niveau(e) {
  if (!e.coups_max) return '';
  const r = e.nb_coups / e.coups_max;
  return r >= 1 ? 'crit' : r >= 0.9 ? 'warn' : '';
}
function barre(e) {
  if (!e.coups_max && !e.nb_coups) return '';
  if (!e.coups_max) return `<span class="coups">${fmt(e.nb_coups)} coups</span>`;
  const pct = Math.min(100, Math.round(100 * e.nb_coups / e.coups_max));
  return `<div class="bar ${niveau(e)}" title="${pct} %"><span style="width:${pct}%"></span></div>
          <span class="coups">${fmt(e.nb_coups)} / ${fmt(e.coups_max)} (${pct} %)</span>`;
}
function statutClass(s) {
  return { 'En service': 's-ok', 'En stock': 's-ok', 'En maintenance': 's-warn', "À l'arrêt": 's-warn', 'Hors service': 's-crit' }[s] || 's-info';
}
const badgeStatut = s => s ? `<span class="badge ${statutClass(s)}">${esc(s)}</span>` : '';
const options = (vals, sel, vide) =>
  (vide !== undefined ? `<option value="">${esc(vide)}</option>` : '') +
  vals.map(v => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(v)}</option>`).join('');

const optionsTypes = (types, sel, vide) =>
  (vide !== undefined ? `<option value="">${esc(vide)}</option>` : '') +
  types.map(t => `<option value="${t}" ${t === sel ? 'selected' : ''}>${esc(label(t))}</option>`).join('');

/* ---------- Vues ---------- */
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
  document.querySelectorAll('main > section').forEach(s => (s.hidden = s.id !== 'view-' + S.view));
  ({ dashboard: vueDashboard, liste: vueListe, arbre: vueArbre, historique: vueHistorique, admin: vueAdmin })[S.view]();
}

async function vueDashboard() {
  const el = $('#view-dashboard');
  const d = await api('/api/dashboard');
  const kpis = TYPES().map(t =>
    `<div class="card kpi" data-type="${t}"><div class="n">${fmt(d.compte[t])}</div><div class="l">${esc(label(t))}</div></div>`).join('');
  const alertes = d.alertes.length ? d.alertes.map(a => `
    <div class="alert ${a.niveau}" data-id="${a.id}">
      <span class="badge type">${esc(label(a.type))}</span>
      <div><strong>${esc(a.nom)}</strong><div class="path">${esc(chemin(S.byId[a.id] || a))}</div></div>
      <span class="what">${esc(a.alerte)}</span>
    </div>`).join('') : '<div class="empty">Aucune alerte ✔</div>';
  const statuts = Object.entries(d.statuts).map(([s, n]) =>
    `<div class="status-row">${badgeStatut(s)}<strong>${fmt(n)}</strong></div>`).join('') || '<div class="empty">—</div>';
  const top = d.top_coups.length ? `<table><tbody>${d.top_coups.map(e => `
    <tr data-id="${e.id}" style="cursor:pointer"><td><span class="badge type">${esc(label(e.type))}</span></td>
    <td><strong>${esc(e.nom)}</strong><div class="path">${esc(chemin(S.byId[e.id] || e))}</div></td><td>${barre(e)}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Aucun compteur</div>';
  el.innerHTML = `
    <h2>Tableau de bord</h2>
    ${S.entites.length ? '' : `<div class="card" style="margin-bottom:14px">La base est vide. ${isAdmin()
      ? 'Ajoutez une société ou chargez les <button class="btn small" id="demo">données d\'exemple</button>.'
      : 'Passez en <strong>mode admin</strong> pour créer vos éléments.'}</div>`}
    <div class="grid kpis">${kpis}</div>
    <div class="grid cols-2">
      <div class="card"><h3>Alertes (${d.alertes.length})</h3>${alertes}</div>
      <div class="card"><h3>États des équipements</h3>${statuts}</div>
      <div class="card"><h3>Compteurs de coups les plus élevés</h3><div class="table-wrap">${top}</div></div>
      <div class="card"><h3>Dernières actions</h3>${tableHisto(d.historique.slice(0, 10), true)}</div>
    </div>`;
  el.querySelectorAll('.kpi').forEach(k => k.onclick = () => { S.filtres = { type: k.dataset.type }; S.view = 'liste'; render(); });
  el.querySelectorAll('[data-id]').forEach(k => k.onclick = () => detail(+k.dataset.id));
  const demo = $('#demo', el);
  if (demo) demo.onclick = async () => { await api('/api/demo', { method: 'POST' }); toast('Données d\'exemple chargées'); charger(); };
}

function vueListe() {
  const el = $('#view-liste');
  const f = S.filtres;
  // Listes déroulantes en cascade : Société > Site > Zone > Ligne > Machine
  let parent = null;
  const cascade = HIER.map(t => {
    const choix = S.entites.filter(e => e.type === t && (!parent || e.parent_id === parent));
    if (f[t] && !choix.some(c => String(c.id) === String(f[t]))) delete f[t];
    const html = `<label>${esc(label(t))}<select data-f="${t}"><option value="">Tous</option>${choix.map(c =>
      `<option value="${c.id}" ${String(c.id) === String(f[t]) ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></label>`;
    if (f[t]) parent = +f[t];
    return html;
  }).join('');

  const q = (f.q || '').toLowerCase();
  const rows = S.entites.filter(e => {
    if (f.type && e.type !== f.type) return false;
    if (f.statut && e.statut !== f.statut) return false;
    if (f.alerte && !niveau(e) && !(e.type === 'article' && e.stock_min && e.quantite <= e.stock_min)) return false;
    for (const t of HIER) if (f[t] && (!ancetre(e, t) || String(ancetre(e, t).id) !== String(f[t]))) return false;
    if (q && ![e.nom, e.code, e.reference, e.emplacement, e.process, e.localisation, e.adresse].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"><h2 style="margin-right:auto">Liste des éléments</h2>
      <button class="btn" id="csv">Exporter CSV</button>
      <button class="btn primary admin-only" id="add">+ Ajouter</button></div>
    <div class="card">
      <div class="filters">
        ${cascade}
        <label>Type<select data-f="type">${optionsTypes(TYPES(), f.type, 'Tous')}</select></label>
        <label>Statut<select data-f="statut">${options(S.meta.listes.statut || [], f.statut, 'Tous')}</select></label>
        <label>Recherche<input data-f="q" value="${esc(f.q || '')}" placeholder="Nom, code, emplacement…"></label>
        <label style="flex-direction:row;align-items:center"><input type="checkbox" data-f="alerte" style="min-width:0" ${f.alerte ? 'checked' : ''}> Alertes seulement</label>
        <button class="btn small" id="reset">Réinitialiser</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Type</th><th>Nom</th><th>Code / Réf.</th><th>Emplacement</th><th>Process</th><th>Statut</th><th>Coups / Stock</th><th></th></tr></thead>
        <tbody>${rows.map(e => `
          <tr>
            <td><span class="badge type">${esc(label(e.type))}</span></td>
            <td class="nom"><strong>${esc(e.nom)}</strong><div class="path">${esc(chemin(e))}</div></td>
            <td>${esc(e.code || e.reference)}</td>
            <td>${esc(e.emplacement)}${e.localisation ? `<div class="path">${esc(e.localisation)}</div>` : ''}</td>
            <td>${esc(e.process)}</td>
            <td>${badgeStatut(e.statut)}</td>
            <td>${e.type === 'article' ? `<span class="${e.stock_min && e.quantite <= e.stock_min ? 's-crit' : ''}">Stock : ${fmt(e.quantite)}</span> ` : ''}${barre(e)}</td>
            <td class="actions">
              <button class="btn small" data-act="voir" data-id="${e.id}">Voir</button>
              <button class="btn small admin-only" data-act="coup" data-id="${e.id}" title="Ajouter 1 coup">+1</button>
              <button class="btn small admin-only" data-act="edit" data-id="${e.id}">Modifier</button>
              <button class="btn small danger admin-only" data-act="del" data-id="${e.id}">Supprimer</button>
            </td>
          </tr>`).join('') || '<tr><td colspan="8" class="empty">Aucun élément</td></tr>'}
        </tbody></table></div>
      <div class="path" style="margin-top:8px">${rows.length} élément(s)</div>
    </div>`;

  el.querySelectorAll('[data-f]').forEach(inp => {
    const ev = inp.tagName === 'INPUT' && inp.type !== 'checkbox' ? 'input' : 'change';
    inp.addEventListener(ev, () => {
      const k = inp.dataset.f;
      f[k] = inp.type === 'checkbox' ? inp.checked : inp.value;
      if (HIER.includes(k)) HIER.slice(HIER.indexOf(k) + 1).forEach(t => delete f[t]);
      vueListe();
      if (k === 'q') { const i = $('[data-f="q"]', el); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    });
  });
  $('#reset', el).onclick = () => { S.filtres = {}; vueListe(); };
  $('#csv', el).onclick = exporterCsv;
  $('#add', el).onclick = () => {
    const dernier = [...HIER].reverse().find(t => f[t]);
    formulaire(null, { type: f.type || '', parent_id: dernier ? +f[dernier] : null });
  };
  bindActions(el);
}

function bindActions(el) {
  el.querySelectorAll('[data-act]').forEach(b => b.onclick = async ev => {
    ev.stopPropagation();
    const id = +b.dataset.id;
    if (b.dataset.act === 'voir') detail(id);
    if (b.dataset.act === 'edit') formulaire(S.byId[id]);
    if (b.dataset.act === 'del') supprimer(S.byId[id]);
    if (b.dataset.act === 'coup') {
      try { await api(`/api/entites/${id}/coups`, { method: 'POST', body: { increment: 1 } }); toast('Coup ajouté'); await charger(); }
      catch (e) { toast(e.message, true); }
    }
  });
}

function vueArbre() {
  const el = $('#view-arbre');
  const noeud = e => {
    const kids = enfants(e.id);
    const open = S.ouverts.has(e.id);
    return `<li>
      <span class="toggle" data-tg="${e.id}">${kids.length ? (open ? '▾' : '▸') : '•'}</span>
      <span class="node" data-id="${e.id}"><span class="badge type">${esc(label(e.type))}</span> <strong>${esc(e.nom)}</strong>
        ${badgeStatut(e.statut)} ${e.coups_max ? `<span class="coups ${niveau(e) === 'crit' ? 's-crit' : niveau(e) === 'warn' ? 's-warn' : ''}">${fmt(e.nb_coups)}/${fmt(e.coups_max)}</span>` : ''}</span>
      ${isAdmin() && (Object.entries(S.meta.types).some(([, d]) => d.parents.includes(e.type))) ? `<button class="btn small" data-addto="${e.id}">+</button>` : ''}
      ${kids.length && open ? `<ul>${kids.map(noeud).join('')}</ul>` : ''}
    </li>`;
  };
  const racines = enfants(null);
  el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h2 style="margin-right:auto">Arborescence</h2>
      <button class="btn small" id="tout-ouvrir">Tout déplier</button><button class="btn small" id="tout-fermer">Tout replier</button>
      <button class="btn primary admin-only" id="add-root">+ Nouvelle société</button></div>
    <div class="card tree">${racines.length ? `<ul>${racines.map(noeud).join('')}</ul>` : '<div class="empty">Aucun élément</div>'}</div>`;
  el.querySelectorAll('[data-tg]').forEach(t => t.onclick = () => {
    const id = +t.dataset.tg; S.ouverts.has(id) ? S.ouverts.delete(id) : S.ouverts.add(id); vueArbre();
  });
  el.querySelectorAll('.node').forEach(n => n.onclick = () => detail(+n.dataset.id));
  el.querySelectorAll('[data-addto]').forEach(b => b.onclick = () => formulaire(null, { parent_id: +b.dataset.addto }));
  $('#tout-ouvrir', el).onclick = () => { S.entites.forEach(e => S.ouverts.add(e.id)); vueArbre(); };
  $('#tout-fermer', el).onclick = () => { S.ouverts.clear(); vueArbre(); };
  $('#add-root', el).onclick = () => formulaire(null, { type: 'societe' });
}

function tableHisto(h, compact) {
  if (!h.length) return '<div class="empty">Aucune action</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Élément</th><th>Action</th>${compact ? '' : '<th>Détails</th>'}<th>Motif</th>${compact ? '' : '<th>Par</th>'}</tr></thead><tbody>
    ${h.map(r => `<tr><td class="coups">${esc((r.date || '').replace('T', ' '))}</td>
      <td>${r.entite_type ? `<span class="badge type">${esc(label(r.entite_type))}</span> ` : ''}${esc(r.entite_nom)}</td>
      <td>${esc(r.action)}</td>${compact ? '' : `<td class="path">${esc(r.details)}</td>`}<td>${esc(r.motif)}</td>${compact ? '' : `<td>${esc(r.utilisateur)}</td>`}</tr>`).join('')}
  </tbody></table></div>`;
}

async function vueHistorique() {
  const el = $('#view-historique');
  const h = await api('/api/historique?limit=500');
  el.innerHTML = `<h2>Historique des actions</h2><div class="card">${tableHisto(h, false)}</div>`;
}

function vueAdmin() {
  const el = $('#view-admin');
  if (!isAdmin()) {
    el.innerHTML = `<h2>Administration</h2><div class="card">Le mode administrateur permet d'ajouter, modifier et supprimer les éléments.
      <div style="margin-top:12px"><button class="btn primary" id="go-login">Se connecter en admin</button></div></div>`;
    $('#go-login', el).onclick = login;
    return;
  }
  const L = S.meta.listes;
  const cats = { statut: 'Statuts', motif: 'Motifs', process: 'Process' };
  el.innerHTML = `<h2>Administration</h2>
    <div class="grid cols-2">
      ${Object.entries(cats).map(([c, t]) => `<div class="card"><h3>Liste déroulante : ${t}</h3>
        ${(L[c] || []).map(v => `<div class="status-row"><span>${esc(v)}</span><button class="btn small danger" data-dl="${esc(c)}" data-v="${esc(v)}">Supprimer</button></div>`).join('')}
        <div class="filters" style="margin-top:10px"><input id="new-${c}" placeholder="Nouvelle valeur"><button class="btn primary" data-al="${c}">Ajouter</button></div></div>`).join('')}
      <div class="card"><h3>Sauvegarde</h3>
        <p><button class="btn" id="save">Enregistrer une sauvegarde (JSON)</button> <button class="btn" id="csv2">Exporter CSV</button></p>
        <p><label class="btn">Restaurer une sauvegarde… <input type="file" id="restore" accept=".json" hidden></label></p>
        <p class="path">La restauration remplace toutes les données actuelles.</p>
      </div>
      <div class="card"><h3>Mot de passe administrateur</h3>
        <div class="filters"><input type="password" id="pwd1" placeholder="Nouveau mot de passe"><input type="password" id="pwd2" placeholder="Confirmer">
        <button class="btn primary" id="pwd">Changer</button></div></div>
      <div class="card"><h3>Données</h3>
        <p>Les données sont enregistrées dans ce téléphone, sans connexion internet.</p>
        <p class="path">Pensez à enregistrer régulièrement une sauvegarde : elle permet aussi de transférer les données vers un autre téléphone (Restaurer une sauvegarde).</p>
      </div>
    </div>`;
  $('#save', el).onclick = exporterSauvegarde;
  $('#csv2', el).onclick = exporterCsv;
  el.querySelectorAll('[data-al]').forEach(b => b.onclick = async () => {
    const c = b.dataset.al, v = $('#new-' + c, el).value.trim();
    if (!v) return;
    try { await api('/api/listes', { method: 'POST', body: { categorie: c, valeur: v } }); await charger(); } catch (e) { toast(e.message, true); }
  });
  el.querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => {
    try { await api('/api/listes', { method: 'DELETE', body: { categorie: b.dataset.dl, valeur: b.dataset.v } }); await charger(); } catch (e) { toast(e.message, true); }
  });
  $('#pwd', el).onclick = async () => {
    const a = $('#pwd1', el).value, b = $('#pwd2', el).value;
    if (a !== b) return toast('Les mots de passe ne correspondent pas', true);
    try { await api('/api/password', { method: 'POST', body: { password: a } }); toast('Mot de passe modifié'); $('#pwd1', el).value = $('#pwd2', el).value = ''; }
    catch (e) { toast(e.message, true); }
  };
  $('#restore', el).onchange = async ev => {
    const file = ev.target.files[0];
    if (!file || !confirm('Remplacer toutes les données par cette sauvegarde ?')) return;
    try { const r = await api('/api/restauration', { method: 'POST', body: JSON.parse(await file.text()) }); toast(r.entites + ' élément(s) restauré(s)'); await charger(); }
    catch (e) { toast(e.message, true); }
  };
}

/* ---------- Fenêtres ---------- */
function modal(titre, body, foot) {
  $('#modal-title').textContent = titre;
  $('#modal-body').innerHTML = body;
  $('#modal-foot').innerHTML = foot || '';
  $('#modal-bg').classList.add('open');
}
const fermer = () => $('#modal-bg').classList.remove('open');

const CHAMPS = [
  ['nom', 'Nom *'], ['code', 'Code'], ['emplacement', 'Emplacement'], ['adresse', 'Adresse'],
  ['localisation', 'Localisation'], ['process', 'Process'], ['objectif', 'Objectif'],
  ['nb_coups', 'Nombre de coups'], ['coups_max', 'Coups max (limite)'], ['statut', 'Statut'], ['motif', 'Motif'],
];
const CHAMPS_ARTICLE = [['reference', 'Référence'], ['fournisseur', 'Fournisseur'], ['quantite', 'Quantité en stock'], ['stock_min', 'Stock minimum']];

async function detail(id) {
  let e;
  try { e = await api('/api/entites/' + id); } catch (err) { return toast(err.message, true); }
  const champs = [...CHAMPS, ...(e.type === 'article' ? CHAMPS_ARTICLE : []), ['description', 'Description']];
  const peutAjouter = Object.entries(S.meta.types).some(([, d]) => d.parents.includes(e.type));
  modal(`${label(e.type)} : ${e.nom}`, `
    <div class="path" style="margin-bottom:10px">${esc(chemin(e) || 'Racine')} · id ${e.id}</div>
    ${e.coups_max ? `<div style="margin-bottom:12px">${barre(e)}</div>` : ''}
    <dl class="dl">${champs.filter(([k]) => e[k] !== '' && e[k] !== null && !(k === 'coups_max' && !e[k])).map(([k, l]) =>
      `<dt>${esc(l.replace(' *', ''))}</dt><dd>${k === 'statut' ? badgeStatut(e[k]) : ['nb_coups', 'coups_max', 'quantite', 'stock_min'].includes(k) ? fmt(e[k]) : esc(e[k])}</dd>`).join('')}
      <dt>Créé le</dt><dd>${esc((e.cree_le || '').replace('T', ' '))}</dd><dt>Modifié le</dt><dd>${esc((e.modifie_le || '').replace('T', ' '))}</dd></dl>
    <h3 style="margin-top:18px">Éléments rattachés (${e.enfants.length})</h3>
    ${e.enfants.length ? `<div class="table-wrap"><table><tbody>${e.enfants.map(c => `<tr data-id="${c.id}" style="cursor:pointer">
      <td><span class="badge type">${esc(label(c.type))}</span></td><td>${esc(c.nom)}</td><td>${badgeStatut(c.statut)}</td><td>${barre(c)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun</div>'}
    <h3 style="margin-top:18px">Historique</h3>${tableHisto(e.historique, false)}`,
    `${peutAjouter ? '<button class="btn admin-only" id="m-add">+ Ajouter un élément rattaché</button>' : ''}
     ${e.coups_max || COMPTEUR.includes(e.type) ? '<button class="btn admin-only" id="m-reset">Remise à zéro coups</button>' : ''}
     <button class="btn danger admin-only" id="m-del">Supprimer</button>
     <button class="btn primary admin-only" id="m-edit">Modifier</button>
     <button class="btn" id="m-close">Fermer</button>`);
  $('#modal-body').querySelectorAll('[data-id]').forEach(r => r.onclick = () => detail(+r.dataset.id));
  $('#m-close').onclick = fermer;
  $('#m-edit').onclick = () => formulaire(S.byId[e.id] || e);
  $('#m-del').onclick = () => supprimer(e);
  const add = $('#m-add'); if (add) add.onclick = () => formulaire(null, { parent_id: e.id });
  const rz = $('#m-reset'); if (rz) rz.onclick = async () => {
    const motif = await demanderMotif('Remise à zéro du compteur', `Remettre à zéro le compteur de « ${e.nom} » ?`);
    if (motif === null) return;
    try { await api(`/api/entites/${e.id}/coups`, { method: 'POST', body: { reset: true, motif } }); toast('Compteur remis à zéro'); await charger(); detail(e.id); }
    catch (err) { toast(err.message, true); }
  };
}

function parentsPossibles(type) {
  const allowed = (S.meta.types[type] || {}).parents || [];
  return S.entites.filter(e => allowed.includes(e.type))
    .map(e => ({ id: e.id, txt: `${label(e.type)} : ${[chemin(e), e.nom].filter(Boolean).join(' › ')}` }))
    .sort((a, b) => a.txt.localeCompare(b.txt, 'fr'));
}

function formulaire(e, init = {}) {
  if (!isAdmin()) return toast('Mode administrateur requis', true);
  const edit = !!e;
  const v = { ...(e || {}), ...init };
  if (!edit && !v.type && v.parent_id) {
    const p = S.byId[v.parent_id];
    v.type = TYPES().find(t => S.meta.types[t].parents.includes(p.type)) || '';
  }
  const typesPossibles = TYPES().filter(t => !v.parent_id || S.meta.types[t].parents.includes((S.byId[v.parent_id] || {}).type));

  const draw = () => {
    const t = v.type;
    const champs = t ? [...CHAMPS, ...(t === 'article' ? CHAMPS_ARTICLE : [])] : [];
    const par = t ? parentsPossibles(t).filter(p => !edit || p.id !== e.id) : [];
    const racine = t && S.meta.types[t].parents.includes(null);
    const L = S.meta.listes;
    const input = ([k, l]) => {
      if (k === 'statut') return `<label>${l}<select name="${k}">${options(L.statut || [], v[k] || 'En service')}</select></label>`;
      if (k === 'motif') return `<label>${l}<select name="${k}">${options(L.motif || [], v[k], '—')}</select></label>`;
      if (k === 'process') return `<label>${l}<input name="${k}" list="dl-process" value="${esc(v[k])}"><datalist id="dl-process">${options(L.process || [])}</datalist></label>`;
      const num = ['nb_coups', 'coups_max', 'quantite', 'stock_min'].includes(k);
      return `<label>${l}<input name="${k}" ${num ? 'type="number" min="0" inputmode="numeric"' : ''} value="${esc(v[k] ?? (num ? 0 : ''))}"></label>`;
    };
    $('#modal-body').innerHTML = `<form class="form" id="frm" onsubmit="return false">
      <label>Type *<select name="type" ${edit ? 'disabled' : ''}>${optionsTypes(edit ? [t] : typesPossibles, t, '— Choisir —')}</select></label>
      ${t ? `<label>Rattaché à ${racine ? '' : '*'}<select name="parent_id">${racine ? '<option value="">— Aucun (racine) —</option>' : '<option value="">— Choisir —</option>'}${par.map(p =>
        `<option value="${p.id}" ${String(p.id) === String(v.parent_id ?? '') ? 'selected' : ''}>${esc(p.txt)}</option>`).join('')}</select></label>` : ''}
      ${champs.map(input).join('')}
      ${t ? `<label class="full">Description<textarea name="description" rows="3">${esc(v.description)}</textarea></label>` : ''}
    </form>`;
    const frm = $('#frm');
    frm.type.onchange = () => { v.type = frm.type.value; collect(); draw(); };
  };
  const collect = () => {
    new FormData($('#frm')).forEach((val, k) => { if (k !== 'type') v[k] = val; });
  };
  modal(edit ? `Modifier : ${e.nom}` : 'Ajouter un élément', '', '<button class="btn" id="f-cancel">Annuler</button><button class="btn primary" id="f-save">Enregistrer</button>');
  draw();
  $('#f-cancel').onclick = fermer;
  $('#f-save').onclick = async () => {
    if (!v.type) return toast('Choisissez un type', true);
    collect();
    const body = { ...v };
    delete body.id; delete body.enfants; delete body.historique; delete body.cree_le; delete body.modifie_le;
    body.parent_id = body.parent_id ? +body.parent_id : null;
    try {
      const r = edit ? await api('/api/entites/' + e.id, { method: 'PUT', body })
        : await api('/api/entites', { method: 'POST', body });
      fermer(); toast(edit ? 'Modifications enregistrées' : 'Élément créé');
      if (r.parent_id) S.ouverts.add(r.parent_id);
      await charger();
    } catch (err) { toast(err.message, true); }
  };
}

function demanderMotif(titre, texte) {
  return new Promise(resolve => {
    modal(titre, `<p>${esc(texte)}</p><div class="form"><label>Motif<select id="motif-sel">${options(S.meta.listes.motif || [], '', '—')}</select></label></div>`,
      '<button class="btn" id="mo-no">Annuler</button><button class="btn danger" id="mo-ok">Confirmer</button>');
    $('#mo-no').onclick = () => { fermer(); resolve(null); };
    $('#mo-ok').onclick = () => { const m = $('#motif-sel').value; fermer(); resolve(m); };
  });
}

async function supprimer(e) {
  const n = (function compte(id) { return enfants(id).reduce((s, c) => s + 1 + compte(c.id), 0); })(e.id);
  const motif = await demanderMotif('Supprimer', `Supprimer « ${e.nom} »${n ? ` et ses ${n} élément(s) rattaché(s)` : ''} ? Cette action est définitive.`);
  if (motif === null) return;
  try { await api('/api/entites/' + e.id, { method: 'DELETE', body: { motif } }); toast('Élément supprimé'); await charger(); }
  catch (err) { toast(err.message, true); }
}

async function login() {
  if (isAdmin()) { await api('/api/logout', { method: 'POST' }); toast('Mode lecture'); return charger(); }
  modal('Mode administrateur', `<form class="form" onsubmit="return false"><label class="full">Mot de passe<input type="password" id="pw" autofocus></label></form>
    <p class="path">Mot de passe par défaut : <strong>admin</strong> (à changer dans Administration).</p>`,
    '<button class="btn" id="l-no">Annuler</button><button class="btn primary" id="l-ok">Connexion</button>');
  const go = async () => {
    try { await api('/api/login', { method: 'POST', body: { password: $('#pw').value } }); fermer(); toast('Mode administrateur activé'); await charger(); }
    catch (err) { toast(err.message, true); }
  };
  $('#l-ok').onclick = go;
  $('#pw').onkeydown = ev => { if (ev.key === 'Enter') go(); };
  $('#l-no').onclick = fermer;
  setTimeout(() => $('#pw').focus(), 50);
}

/* ---------- Démarrage ---------- */
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { S.view = b.dataset.view; render(); });
$('#btn-login').onclick = login;
$('#modal-close').onclick = fermer;
$('#modal-bg').onclick = ev => { if (ev.target.id === 'modal-bg') fermer(); };
const th = $('#theme');
th.value = document.documentElement.dataset.theme || 'industriel';
th.onchange = () => { document.documentElement.dataset.theme = th.value; try { localStorage.setItem('tm-theme', th.value); } catch (e) {} };
charger().catch(e => toast(e.message, true));
