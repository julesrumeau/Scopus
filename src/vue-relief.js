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

const VUE_RELIEF = (() => {
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

  // Remplacé à la tâche 5 par l'autocontrôle de la carte graphique.
  function gpuVerifie() { return false; }

  return { creer, surfaceCPU, reglagesDefaut };
})();
