// Les deux voies de détection, sur le même nuage.
//
// Ce fichier vérifie la seule chose qui justifie d'avoir écrit `lignes.js` : il
// existe des structures que la voie par classement **ne peut pas voir**, et que
// la voie par la forme trouve.
//
// Le cas n'est pas théorique. Le classificateur de l'IGN décide du sort d'un tas
// de pierres : rangé en « bâtiment », il produit un signal au-dessus du sol et
// la détection le trouve ; rangé en « sol », il *est* le terrain, aucun point ne
// dépasse, et le signal est nul. Une ruine effondrée et enherbée tombe
// régulièrement dans le second cas — c'est-à-dire précisément la cible du
// projet.
//
// On vérifie donc les deux moitiés de l'affirmation, parce qu'une seule ne
// prouverait rien : que la voie par classement est bien aveugle ici, et que la
// voie par la forme, elle, voit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';
import { nuageSynthetique, rectangle, X0, Y0, COTE } from './nuages.js';

const { RASTER, DETECTION, RELIEF, LIGNES } =
  chargerScripts(['config.js', 'proj.js', 'raster.js', 'detection.js', 'relief.js', 'lignes.js']);

// Anneau de pierre de 4 m de diamètre, mur d'un mètre d'épaisseur — un orri
// écroulé, tel qu'on l'espère dans la donnée.
const anneau = (x, y) => Math.abs(Math.hypot(x - COTE / 2, y - COTE / 2) - 2) < 0.5;

/** Le nuage, classé au choix — c'est toute la question. */
function grille(classeStructure) {
  return RASTER.rasteriser(nuageSynthetique({
    dansStructure: anneau,
    hauteur: 0.7,
    classeStructure,
    // Dans les deux cas, **aucun retour sol sous la pierre** : une masse de
    // pierre est opaque au laser. Laisser un point de sol dessous — ce que
    // faisait la première version de ce test — donnait un MNT qui retenait le
    // point bas et faisait disparaître le mur entièrement, chaîne parfaitement
    // saine à l'appui.
    trouSol: true,
  }));
}

/** La voie par la forme, telle que `app.js` l'enchaîne. */
function parLaForme(g) {
  const rel = RELIEF.preparer(g, { inclureBati: true });
  // Aucune surcharge de réglage : c'est le chemin de production qu'on éprouve.
  const r = LIGNES.extraire(rel);
  const f = Math.round(rel.pas / g.pas);
  const sig = RASTER.signal(g, true);

  return r.structures.map((s) => {
    const fines = [];
    for (const i of s.pleines) {
      const x = (i % rel.W) * f, y = ((i / rel.W) | 0) * f;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < g.W && yy < g.H) fines.push(yy * g.W + xx);
        }
      }
    }
    return { ...DETECTION.qualifier(fines, g, sig), forme: s };
  });
}

test('classé « sol », le mur est invisible à la voie par classement', () => {
  const r = DETECTION.detecter(grille(2));
  assert.equal(r.candidats.length, 0,
    `${r.candidats.length} candidat(s) alors que rien ne dépasse du sol`);
});

test('classé « sol », la voie par la forme le trouve quand même', () => {
  const g = grille(2);
  const trouves = parLaForme(g);
  assert.equal(trouves.length, 1, `${trouves.length} structure(s) fermée(s), une attendue`);

  const c = trouves[0];
  const ecart = Math.hypot(c.x - (X0 + COTE / 2), c.y - (Y0 + COTE / 2));
  assert.ok(ecart < 1.5, `centre à ${ecart.toFixed(2)} m du réel`);

  // La surface est celle de ce que le mur **enferme**, pas celle du mur : sans
  // le remplissage de l'intérieur, on remonterait une quinzaine de mètres carrés
  // d'anneau au lieu de la vingtaine de la cabane.
  assert.ok(c.surface > 15 && c.surface < 35,
    `surface ${c.surface.toFixed(1)} m², attendu ≈ 20 (disque de 2,5 m de rayon)`);
  assert.ok(c.forme.hauteurMur > 0.3,
    `le mur doit dépasser de son intérieur : ${c.forme.hauteurMur.toFixed(2)} m`);
});

test('classé « bâtiment », un anneau échappe aussi à la voie par classement', () => {
  // Mesuré : la « rectangularité » du masque vaut **0,51** pour un seuil à 0,55.
  // Ce n'est pas un réglage malheureux, c'est structurel — cette mesure est un
  // taux de remplissage, `surface / enveloppe convexe`, et un anneau est creux
  // par définition. Autrement dit, la voie par classement rejette une cabane
  // dont les murs tiennent encore **parce qu'**il lui manque son toit.
  //
  // Baisser le seuil ne serait pas la réponse : il est déjà sous le plafond
  // d'un disque (0,785) pour laisser passer les orris ronds, et le descendre
  // encore ferait entrer tout ce qui est difforme.
  const g = grille(6);
  const parClassement = DETECTION.detecter(g);
  assert.equal(parClassement.candidats.length, 0,
    'un anneau devrait être rejeté sur la forme, pas retenu');
  assert.equal(parClassement.stats.rejets.forme, 1, 'et rejeté pour ce motif-là');

  assert.equal(parLaForme(g).length, 1, 'la voie par la forme doit le rattraper');
});

test('un bâti plein est vu par le classement, et pas par la forme', () => {
  // Le pendant du test précédent, et la raison pour laquelle les deux voies se
  // complètent au lieu de se doubler : un volume plein n'a pas d'intérieur
  // fermé au ciel, donc la voie par la forme le laisse — c'est le même critère
  // qui écarte les plateformes.
  const g = RASTER.rasteriser(nuageSynthetique({
    dansStructure: rectangle(6, 4), hauteur: 2, classeStructure: 6, trouSol: true,
  }));
  assert.ok(DETECTION.detecter(g).candidats.length >= 1, 'la voie par classement devrait le voir');
  assert.equal(parLaForme(g).length, 0, 'la voie par la forme ne doit pas le retenir');
});

test('quand les deux voies voient la même structure, elles la placent au même endroit', () => {
  // Ce qui rend la fusion possible : `app.js` considère comme jumelles deux
  // détections distantes de moins de `rayonMaxM`. Si les deux voies plaçaient la
  // même cabane à dix mètres l'une de l'autre, la liste la compterait deux fois.
  //
  // Un mur épais de 1,5 m passe le filtre de remplissage (0,79 contre 0,55
  // exigé) : c'est le cas où les deux voies parlent du même objet.
  const epais = (x, y) => Math.abs(Math.hypot(x - COTE / 2, y - COTE / 2) - 2) < 0.75;
  const g = RASTER.rasteriser(nuageSynthetique({
    dansStructure: epais, hauteur: 0.7, classeStructure: 6, trouSol: true,
  }));
  const a = DETECTION.detecter(g).candidats;
  const b = parLaForme(g);
  assert.ok(a.length >= 1 && b.length >= 1,
    `classement ${a.length}, forme ${b.length} — le cas testé n’est plus celui où les deux voient`);

  const d = Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y);
  assert.ok(d < 2, `les deux voies désignent des points distants de ${d.toFixed(2)} m`);
});

test('la fiche produite par la voie par la forme est complète et finie', () => {
  // Les deux voies alimentent la même liste, le même export, la même fiche.
  // Un `NaN` glissé ici ne se verrait qu'à l'export, sur un fichier déjà envoyé.
  const c = parLaForme(grille(2))[0];
  for (const cle of ['x', 'y', 'lon', 'lat', 'altitude', 'surface', 'longueur', 'largeur',
    'azimut', 'rectangularite', 'elongation', 'hauteurMoy', 'penteMoy', 'partTrouSol']) {
    assert.ok(Number.isFinite(c[cle]), `${cle} vaut ${c[cle]}`);
  }
  assert.ok(c.altitude > 900 && c.altitude < 1100,
    `altitude ${c.altitude.toFixed(1)} m — attendue absolue, autour de 1000`);
});
