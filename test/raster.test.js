// Rastérisation (`raster.js`), sur des nuages synthétiques à vérité connue.
//
// Se concentre sur `sommetZ` : le Z maximal toutes classes confondues, dont
// `terrain.js` se sert pour que la sélection et la mesure en 3D puissent
// viser n'importe quel point rendu — végétation et ponts compris — là où le
// reste des grilles n'en garde aucune trace (`default: break` dans
// `accumuler`).

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
