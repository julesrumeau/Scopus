// Reprojection d'une couche Lambert-93 en image Web Mercator au pixel de la
// carte. Vérifiée contre PROJ et la convention des grilles (ligne 0 au sud,
// RASTER.centreCellule) — jamais contre une formule recopiée : c'est ainsi que
// la photo aérienne est passée retournée nord-sud (CLAUDE.md).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { VUE_IMAGE, VUE_GRILLE, PROJ, RASTER } = chargerScripts(['config.js', 'proj.js', 'vue-grille.js', 'raster.js', 'vue-image.js']);

// Une vue d'environ 700 × 450 m à Verdun, au zoom 17 (≈ 0,8 m par pixel).
const z = 17;
function ecranAutour(lon, lat, W, H) {
  const n = 256 * 2 ** z;
  const px = ((lon + 180) / 360) * n;
  const py = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n;
  return { x0: Math.floor(px - W / 2), y0: Math.floor(py - H / 2), W, H, z };
}
const ecran = ecranAutour(5.4359, 49.2066, 800, 500);
const so = VUE_IMAGE.pixelVersLonLat(ecran.x0, ecran.y0 + ecran.H, z);
const ne = VUE_IMAGE.pixelVersLonLat(ecran.x0 + ecran.W, ecran.y0, z);
const a = PROJ.versLambert93(so.lon, so.lat), b = PROJ.versLambert93(ne.lon, ne.lat);
const geo = VUE_GRILLE.definir({ xmin: Math.min(a.x, b.x), xmax: Math.max(a.x, b.x), ymin: Math.min(a.y, b.y), ymax: Math.max(a.y, b.y) }, 1, 40, 4096);

test('pixel ↔ lon/lat : l’inverse de la projection Web Mercator', () => {
  const { lon, lat } = VUE_IMAGE.pixelVersLonLat(ecran.x0 + 400, ecran.y0 + 250, z);
  assert.ok(Math.abs(lon - 5.4359) < 1e-4 && Math.abs(lat - 49.2066) < 1e-4, `${lon} ${lat}`);
});

test('chaque pixel tombe dans la case que donne PROJ, au dixième de case près', () => {
  const { u, v } = VUE_IMAGE.cases(geo, ecran, PROJ.versLambert93);
  let pire = 0;
  for (let j = 0; j < ecran.H; j += 7) {
    for (let i = 0; i < ecran.W; i += 7) {
      const ll = VUE_IMAGE.pixelVersLonLat(ecran.x0 + i + 0.5, ecran.y0 + j + 0.5, z);
      const L = PROJ.versLambert93(ll.lon, ll.lat);
      // Case continue attendue, centres aux entiers — la convention de RASTER.centreCellule.
      const c0 = RASTER.centreCellule({ emprise: geo.emprise, pas: geo.pas }, 0, 0);
      const ue = (L.x - c0.x) / geo.pas, ve = (L.y - c0.y) / geo.pas;
      const k = j * ecran.W + i;
      pire = Math.max(pire, Math.abs(u[k] - ue), Math.abs(v[k] - ve));
    }
  }
  assert.ok(pire < 0.1, `écart ${pire} case`);
});

test('le haut de l’image est au nord : v décroît quand on descend', () => {
  const { v } = VUE_IMAGE.cases(geo, ecran, PROJ.versLambert93);
  const haut = v[10 * ecran.W + 400], bas = v[(ecran.H - 10) * ecran.W + 400];
  assert.ok(haut > bas, `${haut} ≤ ${bas}`);
});

test('peindre : la valeur de la case, étirée sur la palette ; sans valeur, transparent (le voile du côté se voit)', () => {
  const W = geo.W, H = geo.H;
  const valeurs = new Float32Array(W * H).fill(1);
  const { u, v } = VUE_IMAGE.cases(geo, ecran, PROJ.versLambert93);
  const k = 250 * ecran.W + 400;
  const cx = Math.round(u[k]), cy = Math.round(v[k]);
  valeurs[cy * W + cx] = NaN;
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) lut.set([i, i, i], i * 3);
  const rgba = VUE_IMAGE.peindre(valeurs, geo, { u, v }, 0, 1, lut, false);
  assert.equal(rgba.length, ecran.W * ecran.H * 4);
  assert.deepEqual([...rgba.slice(k * 4, k * 4 + 4)], [0, 0, 0, 0]);              // case NaN : transparente
  const loin = 20 * ecran.W + 20;
  assert.deepEqual([...rgba.slice(loin * 4, loin * 4 + 4)], [255, 255, 255, 255]); // valeur 1 = haut de palette
});

test('peindre : hors de la grille, transparent', () => {
  const petite = VUE_GRILLE.definir({ xmin: geo.emprise.xmin, xmax: geo.emprise.xmin + 50, ymin: geo.emprise.ymin, ymax: geo.emprise.ymin + 50 }, 1, 0, 4096);
  const uv = VUE_IMAGE.cases(petite, ecran, PROJ.versLambert93);
  const lut = new Uint8Array(256 * 3).fill(200);
  const rgba = VUE_IMAGE.peindre(new Float32Array(petite.W * petite.H).fill(0.5), petite, uv, 0, 1, lut, false);
  const centre = 250 * ecran.W + 400;
  assert.deepEqual([...rgba.slice(centre * 4, centre * 4 + 4)], [0, 0, 0, 0]);
});

test('peindreRGBA : une couche déjà en couleurs (ombrage coloré) garde sa couleur ; case invalide, transparente', () => {
  const { u, v } = VUE_IMAGE.cases(geo, ecran, PROJ.versLambert93);
  const k = 250 * ecran.W + 400;
  const cx = Math.round(u[k]), cy = Math.round(v[k]);
  const grille = new Uint8ClampedArray(geo.W * geo.H * 4);
  for (let i = 0; i < geo.W * geo.H; i++) grille.set([10, 200, 30, 255], i * 4);
  grille.set([0, 0, 0, 0], (cy * geo.W + cx) * 4);   // case sans valeur
  const rgba = VUE_IMAGE.peindreRGBA(grille, geo, { u, v }, false);
  assert.deepEqual([...rgba.slice(k * 4, k * 4 + 4)], [0, 0, 0, 0]);
  const loin = 20 * ecran.W + 20;
  assert.deepEqual([...rgba.slice(loin * 4, loin * 4 + 4)], [10, 200, 30, 255]);
});
