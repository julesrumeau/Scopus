// Géométrie de la grille de la vue : alignement, marge, plafond, conversions
// des réglages en mètres. Fonctions pures.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { VUE_GRILLE, CONFIG } = chargerScripts(['config.js', 'vue-grille.js']);

test('la grille couvre la vue plus la marge, alignée sur le pas', () => {
  const g = VUE_GRILLE.definir({ xmin: 877123.4, xmax: 877623.4, ymin: 6903010, ymax: 6903310 }, 0.5, 40, 4096);
  assert.equal(g.pasCm, 50);
  assert.equal(g.xminCm % 50, 0);
  assert.equal(g.yminCm % 50, 0);
  assert.ok(g.emprise.xmin <= 877123.4 - 40 && g.emprise.xmin > 877123.4 - 40 - 0.5);
  assert.ok(g.emprise.xmax >= 877623.4 + 40 && g.emprise.xmax < 877623.4 + 40 + 0.5);
  assert.equal(g.emprise.xmax, (g.xminCm + g.W * g.pasCm) / 100);
  assert.equal(g.pas, 0.5);
});

test('au-delà du plafond, le pas est relevé', () => {
  const g = VUE_GRILLE.definir({ xmin: 0, xmax: 10000, ymin: 0, ymax: 5000 }, 0.5, 0, 4096);
  assert.ok(g.W <= 4096 && g.H <= 4096);
  assert.ok(g.pasCm > 50);
  assert.ok(g.emprise.xmax >= 10000);
});

test('un pas en centimètres entiers, jamais nul', () => {
  assert.equal(VUE_GRILLE.definir({ xmin: 0, xmax: 1, ymin: 0, ymax: 1 }, 0.004, 0, 4096).pasCm, 1);
  assert.equal(VUE_GRILLE.definir({ xmin: 0, xmax: 100, ymin: 0, ymax: 100 }, 1.234, 0, 4096).pasCm, 123);
});

test('réglages en mètres convertis selon le pas', () => {
  assert.equal(VUE_GRILLE.passes(3, 0.25), 12);
  assert.equal(VUE_GRILLE.passes(3, 0.5), 6);
  assert.equal(VUE_GRILLE.passes(3, 20), 1);
  assert.equal(VUE_GRILLE.rayon(0.5, 0.25), 2);
  assert.equal(VUE_GRILLE.rayon(0.5, 5), 0);
});

test('la marge couvre la plus grande portée des couches et du terrain', () => {
  const p = { ...CONFIG.relief, ...CONFIG.flux };
  assert.equal(VUE_GRILLE.marge(p), Math.max(p.svfRayonM, 3 * p.rayonMicroReliefM) + p.comblementM + p.lissageM);
});

test('coupe : une emprise touche-t-elle la grille', () => {
  const g = VUE_GRILLE.definir({ xmin: 1000, xmax: 2000, ymin: 1000, ymax: 2000 }, 1, 0, 4096);
  assert.equal(VUE_GRILLE.coupe({ xmin: 1500, xmax: 2500, ymin: 0, ymax: 1200 }, g), true);
  assert.equal(VUE_GRILLE.coupe({ xmin: 2000, xmax: 3000, ymin: 0, ymax: 1200 }, g), false);
});
