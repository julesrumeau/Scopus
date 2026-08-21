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

const MESURE = { sommet, distances };
