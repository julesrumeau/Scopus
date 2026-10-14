// Les fonds de carte géologique du BRGM, proposés dans les listes du rideau : deux couches WMS d'un même service (CORS ouvert,
// mesuré le 14 octobre 2026), la carte harmonisée au 1/50 000 (aplats de couleur, sans texte) et la carte scannée d'origine
// (codes des formations, topographie imprimée). Des définitions, sans état.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { FONDS_GEOLOGIE } = chargerScripts(['fonds-geologie.js']);

test('deux fonds, chacun avec une clé de lien sûre, un libellé et une couche WMS du BRGM', () => {
  const cles = Object.keys(FONDS_GEOLOGIE.parCle).join(',');
  assert.equal(cles, 'geologie,geologie-scan');
  for (const f of Object.values(FONDS_GEOLOGIE.parCle)) {
    assert.match(f.cle, /^[A-Za-z][A-Za-z0-9-]{0,23}$/, 'la clé passe dans le lien partageable');
    assert.match(f.libelle, /BRGM/);
    assert.match(f.url, /^https:\/\/geoservices\.brgm\.fr\//);
    assert.ok(f.couche.length > 3);
    assert.equal(f.version, '1.3.0');
    assert.equal(f.format, 'image/png');
  }
});

test('la carte harmonisée et la carte scannée sont deux couches différentes', () => {
  assert.equal(FONDS_GEOLOGIE.parCle.geologie.couche, 'SCAN_H_GEOL50');
  assert.equal(FONDS_GEOLOGIE.parCle['geologie-scan'].couche, 'SCAN_D_GEOL50');
});

test('l’attribution cite le BRGM, avec un lien, et les options bornent le zoom des tuiles', () => {
  for (const f of Object.values(FONDS_GEOLOGIE.parCle)) {
    assert.match(f.options.attribution, /BRGM/);
    assert.match(f.options.attribution, /href="https:\/\//);
    assert.equal(f.options.maxNativeZoom, 16, 'le service rend des tuiles vides au zoom 17 et au-delà : on agrandit celles du 16');
    assert.equal(f.options.minZoom, 12, 'le service rend des tuiles vides sous le zoom 12');
  }
});

test('l’aide dit ce que c’est, d’où ça vient et ce que ça ne dit pas, sans tiret cadratin', () => {
  for (const f of Object.values(FONDS_GEOLOGIE.parCle)) {
    const a = f.aide;
    assert.match(a, /1\/50 000/);
    assert.match(a, /BRGM/);
    assert.ok(!/—/.test(a));
  }
  assert.match(FONDS_GEOLOGIE.parCle.geologie.aide, /couleurs/i);
  assert.match(FONDS_GEOLOGIE.parCle['geologie-scan'].aide, /codes|scann/i);
});

test('les zooms où le service dessine : 12 à 16, mesurés le 14 octobre 2026 sur six lieux', () => {
  for (const f of Object.values(FONDS_GEOLOGIE.parCle)) assert.equal(`${f.zoomMin}-${f.zoomMax}`, '12-16');
});

test('l’aide dit à partir de quel zoom la carte apparaît', () => {
  for (const f of Object.values(FONDS_GEOLOGIE.parCle)) assert.match(f.aide, /zoom 12/);
});

test('un lien vers InfoTerre pour la légende et les notices, que le service ne fournit pas', () => {
  for (const f of Object.values(FONDS_GEOLOGIE.parCle)) {
    assert.equal(f.lien.url, 'https://infoterre.brgm.fr/page/cartes-geologiques');
    assert.match(f.lien.libelle, /légende/i);
    assert.match(f.lien.libelle, /InfoTerre/);
    assert.ok(!/—/.test(f.lien.libelle));
  }
});
