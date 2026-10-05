// Le mode d'affichage de la carte : scindée par le rideau, ou une seule couche en pleine page.
// La logique pure (où va le rideau, quel côté prend la place) ; le dessin se vérifie dans le
// navigateur. Un troisième mode (deux cartes synchronisées) viendra plus tard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { MODE_CARTE } = chargerScripts(['mode-carte.js']);

test('une seule carte : le rideau part au bord opposé au côté montré', () => {
  // Montrer la gauche, c'est pousser le rideau tout à droite (100 %), et inversement.
  assert.equal(MODE_CARTE.partRideau('gauche', 0.4), 1);
  assert.equal(MODE_CARTE.partRideau('droite', 0.4), 0);
});

test('carte scindée : le rideau reprend la position d’avant', () => {
  assert.equal(MODE_CARTE.partRideau(null, 0.4), 0.4);
  assert.equal(MODE_CARTE.partRideau(undefined, 0.7), 0.7);
});

test('autreCote — gauche et droite s’échangent, le reste retombe sur le côté du relief', () => {
  assert.equal(MODE_CARTE.autreCote('gauche'), 'droite');
  assert.equal(MODE_CARTE.autreCote('droite'), 'gauche');
  assert.equal(MODE_CARTE.autreCote(null), MODE_CARTE.coteParDefaut);
});

test('le côté montré par défaut est la droite : c’est celui du relief, par convention', () => {
  assert.equal(MODE_CARTE.coteParDefaut, 'droite');
});

test('chaque mode a un nom lisible, pour l’infobulle et les lecteurs d’écran', () => {
  assert.match(MODE_CARTE.libelles.scinde, /rideau/i);
  assert.match(MODE_CARTE.libelles.unique, /une seule/i);
});
