// Géométrie du profil topographique (`profil.js`) : la bande, sa validité, la
// mesure sur le graphique. Tout est pur : aucun DOM ici.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { PROFIL, CONFIG } = chargerScripts(['config.js', 'profil.js']);

// Les objets créés dans le contexte `vm` n'ont pas les prototypes de ce
// contexte-ci : `deepEqual` strict les refuserait, on compare leur JSON.
const plat = (v) => JSON.parse(JSON.stringify(v));
const proche = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('axe : longueur et vecteurs unitaires, normale à gauche', () => {
  const ax = PROFIL.axe([0, 0], [3, 4]);
  proche(ax.longueur, 5);
  proche(ax.ux, 0.6); proche(ax.uy, 0.8);
  proche(ax.nx, -0.8); proche(ax.ny, 0.6);
  assert.equal(PROFIL.axe([5, 5], [5, 5]), null);   // confondus : pas d'axe
});

test('largeurValide : bornée, jamais nulle ni infinie (Review Focus 3)', () => {
  const { largeurMinM, largeurMaxM, largeurDefautM } = CONFIG.profil;
  assert.equal(PROFIL.largeurValide(0), largeurMinM);
  assert.equal(PROFIL.largeurValide(-4), largeurMinM);
  assert.equal(PROFIL.largeurValide(500), largeurMaxM);
  assert.equal(PROFIL.largeurValide(Infinity), largeurDefautM);
  assert.equal(PROFIL.largeurValide(NaN), largeurDefautM);
  assert.equal(PROFIL.largeurValide(3), 3);
});

test('verdict : points confondus ou trop longue refusés, avec une consigne (Review Focus 2)', () => {
  assert.equal(PROFIL.verdict([0, 0], [0, 0.5]).ok, false);
  assert.match(PROFIL.verdict([0, 0], [0, 0.5]).raison, /proches/);
  assert.equal(PROFIL.verdict([0, 0], [2500, 0]).ok, false);
  assert.match(PROFIL.verdict([0, 0], [2500, 0]).raison, /2 km/);
  assert.equal(PROFIL.verdict([0, 0], [100, 0]).ok, true);
  assert.equal(PROFIL.verdict([0, 0], [2000, 0]).ok, true);   // pile la limite : permis
});

test('coins : une bande alignée sur X de 4 m de large', () => {
  const c = PROFIL.coins([10, 20], [30, 20], 4);
  const xs = c.map((p) => p[0]).sort((a, b) => a - b);
  const ys = c.map((p) => p[1]).sort((a, b) => a - b);
  assert.deepEqual(plat(xs), [10, 10, 30, 30]);
  assert.deepEqual(plat(ys), [18, 18, 22, 22]);
});

test('coins : bande oblique à 45°, les quatre coins à demi-largeur de l’axe', () => {
  const c = PROFIL.coins([0, 0], [10, 10], 2);
  for (const [x, y] of c) {
    const d = Math.abs((x - y) / Math.SQRT2);      // distance à l’axe y = x
    assert.ok(d < 1 + 1e-9);
  }
  // Les coins de l'extrémité A sont à 1 m de A.
  const pres = c.filter(([x, y]) => Math.hypot(x, y) < 1.5);
  assert.equal(pres.length, 2);
});

test('emprise : la boîte englobante de la bande', () => {
  const e = PROFIL.emprise([10, 20], [30, 20], 4);
  assert.deepEqual(plat(e), { xmin: 10, xmax: 30, ymin: 18, ymax: 22 });
});

test('graduations : des valeurs rondes qui encadrent l’intervalle', () => {
  assert.deepEqual(plat(PROFIL.graduations(0, 100, 5)), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(plat(PROFIL.graduations(139.9, 170.2, 6)), [140, 145, 150, 155, 160, 165, 170]);
  assert.deepEqual(plat(PROFIL.graduations(5, 5)), []);   // intervalle vide : rien
});

test('etendueZ : le tronçon et les classes visibles seulement', () => {
  const d = { n: 4, s: Float32Array.of(0, 10, 20, 30), z: Float32Array.of(100, 130, 105, 200), cls: Uint8Array.of(2, 5, 2, 5) };
  assert.deepEqual(plat(PROFIL.etendueZ(d, 0, 30, null)), { zmin: 100, zmax: 200, n: 4 });
  assert.deepEqual(plat(PROFIL.etendueZ(d, 0, 20, null)), { zmin: 100, zmax: 130, n: 3 });
  assert.deepEqual(plat(PROFIL.etendueZ(d, 0, 30, new Set([2]))), { zmin: 100, zmax: 105, n: 2 });
  assert.equal(PROFIL.etendueZ(d, 0, 30, new Set([9])), null);   // rien de visible
});

test('etendueZ : la tranche latérale ne garde que les points de cette part de la largeur', () => {
  const d = {
    n: 4, s: Float32Array.of(0, 10, 20, 30), z: Float32Array.of(100, 130, 105, 200),
    d: Float32Array.of(-1.5, -0.5, 0.5, 1.5), cls: Uint8Array.of(2, 5, 2, 5),
  };
  assert.deepEqual(plat(PROFIL.etendueZ(d, 0, 30, null, { min: -1, max: 1 })), { zmin: 105, zmax: 130, n: 2 });
  assert.deepEqual(plat(PROFIL.etendueZ(d, 0, 30, null, { min: -2, max: 2 })), { zmin: 100, zmax: 200, n: 4 });
  assert.equal(PROFIL.etendueZ(d, 0, 30, null, { min: 5, max: 6 }), null);   // tranche vide
  // Sans tranche : tout, comme avant.
  assert.equal(PROFIL.etendueZ(d, 0, 30, null).n, 4);
});

test('largeur : le curseur est logarithmique, de 0,5 à 100 m, et se relit sans dérive', () => {
  assert.equal(PROFIL.largeurDepuisCurseur(0), 0.5);
  assert.equal(PROFIL.largeurDepuisCurseur(1000), 100);
  assert.equal(CONFIG.profil.largeurMaxM, 100);
  let precedente = 0;
  for (let t = 0; t <= 1000; t += 50) {
    const w = PROFIL.largeurDepuisCurseur(t);
    assert.ok(w >= precedente, `croissante à ${t}`);
    precedente = w;
  }
  // La moitié du curseur tombe à l'échelle des arbres, pas à 50 m.
  assert.ok(PROFIL.largeurDepuisCurseur(500) < 10);
  // Une largeur retrouve son curseur, et le curseur sa largeur (arrondie).
  for (const w of [0.5, 1, 3, 7.5, 20, 100]) {
    assert.equal(PROFIL.largeurDepuisCurseur(PROFIL.curseurDepuisLargeur(w)), w, `${w} m`);
  }
});

test('pointSuivant : A, puis B, puis un nouveau clic efface et recommence en A', () => {
  const p1 = [1, 1], p2 = [2, 2], p3 = [3, 3];
  assert.deepEqual(plat(PROFIL.pointSuivant(null, null, p1)), { A: p1, B: null });
  assert.deepEqual(plat(PROFIL.pointSuivant(p1, null, p2)), { A: p1, B: p2 });
  // Les deux sont posés : le clic suivant devient le nouveau A, B est vidé.
  assert.deepEqual(plat(PROFIL.pointSuivant(p1, p2, p3)), { A: p3, B: null });
});

test('graduations : zoomé à fond, des valeurs courtes — jamais « 1.2000000000000002 »', () => {
  const g = (min, max, cible) => plat(PROFIL.graduations(min, max, cible));
  assert.deepEqual(g(1, 1.6, 4), [1, 1.2, 1.4, 1.6]);
  assert.deepEqual(g(0, 0.6, 3), [0, 0.2, 0.4, 0.6]);
  assert.deepEqual(g(0.1, 0.5, 4), [0.1, 0.2, 0.3, 0.4, 0.5]);
  // Quel que soit le zoom, aucune valeur ne traîne de décimales d'arrondi.
  for (const [min, max] of [[1, 1.6], [12.31, 12.93], [0.003, 0.05], [-1.7, 0.9], [1500.05, 1500.65], [-0.45, 0.35]]) {
    for (const v of g(min, max, 5)) assert.ok(String(v).length <= 8, `${v} sur [${min}, ${max}]`);
  }
  // Les pas entiers ne changent pas.
  assert.deepEqual(g(0, 100, 5), [0, 20, 40, 60, 80, 100]);
});


// ── Échelles égales : mêmes mètres par pixel en X et en Z ────────────────────

test('etendueEgale — la portée verticale se déduit de l’horizontale, centrée sur zCentre', () => {
  const { PROFIL } = chargerScripts(['profil.js']);
  // 100 m sur 500 px = 0,2 m/px ; 250 px de haut = 50 m de portée verticale.
  const e = PROFIL.etendueEgale(0, 100, 500, 250, 312.5);
  assert.ok(Math.abs((e.zmax - e.zmin) - 50) < 1e-9, `portée ${e.zmax - e.zmin}`);
  assert.ok(Math.abs((e.zmin + e.zmax) / 2 - 312.5) < 1e-9);
});

test('cadrageEgal — tout le profil tient, avec le même nombre de mètres par pixel des deux côtés', () => {
  const { PROFIL } = chargerScripts(['profil.js']);
  // Un profil haut : 100 m de long, 100 m de dénivelé, dans 500 × 250 px. C'est la hauteur qui commande.
  const v = PROFIL.cadrageEgal(100, 300, 400, 500, 250);
  const mx = (v.s1 - v.s0) / 500, mz = (v.z1 - v.z0) / 250;
  assert.ok(Math.abs(mx - mz) < 1e-9, `m/px : ${mx} contre ${mz}`);
  assert.ok(v.s0 <= 0 && v.s1 >= 100, `abscisses ${v.s0}…${v.s1}`);
  assert.ok(v.z0 <= 300 && v.z1 >= 400, `altitudes ${v.z0}…${v.z1}`);
  // Centré : le vide se répartit des deux côtés.
  assert.ok(Math.abs((v.s0 + v.s1) / 2 - 50) < 1e-9);
});

test('cadrageEgal — un profil plat et long : c’est la largeur qui commande, rien ne dépasse', () => {
  const { PROFIL } = chargerScripts(['profil.js']);
  const v = PROFIL.cadrageEgal(100, 300, 310, 500, 250);
  assert.ok(Math.abs(v.s0) < 1e-9 && Math.abs(v.s1 - 100) < 1e-9, `abscisses ${v.s0}…${v.s1}`);
  assert.ok(v.z0 <= 300 && v.z1 >= 310);
});

test('pointSurAxe : la position sur la carte d’un point du graphique (distance s le long de A→B)', () => {
  const ctx = chargerScripts(['config.js', 'profil.js']);
  const A = [10, 20], B = [40, 60];                 // axe de 50 m
  const eq = (p, x, y) => assert.ok(Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9, `${p} au lieu de ${[x, y]}`);
  eq(ctx.PROFIL.pointSurAxe(A, B, 0), 10, 20);
  eq(ctx.PROFIL.pointSurAxe(A, B, 25), 25, 40);
  eq(ctx.PROFIL.pointSurAxe(A, B, 50), 40, 60);
  assert.equal(ctx.PROFIL.pointSurAxe(A, A, 5), null, 'axe nul : pas de position');
});

test('pointSurAxe : avec un écart latéral d, le point est à d mètres à gauche de l’axe (n = gauche de A→B)', () => {
  const ctx = chargerScripts(['config.js', 'profil.js']);
  const eq = (p, x, y) => assert.ok(Math.abs(p[0] - x) < 1e-9 && Math.abs(p[1] - y) < 1e-9, `${p} au lieu de ${[x, y]}`);
  const A = [0, 0], B = [100, 0];                   // axe vers l'est : la gauche est le nord (+y)
  eq(ctx.PROFIL.pointSurAxe(A, B, 30, 5), 30, 5);
  eq(ctx.PROFIL.pointSurAxe(A, B, 30, -2), 30, -2);
  eq(ctx.PROFIL.pointSurAxe(A, B, 30, 0), 30, 0);
  eq(ctx.PROFIL.pointSurAxe(A, B, 30), 30, 0);      // sans d : sur l'axe, comme avant
  const C = [0, 0], D = [0, 100];                   // axe vers le nord : la gauche est l'ouest (-x)
  eq(ctx.PROFIL.pointSurAxe(C, D, 10, 3), -3, 10);
});

test('ecartDepuisCurseur / curseurDepuisEcart : le curseur jaune suit l’échelle du double curseur (1000 = droite, 0 = gauche)', () => {
  const ctx = chargerScripts(['config.js', 'profil.js']);
  const P = ctx.PROFIL;
  assert.equal(P.ecartDepuisCurseur(500, 20), 0);
  assert.equal(P.ecartDepuisCurseur(0, 20), 10);        // tout à gauche : +demi-largeur
  assert.equal(P.ecartDepuisCurseur(1000, 20), -10);
  assert.equal(P.curseurDepuisEcart(0, 20), 500);
  assert.equal(P.curseurDepuisEcart(10, 20), 0);
  assert.equal(P.curseurDepuisEcart(-10, 20), 1000);
  assert.equal(P.curseurDepuisEcart(99, 20), 0, 'hors bande : ramené au bord');
  assert.equal(P.curseurDepuisEcart(-99, 20), 1000);
  assert.equal(P.ecartBorne(8, 10), 5, 'après une largeur réduite à 10 m, 8 m ressort de la bande');
  assert.equal(P.ecartBorne(-8, 10), -5);
  assert.equal(P.ecartBorne(2, 10), 2);
});

test('pointsLocaux : la chaîne du profil en points de la mesure, sur l’axe décalé de d, avec l’altitude lue au graphique', () => {
  const { PROFIL } = chargerScripts(['config.js', 'profil.js']);
  const A = [0, 0], B = [100, 0];
  const pts = PROFIL.pointsLocaux(A, B, [{ s: 10, z: 300.5 }, { s: 40, z: 312 }], 2);
  assert.equal(JSON.stringify(pts), JSON.stringify([{ x: 10, y: 2, sol: 300.5, hauteur: 0 }, { x: 40, y: 2, sol: 312, hauteur: 0 }]));
  assert.equal(JSON.stringify(PROFIL.pointsLocaux(A, B, [], 0)), '[]');
  assert.equal(JSON.stringify(PROFIL.pointsLocaux(A, A, [{ s: 1, z: 1 }], 0)), '[]', 'axe nul : aucune position');
});
