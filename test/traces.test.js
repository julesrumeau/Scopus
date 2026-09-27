// Détection des tracés : la découpe sur l'emprise, la mesure contre une
// référence (la BD TOPO dans le banc), puis le détecteur sur des SVF
// synthétiques à vérité connue.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { TRACES } = chargerScripts(['config.js', 'traces.js']);
const E = { xmin: 1000, xmax: 2000, ymin: 5000, ymax: 6000 };
const proche = (a, b, tol, quoi) => assert.ok(Math.abs(a - b) <= tol, `${quoi} : ${a} au lieu de ${b}`);

// ── Découpe ──────────────────────────────────────────────────────────────────

test('decouper : une traversée sans sommet dans l’emprise est gardée', () => {
  const l = TRACES.decouper([[[900, 5500], [2100, 5500]]], E);
  assert.equal(l.length, 1);
  proche(TRACES.longueur(l), 1000, 0.01, 'longueur');
});

test('decouper : ce qui est dehors disparaît, un L est coupé juste', () => {
  assert.equal(TRACES.decouper([[[0, 0], [10, 10]]], E).length, 0);
  // Un L qui sort par la droite puis revient : deux morceaux dans l'emprise.
  const l = TRACES.decouper([[[1500, 5200], [2500, 5200], [2500, 5800], [1500, 5800]]], E);
  assert.equal(l.length, 2);
  proche(TRACES.longueur(l), 1000, 0.01, 'longueur');
});

// ── Mesure ───────────────────────────────────────────────────────────────────

const REF = [[[1100, 5100], [1900, 5100]], [[1100, 5500], [1500, 5900], [1900, 5500]]];
const decaler = (lignes, dx, dy) => lignes.map((l) => l.map(([x, y]) => [x + dx, y + dy]));

test('mesurer : les mêmes lignes, 100 % et 100 %', () => {
  const m = TRACES.mesurer(REF, REF, E, 10);
  proche(m.rappel, 1, 0.01, 'rappel'); proche(m.precision, 1, 0.01, 'précision');
  proche(m.longueurReference, 800 + 2 * 400 * Math.SQRT2, 1, 'longueur de référence');
});

test('mesurer : décalées de 5 m, justes à 10 m, fausses à 2 m', () => {
  const d = decaler(REF, 0, 5);
  const a = TRACES.mesurer(d, REF, E, 10);
  proche(a.rappel, 1, 0.02, 'rappel à 10 m'); proche(a.precision, 1, 0.02, 'précision à 10 m');
  const b = TRACES.mesurer(d, REF, E, 2);
  assert.ok(b.rappel < 0.05 && b.precision < 0.05, `à 2 m : ${b.rappel} / ${b.precision}`);
});

test('mesurer : une ligne de trop de même longueur, précision à moitié', () => {
  const trop = [[[1100, 5300], [1900, 5300]]];
  const m = TRACES.mesurer([REF[0], ...trop], [REF[0]], E, 10);
  proche(m.rappel, 1, 0.01, 'rappel'); proche(m.precision, 0.5, 0.02, 'précision');
});

test('mesurer : rien de détecté, rappel nul, précision indéfinie', () => {
  const m = TRACES.mesurer([], REF, E, 10);
  assert.equal(m.rappel, 0);
  assert.ok(Number.isNaN(m.precision));
});
