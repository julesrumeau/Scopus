// L'onglet 3D (`creerNuage3D`) avec des dépendances factices. Cas né d'une faute réelle : le nuage bâti pendant qu'on regarde les classes
// garde les hauteurs d'une surface ancienne ; passer ensuite en « Hauteur/sol » les relisait telles quelles, et 40 à 75 % des points
// sortaient à la hauteur 0 (couleur du sol). Passer à une couleur qui lit la surface doit donc la rafraîchir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { creerNuage3D } = chargerScripts(['nuage-3d.js']);

function monter(coloration = 'classification') {
  const compte = { surface: 0, nuage: 0 };
  const vue = { xmin: 0, xmax: 100, ymin: 0, ymax: 100 };
  const CONFIG = { flux: { surfaceMaxPointsKm2: 60 }, rendu: { budget3D: 5e6, budget3DMobile: 2e6, edl: { actif: true }, coloration, affinage3dMs: 1e9 } };
  const nuage = creerNuage3D({
    $: () => ({ hidden: false, value: '', textContent: '', checked: false, addEventListener() {} }),
    vue3d: { vider() {}, pose3d: { definirDepuisRectangle() {} }, definirNuage() {}, definirClassesMasquees() {} },
    relief: { nuage3d: async () => { compte.nuage++; return { n: 1, vide: false, parClasse: [], hauteur: new Float32Array(1) }; } },
    flux: { voulues: () => [] }, etat: { nuage: null }, ATTENTE: { pendant: async (nom, f) => f(async () => {}) },
    FLUX_CHOIX: { surfaceKm2: () => 1 }, CONFIG, milliers: String, surMobile: () => false, classesMasquees: new Set(),
    vueCourante: () => vue, dernierEtat: () => ({ points: 10, attente: 0 }), reliefAJour: async () => { compte.surface++; },
    majLegende() {}, majHUD() {}, majAttributNuage: async () => {}, majLien() {}, carte: {}, projVue: () => ({}), majVueFlux() {}, basculerVue() {},
    LIEN: {}, RECTANGLE_3D: {}, apresNuage() {},
  });
  return { nuage, compte, CONFIG };
}

test('sans rien de changé, un second passage en 3D ne reconstruit pas le nuage', async () => {
  const { nuage, compte } = monter();
  await nuage.construire();
  await nuage.construire();
  assert.equal(compte.nuage, 1);
});

test('rafraichir : reconstruit même si rien n’a bougé, avec une surface à jour quand la couleur la lit (Hauteur/sol)', async () => {
  const { nuage, compte, CONFIG } = monter('classification');
  await nuage.construire();
  const surfaceAvant = compte.surface;
  CONFIG.rendu.coloration = 'hauteur';   // l'utilisateur vient de choisir Hauteur/sol
  await nuage.rafraichir();
  assert.equal(compte.nuage, 2, 'le nuage est refait');
  assert.equal(compte.surface, surfaceAvant + 1, 'la surface est recalculée avec tous les blocs arrivés');
});

test('rafraichir attend la construction en cours au lieu de s’y fier (elle a pu commencer avec l’ancienne couleur)', async () => {
  const { nuage, compte, CONFIG } = monter('classification');
  const premiere = nuage.construire();
  CONFIG.rendu.coloration = 'hauteur';
  await nuage.rafraichir();
  await premiere;
  assert.equal(compte.nuage, 2);
});
