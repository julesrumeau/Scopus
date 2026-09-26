// Le relief de la vue calculé dans un worker. En file://, un worker ne peut
// rien charger : son source est composé du texte des fonctions (comme la
// décompression, decodeur.js). Ce qui se vérifie ici : que ce source se suffit
// à lui-même et rend exactement le calcul du fil principal, et que rien de
// raster.js n'a été oublié en route — un oubli ne se verrait qu'à l'appel,
// dans le worker, loin de sa cause.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { chargerScripts } from './charger.js';

const FICHIERS = ['config.js', 'vue-grille.js', 'raster.js', 'relief.js', 'gl.js', 'shaders.js', 'gpu-relief.js', 'vue-relief.js', 'relief-travailleur.js'];

function bloc(cle, x0, y0) {
  const cote = 40, pasCm = 25, n = (cote * 100 / pasCm) ** 2;
  const xc = new Int32Array(n), yc = new Int32Array(n), zc = new Int32Array(n), cls = new Uint8Array(n);
  let k = 0;
  for (let y = 0; y < cote * 100; y += pasCm) {
    for (let x = 0; x < cote * 100; x += pasCm) {
      xc[k] = x; yc[k] = y; zc[k] = 30000 + Math.round(x * 0.05 + 60 * Math.exp(-(((x - 2000) ** 2 + (y - 2000) ** 2) / 2e5)));
      cls[k] = k % 7 === 0 ? 1 : 2; k++;
    }
  }
  return { cle, emprise: { xmin: x0, ymin: y0, xmax: x0 + cote, ymax: y0 + cote }, origineCm: [x0 * 100, y0 * 100, 0], points: { nbPoints: n, xc, yc, zc, cls } };
}

/** Exécute le source du worker dans un contexte nu, comme un vrai worker : aucun global du projet. */
function travailleur(source) {
  const recus = [];
  const self = { postMessage: (m) => recus.push(m) };
  const ctx = vm.createContext({ self, console, performance, Math, Float32Array, Float64Array, Int32Array, Uint8Array, Uint32Array, Uint8ClampedArray, Map, Set, Array, Object, JSON, Number, String, Error, Infinity, NaN });
  vm.runInContext(source, ctx);
  return { envoyer: (m) => self.onmessage({ data: m }), recus };
}

test('le source du worker se suffit à lui-même et calcule comme le fil principal', () => {
  const ctx = chargerScripts(FICHIERS);
  const w = travailleur(ctx.RELIEF_TRAVAILLEUR.source());
  w.envoyer({ type: 'demarrer' });
  assert.equal(w.recus[0].type, 'pret');
  assert.equal(w.recus[0].moteur, 'cpu');   // ni document ni OffscreenCanvas ici

  const geo = ctx.VUE_GRILLE.definir({ xmin: 1000, xmax: 1040, ymin: 2000, ymax: 2040 }, 0.5, 0, 4096);
  w.envoyer({ type: 'ajouter', bloc: bloc('a', 1000, 2000) });
  w.envoyer({ type: 'calculer', id: 7, geo, couche: 'svf' });
  const r = w.recus.at(-1);
  assert.equal(r.type, 'resultat', r.message);
  assert.equal(r.id, 7);

  const ref = ctx.VUE_RELIEF.creer({ moteur: 'cpu' });
  ref.ajouter(bloc('a', 1000, 2000));
  const attendu = ref.calculer(geo, 'svf');
  assert.equal(r.valeurs.length, attendu.valeurs.length);
  for (let i = 0; i < attendu.valeurs.length; i++) {
    const a = attendu.valeurs[i], b = r.valeurs[i];
    assert.ok(Number.isNaN(a) ? Number.isNaN(b) : a === b, `case ${i} : ${a} ≠ ${b}`);
  }
  assert.equal(r.min, attendu.min);
  assert.equal(r.max, attendu.max);
});

test('sans bloc, un résultat vide ; une erreur revient comme un message', () => {
  const ctx = chargerScripts(FICHIERS);
  const w = travailleur(ctx.RELIEF_TRAVAILLEUR.source());
  w.envoyer({ type: 'demarrer' });
  const geo = ctx.VUE_GRILLE.definir({ xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, 0.5, 0, 4096);
  w.envoyer({ type: 'calculer', id: 1, geo, couche: 'svf' });
  assert.deepEqual({ ...w.recus.at(-1) }, { type: 'resultat', id: 1, vide: true });
  w.envoyer({ type: 'calculer', id: 2, geo: null, couche: 'svf' });
  assert.equal(w.recus.at(-1).type, 'erreur');
  assert.equal(w.recus.at(-1).id, 2);
});

test('retirer un bloc dans le worker', () => {
  const ctx = chargerScripts(FICHIERS);
  const w = travailleur(ctx.RELIEF_TRAVAILLEUR.source());
  w.envoyer({ type: 'demarrer' });
  const geo = ctx.VUE_GRILLE.definir({ xmin: 1000, xmax: 1040, ymin: 2000, ymax: 2040 }, 0.5, 0, 4096);
  w.envoyer({ type: 'ajouter', bloc: bloc('a', 1000, 2000) });
  w.envoyer({ type: 'retirer', cle: 'a' });
  w.envoyer({ type: 'calculer', id: 3, geo, couche: 'svf' });
  assert.equal(w.recus.at(-1).vide, true);
});

test('toutes les fonctions de raster.js partent dans le worker', () => {
  const ctx = chargerScripts(FICHIERS);
  const source = ctx.RELIEF_TRAVAILLEUR.source();
  const noms = [...readFileSync(new URL('../src/raster.js', import.meta.url), 'utf8').matchAll(/^function\s+(\w+)/gm)].map((m) => m[1]);
  assert.ok(noms.length > 10);
  for (const nom of noms) assert.match(source, new RegExp(`^function ${nom}\\(`, 'm'), nom);
});

test('sur le fil principal, la même interface', async () => {
  const ctx = chargerScripts(FICHIERS);
  const m = ctx.RELIEF_TRAVAILLEUR.surFilPrincipal({ moteur: 'cpu' });
  const info = await m.pret;
  assert.equal(info.moteur, 'cpu');
  const geo = ctx.VUE_GRILLE.definir({ xmin: 1000, xmax: 1040, ymin: 2000, ymax: 2040 }, 0.5, 0, 4096);
  assert.equal(await m.calculer(geo, 'svf'), null);
  m.ajouter(bloc('a', 1000, 2000));
  const r = await m.calculer(geo, 'svf');
  assert.equal(r.valeurs.length, geo.W * geo.H);
  assert.equal(r.geo, geo);
});
