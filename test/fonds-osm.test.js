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
  // « (standard) » : le nom que la Fondation donne à ce rendu, et ce qui le distinguera de
  // « OpenStreetMap France » le jour où celui-ci arrive.
  assert.equal(FONDS_OSM.standard.libelle, 'OpenStreetMap (standard)');
  assert.equal(FONDS_OSM.parCle.osm, FONDS_OSM.standard);
});

test('le fond OSM France n’existe pas tant que l’association n’a pas donné son accord', () => {
  // Ses serveurs sont limités par liste blanche de Referer : ne rien en servir sans accord.
  assert.equal(FONDS_OSM.france, undefined);
  assert.equal(FONDS_OSM.parCle.osmfr, undefined);
});

test('l’aide du fond standard prévient quand la page est ouverte en local : pas de Referer, tuiles refusées', () => {
  const local = FONDS_OSM.standard.aide('file:');
  assert.match(local, /local/i);
  assert.match(local, /Referer/);
  assert.match(local, /site en ligne/);
});

test('l’aide du fond standard reste neutre sur le site en ligne', () => {
  for (const protocole of ['https:', 'http:']) {
    const aide = FONDS_OSM.standard.aide(protocole);
    assert.match(aide, /Fondation OpenStreetMap/);
    assert.doesNotMatch(aide, /Referer/, protocole);
  }
});
