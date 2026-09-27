// Décisions du chargement piloté par la vue : quel pas de grille, quel niveau
// d'octree, quels blocs et dans quel ordre, quoi libérer sous le budget.
//
// Fonctions pures, sans réseau ni DOM : c'est ici que se tranchent les
// questions qui se testent, et `flux.js` n'a plus qu'à exécuter.

const FLUX_CHOIX = (() => {
  /**
   * Surface affichée, en km², du rectangle Lambert-93 de la vue. C'est elle,
   * et non le zoom ni la seule largeur, qui fixe le nombre de dalles, donc le
   * temps de chargement : une même largeur couvre deux fois plus de terrain
   * sur un écran deux fois plus haut.
   */
  function surfaceKm2(vue) {
    return ((vue.xmax - vue.xmin) * (vue.ymax - vue.ymin)) / 1e6;
  }

  /** Pas de grille : un pixel au sol, jamais plus fin que le plancher. */
  function pasPourVue(largeurM, largeurPx, pasMinM) {
    return Math.max(pasMinM, largeurM / Math.max(1, largeurPx));
  }

  /**
   * Emprise d'un bloc, sans l'en-tête du fichier.
   *
   * Le cube de l'octree est dans l'en-tête, qu'on ne lit plus. Sur les 7
   * dalles mesurées, il coïncide avec la dalle (demi-côté 500 m, centré) :
   * au niveau n, la dalle est découpée en 2ⁿ × 2ⁿ carrés de 1000 / 2ⁿ m.
   * Hypothèse vérifiée en navigateur sur données réelles (points décodés
   * contre emprise calculée, voir CLAUDE.md).
   */
  function empriseBloc(empriseDalle, cle) {
    const c = 1000 / 2 ** cle.n;
    const xmin = empriseDalle.xmin + cle.x * c;
    const ymin = empriseDalle.ymin + cle.y * c;
    return { xmin, xmax: xmin + c, ymin, ymax: ymin + c };
  }

  /**
   * Le niveau le plus grossier dont la densité cumulée (points de l'index,
   * toutes classes, rapportés à la surface de la dalle) atteint
   * `pointsParCase` par case de `pasM`. Faute de mieux, le plus fin.
   */
  function niveauVise(dalle, pasM, pointsParCase) {
    const surface = dalle.surfaceM2 ?? 1e6;
    const parNiveau = [];
    for (const n of dalle.index.values()) parNiveau[n.cle.n] = (parNiveau[n.cle.n] || 0) + n.nbPoints;
    const cible = pointsParCase / (pasM * pasM);
    let cumul = 0;
    let plusFin = 0;
    for (let k = 0; k < parNiveau.length; k++) {
      if (!parNiveau[k]) continue;
      cumul += parNiveau[k];
      plusFin = k;
      if (cumul / surface >= cible) return k;
    }
    return plusFin;
  }

  const coupe = (e, v) => e.xmax > v.xmin && e.xmin < v.xmax && e.ymax > v.ymin && e.ymin < v.ymax;

  const distanceAuCentre = (e, v) => Math.hypot(
    (e.xmin + e.xmax) / 2 - (v.xmin + v.xmax) / 2,
    (e.ymin + e.ymax) / 2 - (v.ymin + v.ymax) / 2,
  );

  /**
   * Les blocs qu'appelle la vue : pour chaque dalle, ceux des niveaux jusqu'au
   * niveau visé qui coupent la vue. Ordre : niveau croissant, puis distance au
   * centre — tout l'écran atteint un niveau avant que le suivant ne commence,
   * en partant du centre (l'ordre de Potree : jamais un centre net entouré de
   * bords vides). Tronqués au budget : un bloc au-delà n'est pas demandé, ce
   * qui évite de le libérer puis de le redemander aussitôt.
   */
  function blocsPourVue(dalles, vue, pasM, pointsParCase, budgetPoints) {
    const tous = [];
    for (const d of dalles) {
      const n = niveauVise(d, pasM, pointsParCase);
      for (const [k, noeud] of d.index) {
        if (noeud.cle.n > n) continue;
        const emprise = empriseBloc(d.emprise, noeud.cle);
        if (!coupe(emprise, vue)) continue;
        tous.push({ cle: `${d.url}#${k}`, url: d.url, noeud, niveau: noeud.cle.n, emprise, distance: distanceAuCentre(emprise, vue) });
      }
    }
    tous.sort((a, b) => a.niveau - b.niveau || a.distance - b.distance);
    const retenus = [];
    let points = 0;
    for (const b of tous) {
      if (points + b.noeud.nbPoints > budgetPoints) break;
      points += b.noeud.nbPoints;
      retenus.push(b);
    }
    return retenus;
  }

  /**
   * Ce qu'il faut libérer pour repasser sous le budget : jamais un bloc
   * voulu par la vue ; parmi les autres, le plus fin puis le plus loin
   * d'abord — le grossier coûte peu et resservira au moindre dézoom.
   */
  function aLiberer(charges, voulues, budgetPoints, vue) {
    let total = charges.reduce((s, c) => s + c.nbPoints, 0);
    if (total <= budgetPoints) return [];
    const candidats = charges.filter((c) => !voulues.has(c.cle))
      .sort((a, b) => b.niveau - a.niveau || distanceAuCentre(b.emprise, vue) - distanceAuCentre(a.emprise, vue));
    const out = [];
    for (const c of candidats) {
      if (total <= budgetPoints) break;
      out.push(c.cle);
      total -= c.nbPoints;
    }
    return out;
  }

  return { surfaceKm2, pasPourVue, empriseBloc, niveauVise, blocsPourVue, aLiberer };
})();
