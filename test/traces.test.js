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

// ── Détecteur, sur des SVF synthétiques ─────────────────────────────────────
// Une grille de 200 × 200 m à 50 cm, un fond de SVF à 0,85 bruité (écart type
// 0,02, bruit blanc reproductible) : un chemin creux y est un trait plus
// sombre de 2 m de large.

function alea(graine) {
  let s = graine >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function svfSynthetique({ traits = [], taches = [], trous = [], graine = 1 } = {}) {
  const pas = 0.5, W = 400, H = 400, emprise = { xmin: 0, ymin: 0, xmax: 200, ymax: 200 };
  const r = alea(graine);
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
  const svf = new Float32Array(W * H), valide = new Uint8Array(W * H);
  for (let cy = 0; cy < H; cy++) for (let cx = 0; cx < W; cx++) {
    const x = (cx + 0.5) * pas, y = (cy + 0.5) * pas;
    let v = 0.85 + 0.02 * gauss();
    for (const t of traits) {
      let d = Infinity;
      for (let i = 1; i < t.length; i++) {
        const [ax, ay] = t[i - 1], [bx, by] = t[i];
        const L2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2));
        d = Math.min(d, Math.hypot(x - ax - u * (bx - ax), y - ay - u * (by - ay)));
      }
      v -= 0.08 * Math.exp(-(d * d) / (2 * 1 * 1));
    }
    for (const [tx, ty, rayon] of taches) {
      const d = Math.hypot(x - tx, y - ty);
      v -= 0.08 * Math.exp(-(d * d) / (2 * (rayon / 2) ** 2));
    }
    let dansTrou = false;
    for (const [x0, y0, x1, y1] of trous) if (x >= x0 && x < x1 && y >= y0 && y < y1) dansTrou = true;
    svf[cy * W + cx] = dansTrou ? NaN : v;
    valide[cy * W + cx] = dansTrou ? 0 : 1;
  }
  return { t: { W, H, pas, emprise, valide }, svf, emprise };
}
/** Une courbe de x = 20 à 180 m : y = 100 + 20 sin(x / 25). */
const COURBE = Array.from({ length: 81 }, (_, k) => { const x = 20 + 2 * k; return [x, 100 + 20 * Math.sin(x / 25)]; });

test('detecter : un chemin creux courbe dans du bruit est retrouvé', () => {
  const s = svfSynthetique({ traits: [COURBE] });
  const r = TRACES.detecter(s.t, { svf: s.svf });
  const m = TRACES.mesurer(r.lignes, [COURBE], s.emprise, 2);
  assert.ok(m.rappel >= 0.9, `rappel ${m.rappel}`);
  assert.ok(m.precision >= 0.9, `précision ${m.precision}`);
});

test('detecter : une tache ronde n’est pas un tracé', () => {
  const s = svfSynthetique({ taches: [[100, 100, 6]] });
  assert.equal(TRACES.detecter(s.t, { svf: s.svf }).lignes.length, 0);
});

test('detecter : un chemin coupé par un trou sans sol reste un seul tracé', () => {
  const droite = [[20, 100], [180, 100]];
  const s = svfSynthetique({ traits: [droite], trous: [[98, 90, 102, 110]] });
  const r = TRACES.detecter(s.t, { svf: s.svf });
  assert.equal(r.lignes.length, 1, `${r.lignes.length} tracés`);
  assert.ok(TRACES.mesurer(r.lignes, [droite], s.emprise, 2).rappel >= 0.9);
});

test('detecter : rien sur du bruit seul', () => {
  const s = svfSynthetique({ graine: 7 });
  assert.equal(TRACES.detecter(s.t, { svf: s.svf }).lignes.length, 0);
});
