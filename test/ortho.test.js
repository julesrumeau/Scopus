// Rééchantillonnage de la photo aérienne dans la grille Lambert-93.
//
// Une erreur de géométrie ne se voit pas ici non plus : une photo décalée de
// dix mètres reste une photo de forêt parfaitement plausible, et c'est
// justement le décalage qu'on regarde quand on compare les deux couches de part
// et d'autre du rideau. D'où des contrôles contre des valeurs connues d'avance
// — les coins du monde en Web Mercator — et contre le calcul exact.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = new URL('../src/', import.meta.url);
const lire = (nom) => readFileSync(fileURLToPath(new URL(nom, SRC)), 'utf8');

function charger() {
  const contexte = vm.createContext({ performance });
  // `raster.js` est chargé pour une seule raison : c'est lui qui définit où se
  // trouve une cellule, et le maillage doit être comparé à cette définition-là
  // plutôt qu'à elle-même.
  for (const f of ['config.js', 'proj.js', 'raster.js', 'ortho.js']) vm.runInContext(lire(f), contexte);
  return vm.runInContext('({ ORTHO, PROJ, RASTER, CONFIG })', contexte);
}

// Dalle de l'Ariège, du même genre que celles qu'on charge réellement.
const EMPRISE = { xmin: 570000, ymin: 6200000, xmax: 571000, ymax: 6201000 };
const PAS = 0.5;
const W = 2000, H = 2000;

test('la grille PM place les repères du monde là où ils doivent être', () => {
  const { ORTHO } = charger();
  const [x0, y0] = ORTHO.versPixelPM(0, 0, 0);
  assert.ok(Math.abs(x0 - 128) < 1e-6, `centre du monde en x : ${x0}`);
  assert.ok(Math.abs(y0 - 128) < 1e-6, `centre du monde en y : ${y0}`);

  const [xe] = ORTHO.versPixelPM(180, 0, 0);
  const [xo] = ORTHO.versPixelPM(-180, 0, 0);
  assert.ok(Math.abs(xe - 256) < 1e-6, `antiméridien est : ${xe}`);
  assert.ok(Math.abs(xo) < 1e-6, `antiméridien ouest : ${xo}`);

  // Latitude de coupure de la grille : le haut du monde, pixel 0.
  const [, yn] = ORTHO.versPixelPM(0, 85.05112878, 0);
  assert.ok(Math.abs(yn) < 1e-3, `coupure nord : ${yn}`);

  // Un niveau de plus double la résolution en pixels.
  const [x1] = ORTHO.versPixelPM(0, 0, 1);
  assert.ok(Math.abs(x1 - 256) < 1e-6, `niveau 1 : ${x1}`);
});

test('le niveau retenu a un pixel au sol au plus égal au pas de la grille', () => {
  const { ORTHO } = charger();
  for (const lat of [42.7, 48.9, 44.0]) {
    for (const pas of [0.25, 0.5, 1]) {
      const z = ORTHO.zoomPour(pas, lat);
      const auSol = ORTHO.resolution(z) * Math.cos(lat * Math.PI / 180);
      assert.ok(auSol <= pas + 1e-9,
        `z=${z} à ${lat}° : ${auSol.toFixed(3)} m/px pour un pas de ${pas} m`);
      // Et pas plus fin que nécessaire : le niveau précédent, lui, est trop
      // grossier. Chaque niveau de trop quadruple le nombre de tuiles.
      const precedent = ORTHO.resolution(z - 1) * Math.cos(lat * Math.PI / 180);
      assert.ok(precedent > pas, `z=${z - 1} suffirait pourtant (${precedent.toFixed(3)} m/px)`);
    }
  }
  // Plafond : au-delà de 19, la Géoplateforme répond 404 — partout, et pas
  // seulement en montagne.
  assert.equal(ORTHO.zoomPour(0.05, 42.7), 19);
});

test('une dalle à 50 cm se lit au niveau 18', () => {
  const { ORTHO } = charger();
  assert.equal(ORTHO.zoomPour(0.5, 42.74), 18);
});

test('la ligne 0 du raster est au sud, comme dans toutes les grilles', () => {
  // LE contrôle qui manquait, et son absence a coûté une photo retournée
  // nord-sud, livrée et vue à l'écran. Le premier essai comparait le maillage à
  // une correspondance recalculée dans le test avec la **même** convention que
  // le code : il ne pouvait donc que passer. Ici la position d'une cellule vient
  // de `RASTER.centreCellule`, qui est la définition dont dépendent `mnt`,
  // `hauteur` et la lecture au curseur — la photo doit s'y plier, et non
  // l'inverse.
  const { ORTHO, PROJ, RASTER } = charger();
  const z = ORTHO.zoomPour(PAS, 42.74);
  const m = ORTHO.maillage(EMPRISE, PAS, W, H, z);
  const g = { emprise: EMPRISE, pas: PAS, W, H };

  for (const [cx, cy] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [733, 219]]) {
    const centre = RASTER.centreCellule(g, cx, cy);
    const wgs = PROJ.versWGS84(centre.x, centre.y);
    const [ax, ay] = ORTHO.versPixelPM(wgs.lon, wgs.lat, z);
    const [bx, by] = ORTHO.interpoler(m, cx + 0.5, cy + 0.5);
    assert.ok(Math.hypot(ax - bx, ay - by) < 0.1,
      `cellule (${cx}, ${cy}) : ${Math.hypot(ax - bx, ay - by).toFixed(2)} px d'écart`);
  }

  // Et explicitement : la première ligne est plus au sud que la dernière, donc
  // plus **bas** dans la pyramide de tuiles, dont l'origine est au nord.
  const [, yBas] = ORTHO.interpoler(m, W / 2, 0.5);
  const [, yHaut] = ORTHO.interpoler(m, W / 2, H - 0.5);
  assert.ok(yBas > yHaut, 'la ligne 0 doit être au sud de la dernière');
});

test('l’adressage des tuiles concorde avec la formule « slippy map »', () => {
  // Contrôle croisé, et c'est tout l'intérêt : la formule ci-dessous est
  // l'expression usuelle de la même grille, écrite autrement (elle ne passe pas
  // par les mètres de Mercator). Une erreur de convention — origine en bas,
  // décalage d'une tuile — ferait afficher une photo d'ailleurs, parfaitement
  // plausible et parfaitement fausse.
  const { ORTHO } = charger();
  const cas = [[1.68, 42.74, 18], [3.0, 46.5, 12], [-1.55, 47.22, 15], [7.26, 43.7, 19]];
  for (const [lon, lat, z] of cas) {
    const [px, py] = ORTHO.versPixelPM(lon, lat, z);
    const n = 2 ** z;
    const phi = lat * Math.PI / 180;
    const attenduX = Math.floor((lon + 180) / 360 * n);
    const attenduY = Math.floor((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * n);
    assert.equal(Math.floor(px / ORTHO.TUILE), attenduX, `colonne à ${lon}/${lat} z${z}`);
    assert.equal(Math.floor(py / ORTHO.TUILE), attenduY, `ligne à ${lon}/${lat} z${z}`);
  }
});

test('le maillage interpole à mieux qu’un dixième de pixel', () => {
  // C'est l'hypothèse qui autorise à ne pas projeter chaque pixel de sortie :
  // Lambert-93 et Mercator étant tous deux conformes, leur composition est
  // localement une similitude. Vérifié, et non supposé.
  const { ORTHO, PROJ } = charger();
  const z = ORTHO.zoomPour(PAS, 42.74);
  const m = ORTHO.maillage(EMPRISE, PAS, W, H, z);

  let pire = 0;
  for (let cy = 0; cy <= H; cy += 7) {
    for (let cx = 0; cx <= W; cx += 7) {
      const [ax, ay] = ORTHO.interpoler(m, cx, cy);
      const g = PROJ.versWGS84(EMPRISE.xmin + cx * PAS, EMPRISE.ymin + cy * PAS);
      const [bx, by] = ORTHO.versPixelPM(g.lon, g.lat, z);
      pire = Math.max(pire, Math.hypot(ax - bx, ay - by));
    }
  }
  assert.ok(pire < 0.1, `écart maximal au calcul exact : ${pire.toFixed(4)} px`);
});

test('le carré Lambert-93 est bien tourné d’environ 1° en Mercator', () => {
  // C'est toute la raison d'être de ce module. Si l'écart était nul, superposer
  // les deux couches naïvement suffirait — et le piège documenté pour
  // `L.rectangle` n'existerait pas.
  const { ORTHO, PROJ } = charger();
  const z = ORTHO.zoomPour(PAS, 42.74);
  const coin = (x, y) => {
    const g = PROJ.versWGS84(x, y);
    return ORTHO.versPixelPM(g.lon, g.lat, z);
  };
  const [xg, yg] = coin(EMPRISE.xmin, EMPRISE.ymax);
  const [xd, yd] = coin(EMPRISE.xmax, EMPRISE.ymax);
  const angle = Math.abs(Math.atan2(yd - yg, xd - xg) * 180 / Math.PI);

  assert.ok(angle > 0.3 && angle < 2,
    `rotation du bord nord : ${angle.toFixed(2)}° (attendu ~1°)`);

  // Vingtaine de mètres de décalage en travers de la dalle : c'est l'ordre de
  // grandeur cité dans CLAUDE.md, et ce que coûterait une superposition naïve.
  const largeurPx = Math.hypot(xd - xg, yd - yg);
  const decalage = largeurPx * Math.sin(angle * Math.PI / 180)
    * ORTHO.resolution(z) * Math.cos(42.74 * Math.PI / 180);
  assert.ok(decalage > 8 && decalage < 40,
    `décalage en travers de la dalle : ${decalage.toFixed(1)} m`);
});

test('le maillage couvre la grille entière, bords compris', () => {
  const { ORTHO, PROJ } = charger();
  const z = ORTHO.zoomPour(PAS, 42.74);
  const m = ORTHO.maillage(EMPRISE, PAS, W, H, z);

  // Le dernier nœud doit tomber sur le bord de l'emprise, pas au-delà ni en
  // deçà : une extrapolation d'un demi-pas de maillage décalerait toute la
  // dernière bande de l'image.
  const [bx, by] = ORTHO.interpoler(m, W, H);
  const g = PROJ.versWGS84(EMPRISE.xmax, EMPRISE.ymax);
  const [ex, ey] = ORTHO.versPixelPM(g.lon, g.lat, z);
  assert.ok(Math.hypot(bx - ex, by - ey) < 0.1, 'coin nord-est du maillage');
});
