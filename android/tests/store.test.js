const test = require('node:test');
const assert = require('node:assert');

// Faux localStorage pour exécuter store.js hors du téléphone
const mem = {};
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
const { api, _reset } = require('../www/store.js');

const admin = () => api('/api/login', { method: 'POST', body: { password: 'admin' } });
const neuf = async () => { for (const k in mem) delete mem[k]; _reset(); };

test('lecture seule sans mode admin', async () => {
  await neuf();
  assert.strictEqual((await api('/api/meta')).admin, false);
  await assert.rejects(api('/api/entites', { method: 'POST', body: { type: 'societe', nom: 'X' } }), /administrateur/);
  await assert.rejects(api('/api/login', { method: 'POST', body: { password: 'faux' } }), /incorrect/);
});

test('hiérarchie complète et règles de rattachement', async () => {
  await neuf(); await admin();
  let pid = null;
  for (const t of ['societe', 'site', 'zone', 'ligne', 'machine', 'outil', 'module', 'posage', 'article']) {
    pid = (await api('/api/entites', { method: 'POST', body: { type: t, nom: t.toUpperCase(), parent_id: pid } })).id;
  }
  assert.strictEqual((await api('/api/entites')).length, 9);
  const s = (await api('/api/entites?type=societe'))[0].id;
  await assert.rejects(api('/api/entites', { method: 'POST', body: { type: 'machine', nom: 'M', parent_id: s } }), /ne peut pas/);
  await assert.rejects(api('/api/entites', { method: 'POST', body: { type: 'site', nom: 'S' } }), /doit être rattaché/);
  await assert.rejects(api('/api/entites', { method: 'POST', body: { type: 'societe', nom: '' } }), /obligatoire/);
});

test('modification, suppression en cascade, historique et persistance', async () => {
  await neuf(); await admin();
  const s = (await api('/api/entites', { method: 'POST', body: { type: 'societe', nom: 'S' } })).id;
  const site = (await api('/api/entites', { method: 'POST', body: { type: 'site', nom: 'Site', parent_id: s } })).id;
  await api(`/api/entites/${site}`, { method: 'PUT', body: { nom: 'Site 2', motif: 'Réglage' } });
  const d = await api(`/api/entites/${site}`);
  assert.strictEqual(d.nom, 'Site 2');
  assert.strictEqual(d.historique[0].motif, 'Réglage');
  _reset(); await admin(); // relit les données enregistrées
  assert.strictEqual((await api('/api/entites')).length, 2);
  assert.strictEqual((await api(`/api/entites/${s}`, { method: 'DELETE', body: { motif: 'Autre' } })).supprimes, 2);
  assert.deepStrictEqual(await api('/api/entites'), []);
});

test('une erreur ne laisse pas de modification partielle', async () => {
  await neuf(); await admin();
  const s = (await api('/api/entites', { method: 'POST', body: { type: 'societe', nom: 'S' } })).id;
  await assert.rejects(api(`/api/entites/${s}`, { method: 'PUT', body: { nom: 'Nouveau', nb_coups: 'abc' } }));
  assert.strictEqual((await api(`/api/entites/${s}`)).nom, 'S');
});

test('compteur de coups propagé, alertes et remise à zéro', async () => {
  await neuf(); await admin();
  const ids = {}; let pid = null;
  for (const t of ['societe', 'site', 'zone', 'ligne', 'machine', 'outil']) {
    ids[t] = pid = (await api('/api/entites', { method: 'POST', body: { type: t, nom: t, parent_id: pid, coups_max: t === 'outil' ? 10 : 0 } })).id;
  }
  await api(`/api/entites/${ids.machine}/coups`, { method: 'POST', body: { increment: 9 } });
  assert.strictEqual((await api(`/api/entites/${ids.outil}`)).nb_coups, 9);
  const d = await api('/api/dashboard');
  assert.ok(d.alertes.some(a => a.id === ids.outil && a.niveau === 'attention'));
  await api(`/api/entites/${ids.outil}/coups`, { method: 'POST', body: { reset: true, motif: 'Usure' } });
  assert.strictEqual((await api(`/api/entites/${ids.outil}`)).nb_coups, 0);
});

test('données d\'exemple, export CSV, sauvegarde et restauration', async () => {
  await neuf(); await admin();
  await api('/api/demo', { method: 'POST' });
  assert.match(await api('/api/export.csv'), /Presse 400T/);
  const dump = await api('/api/sauvegarde');
  await api(`/api/entites/${dump.entites[0].id}`, { method: 'DELETE', body: {} });
  const r = await api('/api/restauration', { method: 'POST', body: dump });
  assert.strictEqual(r.entites, dump.entites.length);
  assert.strictEqual((await api('/api/entites')).length, dump.entites.length);
  const n = (await api('/api/entites', { method: 'POST', body: { type: 'societe', nom: 'Après' } })).id;
  assert.ok(n > Math.max(...dump.entites.map(e => e.id)));
});

test('changement du mot de passe admin', async () => {
  await neuf(); await admin();
  await api('/api/password', { method: 'POST', body: { password: 'atelier1' } });
  await api('/api/logout', { method: 'POST' });
  await assert.rejects(admin(), /incorrect/);
  await api('/api/login', { method: 'POST', body: { password: 'atelier1' } });
});
