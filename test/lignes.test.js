// Extraction de lignes, contrôlée sur des scènes à vérité connue.
//
// Ce que ces tests protègent, ce n'est pas un chiffre mais un comportement :
// une ligne qui se referme est une structure, une ligne ouverte n'en est pas
// une, et un terrain sans structure n'en rend aucune. Les trois se cassent
// silencieusement — une chaîne qui rend zéro ressemble à s'y méprendre à un
// terrain sans ruines, et c'est précisément le piège où `sentiers.js` est resté.
//
// Les scènes viennent de `banc-lignes.js`, pour qu'il n'y ait qu'une seule
// définition du terrain synthétique : un banc qui mesure autre chose que ce que
// les tests vérifient ne prouve rien.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENES, rasteriser, COTE, MODULES } from '../tools/banc-lignes.js';

const { LIGNES, RELIEF } = MODULES;
// Aucune surcharge : les tests doivent éprouver **le chemin de production**.
// C'est en passant la portée du balayage explicitement qu'ils sont passés à côté
// d'un `svfRayonM` non défini dans `CONFIG.lignes`, qui vidait le masque de
// toute la dalle dans l'application — et seulement là.
const OPT = {};
const scene = (cle) => SCENES.find((s) => s.cle === cle);

/** Structure la plus proche du centre de la scène, où la vérité est plantée. */
function auCentre(resultat) {
  return resultat.structures
    .map((s) => ({ s, d: Math.hypot(s.cx - COTE / 2, s.cy - COTE / 2) }))
    .sort((a, b) => a.d - b.d)[0];
}

test('un orri est trouvé, fermé, et au bon endroit', () => {
  for (const classement of ['sol', 'bati']) {
    const r = LIGNES.extraire(rasteriser(scene('orri'), 0.5, classement), OPT);
    const trouve = auCentre(r);

    assert.ok(trouve, `classé ${classement} : aucune structure fermée`);
    assert.ok(trouve.d < 1, `classé ${classement} : centre à ${trouve.d.toFixed(2)} m de la vérité`);
    // 0,94 mesuré : un anneau échantillonné à 10 points/m² n'est jamais complet
    // à 1,00, et c'est bien pour ça que le seuil de fermeture est à 0,6.
    assert.ok(trouve.s.couverture > 0.85,
      `classé ${classement} : couverture ${trouve.s.couverture.toFixed(2)}`);
    assert.ok(Math.abs(trouve.s.rayon - 2) < 1,
      `classé ${classement} : rayon ${trouve.s.rayon.toFixed(2)} m pour 2 m attendus`);
  }
});

test('le classement en bâtiment ne fait pas disparaître la structure', () => {
  // Le cas qui justifie la surface enveloppe : classée 1 ou 6, la structure est
  // retirée du MNT et comblée. Une chaîne qui ne lirait que le MNT rendrait
  // zéro ici, sans que rien ne le signale.
  const sol = auCentre(LIGNES.extraire(rasteriser(scene('orri'), 0.5, 'sol'), OPT));
  const bati = auCentre(LIGNES.extraire(rasteriser(scene('orri'), 0.5, 'bati'), OPT));
  assert.ok(sol && bati);
  assert.ok(Math.abs(sol.s.rayon - bati.s.rayon) < 0.5,
    `rayons trop différents : ${sol.s.rayon.toFixed(2)} m classé sol, ${bati.s.rayon.toFixed(2)} m classé bâti`);
});

test('une cabane rectangulaire est trouvée aussi', () => {
  const trouve = auCentre(LIGNES.extraire(rasteriser(scene('cabane'), 0.5, 'sol'), OPT));
  assert.ok(trouve && trouve.d < 1, 'la cabane 6 × 4 m n’est pas retrouvée');
  assert.ok(trouve.s.couverture > 0.85, `couverture ${trouve.s.couverture.toFixed(2)}`);
});

test('la courbure du terrain ne fait ni perdre ni inventer de structure', () => {
  // Croupe et combe sont les scènes qui séparent l'ouverture du micro-relief :
  // ce dernier y allume tout le versant. Si un jour ce test se met à trouver
  // des structures en trop sur la croupe, c'est que l'entrée a changé.
  for (const cle of ['croupe', 'combe']) {
    const r = LIGNES.extraire(rasteriser(scene(cle), 0.5, 'sol'), OPT);
    const trouve = auCentre(r);
    assert.ok(trouve && trouve.d < 1, `${cle} : structure non retrouvée`);
    assert.equal(r.structures.length, 1, `${cle} : ${r.structures.length} structures pour une seule plantée`);
  }
});

test('rien n’est inventé là où il n’y a rien', () => {
  for (const cle of ['terrasse', 'chemin', 'nu']) {
    const r = LIGNES.extraire(rasteriser(scene(cle), 0.5, 'sol'), OPT);
    assert.equal(r.structures.length, 0,
      `${cle} : ${r.structures.length} structure(s) fermée(s) sur une scène qui n’en contient aucune`);
  }
});

test('un chaos rocheux allume des cellules mais ne referme aucune ligne', () => {
  // Le risque numéro un de la littérature, et le seul que le seuil ne sait pas
  // écarter : un bloc produit la même signature convexe qu'un mur. C'est la
  // topologie qui tranche — un bloc ne fait pas le tour.
  const r = LIGNES.extraire(rasteriser(scene('chaos'), 0.5, 'sol'), OPT);
  assert.ok(r.partMasque > 0.01,
    `le chaos devrait bien allumer des cellules, il n’en allume que ${(r.partMasque * 100).toFixed(1)} %`);
  assert.equal(r.structures.length, 0,
    `${r.structures.length} structure(s) fermée(s) sur un champ de blocs`);
});

test('le seuil s’exprime en degrés sous 90, et le desserrer ouvre la porte', () => {
  // Vérifie que le réglage a bien l'effet annoncé — un seuil qui ne changerait
  // rien serait le symptôme d'un paramètre non lu, faute déjà commise ailleurs.
  const chaos = rasteriser(scene('chaos'), 0.5, 'sol');
  const serre = LIGNES.extraire(chaos, { ...OPT, creuxMinDeg: 25 });
  const lache = LIGNES.extraire(chaos, { ...OPT, creuxMinDeg: 8 });
  assert.ok(lache.partMasque > serre.partMasque * 2,
    `masque ${(serre.partMasque * 100).toFixed(1)} % à 25°, ${(lache.partMasque * 100).toFixed(1)} % à 8°`);
});

test('une plateforme à bords francs n’est pas une cabane', () => {
  // Le faux positif que la géométrie seule ne peut pas écarter : le rebord d'une
  // plateforme est un anneau parfait — couverture 0,92, taille plausible. Seul
  // l'intérieur les sépare : une cabane s'enferme de 18 à 26°, ce rebord de
  // 9,9°. La marge ne fait que 2°, c'est le point fragile de la chaîne.
  for (const classement of ['sol', 'bati']) {
    const r = LIGNES.extraire(rasteriser(scene('plateforme'), 0.5, classement), OPT);
    assert.equal(r.structures.length, 0,
      `classé ${classement} : ${r.structures.length} structure(s) sur une plateforme pleine`);
  }
});

test('l’intérieur d’une structure est fermé, et c’est mesuré', () => {
  // Le critère décisif, vérifié en valeur : si un jour l'ouverture positive
  // cesse d'être calculée ou passe du mauvais signe, ce test tombe alors que la
  // détection continuerait de « marcher » en apparence.
  const r = LIGNES.extraire(rasteriser(scene('orri'), 0.5, 'sol'), OPT);
  const s = auCentre(r).s;
  assert.ok(s.interieur < 78, `intérieur mesuré à ${s.interieur.toFixed(1)}°, attendu bien sous 90`);
  assert.ok(s.hauteurMur > 0.3,
    `le mur doit dépasser de son intérieur : ${s.hauteurMur.toFixed(2)} m`);
});

