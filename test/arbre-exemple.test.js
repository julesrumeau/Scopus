// L'arbre d'exemple de l'éditeur de rampe : un nuage de points qui ressemble à un arbre de 50 m, toujours le même, pour voir les
// couleurs d'une rampe sur quelque chose de reconnaissable. Pur : aucun DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { ARBRE_EXEMPLE: T } = chargerScripts(['arbre-exemple.js']);

test('toujours les mêmes points (aucun hasard au chargement)', () => {
  assert.equal(JSON.stringify(T.points()), JSON.stringify(T.points()));
});

test('du sol à 50 m, dans la largeur [-1 ; 1]', () => {
  const p = T.points();
  assert.ok(p.length >= 600 && p.length <= 2500, `${p.length} points`);
  assert.ok(p.every((q) => q.h >= 0 && q.h <= 50 && q.x >= -1 && q.x <= 1));
  assert.ok(Math.max(...p.map((q) => q.h)) >= 48, 'la cime atteint presque 50 m');
  assert.ok(Math.min(...p.map((q) => q.h)) <= 0.2, 'le sol est là');
});

test('ça a la forme d’un arbre : un tronc étroit en bas, une couronne large en haut', () => {
  const p = T.points();
  const largeur = (h0, h1) => { const xs = p.filter((q) => q.h >= h0 && q.h < h1).map((q) => q.x); return Math.max(...xs) - Math.min(...xs); };
  assert.ok(largeur(5, 15) < 0.3, 'tronc');
  assert.ok(largeur(30, 45) > 0.8, 'couronne');
});
