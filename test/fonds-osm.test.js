// Les fonds OpenStreetMap. Ce qui compte ici, ce sont les conditions de la politique d'usage
// des tuiles de la Fondation (https://operations.osmfoundation.org/policies/tiles/) : un
// Referer valide pour identifier le site, une attribution visible avec un lien vers le
// copyright, aucune URL à sous-domaines inventés. Un fond qui les oublierait serait bloqué.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { FONDS_OSM } = chargerScripts(['config.js', 'fonds-osm.js']);

test('le fond standard est servi par la Fondation, en HTTPS, au gabarit des tuiles', () => {
  assert.equal(FONDS_OSM.standard.url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
});

test('l’attribution crédite les contributeurs d’OpenStreetMap et renvoie au copyright', () => {
  const a = FONDS_OSM.standard.options.attribution;
  assert.match(a, /OpenStreetMap/);
  assert.match(a, /contributors/);
  assert.match(a, /href="https:\/\/www\.openstreetmap\.org\/copyright"/);
});

test('le Referer est envoyé : c’est ce qui identifie le site auprès du serveur de tuiles', () => {
  assert.equal(FONDS_OSM.standard.options.referrerPolicy, 'origin');
});

test('le dernier niveau servi est le 19 : au-delà, la tuile est agrandie au lieu d’être demandée', () => {
  assert.equal(FONDS_OSM.standard.options.maxNativeZoom, 19);
});

test('le fond porte une clé et un nom lisibles pour les listes et le lien', () => {
  assert.equal(FONDS_OSM.standard.cle, 'osm');
  assert.equal(FONDS_OSM.standard.libelle, 'OpenStreetMap');
  assert.equal(FONDS_OSM.parCle.osm, FONDS_OSM.standard);
});

test('le fond OSM France n’existe pas tant que l’association n’a pas donné son accord', () => {
  // Ses serveurs sont limités par liste blanche de Referer : ne rien en servir sans accord.
  assert.equal(FONDS_OSM.france, undefined);
  assert.equal(FONDS_OSM.parCle.osmfr, undefined);
});
