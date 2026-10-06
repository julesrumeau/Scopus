// « Ma position » : le GPS de l'appareil centre la carte. La partie pure (messages d'erreur, zoom selon la
// précision) se teste à froid ; la fabrique du bouton, avec une géolocalisation et une carte factices.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { LOCALISATION, creerLocalisation } = chargerScripts(['localisation.js']);

test('messageErreur : un message en clair par cause, jamais le texte brut du navigateur', () => {
  assert.match(LOCALISATION.messageErreur({ code: 1 }), /refus|autoris/i);
  assert.match(LOCALISATION.messageErreur({ code: 2 }), /indisponible|position/i);
  assert.match(LOCALISATION.messageErreur({ code: 3 }), /trop long|délai|temps/i);
  assert.match(LOCALISATION.messageErreur({ code: 99, message: 'Boom interne' }), /localiser/i);
  assert.ok(!LOCALISATION.messageErreur({ code: 99, message: 'Boom interne' }).includes('Boom'));
  assert.match(LOCALISATION.messageErreur(null), /localiser/i);
});

test('messageErreur : le refus dit comment réautoriser', () => {
  assert.match(LOCALISATION.messageErreur({ code: 1 }), /réglages|navigateur|site/i);
});

test('zoomPour : plus la position est précise, plus on zoome ; imprécise, on recule', () => {
  assert.equal(LOCALISATION.zoomPour(10), 18);
  assert.equal(LOCALISATION.zoomPour(100), 17);
  assert.equal(LOCALISATION.zoomPour(400), 16);
  assert.equal(LOCALISATION.zoomPour(2000), 14);
  assert.equal(LOCALISATION.zoomPour(50000), 12);
});

test('zoomPour : une précision absente ou absurde donne le zoom par défaut', () => {
  for (const v of [undefined, null, NaN, -5, Infinity]) assert.equal(LOCALISATION.zoomPour(v), 17, String(v));
});

test('zoomPour ne dépasse jamais le zoom maximal de la couche IGN (19)', () => {
  assert.ok(LOCALISATION.zoomPour(0) <= 19);
});

// ── La fabrique : un clic, une demande de position, la carte recentrée ──

function banc({ position = { coords: { latitude: 49.3, longitude: 5.4, accuracy: 20 } }, erreur = null, sansGeo = false } = {}) {
  const journal = [];
  let rappel = null;
  const geo = sansGeo ? undefined : {
    getCurrentPosition(ok, ko, options) {
      journal.push(['demande', options.enableHighAccuracy, options.timeout]);
      rappel = () => (erreur ? ko(erreur) : ok(position));
    },
  };
  const bouton = { disabled: false, classList: { _c: new Set(), add(c) { this._c.add(c); }, remove(c) { this._c.delete(c); }, contains(c) { return this._c.has(c); } }, addEventListener(t, f) { this.clic = f; } };
  const l = creerLocalisation({
    bouton, geolocalisation: geo,
    centrer: (lat, lon, zoom, precision) => journal.push(['centrer', lat, lon, zoom, precision]),
    dire: (texte) => journal.push(['dire', texte]),
    alerter: (texte) => journal.push(['alerter', texte]),
  });
  return { l, bouton, journal, repondre: () => rappel() };
}

test('un clic demande la position (précise, avec un délai) et grise le bouton le temps de la réponse', () => {
  const { bouton, journal } = banc();
  bouton.clic();
  const demande = journal.find((j) => j[0] === 'demande');
  assert.equal(demande[1], true, 'position précise demandée');
  assert.ok(demande[2] > 1000, 'un délai borné');
  assert.ok(journal.some((j) => j[0] === 'dire'), 'on dit qu’on cherche');
  assert.equal(bouton.disabled, true);
  assert.ok(bouton.classList.contains('en-cours'));
});

test('la position reçue recentre la carte : coordonnées, zoom selon la précision, précision', () => {
  const { bouton, journal, repondre } = banc();
  bouton.clic(); repondre();
  assert.deepEqual(journal.find((j) => j[0] === 'centrer'), ['centrer', 49.3, 5.4, 18, 20]);
  assert.equal(bouton.disabled, false);
  assert.ok(!bouton.classList.contains('en-cours'));
});

test('un refus ou un échec : un message en clair, le bouton se rend, la carte ne bouge pas', () => {
  const { bouton, journal, repondre } = banc({ erreur: { code: 1 } });
  bouton.clic(); repondre();
  assert.ok(journal.some((j) => j[0] === 'alerter' && /refus|autoris/i.test(j[1])));
  assert.ok(!journal.some((j) => j[0] === 'centrer'));
  assert.equal(bouton.disabled, false);
});

test('deux clics pendant l’attente ne font qu’une demande', () => {
  const { bouton, journal } = banc();
  bouton.clic(); bouton.clic();
  assert.equal(journal.filter((j) => j[0] === 'demande').length, 1);
});

test('sans géolocalisation dans le navigateur : on le dit, rien ne plante', () => {
  const { bouton, journal } = banc({ sansGeo: true });
  assert.doesNotThrow(() => bouton.clic());
  assert.ok(journal.some((j) => j[0] === 'alerter' && /localis|navigateur|appareil/i.test(j[1])));
});
