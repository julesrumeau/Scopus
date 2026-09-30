// Écriture d'un nuage en LAS 1.4, format 6 (`las.js`).
//
// Le lecteur ci-dessous est écrit ici, d'après la spécification ASPRS LAS 1.4
// R15 (positions d'octets de l'en-tête et de l'enregistrement de point 6), et
// non recopié de `las.js` : un test qui rejoue la convention du code n'éprouve
// rien.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { LAS } = chargerScripts(['las.js']);

function assembler(parties) {
  const total = parties.reduce((s, p) => s + p.byteLength, 0);
  const tout = new Uint8Array(total);
  let o = 0;
  for (const p of parties) { tout.set(p, o); o += p.byteLength; }
  return tout;
}

/** Lecture indépendante : en-tête et points, d'après la spec. */
function lire(octets) {
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const h = {
    signature: String.fromCharCode(...octets.subarray(0, 4)),
    versionMajeure: v.getUint8(24), versionMineure: v.getUint8(25),
    tailleEntete: v.getUint16(94, true),
    debutPoints: v.getUint32(96, true),
    nbVLR: v.getUint32(100, true),
    format: v.getUint8(104),
    longueur: v.getUint16(105, true),
    nbLegacy: v.getUint32(107, true),
    echelle: [v.getFloat64(131, true), v.getFloat64(139, true), v.getFloat64(147, true)],
    decalage: [v.getFloat64(155, true), v.getFloat64(163, true), v.getFloat64(171, true)],
    xmax: v.getFloat64(179, true), xmin: v.getFloat64(187, true),
    ymax: v.getFloat64(195, true), ymin: v.getFloat64(203, true),
    zmax: v.getFloat64(211, true), zmin: v.getFloat64(219, true),
    nbEVLR: v.getUint32(243, true),
    nb: Number(v.getBigUint64(247, true)),
    parRetour1: Number(v.getBigUint64(255, true)),
  };
  const points = [];
  for (let i = 0; i < h.nb; i++) {
    const o = h.debutPoints + i * h.longueur;
    points.push({
      x: v.getInt32(o, true) * h.echelle[0] + h.decalage[0],
      y: v.getInt32(o + 4, true) * h.echelle[1] + h.decalage[1],
      z: v.getInt32(o + 8, true) * h.echelle[2] + h.decalage[2],
      retour: v.getUint8(o + 14),
      cls: v.getUint8(o + 16),
    });
  }
  return { h, points };
}

function nuage(pts) {
  return {
    n: pts.length,
    x: Float32Array.from(pts.map((p) => p[0])),
    y: Float32Array.from(pts.map((p) => p[1])),
    z: Float32Array.from(pts.map((p) => p[2])),
    cls: Uint8Array.from(pts.map((p) => p[3])),
  };
}

const PTS = [
  [1.25, 2.5, 0.0, 2],
  [10.01, 20.02, 3.33, 6],
  [0.0, 999.99, 12.5, 64],   // 64 : sursol pérenne, hors des 32 classes des formats 0 à 5
  [500.5, 0.5, 7.77, 66],
];

test('en-tête LAS 1.4, format 6, points juste après lui', () => {
  const { h } = lire(assembler(LAS.ecrire(nuage(PTS)).parties));
  assert.equal(h.signature, 'LASF');
  assert.equal(h.versionMajeure, 1);
  assert.equal(h.versionMineure, 4);
  assert.equal(h.tailleEntete, 375);
  assert.equal(h.debutPoints, 375);
  assert.equal(h.nbVLR, 0);
  assert.equal(h.nbEVLR, 0);
  assert.equal(h.format, 6);
  assert.equal(h.longueur, 30);
  assert.equal(h.nbLegacy, 0);   // interdit d'y compter les points d'un format 6 et plus
  assert.deepEqual(h.echelle, [0.01, 0.01, 0.01]);
  assert.deepEqual(h.decalage, [0, 0, 0]);
});

test('positions au centimètre et classes conservées, y compris 64 et 66', () => {
  const { h, points } = lire(assembler(LAS.ecrire(nuage(PTS)).parties));
  assert.equal(h.nb, 4);
  points.forEach((p, i) => {
    assert.ok(Math.abs(p.x - PTS[i][0]) < 0.006, `x ${i}`);
    assert.ok(Math.abs(p.y - PTS[i][1]) < 0.006, `y ${i}`);
    assert.ok(Math.abs(p.z - PTS[i][2]) < 0.006, `z ${i}`);
    assert.equal(p.cls, PTS[i][3], `classe ${i}`);
  });
});

test('boîte englobante de l’en-tête = celle des points écrits', () => {
  const { h } = lire(assembler(LAS.ecrire(nuage(PTS)).parties));
  assert.ok(Math.abs(h.xmin - 0) < 0.006 && Math.abs(h.xmax - 500.5) < 0.006);
  assert.ok(Math.abs(h.ymin - 0.5) < 0.006 && Math.abs(h.ymax - 999.99) < 0.006);
  assert.ok(Math.abs(h.zmin - 0) < 0.006 && Math.abs(h.zmax - 12.5) < 0.006);
});

test('chaque point est un premier retour sur un seul (numéro de retour non nul)', () => {
  const { h, points } = lire(assembler(LAS.ecrire(nuage(PTS)).parties));
  assert.equal(h.parRetour1, 4);
  for (const p of points) assert.equal(p.retour, 0x11);
});

test('classes exclues : absentes du fichier, compte et boîte recalculés', () => {
  const r = LAS.ecrire(nuage(PTS), new Set([6, 64]));
  const { h, points } = lire(assembler(r.parties));
  assert.equal(r.n, 2);
  assert.equal(h.nb, 2);
  assert.equal(h.parRetour1, 2);
  assert.deepEqual(points.map((p) => p.cls), [2, 66]);
  // Restent (1,25 ; 2,5 ; 0) et (500,5 ; 0,5 ; 7,77) : la boîte ignore les exclus.
  assert.ok(Math.abs(h.ymax - 2.5) < 0.006, 'ymax');
  assert.ok(Math.abs(h.xmax - 500.5) < 0.006, 'xmax');
  assert.ok(Math.abs(h.zmax - 7.77) < 0.006, 'zmax');
});

test('tout exclu : un en-tête valide, zéro point', () => {
  const r = LAS.ecrire(nuage(PTS), new Set([2, 6, 64, 66]));
  const o = assembler(r.parties);
  const { h } = lire(o);
  assert.equal(r.n, 0);
  assert.equal(h.nb, 0);
  assert.equal(o.byteLength, 375);
  assert.ok(Number.isFinite(h.xmin) && Number.isFinite(h.zmax));
});

test('compter annonce exactement la taille du fichier écrit', () => {
  for (const exclues of [undefined, new Set([6]), new Set([2, 6, 64, 66])]) {
    const c = LAS.compter(nuage(PTS), exclues);
    const r = LAS.ecrire(nuage(PTS), exclues);
    assert.equal(c.n, r.n);
    assert.equal(c.octets, assembler(r.parties).byteLength);
    assert.equal(r.octets, c.octets);
  }
});

test('un nuage plus grand qu’une partie garde tous ses points dans l’ordre', () => {
  const n = 150_000;   // plusieurs parties
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([i % 977, (i * 7) % 1013, (i % 50) / 2, [2, 6, 64][i % 3]]);
  const r = LAS.ecrire(nuage(pts));
  assert.ok(r.parties.length > 2, 'header + plusieurs parties');
  const { h, points } = lire(assembler(r.parties));
  assert.equal(h.nb, n);
  for (const i of [0, 1, 65_535, 65_536, 65_537, 131_072, n - 1]) {
    assert.ok(Math.abs(points[i].x - pts[i][0]) < 0.006, `x ${i}`);
    assert.equal(points[i].cls, pts[i][3], `classe ${i}`);
  }
});
