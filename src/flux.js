// Chargement piloté par la vue : les points des dalles visibles, du grossier
// au fin, sans rien choisir ni charger à la main.
//
// À chaque vue : les dalles du rectangle (WFS), ouvertes d'une requête chacune
// — la fin du fichier ramène l'index et le niveau 0 —, puis les blocs plus fins
// que le zoom demande, groupés en plages contiguës, lus du cache disque avant
// le réseau, décompressés en centimètres entiers dans les workers. Voir la
// spec docs/superpowers/specs/2026-09-26-flux-vue-design.md et « Le chargement
// piloté par la vue » dans CLAUDE.md.
//
// Les dépendances sont injectées (`FLUX.creer`) : l'orchestration se teste
// avec un faux réseau, et `app.js` branche les vraies.

const FLUX = (() => {
  const coupe = (e, v) => e.xmax > v.xmin && e.xmin < v.xmax && e.ymax > v.ymin && e.ymin < v.ymax;
  const agrandi = (v, m) => ({ xmin: v.xmin - m, xmax: v.xmax + m, ymin: v.ymin - m, ymax: v.ymax + m });
  const contient = (a, b) => a.xmin <= b.xmin && a.xmax >= b.xmax && a.ymin <= b.ymin && a.ymax >= b.ymax;
  const centreDist = (e, v) => Math.hypot((e.xmin + e.xmax - v.xmin - v.xmax) / 2, (e.ymin + e.ymax - v.ymin - v.ymax) / 2);

  function creer(deps) {
    const config = deps.config || CONFIG.flux;
    const dalles = new Map();   // url → { dalle, etat, ctrl, index, fin, debutFin, entete }
    const lots = new Map();     // lot → Promise<entête>
    const blocs = new Map();    // cle → { etat, ctrl, niveau, nbPoints, emprise }
    const zones = [];           // rectangles déjà demandés au WFS
    let vue = null;
    let enCours = 0;
    let attenteCalme = [];

    // Suivi des tâches en vol, pour `attendreCalme`.
    const suivre = (p) => {
      enCours++;
      return p.finally(() => {
        enCours--;
        if (!enCours) { const a = attenteCalme; attenteCalme = []; a.forEach((f) => f()); }
      });
    };

    function publierEtat(tropLarge = false) {
      let attente = 0, charges = 0, points = 0;
      for (const b of blocs.values()) {
        if (b.etat === 'attente') attente++;
        else { charges++; points += b.nbPoints; }
      }
      const dallesOuvertes = [...dalles.values()].filter((d) => d.etat === 'ouverte').length;
      deps.surEtat?.({ attente, charges, points, dallesOuvertes, tropLarge });
    }

    function entetePourLot(url) {
      const lot = COPC.lotDepuisUrl(url);
      if (!lots.has(lot)) {
        const p = deps.recuperer(url, { plage: [0, 255] }).then(COPC.lireEnteteLot);
        p.catch(() => lots.delete(lot));   // un échec ne condamne pas le lot
        lots.set(lot, p);
      }
      return lots.get(lot);
    }

    // La fin de fichier (index + niveau 0) se garde sur le disque comme les
    // blocs : une zone déjà vue s'ouvre alors sans une requête. Sa position
    // dans le fichier (NaN si inconnue) est rangée devant les octets.
    const cleFin = (url) => `${url}#fin`;
    async function finDuCache(url) {
      const o = await deps.cache?.lire(cleFin(url));
      if (!o || o.length < 8) return null;
      const debut = new DataView(o.buffer, o.byteOffset, 8).getFloat64(0, true);
      return { octets: o.subarray(8), debut: Number.isFinite(debut) ? debut : null };
    }
    function finAuCache(url, octets, debut) {
      if (!deps.cache) return;
      const o = new Uint8Array(8 + octets.length);
      new DataView(o.buffer).setFloat64(0, debut ?? NaN, true);
      o.set(octets, 8);
      suivre(deps.cache.ecrire(cleFin(url), o));
    }

    async function ouvrir(d) {
      d.etat = 'ouverture';
      d.ctrl = new AbortController();
      const signal = d.ctrl.signal;
      // L'en-tête du lot part **tout de suite** : le lot se lit dans l'adresse.
      // Demandé après la première réponse, il passait derrière toutes les fins
      // de fichier de la file réseau — aucun bloc décodé avant ~11 s, mesuré.
      const entete = entetePourLot(d.dalle.url);
      entete.catch(() => {});
      try {
        // La position du morceau dans le fichier : par la taille quand elle est
        // lisible, sinon par la table des blocs (COPC.lireFin). En navigateur,
        // l'IGN masque la taille (CORS) : c'est la table qui sert. Sans position,
        // l'index reste bon, mais le niveau 0 repassera par le réseau.
        let lu = null, fin = null;
        const garde = await finDuCache(d.dalle.url);
        if (garde) {
          fin = garde.octets;
          lu = COPC.lireFin(fin, garde.debut);
        }
        if (!lu) {
          for (const n of [config.octetsFin, config.octetsFinSecours]) {
            const r = await deps.recuperer(d.dalle.url, { fin: n, signal });
            fin = r.octets;
            lu = COPC.lireFin(fin, r.total == null ? null : r.total - r.octets.length);
            if (lu) finAuCache(d.dalle.url, fin, lu.debutMorceau);
            if (lu || (r.total != null && r.octets.length >= r.total)) break;
          }
        }
        const debut = lu ? lu.debutMorceau : null;
        if (!lu) throw new Error(`index introuvable dans la fin de ${d.dalle.nom || d.dalle.url}`);
        const noeuds = new Map(lu.noeuds);
        for (const [offset, taille] of lu.sousPages) {
          const page = await deps.recuperer(d.dalle.url, { plage: [offset, offset + taille - 1], signal });
          const sp = COPC.lireEntrees(page);
          for (const [k, v] of sp.noeuds) noeuds.set(k, v);
        }
        d.entete = await entete;
        if (signal.aborted) return;
        Object.assign(d, { index: noeuds, fin, debutFin: debut, etat: 'ouverte' });
        planifier();
      } catch (e) {
        if (signal.aborted) { d.etat = 'inconnue'; return; }
        d.etat = 'echec';
        console.warn('Flux : dalle non ouverte —', e.message);
      }
    }

    const cleCache = (url, noeud) => `${url}#${noeud.offset}`;

    async function telechargerDalle(d, lot) {
      const ctrl = new AbortController();
      for (const b of lot) blocs.set(b.cle, { etat: 'attente', ctrl, niveau: b.niveau, nbPoints: b.noeud.nbPoints, emprise: b.emprise });
      const signal = ctrl.signal;
      const origineCm = [Math.round(d.dalle.emprise.xmin * 100), Math.round(d.dalle.emprise.ymin * 100), 0];

      // Un bloc est décodé dès que ses octets sont là : la fin de fichier déjà
      // reçue et le cache disque d'abord, puis chaque plage réseau à son
      // arrivée. Tout attendre avant de décoder faisait patienter le niveau 0
      // du centre derrière les 7 Mo du niveau 1 de sa dalle — ~11 s, mesuré.
      const emettre = async (b, octets) => {
        if (signal.aborted || !blocs.has(b.cle)) return;
        const points = await deps.decoder({
          type: 'decoder', octets: octets.slice().buffer, nbPoints: b.noeud.nbPoints,
          formatPoint: d.entete.formatPoint, longueurPoint: d.entete.longueurPoint,
          echelle: d.entete.echelle, decalage: d.entete.decalage, origine: [0, 0, 0], entiers: origineCm,
        });
        const suivi = blocs.get(b.cle);
        if (signal.aborted || !suivi) return;
        suivi.etat = 'charge';
        deps.surBloc?.({ cle: b.cle, url: d.dalle.url, niveau: b.niveau, emprise: b.emprise, origineCm, points });
        publierEtat();
      };

      try {
        const aDemander = [];
        for (const b of lot) {
          const n = b.noeud;
          if (d.debutFin != null && n.offset >= d.debutFin && n.offset + n.taille <= d.debutFin + d.fin.length) {
            await emettre(b, d.fin.subarray(n.offset - d.debutFin, n.offset - d.debutFin + n.taille));
            continue;
          }
          const o = await deps.cache?.lire(cleCache(d.dalle.url, n));
          if (o) await emettre(b, o); else aDemander.push(b);
        }
        for (const plage of COPC.grouperPlages(aDemander.map((b) => ({ ...b.noeud, bloc: b })))) {
          if (signal.aborted) break;
          const o = await deps.recuperer(d.dalle.url, { plage: [plage.debut, plage.fin - 1], signal });
          for (const n of plage.noeuds) {
            const tranche = o.subarray(n.offset - plage.debut, n.offset - plage.debut + n.taille);
            // Suivie comme le reste : une seconde visite juste après doit la trouver.
            if (deps.cache) suivre(deps.cache.ecrire(cleCache(d.dalle.url, n), tranche.slice()));
            await emettre(n.bloc, tranche);
          }
        }
      } catch (e) {
        if (!signal.aborted) console.warn('Flux : blocs non chargés —', e.message);
      }
      for (const b of lot) if (blocs.get(b.cle)?.etat === 'attente') blocs.delete(b.cle);
      liberer();
    }

    let voulues = new Set();

    function planifier() {
      if (!vue) return;
      const marge = agrandi(vue, 1000);
      const visibles = [...dalles.values()].filter((d) => coupe(d.dalle.emprise, vue));

      // Ouvrir ce qui est visible, du centre vers les bords (la file réseau
      // sert dans l'ordre de demande) ; abandonner ce qui est sorti de la marge.
      visibles.filter((d) => d.etat === 'inconnue')
        .sort((a, b) => centreDist(a.dalle.emprise, vue) - centreDist(b.dalle.emprise, vue))
        .forEach((d) => suivre(ouvrir(d)));
      for (const d of dalles.values()) {
        if (d.etat === 'ouverture' && !coupe(d.dalle.emprise, marge)) d.ctrl.abort();
      }

      const pas = FLUX_CHOIX.pasPourVue(vue.xmax - vue.xmin, vue.largeurPx, config.pasMinM);
      const ouvertes = visibles.filter((d) => d.etat === 'ouverte');
      const voulus = FLUX_CHOIX.blocsPourVue(
        ouvertes.map((d) => ({ url: d.dalle.url, emprise: d.dalle.emprise, index: d.index })),
        vue, pas, config.pointsParCase, config.budgetPoints,
      );
      voulues = new Set(voulus.map((b) => b.cle));

      // Abandonner les blocs en attente qui ne sont plus voulus.
      for (const [cle, b] of blocs) {
        if (b.etat === 'attente' && !voulues.has(cle)) { b.ctrl.abort(); blocs.delete(cle); }
      }
      // Demander les nouveaux, un lot par dalle, dans l'ordre de `voulus`.
      const parDalle = new Map();
      for (const b of voulus) {
        if (blocs.has(b.cle)) continue;
        if (!parDalle.has(b.url)) parDalle.set(b.url, []);
        parDalle.get(b.url).push(b);
      }
      for (const [u, lot] of parDalle) suivre(telechargerDalle(dalles.get(u), lot));
      liberer();
      publierEtat();
    }

    function liberer() {
      if (!vue) return;
      const charges = [];
      for (const [cle, b] of blocs) if (b.etat === 'charge') charges.push({ cle, niveau: b.niveau, nbPoints: b.nbPoints, emprise: b.emprise });
      for (const cle of FLUX_CHOIX.aLiberer(charges, voulues, config.budgetPoints, vue)) {
        blocs.delete(cle);
        deps.surLibere?.(cle);
      }
    }

    // Toute la mise à jour est suivie d'un bloc : sans ça, `attendreCalme`
    // pouvait se résoudre dans l'intervalle entre la réponse du WFS et la
    // planification, alors que rien n'était encore demandé.
    const majVue = (v) => suivre(majVueInterne(v));

    async function majVueInterne(v) {
      vue = v;
      if (v.xmax - v.xmin > config.largeurMaxPointsM) {
        for (const d of dalles.values()) if (d.etat === 'ouverture') d.ctrl.abort();
        for (const [cle, b] of blocs) if (b.etat === 'attente') { b.ctrl.abort(); blocs.delete(cle); }
        publierEtat(true);
        return;
      }
      const zone = agrandi(v, 1000);
      if (!zones.some((z) => contient(z, zone))) {
        zones.push(zone);
        const trouvees = await deps.chercherDalles(zone).catch((e) => {
          zones.pop();
          console.warn('Flux : dalles introuvables —', e.message);
          return [];
        });
        for (const dl of trouvees) if (!dalles.has(dl.url)) dalles.set(dl.url, { dalle: dl, etat: 'inconnue' });
      }
      if (vue === v) planifier();
    }

    function attendreCalme() {
      if (!enCours) return Promise.resolve();
      return new Promise((r) => attenteCalme.push(r));
    }

    function arreter() {
      for (const d of dalles.values()) d.ctrl?.abort();
      for (const b of blocs.values()) b.ctrl?.abort();
      blocs.clear();
      vue = null;
    }

    return { majVue, attendreCalme, arreter, _deps: deps };
  }

  return { creer };
})();
