// Intersection d'un rayon caméra 3D avec le MNT affiché (`RELIEF.preparer`).
//
// Sert à viser précisément un point du terrain au clic, en mode Sélection
// (voir app.js) : le plan horizontal utilisé pour le déplacement de la
// caméra (`Vue3D._pointSousCurseur`) n'est qu'une approximation, faite pour
// un glissé fluide, pas pour lire une altitude.
//
// Repère du rayon : le même « monde » que le rendu — `rayon.oeil` et
// `rayon.direction` (unitaire) en sortent directement (`Vue3D.rayonEcran`).
// `shaders.js` pose ce repère : monde = (x, (z − zmin) · exagération, −y), où
// x, y sont les coordonnées Lambert-93 locales du nuage (relatives à
// `grille.origine`). D'où les conversions ci-dessous, à l'identique de ce que
// fait le vertex shader — mais en sens inverse, du monde vers Lambert-93.

/**
 * Marche le rayon par pas grossiers puis affine par bissection, pour trouver
 * où il croise le terrain. Renvoie `{x, y, sol, hauteur}` en Lambert-93
 * absolu, ou `null` si le rayon ne croise jamais le terrain dans l'emprise de
 * la grille (viser hors du nuage, au-dessus de l'horizon).
 *
 * Vise l'**enveloppe** `mnt + hauteur` (sol comblé, ou sommet d'un bâtiment
 * là où il y en a un), pas le sol seul. Sans ça, un rayon qui traverse un
 * bâtiment ne le voit pas — le sol sous un bâtiment est une surface
 * interpolée, jamais rendue à l'écran — et repart taper le sol ailleurs,
 * pas là où l'écran montrait quelque chose sous le curseur. Viser
 * l'enveloppe fait toujours toucher ce qui est visuellement sous le clic,
 * sol ou toit. `sol` et `hauteur` sont rendus séparément : la cellule
 * touchée donne les deux sans coût de plus, et l'appelant choisit comment
 * les afficher.
 *
 * `hauteur` ne s'arrête pas au signal de détection (non classé, bâtiment) :
 * elle monte jusqu'au sommet toutes classes de `grille.sommet` s'il dépasse
 * — végétation, pont, tout ce qu'un point visible porte. Sélectionner ou
 * mesurer doit pouvoir viser n'importe quel point du nuage, pas seulement
 * ceux qu'utilise la détection ; `grille.sommet` peut manquer (grilles de
 * test), auquel cas le comportement retombe exactement sur l'ancien.
 *
 * Mais un point démasqué (§ « Filtrage des classes ») n'est plus rendu du
 * tout — le vertex shader le rejette, alpha à zéro. Sans `classesMasquees`,
 * `grille.sommet` continuerait de pointer sur lui : le rayon s'arrêterait en
 * l'air, à la position d'un arbre qu'on vient de décocher, sur un point
 * devenu invisible qu'on ne peut donc plus mesurer. `grille.sommetCls` porte
 * la classe qui détient ce maximum ; masquée, la cellule retombe sur
 * `hauteur` seule — au pire, sur le deuxième point le plus haut si un autre
 * a été vu et que sa classe reste, elle, affichée.
 *
 * @param {{oeil: number[], direction: number[]}} rayon repère monde, direction unitaire
 * @param {object} grille sortie de RELIEF.preparer (W, H, pas, emprise, origine, mnt, hauteur)
 * @param {number} exagerationZ exagération verticale courante (CONFIG.rendu.exagerationZ)
 * @param {number} zmin altitude locale minimale du nuage (Vue3D.zmin)
 * @param {?Set<number>} [classesMasquees] classes actuellement décochées (§ « Filtrage des classes »)
 */
function pointDuTerrain(rayon, grille, exagerationZ, zmin, classesMasquees = null) {
  const t = grille;
  if (!t) return null;

  const [ox, oy, oz] = rayon.oeil;
  const [dx, dy, dz] = rayon.direction;

  // Bornes du rayon dans l'emprise de la grille, en Lambert-93 — sans elles un
  // rayon vers le ciel marcherait pour rien jusqu'à la limite de distance.
  const borne = (origine, pente, min, max) => {
    if (Math.abs(pente) < 1e-9) return origine >= min && origine <= max ? [0, Infinity] : null;
    const a = (min - origine) / pente, b = (max - origine) / pente;
    return pente > 0 ? [a, b] : [b, a];
  };
  const bx = borne(ox + t.origine[0], dx, t.emprise.xmin, t.emprise.xmax);
  const by = borne(t.origine[1] - oz, -dz, t.emprise.ymin, t.emprise.ymax);
  if (!bx || !by) return null;

  const tauMin = Math.max(0, bx[0], by[0]);
  const tauMax = Math.min(bx[1], by[1], tauMin + 4000);   // jamais plus loin qu'une dalle
  if (!(tauMax > tauMin) || !Number.isFinite(tauMin)) return null;

  const cellule = (tau) => {
    const lx = ox + dx * tau + t.origine[0];
    const ly = t.origine[1] - (oz + dz * tau);
    const cx = Math.floor((lx - t.emprise.xmin) / t.pas);
    const cy = Math.floor((ly - t.emprise.ymin) / t.pas);
    return cx >= 0 && cx < t.W && cy >= 0 && cy < t.H ? cy * t.W + cx : null;
  };
  // Hauteur au-dessus du sol comblé, à cette cellule : celle du signal de
  // détection, ou celle de n'importe quel point toutes classes s'il domine —
  // un arbre ou un pont, par exemple, que `t.hauteur` seul ne voit pas.
  const hauteurEnveloppe = (i) => {
    const struct = t.hauteur[i] || 0;
    const masque = t.sommetCls && classesMasquees && classesMasquees.has(t.sommetCls[i]);
    const som = t.sommet && !masque ? t.sommet[i] : -Infinity;
    return som > t.mnt[i] + struct ? som - t.mnt[i] : struct;
  };
  const enveloppe = (i) => t.mnt[i] + hauteurEnveloppe(i);
  const ecart = (tau) => {
    const i = cellule(tau);
    return i == null ? null : (oy + dy * tau) - (enveloppe(i) - zmin) * exagerationZ;
  };

  // Pas grossier pour trouver où le rayon passe sous le terrain, puis
  // quelques bissections pour affiner — bien moins d'itérations qu'un pas fin
  // sur toute la longueur, pour la même précision au point trouvé.
  const PAS = 1500;
  const dTau = (tauMax - tauMin) / PAS;
  let tauA = tauMin, eA = ecart(tauA);
  for (let i = 1; i <= PAS; i++) {
    const tauB = tauMin + i * dTau;
    const eB = ecart(tauB);
    if (eA != null && eB != null && eA > 0 && eB <= 0) {
      let lo = tauA, hi = tauB;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2;
        const em = ecart(mid);
        if (em == null || em > 0) lo = mid; else hi = mid;
      }
      const tau = (lo + hi) / 2;
      const c = cellule(tau);
      if (c == null) return null;
      return {
        x: ox + dx * tau + t.origine[0],
        y: t.origine[1] - (oz + dz * tau),
        sol: t.mnt[c] + t.origine[2],
        hauteur: hauteurEnveloppe(c),
      };
    }
    tauA = tauB; eA = eB;
  }
  return null;
}

/**
 * Point du nuage **réellement affiché** le plus proche du rayon de clic —
 * pas une moyenne de cellule. Sert de premier essai à la sélection et à la
 * mesure en 3D (`app.js`), `pointDuTerrain` ne restant qu'un repli.
 *
 * Pourquoi ce repli existait ne suffisait pas : `pointDuTerrain` vise
 * `mnt + hauteur`, une surface **lissée** par cellule (moyenne du sol,
 * signal de détection), alors que les points affichés viennent d'un niveau
 * d'octree délibérément plus grossier que la grille de détection
 * (`NUAGE.niveauPourAffichage` — souvent 85 cm à 1,7 m d'espacement contre
 * 25 à 50 cm de cellule). Un point réel peut donc s'écarter nettement de la
 * moyenne de sa cellule, et cliquer dessus retombait « à côté ». Viser le
 * nuage lui-même élimine l'écart par construction : le point trouvé est
 * toujours l'un de ceux qu'on voit, jamais une moyenne.
 *
 * Le seuil d'acceptation est en **pixels à l'écran**, converti en unités du
 * monde à la profondeur de chaque candidat (`2 · t · tan(fovY/2) / hauteurPx`) :
 * un seuil fixe en mètres serait trop permissif de près et raterait tout de
 * loin. Parmi les points dans le seuil, celui le plus proche de la caméra
 * gagne — c'est celui qui occulterait les autres à l'écran, donc celui que
 * l'œil voit réellement au pixel visé.
 *
 * Un simple balayage linéaire, pas une structure spatiale : appelé une fois
 * par clic, pas par image, le coût (quelques dizaines de ms sur plusieurs
 * millions de points) ne s'amortit pas assez souvent pour justifier d'en
 * construire une.
 *
 * @param {{oeil: number[], direction: number[]}} rayon repère monde, direction unitaire
 * @param {?{x:Float32Array, y:Float32Array, z:Float32Array, cls:Uint8Array, n:number, origine:number[]}} nuage
 * @param {object} opts
 * @param {number} opts.zmin altitude locale minimale du nuage (Vue3D.zmin)
 * @param {number} opts.exagerationZ exagération verticale courante
 * @param {number} opts.fovYdeg champ de vision vertical, en degrés (celui du rendu)
 * @param {number} opts.hauteurPx hauteur du canevas, en pixels CSS
 * @param {number} [opts.toleragePx] rayon d'acceptation, en pixels
 * @param {?Set<number>} [opts.classesMasquees] classes actuellement décochées
 * @returns {?{x: number, y: number, sol: number, hauteur: number}} Lambert-93 absolu, ou `null`
 */
function pointDuNuage(rayon, nuage, opts) {
  if (!nuage || !nuage.n || !(opts.hauteurPx > 0)) return null;
  const { zmin, exagerationZ, fovYdeg, hauteurPx, toleragePx = 8, classesMasquees = null } = opts;
  const [ox, oy, oz] = rayon.oeil;
  const [dx, dy, dz] = rayon.direction;
  const echellePixel = 2 * Math.tan((fovYdeg * Math.PI / 180) / 2) / hauteurPx;

  const { x, y, z, cls, n } = nuage;
  let meilleurT = Infinity, meilleurI = -1;

  for (let i = 0; i < n; i++) {
    if (classesMasquees && classesMasquees.has(cls[i])) continue;

    const wx = x[i], wy = (z[i] - zmin) * exagerationZ, wz = -y[i];
    const vx = wx - ox, vy = wy - oy, vz = wz - oz;
    const t = vx * dx + vy * dy + vz * dz;
    if (t <= 0 || t >= meilleurT) continue;   // derrière la caméra, ou déjà moins bon

    const ecX = wx - (ox + dx * t), ecY = wy - (oy + dy * t), ecZ = wz - (oz + dz * t);
    const tol = echellePixel * t * toleragePx;
    if (ecX * ecX + ecY * ecY + ecZ * ecZ <= tol * tol) { meilleurT = t; meilleurI = i; }
  }

  if (meilleurI < 0) return null;
  return {
    x: x[meilleurI] + nuage.origine[0],
    y: y[meilleurI] + nuage.origine[1],
    sol: z[meilleurI] + nuage.origine[2],
    hauteur: 0,
  };
}

const TERRAIN = { pointDuTerrain, pointDuNuage };
