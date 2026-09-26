// Relief de la vue au processeur : blocs reçus → grille → terrain → surface →
// couche. Le chemin de la carte graphique (gpu-relief.js) est comparé à
// celui-ci par l'autocontrôle, dans le navigateur.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { VUE_RELIEF, VUE_GRILLE, RASTER, RELIEF } = chargerScripts(
  ['config.js', 'vue-grille.js', 'raster.js', 'relief.js', 'vue-relief.js']);

/** Bloc d'une dalle au coin (x0, y0) en mètres : un plan à 300 m, une bosse, des points tous les 25 cm. */
function bloc(cle, x0, y0, { cote = 60, pasCm = 25, zBase = 30000 } = {}) {
  const n = (cote * 100 / pasCm) ** 2;
  const xc = new Int32Array(n), yc = new Int32Array(n), zc = new Int32Array(n), cls = new Uint8Array(n);
  let k = 0;
  for (let y = 0; y < cote * 100; y += pasCm) {
    for (let x = 0; x < cote * 100; x += pasCm) {
      const bosse = 80 * Math.exp(-(((x - 3000) ** 2 + (y - 3000) ** 2) / 2e5));
      xc[k] = x; yc[k] = y; zc[k] = zBase + Math.round(x * 0.05 + bosse); cls[k] = 2; k++;
    }
  }
  return { cle, emprise: { xmin: x0, ymin: y0, xmax: x0 + cote, ymax: y0 + cote }, origineCm: [x0 * 100, y0 * 100, 0], points: { nbPoints: n, xc, yc, zc, cls } };
}

const vue = { xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2060 };
const geo = VUE_GRILLE.definir(vue, 0.5, 0, 4096);

test('sans bloc, rien à calculer', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  assert.equal(m.surface(geo), null);
  assert.equal(m.calculer(geo, 'ombrage'), null);
});

test('la surface de la vue est celle de la chaîne de référence', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  const b = bloc('a', 1000, 2000);
  m.ajouter(b);
  const t = m.surface(geo);
  assert.equal(t.W, geo.W);
  assert.equal(t.H, geo.H);

  const r = VUE_RELIEF.reglagesDefaut(geo.pas);
  const g = RASTER.creerGrillesVue(geo, 30000 - 100, r.classesSol);
  RASTER.accumuler(g, { ...b.points, origineCm: b.origineCm });
  RASTER.finaliser(g, { moteur: 'cpu', passes: r.passes, rayonLissage: r.rayonLissage });
  const ref = RELIEF.preparer(g, { moteur: 'cpu', pasM: geo.pas, garderRepli: true });
  let ecart = 0;
  for (let i = 0; i < t.N; i++) ecart = Math.max(ecart, Math.abs(t.mnt[i] - ref.mnt[i]));
  assert.ok(ecart < 1e-6, `écart ${ecart}`);
});

test('une couche se calcule et porte sa géométrie', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const c = m.calculer(geo, 'ombrage');
  assert.equal(c.valeurs.length, geo.W * geo.H);
  assert.equal(c.moteurSurface, 'cpu');
  assert.ok(Number.isFinite(c.min) && Number.isFinite(c.max));
  assert.equal(c.geo, geo);
});

test('un bloc hors de la grille n’est pas rangé', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('loin', 5000, 5000));
  assert.equal(m.surface(geo), null);
});

test('retirer un bloc change la surface', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const avant = m.surface(geo);
  m.retirer('a');
  assert.equal(m.taille(), 0);
  assert.equal(m.surface(geo), null);
  assert.ok(avant);
});

test('la surface est mémoïsée, et recalculée quand les réglages changent', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const t1 = m.surface(geo);
  assert.equal(m.surface(geo), t1);
  m.reglages({ classesSol: new Set([9]) });   // plus aucun sol
  const t2 = m.surface(geo);
  assert.notEqual(t2, t1);
  assert.equal(t2.valide.reduce((s, v) => s + v, 0), 0);
});

test('deux dalles d’altitudes très différentes tiennent dans la même grille', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('bas', 1000, 2000, { cote: 30, zBase: 20000 }));
  m.ajouter(bloc('haut', 1030, 2000, { cote: 30, zBase: 80000 }));
  const t = m.surface(VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 0.5, 0, 4096));
  const i = 10 * t.W + 5, j = 10 * t.W + 100;
  assert.ok(t.mnt[j] - t.mnt[i] > 590, `${t.mnt[i]} → ${t.mnt[j]}`);
});
