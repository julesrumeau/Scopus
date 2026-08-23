// Rastérisation (`raster.js`), sur des nuages synthétiques à vérité connue.
//
// Deux sujets : `sommetZ`, le Z maximal toutes classes confondues, dont
// `terrain.js` se sert pour que la sélection et la mesure en 3D puissent
// viser n'importe quel point rendu ; et `classesSol`, la sélection réglable
// des classes ASPRS versées dans le sol (`solZ`) — sol et eau par défaut,
// mais n'importe quelle autre classe peut s'y ajouter depuis le panneau
// « Classes du sol ».

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';
import { nuageSynthetique, rectangle, COTE } from './nuages.js';

const { RASTER } = chargerScripts(['config.js', 'raster.js']);

test('`sommetZ` voit un point de végétation, ignoré du reste des grilles', () => {
  // Classe 5 (végétation haute) : le `switch` de `accumuler` la laisse filer
  // sans la verser dans `ncSomme` ni `batSomme`.
  const g = RASTER.rasteriser(nuageSynthetique({
    dansStructure: rectangle(4, 4),
    hauteur: 8,
    classeStructure: 5,
    trouSol: false,   // le sol reste vu sous l'arbre, seul son sommet nous intéresse
  }));

  const cx = Math.floor(g.W / 2), cy = Math.floor(g.H / 2);
  const c = cy * g.W + cx;

  // Rien dans le signal de détection : ni non classé, ni bâtiment.
  assert.equal(g.ncN[c], 0);
  assert.equal(g.batN[c], 0);

  // Mais `sommetZ` porte bien l'altitude de la cime, nettement au-dessus du sol.
  assert.ok(g.sommetZ[c] > 6, `sommet attendu au-dessus de 6 m locaux, obtenu ${g.sommetZ[c]}`);
  // Et `sommetCls` la classe qui le détient — 5, la végétation haute demandée.
  assert.equal(g.sommetCls[c], 5);

  // Loin de la structure, `sommetZ` reste au niveau du sol seul, classé 2.
  assert.ok(g.sommetZ[0] < 1, `sol nu attendu près de 0, obtenu ${g.sommetZ[0]}`);
  assert.equal(g.sommetCls[0], 2);
});

test('`sommetZ` reste à -Infinity là où aucun point n’a été vu', () => {
  const g = RASTER.creerGrilles({ xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, [0, 0, 1000], 1);
  assert.equal(g.sommetZ.length, g.W * g.H);
  assert.ok(g.sommetZ.every((v) => v === -Infinity));
});

// ── Classes du sol, réglables (§ CLAUDE.md « Classes du sol ») ──────────────
//
// `RASTER.accumuler` versait toujours SOL (2) et EAU (9) dans `solZ`, en dur.
// Un point de la classe choisie comme sol y va désormais lui aussi — et n'est
// alors *plus* compté comme signal de détection, même s'il s'agit d'une
// classe qui l'aurait été par défaut (non classé, bâtiment) : un même point
// ne doit pas nourrir les deux à la fois.

function bloc(points) {
  return {
    nbPoints: points.length,
    x: Float32Array.from(points.map((p) => p.x)),
    y: Float32Array.from(points.map((p) => p.y)),
    z: Float32Array.from(points.map((p) => p.z)),
    cls: Uint8Array.from(points.map((p) => p.cls)),
  };
}

test('par défaut, seuls sol et eau nourrissent solZ — un non classé va au signal', () => {
  const g = RASTER.creerGrilles({ xmin: 0, xmax: 4, ymin: 0, ymax: 4 }, [0, 0, 0], 1);
  RASTER.accumuler(g, bloc([{ x: 0.5, y: 0.5, z: 10, cls: 2 }, { x: 1.5, y: 0.5, z: 12, cls: 1 }]));
  assert.equal(g.solN[0], 1);
  assert.equal(g.solZ[0], 10);
  assert.equal(g.solN[1], 0, 'le non classé ne va pas au sol par défaut');
  assert.equal(g.ncN[1], 1, 'il va au signal de détection');
});

test('une classe ajoutée au sol y va, et cesse de nourrir le signal de détection', () => {
  const g = RASTER.creerGrilles({ xmin: 0, xmax: 4, ymin: 0, ymax: 4 }, [0, 0, 0], 1, new Set([2, 9, 1]));
  RASTER.accumuler(g, bloc([{ x: 1.5, y: 0.5, z: 12, cls: 1 }]));
  assert.equal(g.solN[1], 1, 'la classe 1, choisie comme sol, y va');
  assert.equal(g.solZ[1], 12);
  assert.equal(g.ncN[1], 0, 'et ne compte plus dans le signal — jamais les deux à la fois');
});

test('même chose pour la classe bâtiment, choisie comme sol', () => {
  const g = RASTER.creerGrilles({ xmin: 0, xmax: 4, ymin: 0, ymax: 4 }, [0, 0, 0], 1, new Set([2, 9, 6]));
  RASTER.accumuler(g, bloc([{ x: 2.5, y: 0.5, z: 20, cls: 6 }]));
  assert.equal(g.solN[2], 1);
  assert.equal(g.batN[2], 0, 'la classe 6, choisie comme sol, ne nourrit plus batSomme');
});

test('un tableau de classes (pas seulement un Set) est accepté', () => {
  const g = RASTER.creerGrilles({ xmin: 0, xmax: 4, ymin: 0, ymax: 4 }, [0, 0, 0], 1, [2, 3]);
  RASTER.accumuler(g, bloc([{ x: 0.5, y: 0.5, z: 5, cls: 3 }]));
  assert.equal(g.solN[0], 1);
});
