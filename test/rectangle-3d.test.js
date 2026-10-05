// Le rectangle au sol de la 3D : ce que la carte montrerait à ce zoom, sur la taille de la scène. La caméra
// y est posée (distance déduite de l'échelle) et n'en sort pas. Fonctions pures.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { RECTANGLE_3D } = chargerScripts(['rectangle-3d.js']);
const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} au lieu de ${b}`);
const TAN26 = Math.tan((52 / 2) * Math.PI / 180);

test('la distance de la caméra se déduit de l’échelle : mètres par pixel × hauteur / (2 tan(fov/2))', () => {
  proche(RECTANGLE_3D.distanceDepuisResolution(1, 600, 52), 600 / (2 * TAN26), 1e-9, '1 m/px');
  proche(RECTANGLE_3D.distanceDepuisResolution(0.5, 600, 52), 300 / (2 * TAN26), 1e-9, '0,5 m/px');
});

test('la résolution est l’inverse de la distance : aller-retour', () => {
  for (const mpp of [0.3, 1, 7.5]) {
    const d = RECTANGLE_3D.distanceDepuisResolution(mpp, 713, 52);
    proche(RECTANGLE_3D.resolutionDepuisDistance(d, 713, 52), mpp, 1e-12, `${mpp}`);
  }
});

test('poseDepuisRectangle : centre du rectangle, échelle de la carte, distance qui la reproduit', () => {
  const rect = { xmin: 1000, xmax: 1800, ymin: 5000, ymax: 5500, largeurPx: 800 };   // 1 m par pixel
  const pose = RECTANGLE_3D.poseDepuisRectangle(rect, 500, 52);
  assert.deepEqual([pose.x, pose.y], [1400, 5250]);
  proche(pose.mpp, 1, 1e-12, 'mètres par pixel');
  proche(pose.distance, 500 / (2 * TAN26), 1e-9, 'distance');
});

test('rectangleCible : l’emprise en coordonnées de la cible de la caméra (x vers l’est, z vers le sud)', () => {
  const r = RECTANGLE_3D.rectangleCible({ xmin: 1000, xmax: 1800, ymin: 5000, ymax: 5500 }, [1000, 5000, 300]);
  assert.deepEqual([r.xmin, r.xmax, r.zmin, r.zmax], [0, 800, -500, 0]);
});

test('limiterCible : une cible dehors est ramenée sur le bord, une cible dedans ne bouge pas, la hauteur non plus', () => {
  const r = { xmin: 0, xmax: 800, zmin: -500, zmax: 0 };
  assert.deepEqual([...RECTANGLE_3D.limiterCible([400, 17, -250], r)], [400, 17, -250]);
  assert.deepEqual([...RECTANGLE_3D.limiterCible([-90, 17, -250], r)], [0, 17, -250]);
  assert.deepEqual([...RECTANGLE_3D.limiterCible([900, 17, 40], r)], [800, 17, 0]);
  assert.deepEqual([...RECTANGLE_3D.limiterCible([400, 17, -900], r)], [400, 17, -500]);
});

test('limiterCible : sans rectangle, rien ne bouge (avant que le nuage existe)', () => {
  assert.deepEqual([...RECTANGLE_3D.limiterCible([5, 6, 7], null)], [5, 6, 7]);
});

test('distanceMax : de quoi voir tout le rectangle d’au-dessus, avec une marge, jamais plus', () => {
  const emprise = { xmin: 0, xmax: 800, ymin: 0, ymax: 500 };
  // Une scène de 800 × 500 : la hauteur visible à la verticale vaut 2 d tan(fov/2).
  const d = RECTANGLE_3D.distanceMax(emprise, 52, 800 / 500);
  proche(d, 1.3 * 500 / (2 * TAN26), 1e-9, 'rectangle de même forme que la scène');
  // Une scène plus étroite : c'est la largeur qui borne.
  const etroite = RECTANGLE_3D.distanceMax(emprise, 52, 0.5);
  proche(etroite, 1.3 * (800 / 0.5) / (2 * TAN26), 1e-9, 'scène étroite');
});

test('distanceMax est infinie sans emprise : on ne borne pas ce qu’on ne connaît pas', () => {
  assert.equal(RECTANGLE_3D.distanceMax(null, 52, 1.6), Infinity);
});

test('depuisCentre : le rectangle de la scène à cette échelle, centré sur le point, avec sa largeur en pixels', () => {
  const r = RECTANGLE_3D.depuisCentre({ x: 1400, y: 5250 }, 0.5, 800, 500);
  assert.deepEqual([r.xmin, r.xmax, r.ymin, r.ymax, r.largeurPx], [1200, 1600, 5125, 5375, 800]);
});

test('depuisCentre est l’inverse de poseDepuisRectangle : on retrouve le centre et l’échelle', () => {
  const r = RECTANGLE_3D.depuisCentre({ x: 77.5, y: 1234 }, 2.25, 1021, 733);
  const p = RECTANGLE_3D.poseDepuisRectangle(r, 733, 52);
  proche(p.x, 77.5, 1e-9, 'x');
  proche(p.y, 1234, 1e-9, 'y');
  proche(p.mpp, 2.25, 1e-12, 'échelle');
});
