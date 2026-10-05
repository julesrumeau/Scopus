// Contour d'une emprise de dalle (ou de bloc) en [lat, lon] pour Leaflet.
//
// Une dalle est exactement [X·1000, (X+1)·1000] × [(Y−1)·1000, Y·1000] en Lambert-93 : son contour se
// déduit, sans interroger le WFS (qui plafonne à 600 entités en silence). L'ancienne couche de
// quadrillage kilométrique a disparu avec le parcours « ?dalle ».

/**
 * Contour d'une emprise Lambert-93 — ou d'un autre territoire, par `versGeo`
 * (PROJ.projectionDe) —, en [lat, lon] pour Leaflet.
 *
 * Les côtés sont échantillonnés et non réduits à leurs extrémités : en WGS84 un
 * carré Lambert-93 n'est ni aligné sur les axes ni tout à fait droit. C'est
 * précisément l'erreur qui faisait qu'une zone d'intérêt tracée en
 * `L.rectangle` — donc alignée sur l'écran — paraissait de travers par rapport
 * à la dalle qui la contenait.
 */
function contourEmprise(em, parCote = 8, versGeo = PROJ.versWGS84) {
  const pts = [];
  const ajouter = (x, y) => { const g = versGeo(x, y); pts.push([g.lat, g.lon]); };
  for (let i = 0; i < parCote; i++) ajouter(em.xmin + (em.xmax - em.xmin) * i / parCote, em.ymin);
  for (let i = 0; i < parCote; i++) ajouter(em.xmax, em.ymin + (em.ymax - em.ymin) * i / parCote);
  for (let i = 0; i < parCote; i++) ajouter(em.xmax - (em.xmax - em.xmin) * i / parCote, em.ymax);
  for (let i = 0; i < parCote; i++) ajouter(em.xmin, em.ymax - (em.ymax - em.ymin) * i / parCote);
  return pts;
}

const GRILLE = { contourEmprise };
