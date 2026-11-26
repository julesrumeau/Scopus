// La rampe de couleur « Hauteur/sol » de la 3D : sa borne haute se règle (un forestier lit des peuplements de 0 à 40 m, la rampe
// d'origine saturait à 8 m). Pur : le réglage, sa légende et son lien ; le shader est lu comme du texte.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargerScripts } from './charger.js';

const { RAMPE_HAUTEUR } = chargerScripts(['rampe-hauteur.js']);
const A = (x) => [...x];   // les tableaux du contexte du script n'ont pas le prototype de ceux du test
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

test('degrade : le défaut redonne exactement l’ancienne rampe (sombre, jaune à 35 %, rouge à la borne)', () => {
  // L'ancienne formule du shader : t = h / 8, sombre → jaune jusqu'à 0,35, jaune → rouge ensuite.
  const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const ancienne = (h) => { const t = Math.min(1, Math.max(0, h / 8)); return t < 0.35 ? mix([0.18, 0.19, 0.22], [0.90, 0.72, 0.28], t / 0.35) : mix([0.90, 0.72, 0.28], [0.95, 0.35, 0.25], (t - 0.35) / 0.65); };
  for (const h of [0, 0.5, 1, 2.8, 4, 6, 8, 20]) {
    RAMPE_HAUTEUR.couleur(h, 'degrade', 8).forEach((v, i) => assert.ok(Math.abs(v - ancienne(h)[i]) < 1e-9, `h=${h}`));
  }
});

test('seuil : sol sombre, jaune sous le seuil, rouge au seuil et au-delà, sans transition', () => {
  const { sol, jaune, rouge } = RAMPE_HAUTEUR.couleurs;
  assert.deepEqual(A(RAMPE_HAUTEUR.couleur(0.2, 'seuil', 22)), A(sol));
  assert.deepEqual(A(RAMPE_HAUTEUR.couleur(10, 'seuil', 22)), A(jaune));
  assert.deepEqual(A(RAMPE_HAUTEUR.couleur(21.99, 'seuil', 22)), A(jaune));
  assert.deepEqual(A(RAMPE_HAUTEUR.couleur(22, 'seuil', 22)), A(rouge));
  assert.deepEqual(A(RAMPE_HAUTEUR.couleur(45, 'seuil', 22)), A(rouge));
});

test('mode : degrade ou seuil, sinon degrade', () => {
  assert.deepEqual(A(RAMPE_HAUTEUR.modes), ['degrade', 'seuil']);
  assert.equal(RAMPE_HAUTEUR.mode('seuil'), 'seuil');
  for (const mauvais of ['x', undefined, null, 3]) assert.equal(RAMPE_HAUTEUR.mode(mauvais), 'degrade');
});

test('texels : 1024 couleurs de 0 à 50 m, opaques, qui redonnent la couleur de chaque hauteur', () => {
  const t = RAMPE_HAUTEUR.texels('degrade', 8);
  assert.equal(t.length, 1024 * 4);
  assert.ok(t instanceof Uint8Array);
  for (let i = 3; i < t.length; i += 4) assert.equal(t[i], 255);
  const h = 2.8, i = Math.floor(h / 50 * 1024);
  const c = RAMPE_HAUTEUR.couleur((i + 0.5) / 1024 * 50, 'degrade', 8).map((v) => Math.round(v * 255));
  assert.deepEqual([...t.slice(i * 4, i * 4 + 3)], A(c));
});

test('texels en seuil : la marche tombe au seuil, à 5 cm près', () => {
  const t = RAMPE_HAUTEUR.texels('seuil', 22);
  const px = (h) => [...t.slice(Math.floor(h / 50 * 1024) * 4, Math.floor(h / 50 * 1024) * 4 + 3)];
  const f = (c) => c.map((v) => Math.round(v * 255));
  assert.deepEqual(px(21.9), A(f(RAMPE_HAUTEUR.couleurs.jaune)));
  assert.deepEqual(px(22.1), A(f(RAMPE_HAUTEUR.couleurs.rouge)));
});

test('la légende du seuil nomme le seuil', () => {
  assert.equal(RAMPE_HAUTEUR.legende(22, 'seuil'), 'Sombre = sol · jaune = moins de 22 m · rouge = 22 m et plus');
  assert.equal(RAMPE_HAUTEUR.legende(8, 'degrade'), 'Sombre = sol · jaune = 3 m · rouge = 8 m et plus');
});

test('le shader lit une texture de rampe, plus de 8,0 ni d’uniforme de borne', () => {
  const s = lire('src/shaders.js');
  const rampe = s.slice(s.indexOf('vec3 rampeHauteur'), s.indexOf('}', s.indexOf('vec3 rampeHauteur')));
  assert.match(rampe, /u_rampe/);
  assert.ok(!/h \/ 8\.0|u_hmaxRampe/.test(rampe));
  assert.match(s, /uniform sampler2D u_rampe;/);
  assert.match(lire('src/vue3d.js'), /u_rampe/);
  assert.match(lire('src/gl.js'), /textureRampe/);
});

test('un curseur dans l’onglet Affichage, masqué hors du mode Hauteur/sol', () => {
  const html = lire('index.html');
  assert.match(html, /id="champ-hmax"[^>]*hidden/);
  assert.match(html, /<input type="range" id="vue-hmax" min="5" max="50" step="1" value="8">/);
  assert.match(html, /id="rampe-mode"/);
  assert.match(html, /data-mode="degrade"/);
  assert.match(html, /data-mode="seuil"/);
  assert.match(html, /src="src\/rampe-hauteur\.js"/);
});
