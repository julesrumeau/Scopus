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

/**
 * L'image d'une couche : calculée par le moteur, reprojetée au pixel de la
 * carte. Commune au worker et au repli sur le fil principal. `memo` garde le
 * maillage de reprojection du dernier écran : les deux côtés du rideau
 * demandent le même, qui coûte un passage sur chaque pixel. Sérialisée avec
 * le worker : elle ne ferme sur rien. `null` si rien n'est à peindre.
 */
function peindreVue(moteur, m, memo) {
  // Une carte de taille nulle (masquée, pas encore mesurée) : rien à peindre.
  if (!(m.ecran.W > 0 && m.ecran.H > 0)) return null;
  const t0 = performance.now();
  const r = moteur.calculer(m.geo, m.couche, {
    contraste: m.contraste ?? 1, couche: m.reglagesCouche, actifs: m.actifs ? new Set(m.actifs) : undefined,
  });
  if (!r) return null;
  const t1 = performance.now();
  const g = m.geo, e = m.ecran;
  // La grille est dans la projection du territoire de la vue (Lambert-93, ou
  // UTM outre-mer), que l'écran porte avec lui.
  const cle = `${g.xminCm}|${g.yminCm}|${g.pasCm}|${g.W}|${g.H}|${e.x0}|${e.y0}|${e.W}|${e.H}|${e.z}|${e.territoire}`;
  if (memo.cle !== cle) { memo.cle = cle; memo.uv = VUE_IMAGE.cases(g, e, PROJ.projectionDe(e.territoire).versLocal); }
  const lisser = m.lisser ?? true;
  const rgba = r.rgba
    ? VUE_IMAGE.peindreRGBA(r.rgba, g, memo.uv, lisser)
    : VUE_IMAGE.peindre(r.valeurs, g, memo.uv, r.min, r.max, m.lut, lisser);
  return { r, rgba, t0, dureeCouche: t1 - t0 - r.dureeSurface, dureeImage: performance.now() - t1 };
}

/** La boucle de messages du worker. Sérialisée : elle ne ferme sur rien. */
function corpsTravailleurRelief() {
  const memoImage = {};
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
        const p = peindreVue(moteur, m, memoImage);
        if (!p) { self.postMessage({ type: 'image', id: m.id, vide: true, classes: moteur.classes() }); return; }
        const { r, rgba, t0 } = p;
        const infos = {
          type: 'image', id: m.id, W: m.ecran.W, H: m.ecran.H, min: r.min, max: r.max, classes: moteur.classes(),
          recalcul: r.recalcul, moteurSurface: r.moteurSurface, moteurCouche: r.moteurCouche,
          dureeSurface: r.dureeSurface, dureeCouche: p.dureeCouche, dureeImage: p.dureeImage,
        };
        // Encodée ici quand le navigateur le permet : le fil principal n'a
        // plus qu'à poser l'image. Si l'encodage échoue (pas de contexte 2D,
        // refus du navigateur), les pixels partent tels quels : le fil
        // principal sait les encoder.
        const pixels = () => self.postMessage({ ...infos, rgba, duree: performance.now() - t0 }, [rgba.buffer]);
        const toile = typeof OffscreenCanvas !== 'undefined' && typeof ImageData !== 'undefined'
          ? new OffscreenCanvas(m.ecran.W, m.ecran.H) : null;
        const contexte2d = toile && toile.getContext('2d');
        if (contexte2d) {
          contexte2d.putImageData(new ImageData(rgba, m.ecran.W, m.ecran.H), 0, 0);
          toile.convertToBlob({ type: 'image/png' }).then(
            (blob) => self.postMessage({ ...infos, blob, duree: performance.now() - t0 }),
            pixels,
          );
        } else {
          pixels();
        }
      } else if (m.type === 'nuage3d') {
        const r = moteur.nuage3d(m.emprise, m.budget, m.actifs ? new Set(m.actifs) : undefined);
        if (!r || r.raison) { self.postMessage({ type: 'nuage3d', id: m.id, vide: true, raison: (r && r.raison) || '' }); return; }
        self.postMessage({ type: 'nuage3d', id: m.id, ...r },
          [r.x.buffer, r.y.buffer, r.z.buffer, r.cls.buffer, r.hauteur.buffer]);
      } else if (m.type === 'profil') {
        const r = moteur.profil(m.a, m.b, m.largeur, m.budget, m.actifs ? new Set(m.actifs) : undefined);
        if (r.raison) { self.postMessage({ type: 'profil', id: m.id, vide: true, raison: r.raison }); return; }
        self.postMessage({ type: 'profil', id: m.id, ...r }, [r.s.buffer, r.z.buffer, r.d.buffer, r.cls.buffer]);
      } else if (m.type === 'drape3d') {
        const valeurs = moteur.drape3d(m.cle, m.reglagesCouche, m.min, m.max);
        self.postMessage({ type: 'drape3d', id: m.id, valeurs }, valeurs ? [valeurs.buffer] : []);
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
      String(projectionUTM), String(projectionDe),
      `const TERRITOIRES = ${JSON.stringify(TERRITOIRES)};`,
      'const PROJ = { versLambert93, versWGS84, projectionDe };',
      ...FONCTIONS_RASTER.map(String),
      'const RASTER = { CLASSE, creerGrilles, creerGrillesVue, accumuler, finaliser, rasteriser, signal, hauteurParPoint, centreCellule };',
      `${fabriqueVueGrille}\nconst VUE_GRILLE = fabriqueVueGrille();`,
      `${fabriqueVueImage}\nconst VUE_IMAGE = fabriqueVueImage();`,
      `${fabriqueRelief}\nconst RELIEF = fabriqueRelief();`,
      `${fabriqueGpuRelief}\nconst GPU_RELIEF = fabriqueGpuRelief();`,
      `${fabriqueProfil}\nconst PROFIL = fabriqueProfil();`,
      `${fabriqueVueRelief}\nconst VUE_RELIEF = fabriqueVueRelief();`,
      String(peindreVue),
      `(${corpsTravailleurRelief})();`,
    ].join('\n\n');
  }

  /**
   * Le relief dans un worker. Même interface que `surFilPrincipal`, toute en
   * promesses : `pret` → `{ moteur, coteMax }`, `calculer(geo, couche)` → le
   * résultat, ou `null` sans bloc dans la vue. `null` si le worker ne peut pas
   * être créé.
   */
  // Ce que chaque type de réponse rend à qui l'attendait.
  const REPONSES = {
    lire: (m) => m.point,
    nuage3d: (m) => (m.vide ? { vide: true, raison: m.raison } : m),
    profil: (m) => (m.vide ? { vide: true, raison: m.raison } : m),
    drape3d: (m) => m.valeurs,
    defaut: (m) => (m.vide ? null : m),
  };

  function creer(options = {}) {
    let w, url;
    try {
      url = URL.createObjectURL(new Blob([source()], { type: 'text/javascript' }));
      w = new Worker(url);
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
      // Le source est chargé : l'URL blob ne sert plus.
      if (m.type === 'pret') { URL.revokeObjectURL(url); signalerPret.ok(m); return; }
      const a = attente.get(m.id);
      if (!a) return;
      attente.delete(m.id);
      if (m.type === 'erreur') a.ko(new Error(m.message));
      else a.ok((REPONSES[m.type] || REPONSES.defaut)(m));
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
    // Une demande au worker : un numéro, une promesse, la réponse du même numéro.
    const demander = (message) => new Promise((ok, ko) => {
      const id = ++prochain;
      attente.set(id, { ok, ko });
      w.postMessage({ ...message, id });
    });

    return {
      pret,
      /** Les points sont cédés au worker : le fil principal ne les garde pas. */
      ajouter(b) {
        const p = b.points;
        // L'intensité aussi : la vue 3D la colore (nuage3d).
        const tampons = [...new Set([p.xc.buffer, p.yc.buffer, p.zc.buffer, p.cls.buffer])];
        w.postMessage({
          type: 'ajouter',
          bloc: {
            cle: b.cle, emprise: b.emprise, origineCm: b.origineCm,
            points: { nbPoints: p.nbPoints, xc: p.xc, yc: p.yc, zc: p.zc, cls: p.cls },
          },
        }, tampons);
      },
      retirer(cle) { w.postMessage({ type: 'retirer', cle }); },
      reglages(r) { w.postMessage({ type: 'reglages', reglages: r }); },
      calculer: (geo, couche) => demander({ type: 'calculer', geo, couche }),
      /** Une couche drapée sur le dernier nuage 3D, valeurs dans [0, 1] ; `null` sans nuage. */
      drape3d: (cle, reglagesCouche, min, max) => demander({ type: 'drape3d', cle, reglagesCouche, min, max }),
      /** Le nuage 3D de l'emprise, au plus `budget` points ; `{ vide, raison }` sinon. */
      nuage3d: (emprise, budget, actifs) => demander({ type: 'nuage3d', emprise, budget, actifs }),
      /** Les points de la bande A→B ; `{ vide, raison }` sinon. */
      profil: (a, b, largeur, budget, actifs) => demander({ type: 'profil', a, b, largeur, budget, actifs }),
      /** Altitude, hauteur et valeur de la couche en un point Lambert-93 de la dernière vue calculée. */
      lire: (x, y, couche) => demander({ type: 'lire', x, y, couche }),
      /** L'image reprojetée de la couche, `null` sans bloc dans la vue. */
      image: (geo, couche, ecran, lut, reglages = {}) => demander({
        type: 'image', geo, couche, ecran, lut, contraste: reglages.contraste, lisser: reglages.lisser,
        actifs: reglages.actifs, reglagesCouche: reglages.couche,
      }),
      arreter() { w.terminate(); },
    };
  }

  /** Le même calcul sur le fil principal, derrière la même interface. */
  function surFilPrincipal(options = {}) {
    const moteur = VUE_RELIEF.creer(options);
    const memoImage = {};
    return {
      pret: Promise.resolve({ moteur: moteur.moteur, coteMax: moteur.coteMax }),
      ajouter: (b) => moteur.ajouter(b),
      retirer: (cle) => moteur.retirer(cle),
      reglages: (r) => moteur.reglages(r),
      calculer: async (geo, couche) => moteur.calculer(geo, couche),
      lire: async (x, y, couche) => moteur.lire(x, y, couche),
      drape3d: async (cle, reglagesCouche, min, max) => moteur.drape3d(cle, reglagesCouche, min, max),
      nuage3d: async (emprise, budget, actifs) => {
        const r = moteur.nuage3d(emprise, budget, actifs ? new Set(actifs) : undefined);
        return !r || r.raison ? { vide: true, raison: (r && r.raison) || '' } : r;
      },
      profil: async (a, b, largeur, budget, actifs) => {
        const r = moteur.profil(a, b, largeur, budget, actifs ? new Set(actifs) : undefined);
        return r.raison ? { vide: true, raison: r.raison } : r;
      },
      image: async (geo, couche, ecran, lut, reglages = {}) => {
        const p = peindreVue(moteur, {
          geo, couche, ecran, lut, contraste: reglages.contraste, lisser: reglages.lisser,
          actifs: reglages.actifs, reglagesCouche: reglages.couche,
        }, memoImage);
        if (!p) return null;
        return {
          ...p.r, W: ecran.W, H: ecran.H, classes: moteur.classes(), rgba: p.rgba,
          dureeCouche: p.dureeCouche, dureeImage: p.dureeImage, duree: performance.now() - p.t0,
        };
      },
      arreter() {},
    };
  }

  return { source, creer, surFilPrincipal };
})();
