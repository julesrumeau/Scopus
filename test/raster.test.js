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

const { RASTER, VUE_GRILLE } = chargerScripts(['config.js', 'vue-grille.js', 'raster.js']);

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

test('`sommetZ`/`sommetCls` restent toutes classes confondues même quand une classe devient sol', () => {
  // Les deux mécanismes sont indépendants : router une classe vers le sol ne
  // doit pas la retirer du sommet toutes classes que `terrain.js` utilise pour
  // le pointé 3D (voir le test dédié dans le fichier plus haut).
  const g = RASTER.creerGrilles({ xmin: 0, xmax: 4, ymin: 0, ymax: 4 }, [0, 0, 0], 1, new Set([2, 9, 1]));
  RASTER.accumuler(g, bloc([
    { x: 0.5, y: 0.5, z: 2, cls: 2 },    // sol, plus bas
    { x: 0.5, y: 0.5, z: 9, cls: 1 },    // non classé, choisi comme sol ici, et le plus haut
  ]));
  assert.equal(g.solN[0], 2, 'les deux points, classe 2 et classe 1, vont au sol');
  assert.ok(Math.abs(g.solZ[0] - 2) < 1e-6, 'solZ garde le minimum des deux');
  assert.equal(g.sommetZ[0], 9, 'sommetZ, lui, garde le maximum toutes classes');
  assert.equal(g.sommetCls[0], 1, 'et sa classe — même si cette classe est aussi devenue « sol »');
});

test('centimètres entiers : un point pile sur une limite de case tombe dans la case suivante', () => {
  const geo = VUE_GRILLE.definir({ xmin: 1000, xmax: 1002, ymin: 2000, ymax: 2002 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 10000, [2]);
  // Dalle au coin (1000 m, 2000 m) ; points à 50 cm, 99 cm, 100 cm du coin.
  RASTER.accumuler(g, {
    nbPoints: 3, origineCm: [100000, 200000, 0],
    xc: Int32Array.from([50, 99, 100]), yc: Int32Array.from([0, 0, 0]),
    zc: Int32Array.from([10123, 10200, 10300]), cls: Uint8Array.from([2, 2, 2]),
  });
  assert.equal(g.solN[1], 2);   // 50 et 99 cm : case 1
  assert.equal(g.solN[2], 1);   // 100 cm : case 2
  assert.ok(Math.abs(g.solZ[1] - 1.23) < 1e-6);   // minimum, relatif à 100 m
  assert.deepEqual([g.geoCm.xminCm, g.geoCm.pasCm, g.geoCm.zRefCm], [100000, 50, 10000]);
});

test('centimètres entiers : hors de la grille, ignoré', () => {
  const geo = VUE_GRILLE.definir({ xmin: 1000, xmax: 1001, ymin: 2000, ymax: 2001 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 0, [2]);
  RASTER.accumuler(g, {
    nbPoints: 2, origineCm: [99900, 200000, 0],
    xc: Int32Array.from([50, 250]), yc: Int32Array.from([10, 10]), zc: Int32Array.from([100, 100]), cls: Uint8Array.from([2, 2]),
  });
  assert.equal(g.solN.reduce((s, v) => s + v, 0), 0);   // 99950 cm et 100150 cm : hors de [100000, 100100[
});

test('centimètres entiers : mêmes classes que le chemin flottant', () => {
  const geo = VUE_GRILLE.definir({ xmin: 0, xmax: 4, ymin: 0, ymax: 4 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 0, [2, 9]);
  RASTER.accumuler(g, {
    nbPoints: 4, origineCm: [0, 0, 0],
    xc: Int32Array.from([10, 10, 10, 10]), yc: Int32Array.from([10, 10, 10, 10]),
    zc: Int32Array.from([100, 150, 300, 500]), cls: Uint8Array.from([9, 1, 6, 5]),
  });
  assert.equal(g.solN[0], 1);
  assert.equal(g.ncN[0], 1);
  assert.equal(g.batN[0], 1);
  assert.equal(g.totalN[0], 4);
  assert.ok(Math.abs(g.sommetZ[0] - 5) < 1e-6);
  assert.equal(g.sommetCls[0], 5);
});

test('finaliser : passes et rayon réglables', () => {
  const geo = VUE_GRILLE.definir({ xmin: 0, xmax: 10, ymin: 0, ymax: 1 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 0, [2]);
  RASTER.accumuler(g, { nbPoints: 1, origineCm: [0, 0, 0], xc: Int32Array.from([10]), yc: Int32Array.from([10]), zc: Int32Array.from([100]), cls: Uint8Array.from([2]) });
  RASTER.finaliser(g, { moteur: 'cpu', passes: 3, rayonLissage: 0 });
  // Une passe gagne une case : trois passes atteignent la case 3, pas la 4.
  assert.equal(g.solConnu[3], 1);
  assert.equal(g.solConnu[4], 0);
});
