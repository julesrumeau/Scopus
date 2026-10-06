// Calcul des distances de l'outil Mesure (`mesure.js`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { MESURE } = chargerScripts(['mesure.js']);

test('sommet ajoute le sursol au sol', () => {
  assert.equal(MESURE.sommet({ sol: 100, hauteur: 5 }), 105);
  assert.equal(MESURE.sommet({ sol: 100 }), 100);   // pas de sursol : hauteur absente
  assert.equal(MESURE.sommet({ sol: 100, hauteur: 0 }), 100);
  assert.equal(MESURE.sommet({ sol: null, hauteur: 5 }), null);   // sol inconnu : rien à ajouter dessus
});

test('distance horizontale — un triangle 3-4-5', () => {
  const a = { x: 0, y: 0, sol: 10, hauteur: 0 };
  const b = { x: 3, y: 4, sol: 10, hauteur: 0 };
  const { horizontale, denivele, totale } = MESURE.distances(a, b);
  assert.equal(horizontale, 5);
  assert.equal(denivele, 0);
  assert.equal(totale, 5);
});

test('dénivelé signé — positif si B est plus haut que A, négatif dans l’autre sens', () => {
  const a = { x: 0, y: 0, sol: 100, hauteur: 0 };
  const haut = { x: 0, y: 0, sol: 112, hauteur: 0 };
  assert.equal(MESURE.distances(a, haut).denivele, 12);
  assert.equal(MESURE.distances(haut, a).denivele, -12);
});

test('distance totale — la ligne d’air, pas seulement l’horizontale', () => {
  // Base et sommet d'une antenne de 12 m, à 5 m l'un de l'autre au sol.
  const base = { x: 0, y: 0, sol: 200, hauteur: 0 };
  const sommetAntenne = { x: 3, y: 4, sol: 200, hauteur: 12 };
  const { horizontale, denivele, totale } = MESURE.distances(base, sommetAntenne);
  assert.equal(horizontale, 5);     // 3-4-5
  assert.equal(denivele, 12);
  assert.equal(totale, 13);         // 5-12-13
});

test('mesure entre deux sommets, pas entre deux sols — le sursol compte des deux côtés', () => {
  // Deux toits à la même altitude de sol mais des hauteurs différentes :
  // le dénivelé doit venir des sommets, pas être nul sous prétexte que les
  // sols, eux, sont à la même altitude.
  const a = { x: 0, y: 0, sol: 50, hauteur: 3 };
  const b = { x: 0, y: 0, sol: 50, hauteur: 8 };
  assert.equal(MESURE.distances(a, b).denivele, 5);
});

test('altitude inconnue d’un côté : dénivelé et distance totale à null, jamais inventés', () => {
  const connu = { x: 0, y: 0, sol: 100, hauteur: 0 };
  const inconnu = { x: 3, y: 4, sol: null, hauteur: 0 };
  const r = MESURE.distances(connu, inconnu);
  assert.equal(r.horizontale, 5);   // seule l'horizontale ne dépend d'aucune altitude
  assert.equal(r.denivele, null);
  assert.equal(r.totale, null);
});

test('segments — une chaîne A→B→C rend un segment par paire consécutive', () => {
  const a = { x: 0, y: 0, sol: 10, hauteur: 0 };
  const b = { x: 3, y: 4, sol: 10, hauteur: 0 };     // AB : 3-4-5
  const c = { x: 3, y: 4, sol: 22, hauteur: 0 };     // BC : que du dénivelé, +12
  const segs = MESURE.segments([a, b, c]);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].a, a); assert.equal(segs[0].b, b);
  assert.equal(segs[0].horizontale, 5);
  assert.equal(segs[1].a, b); assert.equal(segs[1].b, c);
  assert.equal(segs[1].denivele, 12);
});

test('segments — un point seul ou une chaîne vide ne produit aucun segment', () => {
  // `equal`, pas `deepEqual` : `mesure.js` tourne dans un contexte `vm` séparé
  // (voir `charger.js`), et son `[]` n'a donc pas le même prototype `Array`
  // que celui du test — une comparaison stricte des prototypes échouerait
  // sur deux tableaux pourtant identiques en contenu.
  assert.equal(MESURE.segments([]).length, 0);
  assert.equal(MESURE.segments([{ x: 0, y: 0, sol: 10 }]).length, 0);
});

test('totaux — somme des distances horizontales et 3D sur la chaîne', () => {
  // Triangle 3-4-5 puis un aller-retour vertical de 12 m : horizontale totale
  // 5 (le vertical n'en ajoute aucune), 3D totale 5 + 12 = 17.
  const a = { x: 0, y: 0, sol: 10, hauteur: 0 };
  const b = { x: 3, y: 4, sol: 10, hauteur: 0 };
  const c = { x: 3, y: 4, sol: 22, hauteur: 0 };
  const { totaleHorizontale, totale3D } = MESURE.totaux(MESURE.segments([a, b, c]));
  assert.equal(totaleHorizontale, 5);
  assert.equal(totale3D, 17);
});

test('totaux — un seul segment à altitude inconnue met le total 3D à null, jamais partiel', () => {
  const a = { x: 0, y: 0, sol: 10, hauteur: 0 };
  const b = { x: 3, y: 4, sol: 10, hauteur: 0 };
  const inconnu = { x: 3, y: 4, sol: null, hauteur: 0 };
  const { totaleHorizontale, totale3D } = MESURE.totaux(MESURE.segments([a, b, inconnu]));
  assert.equal(totaleHorizontale, 5);   // l'horizontale du segment inconnu (0 ici) compte toujours
  assert.equal(totale3D, null);
});

test('tableauHtml — une chaîne de trois points : deux segments nommés et un total', () => {
  const pts = [
    { x: 0, y: 0, sol: 100, hauteur: 0 },
    { x: 3, y: 4, sol: 100, hauteur: 12 },      // A→B : 5 m, +12 m, 13 m en 3D
    { x: 3, y: 4, sol: 100, hauteur: 0 },       // B→C : 0 m, −12 m, 12 m en 3D
  ];
  const h = MESURE.tableauHtml(pts);
  assert.match(h, /tableau-mesure/);
  assert.match(h, /A→B/);
  assert.match(h, /B→C/);
  assert.match(h, /5\.0 m/);
  assert.match(h, /\+12\.0 m/);
  assert.match(h, /13\.0 m/);
  assert.match(h, /-12\.0 m/);
  assert.match(h, /<tfoot><tr><td>Total<\/td><td>5\.0 m<\/td><td><\/td><td><\/td><td>25\.0 m<\/td>/);   // ni dénivelé ni pente totaux
});

test('tableauHtml — sous deux points, rien à tabuler', () => {
  assert.equal(MESURE.tableauHtml([]), '');
  assert.equal(MESURE.tableauHtml([{ x: 0, y: 0, sol: 1 }]), '');
});

test('tableauHtml — une altitude inconnue s’écrit « — », jamais un nombre inventé', () => {
  const h = MESURE.tableauHtml([{ x: 0, y: 0, sol: null }, { x: 3, y: 4, sol: 10 }]);
  assert.match(h, /5\.0 m/);
  assert.match(h, /—/);
});

// ── La pente d'un segment (R1) ───────────────────────────────────────────────
//
// En pourcentage seul : c'est la forme du tag OSM `incline` (`incline=15%`), que
// la personne recopie telle quelle. Les degrés ont été essayés puis retirés.

const proche = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('pente — un triangle 3-4-5 : 3 m de dénivelé sur 4 m, soit 75 %', () => {
  proche(MESURE.pente(4, 3), 75);
});

test('pente — signée comme le dénivelé : une descente est négative', () => {
  proche(MESURE.pente(4, -3), -75);
});

test('pente — un plat est 0 %, un 45° est 100 %, une pente raide dépasse 100 %', () => {
  assert.equal(MESURE.pente(10, 0), 0);
  proche(MESURE.pente(5, 5), 100);
  proche(MESURE.pente(3, 4), 4 / 3 * 100);   // 53° : 133 %
});

test('pente — horizontale nulle ou altitude inconnue : pas de valeur, jamais une pente inventée', () => {
  assert.equal(MESURE.pente(0, 5), null);          // à la verticale : rien à afficher
  assert.equal(MESURE.pente(4, null), null);       // altitude d'un bout inconnue
  assert.equal(MESURE.pente(null, 3), null);
});

test('tableauHtml — une colonne « Pente » en pourcentage, signée', () => {
  const pts = [
    { x: 0, y: 0, sol: 100, hauteur: 0 },
    { x: 4, y: 0, sol: 103, hauteur: 0 },      // A→B : 4 m, +3 m  → +75.0 %
    { x: 8, y: 0, sol: 100, hauteur: 0 },      // B→C : 4 m, −3 m  → -75.0 %
  ];
  const h = MESURE.tableauHtml(pts);
  assert.match(h, /<th>Pente<\/th>/);
  assert.match(h, /<td>\+75\.0 %<\/td>/);
  assert.match(h, /<td>-75\.0 %<\/td>/);
  assert.doesNotMatch(h, /°/);                      // plus de degrés
  // La colonne vient après le dénivelé et avant la distance 3D.
  assert.ok(h.indexOf('Dénivelé') < h.indexOf('Pente') && h.indexOf('Pente') < h.indexOf('<th>3D</th>'));
});

test('tableauHtml — une pente impossible s’écrit « — » dans sa cellule', () => {
  // Deux points au même endroit, à deux altitudes : horizontale nulle.
  const h = MESURE.tableauHtml([{ x: 0, y: 0, sol: 100, hauteur: 0 }, { x: 0, y: 0, sol: 110, hauteur: 0 }]);
  assert.match(h, /<td>\+10\.0 m<\/td>\s*<td>—<\/td>/);
});

test('tableauHtml — chaque segment a sa croix : elle retire le point d’arrivée (B, C…), son indice dans la chaîne', () => {
  const pts = [{ x: 0, y: 0, sol: 1 }, { x: 3, y: 4, sol: 2 }, { x: 6, y: 8, sol: 3 }];
  const h = MESURE.tableauHtml(pts);
  const croix = [...h.matchAll(/<button[^>]*data-retirer="(\d+)"[^>]*>/g)].map((m) => Number(m[1]));
  assert.equal(croix.join(), '1,2');
  assert.match(h, /aria-label="Retirer le point B"/);
  assert.match(h, /aria-label="Retirer le point C"/);
  assert.equal((h.match(/<th>/g) || []).length, 6, 'une colonne de plus en tête');
  assert.match(h, /<tfoot>.*<td><\/td><\/tr>\s*<\/tfoot>/s, 'et une cellule vide en pied');
});

test('retirerPoint : la chaîne sans ce point, sans toucher à l’originale ; un indice hors chaîne la rend telle quelle', () => {
  const pts = [{ x: 0 }, { x: 1 }, { x: 2 }];
  const sans = MESURE.retirerPoint(pts, 1);
  assert.equal(sans.map((p) => p.x).join(), '0,2');
  assert.equal(pts.length, 3);
  assert.equal(MESURE.retirerPoint(pts, 9).length, 3);
  assert.equal(MESURE.retirerPoint(pts, -1).length, 3);
});

// ── Shift + clic : le point tombe sur l'axe du point précédent (R20) ─────────

test('surAxe : le curseur plus loin en largeur qu’en hauteur → horizontale (même ordonnée que le repère)', () => {
  const r = MESURE.surAxe({ x: 100, y: 50 }, { x: 180, y: 62 });
  assert.deepEqual({ x: r.x, y: r.y, axe: r.axe }, { x: 180, y: 50, axe: 'h' });
});

test('surAxe : le curseur plus loin en hauteur qu’en largeur → verticale (même abscisse que le repère)', () => {
  const r = MESURE.surAxe({ x: 100, y: 50 }, { x: 108, y: 20 });
  assert.deepEqual({ x: r.x, y: r.y, axe: r.axe }, { x: 100, y: 20, axe: 'v' });
});

test('surAxe : à égalité, l’horizontale (un choix, toujours le même)', () => {
  assert.equal(MESURE.surAxe({ x: 0, y: 0 }, { x: 10, y: 10 }).axe, 'h');
  assert.equal(MESURE.surAxe({ x: 0, y: 0 }, { x: -10, y: 10 }).axe, 'h');
});

test('surAxe : fonctionne dans toutes les directions, et sur le repère lui-même ne bouge pas', () => {
  assert.deepEqual({ ...MESURE.surAxe({ x: 100, y: 50 }, { x: 40, y: 55 }) }, { x: 40, y: 50, axe: 'h' });
  assert.deepEqual({ ...MESURE.surAxe({ x: 100, y: 50 }, { x: 96, y: 200 }) }, { x: 100, y: 200, axe: 'v' });
  const meme = MESURE.surAxe({ x: 7, y: 9 }, { x: 7, y: 9 });
  assert.deepEqual([meme.x, meme.y], [7, 9]);
});
