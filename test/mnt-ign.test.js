// MNT de l'IGN en WMS : adresse de la requête et lecture de l'image BIL.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { MNT_IGN, VUE_GRILLE } = chargerScripts(['config.js', 'vue-grille.js', 'mnt-ign.js']);

const geo = VUE_GRILLE.definir({ xmin: 877000, xmax: 877002, ymin: 6904000, ymax: 6904001.5 }, 0.5, 0, 5010);

test('adresse : Lambert-93, emprise et taille de la grille', () => {
  const u = new URL(MNT_IGN.url(geo));
  assert.equal(u.searchParams.get('CRS'), 'EPSG:2154');
  assert.equal(u.searchParams.get('BBOX'), `${geo.emprise.xmin},${geo.emprise.ymin},${geo.emprise.xmax},${geo.emprise.ymax}`);
  assert.equal(u.searchParams.get('WIDTH'), String(geo.W));
  assert.equal(u.searchParams.get('HEIGHT'), String(geo.H));
  assert.equal(u.searchParams.get('FORMAT'), 'image/x-bil;bits=32');
});

test('lecture : petit-boutiste, ligne 0 au nord ramenée au sud, -9999 invalide', () => {
  const { W, H } = geo;   // 4 × 3
  const dv = new DataView(new ArrayBuffer(W * H * 4));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dv.setFloat32((y * W + x) * 4, 300 + y * 10 + x, true);
  dv.setFloat32(0, -9999, true);   // coin nord-ouest sans donnée
  const t = MNT_IGN.lire(dv.buffer, geo);
  assert.equal(t.W, W);
  assert.equal(t.mnt[0], 300 + (H - 1) * 10);   // ligne sud = dernière ligne de l'image
  const no = (H - 1) * W;                      // coin nord-ouest de la grille
  assert.equal(t.valide[no], 0);
  assert.ok(Number.isFinite(t.mnt[no]));
  assert.equal(t.valide[no + 1], 1);
  assert.equal(t.mnt[no + 1], 301);
  assert.equal(t.hauteur.length, W * H);
});

test('lecture : taille inattendue, erreur explicite', () => {
  assert.throws(() => MNT_IGN.lire(new ArrayBuffer(8), geo), /MNT/);
});

test('lecture : accepte le Uint8Array que rend RESEAU.recuperer, même décalé dans son tampon', () => {
  const { W, H } = geo;
  const tampon = new ArrayBuffer(W * H * 4 + 8);
  const dv = new DataView(tampon, 8);
  for (let i = 0; i < W * H; i++) dv.setFloat32(i * 4, 500 + i, true);
  const t = MNT_IGN.lire(new Uint8Array(tampon, 8), geo);
  assert.equal(t.mnt[(H - 1) * W], 500);   // premier pixel de l'image = coin nord-ouest
});
