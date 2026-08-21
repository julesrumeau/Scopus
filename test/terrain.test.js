// Intersection rayon caméra ↔ terrain (`terrain.js`), sur des grilles à
// réponse connue.
//
// La géométrie enchaîne trois repères — rayon caméra en repère « monde »
// (voir `shaders.js`), grille en Lambert-93 local, résultat en Lambert-93
// absolu — et une erreur de signe sur l'un d'eux ne se voit qu'à l'écran :
// le point choisi tombe ailleurs que là où l'on a cliqué, sans qu'aucune
// exception ne le signale. D'où des cas à coordonnées calculées à la main,
// y compris un cas oblique qui mélange est-ouest et nord-sud — le seul à
// pouvoir attraper les deux axes échangés ou un signe inversé sur l'un
// d'eux seulement.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { TERRAIN } = chargerScripts(['terrain.js']);

/** Grille plate en Lambert-93 : altitude locale constante `zLocal` partout, sans sursol. */
function grillePlate(zLocal) {
  const W = 200, H = 200, pas = 1;
  return {
    W, H, pas,
    emprise: { xmin: 900, xmax: 1100, ymin: 1900, ymax: 2100 },
    origine: [1000, 2000, 50],
    mnt: new Float32Array(W * H).fill(zLocal),
    hauteur: new Float32Array(W * H),
  };
}

function assertPoint(obtenu, attendu, tol = 1e-6) {
  assert.ok(obtenu, 'aucune intersection trouvée, une était attendue');
  assert.ok(Math.abs(obtenu.x - attendu.x) <= tol, `x : obtenu ${obtenu.x}, attendu ${attendu.x}`);
  assert.ok(Math.abs(obtenu.y - attendu.y) <= tol, `y : obtenu ${obtenu.y}, attendu ${attendu.y}`);
  assert.ok(Math.abs(obtenu.sol - attendu.sol) <= tol, `sol : obtenu ${obtenu.sol}, attendu ${attendu.sol}`);
  assert.ok(Math.abs(obtenu.hauteur - attendu.hauteur) <= tol,
    `hauteur : obtenu ${obtenu.hauteur}, attendu ${attendu.hauteur}`);
}

test('visée verticale au centre d’un plan horizontal', () => {
  const t = grillePlate(10);   // sol absolu 60 m (origine[2] = 50)
  const rayon = { oeil: [0, 100, 0], direction: [0, -1, 0] };
  const r = TERRAIN.pointDuTerrain(rayon, t, 1, 10);
  assertPoint(r, { x: 1000, y: 2000, sol: 60, hauteur: 0 });
});

test('visée oblique — mélange est-ouest et nord-sud, attraperait un axe échangé', () => {
  const t = grillePlate(10);
  // Caméra au nord-ouest du centre, visant un point à 30 m à l’est et 20 m
  // au sud du centre — les deux axes bougent à la fois.
  const oeil = [-40, 100, -50];          // lambert (960, 2050)
  const cible = [30, 0, 20];             // lambert (1030, 1980), sol 60
  const dir = cible.map((v, i) => v - oeil[i]);
  const n = Math.hypot(...dir);
  const rayon = { oeil, direction: dir.map((v) => v / n) };
  const r = TERRAIN.pointDuTerrain(rayon, t, 1, 10);
  assertPoint(r, { x: 1030, y: 1980, sol: 60, hauteur: 0 }, 1e-3);
});

test('le point trouvé ne dépend pas de l’exagération verticale', () => {
  const t = grillePlate(10);
  // Caméra repositionnée dans le monde exagéré (×2,5), mais visant le même
  // point du terrain : x, y et sol doivent revenir identiques.
  const exag = 2.5;
  const rayon = { oeil: [0, 100, 0], direction: [0, -1, 0] };
  const r = TERRAIN.pointDuTerrain(rayon, t, exag, 10);
  assertPoint(r, { x: 1000, y: 2000, sol: 60, hauteur: 0 });
});

test('une bosse locale du sol est bien touchée, pas seulement le plan autour', () => {
  const t = grillePlate(10);
  const cx = 110, cy = 100;   // lambert (1010.5, 2000.5)
  t.mnt[cy * t.W + cx] = 30;   // sol absolu 80 m au lieu de 60
  const rayon = { oeil: [10.5, 100, 0], direction: [0, -1, 0] };
  const r = TERRAIN.pointDuTerrain(rayon, t, 1, 10);
  assertPoint(r, { x: 1010.5, y: 2000, sol: 80, hauteur: 0 }, 1e-2);
});

test('un bâtiment est touché sur son toit, pas sur le sol comblé en dessous', () => {
  // Le sol sous un bâtiment est une surface interpolée (comblement), jamais
  // rendue à l'écran : viser seulement `mnt` percerait le bâtiment sans le
  // voir. L'enveloppe (mnt + hauteur) doit arrêter le rayon au toit.
  const t = grillePlate(10);   // sol plat, 60 m partout
  const cx = 110, cy = 100;    // lambert (1010.5, 2000.5)
  t.hauteur[cy * t.W + cx] = 12;   // un bâtiment de 12 m à cet endroit
  const rayon = { oeil: [10.5, 100, 0], direction: [0, -1, 0] };   // vertical
  const r = TERRAIN.pointDuTerrain(rayon, t, 1, 10);
  assertPoint(r, { x: 1010.5, y: 2000, sol: 60, hauteur: 12 }, 1e-2);
});

test('un rayon qui ne croise jamais la grille rend null', () => {
  const t = grillePlate(10);
  const rayon = { oeil: [0, 100, 0], direction: [0, 1, 0] };   // vers le ciel
  assert.equal(TERRAIN.pointDuTerrain(rayon, t, 1, 10), null);
});

test('sans grille (aucune dalle chargée), rend null plutôt que d’échouer', () => {
  const rayon = { oeil: [0, 100, 0], direction: [0, -1, 0] };
  assert.equal(TERRAIN.pointDuTerrain(rayon, null, 1, 10), null);
});
