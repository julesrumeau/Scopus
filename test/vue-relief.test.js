// Relief de la vue au processeur : blocs reçus → grille → terrain → surface →
// couche. Le chemin de la carte graphique (gpu-relief.js) est comparé à
// celui-ci par l'autocontrôle, dans le navigateur.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { VUE_RELIEF, VUE_GRILLE, RASTER, RELIEF } = chargerScripts(
  ['config.js', 'vue-grille.js', 'raster.js', 'relief.js', 'profil.js', 'vue-relief.js']);

/** Bloc d'une dalle au coin (x0, y0) en mètres : un plan à 300 m, une bosse, des points tous les 25 cm. */
function bloc(cle, x0, y0, { cote = 60, pasCm = 25, zBase = 30000 } = {}) {
  const n = (cote * 100 / pasCm) ** 2;
  const xc = new Int32Array(n), yc = new Int32Array(n), zc = new Int32Array(n), cls = new Uint8Array(n);
  const intensite = new Uint16Array(n);
  let k = 0;
  for (let y = 0; y < cote * 100; y += pasCm) {
    for (let x = 0; x < cote * 100; x += pasCm) {
      const bosse = 80 * Math.exp(-(((x - 3000) ** 2 + (y - 3000) ** 2) / 2e5));
      xc[k] = x; yc[k] = y; zc[k] = zBase + Math.round(x * 0.05 + bosse); cls[k] = 2; intensite[k] = k % 65536; k++;
    }
  }
  return { cle, emprise: { xmin: x0, ymin: y0, xmax: x0 + cote, ymax: y0 + cote }, origineCm: [x0 * 100, y0 * 100, 0], points: { nbPoints: n, xc, yc, zc, cls, intensite } };
}

const vue = { xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2060 };
const geo = VUE_GRILLE.definir(vue, 0.5, 0, 4096);

test('sans bloc, rien à calculer', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  assert.equal(m.surface(geo), null);
  assert.equal(m.calculer(geo, 'ombrage'), null);
});

test('la surface de la vue est celle de la chaîne de référence', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  const b = bloc('a', 1000, 2000);
  m.ajouter(b);
  const t = m.surface(geo);
  assert.equal(t.W, geo.W);
  assert.equal(t.H, geo.H);

  const r = VUE_RELIEF.reglagesDefaut(geo.pas);
  const g = RASTER.creerGrillesVue(geo, 30000 - 100, r.classesSol);
  RASTER.accumuler(g, { ...b.points, origineCm: b.origineCm });
  RASTER.finaliser(g, { moteur: 'cpu', passes: r.passes, rayonLissage: r.rayonLissage });
  const ref = RELIEF.preparer(g, { moteur: 'cpu', pasM: geo.pas, garderRepli: true });
  let ecart = 0;
  for (let i = 0; i < t.N; i++) ecart = Math.max(ecart, Math.abs(t.mnt[i] - ref.mnt[i]));
  assert.ok(ecart < 1e-6, `écart ${ecart}`);
});

test('une couche se calcule et porte sa géométrie', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const c = m.calculer(geo, 'ombrage');
  assert.equal(c.valeurs.length, geo.W * geo.H);
  assert.equal(c.moteurSurface, 'cpu');
  assert.ok(Number.isFinite(c.min) && Number.isFinite(c.max));
  assert.equal(c.geo, geo);
});

test('un bloc hors de la grille n’est pas rangé', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('loin', 5000, 5000));
  assert.equal(m.surface(geo), null);
});

test('retirer un bloc change la surface', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const avant = m.surface(geo);
  m.retirer('a');
  assert.equal(m.taille(), 0);
  assert.equal(m.surface(geo), null);
  assert.ok(avant);
});

test('la surface est mémoïsée, et recalculée quand les réglages changent', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const t1 = m.surface(geo);
  assert.equal(m.surface(geo), t1);
  m.reglages({ classesSol: new Set([9]) });   // plus aucun sol
  const t2 = m.surface(geo);
  assert.notEqual(t2, t1);
  assert.equal(t2.valide.reduce((s, v) => s + v, 0), 0);
});

test('deux dalles d’altitudes très différentes tiennent dans la même grille', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('bas', 1000, 2000, { cote: 30, zBase: 20000 }));
  m.ajouter(bloc('haut', 1030, 2000, { cote: 30, zBase: 80000 }));
  const t = m.surface(VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 0.5, 0, 4096));
  const i = 10 * t.W + 5, j = 10 * t.W + 100;
  assert.ok(t.mnt[j] - t.mnt[i] > 590, `${t.mnt[i]} → ${t.mnt[j]}`);
});

/** Même surface, champ par champ. */
function memeSurface(a, b) {
  assert.equal(a.N, b.N);
  for (const champ of ['mnt', 'valide', 'hauteur', 'trou']) {
    for (let i = 0; i < a.N; i++) {
      const x = a[champ][i], y = b[champ][i];
      assert.ok(x === y || (Number.isNaN(x) && Number.isNaN(y)), `${champ}[${i}] : ${x} ≠ ${y}`);
    }
  }
}

function reference(blocs, geo) {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  for (const b of blocs) m.ajouter(b);
  return m.surface(geo);
}

test('rangement incrémental : ajouter un bloc à une grille gardée, comme tout ranger', () => {
  const b1 = bloc('a', 1000, 2000, { cote: 30 }), b2 = bloc('b', 1030, 2000, { cote: 30 });
  const g = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 0.5, 0, 4096);
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(b1);
  m.surface(g);
  m.ajouter(b2);
  m.statistiques(true);
  const t = m.surface(g);
  assert.deepEqual({ ...m.statistiques() }, { reconstructions: 0, decalages: 0, ajouts: 1 });
  memeSurface(t, reference([b1, b2], g));
});

test('rangement incrémental : une vue décalée de quelques cases, comme tout ranger', () => {
  const b1 = bloc('a', 1000, 2000);
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(b1);
  m.surface(VUE_GRILLE.definir({ xmin: 1005, xmax: 1045, ymin: 2005, ymax: 2045 }, 0.5, 0, 4096));
  m.statistiques(true);
  const g2 = VUE_GRILLE.definir({ xmin: 1008.3, xmax: 1048.3, ymin: 2003.1, ymax: 2043.1 }, 0.5, 0, 4096);
  const t = m.surface(g2);
  assert.equal(m.statistiques().decalages, 1);
  assert.equal(m.statistiques().reconstructions, 0);
  memeSurface(t, reference([b1], g2));
});

test('un bloc rangé puis retiré : reconstruction, ses points ne restent pas dans le minimum', () => {
  const b1 = bloc('a', 1000, 2000, { cote: 30 }), b2 = bloc('b', 1030, 2000, { cote: 30 });
  const g = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 0.5, 0, 4096);
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(b1); m.ajouter(b2);
  m.surface(g);
  m.retirer('b');
  m.statistiques(true);
  const t = m.surface(g);
  assert.equal(m.statistiques().reconstructions, 1);
  memeSurface(t, reference([b1], g));
});

test('une grille neuve ne prend que les blocs actifs ; un bloc déjà rangé y reste', () => {
  const b1 = bloc('a', 1000, 2000, { cote: 30 }), b2 = bloc('b', 1030, 2000, { cote: 30 });
  const g = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 0.5, 0, 4096);
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(b1); m.ajouter(b2);
  memeSurface(m.surface(g, new Set(['a'])), reference([b1], g));
  const g1 = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 1, 0, 4096);   // autre pas : grille neuve
  memeSurface(m.surface(g1, new Set(['a'])), reference([b1], g1));
});

test('classes présentes dans les blocs gardés', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  const b = bloc('a', 1000, 2000, { cote: 10 });
  b.points.cls[0] = 6; b.points.cls[1] = 6; b.points.cls[2] = 1;
  m.ajouter(b);
  assert.equal(JSON.stringify(m.classes()), JSON.stringify([[1, 1], [2, b.points.nbPoints - 3], [6, 2]]));
  m.retirer('a');
  assert.equal(m.classes().length, 0);
});

test('changer le contraste ne recalcule pas la couche', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const c1 = m.calculer(geo, 'svf', { contraste: 1 });
  const c2 = m.calculer(geo, 'svf', { contraste: 3 });
  assert.equal(c1.recalcul, true);
  assert.equal(c2.recalcul, false);
  assert.equal(c2.valeurs, c1.valeurs);
  assert.ok(c2.max - c2.min < c1.max - c1.min);
});

test('le mémo garde les six couches les plus récemment lues, pas toutes', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const reglages = (d) => ({ couche: { svfDirections: d } });
  for (const d of [4, 5, 6, 7, 8, 9]) m.calculer(geo, 'svf', reglages(d));
  assert.equal(m.calculer(geo, 'svf', reglages(4)).recalcul, false);
  m.calculer(geo, 'svf', reglages(10));   // la septième lâche la plus ancienne
  assert.equal(m.calculer(geo, 'svf', reglages(5)).recalcul, true);
});

test('ombrage coloré : une couche en couleurs, que le contraste ne touche pas', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const c = m.calculer(geo, 'ombrage-rgb', { contraste: 3 });
  assert.equal(c.rgba.length, geo.W * geo.H * 4);
  assert.equal(c.valeurs, undefined);
  const c2 = m.calculer(geo, 'ombrage-rgb', { contraste: 1 });
  assert.equal(c2.recalcul, false);
});

test('un bloc hors de la grille ne jette ni la surface ni la couche gardées', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  m.calculer(geo, 'svf');
  m.ajouter(bloc('loin', 5000, 5000));
  m.retirer('loin');
  const c = m.calculer(geo, 'svf', { contraste: 2 });
  assert.equal(c.recalcul, false);
});

test('« compléter par les non classés » ne range pas les points de nouveau', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  m.surface(geo);
  m.statistiques(true);
  m.reglages({ inclureSursol: false });
  const t = m.surface(geo);
  assert.deepEqual({ ...m.statistiques() }, { reconstructions: 0, decalages: 0, ajouts: 0 });
  const ref = VUE_RELIEF.creer({ moteur: 'cpu' });
  ref.ajouter(bloc('a', 1000, 2000));
  ref.reglages({ inclureSursol: false });
  memeSurface(t, ref.surface(geo));
});

test('rangement incrémental : décalage dans l’autre sens (x négatif, y positif)', () => {
  const b1 = bloc('a', 1000, 2000);
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(b1);
  m.surface(VUE_GRILLE.definir({ xmin: 1010, xmax: 1050, ymin: 2002, ymax: 2042 }, 0.5, 0, 4096));
  m.statistiques(true);
  const g2 = VUE_GRILLE.definir({ xmin: 1006.2, xmax: 1046.2, ymin: 2006.9, ymax: 2046.9 }, 0.5, 0, 4096);
  const t = m.surface(g2);
  assert.equal(m.statistiques().decalages, 1);
  memeSurface(t, reference([b1], g2));
});

test('lire un point : altitude absolue, hauteur, valeur de la couche ; null hors de la grille', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  assert.equal(m.lire(1030, 2030), null);   // rien de calculé encore
  m.ajouter(bloc('a', 1000, 2000));
  const c = m.calculer(geo, 'svf');
  const p = m.lire(1030.2, 2030.2, 'svf');
  const cx = Math.floor((1030.2 - geo.emprise.xmin) / geo.pas), cy = Math.floor((2030.2 - geo.emprise.ymin) / geo.pas);
  const i = cy * geo.W + cx;
  assert.ok(Math.abs(p.altitude - (c.t.mnt[i] + c.t.origine[2])) < 1e-9);
  assert.ok(p.altitude > 300 && p.altitude < 305, `${p.altitude}`);
  assert.equal(p.valeur, c.valeurs[i]);
  assert.equal(p.hauteur, c.t.hauteur[i]);
  assert.equal(m.lire(5000, 5000), null);
});

test('réglages de couche (SVF) : pris en compte, et gardés en mémo par réglage', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const c1 = m.calculer(geo, 'svf', { couche: { svfRayonM: 10 } });
  const c2 = m.calculer(geo, 'svf', { couche: { svfRayonM: 4 } });
  assert.equal(c2.recalcul, true);
  assert.notEqual(c2.valeurs, c1.valeurs);
  const c3 = m.calculer(geo, 'svf', { couche: { svfRayonM: 4 } });
  assert.equal(c3.recalcul, false);
});

test('deux couches à la fois (une par côté du rideau) : chacune gardée', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const a1 = m.calculer(geo, 'svf');
  const b1 = m.calculer(geo, 'microrelief');
  const a2 = m.calculer(geo, 'svf');
  const b2 = m.calculer(geo, 'microrelief');
  assert.equal(a2.recalcul, false);
  assert.equal(b2.recalcul, false);
  assert.equal(a2.valeurs, a1.valeurs);
  assert.equal(b2.valeurs, b1.valeurs);
});

test('lire un point : la valeur de la couche demandée', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const svf = m.calculer(geo, 'svf');
  const micro = m.calculer(geo, 'microrelief');
  const i = Math.floor((2030.2 - geo.emprise.ymin) / geo.pas) * geo.W + Math.floor((1030.2 - geo.emprise.xmin) / geo.pas);
  assert.equal(m.lire(1030.2, 2030.2, 'svf').valeur, svf.valeurs[i]);
  assert.equal(m.lire(1030.2, 2030.2, 'microrelief').valeur, micro.valeurs[i]);
  assert.equal(m.lire(1030.2, 2030.2, 'hauteur').valeur, null);   // pas calculée
});


// ── Le nuage 3D de la vue ────────────────────────────────────────────────────

test('nuage3d sans bloc : rien', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  assert.equal(m.nuage3d(vue, 1e9), null);
});

test('nuage3d : tous les points de l’emprise, à leur place, le bord droit exclu', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  const b = bloc('a', 1000, 2000, { cote: 40 });
  m.ajouter(b);
  const e = { xmin: 1010, xmax: 1030, ymin: 2010, ymax: 2030 };
  const r = m.nuage3d(e, 1e9);
  // 20 m à 25 cm : 80 × 80 points, xmin et ymin compris, xmax et ymax exclus.
  assert.equal(r.n, 80 * 80);
  const cm = new Set();
  for (let i = 0; i < b.points.nbPoints; i++) cm.add(`${b.points.xc[i] + 100000},${b.points.yc[i] + 200000}`);
  let pire = 0, xmin = Infinity, xmax = -Infinity;
  for (let i = 0; i < r.n; i++) {
    const x = Math.round((r.origine[0] + r.x[i]) * 100), y = Math.round((r.origine[1] + r.y[i]) * 100);
    if (!cm.has(`${x},${y}`)) pire++;
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
  }
  assert.equal(pire, 0);
  assert.equal(xmin, 101000);   // pile sur xmin : gardé
  assert.equal(xmax, 102975);   // 103000 = xmax : exclu
  assert.equal(r.zmin, 0);
  assert.ok(r.zmax > 0);
  // L'intensité n'est plus téléchargée (blocs coupés aux couches lues).
  assert.equal(r.intensite, undefined);
  assert.equal(JSON.stringify(r.parClasse), JSON.stringify([[2, r.n]]));
});

test('nuage3d : plafond, tirage stable et uniforme', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000, { cote: 40 }));
  const e = { xmin: 1000, xmax: 1040, ymin: 2000, ymax: 2040 };
  const r = m.nuage3d(e, 5000);
  assert.ok(r.n <= 5000 * 1.05 && r.n >= 4000, `${r.n}`);
  const r2 = m.nuage3d(e, 5000);
  assert.equal(r2.n, r.n);
  for (let i = 0; i < r.n; i += 97) assert.equal(r2.x[i], r.x[i]);
  const quarts = [0, 0, 0, 0];
  for (let i = 0; i < r.n; i++) quarts[(r.x[i] >= 20 ? 1 : 0) + (r.y[i] >= 20 ? 2 : 0)]++;
  for (const q of quarts) assert.ok(q / r.n > 0.2 && q / r.n < 0.3, JSON.stringify(quarts));
});

test('nuage3d : n’importe quel début du nuage est un échantillon régulier de l’emprise', () => {
  // La 3D n'en dessine qu'un début pendant qu'on bouge : rangé bloc par bloc
  // ou ligne par ligne, ce début serait une bande.
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000, { cote: 40 }));
  const r = m.nuage3d({ xmin: 1000, xmax: 1040, ymin: 2000, ymax: 2040 }, 1e9);
  for (const part of [0.05, 0.2]) {
    const k = Math.round(r.n * part);
    const quarts = [0, 0, 0, 0];
    for (let i = 0; i < k; i++) quarts[(r.x[i] >= 20 ? 1 : 0) + (r.y[i] >= 20 ? 2 : 0)]++;
    for (const q of quarts) assert.ok(q / k > 0.18 && q / k < 0.32, `${part} : ${JSON.stringify(quarts)}`);
  }
});

test('nuage3d : hauteur au-dessus du sol et classe suivent leur point', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  const b = bloc('a', 1000, 2000, { cote: 40 });
  // Un point non classé, 2 m au-dessus du sol, au milieu.
  const k = b.points.nbPoints - 1;
  const autre = bloc('b', 1000, 2000, { cote: 1 });
  autre.cle = 'b';
  const p = autre.points;
  p.nbPoints = 1;
  p.xc[0] = 2000; p.yc[0] = 2000;
  // Sol de la fabrique en (20 m, 20 m) : la pente seule, la bosse (centrée à
  // 30 m) y est nulle. Puis 2 m au-dessus.
  p.zc[0] = 30000 + Math.round(2000 * 0.05 + 80 * Math.exp(-((1000 ** 2) * 2) / 2e5)) + 200;
  p.cls[0] = 1;
  autre.emprise = { xmin: 1000, ymin: 2000, xmax: 1040, ymax: 2040 };
  m.ajouter(b);
  m.ajouter(autre);
  m.calculer(VUE_GRILLE.definir({ xmin: 1000, xmax: 1040, ymin: 2000, ymax: 2040 }, 0.5, 0, 4096), 'svf');
  const r = m.nuage3d({ xmin: 1000, xmax: 1040, ymin: 2000, ymax: 2040 }, 1e9);
  let i = -1;
  for (let j = 0; j < r.n; j++) if (r.cls[j] === 1) i = j;
  assert.ok(i >= 0);
  assert.ok(Math.abs(r.hauteur[i] - 2) < 0.05, `${r.hauteur[i]}`);
  assert.ok(k > 0);
});

test('drape3d : la valeur étirée de la couche à la case de chaque point', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  assert.equal(m.drape3d('svf', undefined, 0, 1), null);   // pas de nuage
  m.ajouter(bloc('a', 1000, 2000));
  const c = m.calculer(geo, 'svf');
  const r = m.nuage3d({ xmin: 1010, xmax: 1050, ymin: 2010, ymax: 2050 }, 1e9);
  const d = m.drape3d('svf', undefined, c.min, c.max);
  assert.equal(d.length, r.n);
  for (const i of [0, 17, 999, r.n - 1]) {
    const x = r.origine[0] + r.x[i], y = r.origine[1] + r.y[i];
    const k = Math.floor((y - geo.emprise.ymin) / geo.pas) * geo.W + Math.floor((x - geo.emprise.xmin) / geo.pas);
    const v = c.valeurs[k];
    const attendu = Number.isFinite(v) ? Math.min(1, Math.max(0, (v - c.min) / (c.max - c.min))) : 0;
    assert.ok(Math.abs(d[i] - attendu) < 1e-6, `${i} : ${d[i]} ≠ ${attendu}`);
  }
  // Une couche pas encore calculée : calculée à la demande, sur la même surface.
  const micro = m.drape3d('microrelief', undefined, -0.1, 0.1);
  assert.equal(micro.length, r.n);
});

test('nuage3d : une surface qui ne couvre pas l’emprise n’est pas lue (hauteurs 0, pas de drapé)', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  // Surface calculée sur une autre vue (le coin sud-ouest seulement).
  const c = m.calculer(VUE_GRILLE.definir({ xmin: 1000, xmax: 1010, ymin: 2000, ymax: 2010 }, 0.5, 0, 4096), 'svf');
  const r = m.nuage3d({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2060 }, 1e9);
  assert.ok(r.n > 0);
  assert.equal(r.hauteur.every((h) => h === 0), true);
  assert.equal(m.drape3d('svf', undefined, c.min, c.max), null);
});

test('drape3d : plus rien après que la grille a changé (surface lâchée)', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const c = m.calculer(geo, 'svf');
  m.nuage3d({ xmin: 1010, xmax: 1050, ymin: 2010, ymax: 2050 }, 1e9);
  assert.ok(m.drape3d('svf', undefined, c.min, c.max));
  m.calculer(VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2060 }, 1, 0, 4096), 'svf');   // autre pas : grille neuve
  assert.equal(m.drape3d('svf', undefined, c.min, c.max), null);
});

// ── Le profil topographique ──────────────────────────────────────────────────

/**
 * Un bloc de 40 m, sol plat à 300 m (classe 2) et un « arbre » : les points à
 * moins de 1,5 m du centre (20 m, 20 m) sont de classe 5, à 300 + 25 m − leur
 * distance au centre — la cime vaut donc exactement 325 m, au centre.
 */
function blocArbre(cle, x0, y0) {
  const cote = 40, pasCm = 25, n = (cote * 100 / pasCm) ** 2;
  const xc = new Int32Array(n), yc = new Int32Array(n), zc = new Int32Array(n), cls = new Uint8Array(n);
  let k = 0;
  for (let y = 0; y < cote * 100; y += pasCm) {
    for (let x = 0; x < cote * 100; x += pasCm) {
      const dist = Math.hypot(x - 2000, y - 2000);
      xc[k] = x; yc[k] = y;
      if (dist <= 150) { cls[k] = 5; zc[k] = 32500 - Math.round(dist); } else { cls[k] = 2; zc[k] = 30000; }
      k++;
    }
  }
  return { cle, emprise: { xmin: x0, ymin: y0, xmax: x0 + cote, ymax: y0 + cote }, origineCm: [x0 * 100, y0 * 100, 0], points: { nbPoints: n, xc, yc, zc, cls } };
}

test('profil sans bloc : un message qui dit quoi faire (Review Focus 1)', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  const r = m.profil([1010, 2020], [1030, 2020], 4, 1e9);
  assert.match(r.raison, /zoomez/i);
});

test('profil : une bande qui touche un bloc mais ne contient aucun point', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(blocArbre('a', 1000, 2000));
  // Dans la boîte du bloc (x < 1040) par son début, mais à 0,5 m du bord : la
  // bande de 2 m de large part de 1039,9 vers l'extérieur.
  const r = m.profil([1040.5, 2020], [1060, 2020], 2, 1e9);
  assert.ok(r.raison);
});

test('profil : bande qui coupe la boîte du bloc sans point dedans', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  const b = blocArbre('a', 1000, 2000);
  // Un bloc vidé : même emprise, aucun point.
  b.points = { nbPoints: 0, xc: new Int32Array(0), yc: new Int32Array(0), zc: new Int32Array(0), cls: new Uint8Array(0) };
  m.ajouter(b);
  assert.match(m.profil([1010, 2020], [1030, 2020], 4, 1e9).raison, /aucun point/i);
});

test('profil : les points de la bande, leur distance le long de l’axe, leur altitude vraie', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(blocArbre('a', 1000, 2000));
  // De (1010, 2020) à (1030, 2020), 4 m de large : x de 1000 à 3000 cm locaux
  // (81 colonnes), y de 1800 à 2200 (17 lignes), bords compris.
  const r = m.profil([1010, 2020], [1030, 2020], 4, 1e9);
  assert.equal(r.raison, undefined);
  assert.equal(r.n, 81 * 17);
  assert.equal(r.total, r.n);
  assert.equal(r.plafonne, false);
  assert.equal(r.longueur, 20);
  assert.equal(r.largeur, 4);
  let smin = Infinity, smax = -Infinity, zmax = -Infinity, zsol = null;
  for (let i = 0; i < r.n; i++) {
    smin = Math.min(smin, r.s[i]); smax = Math.max(smax, r.s[i]); zmax = Math.max(zmax, r.z[i]);
    if (r.cls[i] === 2) zsol = r.z[i];
  }
  assert.equal(smin, 0);          // pile sur A : gardé (Review Focus 4)
  assert.equal(smax, 20);         // pile sur B : gardé
  assert.equal(zmax, 325);        // la cime de l'arbre, en altitude absolue
  assert.equal(zsol, 300);
  assert.ok(r.parClasse.some(([c, n]) => c === 2 && n > 0));
  assert.ok(r.parClasse.some(([c, n]) => c === 5 && n > 0));
});

test('profil : les points pile sur le bord de la largeur sont gardés, un centimètre plus loin non', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(blocArbre('a', 1000, 2000));
  // Largeur 4 : demi-largeur 2 m ; les lignes à y = 1800 et 2200 cm (écart 200 cm) en sont.
  const juste = m.profil([1010, 2020], [1030, 2020], 4, 1e9);
  const trop = m.profil([1010, 2020], [1030, 2020], 3.98, 1e9);   // demi-largeur 1,99 m
  assert.equal(juste.n, 81 * 17);
  assert.equal(trop.n, 81 * 15);   // les lignes à ±200 cm tombent dehors
});

test('profil : bande oblique à 45°, mêmes points quel que soit le sens', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(blocArbre('a', 1000, 2000));
  const ab = m.profil([1010, 2010], [1030, 2030], 3, 1e9);
  const ba = m.profil([1030, 2030], [1010, 2010], 3, 1e9);
  assert.equal(ab.n, ba.n);
  assert.ok(ab.n > 0);
  let zmax = -Infinity;
  for (let i = 0; i < ab.n; i++) zmax = Math.max(zmax, ab.z[i]);
  assert.equal(zmax, 325);   // l'axe passe par le centre de l'arbre
  assert.ok(Math.abs(ab.longueur - 20 * Math.SQRT2) < 1e-9);
});

test('profil : plafond atteint, tirage stable d’un appel à l’autre (Review Focus 4)', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(blocArbre('a', 1000, 2000));
  const r1 = m.profil([1010, 2020], [1030, 2020], 4, 500);
  const r2 = m.profil([1010, 2020], [1030, 2020], 4, 500);
  assert.equal(r1.plafonne, true);
  assert.ok(r1.n <= 500 * 1.05 + 1000);
  assert.ok(r1.n < r1.total);
  assert.equal(r1.n, r2.n);
  for (let i = 0; i < r1.n; i += 37) assert.equal(r1.s[i], r2.s[i]);
});

test('profil : les blocs que la vue ne demande plus (actifs) sont ignorés', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(blocArbre('a', 1000, 2000));
  const r = m.profil([1010, 2020], [1030, 2020], 4, 1e9, new Set(['autre']));
  assert.ok(r.raison);
});

test('profil : deux points confondus', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(blocArbre('a', 1000, 2000));
  assert.match(m.profil([1010, 2020], [1010, 2020], 4, 1e9).raison, /confondus/);
});
