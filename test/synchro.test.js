// La synchronisation de deux cartes : le déplacement et le zoom de l'une se retrouvent sur l'autre,
// sans écho (une carte qu'on vient de déplacer à la demande de l'autre ne la redéplace pas), et le
// curseur de l'une est un repère sur l'autre. Cartes factices : Leaflet n'a rien à faire ici.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { SYNCHRO } = chargerScripts(['synchro.js']);

/** Une carte factice : des écouteurs, un centre, un zoom, et la liste de ce qu'on lui a demandé. */
function carte(centre = { lat: 49.3, lng: 5.4 }, zoom = 16) {
  const ecouteurs = {};
  const c = {
    centre, zoom, demandes: [],
    on(evenements, f) { for (const e of evenements.split(' ')) (ecouteurs[e] ||= []).push(f); return c; },
    off(evenements, f) { for (const e of evenements.split(' ')) ecouteurs[e] = (ecouteurs[e] || []).filter((g) => g !== f); return c; },
    emettre(e, arg) { for (const f of [...(ecouteurs[e] || [])]) f(arg); },
    getCenter() { return c.centre; },
    getZoom() { return c.zoom; },
    setView(centre2, zoom2, options) {
      c.demandes.push({ centre: centre2, zoom: zoom2, options });
      c.centre = centre2; c.zoom = zoom2;
      c.emettre('move');   // Leaflet émet `move` de façon synchrone sans animation
    },
    /** L'utilisateur déplace la carte. */
    bouger(centre2, zoom2 = c.zoom) { c.centre = centre2; c.zoom = zoom2; c.emettre('move'); },
  };
  return c;
}

const lat = (c) => c.getCenter().lat;

test('bouger la première met la seconde au même centre et au même zoom, sans animation', () => {
  const a = carte(), b = carte({ lat: 0, lng: 0 }, 5);
  SYNCHRO.lier(a, b);
  a.bouger({ lat: 48.1, lng: 2.2 }, 18);
  assert.equal(lat(b), 48.1);
  assert.equal(b.getCenter().lng, 2.2);
  assert.equal(b.getZoom(), 18);
  assert.equal(b.demandes.at(-1).options.animate, false);
});

test('et dans l’autre sens : bouger la seconde met la première à jour', () => {
  const a = carte(), b = carte();
  SYNCHRO.lier(a, b);
  b.bouger({ lat: 47.0, lng: 3.0 }, 14);
  assert.equal(lat(a), 47.0);
  assert.equal(a.getZoom(), 14);
});

test('pas d’écho : la carte mise à jour ne renvoie rien à celle qui l’a déplacée', () => {
  const a = carte(), b = carte();
  SYNCHRO.lier(a, b);
  a.bouger({ lat: 48.1, lng: 2.2 }, 18);
  assert.equal(b.demandes.length, 1, 'la seconde reçoit une seule demande');
  assert.equal(a.demandes.length, 0, 'la première n’est jamais redéplacée');
});

test('rien à faire si l’autre carte est déjà au même endroit', () => {
  const a = carte({ lat: 48.1, lng: 2.2 }, 18), b = carte({ lat: 48.1, lng: 2.2 }, 18);
  SYNCHRO.lier(a, b);
  a.emettre('move');
  assert.equal(b.demandes.length, 0);
});

test('délier : les cartes redeviennent indépendantes', () => {
  const a = carte(), b = carte();
  const lien = SYNCHRO.lier(a, b);
  lien.delier();
  a.bouger({ lat: 10, lng: 10 }, 9);
  b.bouger({ lat: 20, lng: 20 }, 8);
  assert.equal(b.demandes.length, 0);
  assert.equal(a.demandes.length, 0);
});

test('au moment de lier, la seconde se cale sur la première', () => {
  const a = carte({ lat: 48.1, lng: 2.2 }, 18), b = carte({ lat: 0, lng: 0 }, 3);
  SYNCHRO.lier(a, b);
  assert.equal(lat(b), 48.1);
  assert.equal(b.getZoom(), 18);
});

/** Un repère factice : ce qu'on lui a demandé de montrer. */
function repere() {
  const r = { positions: [], cache: 0, deplacer(ll) { r.positions.push(ll); }, cacher() { r.cache++; } };
  return r;
}

test('le curseur de l’une est un repère sur l’autre, à la même position', () => {
  const a = carte(), b = carte(), ra = repere(), rb = repere();
  SYNCHRO.lier(a, b, { reperes: new Map([[a, ra], [b, rb]]) });
  a.emettre('mousemove', { latlng: { lat: 49.31, lng: 5.41 } });
  assert.deepEqual(JSON.parse(JSON.stringify(rb.positions)), [{ lat: 49.31, lng: 5.41 }]);
  assert.equal(ra.positions.length, 0, 'pas de repère sur la carte qu’on survole');
});

test('le curseur qui sort de la carte fait disparaître le repère de l’autre', () => {
  const a = carte(), b = carte(), ra = repere(), rb = repere();
  SYNCHRO.lier(a, b, { reperes: new Map([[a, ra], [b, rb]]) });
  a.emettre('mouseout');
  assert.equal(rb.cache, 1);
  b.emettre('mousemove', { latlng: { lat: 49.2, lng: 5.3 } });
  assert.equal(ra.positions.length, 1);
});

test('sans repères demandés, aucun écouteur de souris n’est posé', () => {
  const a = carte(), b = carte();
  SYNCHRO.lier(a, b);
  a.emettre('mousemove', { latlng: { lat: 1, lng: 1 } });   // ne doit pas lever d'exception
  assert.ok(true);
});
