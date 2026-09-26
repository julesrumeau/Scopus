// Le relief de la vue, depuis les blocs de points que flux.js livre.
//
// Les blocs arrivent décodés en centimètres entiers ; ils sont gardés ici — sur
// la carte graphique quand elle est vérifiée, en mémoire sinon — et la surface
// de la vue se reconstruit à la demande : rangement des points dans la grille,
// terrain (comblement, repli, lissage), surface affichée (le sol, complété par
// le non classé là où aucun retour sol). La couche elle-même passe ensuite par
// RELIEF.calculer, inchangé : à la taille d'un écran, renvoyer la surface à la
// carte graphique ne coûte que quelques millisecondes.
//
// Deux chemins, une seule référence. `surfaceCPU` enchaîne RASTER et RELIEF
// tels quels ; le chemin de la carte graphique (GPU_RELIEF.surfaceVue) n'est
// employé qu'après avoir rendu la même surface sur des points d'essai.

// Une fonction nommée plutôt qu'une expression appelée sur place : son texte
// part tel quel dans le worker du relief (relief-travailleur.js).
function fabriqueVueRelief() {
  /** Réglages de la surface pour un pas donné, depuis la configuration. */
  function reglagesDefaut(pasM) {
    return {
      classesSol: new Set(CONFIG.raster.classesSolDefaut),
      inclureBati: CONFIG.relief.inclureBati,
      inclureSursol: CONFIG.relief.inclureSursol,
      hauteurSursolMaxM: CONFIG.relief.hauteurSursolMaxM,
      passes: VUE_GRILLE.passes(CONFIG.flux.comblementM, pasM),
      rayonLissage: VUE_GRILLE.rayon(CONFIG.flux.lissageM, pasM),
    };
  }

  /** La référence : RASTER puis RELIEF.preparer au pas de la grille. */
  function surfaceCPU(geo, blocs, zRefCm, r) {
    const g = RASTER.creerGrillesVue(geo, zRefCm, r.classesSol);
    for (const b of blocs) RASTER.accumuler(g, b);
    RASTER.finaliser(g, { moteur: 'cpu', passes: r.passes, rayonLissage: r.rayonLissage });
    return RELIEF.preparer(g, {
      moteur: 'cpu', pasM: geo.pas, garderRepli: true,
      inclureBati: r.inclureBati, inclureSursol: r.inclureSursol, hauteurSursolMaxM: r.hauteurSursolMaxM,
    });
  }

  function creer({ moteur = 'auto' } = {}) {
    const gpu = moteur !== 'cpu' && gpuVerifie();
    const blocs = new Map();   // cle → { emprise, origineCm, nbPoints, zminCm, zmaxCm, points }
    let reglagesCourants = {};
    let version = 0;
    let memo = null;           // { cle, t }

    function ajouter(b) {
      const p = b.points;
      const n = p.nbPoints;
      let zmin = Infinity, zmax = -Infinity;
      for (let i = 0; i < n; i++) { const z = p.zc[i]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
      if (gpu && !GPU_RELIEF.ajouterBloc(b.cle, p)) return;
      blocs.set(b.cle, {
        emprise: b.emprise, origineCm: b.origineCm, nbPoints: n,
        zminCm: zmin + b.origineCm[2], zmaxCm: zmax + b.origineCm[2],
        // Sur la carte graphique, les points n'ont plus à rester en mémoire.
        points: gpu ? null : p,
      });
      version++;
    }

    function retirer(cle) {
      if (!blocs.delete(cle)) return;
      if (gpu) GPU_RELIEF.retirerBloc(cle);
      version++;
    }

    function reglages(r) {
      reglagesCourants = { ...reglagesCourants, ...r };
      version++;
    }

    function surface(geo) {
      const cleMemo = `${version}|${geo.xminCm}|${geo.yminCm}|${geo.pasCm}|${geo.W}|${geo.H}`;
      if (memo && memo.cle === cleMemo) return memo.t;
      const choisis = [...blocs].filter(([, b]) => VUE_GRILLE.coupe(b.emprise, geo));
      let t = null;
      if (choisis.length) {
        let zmin = Infinity, zmax = -Infinity;
        for (const [, b] of choisis) { zmin = Math.min(zmin, b.zminCm); zmax = Math.max(zmax, b.zmaxCm); }
        // Un mètre de marge de part et d'autre : la profondeur de la carte
        // graphique est bornée à [0, 1], un point à la limite serait écrêté.
        const zRefCm = zmin - 100, spanCm = zmax - zRefCm + 100;
        const r = { ...reglagesDefaut(geo.pas), ...reglagesCourants };
        t = gpu
          ? GPU_RELIEF.surfaceVue(geo, choisis.map(([cle, b]) => ({ cle, origineCm: b.origineCm })), zRefCm, spanCm, r)
          : surfaceCPU(geo, choisis.map(([, b]) => ({ ...b.points, origineCm: b.origineCm })), zRefCm, r);
      }
      memo = { cle: cleMemo, t };
      return t;
    }

    function calculer(geo, cle) {
      const t0 = performance.now();
      const t = surface(geo);
      if (!t) return null;
      const dureeSurface = performance.now() - t0;
      const c = RELIEF.calculer(t, cle, gpu ? {} : { moteur: 'cpu' });
      return { ...c, geo, t, moteurSurface: gpu ? 'gpu' : 'cpu', dureeSurface, duree: performance.now() - t0 };
    }

    return {
      ajouter, retirer, reglages, surface, calculer,
      taille: () => blocs.size,
      moteur: gpu ? 'gpu' : 'cpu',
      coteMax: gpu ? Math.min(CONFIG.flux.coteMaxGrille, GPU_RELIEF.coteMax()) : CONFIG.flux.coteMaxGrille,
    };
  }

  // Verdict de l'autocontrôle : null = pas encore fait, '' = accepté.
  let verdict = null;

  function gpuVerifie() {
    if (verdict === null) {
      try {
        verdict = typeof GPU_RELIEF === 'undefined' ? 'module absent'
          : !GPU_RELIEF.disponible() ? (GPU_RELIEF.raison() || 'carte graphique indisponible')
            : controleGPU();
      } catch (e) {
        verdict = e.message || String(e);
      }
      if (verdict) console.warn(`Relief de la vue calculé sur le processeur : ${verdict}`);
    }
    return verdict === '';
  }

  /**
   * Rend la même surface sur la carte graphique et au processeur, sur des
   * points d'essai qui mêlent ce qui a déjà piégé ce genre de code : des
   * points pile sur les limites de case, deux dalles à 600 m d'écart
   * d'altitude (la profondeur est normalisée sur l'étendue de la vue), un mur
   * non classé sans sol dessous (la surface doit le prendre), un arbre au-dessus
   * du plafond (elle ne doit pas), du bâti, de l'eau, un grand trou.
   * Rend '' si tout concorde, sinon la raison.
   */
  function controleGPU() {
    const geo = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2040 }, 0.5, 0, 4096);
    let graine = 11;
    const alea = () => ((graine = (graine * 1664525 + 1013904223) >>> 0) / 4294967296);
    const blocs = [];
    for (const [k, zBase] of [[0, 30000], [1, 90000]]) {
      const x0 = 1000 + k * 30, n = 12000;
      const xc = new Int32Array(n), yc = new Int32Array(n), zc = new Int32Array(n), cls = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        // Un point sur cinq pile sur une limite de case de 50 cm.
        const x = i % 5 === 0 ? Math.floor(alea() * 60) * 50 : Math.floor(alea() * 3000);
        const y = i % 5 === 1 ? Math.floor(alea() * 80) * 50 : Math.floor(alea() * 4000);
        const sol = zBase + Math.round(x * 0.04 + 30 * Math.exp(-((x - 1500) ** 2 + (y - 2000) ** 2) / 3e5));
        const u = alea();
        const dansTrou = (x - 2200) ** 2 + (y - 1000) ** 2 < 500 ** 2;
        const surMur = Math.abs(x - 800) < 60 && y > 1000 && y < 3000;
        xc[i] = x; yc[i] = y;
        if (surMur) { cls[i] = 1; zc[i] = sol + 60 + Math.round(alea() * 20); }
        else if (u < 0.45 && !dansTrou) { cls[i] = alea() < 0.1 ? 9 : 2; zc[i] = sol; }
        else if (u < 0.55) { cls[i] = 6; zc[i] = sol + Math.round(alea() * 250); }
        else if (u < 0.65) { cls[i] = 1; zc[i] = sol + Math.round(alea() * 500); }
        else { cls[i] = 5; zc[i] = sol + Math.round(alea() * 2000); }
      }
      blocs.push({ cle: `__controle_${k}`, origineCm: [x0 * 100, 200000, 0], nbPoints: n, xc, yc, zc, cls });
    }
    let zmin = Infinity, zmax = -Infinity;
    for (const b of blocs) for (let i = 0; i < b.nbPoints; i++) { zmin = Math.min(zmin, b.zc[i]); zmax = Math.max(zmax, b.zc[i]); }
    const zRefCm = zmin - 100, spanCm = zmax - zRefCm + 100;
    const r = reglagesDefaut(geo.pas);

    const ref = surfaceCPU(geo, blocs, zRefCm, r);
    for (const b of blocs) if (!GPU_RELIEF.ajouterBloc(b.cle, b)) return 'blocs refusés par la carte graphique';
    let t;
    try {
      t = GPU_RELIEF.surfaceVue(geo, blocs.map((b) => ({ cle: b.cle, origineCm: b.origineCm })), zRefCm, spanCm, r);
    } finally {
      for (const b of blocs) GPU_RELIEF.retirerBloc(b.cle);
    }
    if (!t) return 'surface refusée par la carte graphique';

    // Tolérances, mesurées sur la carte AMD intégrée : la profondeur rend
    // l'altitude du sol au centième de millimètre ; les cases complétées par
    // le non classé passent par des sommes sur 16 bits, à quelques
    // millimètres (2,4 mm au pire) ; et une case dont la hauteur tombe pile
    // au plafond de `hauteurSursolMaxM` peut basculer d'un côté ou de
    // l'autre — un effet de seuil, pas un défaut. Elles sont comptées à part,
    // et tolérées si elles restent rares.
    let dMnt = 0, dH = 0, dValide = 0, dTrou = 0, bascules = 0;
    for (let i = 0; i < ref.N; i++) {
      if (t.valide[i] !== ref.valide[i]) dValide++;
      if (t.trou[i] !== ref.trou[i]) dTrou++;
      if (ref.valide[i]) {
        const d = Math.abs(t.mnt[i] - ref.mnt[i]);
        if (d > 1e-2) bascules++;
        else dMnt = Math.max(dMnt, d);
      }
      dH = Math.max(dH, Math.abs(t.hauteur[i] - ref.hauteur[i]));
    }
    if (dValide || dTrou || dMnt > 1e-2 || bascules > ref.N * 0.002 || dH > 1e-2) {
      return `surface de la vue : ${dValide} validités et ${dTrou} trous différents, altitude à ${dMnt.toExponential(1)} m, `
        + `${bascules} cases à plus d'un centimètre, hauteur à ${dH.toExponential(1)} m`;
    }
    return '';
  }

  return { creer, surfaceCPU, reglagesDefaut, controleGPU };
}
const VUE_RELIEF = fabriqueVueRelief();
