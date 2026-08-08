// Tests de la détection de sentiers sur terrains synthétiques.
//
// Le point délicat n'est pas de trouver une ligne creuse — c'est de distinguer
// un sentier d'une ravine. Les deux sont des creux linéaires ; seule leur
// relation à la pente les sépare. Ces tests posent donc les deux côte à côte
// sur le même versant.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { detecterSentiers, CONFIG } = chargerScripts(['config.js', 'proj.js', 'raster.js', 'sentiers.js']);

const X0 = 592000, Y0 = 6183000;
const COTE = 200;          // 200 × 200 m
const PAS = 0.25;

/**
 * Fabrique des grilles directement, sans passer par un nuage de points : on
 * teste la géométrie du détecteur, pas la rastérisation.
 *
 * @param {(x:number,y:number)=>number} creux profondeur du creux en (x, y), en m
 * @param {number} penteDeg inclinaison générale du versant, vers +x
 */
function terrain(creux, penteDeg = 15) {
  const W = COTE / PAS, H = COTE / PAS;
  const mnt = new Float32Array(W * H);
  const tan = Math.tan(penteDeg * Math.PI / 180);

  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = i * PAS, y = j * PAS;
      // Ondulation douce : un plan parfait est irréaliste et rendrait le test
      // trop facile pour le modèle de relief local.
      const fond = x * tan + 0.6 * Math.sin(x / 37) * Math.cos(y / 41);
      mnt[j * W + i] = fond - (creux ? creux(x, y) : 0);
    }
  }

  return {
    W, H, pas: PAS, mnt,
    solN: new Uint8Array(W * H).fill(4),
    emprise: { xmin: X0, xmax: X0 + COTE, ymin: Y0, ymax: Y0 + COTE },
    origine: [X0 + COTE / 2, Y0 + COTE / 2, 1000],
  };
}

// Creux gaussien de `profondeur` le long d'une droite d'angle `angleDeg`.
function sillon(angleDeg, profondeur = 0.4, largeur = 1.2) {
  const a = angleDeg * Math.PI / 180;
  const nx = -Math.sin(a), ny = Math.cos(a);   // normale à la direction
  const cx = COTE / 2, cy = COTE / 2;
  return (x, y) => {
    const d = (x - cx) * nx + (y - cy) * ny;
    return profondeur * Math.exp(-(d * d) / (2 * largeur * largeur));
  };
}

test('trouve un sentier qui traverse le versant', () => {
  // Versant incliné vers +x ; sentier orienté à 90°, donc suivant les courbes
  // de niveau — le tracé qu'emprunterait n'importe qui.
  const r = detecterSentiers(terrain(sillon(90, 0.4)));

  assert.ok(r.traces.length >= 1, `aucune trace (${r.stats.chainesBrutes} chaînes brutes)`);
  const s = r.traces[0];
  assert.ok(s.longueur > 100, `longueur ${s.longueur.toFixed(0)} m, attendue > 100`);
  assert.ok(Math.abs(s.profondeurMed - 0.4) < 0.35,
    `profondeur ${s.profondeurMed.toFixed(2)} m, attendue ≈ 0.4`);
  assert.ok(s.alignementPente < 0.4,
    `alignement ${s.alignementPente.toFixed(2)} — un tracé de niveau doit être proche de 0`);
});

test('écarte une ravine qui suit la ligne de plus grande pente', () => {
  // Même creux, même profondeur, mais orienté dans le sens de la pente.
  const r = detecterSentiers(terrain(sillon(0, 0.4)));
  assert.equal(r.traces.length, 0,
    `une ravine a été retenue : ${JSON.stringify(r.traces.map((s) => s.alignementPente))}`);
  assert.ok(r.stats.rejets.ravine > 0, 'doit être écartée sur le critère d’alignement');
});

test('sépare les deux quand ils coexistent sur le même versant', () => {
  const deux = (x, y) => Math.max(sillon(90, 0.4)(x, y), sillon(0, 0.4)(x, y));
  const r = detecterSentiers(terrain(deux));

  assert.ok(r.traces.length >= 1, 'le sentier doit être retenu');
  assert.ok(r.stats.rejets.ravine > 0, 'la ravine doit être écartée');
  for (const s of r.traces) {
    assert.ok(s.alignementPente < CONFIG.sentiers.alignementMax,
      `trace retenue trop alignée à la pente : ${s.alignementPente.toFixed(2)}`);
  }
});

test('terrain sans creux : aucune trace', () => {
  const r = detecterSentiers(terrain(null));
  assert.equal(r.traces.length, 0, `${r.traces.length} trace(s) sur un versant nu`);
});

test('un creux trop court est écarté', () => {
  // Sillon limité à une tache de 10 m.
  const court = (x, y) => {
    const d = Math.hypot(x - COTE / 2, y - COTE / 2);
    return d < 5 ? 0.4 * Math.exp(-(d * d) / 8) : 0;
  };
  const r = detecterSentiers(terrain(court));
  assert.equal(r.traces.length, 0);
});

test('les points publiés sont géoréférencés et simplifiés', () => {
  const s = detecterSentiers(terrain(sillon(90, 0.4))).traces[0];

  assert.ok(s.points.length >= 2, 'polyligne vide');
  assert.ok(s.points.length < s.longueur / CONFIG.sentiers.toleranceM,
    `${s.points.length} points pour ${s.longueur.toFixed(0)} m — simplification inopérante`);
  assert.equal(s.gps.length, s.points.length);

  for (const [x, y] of s.points) {
    assert.ok(x >= X0 - 1 && x <= X0 + COTE + 1, `x hors emprise : ${x}`);
    assert.ok(y >= Y0 - 1 && y <= Y0 + COTE + 1, `y hors emprise : ${y}`);
  }
  for (const [lat, lon] of s.gps) {
    assert.ok(lat > 41 && lat < 52 && lon > -6 && lon < 10, `GPS aberrant : ${lat}, ${lon}`);
  }
  assert.ok(s.altitude > 900 && s.altitude < 1100,
    `altitude ${s.altitude.toFixed(0)} m — doit être absolue, autour de 1000`);
});

test('aucune valeur non finie ne sort du détecteur', () => {
  for (const s of detecterSentiers(terrain(sillon(70, 0.5))).traces) {
    for (const [cle, v] of Object.entries(s)) {
      if (typeof v === 'number') assert.ok(Number.isFinite(v), `${cle} = ${v}`);
    }
  }
});
