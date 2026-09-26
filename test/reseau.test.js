// Les deux files de reseau.js : chacune son plafond, aucune n'attend l'autre.
//
// Les tuiles de la photo passaient par la file des COPC, bornée à 3 requêtes
// en vol pour l'API de téléchargement : une centaine de tuiles y mettaient 6 à
// 30 s. Ce qui se vérifie ici avec un faux `fetch` : la file des tuiles monte
// à son plafond à elle, et une rafale de tuiles ne retarde pas une requête
// COPC — ni l'inverse.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

function monter() {
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  const enVol = { defaut: 0, tuiles: 0 }, pic = { defaut: 0, tuiles: 0 };
  const liberer = [];
  ctx.fetch = (url) => {
    const f = url.includes('tuile') ? 'tuiles' : 'defaut';
    enVol[f]++; pic[f] = Math.max(pic[f], enVol[f]);
    return new Promise((ok) => liberer.push(() => {
      enVol[f]--;
      ok({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(4) });
    }));
  };
  return { ctx, pic, enVol, liberer };
}

const souffler = () => new Promise((r) => setImmediate(r));

test('la file des tuiles monte à son propre plafond, celle des COPC reste à 3', async () => {
  const { ctx, pic, liberer } = monter();
  const tuiles = Array.from({ length: 40 }, (_, i) => ctx.RESEAU.recuperer(`https://x/tuile${i}`, { file: 'tuiles' }));
  const copc = Array.from({ length: 10 }, (_, i) => ctx.RESEAU.recuperer(`https://x/copc${i}`));
  await souffler();
  assert.equal(pic.tuiles, ctx.CONFIG.reseau.requetesParallelesTuiles);
  assert.equal(pic.defaut, ctx.CONFIG.reseau.requetesParallèles);
  // On vide tout, par vagues.
  while (liberer.length) { liberer.splice(0).forEach((f) => f()); await souffler(); }
  await Promise.all([...tuiles, ...copc]);
});

test('une rafale de tuiles ne fait pas attendre une requête COPC', async () => {
  const { ctx, enVol, liberer } = monter();
  Array.from({ length: 200 }, (_, i) => ctx.RESEAU.recuperer(`https://x/tuile${i}`, { file: 'tuiles' }).catch(() => {}));
  ctx.RESEAU.recuperer('https://x/copc');
  await souffler();
  assert.equal(enVol.defaut, 1, 'la requête COPC part tout de suite, sans attendre les tuiles');
  while (liberer.length) { liberer.splice(0).forEach((f) => f()); await souffler(); }
});

test('sans file précisée, c’est la file des COPC', async () => {
  const { ctx, pic, liberer } = monter();
  const r = Array.from({ length: 8 }, (_, i) => ctx.RESEAU.recuperer(`https://x/copc${i}`));
  await souffler();
  assert.equal(pic.defaut, 3);
  while (liberer.length) { liberer.splice(0).forEach((f) => f()); await souffler(); }
  await Promise.all(r);
});
