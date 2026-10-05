// Le garde-fou de taille du code : mesure les fonctions et les classes de src/ et refuse qu'une nouvelle
// dépasse les limites, ou qu'une ancienne grossisse. Les limites actuelles sont un **cliquet** : elles ne
// font que baisser (voir taille-code.limites.json). D'abord le mesureur lui-même, sur de petits exemples.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mesurer } from './taille-code.js';

const trouve = (liste, nom) => liste.find((e) => e.nom === nom);

test('une fonction déclarée : son nom, sa position, sa taille', () => {
  const m = mesurer('function a() {\n  return 1;\n}\n');
  assert.equal(m.length, 1);
  assert.equal(m[0].nom, 'a');
  assert.equal(m[0].type, 'fonction');
  assert.equal(m[0].debut, 1);
  assert.equal(m[0].lignes, 3);
});

test('une flèche affectée à une constante prend le nom de la constante', () => {
  const m = mesurer('const calculer = (x, y) => {\n  const z = x + y;\n  return z;\n};\n');
  assert.equal(trouve(m, 'calculer').lignes, 4);
});

test('une flèche async, ou à un seul paramètre sans parenthèses', () => {
  const m = mesurer('const a = async () => {\n};\nconst b = x => {\n  return x;\n};\n');
  assert.equal(trouve(m, 'a').lignes, 2);
  assert.equal(trouve(m, 'b').lignes, 3);
});

test('une classe et ses méthodes sont mesurées à part', () => {
  const m = mesurer('class Foo {\n  constructor() {\n    this.a = 1;\n  }\n  methode(x) {\n    return x;\n  }\n}\n');
  assert.equal(trouve(m, 'Foo').type, 'classe');
  assert.equal(trouve(m, 'Foo').lignes, 8);
  assert.equal(trouve(m, 'constructor').lignes, 3);
  assert.equal(trouve(m, 'methode').lignes, 3);
});

test('une méthode d’objet, et une méthode async', () => {
  const m = mesurer('const o = {\n  deplier() {\n    return 1;\n  },\n  async charger() {\n    return 2;\n  },\n};\n');
  assert.equal(trouve(m, 'deplier').lignes, 3);
  assert.equal(trouve(m, 'charger').lignes, 3);
});

test('if, for, while, switch, catch ne sont pas des fonctions', () => {
  const m = mesurer('function f(x) {\n  if (x) {\n    for (const a of x) {\n      while (a) { a--; }\n    }\n  } else {\n    switch (x) { case 1: break; }\n  }\n  try { x(); } catch (e) { x = e; }\n}\n');
  assert.equal(m.length, 1);
  assert.equal(m[0].nom, 'f');
});

test('les accolades dans les chaînes, gabarits, commentaires et expressions régulières ne comptent pas', () => {
  const src = [
    'function g() {',
    '  const a = "{";',
    "  const b = '}';",
    '  const c = `${a}{ ${b ? "}" : `{`} }`;',
    '  // } une accolade en commentaire',
    '  /* { */',
    '  const r = /[{}]\\{/;',
    '  return a + b + c + r;',
    '}',
  ].join('\n');
  const m = mesurer(src);
  assert.equal(m.length, 1);
  assert.equal(m[0].lignes, 9);
});

test('une division n’est pas une expression régulière', () => {
  const m = mesurer('function h(a, b) {\n  const q = a / b;\n  const r = (a + b) / 2 / b;\n  return q / r;\n}\n');
  assert.equal(m.length, 1);
  assert.equal(m[0].lignes, 5);
});

test('une fonction invoquée aussitôt (IIFE) est mesurée sous le nom « (IIFE) »', () => {
  const m = mesurer('(() => {\n  const x = 1;\n  return x;\n})();\n');
  assert.equal(m[0].nom, '(IIFE)');
  assert.equal(m[0].lignes, 4);
});

test('lignes propres : sans compter les fonctions imbriquées', () => {
  const m = mesurer('function dehors() {\n  const a = 1;\n  function dedans() {\n    return 2;\n  }\n  const b = () => {\n    return 3;\n  };\n  return a;\n}\n');
  assert.equal(trouve(m, 'dehors').lignes, 10);
  assert.equal(trouve(m, 'dehors').propres, 10 - 3 - 3);
  assert.equal(trouve(m, 'dedans').propres, 3);
});

test('une fonction fléchée sans corps en accolades n’est pas mesurée', () => {
  const m = mesurer('const s = (a) => a + 1;\nfunction k() {\n  return s(1);\n}\n');
  assert.equal(m.length, 1);
  assert.equal(m[0].nom, 'k');
});

test('une source sans fonction ne rend rien', () => {
  assert.deepEqual([...mesurer('const a = 1;\nconst b = { c: 2 };\n')], []);
});

test('une clé d’objet ou un nom de propriété « class » n’est pas une classe', () => {
  const m = mesurer("function f(el) {\n  el.setAttribute('x', { class: 'fond', r: 1 });\n  el.class = 2;\n  return { class: 'a' };\n}\n");
  assert.equal(m.length, 1);
  assert.equal(m[0].nom, 'f');
});

test('une classe anonyme ou qui en étend une autre reste une classe', () => {
  const m = mesurer('const A = class {\n  m() {}\n};\nclass B extends A {\n  n() {}\n}\n');
  assert.equal(m.filter((e) => e.type === 'classe').length, 2);
});

// ── Le cliquet : les limites ne font que baisser ─────────────────────────────

import { readFileSync } from 'node:fs';
import { observer, SEUILS } from './taille-code.js';

const LIMITES = JSON.parse(readFileSync(new URL('./taille-code.limites.json', import.meta.url), 'utf8'));

/** Compare ce qu'on observe à ce que le cliquet autorise : rien de neuf, rien qui grossisse, rien de resté lâche. */
function ecarts(observe, autorise, unite) {
  const problemes = [];
  for (const cle of new Set([...Object.keys(observe), ...Object.keys(autorise)])) {
    const vu = [...(observe[cle] || [])].sort((a, b) => b - a);
    const ok = [...(autorise[cle] || [])].sort((a, b) => b - a);
    if (!ok.length) { problemes.push(`${cle} : ${vu.join(', ')} ${unite} — dépasse ${SEUILS[unite === 'lignes (fonction)' ? 'fonction' : unite === 'lignes (classe)' ? 'classe' : 'fichier']}, à découper (ou à justifier dans le cliquet)`); continue; }
    if (vu.length > ok.length) problemes.push(`${cle} : une fonction de plus dépasse le seuil (${vu.join(', ')} ${unite})`);
    for (let i = 0; i < Math.min(vu.length, ok.length); i++) {
      if (vu[i] > ok[i]) problemes.push(`${cle} : ${vu[i]} ${unite}, la limite est ${ok[i]} — elle ne doit pas grossir`);
      else if (vu[i] < ok[i]) problemes.push(`${cle} : ${vu[i]} ${unite}, la limite est restée à ${ok[i]} — la ramener à ${vu[i]} (node test/taille-code.js --ecrire)`);
    }
    if (vu.length < ok.length) problemes.push(`${cle} : n'est plus au-dessus du seuil — retirer la limite (node test/taille-code.js --ecrire)`);
  }
  return problemes;
}

test('aucune fonction ne dépasse le seuil de lignes propres, hors du cliquet, et le cliquet ne se relâche pas', () => {
  const { fonctions } = observer();
  assert.deepEqual(ecarts(fonctions, LIMITES.fonctions, 'lignes (fonction)'), []);
});

test('aucune classe ne dépasse le seuil de lignes, hors du cliquet, et le cliquet ne se relâche pas', () => {
  const { classes } = observer();
  assert.deepEqual(ecarts(classes, LIMITES.classes, 'lignes (classe)'), []);
});

test('aucun fichier ne dépasse le seuil de lignes, hors du cliquet, et le cliquet ne se relâche pas', () => {
  const { fichiers } = observer();
  assert.deepEqual(ecarts(fichiers, LIMITES.fichiers, 'lignes (fichier)'), []);
});

test('les seuils sont ceux de la règle : fonction 100 lignes propres, classe 400, fichier 1000', () => {
  assert.deepEqual({ ...SEUILS }, { fonction: 100, classe: 400, fichier: 1000 });
  assert.deepEqual({ ...LIMITES.seuils }, { fonction: 100, classe: 400, fichier: 1000 });
});
