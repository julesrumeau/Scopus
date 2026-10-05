// Le mode d'affichage de la carte : scindée par le rideau, ou une seule couche en pleine page.
// La logique pure (où va le rideau, quels côtés sont affichés, ce que dit le panneau) ; le dessin se
// vérifie dans le navigateur. Une seule carte montre **toujours la gauche** : une seule liste de
// couches, rien à deviner. Un troisième mode (deux cartes synchronisées) viendra plus tard.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { MODE_CARTE } = chargerScripts(['mode-carte.js']);

test('le rideau se range à l’opposé du côté montré en entier', () => {
  // La gauche seule : rideau tout à droite (100 %) ; la droite seule : rideau tout à gauche (0 %).
  assert.equal(MODE_CARTE.partRideau('gauche', 0.4), 1);
  assert.equal(MODE_CARTE.partRideau('droite', 0.4), 0);
});

test('carte scindée : le rideau reprend la position d’avant', () => {
  assert.equal(MODE_CARTE.partRideau(null, 0.4), 0.4);
  assert.equal(MODE_CARTE.partRideau(null, 0.7), 0.7);
});

test('une seule carte montre la gauche : une constante, pas un choix à deviner', () => {
  assert.equal(MODE_CARTE.coteUnique, 'gauche');
});

test('cotesDe — le côté montré seul, ou les deux quand aucun n’est seul', () => {
  assert.deepEqual([...MODE_CARTE.cotesDe('gauche')], ['gauche']);
  assert.deepEqual([...MODE_CARTE.cotesDe('droite')], ['droite']);
  assert.deepEqual([...MODE_CARTE.cotesDe(null)], ['gauche', 'droite']);
});

test('les côtés affichés : la gauche seule en une seule carte, les deux sinon', () => {
  assert.deepEqual([...MODE_CARTE.cotesAffiches('unique')], ['gauche']);
  assert.deepEqual([...MODE_CARTE.cotesAffiches('scinde')], ['gauche', 'droite']);
  assert.deepEqual([...MODE_CARTE.cotesAffiches('double')], ['gauche', 'droite']);
});

test('les cartes de chaque mode : le côté que chacune montre seul', () => {
  const coteDe = (mode) => [...MODE_CARTE.cartes(mode)].map((c) => c.coteSeul);
  assert.deepEqual(coteDe('scinde'), [null]);              // une carte, le rideau partage les deux côtés
  assert.deepEqual(coteDe('unique'), ['gauche']);          // une carte, la gauche en entier
  assert.deepEqual(coteDe('double'), ['gauche', 'droite']); // deux cartes, un côté chacune
});

test('le panneau : ce que chaque mode montre', () => {
  const p = (mode) => ({ ...MODE_CARTE.panneau(mode) });
  assert.deepEqual(p('scinde'), { libelleGauche: 'Gauche', listeDroite: true, echanger: true, rideauAuCentre: true });
  assert.deepEqual(p('unique'), { libelleGauche: 'Couche affichée', listeDroite: false, echanger: false, rideauAuCentre: false });
  // Deux cartes : les deux listes, l'échange, mais pas de rideau à centrer.
  assert.deepEqual(p('double'), { libelleGauche: 'Gauche', listeDroite: true, echanger: true, rideauAuCentre: false });
});

test('chaque mode a un nom lisible, pour l’infobulle et les lecteurs d’écran', () => {
  assert.match(MODE_CARTE.libelles.scinde, /rideau/i);
  assert.match(MODE_CARTE.libelles.unique, /une seule/i);
  assert.match(MODE_CARTE.libelles.double, /deux cartes/i);
});

test('un mode inconnu retombe sur la carte scindée', () => {
  assert.deepEqual([...MODE_CARTE.cotesAffiches('bidon')], ['gauche', 'droite']);
  assert.equal(MODE_CARTE.panneau('bidon').listeDroite, true);
});
