// Géométrie du profil topographique (`profil.js`) : la bande, sa validité, la
// mesure sur le graphique. Tout est pur : aucun DOM ici.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { PROFIL, CONFIG } = chargerScripts(['config.js', 'profil.js']);

// Les objets créés dans le contexte `vm` n'ont pas les prototypes de ce
// contexte-ci : `deepEqual` strict les refuserait, on compare leur JSON.
const plat = (v) => JSON.parse(JSON.stringify(v));
const proche = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('axe : longueur et vecteurs unitaires, normale à gauche', () => {
  const ax = PROFIL.axe([0, 0], [3, 4]);
  proche(ax.longueur, 5);
  proche(ax.ux, 0.6); proche(ax.uy, 0.8);
  proche(ax.nx, -0.8); proche(ax.ny, 0.6);
  assert.equal(PROFIL.axe([5, 5], [5, 5]), null);   // confondus : pas d'axe
});

test('largeurValide : bornée, jamais nulle ni infinie (Review Focus 3)', () => {
  const { largeurMinM, largeurMaxM, largeurDefautM } = CONFIG.profil;
  assert.equal(PROFIL.largeurValide(0), largeurMinM);
  assert.equal(PROFIL.largeurValide(-4), largeurMinM);
  assert.equal(PROFIL.largeurValide(500), largeurMaxM);
  assert.equal(PROFIL.largeurValide(Infinity), largeurDefautM);
  assert.equal(PROFIL.largeurValide(NaN), largeurDefautM);
  assert.equal(PROFIL.largeurValide(3), 3);
});

test('verdict : points confondus ou trop longue refusés, avec une consigne (Review Focus 2)', () => {
  assert.equal(PROFIL.verdict([0, 0], [0, 0.5]).ok, false);
  assert.match(PROFIL.verdict([0, 0], [0, 0.5]).raison, /proches/);
  assert.equal(PROFIL.verdict([0, 0], [2500, 0]).ok, false);
  assert.match(PROFIL.verdict([0, 0], [2500, 0]).raison, /2 km/);
  assert.equal(PROFIL.verdict([0, 0], [100, 0]).ok, true);
  assert.equal(PROFIL.verdict([0, 0], [2000, 0]).ok, true);   // pile la limite : permis
});

test('coins : une bande alignée sur X de 4 m de large', () => {
  const c = PROFIL.coins([10, 20], [30, 20], 4);
  const xs = c.map((p) => p[0]).sort((a, b) => a - b);
  const ys = c.map((p) => p[1]).sort((a, b) => a - b);
  assert.deepEqual(plat(xs), [10, 10, 30, 30]);
  assert.deepEqual(plat(ys), [18, 18, 22, 22]);
});

test('coins : bande oblique à 45°, les quatre coins à demi-largeur de l’axe', () => {
  const c = PROFIL.coins([0, 0], [10, 10], 2);
  for (const [x, y] of c) {
    const d = Math.abs((x - y) / Math.SQRT2);      // distance à l’axe y = x
    assert.ok(d < 1 + 1e-9);
  }
  // Les coins de l'extrémité A sont à 1 m de A.
  const pres = c.filter(([x, y]) => Math.hypot(x, y) < 1.5);
  assert.equal(pres.length, 2);
});

test('emprise : la boîte englobante de la bande', () => {
  const e = PROFIL.emprise([10, 20], [30, 20], 4);
  assert.deepEqual(plat(e), { xmin: 10, xmax: 30, ymin: 18, ymax: 22 });
});

test('mesurer : un triangle 3-4-5 sur le graphique, pente signée', () => {
  const m = PROFIL.mesurer({ s: 0, z: 100 }, { s: 4, z: 103 });
  proche(m.horizontale, 4); proche(m.denivele, 3); proche(m.totale, 5);
  proche(m.pente, 36.8698976, 1e-6);
  const d = PROFIL.mesurer({ s: 0, z: 103 }, { s: 4, z: 100 });
  proche(d.denivele, -3); proche(d.pente, -36.8698976, 1e-6);
  // Dans l'autre sens sur l'axe : l'horizontale reste positive.
  proche(PROFIL.mesurer({ s: 4, z: 100 }, { s: 0, z: 100 }).horizontale, 4);
});

test('mesurer : deux repères à la même abscisse → pas de pente inventée', () => {
  const m = PROFIL.mesurer({ s: 7, z: 100 }, { s: 7, z: 130 });
  proche(m.denivele, 30);
  assert.equal(m.pente, null);
});

test('graduations : des valeurs rondes qui encadrent l’intervalle', () => {
  assert.deepEqual(plat(PROFIL.graduations(0, 100, 5)), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(plat(PROFIL.graduations(139.9, 170.2, 6)), [140, 145, 150, 155, 160, 165, 170]);
  assert.deepEqual(plat(PROFIL.graduations(5, 5)), []);   // intervalle vide : rien
});

test('etendueZ : le tronçon et les classes visibles seulement', () => {
  const d = { n: 4, s: Float32Array.of(0, 10, 20, 30), z: Float32Array.of(100, 130, 105, 200), cls: Uint8Array.of(2, 5, 2, 5) };
  assert.deepEqual(plat(PROFIL.etendueZ(d, 0, 30, null)), { zmin: 100, zmax: 200, n: 4 });
  assert.deepEqual(plat(PROFIL.etendueZ(d, 0, 20, null)), { zmin: 100, zmax: 130, n: 3 });
  assert.deepEqual(plat(PROFIL.etendueZ(d, 0, 30, new Set([2]))), { zmin: 100, zmax: 105, n: 2 });
  assert.equal(PROFIL.etendueZ(d, 0, 30, new Set([9])), null);   // rien de visible
});
