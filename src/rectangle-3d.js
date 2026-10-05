// Le rectangle au sol de la 3D : ce que la carte montrerait à ce zoom, sur la taille de la scène (la zone
// qui porte la carte et la 3D). La caméra y est posée à l'échelle de la carte et n'en sort pas : les points
// à charger sont bornés, comme sur la carte. Des fonctions pures, sans WebGL ni DOM.

const RECTANGLE_3D = (() => {
  const tanDemi = (fovDeg) => Math.tan((fovDeg / 2) * Math.PI / 180);

  /** La distance de la caméra qui donne `mpp` mètres par pixel CSS au point visé (champ vertical `fovDeg`). */
  function distanceDepuisResolution(mpp, hauteurPx, fovDeg) {
    return (mpp * hauteurPx) / (2 * tanDemi(fovDeg));
  }

  /** L'inverse : les mètres par pixel CSS au point visé, à la distance `d`. */
  function resolutionDepuisDistance(d, hauteurPx, fovDeg) {
    return (2 * d * tanDemi(fovDeg)) / hauteurPx;
  }

  /**
   * Le rectangle au sol de la scène : centré sur `centre` (Lambert local), à `mpp` mètres par pixel CSS, sur
   * `largeurPx` × `hauteurPx`. Calculé ici plutôt que lu sur la carte : Leaflet arrondit le zoom, un lien en
   * a deux décimales.
   */
  function depuisCentre(centre, mpp, largeurPx, hauteurPx) {
    const demiL = (largeurPx * mpp) / 2, demiH = (hauteurPx * mpp) / 2;
    return { xmin: centre.x - demiL, xmax: centre.x + demiL, ymin: centre.y - demiH, ymax: centre.y + demiH, largeurPx };
  }

  /**
   * Où poser la caméra pour la zone de la carte : au centre du rectangle, à l'échelle de la carte (mètres par
   * pixel = largeur du rectangle / largeur de la scène), à la distance qui la reproduit.
   * @param {{xmin:number, xmax:number, ymin:number, ymax:number, largeurPx:number}} rect
   */
  function poseDepuisRectangle(rect, hauteurPx, fovDeg) {
    const mpp = (rect.xmax - rect.xmin) / rect.largeurPx;
    return {
      x: (rect.xmin + rect.xmax) / 2,
      y: (rect.ymin + rect.ymax) / 2,
      mpp,
      distance: distanceDepuisResolution(mpp, hauteurPx, fovDeg),
    };
  }

  /** L'emprise (Lambert local) en coordonnées de la cible de la caméra : x vers l'est, z vers le sud. */
  function rectangleCible(emprise, origine) {
    return {
      xmin: emprise.xmin - origine[0], xmax: emprise.xmax - origine[0],
      zmin: origine[1] - emprise.ymax, zmax: origine[1] - emprise.ymin,
    };
  }

  /** La cible ramenée dans le rectangle (sa hauteur ne change pas) ; sans rectangle, telle quelle. */
  function limiterCible(cible, r) {
    if (!r) return [cible[0], cible[1], cible[2]];
    return [Math.min(r.xmax, Math.max(r.xmin, cible[0])), cible[1], Math.min(r.zmax, Math.max(r.zmin, cible[2]))];
  }

  /**
   * La plus grande distance de la caméra : de quoi voir tout le rectangle d'au-dessus, avec 30 % de marge.
   * Une scène plus étroite que haute est bornée par la largeur du rectangle.
   * @param {number} aspect largeur / hauteur de la scène
   */
  function distanceMax(emprise, fovDeg, aspect) {
    if (!emprise) return Infinity;
    const l = emprise.xmax - emprise.xmin, h = emprise.ymax - emprise.ymin;
    return (1.3 * Math.max(h, l / aspect)) / (2 * tanDemi(fovDeg));
  }

  return { distanceDepuisResolution, resolutionDepuisDistance, depuisCentre, poseDepuisRectangle, rectangleCible, limiterCible, distanceMax };
})();
