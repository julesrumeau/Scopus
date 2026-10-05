// Le mode d'affichage de la carte : scindée par le rideau, ou une seule couche en pleine page.
// La logique pure (où va le rideau, quels côtés sont affichés, ce que dit le panneau) ; le dessin se
// vérifie dans le navigateur. Une seule carte montre **toujours la gauche** : une seule liste de
// couches, rien à deviner. Un troisième mode (deux cartes synchronisées) viendra plus tard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { MODE_CARTE } = chargerScripts(['mode-carte.js']);

test('une seule carte : le rideau part tout à droite, la gauche est montrée en entier', () => {
  assert.equal(MODE_CARTE.partRideau(true, 0.4), 1);
});

test('carte scindée : le rideau reprend la position d’avant', () => {
  assert.equal(MODE_CARTE.partRideau(false, 0.4), 0.4);
  assert.equal(MODE_CARTE.partRideau(false, 0.7), 0.7);
});

test('les côtés affichés : la gauche seule en une seule carte, les deux sinon', () => {
  assert.deepEqual([...MODE_CARTE.cotesAffiches(true)], ['gauche']);
  assert.deepEqual([...MODE_CARTE.cotesAffiches(false)], ['gauche', 'droite']);
});

test('le panneau : une seule liste, « Couche affichée », et plus ni échange ni rideau au centre', () => {
  const u = MODE_CARTE.panneau(true), s = MODE_CARTE.panneau(false);
  assert.equal(u.libelleGauche, 'Couche affichée');
  assert.equal(u.listeDroite, false);
  assert.equal(u.boutonsRideau, false);
  assert.equal(s.libelleGauche, 'Gauche');
  assert.equal(s.listeDroite, true);
  assert.equal(s.boutonsRideau, true);
});

test('chaque mode a un nom lisible, pour l’infobulle et les lecteurs d’écran', () => {
  assert.match(MODE_CARTE.libelles.scinde, /rideau/i);
  assert.match(MODE_CARTE.libelles.unique, /une seule/i);
});
