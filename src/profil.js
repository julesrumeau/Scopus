// Le profil topographique : géométrie de la bande, validité, mesure sur le
// graphique. Pur — aucun DOM, aucun réseau — pour se tester à froid, et écrit
// en `function fabriqueProfil()` : son texte part tel quel dans le worker du
// relief (relief-travailleur.js), où `VUE_RELIEF.profil` le consulte.
// Conception : docs/superpowers/specs/2026-10-01-profil-design.md.

function fabriqueProfil() {
  /** L'axe A→B : longueur, vecteur unitaire le long de l'axe (u) et à sa gauche (n). `null` si A = B. */
  function axe(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const longueur = Math.hypot(dx, dy);
    if (!(longueur > 0)) return null;
    return { longueur, ux: dx / longueur, uy: dy / longueur, nx: -dy / longueur, ny: dx / longueur };
  }

  /** Une largeur utilisable : jamais nulle, négative ni infinie, même saisie à la main. */
  function largeurValide(l) {
    const { largeurMinM, largeurMaxM, largeurDefautM } = CONFIG.profil;
    if (!Number.isFinite(l)) return largeurDefautM;
    return Math.min(largeurMaxM, Math.max(largeurMinM, l));
  }

  /** Peut-on calculer un profil entre ces deux points ? Sinon, la consigne à afficher. */
  function verdict(a, b) {
    const { longueurMinM, longueurMaxM } = CONFIG.profil;
    const ax = axe(a, b);
    if (!ax || ax.longueur < longueurMinM) return { ok: false, raison: 'Les deux points sont trop proches : écartez-les.' };
    if (ax.longueur > longueurMaxM) return { ok: false, raison: 'La bande dépasse 2 km : rapprochez les deux points.' };
    return { ok: true };
  }

  /** Les quatre coins de la bande, dans l'ordre du contour : A gauche, B gauche, B droite, A droite. */
  function coins(a, b, largeur) {
    const ax = axe(a, b);
    const h = largeurValide(largeur) / 2;
    const g = [ax.nx * h, ax.ny * h];
    return [
      [a[0] + g[0], a[1] + g[1]], [b[0] + g[0], b[1] + g[1]],
      [b[0] - g[0], b[1] - g[1]], [a[0] - g[0], a[1] - g[1]],
    ];
  }

  /** La boîte englobante de la bande, pour ne balayer que les blocs qui la touchent. */
  function emprise(a, b, largeur) {
    const c = coins(a, b, largeur);
    const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
    return { xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys) };
  }

  /**
   * Ce que deux repères posés sur le graphique mesurent (`s` = distance le long
   * de l'axe, `z` = altitude, en mètres). `pente` en degrés, signée comme le
   * dénivelé ; `null` si les deux repères sont à la même abscisse (une pente
   * verticale n'a pas de valeur à afficher).
   */
  function mesurer(p, q) {
    const horizontale = Math.abs(q.s - p.s);
    const denivele = q.z - p.z;
    return {
      horizontale, denivele, totale: Math.hypot(horizontale, denivele),
      pente: horizontale > 1e-9 ? Math.atan2(denivele, horizontale) * 180 / Math.PI : null,
    };
  }

  /** Des graduations rondes (1, 2, 5 × 10ⁿ) dans [min, max], une `cible` à peu près. */
  function graduations(min, max, cible = 6) {
    const etendue = max - min;
    if (!(etendue > 0)) return [];
    const brut = etendue / cible;
    const puiss = 10 ** Math.floor(Math.log10(brut));
    const r = brut / puiss;
    const pas = (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * puiss;
    const sortie = [];
    for (let v = Math.ceil(min / pas) * pas; v <= max + 1e-9; v += pas) sortie.push(Math.round(v / pas) * pas);
    return sortie;
  }

  /** L'étendue verticale des points du tronçon [s0, s1] dont la classe est visible (`null` = toutes). */
  function etendueZ(d, s0, s1, visibles) {
    let zmin = Infinity, zmax = -Infinity, n = 0;
    for (let i = 0; i < d.n; i++) {
      const s = d.s[i];
      if (s < s0 || s > s1) continue;
      if (visibles && !visibles.has(d.cls[i])) continue;
      const z = d.z[i];
      if (z < zmin) zmin = z;
      if (z > zmax) zmax = z;
      n++;
    }
    return n ? { zmin, zmax, n } : null;
  }

  return { axe, largeurValide, verdict, coins, emprise, mesurer, graduations, etendueZ };
}
const PROFIL = fabriqueProfil();
