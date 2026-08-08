// Orchestration du chargement : téléchargement des blocs COPC, répartition sur
// une grappe de workers, concaténation en un nuage unique.

const NB_WORKERS = Math.max(1, Math.min(6, navigator.hardwareConcurrency || 4));

/**
 * Grappe de workers de décompression, avec repli sur le fil principal.
 *
 * Le worker est monté depuis une **URL blob** et non depuis un fichier : en
 * `file://`, `new Worker("file://…")` est refusé par Chrome. Le blob, lui,
 * passe — vérifié. Son source est composé à l'exécution par
 * `DECODEUR.sourceWorker()`, laz-perf étant embarqué sous forme de chaîne, si
 * bien que le worker ne charge rien et n'a besoin d'aucune origine.
 *
 * Le repli existe pour les navigateurs qui refuseraient malgré tout le worker
 * blob : on décode alors sur le fil principal, en rendant la main entre deux
 * blocs. C'est plus lent et moins fluide, mais l'outil reste utilisable au lieu
 * de tomber.
 */
class Grappe {
  constructor() {
    this.workers = [];
    this.libres = [];
    this.enAttente = [];
    this.encours = new Map();
    this.prochainId = 0;
    this.pret = null;
    this.surFilPrincipal = false;
    this.lazPerfLocal = null;
  }

  demarrer() {
    if (!this.pret) this.pret = this._demarrer();
    return this.pret;
  }

  async _demarrer() {
    const wasm = lazPerfWasm();

    try {
      const source = DECODEUR.sourceWorker(LAZPERF_JS);
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));

      await Promise.all(Array.from({ length: NB_WORKERS }, () => new Promise((ok, ko) => {
        const w = new Worker(url);
        w.onmessage = (ev) => {
          const m = ev.data;
          if (m.type === 'pret') { this.workers.push(w); this.libres.push(w); ok(); return; }
          if (m.type === 'echecInit') { ko(new Error(m.message)); return; }
          const tache = this.encours.get(m.id);
          if (!tache) return;
          this.encours.delete(m.id);
          this.libres.push(w);
          if (m.type === 'erreur') tache.ko(new Error(m.message)); else tache.ok(m);
          this._pomper();
        };
        w.onerror = (e) => ko(new Error(e.message || 'worker en échec'));
        // Sans liste de transfert : le binaire est copié pour chaque worker,
        // au lieu d'être cédé au premier et perdu pour les suivants.
        w.postMessage({ type: 'init', wasmBinary: wasm });
      })));

      // L'URL n'a plus d'utilité une fois les workers démarrés, et la retenir
      // maintiendrait le blob en mémoire pour toute la session.
      URL.revokeObjectURL(url);
      return;
    } catch (e) {
      console.warn('Workers indisponibles, décompression sur le fil principal :', e.message);
      for (const w of this.workers) w.terminate();
      this.workers = [];
      this.libres = [];
    }

    // Repli : laz-perf est injecté dans la page par une balise <script>, seule
    // voie qui fonctionne en file:// — `eval` marcherait aussi mais tomberait
    // sous le coup d'une CSP si le site venait à en recevoir une.
    const balise = document.createElement('script');
    balise.textContent = LAZPERF_JS;
    document.head.appendChild(balise);
    this.lazPerfLocal = await createLazPerf({ wasmBinary: wasm });
    this.surFilPrincipal = true;
  }

  _pomper() {
    while (this.libres.length && this.enAttente.length) {
      const w = this.libres.pop();
      const { charge, ok, ko } = this.enAttente.shift();
      this.encours.set(charge.id, { ok, ko });
      w.postMessage(charge, [charge.octets]);
    }
  }

  decoder(charge) {
    charge.id = this.prochainId++;

    if (this.surFilPrincipal) {
      // Une pause avant chaque bloc : sans elle, la boucle de chargement
      // monopoliserait le fil et figerait l'interface du début à la fin.
      return new Promise((ok, ko) => setTimeout(() => {
        try {
          ok(DECODEUR.decoderBloc(this.lazPerfLocal, new Uint8Array(charge.octets), charge));
        } catch (e) { ko(e); }
      }, 0));
    }

    return new Promise((ok, ko) => { this.enAttente.push({ charge, ok, ko }); this._pomper(); });
  }
}

const grappe = new Grappe();

/**
 * Télécharge et décode les nœuds sélectionnés.
 *
 * @param {object} entete en-tête COPC
 * @param {Array} noeuds nœuds retenus par `COPC.selectionner`
 * @param {object} emprise zone d'intérêt en Lambert-93
 * @param {(avancement:{faits:number, total:number, points:number}) => void} surAvancement
 * @param {AbortSignal} signal
 * @returns {Promise<object>} nuage
 */
async function charger(entete, noeuds, emprise, surAvancement, signal) {
  await grappe.demarrer();

  // Origine locale au centre de la zone : garde les coordonnées Float32 petites
  // (cf. commentaire de `decoderBloc`) et donne au rendu un repère déjà centré.
  const origine = [
    (emprise.xmin + emprise.xmax) / 2,
    (emprise.ymin + emprise.ymax) / 2,
    entete.bbox.zmin,
  ];

  const lots = [];
  let faits = 0;
  let pointsRecus = 0;

  // Les nœuds entièrement contenus dans la zone n'ont pas à être filtrés point
  // par point ; ce test évite une passe sur des millions de points au centre de
  // la zone, là où la majorité des nœuds se trouve.
  const taches = noeuds.map(async (noeud) => {
    const e = COPC.empriseNoeud(entete, noeud.cle);
    const dedans = e.xmin >= emprise.xmin && e.xmax <= emprise.xmax
                && e.ymin >= emprise.ymin && e.ymax <= emprise.ymax;

    const octets = await RESEAU.recuperer(entete.url, {
      plage: [noeud.offset, noeud.offset + noeud.taille - 1],
      signal,
    });

    const res = await grappe.decoder({
      type: 'decoder',
      octets: octets.buffer,
      nbPoints: noeud.nbPoints,
      formatPoint: entete.formatPoint,
      longueurPoint: entete.longueurPoint,
      echelle: entete.echelle,
      decalage: entete.decalage,
      origine,
    });

    lots.push({ res, dedans });
    faits++;
    pointsRecus += res.nbPoints;
    surAvancement?.({ faits, total: noeuds.length, points: pointsRecus });
  });

  await Promise.all(taches);
  if (signal?.aborted) throw new DOMException('Chargement abandonné', 'AbortError');

  return assembler(lots, emprise, origine, entete);
}

// Concatène les lots en écartant les points hors zone. Deux passes : la
// première compte, la seconde copie — un seul dimensionnement des tableaux
// finaux plutôt qu'une croissance par doublement.
function assembler(lots, emprise, origine, entete) {
  const xminL = emprise.xmin - origine[0], xmaxL = emprise.xmax - origine[0];
  const yminL = emprise.ymin - origine[1], ymaxL = emprise.ymax - origine[1];

  let n = 0;
  for (const { res, dedans } of lots) {
    if (dedans) { n += res.nbPoints; continue; }
    for (let i = 0; i < res.nbPoints; i++) {
      if (res.x[i] >= xminL && res.x[i] < xmaxL && res.y[i] >= yminL && res.y[i] < ymaxL) n++;
    }
  }

  const nuage = {
    n,
    origine,
    emprise,
    entete,
    x: new Float32Array(n),
    y: new Float32Array(n),
    z: new Float32Array(n),
    cls: new Uint8Array(n),
    intensite: new Uint16Array(n),
    retour: new Uint8Array(n),
    zmin: Infinity,
    zmax: -Infinity,
  };

  let k = 0;
  for (const { res, dedans } of lots) {
    for (let i = 0; i < res.nbPoints; i++) {
      if (!dedans && !(res.x[i] >= xminL && res.x[i] < xmaxL && res.y[i] >= yminL && res.y[i] < ymaxL)) continue;
      const z = res.z[i];
      nuage.x[k] = res.x[i];
      nuage.y[k] = res.y[i];
      nuage.z[k] = z;
      nuage.cls[k] = res.cls[i];
      nuage.intensite[k] = res.intensite[i];
      nuage.retour[k] = res.retour[i];
      if (z < nuage.zmin) nuage.zmin = z;
      if (z > nuage.zmax) nuage.zmax = z;
      k++;
    }
  }

  if (n === 0) { nuage.zmin = 0; nuage.zmax = 1; }

  // Répartition par classification : c'est le premier chiffre à regarder pour
  // juger si une dalle porte le signal recherché.
  nuage.parClasse = new Map();
  for (let i = 0; i < n; i++) {
    nuage.parClasse.set(nuage.cls[i], (nuage.parClasse.get(nuage.cls[i]) || 0) + 1);
  }

  return nuage;
}

const NUAGE = { charger, get surFilPrincipal() { return grappe.surFilPrincipal; } };
