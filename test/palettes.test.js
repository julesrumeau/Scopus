// Les tables de couleurs des couches de relief : 256 entrées, en triplets, une famille par usage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { construireLUT } = chargerScripts(['palettes.js']);

const rvb = (lut, i) => [lut[i * 3], lut[i * 3 + 1], lut[i * 3 + 2]];

test('une table fait 256 entrées de trois octets', () => {
  for (const nom of ['gris', 'divergent', 'chaud', 'froid']) {
    const lut = construireLUT(nom);
    assert.equal(lut.length, 256 * 3, nom);
    assert.ok(lut instanceof Uint8Array || lut.constructor.name === 'Uint8Array', nom);
  }
});

test('gris : un dégradé neutre et croissant, du sombre au clair', () => {
  const lut = construireLUT('gris');
  const [r0, v0, b0] = rvb(lut, 0), [r1, v1, b1] = rvb(lut, 255);
  assert.equal(r0, v0); assert.equal(v0, b0);
  assert.equal(r1, v1); assert.equal(v1, b1);
  assert.ok(r0 < 30 && r1 > 230);
  for (let i = 1; i < 256; i++) assert.ok(lut[i * 3] >= lut[(i - 1) * 3], `monotone en ${i}`);
});

test('divergent : le zéro, au milieu, est un gris moyen ; creux bleutés, bosses ocre', () => {
  const lut = construireLUT('divergent');
  const [rm, vm, bm] = rvb(lut, 128);
  assert.ok(Math.abs(rm - vm) < 12 && Math.abs(vm - bm) < 12, `milieu ${rvb(lut, 128)}`);
  const [rc, , bc] = rvb(lut, 0), [rb, , bb] = rvb(lut, 255);
  assert.ok(bc > rc, 'creux : plus de bleu que de rouge');
  assert.ok(rb > bb, 'bosses : plus de rouge que de bleu');
});

test('chaud : de plus en plus rouge ; froid : de plus en plus bleu', () => {
  const chaud = construireLUT('chaud'), froid = construireLUT('froid');
  assert.ok(chaud[255 * 3] > chaud[0] + 150);
  assert.ok(froid[255 * 3 + 2] > froid[2] + 150);
});

test('toutes les valeurs restent dans [0, 255], et un nom inconnu vaut le gris', () => {
  for (const nom of ['gris', 'divergent', 'chaud', 'froid']) for (const v of construireLUT(nom)) assert.ok(v >= 0 && v <= 255, nom);
  assert.deepEqual([...construireLUT('inconnue')], [...construireLUT('gris')]);
});
