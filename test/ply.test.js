// Écriture d'un nuage en PLY binaire (`ply.js`).
//
// Le lecteur ci-dessous est écrit ici d'après la spécification PLY et d'après
// ce qu'exige le lecteur de FreeCAD (`PlyReader`, Mod/Points) : en-tête ASCII,
// `format binary_little_endian 1.0`, propriétés lues dans l'ordre déclaré. Il
// ne reprend rien de `ply.js`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { PLY } = chargerScripts(['ply.js']);

function assembler(parties) {
  const total = parties.reduce((s, p) => s + p.byteLength, 0);
  const tout = new Uint8Array(total);
  let o = 0;
  for (const p of parties) { tout.set(p, o); o += p.byteLength; }
  return tout;
}

const TAILLES = { float: 4, uchar: 1 };

/** Lit l'en-tête ASCII puis les sommets, propriétés dans l'ordre déclaré. */
function lire(octets) {
  const fin = 'end_header\n';
  const texte = Buffer.from(octets).toString('latin1');
  const iFin = texte.indexOf(fin);
  assert.ok(iFin > 0, 'end_header présent');
  const lignes = texte.slice(0, iFin).split('\n');
  const h = { lignes, proprietes: [], nb: 0, format: '' };
  for (const l of lignes) {
    const m = l.split(' ');
    if (m[0] === 'format') h.format = `${m[1]} ${m[2]}`;
    if (m[0] === 'element' && m[1] === 'vertex') h.nb = Number(m[2]);
    if (m[0] === 'property') h.proprietes.push({ type: m[1], nom: m[2] });
  }
  const debut = iFin + fin.length;
  const v = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const longueur = h.proprietes.reduce((s, p) => s + TAILLES[p.type], 0);
  const points = [];
  for (let i = 0; i < h.nb; i++) {
    let o = debut + i * longueur;
    const p = {};
    for (const { type, nom } of h.proprietes) {
      p[nom] = type === 'float' ? v.getFloat32(o, true) : v.getUint8(o);
      o += TAILLES[type];
    }
    points.push(p);
  }
  return { h, points, debut, longueur, total: octets.byteLength };
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
  [0.0, 999.99, 12.5, 64],
  [500.5, 0.5, 7.77, 66],
];

test('en-tête : ply, binaire petit-boutiste 1.0, x y z puis la classe', () => {
  const { h, debut } = lire(assembler(PLY.ecrire(nuage(PTS)).parties));
  assert.equal(h.lignes[0], 'ply');
  assert.equal(h.format, 'binary_little_endian 1.0');   // FreeCAD refuse toute autre version
  assert.equal(h.nb, 4);
  assert.deepEqual(h.proprietes, [
    { type: 'float', nom: 'x' }, { type: 'float', nom: 'y' }, { type: 'float', nom: 'z' },
    { type: 'uchar', nom: 'classification' },
  ]);
  assert.ok(debut > 0);
});

test('positions et classes conservées, y compris 64 et 66', () => {
  const { points } = lire(assembler(PLY.ecrire(nuage(PTS)).parties));
  points.forEach((p, i) => {
    assert.ok(Math.abs(p.x - PTS[i][0]) < 1e-4, `x ${i}`);
    assert.ok(Math.abs(p.y - PTS[i][1]) < 1e-3, `y ${i}`);
    assert.ok(Math.abs(p.z - PTS[i][2]) < 1e-4, `z ${i}`);
    assert.equal(p.classification, PTS[i][3], `classe ${i}`);
  });
});

test('classes exclues : absentes du fichier, compte de l’en-tête recalculé', () => {
  const r = PLY.ecrire(nuage(PTS), new Set([6, 64]));
  const { h, points } = lire(assembler(r.parties));
  assert.equal(r.n, 2);
  assert.equal(h.nb, 2);
  assert.deepEqual(points.map((p) => p.classification), [2, 66]);
});

test('tout exclu : un en-tête valide, zéro sommet', () => {
  const r = PLY.ecrire(nuage(PTS), new Set([2, 6, 64, 66]));
  const o = assembler(r.parties);
  const { h, debut } = lire(o);
  assert.equal(r.n, 0);
  assert.equal(h.nb, 0);
  assert.equal(o.byteLength, debut);
});

test('compter annonce exactement la taille du fichier écrit', () => {
  for (const exclues of [undefined, new Set([6]), new Set([2, 6, 64, 66])]) {
    const c = PLY.compter(nuage(PTS), exclues);
    const r = PLY.ecrire(nuage(PTS), exclues);
    assert.equal(c.n, r.n);
    assert.equal(c.octets, assembler(r.parties).byteLength);
    assert.equal(r.octets, c.octets);
  }
});

test('13 octets par point : 3 flottants et la classe', () => {
  const a = PLY.compter(nuage(PTS)), b = PLY.compter(nuage(PTS.slice(0, 3)));
  assert.equal(a.octets - b.octets, 13);
});

test('un nuage plus grand qu’une partie garde tous ses points dans l’ordre', () => {
  const n = 150_000;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([i % 977, (i * 7) % 1013, (i % 50) / 2, [2, 6, 64][i % 3]]);
  const r = PLY.ecrire(nuage(pts));
  assert.ok(r.parties.length > 2, 'en-tête + plusieurs parties');
  const { h, points } = lire(assembler(r.parties));
  assert.equal(h.nb, n);
  for (const i of [0, 1, 65_535, 65_536, 65_537, 131_072, n - 1]) {
    assert.ok(Math.abs(points[i].x - pts[i][0]) < 1e-4, `x ${i}`);
    assert.equal(points[i].classification, pts[i][3], `classe ${i}`);
  }
});

test('l’en-tête est de l’ASCII pur (la spec PLY ne prévoit rien d’autre)', () => {
  const o = assembler(PLY.ecrire(nuage(PTS)).parties);
  const fin = Buffer.from(o).indexOf('end_header\n');
  assert.ok(fin > 0);
  for (let i = 0; i < fin; i++) assert.ok(o[i] < 0x80, `octet non ASCII à la position ${i}`);
});
