// Ce que l'outil dit quand ça ne marche pas.
//
// Un message d'erreur juste et inutile est un défaut à part entière : « HTTP 429
// sur https://data.geopf.fr/… » ne dit ni si c'est réparable, ni s'il faut
// attendre, ni si c'est la faute de l'utilisateur. Ces contrôles vérifient que
// chaque panne connue rend une **conduite à tenir**, et que l'inconnue rend
// quand même quelque chose.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = new URL('../src/', import.meta.url);
const lire = (nom) => readFileSync(fileURLToPath(new URL(nom, SRC)), 'utf8');

function charger(navigateur = {}) {
  const contexte = vm.createContext({ performance, navigator: navigateur, AbortSignal });
  for (const f of ['config.js', 'proj.js', 'reseau.js']) vm.runInContext(lire(f), contexte);
  return vm.runInContext('({ RESEAU, PROJ })', contexte);
}

const PANNES = [
  ['HTTP 429 sur https://data.geopf.fr/wmts?…', /attendez|attendre/i, 'limite de requêtes'],
  ['HTTP 503 sur https://data.geopf.fr/wfs/ows', /réessayez/i, 'erreur serveur'],
  ['HTTP 404 sur https://data.geopf.fr/wmts?…', /couverte/i, 'donnée absente'],
  ['délai de 30000 ms dépassé sur https://data.geopf.fr/…', /relancez/i, 'délai dépassé'],
  ['Failed to fetch', /réseau/i, 'connexion impossible'],
];

test('chaque panne connue rend une conduite à tenir, pas un code', () => {
  const { RESEAU } = charger();
  for (const [brut, attendu, quoi] of PANNES) {
    const dit = RESEAU.expliquer(new Error(brut));
    assert.match(dit, attendu, `${quoi} : « ${dit} »`);
    // Ni URL, ni jargon de protocole jeté à la figure.
    assert.ok(!/https?:\/\//.test(dit), `${quoi} : une URL a fuité — « ${dit} »`);
    assert.notEqual(dit, brut, `${quoi} : le message brut est passé tel quel`);
    assert.ok(dit.length > 40, `${quoi} : trop court pour dire quoi faire`);
  }
});

test('une panne inconnue passe telle quelle, plutôt qu’une phrase rassurante', () => {
  // Mieux vaut un message technique qu'un message faux : celui-là, au moins, se
  // cherche dans un moteur de recherche.
  const { RESEAU } = charger();
  const brut = 'Cannot perform DataView.prototype.getInt32 on a detached ArrayBuffer';
  assert.equal(RESEAU.expliquer(new Error(brut)), brut);
});

test('hors ligne prime sur tout autre diagnostic', () => {
  // Sans réseau, toutes les autres explications sont trompeuses : elles
  // enverraient chercher un problème chez l'IGN.
  const { RESEAU } = charger({ onLine: false });
  for (const [brut] of PANNES) {
    assert.match(RESEAU.expliquer(new Error(brut)), /hors ligne/i);
  }
});

test('l’emprise France sépare « pas encore volé » de « pas en France »', () => {
  // Deux messages qui n'ont rien à voir : l'un invite à chercher une zone bleue,
  // l'autre à revenir sur le territoire. Le rectangle est grossier — il déborde
  // sur la mer et les pays voisins — et c'est assumé : il ne sert qu'à ce tri.
  const { PROJ } = charger();
  for (const [nom, lon, lat] of [
    ['Paris', 2.35, 48.86],
    ['Ariège', 1.68, 42.74],
    ['Ajaccio', 8.74, 41.93],
    ['Brest', -4.49, 48.39],
    ['Dunkerque', 2.38, 51.03],
  ]) {
    assert.ok(PROJ.dansEmpriseFrance(lon, lat), `${nom} doit être dans l'emprise`);
  }
  for (const [nom, lon, lat] of [
    ['Londres', -0.13, 51.51],
    ['Berlin', 13.40, 52.52],
    ['New York', -74.01, 40.71],
    ['Alger', 3.06, 36.75],
    ['Fort-de-France', -61.07, 14.60],
  ]) {
    assert.ok(!PROJ.dansEmpriseFrance(lon, lat), `${nom} doit être hors de l'emprise`);
  }
});
