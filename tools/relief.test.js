// Visualisations de relief, contrôlées sur des surfaces à réponse connue.
//
// Ces algorithmes ont ceci de traître qu'une erreur ne se voit pas : un ombrage
// faux reste une jolie image de terrain, et un micro-relief mal centré ressemble
// à s'y méprendre à du micro-relief. La chaîne des sentiers, dans ce dépôt, rend
// zéro tracé sans que rien ne le signale — c'est exactement ce que ces
// vérifications existent pour éviter.
//
// Les surfaces choisies ont toutes une réponse calculable à la main : plan
// horizontal, plan incliné d'angle connu, bosse et creux isolés.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = new URL('../src/', import.meta.url);
const lire = (nom) => readFileSync(fileURLToPath(new URL(nom, SRC)), 'utf8');

function charger() {
  const contexte = vm.createContext({ performance });
  vm.runInContext(lire('config.js'), contexte);
  vm.runInContext(lire('relief.js'), contexte);
  return vm.runInContext('({ RELIEF, CONFIG })', contexte);
}

/** Grille de travail synthétique : `fz(x, y)` donne l'altitude en mètres. */
function terrain(W, H, pas, fz) {
  const N = W * H;
  const mnt = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) mnt[y * W + x] = fz(x * pas, y * pas);
  }
  return {
    W, H, N, pas, mnt,
    valide: new Uint8Array(N).fill(1),
    hauteur: new Float32Array(N),
    trou: new Float32Array(N),
    emprise: { xmin: 0, ymin: 0, xmax: W * pas, ymax: H * pas },
    origine: [0, 0, 0],
  };
}

const au = (t, v, x, y) => v[y * t.W + x];
const deg = (d) => d * Math.PI / 180;

test('l’ombrage d’un plan incliné vaut ce que dit la trigonométrie', () => {
  const { RELIEF } = charger();

  // Plan qui descend vers l'est de 20° : z = −tan(20°)·x.
  const beta = deg(20);
  const t = terrain(60, 60, 1, (x) => -Math.tan(beta) * x);
  const elev = deg(45);

  // Normale du plan : (sin β, 0, cos β). Soleil à l'est : (cos e, 0, sin e).
  // Leur produit scalaire vaut sin(β + e) — le versant regarde le soleil.
  const est = RELIEF.ombrage(t, 90, 45);
  assert.ok(Math.abs(au(t, est, 30, 30) - Math.sin(beta + elev)) < 1e-5,
    `éclairé de l'est : attendu ${Math.sin(beta + elev).toFixed(5)}, obtenu ${au(t, est, 30, 30)}`);

  // Soleil à l'ouest : le versant se détourne, il reste sin(e − β).
  const ouest = RELIEF.ombrage(t, 270, 45);
  assert.ok(Math.abs(au(t, ouest, 30, 30) - Math.sin(elev - beta)) < 1e-5,
    `éclairé de l'ouest : attendu ${Math.sin(elev - beta).toFixed(5)}, obtenu ${au(t, ouest, 30, 30)}`);

  // Un plan horizontal ne renvoie que le sinus de la hauteur du soleil.
  const plat = RELIEF.ombrage(terrain(20, 20, 1, () => 12), 315, 45);
  assert.ok(Math.abs(au({ W: 20 }, plat, 10, 10) - Math.sin(elev)) < 1e-6);
});

test('l’ombrage distingue le nord du sud, et pas seulement l’est de l’ouest', () => {
  const { RELIEF } = charger();
  // Plan qui descend vers le nord : le Y de la grille croît vers le nord.
  const t = terrain(60, 60, 1, (x, y) => -Math.tan(deg(20)) * y);
  const nord = RELIEF.ombrage(t, 0, 45);      // soleil au nord, face au versant
  const sud = RELIEF.ombrage(t, 180, 45);     // soleil au sud, versant détourné
  assert.ok(Math.abs(au(t, nord, 30, 30) - Math.sin(deg(65))) < 1e-5,
    `soleil au nord : ${au(t, nord, 30, 30)}`);
  assert.ok(Math.abs(au(t, sud, 30, 30) - Math.sin(deg(25))) < 1e-5,
    `soleil au sud : ${au(t, sud, 30, 30)}`);
});

test('le micro-relief d’un plan est nul partout', () => {
  const { RELIEF } = charger();
  // C'est le contrôle décisif : un lissage faux, mal centré ou mal normalisé se
  // trahit ici et nulle part ailleurs — sur un terrain réel son erreur
  // ressemblerait à du relief.
  const t = terrain(160, 160, 0.5, (x, y) => 800 + 0.27 * x - 0.11 * y);
  const v = RELIEF.microRelief(t, 6);

  let pire = 0, comptees = 0;
  for (let i = 0; i < t.N; i++) {
    if (!Number.isFinite(v[i])) continue;
    comptees++;
    pire = Math.max(pire, Math.abs(v[i]));
  }
  assert.ok(comptees > 5000, `trop peu de cellules retenues : ${comptees}`);
  assert.ok(pire < 2e-3, `micro-relief non nul sur un plan : jusqu'à ${pire.toFixed(4)} m`);
});

test('le micro-relief voit une bosse et un creux, et leur donne le bon signe', () => {
  const { RELIEF } = charger();
  const bosse = (x, y, cx, cy, h, r) => h * Math.exp(-(((x - cx) ** 2 + (y - cy) ** 2) / (2 * r * r)));

  // Versant de 15°, une bosse de 80 cm et un creux de 60 cm, bien séparés.
  const t = terrain(200, 200, 0.5, (x, y) =>
    900 + Math.tan(deg(15)) * x + bosse(x, y, 40, 40, 0.8, 2) - bosse(x, y, 60, 60, 0.6, 2));
  const v = RELIEF.microRelief(t, 6);

  const vBosse = au(t, v, 80, 80);
  const vCreux = au(t, v, 120, 120);
  const vFond = au(t, v, 100, 40);

  assert.ok(vBosse > 0.5, `bosse de 80 cm mesurée à ${vBosse.toFixed(2)} m`);
  assert.ok(vCreux < -0.35, `creux de 60 cm mesuré à ${vCreux.toFixed(2)} m`);
  assert.ok(Math.abs(vFond) < 0.05, `le versant nu devrait rester plat, il vaut ${vFond.toFixed(3)} m`);
});

test('le Sky-View Factor vaut 1 sur un plan horizontal', () => {
  const { RELIEF } = charger();
  const t = terrain(80, 80, 0.5, () => 1200);
  const v = RELIEF.svf(t, { svfDirections: 8, svfRayonM: 6 });
  for (let i = 0; i < t.N; i++) {
    assert.ok(Math.abs(v[i] - 1) < 1e-6, `SVF ${v[i]} sur du plat`);
  }
});

test('le Sky-View Factor d’un plan incliné suit la formule publiée', () => {
  const { RELIEF } = charger();
  // Quatre directions tombent exactement sur les axes de la grille, ce qui
  // rend le résultat calculable : seule celle qui remonte la pente voit un
  // horizon, à l'angle du plan. SVF = 1 − (1/4)·sin β.
  const beta = deg(20);
  const t = terrain(80, 80, 0.5, (x) => 500 + Math.tan(beta) * x);
  const v = RELIEF.svf(t, { svfDirections: 4, svfRayonM: 6 });

  const attendu = 1 - Math.sin(beta) / 4;
  assert.ok(Math.abs(au(t, v, 40, 40) - attendu) < 1e-5,
    `attendu ${attendu.toFixed(6)}, obtenu ${au(t, v, 40, 40).toFixed(6)}`);
});

test('le Sky-View Factor s’assombrit dans un creux et sature sur une crête', () => {
  const { RELIEF } = charger();
  const t = terrain(120, 120, 0.5, (x, y) => {
    const d = Math.hypot(x - 30, y - 30);
    return 700 - 2 * Math.max(0, 1 - d / 8);     // cuvette de 2 m, rayon 8 m
  });
  const v = RELIEF.svf(t, { svfDirections: 16, svfRayonM: 8 });

  const fond = au(t, v, 60, 60);
  const bord = au(t, v, 78, 60);
  const loin = au(t, v, 110, 110);
  assert.ok(fond < 0.97, `le fond de cuvette devrait être sombre, SVF ${fond.toFixed(3)}`);
  assert.ok(fond < bord, `le fond (${fond.toFixed(3)}) doit être plus sombre que le bord (${bord.toFixed(3)})`);
  assert.ok(Math.abs(loin - 1) < 1e-6, `loin de la cuvette, SVF devrait valoir 1 : ${loin}`);
});

test('l’ouverture vaut 90° sur un plan, quelle que soit sa pente', () => {
  const { RELIEF } = charger();

  // C'est LA propriété qui justifie de préférer l'ouverture au micro-relief
  // pour chercher une structure sur un versant : ce qui est vu vers l'amont
  // annule exactement ce qui est vu vers l'aval, donc la pente d'ensemble
  // disparaît sans qu'on ait rien soustrait. Un seuil calé en plaine vaut
  // encore à 30°.
  //
  // Ce test a effectivement attrapé une faute : avec des décalages entiers, le
  // rayon zigzague et la compensation cesse d'être exacte — 88,6° au lieu de 90
  // sur un plan à 20°, avec 16 directions. D'où l'échantillonnage bilinéaire.
  for (const pente of [0, 10, 30]) {
    for (const dirs of [8, 16]) {
      const t = terrain(80, 80, 0.5, (x) => 500 + Math.tan(deg(pente)) * x);
      const pos = RELIEF.ouverture(t, { svfDirections: dirs, svfRayonM: 6 }, 'positive');
      const neg = RELIEF.ouverture(t, { svfDirections: dirs, svfRayonM: 6 }, 'negative');

      // Au centre seulement : sur la couronne de bord l'horizon est tronqué.
      // La tolérance est celle du Float32 sur des altitudes de 500 m.
      assert.ok(Math.abs(au(t, pos, 40, 40) - 90) < 5e-3,
        `pente ${pente}°, ${dirs} directions : ouverture positive ${au(t, pos, 40, 40).toFixed(4)}°`);
      assert.ok(Math.abs(au(t, neg, 40, 40) - 90) < 5e-3,
        `pente ${pente}°, ${dirs} directions : ouverture négative ${au(t, neg, 40, 40).toFixed(4)}°`);
    }
  }
});

test('l’ouverture lit un mur en anneau, et le lit pareil à plat et sur un versant', () => {
  const { RELIEF } = charger();

  // Un orri ruiné tel qu'on l'espère dans la donnée : anneau de pierre de 4 m
  // de diamètre, 1 m d'épaisseur, 60 cm de haut. C'est le cas d'école de toute
  // la chaîne à venir.
  //
  // Les rôles des deux ouvertures ne sont PAS ceux que l'intuition suggère, et
  // c'est la mesure qui l'a dit :
  //  - la **couronne** ne ressort pas en ouverture positive (le mur est de
  //    niveau le long de lui-même, donc l'horizon y reste à 90°) mais en
  //    ouverture **négative**, qui plonge à ~58° : c'est de là qu'on voit loin
  //    vers le bas. C'est donc la couche du mur.
  //  - l'**intérieur** ressort en ouverture **positive**, à ~72° : le ciel s'y
  //    referme. C'est la couche de l'enclos.
  // Chercher le mur dans la mauvaise couche ne rendrait rien du tout.
  const cx = 15, cy = 15, rayon = 2;
  const anneau = (pente) => terrain(120, 120, 0.25, (x, y) => {
    const sol = 800 + Math.tan(deg(pente)) * x;
    const d = Math.hypot(x - cx, y - cy);
    return sol + (Math.abs(d - rayon) < 0.5 ? 0.6 : 0);
  });

  const lire = (t, v, x, y) => v[Math.round(y / t.pas) * t.W + Math.round(x / t.pas)];
  const mesures = [0, 20].map((pente) => {
    const t = anneau(pente);
    const pos = RELIEF.ouverture(t, { svfDirections: 16, svfRayonM: 5 }, 'positive');
    const neg = RELIEF.ouverture(t, { svfDirections: 16, svfRayonM: 5 }, 'negative');
    return {
      pente,
      mur: lire(t, neg, cx + rayon, cy),        // sur la couronne
      interieur: lire(t, pos, cx, cy),          // au milieu de l'enclos
      murEnPos: lire(t, pos, cx + rayon, cy),
      solNeg: lire(t, neg, cx + 5, cy),         // hors de l'anneau
    };
  });

  for (const m of mesures) {
    assert.ok(m.mur < 70,
      `pente ${m.pente}° : le mur devrait plonger en ouverture négative, il vaut ${m.mur.toFixed(2)}°`);
    assert.ok(m.interieur < 80,
      `pente ${m.pente}° : l’enclos devrait se refermer en ouverture positive, il vaut ${m.interieur.toFixed(2)}°`);
    assert.ok(Math.abs(m.murEnPos - 90) < 1,
      `pente ${m.pente}° : la couronne ne se voit pas en ouverture positive (${m.murEnPos.toFixed(2)}°) — c’est attendu`);
    assert.ok(Math.abs(m.solNeg - 90) < 1,
      `pente ${m.pente}° : le sol nu devrait rester à 90°, il vaut ${m.solNeg.toFixed(2)}°`);
  }

  // Et le résultat qui décide de tout : la signature ne bouge quasiment pas
  // entre le plat et un versant à 20°, alors que le relief y varie de 1,8 m sur
  // la seule portée du balayage — six fois la hauteur du mur cherché.
  const [plat, versant] = mesures;
  assert.ok(Math.abs(plat.mur - versant.mur) < 3,
    `le mur doit se lire pareil à plat (${plat.mur.toFixed(1)}°) et à 20° (${versant.mur.toFixed(1)}°)`);
  assert.ok(Math.abs(plat.interieur - versant.interieur) < 3,
    `l’enclos doit se lire pareil à plat (${plat.interieur.toFixed(1)}°) et à 20° (${versant.interieur.toFixed(1)}°)`);
});

test('un même balayage sert le SVF et les deux ouvertures', () => {
  const { RELIEF } = charger();
  const t = terrain(40, 40, 0.5, (x, y) => 300 + 0.1 * x + 0.05 * y);
  const r = RELIEF.balayerHorizons(t, { svfDirections: 8, svfRayonM: 4 });
  assert.equal(r.svf, RELIEF.svf(t, { svfDirections: 8, svfRayonM: 4 }),
    'le SVF doit sortir du mémo, pas d’un second balayage');
  assert.ok(r.ouverturePositive !== r.ouvertureNegative);
});

test('la grille d’affichage agrège le sol et la hauteur des structures', () => {
  const { RELIEF, CONFIG } = charger();

  // Grille fine de détection, à 25 cm, avec un sol plat à 10 m et une structure
  // de 1,20 m sur quatre cellules.
  const W = 40, H = 40, N = W * H;
  const g = {
    W, H, pas: 0.25,
    emprise: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 },
    origine: [0, 0, 1500],
    mnt: new Float32Array(N).fill(10),
    // `solZ` est l'altitude **brute** des cellules qui ont vu des points sol ;
    // `mnt` est sa version comblée. La grille d'affichage lit la première pour
    // sa surface d'analyse et la seconde pour l'altitude annoncée : une grille
    // de test qui n'aurait que `mnt` ne dirait rien de ce comportement.
    solZ: new Float32Array(N).fill(10),
    solConnu: new Uint8Array(N).fill(1),
    solN: new Uint8Array(N).fill(3),
    ncSomme: new Float32Array(N),
    ncN: new Uint8Array(N),
    batSomme: new Float32Array(N),
    batN: new Uint8Array(N),
  };
  for (const c of [20 * W + 20, 20 * W + 21, 21 * W + 20, 21 * W + 21]) {
    g.ncSomme[c] = 11.2 * 2;   // deux points à 11,20 m
    g.ncN[c] = 2;
    g.solN[c] = 0;             // la pierre ne laisse aucun retour au sol
    g.solZ[c] = NaN;
  }

  const t = RELIEF.preparer(g, { pasM: 0.5, inclureBati: false });
  assert.equal(t.pas, 0.5);
  assert.equal(t.W, 20);

  // Les quatre cellules fines tombent dans la cellule grossière (10, 10).
  const i = 10 * t.W + 10;
  assert.ok(Math.abs(t.hauteur[i] - 1.2) < 1e-5, `hauteur agrégée : ${t.hauteur[i]}`);
  assert.equal(t.trou[i], 1, 'les quatre cellules fines sont sans retour sol');
  assert.ok(Math.abs(t.mnt[i] - 10) < 1e-5);

  // Ailleurs, rien ne se dresse et le sol est partout connu.
  assert.equal(t.hauteur[0], 0);
  assert.equal(t.trou[0], 0);
  assert.ok(CONFIG.relief.pasM > 0, 'la configuration porte bien un pas de relief');
});

test('le contraste resserre l’intervalle autour du point qui compte', () => {
  const { RELIEF } = charger();
  // Les tableaux sortent du contexte `vm`, donc d'un autre realm : leur
  // prototype n'est pas celui d'ici et `deepStrictEqual` s'en formaliserait.
  // On compare les nombres, qui sont les seuls à avoir un sens.
  const proche = (obtenu, attendu, quoi) => {
    assert.equal(obtenu.length, 2);
    for (let i = 0; i < 2; i++) {
      assert.ok(Math.abs(obtenu[i] - attendu[i]) < 1e-12,
        `${quoi} : attendu [${attendu}], obtenu [${obtenu[0]}, ${obtenu[1]}]`);
    }
  };

  // Micro-relief : signé, le zéro doit rester au centre.
  proche(RELIEF.etirer([-3, 3], 'centre', 3), [-1, 1], 'centre');
  // Sky-View Factor : le plat parfait vaut 1 et doit le rester ; c'est le bas
  // qu'on remonte, puisque tout ce qu'on cherche est du côté sombre.
  proche(RELIEF.etirer([0.8, 1], 'haut', 2), [0.9, 1], 'haut');
  // Hauteur : part de zéro, c'est le plafond qui descend.
  proche(RELIEF.etirer([0, 3], 'bas', 3), [0, 1], 'bas');
  // Neutre à 1, et jamais d'intervalle inversé même sur une valeur absurde.
  proche(RELIEF.etirer([-2, 5], 'centre', 1), [-2, 5], 'neutre');
  const [a, b] = RELIEF.etirer([0, 1], 'bas', 0);
  assert.ok(b > a, 'un contraste nul ne doit pas produire un intervalle vide');
});

test('une couche se calcule par sa clé et s’étale sur un intervalle utile', () => {
  const { RELIEF } = charger();
  const t = terrain(80, 80, 0.5, (x, y) => 300 + 0.1 * x + 0.4 * Math.sin(x));

  for (const def of RELIEF.COUCHES) {
    const c = RELIEF.calculer(t, def.cle, { svfDirections: 4, svfRayonM: 3 });
    assert.equal(c.cle, def.cle);
    assert.equal(c.valeurs.length, t.N);
    assert.ok(Number.isFinite(c.min) && Number.isFinite(c.max),
      `${def.cle} : intervalle non fini [${c.min}, ${c.max}]`);
    assert.ok(c.max > c.min, `${def.cle} : intervalle vide`);
    assert.ok(c.duree >= 0);
  }
});
