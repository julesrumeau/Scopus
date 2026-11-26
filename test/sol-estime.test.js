// Le sol prolongé sous les trous (toits, canopée fermée, eau) pour les hauteurs de la 3D. Pur : une grille de sol (altitude, case connue
// ou non), un rayon en mètres ; rend une altitude par case : mesurée ou comblée si elle est connue, estimée si un sol connu est assez près,
// NaN sinon (le sol est alors dit inconnu, jamais peint comme du sol).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargerScripts } from './charger.js';

const { SOL_ESTIME } = chargerScripts(['sol-estime.js']);

/** Une grille W×H de pas 0,5 m : `connue(x, y)` dit si le sol y est connu, `altitude(x, y)` en mètres. */
function grille(W, H, connue, altitude) {
  const mnt = new Float32Array(W * H), valide = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { mnt[y * W + x] = altitude(x, y); valide[y * W + x] = connue(x, y) ? 1 : 0; }
  return { W, H, pas: 0.5, mnt, valide };
}

test('entre deux sols connus, l’altitude estimée passe de l’un à l’autre', () => {
  const g = grille(100, 9, (x) => x < 40 || x >= 60, (x) => (x < 50 ? 10 : 20));
  const z = SOL_ESTIME.prolonger(g, 30);
  const au = (x, y = 4) => z[y * 100 + x];
  assert.ok(Math.abs(au(49) - 15) < 2.5 && Math.abs(au(50) - 15) < 2.5, `${au(49)} ${au(50)}`);
  assert.ok(au(41) < au(49) && au(49) < au(58), 'croissant d’un bord à l’autre');
  assert.ok(au(41) < 13 && au(58) > 17);
});

test('les cases à sol connu ne bougent pas', () => {
  const g = grille(60, 9, (x) => x < 20, (x, y) => 5 + x * 0.1 + y * 0.01);
  const z = SOL_ESTIME.prolonger(g, 30);
  for (let i = 0; i < g.mnt.length; i++) if (g.valide[i]) assert.equal(z[i], g.mnt[i]);
});

test('au-delà du rayon d’un sol connu : NaN (inconnu), en deçà : un nombre', () => {
  const g = grille(200, 5, (x) => x < 10, () => 7);
  const z = SOL_ESTIME.prolonger(g, 30);   // 30 m = 60 cases
  assert.ok(Number.isFinite(z[2 * 200 + 10 + 50]), 'à 25 m');
  assert.ok(Number.isNaN(z[2 * 200 + 10 + 61]), 'à plus de 30 m');
  assert.ok(Number.isNaN(z[2 * 200 + 199]));
  assert.equal(z[2 * 200 + 10 + 50], 7);   // un seul bord connu : on prolonge sa valeur
});

test('une pente régulière est prolongée sous un trou à peu de chose près', () => {
  const g = grille(80, 80, (x, y) => !(x >= 30 && x < 50 && y >= 30 && y < 50), (x) => 0.1 * x * 0.5 * 2);
  const z = SOL_ESTIME.prolonger(g, 30);
  const vrai = (x) => 0.1 * x;
  for (const [x, y] of [[40, 40], [31, 31], [48, 35]]) assert.ok(Math.abs(z[y * 80 + x] - vrai(x)) < 0.6, `(${x},${y}) : ${z[y * 80 + x]} contre ${vrai(x)}`);
});

test('rien du tout de connu : tout est inconnu ; grille trop grande : null', () => {
  const g = grille(10, 10, () => false, () => 0);
  assert.ok(SOL_ESTIME.prolonger(g, 30).every(Number.isNaN));
  assert.equal(SOL_ESTIME.prolonger(grille(10, 10, () => true, () => 1), 30, { maxCases: 50 }), null);
});

test('la hauteur inconnue est une valeur sentinelle très négative, reconnue par le shader', () => {
  assert.ok(SOL_ESTIME.inconnue <= -500);
  const s = readFileSync(new URL('../src/shaders.js', import.meta.url), 'utf8');
  const rampe = s.slice(s.indexOf('vec3 rampeHauteur'), s.indexOf('}', s.indexOf('vec3 rampeHauteur')));
  assert.match(rampe, /h < -500\.0/);
});
