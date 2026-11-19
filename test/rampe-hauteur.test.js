// La rampe de couleur « Hauteur/sol » de la 3D : sa borne haute se règle (un forestier lit des peuplements de 0 à 40 m, la rampe
// d'origine saturait à 8 m). Pur : le réglage, sa légende et son lien ; le shader est lu comme du texte.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargerScripts } from './charger.js';

const { RAMPE_HAUTEUR } = chargerScripts(['rampe-hauteur.js']);
const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('la borne par défaut reste 8 m (rien ne change pour qui ne touche à rien)', () => {
  assert.equal(RAMPE_HAUTEUR.defaut, 8);
});

test('borne : dans 5 à 50 m, arrondie au mètre, sinon le défaut', () => {
  assert.equal(RAMPE_HAUTEUR.borne(35), 35);
  assert.equal(RAMPE_HAUTEUR.borne(12.6), 13);
  assert.equal(RAMPE_HAUTEUR.borne(2), 5);
  assert.equal(RAMPE_HAUTEUR.borne(200), 50);
  for (const mauvais of [NaN, undefined, null, 'x']) assert.equal(RAMPE_HAUTEUR.borne(mauvais), 8);
});

test('la légende suit la borne : jaune à 35 % de la borne, rouge à la borne et au-delà', () => {
  assert.equal(RAMPE_HAUTEUR.legende(8), 'Sombre = sol · jaune = 3 m · rouge = 8 m et plus');
  assert.equal(RAMPE_HAUTEUR.legende(35), 'Sombre = sol · jaune = 12 m · rouge = 35 m et plus');
});

test('le shader lit la borne dans un uniforme, plus de 8,0 en dur', () => {
  const s = lire('src/shaders.js');
  const rampe = s.slice(s.indexOf('vec3 rampeHauteur'), s.indexOf('}', s.indexOf('vec3 rampeHauteur')));
  assert.match(rampe, /u_hmaxRampe/);
  assert.ok(!/h \/ 8\.0/.test(rampe));
  assert.match(s, /uniform float u_hmaxRampe;/);
  assert.match(lire('src/vue3d.js'), /u_hmaxRampe/);
});

test('un curseur dans l’onglet Affichage, masqué hors du mode Hauteur/sol', () => {
  const html = lire('index.html');
  assert.match(html, /id="champ-hmax"[^>]*hidden/);
  assert.match(html, /<input type="range" id="vue-hmax" min="5" max="50" step="1" value="8">/);
  assert.match(html, /src="src\/rampe-hauteur\.js"/);
});
