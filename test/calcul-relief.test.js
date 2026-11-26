// Le calcul du relief de la vue (`creerCalculRelief`), avec des dépendances factices : ni DOM ni Leaflet ni worker.
// Cas né d'une faute réelle : avec une photo ou un plan des deux côtés, aucun relief n'était calculé, donc aucune surface,
// et la 3D en mode « Hauteur/sol » colorait TOUS les points comme du sol (hauteur 0).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { creerCalculRelief } = chargerScripts(['calcul-relief.js']);

function monter({ cotes = { gauche: 'carte', droite: 'carte' }, troplarge = false, enTroisD = true } = {}) {
  const appels = { image: [], afficher: [], vider: [] };
  const volet = {
    carte: { getZoom: () => 16, getPixelBounds: () => ({ getBottomLeft: () => 0, getTopRight: () => 0 }), unproject: () => ({}) },
    calque: { definirLibelle() {}, vider: (c) => appels.vider.push(c), afficher: (c) => appels.afficher.push(c) },
  };
  const reglages = { cotes, contraste: 1, lisser: true, classesSol: new Set(), svfRayonM: 10 };
  const calcul = creerCalculRelief({
    $: (id) => ({ hidden: id === 'vue-3d' ? !enTroisD : false, innerHTML: '' }),
    relief: { image: async (geo, cle) => { appels.image.push(cle); return { min: 0, max: 1, duree: 0, dureeSurface: 0, classes: [] }; }, lire: async () => null },
    infoRelief: { coteMax: 0, filPrincipal: false }, activite: {},
    FLUX_CHOIX: { surfaceKm2: () => (troplarge ? 1e6 : 1), pasPourVue: () => 1 },
    VUE_GRILLE: { definir: () => ({ W: 1, H: 1, pas: 1 }), marge: () => 0 },
    VOLETS: { ecran: () => ({}) }, MODE_CARTE: { cotesAffiches: () => ['gauche', 'droite'] },
    RELIEF: { COUCHES: [{ cle: 'ombrage', palette: [] }, { cle: 'svf', palette: [] }] },
    CONFIG: { relief: {}, flux: { surfaceMaxPointsKm2: 60, pasMinM: 0.5 } }, L: { latLngBounds: () => ({}) },
    NOMS_CLASSES: {}, construireLUT: () => null, vueCartes: { mode: () => 'scinde', volets: () => [volet] }, voletDe: () => volet,
    reglages, estRelief: (k) => k === 'svf' || k === 'ombrage', libelleCouche: () => '', outils: { selection: () => null },
    vueCourante: () => ({ xmin: 0, xmax: 100, ymin: 0, ymax: 100, largeurPx: 800 }), flux: () => ({ voulues: () => [] }),
    territoire: () => 'metropole', reglagesDe: () => ({}), majStatut() {},
  });
  return { calcul, appels };
}

test('en 3D, sans côté en relief : un calcul forcé fait une surface (par l’ombrage) pour les hauteurs, sans rien afficher', async () => {
  const { calcul, appels } = monter();
  await calcul.aJour();
  assert.deepEqual(appels.image, ['ombrage']);
  assert.deepEqual(appels.afficher, []);
  assert.deepEqual(appels.vider, []);
});

test('en 3D, sans calcul forcé : rien ne se calcule (la carte est masquée)', async () => {
  const { calcul, appels } = monter();
  await calcul.calculer();
  assert.deepEqual(appels.image, []);
});

test('avec un côté en relief : seul ce côté est calculé et affiché, comme avant', async () => {
  const { calcul, appels } = monter({ cotes: { gauche: 'carte', droite: 'svf' } });
  await calcul.aJour();
  assert.deepEqual(appels.image, ['svf']);
  assert.deepEqual(appels.afficher, ['droite']);
});

test('hors 3D, sans côté en relief : toujours rien à calculer', async () => {
  const { calcul, appels } = monter({ enTroisD: false });
  await calcul.calculer();
  assert.deepEqual(appels.image, []);
});

test('une vue trop large ne calcule rien, même forcé', async () => {
  const { calcul, appels } = monter({ troplarge: true });
  await calcul.aJour();
  assert.deepEqual(appels.image, []);
});
