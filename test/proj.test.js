// Tests de la projection Lambert-93 ↔ WGS84.
//
// Les références viennent du service WFS de l'IGN lui-même : les quatre coins
// de la dalle LHD_FXX_0564_6196, dont l'emprise Lambert-93 est exacte par
// construction (grille kilométrique) et dont le polygone WGS84 est publié par
// le service. C'est une référence externe, pas un aller-retour avec soi-même.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { versWGS84, versLambert93, versDMS, depuisTexte } = chargerScripts(['proj.js']);

const COINS = [
  ['origine de la projection', 700000, 6600000, 3.0, 46.5],
  ['dalle 0564_6196 — NO', 564000, 6196000, 1.337778, 42.85058163],
  ['dalle 0564_6196 — NE', 565000, 6196000, 1.34999665, 42.85077021],
  ['dalle 0564_6196 — SE', 565000, 6195000, 1.35025197, 42.84177994],
  ['dalle 0564_6196 — SO', 564000, 6195000, 1.33803521, 42.84159139],
];

test('Lambert-93 → WGS84 reproduit les coins publiés par l’IGN', () => {
  for (const [nom, x, y, lon, lat] of COINS) {
    const g = versWGS84(x, y);
    const dx = (g.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180);
    const dy = (g.lat - lat) * 111320;
    const ecart = Math.hypot(dx, dy);
    // Les références du WFS sont données à 1e-8 degré : l'écart admissible est
    // celui de leur propre arrondi, soit ~1 mm.
    assert.ok(ecart < 0.005, `${nom} : écart ${ecart.toFixed(4)} m`);
  }
});

test('l’aller-retour est exact au micromètre', () => {
  for (const [nom, x, y] of COINS) {
    const g = versWGS84(x, y);
    const r = versLambert93(g.lon, g.lat);
    assert.ok(Math.hypot(r.x - x, r.y - y) < 1e-6, `${nom} : ${Math.hypot(r.x - x, r.y - y)} m`);
  }
});

test('l’aller-retour tient sur toute l’étendue de la France métropolitaine', () => {
  for (let lat = 41.5; lat <= 51.5; lat += 0.5) {
    for (let lon = -5; lon <= 9.5; lon += 0.5) {
      const p = versLambert93(lon, lat);
      const g = versWGS84(p.x, p.y);
      const ecart = Math.hypot((g.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180),
        (g.lat - lat) * 111320);
      assert.ok(ecart < 1e-6, `${lon}/${lat} : écart ${ecart} m`);
    }
  }
});

test('formatage en degrés, minutes, secondes', () => {
  assert.equal(versDMS(1.6841699, 42.7400935), `42°44'24.3"N 1°41'03.0"E`);
  assert.match(versDMS(-1.5, -20.25), /^20°15'00.0"S 1°30'00.0"W$/);
});

// `depuisTexte` : partagée par la recherche de dalle et la recherche d'un
// point sélectionné (voir app.js). Le point sensible est la distinction entre
// une paire GPS et une paire Lambert-93, qui repose sur un seul repère —
// « au-delà de 180, ce ne peut plus être un angle ».

test('depuisTexte reconnaît une paire GPS, virgule ou espace comme séparateur', () => {
  // Comparaison propriété par propriété, pas `deepEqual` : l'objet rendu vient
  // du contexte `vm` de `chargerScripts`, un autre realm — `deepStrictEqual`
  // refuse deux objets par ailleurs identiques dont les prototypes diffèrent.
  for (const [texte, lon, lat] of [
    ['42.74, 1.68', 1.68, 42.74],
    ['42.74 1.68', 1.68, 42.74],
    ['  -1.5 ; 45.2 ', 45.2, -1.5],
  ]) {
    const p = depuisTexte(texte);
    assert.equal(p.lon, lon, texte);
    assert.equal(p.lat, lat, texte);
  }
});

test('depuisTexte reconnaît une paire Lambert-93 et la convertit en WGS84', () => {
  const lambert = versLambert93(1.68, 42.74);
  const p = depuisTexte(`${lambert.x}, ${lambert.y}`);
  assert.ok(p, 'la paire Lambert-93 aurait dû être reconnue');
  assert.ok(Math.abs(p.lon - 1.68) < 1e-6 && Math.abs(p.lat - 42.74) < 1e-6,
    `obtenu lon=${p.lon} lat=${p.lat}`);
});

test('depuisTexte rend null sur un nom de lieu — à chercher ailleurs, pas ici', () => {
  assert.equal(depuisTexte('Vicdessos'), null);
  assert.equal(depuisTexte('09220'), null);
  assert.equal(depuisTexte(''), null);
});

// ── Les territoires d'outre-mer : UTM ───────────────────────────────────────
// Mêmes références externes : les coins de dalles publiés par le WFS de l'IGN
// (27 septembre 2026). Réunion : RGR92 / UTM 40 Sud (EPSG:2975), dalle
// LHD_REU_0338_7664. Guadeloupe : RGAF09 / UTM 20 Nord (EPSG:5490), dalle
// LHD_GLP_0655_1798.

const { projectionDe, territoireAuPoint, TERRITOIRES } = chargerScripts(['proj.js']);

const COINS_UTM = {
  REU: [
    ['NO', 338000, 7664000, 55.44015519, -21.11798417],
    ['NE', 339000, 7664000, 55.44978119, -21.11807252],
    ['SE', 339000, 7663000, 55.44968731, -21.12710471],
    ['SO', 338000, 7663000, 55.44006073, -21.12701633],
  ],
  GLP: [
    ['NO', 655000, 1798000, -61.54954482, 16.25778677],
    ['NE', 656000, 1798000, -61.54018923, 16.2577225],
    ['SE', 656000, 1797000, -61.54025596, 16.24868525],
    ['SO', 655000, 1797000, -61.54961112, 16.24874949],
  ],
};

test('UTM → WGS84 reproduit les coins publiés par l’IGN (Réunion, Guadeloupe)', () => {
  for (const [code, coins] of Object.entries(COINS_UTM)) {
    const p = projectionDe(code);
    for (const [nom, x, y, lon, lat] of coins) {
      const g = p.versGeo(x, y);
      const ecart = Math.hypot((g.lon - lon) * 111320 * Math.cos(lat * Math.PI / 180), (g.lat - lat) * 111320);
      assert.ok(ecart < 0.005, `${code} ${nom} : écart ${ecart.toFixed(4)} m`);
      const r = p.versLocal(lon, lat);
      assert.ok(Math.hypot(r.x - x, r.y - y) < 0.005, `${code} ${nom} : ${r.x.toFixed(3)}, ${r.y.toFixed(3)}`);
    }
  }
});

test('UTM : l’aller-retour est exact au micromètre', () => {
  for (const [code, coins] of Object.entries(COINS_UTM)) {
    const p = projectionDe(code);
    for (const [nom, x, y] of coins) {
      const g = p.versGeo(x, y);
      const r = p.versLocal(g.lon, g.lat);
      assert.ok(Math.hypot(r.x - x, r.y - y) < 1e-6, `${code} ${nom}`);
    }
  }
});

test('territoireAuPoint : métropole, Réunion, Guadeloupe, et rien au large', () => {
  assert.equal(territoireAuPoint(2.35, 48.85).code, 'FXX');
  assert.equal(territoireAuPoint(55.45, -21.12).code, 'REU');
  assert.equal(territoireAuPoint(-61.55, 16.25).code, 'GLP');
  assert.equal(territoireAuPoint(-30, 30), null);
  // La métropole garde sa projection de toujours.
  const l = projectionDe('FXX').versLocal(3, 46.5);
  assert.ok(Math.abs(l.x - 700000) < 1e-6 && Math.abs(l.y - 6600000) < 1e-6);
  assert.ok(TERRITOIRES.every((t) => t.code && t.nom));
});
