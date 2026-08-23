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

test('un arbre — signal absent de `hauteur` — est touché via `sommet`', () => {
  // `hauteur` ne porte que le signal de détection (non classé, bâtiment) : la
  // végétation n'y figure jamais. `sommet` est le Z maximal toutes classes
  // confondues, alimenté séparément — c'est lui qui doit arrêter le rayon.
  const t = grillePlate(10);   // sol plat, 60 m partout
  const cx = 110, cy = 100;    // lambert (1010.5, 2000.5)
  t.sommet = new Float32Array(t.W * t.H).fill(-Infinity);
  t.sommet[cy * t.W + cx] = 18;   // houppier d'un arbre à 18 m locaux
  const rayon = { oeil: [10.5, 100, 0], direction: [0, -1, 0] };
  const r = TERRAIN.pointDuTerrain(rayon, t, 1, 10);
  assertPoint(r, { x: 1010.5, y: 2000, sol: 60, hauteur: 8 }, 1e-2);
});

test('une classe masquée à l’affichage cesse de répondre au clic', () => {
  // Décocher une classe (§ « Filtrage des classes ») la retire du rendu — le
  // vertex shader la rejette, alpha à zéro. Sans `sommetCls`, `sommet`
  // continuerait de pointer sur ce point devenu invisible, et le rayon
  // s'arrêterait en l'air, à l'ancienne position d'un arbre qu'on vient de
  // décocher.
  const t = grillePlate(10);   // sol plat, 60 m partout
  const cx = 110, cy = 100;
  const idx = cy * t.W + cx;
  t.sommet = new Float32Array(t.W * t.H).fill(-Infinity);
  t.sommetCls = new Uint8Array(t.W * t.H);
  t.sommet[idx] = 18;      // houppier d'un arbre à 18 m locaux
  t.sommetCls[idx] = 5;    // classe ASPRS « végétation haute »
  const rayon = { oeil: [10.5, 100, 0], direction: [0, -1, 0] };

  // Classe visible : le rayon s'arrête sur la cime.
  const visible = TERRAIN.pointDuTerrain(rayon, t, 1, 10, new Set());
  assertPoint(visible, { x: 1010.5, y: 2000, sol: 60, hauteur: 8 }, 1e-2);

  // Classe 5 décochée : le rayon retombe sur le sol, aucune hauteur.
  const masquee = TERRAIN.pointDuTerrain(rayon, t, 1, 10, new Set([5]));
  assertPoint(masquee, { x: 1010.5, y: 2000, sol: 60, hauteur: 0 }, 1e-2);
});

test('`sommet` ne fait jamais reculer la hauteur trouvée par `hauteur`', () => {
  // Un bâtiment (12 m, dans `hauteur`) sur une cellule dont `sommet` porte un
  // sommet plus bas (par exemple un retour de sol brut) : le maximum des deux
  // gagne, jamais `sommet` seul.
  const t = grillePlate(10);
  const cx = 110, cy = 100;
  t.hauteur[cy * t.W + cx] = 12;
  t.sommet = new Float32Array(t.W * t.H).fill(-Infinity);
  t.sommet[cy * t.W + cx] = 10.5;   // sous mnt + hauteur (10 + 12 = 22)
  const rayon = { oeil: [10.5, 100, 0], direction: [0, -1, 0] };
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

// ── pointDuNuage — le pointé qui vise le nuage réellement affiché ───────────
//
// Repère « monde » (voir shaders.js) : (x, (z − zmin) · exagération, −y).
// Pour ces tests, zmin = 0 et exagération = 1, donc wx = x, wy = z, wz = −y —
// suffisant pour éprouver la géométrie sans complexifier l'arithmétique.
// Champ de vision de 90° et canevas de 100 px de haut : tan(45°) = 1, d'où
// une échelle pixel→monde de 0,02 par pas de profondeur, facile à vérifier
// à la main.

const rayonVertical = { oeil: [0, 100, 0], direction: [0, -1, 0] };
const optsNuage = (extra = {}) => ({ zmin: 0, exagerationZ: 1, fovYdeg: 90, hauteurPx: 100, ...extra });

function nuageTest(points) {
  const n = points.length;
  return {
    n,
    x: Float32Array.from(points.map((p) => p.x)),
    y: Float32Array.from(points.map((p) => p.y)),
    z: Float32Array.from(points.map((p) => p.z)),
    cls: Uint8Array.from(points.map((p) => p.cls ?? 2)),
    origine: [1000, 2000, 50],
  };
}

test('un point du nuage proche du rayon est retenu, à son altitude exacte', () => {
  const nuage = nuageTest([{ x: 0.01, y: 0, z: 5 }]);
  const r = TERRAIN.pointDuNuage(rayonVertical, nuage, optsNuage());
  assert.ok(r, 'un point était attendu dans le seuil');
  assert.ok(Math.abs(r.x - 1000.01) < 1e-6, `x : ${r.x}`);
  assert.ok(Math.abs(r.y - 2000) < 1e-6, `y : ${r.y}`);
  assert.ok(Math.abs(r.sol - 55) < 1e-6, `sol : ${r.sol}`);
  assert.equal(r.hauteur, 0, 'un point ponctuel n’a pas de hauteur séparée — c’est déjà le sommet visé');
});

test('un point hors du seuil en pixels est ignoré', () => {
  // À 95 m de profondeur (t), le seuil vaut 0,02 · 95 · 8 px ≈ 15,2 m ; un
  // écart de 20 m au rayon doit donc être rejeté.
  const nuage = nuageTest([{ x: 20, y: 0, z: 5 }]);
  assert.equal(TERRAIN.pointDuNuage(rayonVertical, nuage, optsNuage()), null);
});

test('parmi deux points dans le seuil, le plus proche de la caméra gagne', () => {
  // Deux points quasiment sous le rayon, à des profondeurs différentes : celui
  // qui occulterait l'autre à l'écran doit être choisi, quel que soit l'ordre
  // dans le tableau.
  const loin = { x: 0.01, y: 0, z: 3 };    // plus bas, donc plus loin de la caméra
  const pres = { x: 0.01, y: 0, z: 5 };    // plus haut, donc plus près
  for (const [premier, second] of [[loin, pres], [pres, loin]]) {
    const nuage = nuageTest([premier, second]);
    const r = TERRAIN.pointDuNuage(rayonVertical, nuage, optsNuage());
    assert.ok(Math.abs(r.sol - 55) < 1e-6, `le point le plus proche (z=5, sol=55) devait gagner, obtenu sol=${r.sol}`);
  }
});

test('un point derrière la caméra ne compte pas, même dans l’axe du rayon', () => {
  const nuage = nuageTest([{ x: 0, y: 0, z: 150 }]);   // au-dessus de l'œil, qui regarde vers le bas
  assert.equal(TERRAIN.pointDuNuage(rayonVertical, nuage, optsNuage()), null);
});

test('une classe masquée est ignorée, comme au rendu (§ Filtrage des classes)', () => {
  const nuage = nuageTest([{ x: 0.01, y: 0, z: 5, cls: 5 }]);
  assert.ok(TERRAIN.pointDuNuage(rayonVertical, nuage, optsNuage()), 'visible par défaut');
  assert.equal(
    TERRAIN.pointDuNuage(rayonVertical, nuage, optsNuage({ classesMasquees: new Set([5]) })),
    null,
    'masquée, elle ne doit plus répondre au clic',
  );
});

test('sans nuage, nuage vide, ou canevas non dimensionné, rend null', () => {
  assert.equal(TERRAIN.pointDuNuage(rayonVertical, null, optsNuage()), null);
  assert.equal(TERRAIN.pointDuNuage(rayonVertical, nuageTest([]), optsNuage()), null);
  const nuage = nuageTest([{ x: 0.01, y: 0, z: 5 }]);
  assert.equal(TERRAIN.pointDuNuage(rayonVertical, nuage, optsNuage({ hauteurPx: 0 })), null);
});
