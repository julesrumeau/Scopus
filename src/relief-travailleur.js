// Le relief de la vue calculé dans un worker.
//
// Pourquoi : le calcul (rangement des points, terrain, surface, SVF) tient le
// fil principal une à plusieurs secondes, et il est relancé à chaque arrivée
// de blocs. Même quand la carte graphique fait le travail, c'est le fil
// principal qui lui donne les ordres puis attend le résultat : pendant ce
// temps la carte ne répondait ni à la molette ni au glisser. Dans un worker, le
// fil principal ne fait plus que la carte, les gestes et poser l'image.
//
// Comment, en file:// : un worker ne peut rien charger (voir decodeur.js). Son
// source est donc composé du **texte** des fonctions du projet — raster.js
// fonction par fonction, et les modules écrits en `function fabriqueX()`
// (vue-grille.js, relief.js, gpu-relief.js, vue-relief.js) —, plus CONFIG, les
// shaders et GL en données. La carte graphique y reste employée, par un
// OffscreenCanvas (gpu-relief.js), avec son autocontrôle.
//
// Corollaire : tout ce qui part dans le worker ne ferme que sur ces globaux.
// Une fonction de raster.js ajoutée sans être listée ici échouerait dans le
// worker seulement — test/relief-travailleur.test.js compare les deux listes.

/** La boucle de messages du worker. Sérialisée : elle ne ferme sur rien. */
function corpsTravailleurRelief() {
  let moteur = null;
  self.onmessage = (e) => {
    const m = e.data;
    try {
      if (m.type === 'demarrer') {
        moteur = VUE_RELIEF.creer(m.options || {});
        self.postMessage({ type: 'pret', moteur: moteur.moteur, coteMax: moteur.coteMax });
      } else if (m.type === 'ajouter') {
        moteur.ajouter(m.bloc);
      } else if (m.type === 'retirer') {
        moteur.retirer(m.cle);
      } else if (m.type === 'reglages') {
        moteur.reglages(m.reglages);
      } else if (m.type === 'image') {
        const t0 = performance.now();
        // Une carte de taille nulle (masquée, pas encore mesurée) : rien à peindre.
        if (!(m.ecran.W > 0 && m.ecran.H > 0)) { self.postMessage({ type: 'image', id: m.id, vide: true, classes: moteur.classes() }); return; }
        const r = moteur.calculer(m.geo, m.couche, { contraste: m.contraste, couche: m.reglagesCouche, actifs: m.actifs ? new Set(m.actifs) : undefined });
        if (!r) { self.postMessage({ type: 'image', id: m.id, vide: true, classes: moteur.classes() }); return; }
        const t1 = performance.now();
        const uv = VUE_IMAGE.cases(m.geo, m.ecran, PROJ.versLambert93);
        const rgba = r.rgba
          ? VUE_IMAGE.peindreRGBA(r.rgba, m.geo, uv, m.lisser)
          : VUE_IMAGE.peindre(r.valeurs, m.geo, uv, r.min, r.max, m.lut, m.lisser);
        const infos = {
          type: 'image', id: m.id, W: m.ecran.W, H: m.ecran.H, min: r.min, max: r.max, classes: moteur.classes(),
          recalcul: r.recalcul, moteurSurface: r.moteurSurface, moteurCouche: r.moteurCouche,
          dureeSurface: r.dureeSurface, dureeCouche: t1 - t0 - r.dureeSurface, dureeImage: performance.now() - t1,
        };
        // Encodée ici quand le navigateur le permet : le fil principal n'a
        // plus qu'à poser l'image.
        // Si l'encodage échoue (pas de contexte 2D, refus du navigateur), les
        // pixels partent tels quels : le fil principal sait les encoder.
        const pixels = () => self.postMessage({ ...infos, rgba, duree: performance.now() - t0 }, [rgba.buffer]);
        const ctx2d = typeof OffscreenCanvas !== 'undefined' && typeof ImageData !== 'undefined'
          ? new OffscreenCanvas(m.ecran.W, m.ecran.H) : null;
        const contexte2d = ctx2d && ctx2d.getContext('2d');
        if (contexte2d) {
          contexte2d.putImageData(new ImageData(rgba, m.ecran.W, m.ecran.H), 0, 0);
          ctx2d.convertToBlob({ type: 'image/png' }).then(
            (blob) => self.postMessage({ ...infos, blob, duree: performance.now() - t0 }),
            pixels,
          );
        } else {
          pixels();
        }
      } else if (m.type === 'lire') {
        self.postMessage({ type: 'lire', id: m.id, point: moteur.lire(m.x, m.y, m.couche) });
      } else if (m.type === 'calculer') {
        const r = moteur.calculer(m.geo, m.couche);
        if (!r) { self.postMessage({ type: 'resultat', id: m.id, vide: true }); return; }
        // Une copie, cédée au fil principal : la couche « hauteur » est un
        // tableau de la surface mémoïsée, qu'un transfert viderait ici.
        const valeurs = Float32Array.from(r.valeurs);
        self.postMessage({
          type: 'resultat', id: m.id, valeurs, min: r.min, max: r.max, palette: r.palette, geo: r.geo,
          moteurSurface: r.moteurSurface, dureeSurface: r.dureeSurface, duree: r.duree,
        }, [valeurs.buffer]);
      }
    } catch (err) {
      self.postMessage({ type: 'erreur', id: m.id, message: String((err && err.message) || err) });
    }
  };
}

const RELIEF_TRAVAILLEUR = (() => {
  // Fonctions de raster.js, toutes : celles de RASTER et celles qu'elles
  // appellent.
  const FONCTIONS_RASTER = [
    creerGrilles, tableaux, creerGrillesVue, accumuler, accumulerCm, verser, finaliser,
    rasteriser, signal, modeleTerrain, flouBoite, pente, hauteurParPoint, centreCellule,
  ];

  /** GL est un objet de méthodes : chacune reprend son texte, clé comprise. */
  function texteObjet(nom, objet) {
    const membres = Object.entries(objet).map(([cle, v]) => {
      if (typeof v !== 'function') return `${JSON.stringify(cle)}: ${JSON.stringify(v)}`;
      const texte = v.toString();
      return texte.startsWith(`${cle}(`) || texte.startsWith(`async ${cle}(`) ? texte : `${JSON.stringify(cle)}: ${texte}`;
    });
    return `const ${nom} = {\n${membres.join(',\n')}\n};`;
  }

  function source() {
    return [
      `const CONFIG = ${JSON.stringify(CONFIG)};`,
      `const SHADERS = ${JSON.stringify(SHADERS)};`,
      texteObjet('GL', GL),
      `const CLASSE = ${JSON.stringify(CLASSE)};`,
      // proj.js : ses constantes en valeurs (un double s'écrit exactement en
      // texte), ses fonctions en texte.
      `const A = ${A}, F = ${F}, E = ${E}, LON0 = ${LON0}, LAT0 = ${LAT0}, LAT1 = ${LAT1}, LAT2 = ${LAT2}, X0 = ${X0}, Y0 = ${Y0};`,
      `const M1 = ${M1}, M2 = ${M2}, T0 = ${T0}, T1 = ${T1}, T2 = ${T2}, N = ${N}, BIGF = ${BIGF}, R0 = ${R0};`,
      String(m), String(t), String(versLambert93), String(versWGS84),
      'const PROJ = { versLambert93, versWGS84 };',
      ...FONCTIONS_RASTER.map(String),
      'const RASTER = { CLASSE, creerGrilles, creerGrillesVue, accumuler, finaliser, rasteriser, signal, hauteurParPoint, centreCellule };',
      `${fabriqueVueGrille}\nconst VUE_GRILLE = fabriqueVueGrille();`,
      `${fabriqueVueImage}\nconst VUE_IMAGE = fabriqueVueImage();`,
      `${fabriqueRelief}\nconst RELIEF = fabriqueRelief();`,
      `${fabriqueGpuRelief}\nconst GPU_RELIEF = fabriqueGpuRelief();`,
      `${fabriqueVueRelief}\nconst VUE_RELIEF = fabriqueVueRelief();`,
      `(${corpsTravailleurRelief})();`,
    ].join('\n\n');
  }

  /**
   * Le relief dans un worker. Même interface que `surFilPrincipal`, toute en
   * promesses : `pret` → `{ moteur, coteMax }`, `calculer(geo, couche)` → le
   * résultat, ou `null` sans bloc dans la vue. `null` si le worker ne peut pas
   * être créé.
   */
  function creer(options = {}) {
    let w;
    try {
      w = new Worker(URL.createObjectURL(new Blob([source()], { type: 'text/javascript' })));
    } catch (e) {
      console.warn(`Relief calculé sur le fil principal : ${e.message}`);
      return null;
    }
    const attente = new Map();
    let prochain = 0;
    let signalerPret;
    const pret = new Promise((ok, ko) => { signalerPret = { ok, ko }; });
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'pret') { signalerPret.ok(m); return; }
      const a = attente.get(m.id);
      if (!a) return;
      attente.delete(m.id);
      if (m.type === 'erreur') a.ko(new Error(m.message));
      else if (m.type === 'lire') a.ok(m.point);
      else a.ok(m.vide ? null : m);
    };
    // Une erreur non rattrapée dans le worker : tout ce qui attend doit
    // l'apprendre, sans quoi le relief resterait « en calcul » pour toujours.
    w.onerror = (e) => {
      const err = new Error(e.message || 'le calcul du relief a échoué');
      signalerPret.ko(err);
      for (const a of attente.values()) a.ko(err);
      attente.clear();
    };
    w.postMessage({ type: 'demarrer', options });

    return {
      pret,
      /** Les points sont cédés au worker : le fil principal ne les garde pas. */
      ajouter(b) {
        const p = b.points;
        const tampons = [...new Set([p.xc.buffer, p.yc.buffer, p.zc.buffer, p.cls.buffer])];
        w.postMessage({
          type: 'ajouter',
          bloc: { cle: b.cle, emprise: b.emprise, origineCm: b.origineCm, points: { nbPoints: p.nbPoints, xc: p.xc, yc: p.yc, zc: p.zc, cls: p.cls } },
        }, tampons);
      },
      retirer(cle) { w.postMessage({ type: 'retirer', cle }); },
      reglages(r) { w.postMessage({ type: 'reglages', reglages: r }); },
      calculer(geo, couche) {
        return new Promise((ok, ko) => {
          const id = ++prochain;
          attente.set(id, { ok, ko });
          w.postMessage({ type: 'calculer', id, geo, couche });
        });
      },
      /** Altitude, hauteur et valeur de la couche en un point Lambert-93 de la dernière vue calculée. */
      lire(x, y, couche) {
        return new Promise((ok, ko) => {
          const id = ++prochain;
          attente.set(id, { ok, ko });
          w.postMessage({ type: 'lire', id, x, y, couche });
        });
      },
      /** L'image reprojetée de la couche, `null` sans bloc dans la vue. */
      image(geo, couche, ecran, lut, reglages = {}) {
        return new Promise((ok, ko) => {
          const id = ++prochain;
          attente.set(id, { ok, ko });
          w.postMessage({
            type: 'image', id, geo, couche, ecran, lut, contraste: reglages.contraste ?? 1, lisser: reglages.lisser ?? true,
            actifs: reglages.actifs, reglagesCouche: reglages.couche,
          });
        });
      },
      arreter() { w.terminate(); },
    };
  }

  /** Le même calcul sur le fil principal, derrière la même interface. */
  function surFilPrincipal(options = {}) {
    const moteur = VUE_RELIEF.creer(options);
    return {
      pret: Promise.resolve({ moteur: moteur.moteur, coteMax: moteur.coteMax }),
      ajouter: (b) => moteur.ajouter(b),
      retirer: (cle) => moteur.retirer(cle),
      reglages: (r) => moteur.reglages(r),
      calculer: async (geo, couche) => moteur.calculer(geo, couche),
      lire: async (x, y, couche) => moteur.lire(x, y, couche),
      image: async (geo, couche, ecran, lut, reglages = {}) => {
        if (!(ecran.W > 0 && ecran.H > 0)) return null;
        const t0 = performance.now();
        const r = moteur.calculer(geo, couche, { contraste: reglages.contraste ?? 1, couche: reglages.couche, actifs: reglages.actifs ? new Set(reglages.actifs) : undefined });
        if (!r) return null;
        const t1 = performance.now();
        const uv = VUE_IMAGE.cases(geo, ecran, PROJ.versLambert93);
        const rgba = r.rgba
          ? VUE_IMAGE.peindreRGBA(r.rgba, geo, uv, reglages.lisser ?? true)
          : VUE_IMAGE.peindre(r.valeurs, geo, uv, r.min, r.max, lut, reglages.lisser ?? true);
        return {
          ...r, W: ecran.W, H: ecran.H, classes: moteur.classes(), rgba,
          dureeCouche: t1 - t0 - r.dureeSurface, dureeImage: performance.now() - t1, duree: performance.now() - t0,
        };
      },
      arreter() {},
    };
  }

  return { source, creer, surFilPrincipal };
})();
