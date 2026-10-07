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

test('tous les identifiants câblés par app.js existent dans index.html', () => {
  // `app.js` ne parle au panneau que par `$('id')`. Un identifiant renommé ou
  // supprimé d'`index.html` ne casse rien à la lecture : `document.getElementById`
  // rend `null`, et la panne n'apparaît qu'au clic, sous la forme d'un
  // « Cannot read properties of null » sans rapport visible avec le HTML.
  const source = readFileSync(fileURLToPath(new URL('app.js', SRC)), 'utf8');
  const html = readFileSync(fileURLToPath(new URL('index.html', RACINE)), 'utf8');
  const declares = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

  for (const m of source.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(declares.has(m[1]), `app.js lit #${m[1]}, absent d'index.html`);
  }
});

test('les scripts cohabitent dans un seul environnement lexical', () => {
  // Sans modules ES, tous les fichiers de `src/` partagent la portée globale.
  // Deux `const` ou deux `class` du même nom dans deux fichiers différents, et
  // le second jette « Identifier already declared » — au chargement de la page,
  // donc avant que rien ne s'affiche. Les compiler un par un ne le voit pas :
  // il faut les évaluer ensemble, dans l'ordre où `index.html` les charge.
  const html = readFileSync(fileURLToPath(new URL('index.html', RACINE)), 'utf8');
  const charges = [...html.matchAll(/<script src="src\/([^"]+)"><\/script>/g)].map((m) => m[1]);

  const contexte = vm.createContext({
    performance,
    self: {},
    navigator: { hardwareConcurrency: 4 },
    window: { devicePixelRatio: 1 },
    document: { getElementById: () => null, createElement: () => ({ style: {} }) },
    L: { Layer: { extend: (o) => o }, LayerGroup: { extend: (o) => o } },
    URL, Blob: class {}, Worker: class {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  });

  for (const nom of charges) {
    // `app.js` câble le DOM et s'exécute vraiment : il ne se prête pas à une
    // évaluation à froid, et il est de toute façon chargé en dernier.
    if (nom === 'app.js') continue;
    const source = readFileSync(fileURLToPath(new URL(nom, SRC)), 'utf8');
    assert.doesNotThrow(() => vm.runInContext(source, contexte, { filename: nom }),
      `${nom} : évaluation impossible à la suite des précédents`);
  }
});

test('l’attribut hidden ne peut pas être annulé par une règle de style', () => {
  // La feuille du navigateur pose `[hidden] { display: none }`, mais toute règle
  // d'auteur donnant un `display` au même élément l'emporte — même spécificité,
  // et l'auteur passe après. L'attribut devient alors sans effet, en silence :
  // le voile d'attente s'affichait au démarrage, le détail de dalle et les
  // exports de sentiers ne se cachaient jamais. La parade est globale, et ce
  // contrôle existe pour qu'on ne la retire pas par mégarde.
  const css = readFileSync(fileURLToPath(new URL('styles.css', RACINE)), 'utf8');
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    'styles.css doit garder `[hidden] { display: none !important; }`');
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

test('chaque onglet ouvre sur sa section principale, puis Point sélectionné et Mesure', () => {
  // Les sections s'empilent dans l'ordre du HTML, quel que soit l'onglet.
  // Août 2026 : « Point sélectionné » semblait changer de place entre 2D et
  // 3D, Affichage (3D seule) la précédant. Septembre 2026, retour
  // d'usage : sur la carte, Relief précède « Point sélectionné » et en 3D
  // Affichage la suivait — l'ordre différait d'un onglet à l'autre. La règle
  // retenue : la section principale de chaque onglet (Relief, Affichage)
  // d'abord, puis « Point sélectionné », puis « Mesure ».
  const html = readFileSync(fileURLToPath(new URL('index.html', RACINE)), 'utf8');
  const i = (id) => html.indexOf(`id="${id}"`);
  for (const id of ['section-vue', 'section-affichage', 'section-selection', 'section-mesure']) {
    assert.ok(i(id) > -1, `${id} doit exister`);
  }
  for (const principale of ['section-vue', 'section-affichage']) {
    assert.ok(i(principale) < i('section-selection'), `${principale} doit précéder section-selection`);
  }
  assert.ok(i('section-selection') < i('section-mesure'), 'section-selection doit précéder section-mesure');
});

test('aucune règle de styles.css ne dépend de body[data-mode] : plus rien ne pose cet attribut', () => {
  // Le retrait de `?dalle` a supprimé la ligne qui posait `data-mode="vue"` ; une règle
  // « body:not([data-mode="vue"]) #mode-profil { display: none } » est restée et cachait le bouton
  // Profil du site publié, sans qu'aucun test ne le voie.
  const css = readFileSync(fileURLToPath(new URL('styles.css', RACINE)), 'utf8');
  const poseAttribut = FICHIERS.some((f) => /dataset\.mode\s*=|setAttribute\(\s*['"]data-mode['"]/.test(readFileSync(fileURLToPath(new URL(f, SRC)), 'utf8')));
  assert.equal(poseAttribut, false, 'un script repose data-mode : ce test est à revoir');
  assert.deepEqual(css.match(/body[^{,]*\[data-mode[^{,]*/g) || [], [], 'règles dépendant de body[data-mode]');
});

test('majVueFlux n’est jamais passée telle quelle comme gestionnaire : Leaflet lui donnerait l’événement', () => {
  // Son paramètre est un rectangle imposé (lien 3D) ; `carte.map.on('moveend', majVueFlux)` lui passait
  // l'événement, la zone calculée devenait absurde et la page se figeait (5 octobre 2026).
  const app = readFileSync(fileURLToPath(new URL('app.js', SRC)), 'utf8');
  assert.deepEqual(app.match(/\.on\([^)]*,\s*majVueFlux\s*\)/g) || [], []);
});

test('à 601–900 px, le panneau latéral commence sous la barre des onglets et des outils, il ne la recouvre pas', () => {
  // Il la recouvrait toute (Carte, 3D, déplacement, sélection, mesure, profil) : tablette et téléphone couché.
  const css = readFileSync(fileURLToPath(new URL('styles.css', RACINE)), 'utf8');
  const bloc = css.slice(css.indexOf('@media (min-width: 601px) and (max-width: 900px)'));
  const top = /\.panneau \{[^}]*?top:\s*([^;]+);/.exec(bloc)?.[1];
  assert.ok(top, 'une règle top pour le panneau latéral');
  assert.match(top, /calc\(46px \+ var\(--hauteur-barre\)\)/, `top = ${top}`);
  assert.match(css, /--hauteur-barre:\s*46px/, 'la hauteur de la barre est une variable');
});

test('le texte visible d’index.html ne contient aucun tiret cadratin (convention de l’interface)', () => {
  // Hors commentaires HTML : seul ce que la personne lit compte. Les messages des scripts suivent la même règle (revue à la main).
  const html = readFileSync(fileURLToPath(new URL('index.html', RACINE)), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const lignes = html.split('\n').filter((l) => l.includes('—')).map((l) => l.trim().slice(0, 80));
  assert.deepEqual(lignes, []);
});
