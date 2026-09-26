// Cache disque des octets compressés : le moins récemment lu part d'abord,
// sous un quota. Un stockage défaillant (navigation privée) ne doit jamais
// faire échouer un chargement : le cache se tait, le réseau sert.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { CACHE_DISQUE } = chargerScripts(['cache-disque.js']);
const octets = (n, v = 1) => new Uint8Array(n).fill(v);

test('écrit, relit, et survit à une nouvelle instance sur le même stockage', async () => {
  const s = CACHE_DISQUE.stockageMemoire();
  const c = CACHE_DISQUE.creer(s, 1000);
  await c.ecrire('a', octets(10, 7));
  assert.deepEqual([...(await c.lire('a'))], [...octets(10, 7)]);
  const c2 = CACHE_DISQUE.creer(s, 1000);
  assert.equal((await c2.lire('a')).length, 10);
  assert.equal(await c2.lire('absent'), null);
});

test('au-delà du quota, le moins récemment lu part d’abord', async () => {
  let t = 0;
  const c = CACHE_DISQUE.creer(CACHE_DISQUE.stockageMemoire(), 30, () => ++t);
  await c.ecrire('a', octets(10));
  await c.ecrire('b', octets(10));
  await c.ecrire('c', octets(10));
  await c.lire('a');                 // a redevient le plus récent
  await c.ecrire('d', octets(10));   // b, le plus ancien, part
  assert.equal(await c.lire('b'), null);
  assert.ok(await c.lire('a'));
  assert.ok(await c.lire('d'));
  assert.ok(c.total() <= 30);
});

test('un bloc plus gros que le quota n’est pas gardé', async () => {
  const c = CACHE_DISQUE.creer(CACHE_DISQUE.stockageMemoire(), 5);
  await c.ecrire('gros', octets(10));
  assert.equal(await c.lire('gros'), null);
});

test('un stockage qui échoue rend le cache muet, jamais une erreur', async () => {
  const casse = { meta: async () => { throw new Error('IndexedDB refusé'); }, get: async () => { throw new Error('x'); }, put: async () => { throw new Error('x'); }, putMeta: async () => {}, del: async () => {} };
  const c = CACHE_DISQUE.creer(casse, 100);
  await c.ecrire('a', octets(3));
  assert.equal(await c.lire('a'), null);
});
