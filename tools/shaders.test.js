// Garde-fou contre le piège du backtick dans un commentaire GLSL.
//
// Les shaders vivent dans des littéraux de gabarit. Un backtick glissé dans un
// commentaire GLSL — réflexe naturel quand on cite un nom de fonction — ferme la
// chaîne au milieu du shader. Le reste du fichier est alors interprété comme du
// JavaScript, `shaders.js` n'expose plus rien, et l'erreur remonte sous la forme
// « SHADERS is not defined » à l'autre bout de l'application.
//
// Le piège est documenté dans CLAUDE.md et s'est malgré tout reproduit deux
// fois. Un test coûte moins cher qu'une troisième.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chargerScripts } from './charger.js';

const SOURCE = readFileSync(fileURLToPath(new URL('../src/shaders.js', import.meta.url)), 'utf8');

test('aucun backtick dans les commentaires GLSL', () => {
  // Les seuls backticks légitimes ouvrent ou ferment un gabarit : ils sont donc
  // précédés de « : » ou suivis de « , ». Tout autre est un intrus.
  const fautifs = SOURCE.split('\n')
    .map((ligne, i) => ({ ligne, n: i + 1 }))
    .filter(({ ligne }) => ligne.includes('`'))
    .filter(({ ligne }) => !/:\s*`#version|^\}`,$|^[^`]*\}`,$/.test(ligne.trim()));

  assert.equal(fautifs.length, 0,
    `backtick suspect :\n${fautifs.map((f) => `  ligne ${f.n} : ${f.ligne.trim()}`).join('\n')}`);
});

test('les shaders sont bien exposés et non tronqués', () => {
  const { SHADERS } = chargerScripts(['shaders.js']);
  assert.ok(SHADERS, 'SHADERS non exposé — chaîne de gabarit probablement fermée trop tôt');

  for (const nom of ['pointsVS', 'pointsFS', 'lignesVS', 'lignesFS']) {
    const src = SHADERS[nom];
    assert.equal(typeof src, 'string', `${nom} absent`);
    assert.ok(src.startsWith('#version 300 es'), `${nom} : directive de version manquante`);
    // Un shader tronqué perd sa dernière accolade avant tout le reste.
    assert.ok(src.trimEnd().endsWith('}'), `${nom} : source tronquée`);
    assert.ok(src.split('{').length === src.split('}').length, `${nom} : accolades déséquilibrées`);
  }
});

test('aucun échantillonnage à LOD implicite en vertex shader', () => {
  const { SHADERS } = chargerScripts(['shaders.js']);
  for (const nom of ['pointsVS', 'lignesVS']) {
    // `texture(` est interdit dans un étage sommet : les dérivées d'écran n'y
    // existent pas. Certains pilotes l'acceptent, d'autres refusent de compiler.
    const sansCommentaires = SHADERS[nom].replace(/\/\/[^\n]*/g, '');
    assert.ok(!/[^A-Za-z]texture\s*\(/.test(sansCommentaires),
      `${nom} : utiliser textureLod(..., 0.0) et non texture(...)`);
  }
});
