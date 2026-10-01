// Le relief de la vue, depuis les blocs de points que flux.js livre.
//
// Les blocs arrivent décodés en centimètres entiers ; ils sont gardés ici, en
// mémoire (sur la carte graphique avec « &gpu »), et la surface
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

  function creer({ moteur = 'auto', couches } = {}) {
    const gpu = moteur !== 'cpu' && gpuVerifie();
    // Couches sur la carte graphique, surface au processeur (le réglage par
    // défaut de la vue normale) ; sinon tout au processeur quand la surface
    // l'est.
    const couchesGpu = couches === 'gpu';
    const calculCouches = gpu || couchesGpu ? {} : { moteur: 'cpu' };
    const blocs = new Map();   // cle → { emprise, origineCm, nbPoints, zminCm, zmaxCm, points, classes }
    let reglagesCourants = {};
    let version = 0;
    let memo = null;           // { cle, t }

    // La grille de la vue, gardée d'un calcul à l'autre (chemin processeur) :
    // chaque bloc n'y est rangé qu'une fois. Refaire tout le rangement à chaque
    // arrivée de blocs coûtait 3 à 5 s à 20 M de points (mesuré) — l'essentiel
    // du recalcul.
    let grille = null;         // { geo, g, ranges: Set<cle>, versionReglages }
    let versionReglages = 0;
    let retiresRanges = false; // un bloc rangé dans la grille a été retiré
    const stats = { reconstructions: 0, decalages: 0, ajouts: 0 };
    const classesPresentes = new Map();

    function ajouter(b) {
      const p = b.points;
      const n = p.nbPoints;
      let zmin = Infinity, zmax = -Infinity;
      const parCode = new Uint32Array(256);
      for (let i = 0; i < n; i++) {
        const z = p.zc[i]; if (z < zmin) zmin = z; if (z > zmax) zmax = z;
        parCode[p.cls[i]]++;
      }
      const classes = histogramme(parCode);
      // Un bloc déjà gardé sous cette clé est remplacé, pas compté deux fois.
      retirer(b.cle);
      if (gpu && !GPU_RELIEF.ajouterBloc(b.cle, p)) return;
      blocs.set(b.cle, {
        emprise: b.emprise, origineCm: b.origineCm, nbPoints: n,
        zminCm: zmin + b.origineCm[2], zmaxCm: zmax + b.origineCm[2],
        // Sur la carte graphique, les points n'ont plus à rester en mémoire.
        points: gpu ? null : p,
        classes,
      });
      for (const [c, k] of classes) classesPresentes.set(c, (classesPresentes.get(c) || 0) + k);
      version++;
    }

    // Les classes présentes d'un comptage par code, en [classe, nombre].
    function histogramme(parCode) {
      const h = new Map();
      for (let c = 0; c < 256; c++) if (parCode[c]) h.set(c, parCode[c]);
      return h;
    }

    function retirer(cle) {
      const b = blocs.get(cle);
      if (!b) return;
      blocs.delete(cle);
      for (const [c, k] of b.classes) classesPresentes.set(c, classesPresentes.get(c) - k);
      if (grille && grille.ranges.has(cle)) retiresRanges = true;
      if (gpu) GPU_RELIEF.retirerBloc(cle);
      version++;
    }

    // Seules les classes du sol changent le rangement : les autres réglages
    // (non classés, bâti, plafond de hauteur) ne touchent que la surface, et se
    // rejouent sur la grille gardée sans reranger un seul point.
    let versionSurface = 0;
    function reglages(r) {
      if ('classesSol' in r) versionReglages++;
      reglagesCourants = { ...reglagesCourants, ...r };
      versionSurface++;
      version++;
    }

    const CHAMPS_RANGEMENT = ['solZ', 'solN', 'ncSomme', 'ncN', 'batSomme', 'batN', 'totalN', 'sommetZ', 'sommetCls'];

    /**
     * Surface au processeur, grille gardée. Trois cas :
     * - même pas, même taille, grille décalée d'un nombre entier de cases
     *   (VUE_GRILLE aligne sur le pas) : la partie commune est recopiée, et les
     *   blocs ne sont rangés que dans la bande entrante ;
     * - autre pas ou taille, réglages changés, pas de recouvrement, ou bloc
     *   rangé puis retiré (un minimum ne se défait pas) : tout est rangé à
     *   neuf, avec les seuls blocs actifs ;
     * - sinon : seuls les blocs actifs arrivés depuis sont rangés.
     */
    function surfaceCPUIncrementale(geo, actifs) {
      const r = { ...reglagesDefaut(geo.pas), ...reglagesCourants };
      const estActif = (cle) => !actifs || actifs.has(cle);
      const coupe = (b) => VUE_GRILLE.coupe(b.emprise, geo);
      const memeForme = grille && grille.geo.pasCm === geo.pasCm && grille.geo.W === geo.W && grille.geo.H === geo.H
        && grille.versionReglages === versionReglages && !retiresRanges;
      const dx = memeForme ? (geo.xminCm - grille.geo.xminCm) / geo.pasCm : 0;
      const dy = memeForme ? (geo.yminCm - grille.geo.yminCm) / geo.pasCm : 0;
      const recouvre = memeForme && Math.abs(dx) < geo.W && Math.abs(dy) < geo.H;

      // L'ancienne surface et sa couche ne serviront plus si la grille change :
      // les lâcher avant d'en bâtir une autre, sans quoi la mémoire du worker
      // tiendrait trois grilles à la fois au moment d'un décalage.
      const lacher = () => {
        memoCouche = null;
        // Le dernier nuage 3D tient sa surface : la lâcher aussi, ou la mémoire
        // garderait une grille de trop.
        dernierNuage = null;
        if (grille) { grille.gFin = null; grille.t = null; }
      };
      if (!recouvre) {
        lacher();
        const choisis = [...blocs].filter(([cle, b]) => estActif(cle) && coupe(b));
        retiresRanges = false;
        if (!choisis.length) { grille = null; return null; }
        // Altitude de référence fixée à la création de la grille et gardée
        // tant qu'elle vit : les altitudes rangées y sont relatives. Un bloc
        // arrivé plus bas reste juste, les tableaux sont en Float32.
        const zRefCm = Math.min(...choisis.map(([, b]) => b.zminCm)) - 100;
        const g = RASTER.creerGrillesVue(geo, zRefCm, r.classesSol);
        for (const [, b] of choisis) RASTER.accumuler(g, { ...b.points, origineCm: b.origineCm });
        grille = { geo, g, ranges: new Set(choisis.map(([cle]) => cle)), versionReglages };
        stats.reconstructions++;
      } else if (dx !== 0 || dy !== 0) {
        lacher();
        const ancienne = grille.g;
        const g = RASTER.creerGrillesVue(geo, ancienne.geoCm.zRefCm, r.classesSol);
        const debut = Math.max(0, -dx), fin = Math.min(geo.W, geo.W - dx);
        for (const champ of CHAMPS_RANGEMENT) {
          const src = ancienne[champ], dst = g[champ];
          for (let y = Math.max(0, -dy); y < Math.min(geo.H, geo.H - dy); y++) {
            dst.set(src.subarray((y + dy) * geo.W + debut + dx, (y + dy) * geo.W + fin + dx), y * geo.W + debut);
          }
        }
        const commune = { x0: debut, y0: Math.max(0, -dy), x1: fin, y1: Math.min(geo.H, geo.H - dy) };
        const ranges = new Set();
        for (const [cle, b] of blocs) {
          if (!coupe(b)) continue;
          if (grille.ranges.has(cle)) { RASTER.accumuler(g, { ...b.points, origineCm: b.origineCm }, commune); ranges.add(cle); }
          else if (estActif(cle)) { RASTER.accumuler(g, { ...b.points, origineCm: b.origineCm }); ranges.add(cle); }
        }
        grille = { geo, g, ranges, versionReglages };
        stats.decalages++;
      }
      for (const [cle, b] of blocs) {
        if (grille.ranges.has(cle) || !estActif(cle) || !coupe(b)) continue;
        RASTER.accumuler(grille.g, { ...b.points, origineCm: b.origineCm });
        grille.ranges.add(cle);
        grille.gFin = null;
        stats.ajouts++;
      }
      // Terrain gardé tant que rien n'est rangé ; surface gardée tant que ses
      // réglages ne changent pas. Rendre le même objet `t` garde aussi la
      // couche (mémo de `calculer`) : un bloc arrivé hors de la vue, ou un
      // changement de contraste, ne refait ni terrain, ni surface, ni SVF.
      if (!grille.gFin) {
        // Copie superficielle : finaliser ajoute mnt, solConnu et pente, sans
        // toucher aux tableaux de rangement, qui doivent rester intacts pour
        // les rangements suivants.
        grille.gFin = { ...grille.g };
        RASTER.finaliser(grille.gFin, { moteur: 'cpu', passes: r.passes, rayonLissage: r.rayonLissage });
        grille.t = null;
      }
      if (!grille.t || grille.versionSurface !== versionSurface) {
        grille.t = RELIEF.preparer(grille.gFin, {
          moteur: 'cpu', pasM: geo.pas, garderRepli: true,
          inclureBati: r.inclureBati, inclureSursol: r.inclureSursol, hauteurSursolMaxM: r.hauteurSursolMaxM,
        });
        grille.versionSurface = versionSurface;
      }
      return grille.t;
    }

    function surface(geo, actifs) {
      // Au processeur, la grille gardée sait elle-même ce qui a changé.
      if (!gpu) return surfaceCPUIncrementale(geo, actifs);
      const cleMemo = `${version}|${geo.xminCm}|${geo.yminCm}|${geo.pasCm}|${geo.W}|${geo.H}|${actifs ? [...actifs].sort().join(',') : '*'}`;
      if (memo && memo.cle === cleMemo) return memo.t;
      let t = null;
      {
        const choisis = [...blocs].filter(([cle, b]) => (!actifs || actifs.has(cle)) && VUE_GRILLE.coupe(b.emprise, geo));
        if (choisis.length) {
          let zmin = Infinity, zmax = -Infinity;
          for (const [, b] of choisis) { zmin = Math.min(zmin, b.zminCm); zmax = Math.max(zmax, b.zmaxCm); }
          // Un mètre de marge de part et d'autre : la profondeur de la carte
          // graphique est bornée à [0, 1], un point à la limite serait écrêté.
          const zRefCm = zmin - 100, spanCm = zmax - zRefCm + 100;
          const r = { ...reglagesDefaut(geo.pas), ...reglagesCourants };
          t = GPU_RELIEF.surfaceVue(geo, choisis.map(([cle, b]) => ({ cle, origineCm: b.origineCm })), zRefCm, spanCm, r);
        }
      }
      memo = { cle: cleMemo, t };
      return t;
    }

    function statistiques(remettre = false) {
      const s = { ...stats };
      if (remettre) { stats.reconstructions = 0; stats.decalages = 0; stats.ajouts = 0; }
      return s;
    }

    function classes() {
      return [...classesPresentes].filter(([, n]) => n > 0).sort((a, b) => a[0] - b[0]);
    }

    // La couche calculée est gardée tant que la surface et la clé ne changent
    // pas : un changement de contraste ne réétire que l'intervalle — refaire
    // un SVF à chaque cran du curseur coûterait des secondes.
    // Les couches de la surface courante, par clé et réglages : une de chaque
    // côté du rideau, et un aller-retour du sélecteur ne refait rien. Vidé
    // quand la surface change — c'est elle qui fait leur validité.
    let memoCouche = null;   // { t, couches: Map<cle|réglages, c>, derniere: c }
    // L'ombrage coloré (trois soleils, un par canal) ne suit pas le contrat
    // des couches de RELIEF.COUCHES : il rend directement des couleurs.
    // `reglagesCouche` : ceux du panneau propres à une couche (directions et
    // rayon du Sky-View Factor…), par-dessus CONFIG.relief.
    function calculerCouche(t, cle, reglagesCouche) {
      const p = { ...calculCouches, ...reglagesCouche };
      if (cle === 'ombrage-rgb') {
        const rgba = RELIEF.ombrageRGB(t, p);
        return { cle, rgba, moteur: RELIEF.moteur() };
      }
      return RELIEF.calculer(t, cle, p);
    }
    // Couches gardées par surface : au-delà, la moins récemment lue est lâchée.
    // Chaque réglage essayé au curseur (directions, rayon) en ajoute une, et
    // chacune pèse une grille entière.
    const COUCHES_GARDEES = 6;
    /** La couche `cle` de la surface `t`, prise dans le mémo ou calculée. */
    function couche(t, cle, reglagesCouche) {
      if (!memoCouche || memoCouche.t !== t) memoCouche = { t, couches: new Map(), derniere: null };
      const k = `${cle}|${JSON.stringify(reglagesCouche || {})}`;
      const couches = memoCouche.couches;
      const recalcul = !couches.has(k);
      // Relue ou calculée, elle devient la plus récente (ordre d'insertion).
      const c = recalcul ? calculerCouche(t, cle, reglagesCouche) : couches.get(k);
      couches.delete(k);
      couches.set(k, c);
      if (couches.size > COUCHES_GARDEES) couches.delete(couches.keys().next().value);
      return { c, recalcul };
    }
    function calculer(geo, cle, options = {}) {
      const t0 = performance.now();
      const t = surface(geo, options.actifs);
      if (!t) return null;
      const dureeSurface = performance.now() - t0;
      const { c, recalcul } = couche(t, cle, options.couche);
      memoCouche.derniere = c;
      // Une couche déjà en couleurs n'a ni palette ni intervalle à étirer.
      if (c.rgba) {
        return {
          ...c, geo, t, recalcul, moteurSurface: gpu ? 'gpu' : 'cpu', moteurCouche: c.moteur,
          dureeSurface, duree: performance.now() - t0,
        };
      }
      const [min, max] = RELIEF.etirer(c.base, c.ancrage, options.contraste ?? 1);
      return {
        ...c, min, max, geo, t, recalcul, moteurSurface: gpu ? 'gpu' : 'cpu', moteurCouche: c.moteur,
        dureeSurface, duree: performance.now() - t0,
      };
    }

    /**
     * Ce que la vue calculée dit d'un point Lambert-93 : altitude absolue du
     * sol affiché (null sans sol connu), hauteur de ce qui s'y dresse, valeur
     * de la couche. Lu dans la dernière vue calculée, jamais recalculé : c'est
     * ce que l'écran montre. `null` hors de cette vue.
     */
    function lire(x, y, cle) {
      if (!memoCouche) return null;
      const { t } = memoCouche;
      // La couche demandée (le côté du rideau survolé), la dernière calculée
      // sinon ; `valeur` nulle si elle n'a pas été calculée sur cette surface.
      let c = cle ? null : memoCouche.derniere;
      // Même clé sous plusieurs réglages : la plus récemment calculée.
      if (cle) for (const [k, v] of memoCouche.couches) if (k.startsWith(`${cle}|`)) c = v;
      const cx = Math.floor((x - t.emprise.xmin) / t.pas), cy = Math.floor((y - t.emprise.ymin) / t.pas);
      if (cx < 0 || cy < 0 || cx >= t.W || cy >= t.H) return null;
      const i = cy * t.W + cx;
      return {
        x, y,
        altitude: t.valide[i] ? t.mnt[i] + t.origine[2] : null,
        hauteur: t.hauteur[i],
        valeur: c && c.valeurs ? c.valeurs[i] : null,
      };
    }

    // Hachage entier d'un point (centimètres absolus) → [0, 1) : le tirage du
    // plafond est déterministe — même vue, mêmes points, pas de scintillement
    // d'un passage en 3D à l'autre — et sans état.
    function hacher(x, y, z) {
      let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y ^ 0xc2b2ae35, 0x27d4eb2f) ^ Math.imul(z, 0x165667b1);
      h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
      return (h >>> 0) / 4294967296;
    }

    // Du dernier nuage 3D : la surface lue pour ses hauteurs, et la case de
    // chaque point dans cette surface (−1 hors d'elle) — le drapé n'a plus
    // qu'à lire la couche à ces cases.
    let dernierNuage = null;   // { t, cases: Int32Array }

    /**
     * L'ordre des `n` premiers points rangés par paquet de hachage : paquet
     * = hachage ramené à [0, 1) par le taux du tirage (un point gardé a un
     * hachage sous `taux`), sur 256 paquets. Les points d'un paquet sont
     * répartis partout : chaque préfixe de paquets est un tirage régulier.
     */
    function rangerParHachage(xs, ys, zs, n, taux) {
      const paquet = new Uint8Array(n);
      const compte = new Uint32Array(257);
      for (let i = 0; i < n; i++) {
        const p = Math.min(255, Math.floor((hacher(xs[i], ys[i], zs[i]) / taux) * 256));
        paquet[i] = p;
        compte[p + 1]++;
      }
      for (let p = 1; p < 257; p++) compte[p] += compte[p - 1];
      const ordre = new Int32Array(n);
      for (let i = 0; i < n; i++) ordre[compte[paquet[i]]++] = i;
      return ordre;
    }

    /** Le nuage de la vue pour l'onglet 3D (spec 2026-09-27-vue-3d-design). */
    function nuage3d(emprise, budget, actifs) {
      dernierNuage = null;
      if (gpu) return { raison: 'Nuage 3D indisponible quand tout le calcul est sur la carte graphique (&gpu).' };
      const e = { xmin: Math.round(emprise.xmin * 100), xmax: Math.round(emprise.xmax * 100), ymin: Math.round(emprise.ymin * 100), ymax: Math.round(emprise.ymax * 100) };
      const dedans = [...blocs].filter(([cle, b]) => (!actifs || actifs.has(cle)) && VUE_GRILLE.coupe(b.emprise, { emprise }));
      // Premier passage : compter, pour connaître le taux à tirer.
      let total = 0;
      for (const [, b] of dedans) {
        // Un bloc entier dans l'emprise (en centimètres, bord haut exclu) :
        // tous ses points comptent.
        const be = b.emprise;
        if (be.xmin * 100 >= e.xmin && be.xmax * 100 <= e.xmax - 1 && be.ymin * 100 >= e.ymin && be.ymax * 100 <= e.ymax - 1) {
          total += b.nbPoints;
          continue;
        }
        const p = b.points, [ox, oy] = b.origineCm;
        for (let i = 0; i < b.nbPoints; i++) {
          const x = p.xc[i] + ox, y = p.yc[i] + oy;
          if (x >= e.xmin && x < e.xmax && y >= e.ymin && y < e.ymax) total++;
        }
      }
      if (!total) return null;
      const taux = Math.min(1, budget / total);
      // Second passage : garder, dans des tableaux au plus juste.
      const cap = Math.min(total, Math.ceil(budget * 1.05) + 1000);
      let xs = new Int32Array(cap), ys = new Int32Array(cap), zs = new Int32Array(cap);
      let cls = new Uint8Array(cap), n = 0;
      let zminCm = Infinity, zmaxCm = -Infinity;
      for (const [, b] of dedans) {
        const p = b.points, [ox, oy, oz] = b.origineCm;
        for (let i = 0; i < b.nbPoints; i++) {
          const x = p.xc[i] + ox, y = p.yc[i] + oy;
          if (x < e.xmin || x >= e.xmax || y < e.ymin || y >= e.ymax) continue;
          const z = p.zc[i] + oz;
          if (taux < 1 && hacher(x, y, z) >= taux) continue;
          if (n === xs.length) {   // tirage au-dessus de la réserve : on agrandit
            const agrandir = (t) => { const u = new t.constructor(t.length * 2); u.set(t); return u; };
            xs = agrandir(xs); ys = agrandir(ys); zs = agrandir(zs); cls = agrandir(cls);
          }
          xs[n] = x; ys[n] = y; zs[n] = z; cls[n] = p.cls[i];
          if (z < zminCm) zminCm = z; if (z > zmaxCm) zmaxCm = z;
          n++;
        }
      }
      const origine = [e.xmin / 100, e.ymin / 100, zminCm / 100];
      const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n), H = new Float32Array(n);
      // La surface n'est lue que si elle couvre toute l'emprise : calculée pour
      // une vue précédente (relief en pause pendant la 3D, calcul en retard),
      // elle donnerait des hauteurs et un drapé faux sur une partie du nuage.
      const tc = memoCouche && memoCouche.t;
      const couvre = tc && tc.emprise.xmin <= emprise.xmin && tc.emprise.ymin <= emprise.ymin
        && tc.emprise.xmax >= emprise.xmax && tc.emprise.ymax >= emprise.ymax;
      const t = couvre ? tc : null;
      const cases = new Int32Array(n).fill(-1);
      const parCode = new Uint32Array(256);
      // Rangés par paquets du même hachage que le tirage : n'importe quel
      // début du nuage en est alors un échantillon régulier, et la 3D peut
      // n'en dessiner qu'une part pendant qu'on bouge (Vue3D._rendre). Un tri
      // par comptage sur 256 paquets : une passe, pas de tri.
      const ordre = rangerParHachage(xs, ys, zs, n, taux);
      const C = new Uint8Array(n);
      for (let k = 0; k < n; k++) {
        const i = ordre[k];
        X[k] = (xs[i] - e.xmin) / 100; Y[k] = (ys[i] - e.ymin) / 100; Z[k] = (zs[i] - zminCm) / 100;
        C[k] = cls[i];
        parCode[cls[i]]++;
        if (t) {
          const cx = Math.floor((xs[i] / 100 - t.emprise.xmin) / t.pas), cy = Math.floor((ys[i] / 100 - t.emprise.ymin) / t.pas);
          if (cx >= 0 && cy >= 0 && cx < t.W && cy < t.H) {
            cases[k] = cy * t.W + cx;
            if (t.valide[cases[k]]) H[k] = zs[i] / 100 - (t.mnt[cases[k]] + t.origine[2]);
          }
        }
      }
      if (t) dernierNuage = { t, cases };
      return {
        n, x: X, y: Y, z: Z, cls: C, hauteur: H,
        origine, emprise: { ...emprise }, zmin: 0, zmax: (zmaxCm - zminCm) / 100,
        parClasse: [...histogramme(parCode)],
      };
    }

    /**
     * Les points de la bande A→B pour le profil (spec 2026-10-01-profil-design) :
     * pour chacun, sa distance le long de l'axe et son altitude vraie. Un
     * balayage linéaire des blocs qui touchent la boîte de la bande — appelé à
     * la validation, pas à chaque image. Les comparaisons se font en
     * centimètres entiers : un point pile sur le bord (ou sur A, ou sur B) est
     * gardé, sans dépendre d'un arrondi de flottant. Au-delà de `budget`, le
     * tirage par hachage de `nuage3d` : mêmes points d'un calcul à l'autre.
     */
    function profil(a, b, largeur, budget, actifs) {
      if (gpu) return { raison: 'Profil indisponible quand tout le calcul est sur la carte graphique (&gpu).' };
      const ax = PROFIL.axe(a, b);
      if (!ax) return { raison: 'Les deux points sont confondus.' };
      const larg = PROFIL.largeurValide(largeur);
      const emprise = PROFIL.emprise(a, b, larg);
      const dedans = [...blocs].filter(([cle, bl]) => (!actifs || actifs.has(cle)) && VUE_GRILLE.coupe(bl.emprise, { emprise }));
      if (!dedans.length) return { raison: 'Aucun point chargé ici — zoomez sur la zone.' };
      const ax0 = Math.round(a[0] * 100), ay0 = Math.round(a[1] * 100);
      const longCm = ax.longueur * 100, demiCm = larg * 50;
      // Le parcours commun aux deux passages : le visiteur reçoit s (cm le long
      // de l'axe), z (cm) et la classe, plus x et y absolus (cm) pour le hachage.
      const pourChaque = (visiteur) => {
        for (const [, bl] of dedans) {
          const p = bl.points, [ox, oy, oz] = bl.origineCm;
          for (let i = 0; i < bl.nbPoints; i++) {
            const xa = p.xc[i] + ox, ya = p.yc[i] + oy;
            const dx = xa - ax0, dy = ya - ay0;
            const s = dx * ax.ux + dy * ax.uy;
            if (s < 0 || s > longCm) continue;
            if (Math.abs(dx * ax.nx + dy * ax.ny) > demiCm) continue;
            visiteur(s, p.zc[i] + oz, p.cls[i], xa, ya);
          }
        }
      };
      let total = 0;
      pourChaque(() => { total++; });
      if (!total) return { raison: 'Aucun point dans la bande — zoomez, ou élargissez-la.' };
      const taux = Math.min(1, budget / total);
      const cap = Math.min(total, Math.ceil(budget * 1.05) + 1000);
      const S = new Float32Array(cap), Z = new Float32Array(cap), C = new Uint8Array(cap);
      const parCode = new Uint32Array(256);
      let n = 0;
      pourChaque((s, z, c, xa, ya) => {
        if (taux < 1 && hacher(xa, ya, z) >= taux) return;   // le visiteur est une fonction : return saute le point
        if (n === cap) return;   // le tirage dépasse la réserve : rare, on s'arrête là
        S[n] = s / 100; Z[n] = z / 100; C[n] = c; parCode[c]++; n++;
      });
      return {
        n, s: n === cap ? S : S.slice(0, n), z: n === cap ? Z : Z.slice(0, n), cls: n === cap ? C : C.slice(0, n),
        longueur: ax.longueur, largeur: larg, total, plafonne: taux < 1,
        parClasse: [...histogramme(parCode)],
      };
    }

    /**
     * La couche `cle` drapée sur le dernier nuage 3D : sa valeur à la case de
     * chaque point, ramenée dans [0, 1] par l'étirement (min, max) de l'image
     * du même côté — les deux vues restent la même image. Sans valeur ou hors
     * de la surface : 0, le fond de l'échelle (convention de
     * RELIEF.valeurParPoint). La couche vient du mémo, ou se calcule sur la
     * surface du nuage.
     */
    function drape3d(cle, reglagesCouche, min, max) {
      if (!dernierNuage) return null;
      const { t, cases } = dernierNuage;
      // Sur la surface du mémo, la couche y est prise ou gardée ; sur une
      // autre (le mémo a changé depuis le nuage), calculée sans la garder.
      const c = memoCouche && memoCouche.t === t ? couche(t, cle, reglagesCouche).c : calculerCouche(t, cle, reglagesCouche);
      const out = new Float32Array(cases.length);
      if (!c.valeurs) return out;   // une couche en couleurs (ombrage coloré) ne se drape pas
      const etendue = max - min || 1;
      for (let i = 0; i < cases.length; i++) {
        const v = cases[i] < 0 ? NaN : c.valeurs[cases[i]];
        out[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, (v - min) / etendue)) : 0;
      }
      return out;
    }

    return {
      ajouter, retirer, reglages, surface, calculer, statistiques, classes, lire, nuage3d, drape3d, profil,
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
