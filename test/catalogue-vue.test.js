// Le catalogue de ce qu'un côté du rideau peut porter : des fonds de carte, ou une couche de relief.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const ctx = chargerScripts(['config.js', 'relief.js', 'fonds-osm.js', 'catalogue-vue.js']);
const { RELIEF, FONDS_OSM, creerCatalogueVue } = ctx;
const cat = creerCatalogueVue({ RELIEF, FONDS_OSM, protocole: 'https:' });

test('chaque couche de RELIEF.COUCHES est au catalogue, avec son libellé et son aide', () => {
  for (const c of RELIEF.COUCHES) {
    const e = cat.couches.find((x) => x.cle === c.cle);
    assert.ok(e, c.cle);
    assert.equal(e.libelle, c.libelle);
    assert.equal(e.aide, c.aide);
  }
});

test('l’ombrage coloré est une couche de plus, hors du contrat de RELIEF.calculer', () => {
  assert.equal(cat.OMBRAGE_RGB, 'ombrage-rgb');
  assert.ok(cat.couches.some((x) => x.cle === cat.OMBRAGE_RGB));
  assert.ok(!RELIEF.COUCHES.some((c) => c.cle === cat.OMBRAGE_RGB));
});

test('estRelief : vrai pour une couche, faux pour un fond de carte', () => {
  assert.equal(cat.estRelief('svf'), true);
  assert.equal(cat.estRelief(cat.OMBRAGE_RGB), true);
  for (const fond of ['carte', 'plan', 'mnt-ign', 'mns-ign', 'osm']) assert.equal(cat.estRelief(fond), false, fond);
});

test('libelleCouche : le libellé d’un fond ou d’une couche', () => {
  assert.equal(cat.libelleCouche('carte'), 'Photo aérienne');
  assert.equal(cat.libelleCouche('plan'), 'Plan IGN');
  assert.equal(cat.libelleCouche('svf'), RELIEF.COUCHES.find((c) => c.cle === 'svf').libelle);
});

test('les fonds de tuiles posés dans un volet ont des réglages, et l’estompage IGN s’arrête au zoom 18', () => {
  assert.equal(cat.tuiles['mnt-ign'].maxNativeZoom, 18);
  assert.equal(cat.tuiles['mns-ign'].maxNativeZoom, 18);
  assert.ok('plan' in cat.tuiles && 'osm' in cat.tuiles);
  assert.ok(!('carte' in cat.tuiles), 'la carte Leaflet porte déjà la photo');
});

test('chaque fond de tuiles a une aide, sauf la photo et le plan', () => {
  assert.match(cat.aides.osm, /OpenStreetMap/);
  assert.match(cat.aides['mnt-ign'], /MNT/);
  assert.match(cat.aides['mns-ign'], /MNS/);
  assert.equal(cat.aides.carte, undefined);
});

test('en file://, l’aide d’OpenStreetMap dit pourquoi la carte reste grise', () => {
  const local = creerCatalogueVue({ RELIEF, FONDS_OSM, protocole: 'file:' });
  assert.match(local.aides.osm, /Referer/);
  assert.doesNotMatch(cat.aides.osm, /Referer/);
});
