// Détection de sentiers : chemins creux, tracés abandonnés, anciennes voies.
//
// Problème différent de celui des ruines, et donc chaîne différente. Une ruine
// est une **tache** compacte qu'on isole par morphologie ; un sentier est une
// **structure linéaire fine**, longue de dizaines de mètres et large de moins
// d'un, qu'aucun filtre de forme ne trouvera. Ici on ne cherche pas des
// composantes connexes mais des lignes.
//
// Le signal est topographique, pas radiométrique : le passage répété a creusé
// le sol. On travaille donc sur le modèle de terrain, jamais sur les classes.
//
// Trois raisons de ne pas partir d'un ombrage (hillshade), le réflexe habituel :
// il dépend d'une direction d'éclairage, rate les structures parallèles au
// faisceau, et mélange le relief général au micro-relief. La littérature
// archéologique lui préfère des visualisations non directionnelles — sky-view
// factor, openness. On applique ici le même principe, mais avec un détecteur
// plutôt qu'une visualisation.

/**
 * Cherche les tracés linéaires creux dans les grilles d'une dalle.
 *
 * @param {object} g grilles issues de `RASTER.finaliser`
 * @param {object} [reglages] surcharge de `CONFIG.sentiers`
 * @returns {{traces:Array, carte:object, stats:object}}
 */
function detecterSentiers(g, reglages = {}) {
  const p = { ...CONFIG.sentiers, ...reglages };

  // Chronométrage par étape, remonté dans `stats`. Utile à l'affichage, et
  // indispensable au diagnostic : quand la détection devient trop lourde, seule
  // la répartition dit laquelle des cinq étapes en est la cause.
  const temps = {};
  let jalon = performance.now();
  const marquer = (nom) => { temps[nom] = performance.now() - jalon; jalon = performance.now(); };

  // ── 1. Grille de travail, plus grossière ──────────────────────────────────
  //
  // La détection de ruines réclame 25 cm pour lire un mur. Un sentier fait 60 cm
  // à 4 m de large : à 25 cm on paierait seize fois le calcul pour du bruit en
  // plus. L'openness et la hessienne multi-échelle sont les étapes coûteuses,
  // autant les mener sur une grille adaptée à l'objet.
  const t = sousEchantillonner(g, p.pasM);

  marquer('sousEchantillonnage');

  // ── 2. Modèle de relief local ─────────────────────────────────────────────
  //
  // MNT moins MNT lissé : le relief général disparaît, le micro-relief reste.
  // Sans cette étape, un versant à 30° écraserait le creux de 40 cm qu'on
  // cherche — la pente locale du terrain est mille fois plus forte que le
  // signal.
  const rayon = Math.round(p.rayonReliefM / p.pasM);

  // Lissage à convolution normalisée : on lisse séparément l'altitude pondérée
  // et le poids, puis on divise. Les cellules sans sol connu ne contribuent
  // donc pas du tout, au lieu d'y injecter une valeur inventée que le lissage
  // étalerait sur tout le voisinage.
  const poids = new Float32Array(t.N);
  const pondere = new Float32Array(t.N);
  for (let i = 0; i < t.N; i++) {
    const bon = Number.isFinite(t.mnt[i]) && t.sol[i] > 0;
    poids[i] = bon ? 1 : 0;
    pondere[i] = bon ? t.mnt[i] : 0;
  }
  const sommeP = flouGaussien(pondere, t.W, t.H, rayon);
  const sommeW = flouGaussien(poids, t.W, t.H, rayon);

  const relief = new Float32Array(t.N);
  for (let i = 0; i < t.N; i++) {
    relief[i] = poids[i] && sommeW[i] > 0.05 ? t.mnt[i] - sommeP[i] / sommeW[i] : 0;
  }

  // Le lissage se replie sur les bords : faute de voisins au-delà, il y
  // recopie la dernière valeur. Sur un versant, la moyenne locale s'en trouve
  // biaisée et le relief local atteint ±1,5 m en lisière — mesuré sur un plan
  // à 15° — là où il vaut 0,02 m au centre. C'est un faux creux parfaitement
  // linéaire le long du bord, exactement ce que le détecteur cherche.
  // On écarte donc une marge — de **trois fois** le rayon, et non d'une seule :
  // l'approximation gaussienne enchaîne trois flous de boîte, dont la portée
  // cumulée vaut trois rayons. Une marge d'un seul rayon laissait passer
  // l'artefact, qui saturait alors la réponse sur un versant pourtant nu.
  const marge = 3 * rayon;
  const valide = new Uint8Array(t.N);
  for (let y = marge; y < t.H - marge; y++) {
    for (let x = marge; x < t.W - marge; x++) {
      // Sous couvert dense, le MNT est interpolé sur de longues distances et ne
      // décrit plus le sol : on n'y cherche rien. Le voisinage doit lui aussi
      // être suffisamment renseigné, sans quoi la référence locale est tirée de
      // trop peu de cellules.
      const c = y * t.W + x;
      if (t.sol[c] >= p.partSolMin && sommeW[c] >= p.voisinageSolMin) valide[c] = 1;
    }
  }

  marquer('reliefLocal');

  // ── 3. Rugosité locale ────────────────────────────────────────────────────
  //
  // Un creux de 40 cm ne veut pas dire la même chose partout. Sur une prairie
  // lisse il saute aux yeux ; sur un plateau rocheux où le relief local médian
  // atteint déjà 79 cm — mesuré sur la dalle de Beille — il se noie dans le
  // terrain. Un seuil absolu ne peut donc pas servir les deux : calibré sur le
  // lisse, il fait déborder le rugueux ; calibré sur le rugueux, il devient
  // aveugle au reste.
  //
  // On rapporte donc la réponse à l'agitation locale du terrain. Le seuil
  // devient sans dimension : « combien de fois plus marqué que ce qui
  // l'entoure », ce qui a le même sens partout.
  const rugosite = rugositeLocale(relief, t, p);

  marquer('rugosite');

  // ── 4. Réponse linéaire multi-échelle ─────────────────────────────────────
  const { reponse, echelle, orientation } = vesselness(relief, rugosite, t, p);
  for (let i = 0; i < t.N; i++) if (!valide[i]) reponse[i] = 0;

  marquer('vesselness');

  // ── 4. Seuillage par hystérésis, puis amincissement ───────────────────────
  //
  // Deux seuils plutôt qu'un : le seuil haut ne retient que les portions
  // franches, le seuil bas prolonge à partir d'elles. Un sentier s'efface par
  // endroits — labour, éboulis, végétation dense — et un seuil unique le
  // hacherait en tronçons sans lien.
  const masque = hysteresis(reponse, t.W, t.H, p.seuilHaut, p.seuilBas);

  // Garde-fou : au-delà d'une certaine densité, on refuse de continuer.
  //
  // L'amincissement de Zhang-Suen ronge le masque couronne par couronne : son
  // coût croît avec la surface **et** avec l'épaisseur des taches. Sur un
  // masque clairsemé il converge en quelques tours ; sur un masque quasi plein
  // il en faut des dizaines sur des millions de cellules, et la page se fige
  // plusieurs minutes — ce que l'utilisateur lit comme un plantage.
  //
  // Ce cas n'est de toute façon pas exploitable : squelettiser un terrain
  // couvert à moitié ne produit pas des sentiers mais le graphe du bruit. Mieux
  // vaut s'arrêter et dire quoi régler.
  let part = 0;
  for (let i = 0; i < t.N; i++) part += masque[i];
  part /= t.N;
  if (part > p.masqueMaxPart) {
    const e = new Error(
      `Trop de relief retenu (${(100 * part).toFixed(0)} % de la dalle) pour que `
      + `la squelettisation ait un sens. Augmentez la sensibilité — ce terrain est `
      + `plus accidenté que le réglage ne le suppose.`);
    e.nom = 'MasqueTropDense';
    throw e;
  }

  const squelette = amincir(masque, t.W, t.H);

  marquer('seuillage');

  // ── 5. Vectorisation, puis recollement ────────────────────────────────────
  //
  // L'amincissement coupe net à chaque croisement, et un sentier réel s'efface
  // par endroits. Sans recollement, un chemin de 300 m ressort en douze
  // tronçons de 25 m dont aucun ne dit rien. On rabout donc les bouts qui se
  // font face et pointent dans la même direction.
  const chaines = relier(vectoriser(squelette, t.W, t.H), t, p);

  marquer('vectorisation');

  // ── 6. Qualification ──────────────────────────────────────────────────────
  const traces = [];
  const motifs = { longueur: 0, ravine: 0, penteLongue: 0, profondeur: 0, tortuosite: 0 };

  for (const chaine of chaines) {
    const mes = mesurerTrace(chaine, t, relief, reponse, echelle, p);
    if (mes.longueur < p.longueurMinM) { motifs.longueur++; continue; }
    if (mes.penteLongueMed > p.penteLongueMaxDeg) { motifs.penteLongue++; continue; }
    if (mes.tortuosite > p.tortuositeMax) { motifs.tortuosite++; continue; }
    if (mes.alignementPente > p.alignementMax) { motifs.ravine++; continue; }
    if (mes.profondeurMed < p.profondeurMinM || mes.profondeurMed > p.profondeurMaxM) {
      motifs.profondeur++; continue;
    }
    traces.push({ id: traces.length + 1, ...mes });
  }

  marquer('qualification');

  for (const s of traces) s.score = noterTrace(s, p);
  traces.sort((a, b) => b.score - a.score);
  traces.forEach((s, i) => { s.rang = i + 1; });

  return {
    traces,
    // `masque` et `rugosite` ne servent à rien pour le résultat final — seul
    // `squelette` compte en aval — mais c'est justement ce qui manque pour
    // diagnostiquer où le signal se perd étape par étape (voir #2 du TODO) :
    // sans eux, impossible de voir la réponse ou le masque avant amincissement.
    carte: { ...t, relief, rugosite, reponse, orientation, masque, squelette },
    stats: {
      pas: t.pas,
      cellules: t.N,
      chainesBrutes: chaines.length,
      plusLongueChaine: chaines.reduce((m, c) => Math.max(m, c.length), 0),
      cellulesMasque: masque.reduce((n, v) => n + v, 0),
      retenues: traces.length,
      rejets: motifs,
      temps,
    },
  };
}

/**
 * Score de vraisemblance, dans [0, 1].
 *
 * La longueur pèse le plus : c'est ce qu'un accident de terrain isolé ne
 * produit pas. Vient ensuite le fait de traverser le versant plutôt que d'en
 * suivre la ligne de plus grande pente — la marque d'un tracé choisi.
 */
function noterTrace(s, p) {
  const entre = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));

  const longueur = entre(s.longueur, p.longueurMinM, 300);
  const traverse = 1 - entre(s.alignementPente, 0.2, p.alignementMax);
  const forme = 1 - entre(s.tortuosite, 2, p.tortuositeMax);
  const regularite = 1 - entre(s.penteLongueEcartType, 2, 14);
  const nettete = entre(s.reponseMed, p.seuilBas, p.seuilHaut * 1.6);

  // La profondeur ne récompense plus le creux le plus marqué : au-delà d'un
  // demi-mètre on quitte le sentier pour la ravine, et c'est un signe négatif.
  const creux = 1 - entre(s.profondeurMed, 0.45, p.profondeurMaxM);

  return 0.30 * longueur + 0.24 * forme + 0.20 * traverse
       + 0.12 * regularite + 0.08 * creux + 0.06 * nettete;
}

// ── Grille de travail ───────────────────────────────────────────────────────

/** Réduit le MNT à un pas plus grossier, par moyenne de blocs. */
function sousEchantillonner(g, pasCible) {
  const f = Math.max(1, Math.round(pasCible / g.pas));
  const W = Math.max(1, Math.floor(g.W / f));
  const H = Math.max(1, Math.floor(g.H / f));
  const N = W * H;

  const mnt = new Float32Array(N);
  const sol = new Float32Array(N);   // part de cellules fines dont le sol est connu

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let somme = 0, nb = 0, connues = 0;
      for (let dy = 0; dy < f; dy++) {
        const yy = y * f + dy;
        if (yy >= g.H) break;
        for (let dx = 0; dx < f; dx++) {
          const xx = x * f + dx;
          if (xx >= g.W) break;
          const c = yy * g.W + xx;
          // Seules les cellules que le comblement a atteintes comptent.
          //
          // Ailleurs, le MNT porte une altitude de repli — la médiane de la
          // dalle — sans aucun rapport avec le terrain. Sur un relief de 150 m
          // d'amplitude, ces plateaux artificiels forment des falaises que le
          // détecteur lit comme des structures : mesuré, le relief local
          // atteignait 92 m au 99ᵉ centile, contre les quelques centimètres
          // attendus.
          if (!g.solConnu || g.solConnu[c]) { somme += g.mnt[c]; connues++; }
          nb++;
        }
      }
      sol[y * W + x] = nb ? connues / nb : 0;
      mnt[y * W + x] = connues ? somme / connues : NaN;
    }
  }

  return { W, H, N, pas: g.pas * f, mnt, sol, emprise: g.emprise, origine: g.origine };
}

// ── Filtrage linéaire multi-échelle ─────────────────────────────────────────

/**
 * Réponse de « vesselness » de Frangi, adaptée aux creux.
 *
 * Principe : en chaque cellule on prend les deux valeurs propres de la matrice
 * hessienne, c'est-à-dire les courbures dans les deux directions principales.
 * Une structure allongée les distingue nettement — forte courbure en travers,
 * quasi nulle le long. Une bosse ou un creux ponctuel les a toutes deux fortes ;
 * une pente uniforme, toutes deux nulles. Le rapport des deux sépare donc le
 * linéaire du reste sans dépendre d'aucune direction privilégiée.
 *
 * On ne retient que les **creux** : la courbure transversale doit être positive
 * (le terrain remonte de part et d'autre). Un talus ou une levée, qui donnerait
 * une réponse symétrique en négatif, est écarté d'emblée.
 *
 * Le balayage en échelles permet d'attraper aussi bien une sente de 60 cm qu'un
 * chemin creux de 4 m. La normalisation par σ² rend les échelles comparables,
 * sans quoi les grandes l'emporteraient systématiquement.
 */
/**
 * Écart absolu moyen du relief local, lissé — une mesure robuste de la
 * « rugosité » du terrain autour de chaque cellule.
 *
 * Un plancher est imposé : sur une surface parfaitement lisse, diviser par une
 * rugosité nulle ferait exploser la réponse du moindre pli. Ce plancher
 * représente le bruit propre du MNT.
 */
function rugositeLocale(relief, t, p) {
  const abs = new Float32Array(t.N);
  for (let i = 0; i < t.N; i++) abs[i] = Math.abs(relief[i]);
  const lisse = flouGaussien(abs, t.W, t.H, Math.max(1, Math.round(p.rayonRugositeM / t.pas)));
  for (let i = 0; i < t.N; i++) lisse[i] = Math.max(lisse[i], p.rugositePlancherM);
  return lisse;
}

function vesselness(relief, rugosite, t, p) {
  const { W, H, N } = t;
  const reponse = new Float32Array(N);
  const echelle = new Float32Array(N);
  const orientation = new Float32Array(N);

  for (const sigmaM of p.echellesM) {
    const sigma = sigmaM / t.pas;
    if (sigma < 0.5) continue;

    const lisse = flouGaussien(relief, W, H, Math.max(1, Math.round(sigma)));
    const s2 = sigma * sigma;

    const H11 = new Float32Array(N), H22 = new Float32Array(N), H12 = new Float32Array(N);

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const c = y * W + x;
        const lxx = (lisse[c - 1] - 2 * lisse[c] + lisse[c + 1]) * s2;
        const lyy = (lisse[c - W] - 2 * lisse[c] + lisse[c + W]) * s2;
        const lxy = (lisse[c - W - 1] + lisse[c + W + 1]
                   - lisse[c - W + 1] - lisse[c + W - 1]) * 0.25 * s2;
        H11[c] = lxx; H22[c] = lyy; H12[c] = lxy;
      }
    }

    // Le facteur `c` de Frangi est **local**, proportionnel à la rugosité du
    // voisinage — ni le maximum de l'image comme dans l'article d'origine, ni
    // une constante.
    //
    // Le maximum global est un piège : sur un versant sans le moindre creux, il
    // n'est que du bruit, et s'y référer le promeut au rang de signal — mesuré,
    // un plan nu répondait 0,63 pour un seuil à 0,30. Une constante ne vaut pas
    // mieux : celle qui convient à une prairie noie un plateau rocheux.
    const deuxBeta2 = 2 * p.beta * p.beta;

    for (let i = 0; i < N; i++) {
      const lxx = H11[i], lyy = H22[i], lxy = H12[i];
      const demiSomme = (lxx + lyy) / 2;
      const ecart = Math.sqrt(((lxx - lyy) / 2) ** 2 + lxy * lxy);
      const la = demiSomme + ecart;
      const lb = demiSomme - ecart;

      // λ2 = plus grande en valeur absolue, λ1 = la plus petite.
      const grand = Math.abs(la) >= Math.abs(lb) ? la : lb;
      const petit = Math.abs(la) >= Math.abs(lb) ? lb : la;

      // Creux uniquement : courbure transversale positive.
      if (grand <= 0) continue;

      const rb = petit / grand;                    // ≈ 0 pour une ligne, ≈ 1 pour une tache
      const s = Math.hypot(petit, grand);          // amplitude — élimine le bruit plat
      const c = p.sensibilite * rugosite[i];
      const v = Math.exp(-(rb * rb) / deuxBeta2)
              * (1 - Math.exp(-(s * s) / (2 * c * c)));

      if (v > reponse[i]) {
        reponse[i] = v;
        echelle[i] = sigmaM;
        // Direction de la structure : perpendiculaire à la courbure maximale,
        // donc portée par le vecteur propre de la petite valeur propre.
        orientation[i] = 0.5 * Math.atan2(2 * lxy, lxx - lyy) + Math.PI / 2;
      }
    }
  }

  return { reponse, echelle, orientation };
}

/**
 * Approximation gaussienne par trois flous de boîte successifs.
 *
 * Deux tampons sont alloués une fois et permutés, au lieu de deux par flou.
 * Sur une grille de 4 M de cellules, la version naïve produisait 96 Mo de
 * déchets par appel et cette fonction est appelée six fois par détection : la
 * pression sur le ramasse-miettes devenait le premier poste de mémoire.
 */
function flouGaussien(src, W, H, rayon) {
  if (rayon <= 0) return Float32Array.from(src);
  const N = W * H;
  let a = Float32Array.from(src);
  let b = new Float32Array(N);
  const tmp = new Float32Array(N);

  for (let i = 0; i < 3; i++) {
    flouBoiteLocal(a, b, tmp, W, H, rayon);
    [a, b] = [b, a];
  }
  return a;
}

function flouBoiteLocal(src, out, tmp, W, H, rayon) {
  const n = 2 * rayon + 1;
  const bx = (v, m) => Math.min(m - 1, Math.max(0, v));

  for (let y = 0; y < H; y++) {
    const l = y * W;
    let somme = 0;
    for (let x = -rayon; x <= rayon; x++) somme += src[l + bx(x, W)];
    for (let x = 0; x < W; x++) {
      tmp[l + x] = somme / n;
      somme -= src[l + bx(x - rayon, W)];
      somme += src[l + bx(x + rayon + 1, W)];
    }
  }
  for (let x = 0; x < W; x++) {
    let somme = 0;
    for (let y = -rayon; y <= rayon; y++) somme += tmp[bx(y, H) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = somme / n;
      somme -= tmp[bx(y - rayon, H) * W + x];
      somme += tmp[bx(y + rayon + 1, H) * W + x];
    }
  }
}

// ── Seuillage et squelette ──────────────────────────────────────────────────

/** Hystérésis : germer sur le seuil haut, propager jusqu'au seuil bas. */
function hysteresis(reponse, W, H, haut, bas) {
  const N = W * H;
  const out = new Uint8Array(N);
  const pile = new Int32Array(N);
  let sommet = 0;

  for (let i = 0; i < N; i++) if (reponse[i] >= haut) { out[i] = 1; pile[sommet++] = i; }

  while (sommet > 0) {
    const c = pile[--sommet];
    const x = c % W, y = (c / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= W) continue;
        const v = yy * W + xx;
        if (!out[v] && reponse[v] >= bas) { out[v] = 1; pile[sommet++] = v; }
      }
    }
  }
  return out;
}

/**
 * Amincissement de Zhang-Suen : réduit le masque à un squelette d'un pixel.
 *
 * Un sentier détecté fait plusieurs cellules de large ; pour le vectoriser il
 * faut d'abord son axe. L'algorithme retire itérativement les pixels de bord
 * dont le retrait ne casse pas la connexité, en deux sous-passes de directions
 * opposées — sans quoi la ligne se déporterait d'un côté.
 */
function amincir(masque, W, H) {
  let img = Uint8Array.from(masque);
  const aSupprimer = [];

  for (let tour = 0; tour < 100; tour++) {
    let change = false;

    for (const passe of [0, 1]) {
      aSupprimer.length = 0;

      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const c = y * W + x;
          if (!img[c]) continue;

          // Voisinage dans le sens horaire à partir du nord.
          const v = [
            img[c - W], img[c - W + 1], img[c + 1], img[c + W + 1],
            img[c + W], img[c + W - 1], img[c - 1], img[c - W - 1],
          ];
          let voisins = 0, transitions = 0;
          for (let i = 0; i < 8; i++) {
            voisins += v[i];
            if (!v[i] && v[(i + 1) % 8]) transitions++;
          }
          if (voisins < 2 || voisins > 6) continue;
          if (transitions !== 1) continue;   // sinon le retrait couperait la ligne

          if (passe === 0) {
            if (v[0] && v[2] && v[4]) continue;
            if (v[2] && v[4] && v[6]) continue;
          } else {
            if (v[0] && v[2] && v[6]) continue;
            if (v[0] && v[4] && v[6]) continue;
          }
          aSupprimer.push(c);
        }
      }

      for (const c of aSupprimer) img[c] = 0;
      if (aSupprimer.length) change = true;
    }
    if (!change) break;
  }
  return img;
}

// ── Vectorisation ───────────────────────────────────────────────────────────

/**
 * Suit le squelette et en tire des polylignes.
 *
 * Départ aux extrémités (un seul voisin), puis on avance de proche en proche.
 * Les embranchements coupent la chaîne : mieux vaut deux tronçons francs qu'un
 * tracé arbitraire à travers un croisement. Les boucles restantes, sans aucune
 * extrémité, sont reprises ensuite depuis n'importe quel point.
 */
function vectoriser(squelette, W, H) {
  const vus = new Uint8Array(W * H);
  const chaines = [];

  const voisinsDe = (c) => {
    const x = c % W, y = (c / W) | 0;
    const out = [];
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx;
        if (xx < 0 || xx >= W) continue;
        const v = yy * W + xx;
        if (squelette[v]) out.push(v);
      }
    }
    return out;
  };

  const suivre = (depart) => {
    const chaine = [depart];
    vus[depart] = 1;
    let cour = depart;
    for (;;) {
      const suite = voisinsDe(cour).filter((v) => !vus[v]);
      if (suite.length !== 1) break;   // fin de ligne, ou embranchement
      cour = suite[0];
      vus[cour] = 1;
      chaine.push(cour);
    }
    return chaine;
  };

  for (let c = 0; c < W * H; c++) {
    if (squelette[c] && !vus[c] && voisinsDe(c).length === 1) {
      const ch = suivre(c);
      if (ch.length > 1) chaines.push(ch);
    }
  }
  for (let c = 0; c < W * H; c++) {
    if (squelette[c] && !vus[c]) {
      const ch = suivre(c);
      if (ch.length > 1) chaines.push(ch);
    }
  }
  return chaines;
}

/**
 * Raboute les tronçons qui se prolongent l'un l'autre.
 *
 * Deux extrémités sont réunies si elles sont proches **et** si la direction de
 * chacune s'accorde avec celle du raccord. La tolérance angulaire est large :
 * un sentier de montagne serpente, et un critère serré ne recollerait que les
 * lignes droites — c'est-à-dire tout sauf des sentiers.
 *
 * Les extrémités sont indexées dans une grille de hachage au pas de l'écart
 * maximal, et le recollement se fait en quelques passes gloutonnes.
 *
 * Ce détail d'implémentation n'en est pas un : une dalle réelle produit des
 * dizaines de milliers de fragments. La version naïve — rebalayer toutes les
 * paires d'extrémités après chaque fusion — y demandait de l'ordre de 10¹⁰
 * comparaisons et figeait l'onglet sans jamais rendre la main.
 */
function relier(chaines, t, p) {
  const { W, pas } = t;
  const ecartMax = p.recollementM / pas;
  const cosMin = Math.cos(p.angleRecollementDeg * Math.PI / 180);

  // Les fragments d'une ou deux cellules n'ont pas de direction exploitable et
  // ne sont que du grain : les recoller reviendrait à relier du bruit au hasard.
  let liste = chaines.filter((ch) => ch.length >= 3).map((ch) => ch.slice());

  const bout = (ch, debut) => {
    const n = Math.min(ch.length - 1, 6);
    const a = debut ? ch[n] : ch[ch.length - 1 - n];
    const b = debut ? ch[0] : ch[ch.length - 1];
    const dx = (b % W) - (a % W), dy = ((b / W) | 0) - ((a / W) | 0);
    const d = Math.hypot(dx, dy) || 1;
    return { x: b % W, y: (b / W) | 0, ux: dx / d, uy: dy / d };
  };

  for (let passe = 0; passe < p.passesRecollement; passe++) {
    const bouts = [];
    liste.forEach((ch, i) => {
      bouts.push({ i, debut: true, ...bout(ch, true) });
      bouts.push({ i, debut: false, ...bout(ch, false) });
    });

    // Grille de hachage : une case par écart maximal, si bien qu'un partenaire
    // possible se trouve forcément dans les neuf cases voisines.
    const casier = new Map();
    const cle = (cx, cy) => `${cx},${cy}`;
    bouts.forEach((b, k) => {
      const c = cle(Math.floor(b.x / ecartMax), Math.floor(b.y / ecartMax));
      if (!casier.has(c)) casier.set(c, []);
      casier.get(c).push(k);
    });

    const pris = new Uint8Array(bouts.length);
    const fusions = [];

    for (let k = 0; k < bouts.length; k++) {
      if (pris[k]) continue;
      const A = bouts[k];
      let meilleur = -1, meilleureD = Infinity;

      const cx = Math.floor(A.x / ecartMax), cy = Math.floor(A.y / ecartMax);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const j of casier.get(cle(cx + dx, cy + dy)) || []) {
            if (j === k || pris[j]) continue;
            const B = bouts[j];
            if (B.i === A.i) continue;
            const vx = B.x - A.x, vy = B.y - A.y;
            const d = Math.hypot(vx, vy);
            if (d > ecartMax || d < 1e-6 || d >= meilleureD) continue;
            if ((A.ux * vx + A.uy * vy) / d < cosMin) continue;
            if ((B.ux * -vx + B.uy * -vy) / d < cosMin) continue;
            meilleur = j; meilleureD = d;
          }
        }
      }
      if (meilleur >= 0) {
        pris[k] = pris[meilleur] = 1;
        fusions.push([A, bouts[meilleur]]);
      }
    }
    if (!fusions.length) break;

    // Application des fusions : une chaîne ne peut être consommée qu'une fois
    // par passe, ce qui garantit la cohérence sans reconstruire l'index.
    const consomme = new Uint8Array(liste.length);
    const suivante = [];
    for (const [A, B] of fusions) {
      if (consomme[A.i] || consomme[B.i]) continue;
      consomme[A.i] = consomme[B.i] = 1;
      const ca = A.debut ? liste[A.i].slice().reverse() : liste[A.i].slice();
      const cb = B.debut ? liste[B.i].slice() : liste[B.i].slice().reverse();
      suivante.push(ca.concat(cb));
    }
    liste.forEach((ch, i) => { if (!consomme[i]) suivante.push(ch); });
    liste = suivante;
  }
  return liste;
}

// ── Mesures ─────────────────────────────────────────────────────────────────

/**
 * Caractérise une chaîne : longueur, profondeur, et surtout son comportement
 * vis-à-vis de la pente.
 *
 * `alignementPente` est la mesure décisive. Une ravine suit la ligne de plus
 * grande pente ; un sentier la traverse en biais pour rester praticable. On
 * compare donc, en chaque point, la direction du tracé à celle du gradient du
 * terrain : proche de 1, c'est un écoulement ; proche de 0, un cheminement.
 *
 * Sans ce critère, tout ravin, toute rigole et tout fossé de drainage
 * ressortiraient — ils ont exactement la même signature creuse et linéaire.
 */
function mesurerTrace(chaine, t, relief, reponse, echelle, p) {
  const { W, pas } = t;
  const pts = chaine.map((c) => ({ x: c % W, y: (c / W) | 0, c }));

  let longueur = 0;
  const pentes = [], alignements = [], profondeurs = [], largeurs = [], reponses = [];

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    profondeurs.push(-relief[a.c]);          // relief négatif = creux
    largeurs.push(echelle[a.c] * 2);
    reponses.push(reponse[a.c]);

    if (i === 0) continue;
    const b = pts[i - 1];
    const dx = (a.x - b.x) * pas, dy = (a.y - b.y) * pas;
    const d = Math.hypot(dx, dy);
    longueur += d;
    if (d < 1e-6) continue;

    // Pente le long du tracé, sur le terrain lissé.
    const dz = t.mnt[a.c] - t.mnt[b.c];
    pentes.push(Math.atan2(Math.abs(dz), d) * 180 / Math.PI);

    // Gradient local du terrain, et angle avec la direction du tracé.
    const gx = (t.mnt[a.c + 1] - t.mnt[a.c - 1]) / (2 * pas);
    const gy = (t.mnt[a.c + W] - t.mnt[a.c - W]) / (2 * pas);
    const ng = Math.hypot(gx, gy);
    if (ng > 1e-4) {
      alignements.push(Math.abs((dx * gx + dy * gy) / (d * ng)));
    }
  }

  const med = (a) => {
    if (!a.length) return 0;
    const t2 = a.slice().sort((x, y) => x - y);
    return t2[t2.length >> 1];
  };
  const moy = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const ecartType = (a) => {
    if (a.length < 2) return 0;
    const m = moy(a);
    return Math.sqrt(moy(a.map((v) => (v - m) ** 2)));
  };

  // Simplification de Douglas-Peucker : une polyligne au pas de la grille
  // compte un point par cellule, illisible et lourde à exporter.
  const brut = pts.map((q) => [
    t.emprise.xmin + (q.x + 0.5) * pas,
    t.emprise.ymin + (q.y + 0.5) * pas,
  ]);
  const simple = simplifier(brut, p.toleranceM);
  const gps = simple.map(([x, y]) => {
    const g = PROJ.versWGS84(x, y);
    return [g.lat, g.lon];
  });

  // Tortuosité : sommets retenus par la simplification, ramenés à 100 m.
  //
  // C'est le critère qui remplace l'amplitude, devenue inutilisable — un
  // sentier de 20 cm de creux est sous la rugosité naturelle d'un versant
  // rocheux. Un sentier est faible mais **organisé** : il serpente en courbes
  // amples, donc peu de sommets survivent à la simplification. Le bruit est
  // fort mais **désordonné** : il zigzague à chaque pas et en garde beaucoup.
  //
  // On ne pénalise donc pas la courbure — un sentier de montagne n'est jamais
  // droit — mais l'irrégularité.
  const tortuosite = longueur > 0 ? (simple.length - 1) / (longueur / 100) : Infinity;

  // Écart angulaire médian entre segments consécutifs : un virage de sentier
  // est franc mais isolé, un tracé de bruit change de cap sans arrêt.
  const virages = [];
  for (let i = 2; i < simple.length; i++) {
    const [ax, ay] = simple[i - 2], [bx, by] = simple[i - 1], [cx2, cy2] = simple[i];
    const a1 = Math.atan2(by - ay, bx - ax), a2 = Math.atan2(cy2 - by, cx2 - bx);
    let da = Math.abs(a2 - a1);
    if (da > Math.PI) da = 2 * Math.PI - da;
    virages.push(da * 180 / Math.PI);
  }

  const milieu = simple[simple.length >> 1];
  const gpsMilieu = PROJ.versWGS84(milieu[0], milieu[1]);

  return {
    longueur,
    nbPoints: simple.length,
    points: simple,
    gps,
    x: milieu[0], y: milieu[1],
    lon: gpsMilieu.lon, lat: gpsMilieu.lat,
    altitude: t.origine[2] + t.mnt[pts[pts.length >> 1].c],
    profondeurMed: med(profondeurs),
    largeurMed: med(largeurs),
    tortuosite,
    virageMed: med(virages),
    penteLongueMed: med(pentes),
    penteLongueEcartType: ecartType(pentes),
    alignementPente: med(alignements),
    reponseMed: med(reponses),
    score: 0,
  };
}

/** Douglas-Peucker, itératif. */
function simplifier(pts, tolerance) {
  if (pts.length < 3) return pts.slice();
  const garder = new Uint8Array(pts.length);
  garder[0] = garder[pts.length - 1] = 1;
  const pile = [[0, pts.length - 1]];

  while (pile.length) {
    const [i, j] = pile.pop();
    if (j <= i + 1) continue;
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    const dx = x2 - x1, dy = y2 - y1;
    const norme = Math.hypot(dx, dy) || 1;

    let pire = -1, iPire = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - x1) * dy - (pts[k][1] - y1) * dx) / norme;
      if (d > pire) { pire = d; iPire = k; }
    }
    if (pire > tolerance) {
      garder[iPire] = 1;
      pile.push([i, iPire], [iPire, j]);
    }
  }
  return pts.filter((_, k) => garder[k]);
}

const SENTIERS = { detecterSentiers };
