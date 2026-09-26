// Géométrie de la grille de la vue.
//
// Le relief de la vue se calcule dans une grille Lambert-93 alignée sur les
// axes, qui couvre la vue plus une marge : le Sky-View Factor d'une case du
// bord regarde à `svfRayonM` autour d'elle, le micro-relief à trois rayons.
//
// Tout est en **centimètres entiers** : le coin de la grille est un multiple
// du pas, et les points arrivent en centimètres entiers (decodeur.js). La case
// d'un point est alors une division entière, identique au processeur et sur la
// carte graphique — en flottants, 0,03 % des cases différaient (mesuré), les
// points pile sur une limite tombant d'un côté ou de l'autre selon l'arrondi.
// L'alignement sur un multiple du pas garde aussi les mêmes cases d'une vue à
// l'autre au même zoom : un déplacement décale la grille d'un nombre entier de
// cases.

const VUE_GRILLE = (() => {
  function definir(vue, pasM, margeM, coteMax) {
    let pasCm = Math.max(1, Math.round(pasM * 100));
    for (;;) {
      const xminCm = Math.floor(((vue.xmin - margeM) * 100) / pasCm) * pasCm;
      const yminCm = Math.floor(((vue.ymin - margeM) * 100) / pasCm) * pasCm;
      const W = Math.max(1, Math.ceil(((vue.xmax + margeM) * 100 - xminCm) / pasCm));
      const H = Math.max(1, Math.ceil(((vue.ymax + margeM) * 100 - yminCm) / pasCm));
      if (W <= coteMax && H <= coteMax) {
        return {
          xminCm, yminCm, pasCm, W, H, pas: pasCm / 100,
          emprise: { xmin: xminCm / 100, ymin: yminCm / 100, xmax: (xminCm + W * pasCm) / 100, ymax: (yminCm + H * pasCm) / 100 },
        };
      }
      pasCm = Math.ceil((pasCm * Math.max(W, H)) / coteMax);
    }
  }

  /** Passes de comblement pour une distance en mètres : au moins une. */
  function passes(metres, pasM) {
    return Math.max(1, Math.round(metres / pasM));
  }

  /** Rayon en cases d'une distance en mètres : zéro sous un demi-pas. */
  function rayon(metres, pasM) {
    return Math.max(0, Math.round(metres / pasM));
  }

  /**
   * Marge autour de la vue, en mètres : la plus grande portée des couches
   * (SVF, micro-relief à trois rayons), plus celles du comblement et du
   * lissage du terrain, qui les précèdent.
   */
  function marge(p) {
    return Math.max(p.svfRayonM, 3 * p.rayonMicroReliefM) + p.comblementM + p.lissageM;
  }

  function coupe(e, geo) {
    const g = geo.emprise;
    return e.xmin < g.xmax && e.xmax > g.xmin && e.ymin < g.ymax && e.ymax > g.ymin;
  }

  return { definir, passes, rayon, marge, coupe };
})();
