// Les volets : une carte, son calque de relief et les côtés qu'elle porte. Aujourd'hui un seul volet
// (la carte scindée par le rideau, ou une seule carte) ; les deux cartes synchronisées en auront deux,
// un côté chacun (TODO R10). Ici la logique sans écran ni Leaflet : à quel volet appartient un côté,
// quel écran le worker reçoit, quel côté est sous le curseur.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { VOLETS } = chargerScripts(['volets.js']);

const voletA = { nom: 'A', cotes: ['gauche', 'droite'] };

test('voletDe — un seul volet porte les deux côtés', () => {
  assert.equal(VOLETS.voletDe([voletA], 'gauche'), voletA);
  assert.equal(VOLETS.voletDe([voletA], 'droite'), voletA);
});

test('voletDe — deux cartes : chaque côté a son volet', () => {
  const g = { nom: 'G', cotes: ['gauche'] }, d = { nom: 'D', cotes: ['droite'] };
  assert.equal(VOLETS.voletDe([g, d], 'gauche'), g);
  assert.equal(VOLETS.voletDe([g, d], 'droite'), d);
});

test('voletDe — un côté que personne ne porte : null, pas une exception', () => {
  assert.equal(VOLETS.voletDe([voletA], 'milieu'), null);
  assert.equal(VOLETS.voletDe([], 'gauche'), null);
});

test('ecran — l’écran d’une carte, tel que le worker le reçoit : coin, taille arrondie, zoom, territoire', () => {
  const pb = { min: { x: 100.4, y: 200.6 }, max: { x: 900.9, y: 700.1 } };
  const e = VOLETS.ecran(pb, 17, 'metropole');
  assert.equal(e.x0, 100.4);
  assert.equal(e.y0, 200.6);
  assert.equal(e.W, 801);   // Math.round(800.5)
  assert.equal(e.H, 500);   // Math.round(499.5)
  assert.equal(e.z, 17);
  assert.equal(e.territoire, 'metropole');
});

test('coteSous — un volet à un seul côté : ce côté, sans rien demander au rideau', () => {
  let demande = 0;
  const unSeul = { cotes: ['droite'], calque: { coteSous: () => { demande++; return 'gauche'; } } };
  assert.equal(VOLETS.coteSous(unSeul, 120), 'droite');
  assert.equal(demande, 0);
});

test('coteSous — un volet à deux côtés : c’est le rideau qui dit lequel est sous le pixel', () => {
  const deux = { cotes: ['gauche', 'droite'], calque: { coteSous: (x) => (x < 300 ? 'gauche' : 'droite') } };
  assert.equal(VOLETS.coteSous(deux, 100), 'gauche');
  assert.equal(VOLETS.coteSous(deux, 500), 'droite');
});
