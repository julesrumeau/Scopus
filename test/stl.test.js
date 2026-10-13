// Export STL de la surface du relief, pour l'impression 3D : une grille d'altitudes devient un solide fermé (dessus, quatre
// murs, dessous), sans trou ni arête libre. La fermeture se vérifie sur le maillage lui-même : chaque arête orientée est
// partagée par exactement deux triangles, parcourue une fois dans chaque sens.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { STL } = chargerScripts(['stl.js']);

const grille = (W, H, f) => { const z = new Float32Array(W * H); for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) z[j * W + i] = f(i, j); return z; };

/** Arêtes orientées d'un maillage : 'x,y,z>x,y,z' → nombre de fois. */
function aretes(m) {
  const cle = (k) => `${m.sommets[3 * k]},${m.sommets[3 * k + 1]},${m.sommets[3 * k + 2]}`;
  const out = new Map();
  for (let t = 0; t < m.nbTriangles; t++) {
    const s = [m.triangles[3 * t], m.triangles[3 * t + 1], m.triangles[3 * t + 2]];
    for (let e = 0; e < 3; e++) { const k = `${cle(s[e])}>${cle(s[(e + 1) % 3])}`; out.set(k, (out.get(k) || 0) + 1); }
  }
  return out;
}

function ferme(m) {
  const a = aretes(m);
  for (const [k, n] of a) {
    if (n !== 1) return `arête ${k} parcourue ${n} fois dans ce sens`;
    const [p, q] = k.split('>');
    if (a.get(`${q}>${p}`) !== 1) return `arête ${k} sans retour`;
  }
  return '';
}

/** Volume signé (positif si les normales sortent) : somme des tétraèdres depuis l'origine. */
function volume(m) {
  let v = 0;
  for (let t = 0; t < m.nbTriangles; t++) {
    const [a, b, c] = [0, 1, 2].map((e) => { const k = m.triangles[3 * t + e]; return [m.sommets[3 * k], m.sommets[3 * k + 1], m.sommets[3 * k + 2]]; });
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}

test('maillage : un relief quelconque donne un solide fermé, sans arête libre', () => {
  const z = grille(7, 5, (i, j) => 100 + Math.sin(i) * 3 + j);
  const m = STL.maillage({ z, W: 7, H: 5, pas: 2, epaisseurM: 4 });
  assert.equal(ferme(m), '');
});

test('maillage : le nombre de triangles est celui qu’annonce compter()', () => {
  const W = 7, H = 5;
  const m = STL.maillage({ z: grille(W, H, () => 10), W, H, pas: 1, epaisseurM: 2 });
  assert.equal(m.nbTriangles, STL.compter(W, H).triangles);
  // dessus 2(W-1)(H-1) + murs 2·2(W-1) + 2·2(H-1) + dessous en éventail 2(W+H-2)
  assert.equal(STL.compter(W, H).triangles, 2 * 6 * 4 + 4 * 6 + 4 * 4 + 2 * (7 + 5 - 2));
});

test('maillage : le volume d’une plaque plate est sa surface par son épaisseur totale, les normales sortent', () => {
  const W = 5, H = 4;   // 4 m sur 3 m
  const m = STL.maillage({ z: grille(W, H, () => 50), W, H, pas: 1, epaisseurM: 2 });
  assert.ok(Math.abs(volume(m) - 4 * 3 * 2) < 1e-6, `volume ${volume(m)}`);
});

test('maillage : le dessous est plat, à l’épaisseur demandée sous le point le plus bas', () => {
  const z = grille(4, 4, (i, j) => 100 + i * 5 + j);   // de 100 à 118
  const m = STL.maillage({ z, W: 4, H: 4, pas: 1, epaisseurM: 3 });
  let zmin = Infinity, zmax = -Infinity;
  for (let k = 2; k < m.sommets.length; k += 3) { zmin = Math.min(zmin, m.sommets[k]); zmax = Math.max(zmax, m.sommets[k]); }
  assert.equal(zmin, 0, 'le dessous est à 0 (repère de la maquette)');
  assert.ok(Math.abs(zmax - (118 - 100 + 3)) < 1e-4, `sommet ${zmax}`);
});

test('combler : une case sans donnée est remplie par ses voisines, rien ne reste en NaN', () => {
  const z = grille(5, 5, (i, j) => 10 + i);
  z[2 * 5 + 2] = NaN; z[2 * 5 + 3] = NaN; z[0] = NaN;
  const r = STL.combler(z, 5, 5);
  assert.equal(r.remplies, 3);
  for (const v of r.z) assert.ok(Number.isFinite(v));
  assert.ok(Math.abs(r.z[2 * 5 + 2] - 12) < 1.1, `${r.z[12]}`);
  assert.ok(Number.isNaN(z[12]), 'l’entrée n’est pas modifiée');
});

test('combler : un grand trou, et une grille entièrement vide, ne laissent pas de NaN', () => {
  const z = grille(9, 9, () => NaN);
  for (let i = 0; i < 9; i++) z[i] = 5;      // une seule rangée connue
  const r = STL.combler(z, 9, 9);
  for (const v of r.z) assert.ok(Number.isFinite(v));
  assert.equal(STL.combler(grille(3, 3, () => NaN), 3, 3).z.every((v) => v === 0), true, 'rien de connu : plat à 0');
});

test('reduire : une grille trop grande est ramenée par moyenne de blocs sous la limite, le pas suit', () => {
  const z = grille(10, 6, (i, j) => i + j);
  const r = STL.reduire(z, 10, 6, 1, 5);
  assert.ok(r.W <= 5 && r.H <= 5);
  assert.equal(r.facteur, 2);
  assert.ok(Math.abs(r.pas - 2) < 1e-9);
  const meme = STL.reduire(z, 10, 6, 1, 50);
  assert.equal(meme.facteur, 1); assert.equal(meme.W, 10);
});

test('ecrire : STL binaire : en-tête de 80 octets, nombre de triangles, 50 octets chacun, normales unitaires', () => {
  const m = STL.maillage({ z: grille(4, 3, (i, j) => 10 + i * j), W: 4, H: 3, pas: 1, epaisseurM: 1 });
  const e = STL.ecrire(m, { echelle: 1 });
  const total = e.parties.reduce((a, p) => a + p.byteLength, 0);
  assert.equal(total, 84 + 50 * m.nbTriangles);
  assert.equal(e.octets, total);
  const tout = new Uint8Array(total); let o = 0; for (const p of e.parties) { tout.set(p, o); o += p.byteLength; }
  const v = new DataView(tout.buffer);
  assert.equal(v.getUint32(80, true), m.nbTriangles);
  for (let t = 0; t < m.nbTriangles; t++) {
    const nx = v.getFloat32(84 + 50 * t, true), ny = v.getFloat32(88 + 50 * t, true), nz = v.getFloat32(92 + 50 * t, true);
    assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-5, `normale ${t}`);
    assert.equal(v.getUint16(84 + 50 * t + 48, true), 0);
  }
  assert.ok(!/solid/.test(new TextDecoder().decode(tout.subarray(0, 5))), 'un STL binaire ne commence pas par « solid »');
});

test('ecrire : de gros maillages partent en plusieurs parties, jamais un tampon de la taille du fichier', () => {
  const W = 300, H = 300;
  const m = STL.maillage({ z: grille(W, H, (i, j) => i + j), W, H, pas: 1, epaisseurM: 1 });
  const e = STL.ecrire(m, { echelle: 1 });
  assert.ok(e.parties.length > 3);
  assert.ok(e.parties.every((p) => p.byteLength <= 4_000_000));
});

test('ecrire : l’échelle convertit des mètres en millimètres de la maquette', () => {
  const m = STL.maillage({ z: grille(3, 3, () => 0), W: 3, H: 3, pas: 10, epaisseurM: 5 });   // 20 m de côté
  const e = STL.ecrire(m, { echelle: 5 });   // 1 m = 5 mm
  const tout = new Uint8Array(e.octets); let o = 0; for (const p of e.parties) { tout.set(p, o); o += p.byteLength; }
  const v = new DataView(tout.buffer);
  let xmax = -Infinity;
  for (let t = 0; t < m.nbTriangles; t++) for (let s = 0; s < 3; s++) xmax = Math.max(xmax, v.getFloat32(84 + 50 * t + 12 + 12 * s, true));
  assert.ok(Math.abs(xmax - 100) < 1e-3, `largeur ${xmax} mm`);
});

test('echelleDepuisLargeur : la largeur de la maquette en mm fixe l’échelle', () => {
  assert.equal(STL.echelleDepuisLargeur(200, 150), 0.75);
});

test('résumé : tailles et poids annoncés avant le téléchargement, en français, sans tiret cadratin', () => {
  const s = STL.resume({ W: 600, H: 400, pas: 0.5, largeurMm: 150 });
  assert.equal(s.triangles, STL.compter(600, 400).triangles);
  assert.ok(s.octets > 84);
  assert.ok(!/—/.test(JSON.stringify(s)));
  assert.match(s.texte, /Mo|Ko/);
});

test('preparer : réduit, comble, et annonce ; construire donne un STL fermé à l’échelle de la maquette', () => {
  const W = 40, H = 30;
  const z = grille(W, H, (i, j) => 300 + i * 0.5 + j * 0.2);
  z[5 * W + 5] = NaN; z[6 * W + 5] = NaN;
  const p = STL.preparer({ z, W, H, pas: 0.5 }, { largeurMm: 100, epaisseurMm: 3, maxCotes: 20 });
  assert.ok(p.W <= 20 && p.H <= 20, `${p.W} x ${p.H}`);
  assert.ok(p.remplies >= 0);
  assert.ok(p.z.every((v) => Number.isFinite(v)));
  assert.match(p.resume.texte, /triangles/);
  const s = STL.construire(p);
  assert.equal(s.octets, 84 + 50 * STL.compter(p.W, p.H).triangles);
  // La maquette fait la largeur demandée : x maximal = 100 mm.
  const tout = new Uint8Array(s.octets); let o = 0; for (const q of s.parties) { tout.set(q, o); o += q.byteLength; }
  const v = new DataView(tout.buffer);
  let xmax = -Infinity, zmax = -Infinity;
  for (let t = 0; t < p.maillage.nbTriangles; t++) for (let k = 0; k < 3; k++) { xmax = Math.max(xmax, v.getFloat32(84 + 50 * t + 12 + 12 * k, true)); zmax = Math.max(zmax, v.getFloat32(84 + 50 * t + 20 + 12 * k, true)); }
  assert.ok(Math.abs(xmax - 100) < 1e-2, `largeur ${xmax}`);
  assert.ok(zmax > 3, `hauteur ${zmax}`);
});

test('preparer : une grille de moins de deux cases par côté est refusée en clair', () => {
  assert.throws(() => STL.preparer({ z: new Float32Array(1), W: 1, H: 1, pas: 1 }, { largeurMm: 100, epaisseurMm: 3, maxCotes: 500 }), /trop petite/);
});
