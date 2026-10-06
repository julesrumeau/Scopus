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

/**
 * La pente d'un segment, **en pourcentage** (dénivelé / horizontale × 100),
 * signée comme le dénivelé : montée positive, descente négative. C'est la forme
 * du tag OSM `incline` (`incline=15%`), que la personne recopie telle quelle ;
 * les degrés ont été essayés puis retirés (le wiki OSM ne les préfère que là où
 * ils sont d'usage courant). Une pente raide dépasse 100 % : 45° font 100 %.
 *
 * `null` si l'horizontale est nulle — une pente verticale n'a pas de valeur à
 * afficher — ou si l'une des deux distances est inconnue : une altitude
 * absente ne se devine pas. Pas de pente « totale » d'une chaîne, pour la même
 * raison que pour le dénivelé : une somme signée ne dirait rien de juste.
 *
 * @param {?number} horizontale distance horizontale, en mètres
 * @param {?number} denivele dénivelé signé, en mètres
 * @returns {?number} pourcentage, ou `null`
 */
function pente(horizontale, denivele) {
  if (horizontale == null || denivele == null || !(horizontale > 1e-9)) return null;
  return (denivele / horizontale) * 100;
}

/**
 * Le tableau de la mesure en chaîne (Segment / Horizontale / Dénivelé / 3D,
 * avec le total) pour une liste de points — le même dans le panneau de la
 * carte et dans la modale du profil, pour qu'il n'y ait qu'un outil de mesure.
 * Vide sous deux points : il n'y a pas encore de segment à tabuler.
 *
 * @param {Array<{x: number, y: number, sol: ?number, hauteur?: number}>} points
 * @returns {string} du HTML, ou '' sans segment
 */
function tableauHtml(points) {
  const segs = segments(points);
  if (!segs.length) return '';
  const lettre = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
  const m = (v) => (v == null ? '—' : `${v.toFixed(1)} m`);
  const signe = (v) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)} m`);
  const penteTexte = (sg) => {
    const p = pente(sg.horizontale, sg.denivele);
    return p == null ? '—' : `${p >= 0 ? '+' : ''}${p.toFixed(1)} %`;
  };
  const { totaleHorizontale, totale3D } = totaux(segs);
  const rangees = segs.map((s, i) => `<tr>
      <td>${lettre(i)}→${lettre(i + 1)}</td>
      <td>${m(s.horizontale)}</td>
      <td>${signe(s.denivele)}</td>
      <td>${penteTexte(s)}</td>
      <td>${m(s.totale)}</td>
      <td class="retirer"><button type="button" class="retirer-point" data-retirer="${i + 1}" aria-label="Retirer le point ${lettre(i + 1)}" title="Retirer le point ${lettre(i + 1)}">✕</button></td>
    </tr>`).join('');
  return `<div class="mesure-scroll"><table class="tableau-mesure">
      <thead><tr><th>Segment</th><th>Horizontale</th><th>Dénivelé</th><th>Pente</th><th>3D</th><th></th></tr></thead>
      <tbody>${rangees}</tbody>
      <tfoot><tr><td>Total</td><td>${m(totaleHorizontale)}</td><td></td><td></td><td>${m(totale3D)}</td><td></td></tr></tfoot>
    </table></div>`;
}

/** La chaîne sans son point `i` (l'originale n'est pas touchée) ; un indice hors chaîne la rend telle quelle. */
function retirerPoint(points, i) {
  return i >= 0 && i < points.length ? points.filter((_, k) => k !== i) : points.slice();
}

/**
 * Shift + clic : le point tombe sur l'axe, vertical ou horizontal, du repère (le point précédent de la chaîne).
 * Dans l'espace de l'écran (pixels), là où la personne voit la ligne : l'axe retenu est celui où le curseur est le plus
 * éloigné du repère, et l'autre coordonnée reste celle du repère. À égalité, l'horizontale.
 * @returns {{x: number, y: number, axe: 'h' | 'v'}}
 */
function surAxe(repere, curseur) {
  const horizontal = Math.abs(curseur.x - repere.x) >= Math.abs(curseur.y - repere.y);
  return horizontal
    ? { x: curseur.x, y: repere.y, axe: 'h' }
    : { x: repere.x, y: curseur.y, axe: 'v' };
}

const MESURE = { surAxe, sommet, distances, segments, totaux, pente, tableauHtml, retirerPoint };
