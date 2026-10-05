// Le chronométrage du fil principal (« &chrono ») : chaque appel mesuré est compté, le bilan trie par temps
// total et se vide à chaque lecture.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { creerChrono } = chargerScripts(['chrono.js']);

const faire = () => creerChrono({ actif: false, observer: false });

test('un appel mesuré garde son résultat, son `this` et ses arguments', () => {
  const c = faire();
  const objet = { k: 3, f(a, b) { return this.k * (a + b); } };
  objet.f = c.mesurer('f', objet.f);
  assert.equal(objet.f(1, 2), 9);
});

test('le bilan compte les appels, le total et le pire, trié par total décroissant', () => {
  const c = faire();
  const lent = c.mesurer('lent', () => { const t = Date.now(); while (Date.now() - t < 6); });
  const vite = c.mesurer('vite', () => {});
  lent(); lent(); vite();
  const bilan = c.bilan();
  assert.equal(bilan.map((l) => l.travail).join(), 'lent,vite');
  assert.equal(bilan[0].appels, 2);
  assert.ok(bilan[0].totalMs >= 10 && bilan[0].pireMs >= 5 && bilan[0].pireMs <= bilan[0].totalMs);
  assert.equal(bilan[1].appels, 1);
});

test('lire le bilan le vide', () => {
  const c = faire();
  c.mesurer('x', () => {})();
  assert.equal(c.bilan().length, 1);
  assert.equal(c.bilan().length, 0);
});

test('une exception est comptée puis relancée', () => {
  const c = faire();
  const boom = c.mesurer('boom', () => { throw new Error('non'); });
  assert.throws(boom, /non/);
  assert.equal(c.bilan()[0].appels, 1);
});

test('les compteurs d’activité partent à zéro', () => {
  assert.equal(JSON.stringify(faire().activite), '{"relief":false,"decodages":0}');
});
