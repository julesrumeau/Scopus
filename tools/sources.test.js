// Contrôles de base sur les fichiers livrés.
//
// Sans modules ES, rien ne relie `index.html` à `src/` : une faute de frappe
// dans un fichier ne se voit qu'à l'exécution, et sous une forme trompeuse —
// une accolade en trop dans `vue3d.js` se manifeste par « Vue3D is not
// defined » au moment où l'application démarre, à l'autre bout de la chaîne.
// Ces vérifications-là sont mécaniques ; autant les faire à froid.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = new URL('../src/', import.meta.url);
const RACINE = new URL('../', import.meta.url);
const FICHIERS = readdirSync(fileURLToPath(SRC)).filter((f) => f.endsWith('.js')).sort();

test('tous les scripts de src/ sont syntaxiquement valides', () => {
  for (const nom of FICHIERS) {
    const source = readFileSync(fileURLToPath(new URL(nom, SRC)), 'utf8');
    assert.doesNotThrow(
      // Compiler sans exécuter : on cherche les fautes de syntaxe, pas à faire
      // tourner du code qui réclame un DOM.
      () => new vm.Script(source, { filename: nom }),
      `${nom} : syntaxe invalide`,
    );
  }
});

test('index.html charge tous les scripts de src/, dans un ordre plausible', () => {
  const html = readFileSync(fileURLToPath(new URL('index.html', RACINE)), 'utf8');
  const charges = [...html.matchAll(/<script src="src\/([^"]+)"><\/script>/g)].map((m) => m[1]);

  for (const nom of FICHIERS) {
    assert.ok(charges.includes(nom), `${nom} existe mais n'est pas chargé par index.html`);
  }
  for (const nom of charges) {
    assert.ok(FICHIERS.includes(nom), `index.html charge ${nom}, qui n'existe pas`);
  }

  // `config.js` définit CONFIG, que presque tout le monde lit ; `app.js` câble
  // le reste et doit donc venir en dernier.
  assert.equal(charges[0], 'config.js', 'config.js doit être chargé en premier');
  assert.equal(charges[charges.length - 1], 'app.js', 'app.js doit être chargé en dernier');
});

test('aucun module ES ne s’est glissé dans les sources', () => {
  // Un `import` ou un `type="module"` casserait l'ouverture en file://, qui est
  // la raison d'être de toute l'architecture.
  for (const nom of FICHIERS) {
    const source = readFileSync(fileURLToPath(new URL(nom, SRC)), 'utf8');
    assert.ok(!/^\s*(import|export)\s/m.test(source), `${nom} : import/export interdit`);
  }
  // Commentaires HTML retirés d'abord : `index.html` explique justement
  // pourquoi il n'y a pas de `type="module"`, et cette phrase ne doit pas
  // déclencher l'alerte.
  const html = readFileSync(fileURLToPath(new URL('index.html', RACINE)), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!/type="module"/.test(html), 'index.html : type="module" interdit');
});
