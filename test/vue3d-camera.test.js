// La caméra de la 3D posée d'après un lien (zone, échelle, angles) et bornée au rectangle du nuage.
// Une Vue3D sans WebGL : la géométrie de la caméra n'en dépend pas (comme test/boussole.test.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { Vue3D, Pose3D, RECTANGLE_3D, CONFIG } = chargerScripts(['config.js', 'rectangle-3d.js', 'vue3d.js', 'pose-3d.js']);
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} au lieu de ${b}`);

/** Un nuage de 800 × 500 m dont le coin (xmin, ymin) est l'origine, altitudes de 300 à 340 m. */
function vue() {
  const v = Object.create(Vue3D.prototype);
  v.canvas = { clientWidth: 800, clientHeight: 500 };
  v.cam = { cible: [0, 0, 0], distance: 300, azimut: 0, elevation: 0.6 };
  v.actif = false;
  v.controles = { arreter() {} };
  v.nuage = { origine: [1000, 5000, 300], emprise: { xmin: 1000, xmax: 1800, ymin: 5000, ymax: 5500 }, zmin: 0, zmax: 40 };
  v.zmin = 0;
  v.pose3d = new Pose3D(v);
  return v;
}

test('placerCamera : la cible est au point demandé, la distance reproduit l’échelle, les angles sont ceux demandés', () => {
  const v = vue();
  v.pose3d.placer(1400, 5250, 320, 1, 1.2, 0.7);
  proche(v.cam.cible[0], 400, 1e-9, 'est');
  proche(v.cam.cible[2], -250, 1e-9, 'sud');
  proche(v.cam.distance, RECTANGLE_3D.distanceDepuisResolution(1, 500, 52), 1e-9, 'distance');
  assert.equal(v.cam.azimut, 1.2);
  assert.equal(v.cam.elevation, 0.7);
});

test('placerCamera puis camera() : on retrouve l’échelle qu’on a demandée (aller-retour du lien)', () => {
  const v = vue();
  v.pose3d.placer(1400, 5250, null, 2.5, 0.3, 0.9);
  const c = v.camera();
  proche(c.metresParPixelCss, 2.5, 1e-9, 'mètres par pixel');
  proche(c.x, 1400, 1e-9, 'x');
  proche(c.y, 5250, 1e-9, 'y');
});

test('placerCamera sans altitude : la cible est à une hauteur raisonnable, pas à zéro', () => {
  const v = vue();
  v.pose3d.placer(1400, 5250, null, 1, 0, 0.6);
  assert.ok(v.cam.cible[1] > 0);
});

test('placerCamera sans nuage ne fait rien', () => {
  const v = vue();
  v.nuage = null;
  const avant = JSON.stringify(v.cam);
  v.pose3d.placer(1400, 5250, null, 1, 0, 0.6);
  assert.equal(JSON.stringify(v.cam), avant);
});

test('définir une pose en attente : elle s’applique au premier nuage, une seule fois', () => {
  const v = vue();
  v.pose3d.definir({ x: 1400, y: 5250, mpp: 1, azimut: 0.5, elevation: 0.8 });
  assert.equal(v.pose3d.appliquer(), true);
  assert.equal(v.cam.azimut, 0.5);
  assert.equal(v.pose3d.appliquer(), false, 'plus de pose en attente');
});

test('une pose en attente sans nuage reste en attente (le lien s’ouvre avant le premier bloc)', () => {
  const v = vue();
  v.nuage = null;
  v.pose3d.definir({ x: 1400, y: 5250, mpp: 1, azimut: 0.5, elevation: 0.8 });
  assert.equal(v.pose3d.appliquer(), false);
  assert.ok(v.pose3d.pose);
});

test('_borner : la cible ne sort pas du rectangle du nuage', () => {
  const v = vue();
  v.pose3d.definirLimites();
  v.cam.cible = [-300, 12, 90];
  v.pose3d.borner();
  assert.deepEqual([...v.cam.cible], [0, 12, 0]);
  v.cam.cible = [2000, 12, -900];
  v.pose3d.borner();
  assert.deepEqual([...v.cam.cible], [800, 12, -500]);
});

test('_borner : on ne s’éloigne pas au-delà de ce qui montre tout le rectangle', () => {
  const v = vue();
  v.pose3d.definirLimites();
  v.cam.distance = 99999;
  v.pose3d.borner();
  proche(v.cam.distance, RECTANGLE_3D.distanceMax(v.nuage.emprise, 52, 800 / 500), 1e-9, 'distance bornée');
  v.cam.distance = 120;
  v.pose3d.borner();
  assert.equal(v.cam.distance, 120, 'une distance permise ne bouge pas');
});

test('_borner sans limites (pas encore de nuage) ne change rien', () => {
  const v = vue();
  v.cam.cible = [9999, 1, -9999];
  v.pose3d.borner();
  assert.deepEqual([...v.cam.cible], [9999, 1, -9999]);
});

test('definirDepuisRectangle : la bascule manuelle reprend la zone et l’échelle de la carte, sous les angles par défaut', () => {
  const v = vue();
  const rect = { xmin: 1000, xmax: 1800, ymin: 5000, ymax: 5500, largeurPx: 800 };   // 1 m par pixel
  v.pose3d.definirDepuisRectangle(rect);
  assert.deepEqual([v.pose3d.pose.x, v.pose3d.pose.y], [1400, 5250]);
  proche(v.pose3d.pose.mpp, 1, 1e-12, 'échelle de la carte');
  assert.equal(v.pose3d.pose.azimut, -Math.PI / 4);
  assert.equal(v.pose3d.pose.elevation, 0.55);
});

test('definirDepuisRectangle ne remplace pas une pose venue d’un lien', () => {
  const v = vue();
  v.pose3d.definir({ x: 1, y: 2, mpp: 3, azimut: 4, elevation: 0.5 });
  v.pose3d.definirDepuisRectangle({ xmin: 0, xmax: 800, ymin: 0, ymax: 500, largeurPx: 800 });
  assert.equal(v.pose3d.pose.x, 1);
});
