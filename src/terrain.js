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
 * où il croise le MNT. Renvoie `{x, y, altitude}` en Lambert-93 absolu, ou
 * `null` si le rayon ne croise jamais le terrain dans l'emprise de la grille
 * (viser hors du nuage, au-dessus de l'horizon).
 *
 * @param {{oeil: number[], direction: number[]}} rayon repère monde, direction unitaire
 * @param {object} grille sortie de RELIEF.preparer (W, H, pas, emprise, origine, mnt)
 * @param {number} exagerationZ exagération verticale courante (CONFIG.rendu.exagerationZ)
 * @param {number} zmin altitude locale minimale du nuage (Vue3D.zmin)
 */
function pointDuTerrain(rayon, grille, exagerationZ, zmin) {
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
  const ecart = (tau) => {
    const i = cellule(tau);
    return i == null ? null : (oy + dy * tau) - (t.mnt[i] - zmin) * exagerationZ;
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
        altitude: t.mnt[c] + t.origine[2],
      };
    }
    tauA = tauB; eA = eB;
  }
  return null;
}

const TERRAIN = { pointDuTerrain };
