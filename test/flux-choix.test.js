// Décisions du chargement piloté par la vue : quel pas, quel niveau, quels
// blocs, dans quel ordre, et quoi libérer. Fonctions pures.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { FLUX_CHOIX } = chargerScripts(['config.js', 'flux-choix.js']);

/** Dalle d'1 km² : niveau 0 (60 000 points), niveau 1 en 4 blocs, niveau 2 en 16. */
function dalle(xkm, ykm) {
  const index = new Map();
  index.set('0-0-0-0', { cle: { n: 0, x: 0, y: 0, z: 0 }, offset: 900, taille: 9, nbPoints: 60_000 });
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) index.set(`1-${x}-${y}-0`, { cle: { n: 1, x, y, z: 0 }, offset: 500 + x * 2 + y, taille: 1, nbPoints: 225_000 });
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) index.set(`2-${x}-${y}-0`, { cle: { n: 2, x, y, z: 0 }, offset: 100 + x * 4 + y, taille: 1, nbPoints: 230_000 });
  return { url: `u${xkm}_${ykm}`, emprise: { xmin: xkm * 1000, xmax: xkm * 1000 + 1000, ymin: ykm * 1000, ymax: ykm * 1000 + 1000 }, index };
}

test('le pas suit le pixel, jamais sous le plancher', () => {
  assert.equal(FLUX_CHOIX.pasPourVue(1400, 1400, 0.5), 1);
  assert.equal(FLUX_CHOIX.pasPourVue(100, 1400, 0.5), 0.5);
});

test('emprise d’un bloc : la dalle découpée en 2ⁿ', () => {
  const e = FLUX_CHOIX.empriseBloc({ xmin: 877000, ymin: 6903000 }, { n: 2, x: 3, y: 1 });
  assert.deepEqual({ ...e }, { xmin: 877750, xmax: 878000, ymin: 6903250, ymax: 6903500 });
});

test('niveau visé : le plus grossier qui atteint la densité voulue', () => {
  const d = { ...dalle(0, 0), surfaceM2: 1e6 };
  // 4 points par case de 4 m → 0,25 pt/m² : niveau 1 (0,96 pt/m² cumulés) suffit, pas le 0 (0,06).
  assert.equal(FLUX_CHOIX.niveauVise(d, 4, 4), 1);
  // Case de 1 m : 4 pts/m² demandés, le niveau 2 cumule 4,64 → 2.
  assert.equal(FLUX_CHOIX.niveauVise(d, 1, 4), 2);
  // Case de 0,5 m : jamais atteint, on prend le plus fin disponible.
  assert.equal(FLUX_CHOIX.niveauVise(d, 0.5, 4), 2);
});

test('blocs de la vue : niveau croissant, puis du centre vers les bords', () => {
  const dalles = [dalle(0, 0), dalle(1, 0)];
  const vue = { xmin: 500, xmax: 1500, ymin: 0, ymax: 1000 };
  const b = FLUX_CHOIX.blocsPourVue(dalles, vue, 4, 4, Infinity);
  const niveaux = Array.from(b, (x) => x.niveau);
  assert.deepEqual(niveaux, [...niveaux].sort((p, q) => p - q), 'niveaux croissants');
  // Aucun bloc hors de la vue (les blocs x=0 de la dalle 0, à gauche de 500 m).
  assert.ok(b.every((x) => x.emprise.xmax > vue.xmin && x.emprise.xmin < vue.xmax));
  // Au sein du niveau 1, le premier est le plus proche du centre (1000, 500).
  const n1 = b.filter((x) => x.niveau === 1);
  assert.ok(n1[0].distance <= n1[n1.length - 1].distance);
  assert.ok(b.every((x) => x.cle.startsWith(x.url + '#')));
});

test('blocs de la vue : tronqués au budget de points', () => {
  // 200 000 points : le niveau 0 (60 000) passe, le premier bloc de niveau 1 (225 000 de plus) non.
  const b = FLUX_CHOIX.blocsPourVue([dalle(0, 0)], { xmin: 0, xmax: 1000, ymin: 0, ymax: 1000 }, 4, 4, 200_000);
  assert.deepEqual(Array.from(b, (x) => x.niveau), [0]);
});

test('libérer : hors des blocs voulus seulement, le plus fin et le plus loin d’abord', () => {
  const vue = { xmin: 0, xmax: 1000, ymin: 0, ymax: 1000 };
  const e = (x) => ({ xmin: x, xmax: x + 250, ymin: 0, ymax: 250 });
  const charges = [
    { cle: 'a', niveau: 0, nbPoints: 100, emprise: e(0) },
    { cle: 'b', niveau: 2, nbPoints: 100, emprise: e(5000) },
    { cle: 'c', niveau: 2, nbPoints: 100, emprise: e(2000) },
    { cle: 'd', niveau: 1, nbPoints: 100, emprise: e(9000) },
  ];
  assert.deepEqual(Array.from(FLUX_CHOIX.aLiberer(charges, new Set(['a']), 250, vue)), ['b', 'c']);
  assert.equal(FLUX_CHOIX.aLiberer(charges, new Set(['a']), 1000, vue).length, 0);
  assert.equal(FLUX_CHOIX.aLiberer(charges, new Set(['a', 'b', 'c', 'd']), 0, vue).length, 0);
});

test('surface de la vue, en km²', () => {
  assert.equal(FLUX_CHOIX.surfaceKm2({ xmin: 0, xmax: 3000, ymin: 0, ymax: 2000 }), 6);
});
