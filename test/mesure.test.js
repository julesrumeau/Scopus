// Calcul des distances de l'outil Mesure (`mesure.js`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { MESURE } = chargerScripts(['mesure.js']);

test('sommet ajoute le sursol au sol', () => {
  assert.equal(MESURE.sommet({ sol: 100, hauteur: 5 }), 105);
  assert.equal(MESURE.sommet({ sol: 100 }), 100);   // pas de sursol : hauteur absente
  assert.equal(MESURE.sommet({ sol: 100, hauteur: 0 }), 100);
  assert.equal(MESURE.sommet({ sol: null, hauteur: 5 }), null);   // sol inconnu : rien à ajouter dessus
});

test('distance horizontale — un triangle 3-4-5', () => {
  const a = { x: 0, y: 0, sol: 10, hauteur: 0 };
  const b = { x: 3, y: 4, sol: 10, hauteur: 0 };
  const { horizontale, denivele, totale } = MESURE.distances(a, b);
  assert.equal(horizontale, 5);
  assert.equal(denivele, 0);
  assert.equal(totale, 5);
});

test('dénivelé signé — positif si B est plus haut que A, négatif dans l’autre sens', () => {
  const a = { x: 0, y: 0, sol: 100, hauteur: 0 };
  const haut = { x: 0, y: 0, sol: 112, hauteur: 0 };
  assert.equal(MESURE.distances(a, haut).denivele, 12);
  assert.equal(MESURE.distances(haut, a).denivele, -12);
});

test('distance totale — la ligne d’air, pas seulement l’horizontale', () => {
  // Base et sommet d'une antenne de 12 m, à 5 m l'un de l'autre au sol.
  const base = { x: 0, y: 0, sol: 200, hauteur: 0 };
  const sommetAntenne = { x: 3, y: 4, sol: 200, hauteur: 12 };
  const { horizontale, denivele, totale } = MESURE.distances(base, sommetAntenne);
  assert.equal(horizontale, 5);     // 3-4-5
  assert.equal(denivele, 12);
  assert.equal(totale, 13);         // 5-12-13
});

test('mesure entre deux sommets, pas entre deux sols — le sursol compte des deux côtés', () => {
  // Deux toits à la même altitude de sol mais des hauteurs différentes :
  // le dénivelé doit venir des sommets, pas être nul sous prétexte que les
  // sols, eux, sont à la même altitude.
  const a = { x: 0, y: 0, sol: 50, hauteur: 3 };
  const b = { x: 0, y: 0, sol: 50, hauteur: 8 };
  assert.equal(MESURE.distances(a, b).denivele, 5);
});

test('altitude inconnue d’un côté : dénivelé et distance totale à null, jamais inventés', () => {
  const connu = { x: 0, y: 0, sol: 100, hauteur: 0 };
  const inconnu = { x: 3, y: 4, sol: null, hauteur: 0 };
  const r = MESURE.distances(connu, inconnu);
  assert.equal(r.horizontale, 5);   // seule l'horizontale ne dépend d'aucune altitude
  assert.equal(r.denivele, null);
  assert.equal(r.totale, null);
});
