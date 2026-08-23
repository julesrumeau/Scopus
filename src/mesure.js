// Calcul des distances entre deux points mesurés (voir « Mesure » dans
// app.js, `afficherMesure`).
//
// Séparé d'app.js pour être testable sans DOM : le calcul lui-même est pur,
// seuls le clic-clic-reset et l'affichage restent dans app.js, DOM comme le
// reste de ce fichier.

/**
 * Altitude du sommet visé en un point — un toit s'il y en a un à cet
 * endroit, le sol sinon (voir `TERRAIN.pointDuTerrain` et `Vue2D.lire`, qui
 * rendent tous deux `sol` et `hauteur` séparément). C'est cette valeur, pas
 * le sol seul, qui sert de position réelle du point : mesurer entre deux
 * sommets cliqués — la base et le haut d'une antenne, par exemple — est le
 * geste attendu, pas mesurer entre deux sols en ignorant ce qui a été
 * cliqué.
 *
 * @param {{sol: ?number, hauteur?: number}} p
 * @returns {?number} `null` si le sol est inconnu à ce point
 */
function sommet(p) {
  return p.sol == null ? null : p.sol + (p.hauteur || 0);
}

/**
 * Distances entre deux points mesurés, en mètres — horizontale, dénivelé
 * (signé, positif si `b` est plus haut que `a`) et totale (ligne d'air).
 *
 * `denivele` et `totale` valent `null` si l'altitude de l'un des deux points
 * est inconnue (sol non comblé à cet endroit) : mieux vaut le dire que
 * d'inventer un dénivelé à partir d'un sol absent.
 *
 * @param {{x: number, y: number, sol: ?number, hauteur?: number}} a
 * @param {{x: number, y: number, sol: ?number, hauteur?: number}} b
 */
function distances(a, b) {
  const horizontale = Math.hypot(b.x - a.x, b.y - a.y);
  const sA = sommet(a), sB = sommet(b);
  const connue = sA != null && sB != null;
  const denivele = connue ? sB - sA : null;
  const totale = connue ? Math.hypot(horizontale, denivele) : null;
  return { horizontale, denivele, totale };
}

/**
 * Segments d'une chaîne de points mesurés, dans l'ordre du clic — un par
 * paire consécutive (A→B, B→C, …), chacun avec ses trois distances (voir
 * `distances`). Une chaîne à un seul point ou vide rend un tableau vide :
 * pas de segment sans deux extrémités.
 *
 * @param {Array<{x: number, y: number, sol: ?number, hauteur?: number}>} points
 * @returns {Array<{a: object, b: object, horizontale: number, denivele: ?number, totale: ?number}>}
 */
function segments(points) {
  const s = [];
  for (let i = 0; i + 1 < points.length; i++) s.push({ a: points[i], b: points[i + 1], ...distances(points[i], points[i + 1]) });
  return s;
}

/**
 * Totaux d'une chaîne de segments (voir `segments`) : somme des distances
 * horizontales, et somme des distances totales (ligne d'air, 3D).
 *
 * `totale3D` vaut `null` dès qu'un seul segment a une altitude inconnue à
 * l'un de ses bouts — une somme partielle se lirait comme une vraie tout en
 * la sous-évaluant, silencieusement. `totaleHorizontale`, elle, ne dépend
 * d'aucune altitude et se somme donc toujours.
 *
 * @param {Array<{horizontale: number, totale: ?number}>} segs sortie de `segments`
 */
function totaux(segs) {
  const totaleHorizontale = segs.reduce((s, seg) => s + seg.horizontale, 0);
  const totale3D = segs.some((seg) => seg.totale == null)
    ? null
    : segs.reduce((s, seg) => s + seg.totale, 0);
  return { totaleHorizontale, totale3D };
}

const MESURE = { sommet, distances, segments, totaux };
