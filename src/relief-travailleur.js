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
      ...FONCTIONS_RASTER.map(String),
      'const RASTER = { CLASSE, creerGrilles, creerGrillesVue, accumuler, finaliser, rasteriser, signal, hauteurParPoint, centreCellule };',
      `${fabriqueVueGrille}\nconst VUE_GRILLE = fabriqueVueGrille();`,
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
      arreter() {},
    };
  }

  return { source, creer, surFilPrincipal };
})();
