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
    const zonesRepondues = [];  // ceux dont la réponse est arrivée (un échec en est retiré)
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

    let derniereErreur = null;

    function publierEtat(tropLarge = false) {
      let attente = 0, charges = 0, points = 0;
      for (const b of blocs.values()) {
        if (b.etat === 'attente') attente++;
        else { charges++; points += b.nbPoints; }
      }
      let dallesOuvertes = 0, echecs = 0;
      for (const d of dalles.values()) {
        if (d.etat === 'ouverte') dallesOuvertes++;
        else if (d.etat === 'echec') echecs++;
      }
      const surfaceKm2 = vue ? FLUX_CHOIX.surfaceKm2(vue) : 0;
      // Sans LiDAR : le WFS a répondu pour toute la vue, et aucune dalle ne la
      // touche. Ni pendant l'attente de sa réponse, ni après un échec — une
      // panne n'est pas une absence de données.
      const sansLidar = !!vue && !tropLarge && zonesRepondues.some((z) => contient(z, vue))
        && ![...dalles.values()].some((d) => coupe(d.dalle.emprise, vue));
      deps.surEtat?.({ attente, charges, points, dallesOuvertes, tropLarge, echecs, erreur: echecs ? derniereErreur : null, surfaceKm2, sansLidar });
    }

    // Un échec n'est jamais définitif : la dalle est réessayée après un délai
    // qui double à chaque fois (plafonné), et l'échec reste visible dans l'état
    // en attendant. Une dalle vide en silence ressemble à « il n'y a rien ici »,
    // le mode de panne le plus coûteux du projet.
    const minuteurs = new Set();
    function reessayerPlusTard(d) {
      d.echecs = (d.echecs || 0) + 1;
      const delai = Math.min(60_000, (config.delaiReessaiMs) * 2 ** (d.echecs - 1));
      const m = setTimeout(() => {
        minuteurs.delete(m);
        if (d.etat === 'echec') { d.etat = 'inconnue'; planifier(); }
      }, delai);
      minuteurs.add(m);
    }

    const abandon = () => new DOMException('Chargement abandonné', 'AbortError');

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
        // Sous-pages suivies à toute profondeur, comme COPC.lireHierarchie.
        const noeuds = new Map(lu.noeuds);
        const aVisiter = [...lu.sousPages];
        const vues = new Set();
        while (aVisiter.length) {
          const [offset, taille] = aVisiter.shift();
          if (taille <= 0 || vues.has(offset)) continue;
          vues.add(offset);
          const page = await deps.recuperer(d.dalle.url, { plage: [offset, offset + taille - 1], signal });
          const sp = COPC.lireEntrees(page);
          for (const [k, v] of sp.noeuds) noeuds.set(k, v);
          aVisiter.push(...sp.sousPages);
        }
        d.entete = await entete;
        if (signal.aborted) throw abandon();
        Object.assign(d, { index: noeuds, fin, debutFin: debut, etat: 'ouverte', echecs: 0 });
        planifier();
      } catch (e) {
        // Une seule sortie pour l'abandon : la dalle redevient ouvrable. Sortie
        // sans remettre l'état, elle restait « en ouverture » pour la session.
        if (signal.aborted) {
          d.etat = 'inconnue';
          // Redevenue visible pendant l'abandon : la rouvrir tout de suite, sans
          // attendre le prochain déplacement de la vue.
          if (vue && coupe(d.dalle.emprise, vue)) planifier();
          return;
        }
        d.etat = 'echec';
        pomper();   // la barrière du niveau 0 ne l'attend plus
        derniereErreur = deps.expliquer ? deps.expliquer(e) : e.message;
        console.warn('Flux : dalle non ouverte —', e.message);
        reessayerPlusTard(d);
        publierEtat();
      }
    }

    const cleCache = (url, noeud) => `${url}#${noeud.offset}`;
    // Blocs compressés en couches (LAS 1.4, formats 6 à 8) : ceux de l'IGN.
    const enCouches = (d) => d.entete.formatPoint >= 6 && d.entete.formatPoint <= 8;

    // Blocs dont les octets doivent venir du réseau, en attente d'une place.
    const enAttenteReseau = new Set();
    let plagesEnVol = 0;

    /**
     * Retire un bloc en attente. Sa plage réseau n'est abandonnée que si plus
     * aucun de ses blocs n'est voulu : avec un seul contrôleur par dalle,
     * abandonner un bloc sorti de la vue coupait aussi ses voisins encore
     * visibles, qui n'étaient jamais redemandés.
     */
    function retirerBloc(cle) {
      const b = blocs.get(cle);
      blocs.delete(cle);
      enAttenteReseau.delete(cle);
      if (!b?.groupe) return;
      b.groupe.cles.delete(cle);
      if (!b.groupe.cles.size) b.groupe.ctrl.abort();
    }

    /** Décode un bloc dont les octets sont là, et l'émet s'il est encore voulu. */
    async function emettre(d, b, octets) {
      if (blocs.get(b.cle)?.etat !== 'attente') return;
      const origineCm = [Math.round(d.dalle.emprise.xmin * 100), Math.round(d.dalle.emprise.ymin * 100), 0];
      const points = await deps.decoder({
        type: 'decoder', octets: octets.slice().buffer, nbPoints: b.noeud.nbPoints,
        formatPoint: d.entete.formatPoint, longueurPoint: d.entete.longueurPoint,
        echelle: d.entete.echelle, decalage: d.entete.decalage, origine: [0, 0, 0], entiers: origineCm,
      });
      const suivi = blocs.get(b.cle);
      if (suivi?.etat !== 'attente') return;
      suivi.etat = 'charge';
      suivi.groupe = null;
      deps.surBloc?.({ cle: b.cle, url: d.dalle.url, niveau: b.niveau, emprise: b.emprise, origineCm, points });
      publierEtat();
      liberer();
    }

    /**
     * Les blocs nouvellement voulus d'une dalle : décodés tout de suite quand
     * leurs octets sont déjà là (fin de fichier reçue, cache disque), confiés
     * sinon à la file de priorité du réseau. Tout attendre avant de décoder
     * faisait patienter le niveau 0 du centre derrière les 7 Mo du niveau 1 de
     * sa dalle — ~11 s, mesuré.
     */
    async function preparer(d, lot) {
      const reseau = [];
      for (const b of lot) {
        if (!blocs.has(b.cle)) continue;
        const n = b.noeud;
        if (d.debutFin != null && n.offset >= d.debutFin && n.offset + n.taille <= d.debutFin + d.fin.length) {
          await emettre(d, b, d.fin.subarray(n.offset - d.debutFin, n.offset - d.debutFin + n.taille));
          continue;
        }
        const o = await deps.cache?.lire(cleCache(d.dalle.url, n));
        if (!blocs.has(b.cle)) continue;
        if (o) await emettre(d, b, o); else reseau.push(b);
      }
      // Tous ensemble dans la file, une fois le cache consulté : ajoutés un à
      // un, la file partait sur le premier avant de connaître ses voisins plus
      // prioritaires.
      for (const b of reseau) if (blocs.has(b.cle)) enAttenteReseau.add(b.cle);
      pomper();
    }

    /**
     * File de priorité du réseau : au plus `plagesEnVol` plages à la fois,
     * toujours celle du bloc voulu le plus prioritaire (niveau, puis distance
     * au centre de la vue **courante** — le rang est recalculé à chaque vue).
     * Les plages sont bornées à `plageMaxOctets` : les quarts d'une dalle
     * arrivent un à un, du centre vers les bords. Partir par dalle entière, dans
     * l'ordre où les dalles s'ouvraient, donnait une arrivée qui paraissait
     * aléatoire. Un gros bloc part seul, coupé à ses couches lues ; les petits
     * se groupent entiers (voir `coupeMinOctets`).
     */
    function pomper() {
      const niveau = niveauEnCours();
      while (plagesEnVol < config.plagesEnVol) {
        let meilleur = null;
        for (const cle of enAttenteReseau) {
          const b = blocs.get(cle);
          if (!b) { enAttenteReseau.delete(cle); continue; }
          if (b.niveau > niveau) continue;
          if (!meilleur || b.rang < meilleur.rang) meilleur = b;
        }
        if (!meilleur) return;
        const d = dalles.get(meilleur.url);
        const gros = (b) => enCouches(d) && b.bloc.noeud.taille >= config.coupeMinOctets;
        let plage;
        if (gros(meilleur)) {
          const n = meilleur.bloc.noeud;
          plage = { debut: n.offset, fin: n.offset + Math.ceil(n.taille * config.fractionCoupe), noeuds: [{ ...n, bloc: meilleur.bloc }], coupe: true };
        } else {
          const memeDalle = [...enAttenteReseau].map((c) => blocs.get(c))
            .filter((b) => b && b.url === meilleur.url && b.niveau <= niveau && !gros(b));
          const plages = COPC.grouperPlages(memeDalle.map((b) => ({ ...b.bloc.noeud, bloc: b.bloc })), 0, config.plageMaxOctets);
          plage = plages.find((p) => p.noeuds.some((n) => n.bloc.cle === meilleur.bloc.cle));
        }
        for (const n of plage.noeuds) enAttenteReseau.delete(n.bloc.cle);
        plagesEnVol++;
        // La relance est dans la tâche suivie : sinon `attendreCalme` se
        // résolvait entre la fin d'une plage et le départ de la suivante.
        suivre(servirPlage(d, plage).finally(() => { plagesEnVol--; pomper(); }));
      }
    }

    /**
     * Le niveau en cours : le plus grossier dont un bloc voulu n'est pas encore
     * arrivé — 0 tant qu'une dalle visible n'a pas livré sa fin de fichier.
     * Rien d'un niveau plus fin ne part avant (l'ordre de Potree, tenu cette
     * fois jusqu'au bout) : retour d'usage, du détail arrivait avant que tout
     * l'écran ait son niveau grossier, et un déplacement le rendait inutile.
     * Le prix : moins de requêtes en vol à la fin de chaque niveau.
     */
    function niveauEnCours() {
      if (vue && [...dalles.values()].some((d) => (d.etat === 'inconnue' || d.etat === 'ouverture') && coupe(d.dalle.emprise, vue))) return 0;
      let n = Infinity;
      for (const b of blocs.values()) if (b.etat === 'attente' && b.niveau < n) n = b.niveau;
      return n;
    }

    async function servirPlage(d, plage) {
      const cles = new Set(plage.noeuds.map((n) => n.bloc.cle).filter((c) => blocs.has(c)));
      if (!cles.size) return;
      const groupe = { ctrl: new AbortController(), cles };
      for (const c of cles) blocs.get(c).groupe = groupe;
      let o;
      try {
        o = await deps.recuperer(d.dalle.url, { plage: [plage.debut, plage.fin - 1], signal: groupe.ctrl.signal });
        // Un bloc coupé : si ses couches lues dépassent le début reçu, le reste.
        const utile = plage.coupe ? COPC.tailleUtileBloc(o, d.entete.formatPoint, d.entete.longueurPoint) : null;
        if (utile > o.length) {
          const reste = await deps.recuperer(d.dalle.url, { plage: [plage.debut + o.length, plage.debut + utile - 1], signal: groupe.ctrl.signal });
          const tout = new Uint8Array(o.length + reste.length);
          tout.set(o); tout.set(reste, o.length);
          o = tout;
        }
      } catch (e) {
        for (const c of cles) if (blocs.get(c)?.etat === 'attente') blocs.delete(c);
        if (groupe.ctrl.signal.aborted) return;
        // Les blocs ratés sont redemandés plus tard, par une nouvelle
        // planification, sans marteler l'IGN.
        console.warn('Flux : blocs non chargés —', e.message);
        derniereErreur = deps.expliquer ? deps.expliquer(e) : e.message;
        const m = setTimeout(() => { minuteurs.delete(m); planifier(); }, config.delaiReessaiMs);
        minuteurs.add(m);
        return;
      }
      for (const n of plage.noeuds) {
        const brut = o.subarray(n.offset - plage.debut, n.offset - plage.debut + n.taille);
        // Réduit aux couches lues, coupé ou non : le cache en garde moins, et
        // le décodeur n'a pas d'autre travail à faire.
        const tranche = (enCouches(d) && COPC.reduireBloc(brut, d.entete.formatPoint, d.entete.longueurPoint)) || brut;
        // Suivie comme le reste : une seconde visite juste après doit la trouver.
        if (deps.cache) suivre(deps.cache.ecrire(cleCache(d.dalle.url, n), tranche.slice()));
        await emettre(d, n.bloc, tranche);
      }
      for (const c of cles) if (blocs.get(c)?.etat === 'attente') blocs.delete(c);
    }

    let voulues = new Set();

    function planifier() {
      if (!vue || FLUX_CHOIX.surfaceKm2(vue) > config.surfaceMaxPointsKm2) return;
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
        if (b.etat === 'attente' && !voulues.has(cle)) retirerBloc(cle);
      }
      // Rang de priorité de chaque bloc voulu, pour la vue courante ; les
      // nouveaux, un lot par dalle, passent d'abord par la fin de fichier et
      // le cache, puis par la file de priorité du réseau.
      const parDalle = new Map();
      voulus.forEach((b, rang) => {
        const deja = blocs.get(b.cle);
        if (deja) { deja.rang = rang; return; }
        blocs.set(b.cle, { etat: 'attente', groupe: null, niveau: b.niveau, nbPoints: b.noeud.nbPoints, emprise: b.emprise, rang, url: b.url, bloc: b });
        if (!parDalle.has(b.url)) parDalle.set(b.url, []);
        parDalle.get(b.url).push(b);
      });
      for (const [u, lot] of parDalle) suivre(preparer(dalles.get(u), lot));
      pomper();
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
      if (FLUX_CHOIX.surfaceKm2(v) > config.surfaceMaxPointsKm2) {
        for (const d of dalles.values()) if (d.etat === 'ouverture') d.ctrl.abort();
        for (const [cle, b] of blocs) if (b.etat === 'attente') retirerBloc(cle);
        publierEtat(true);
        return;
      }
      const zone = agrandi(v, 1000);
      if (!zones.some((z) => contient(z, zone))) {
        zones.push(zone);
        const trouvees = await deps.chercherDalles(zone).catch((e) => {
          zones.splice(zones.indexOf(zone), 1);
          console.warn('Flux : dalles introuvables —', e.message);
          return [];
        });
        for (const dl of trouvees) if (!dalles.has(dl.url)) dalles.set(dl.url, { dalle: dl, etat: 'inconnue' });
        if (zones.includes(zone)) zonesRepondues.push(zone);
      }
      // Sans condition, et sur la vue **courante** : une vue arrivée pendant
      // la réponse du WFS avait sauté la requête (zone déjà demandée) et
      // planifié sur des dalles encore inconnues.
      planifier();
    }

    function attendreCalme() {
      if (!enCours) return Promise.resolve();
      return new Promise((r) => attenteCalme.push(r));
    }

    function arreter() {
      for (const d of dalles.values()) d.ctrl?.abort();
      for (const cle of [...blocs.keys()]) retirerBloc(cle);
      for (const m of minuteurs) clearTimeout(m);
      minuteurs.clear();
      vue = null;
    }

    // Les blocs que la vue demande, en copie : le relief ne range que ceux-là
    // dans une grille neuve (vue-relief.js), pas les blocs fins gardés d'une
    // vue précédente.
    /**
     * La dalle (telle que le WFS l'a décrite : nom, emprise, date d'acquisition…)
     * qui contient le point (x, y), en coordonnées locales ; `null` si la vue n'a
     * pas encore trouvé de dalle là. Les bords sud et ouest appartiennent à la
     * dalle, les bords nord et est à sa voisine.
     */
    function dalleAu(x, y) {
      for (const { dalle: dl } of dalles.values()) {
        const e = dl.emprise;
        if (x >= e.xmin && x < e.xmax && y >= e.ymin && y < e.ymax) return dl;
      }
      return null;
    }

    return { majVue, attendreCalme, arreter, dalleAu, voulues: () => new Set(voulues), _deps: deps };
  }

  return { creer };
})();
