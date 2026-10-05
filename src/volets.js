// Les volets de la vue normale : une carte Leaflet, son calque de relief (`CalqueRelief`) et les côtés
// qu'elle porte. Aujourd'hui un seul volet, qui porte les deux côtés (carte scindée par le rideau, ou
// une seule carte) ; deux cartes synchronisées en auront deux, un côté chacun (TODO R10). `app.js`
// passe par ici pour tout ce qui dépend de la carte d'un côté : où poser son image, quel écran envoyer
// au worker, quel côté est sous le curseur.
//
// Ici, la logique sans écran ni Leaflet, pour se tester à froid.

const VOLETS = (() => {
  /** Le volet qui porte `cote`, ou `null` si aucun. */
  function voletDe(volets, cote) {
    return volets.find((v) => v.cotes.includes(cote)) || null;
  }

  /**
   * L'écran d'une carte au moment de la demande : le worker y reprojette le relief, et l'image se
   * pose sur ces bornes-là — pas sur celles du retour, si la carte a bougé entre-temps.
   * `pixelBounds` : `{ min: {x, y}, max: {x, y} }` en pixels du plan au zoom `z`.
   */
  function ecran(pixelBounds, z, territoire) {
    const { min, max } = pixelBounds;
    return { x0: min.x, y0: min.y, W: Math.round(max.x - min.x), H: Math.round(max.y - min.y), z, territoire };
  }

  /**
   * Le côté sous le pixel `px` d'un volet : le seul qu'il porte, ou celui que dit le rideau quand il
   * en porte deux.
   */
  function coteSous(volet, px) {
    return volet.cotes.length === 1 ? volet.cotes[0] : volet.calque.coteSous(px);
  }

  return { voletDe, ecran, coteSous };
})();
