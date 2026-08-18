// Extraction de lignes du relief : crêtes de murs, et ce qu'elles enferment.
//
// Pourquoi ce module existe, et pourquoi il ne ressemble pas à `detection.js` :
// la détection actuelle cherche un **signal de classement** — des points non
// classés ou bâtiment posés sur un fond de sol. Un tas de pierres que le
// classificateur IGN a rangé en « sol » ne produit alors aucun signal, puisqu'il
// *est* le terrain. C'est probablement là que sont les ruines manquées.
//
// Ici on ne lit que la **forme** du terrain. Un mur ruiné, c'est une crête
// basse ; un chemin creux, c'est la même figure de signe opposé. Les deux se
// lisent dans la même hessienne, aux signes des valeurs propres près — d'où un
// module commun, et non deux chaînes parallèles.
//
// Ce qui sépare ensuite une cabane d'un sentier n'est pas le filtre mais la
// **topologie** : une structure est une ligne qui se referme, un sentier une
// ligne ouverte. C'est le critère le plus robuste dont on dispose, parce qu'il
// ne dépend d'aucun seuil métrique.
//
// Les choix d'entrée ne sont pas des préférences, ils sortent de `npm run banc` :
//
//  - **ouverture négative**, pas le micro-relief. Sur un plan les deux séparent
//    aussi bien, mais sur une croupe convexe le micro-relief allume 96 à 99,5 %
//    du versant avec le seuil réglé sur du plat, contre 0,1 % pour l'ouverture.
//  - **surface enveloppe** — MNT relevé de la hauteur des structures — et jamais
//    le MNT seul, qui est aveugle à tout ce que le classificateur a retiré (d′
//    de 0,4, c'est-à-dire rien).
//  - **pas de 50 cm**, où la séparation vaut 11,4 contre 7,3 à 25 cm : plus de
//    la moitié des cellules fines ne reçoivent aucun point.
//
// Enveloppé dans une IIFE, comme les autres : seul `LIGNES` en sort.

const LIGNES = (() => {
'use strict';

// ── Réponse de crête ────────────────────────────────────────────────────────

/**
 * Réponse de Frangi (1998) multi-échelle sur un champ scalaire quelconque.
 *
 * Le principe : au voisinage d'une ligne, la courbure est forte en travers et
 * quasi nulle le long. Les deux valeurs propres de la hessienne le disent —
 * `|λ1| ≪ |λ2|` sur une ligne, `|λ1| ≈ |λ2|` sur une tache ou un cône. On garde
 * donc les cellules où le rapport `Rb = λ1/λ2` est petit **et** où la courbure
 * totale `S` sort du bruit.
 *
 * `signe` dit ce qu'on cherche dans le champ fourni : `+1` pour un **creux** de
 * valeurs (le cas de l'ouverture négative, où un mur plonge à 60° dans un fond à
 * 90°), `−1` pour une bosse. Se tromper de signe ne rend pas une réponse
 * médiocre : ça rend zéro, et c'est le premier point à vérifier quand une chaîne
 * ne remonte rien.
 *
 * La hessienne est prise **après lissage à l'échelle σ** et remise à l'échelle
 * par σ² : sans cette normalisation, les petites échelles écrasent toujours les
 * grandes et le multi-échelle ne sert à rien.
 *
 * Le lissage est celui de `relief.js` — trois boîtes enchaînées — parce qu'il est
 * vérifié contre des surfaces à réponse connue. Rien n'est repris de
 * `sentiers.js`, dont les primitives n'ont jamais été mesurées séparément.
 */
function reponseCrete(v, W, H, options = {}) {
  const p = { ...CONFIG.lignes, ...options };
  const N = W * H;
  const signe = p.signe || 1;
  const sortie = new Float32Array(N);
  const echelle = new Float32Array(N);

  for (const sigmaM of p.echellesM) {
    const r = Math.max(1, Math.round(sigmaM / p.pas));
    const lisse = RELIEF.flouBoite(v, W, H, r);
    const s2 = r * r;

    // Hessienne par différences finies centrées, sur la grille lissée.
    const xx = new Float32Array(N), yy = new Float32Array(N), xy = new Float32Array(N);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        xx[i] = s2 * (lisse[i - 1] - 2 * lisse[i] + lisse[i + 1]);
        yy[i] = s2 * (lisse[i - W] - 2 * lisse[i] + lisse[i + W]);
        xy[i] = s2 * (lisse[i - W - 1] + lisse[i + W + 1]
                    - lisse[i - W + 1] - lisse[i + W - 1]) / 4;
      }
    }

    // `c` cale la sensibilité sur la courbure réellement présente : une
    // constante en dur ne transférerait pas d'une dalle lisse à un plateau
    // rocheux — la même leçon que les seuils en multiples de la rugosité locale.
    let maxS = 0;
    for (let i = 0; i < N; i++) {
      const s = Math.hypot(xx[i] + yy[i], xx[i] - yy[i]);
      if (s > maxS) maxS = s;
    }
    const c2 = 2 * (p.sensibilite * maxS) ** 2 || 1e-9;
    const b2 = 2 * p.beta * p.beta;

    for (let i = 0; i < N; i++) {
      // Valeurs propres d'une matrice 2×2 symétrique, forme fermée.
      const t = (xx[i] + yy[i]) / 2;
      const d = Math.hypot((xx[i] - yy[i]) / 2, xy[i]);
      let l1 = t - d, l2 = t + d;
      // λ2 est la plus grande en module : c'est elle qui porte la courbure en
      // travers de la ligne.
      if (Math.abs(l1) > Math.abs(l2)) { const tmp = l1; l1 = l2; l2 = tmp; }

      // Mauvais signe : ce n'est pas la figure cherchée.
      if (signe * l2 <= 0) continue;

      const rb = l1 / l2;
      const s = Math.hypot(l1, l2);
      const rep = Math.exp(-(rb * rb) / b2) * (1 - Math.exp(-(s * s) / c2));
      if (rep > sortie[i]) { sortie[i] = rep; echelle[i] = sigmaM; }
    }
  }

  return { reponse: sortie, echelle };
}

// ── Seuillage par hystérésis ────────────────────────────────────────────────

/**
 * Deux seuils plutôt qu'un : on démarre sur les cellules sûres, on propage sur
 * les cellules plausibles.
 *
 * Un seuil unique coupe une crête en tronçons dès qu'elle faiblit — au passage
 * d'une brèche, d'un arbre tombé, d'un trou d'échantillonnage — et c'est
 * exactement ce qui détruit l'information de fermeture, la seule qui nous
 * intéresse. L'hystérésis rattache ces cellules faibles à leur ligne.
 *
 * Les seuils sont exprimés en **quantiles de la réponse**, jamais en valeur
 * absolue : la réponse de Frangi n'a pas d'unité physique et son échelle change
 * avec le terrain.
 */
function hysteresis(reponse, W, H, options = {}) {
  const p = { ...CONFIG.lignes, ...options };
  const N = W * H;
  // Le seuil haut est un quantile des cellules **qui répondent**, et non de
  // toutes. Prendre le quantile sur la grille entière a un cas limite qui casse
  // tout : quand la réponse est creuse — un terrain propre où seul un mur
  // répond — moins de cellules sont non nulles que le quantile n'en demande, et
  // le seuil tombe à **zéro**. L'hystérésis inonde alors la grille entière, ce
  // qui s'est produit exactement ainsi : 100 % du masque, une composante, un
  // point après amincissement.
  const haut = quantile(reponse, p.partHaute);
  // Et le seuil bas se déduit du haut, comme chez Canny, plutôt que d'être un
  // second quantile : deux quantiles indépendants peuvent se croiser ou
  // dégénérer séparément, un rapport ne le peut pas.
  const bas = haut * p.ratioBas;

  const masque = new Uint8Array(N);
  const pile = [];
  for (let i = 0; i < N; i++) if (reponse[i] >= haut) { masque[i] = 1; pile.push(i); }

  while (pile.length) {
    const i = pile.pop();
    const x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (masque[j] || reponse[j] < bas) continue;
        masque[j] = 1;
        pile.push(j);
      }
    }
  }
  return { masque, haut, bas };
}

/**
 * Quantile des valeurs **strictement positives**, par histogramme.
 *
 * `part` se lit donc « la part des cellules qui répondent », pas la part de la
 * grille. C'est la seule lecture qui ait un sens ici : une cellule de réponse
 * nulle n'est pas une cellule faible, c'est une cellule où la figure cherchée
 * n'existe pas — la compter dans la population ferait varier le seuil avec la
 * taille de la dalle plutôt qu'avec son contenu.
 *
 * Le tri exact de 4 M de valeurs coûterait plus cher que tout le reste de la
 * chaîne, d'où l'histogramme.
 */
function quantile(v, part) {
  let max = 0;
  for (let i = 0; i < v.length; i++) if (v[i] > max) max = v[i];
  if (!(max > 0)) return Infinity;

  const seaux = new Uint32Array(512);
  let repondent = 0;
  for (let i = 0; i < v.length; i++) {
    if (v[i] <= 0) continue;
    seaux[Math.min(511, (v[i] / max * 511) | 0)]++;
    repondent++;
  }

  const vise = Math.max(1, repondent * part);
  let cumul = 0;
  for (let k = 511; k >= 0; k--) {
    cumul += seaux[k];
    if (cumul >= vise) return Math.max((k / 511) * max, 1e-6);
  }
  return 1e-6;
}

// ── Amincissement ───────────────────────────────────────────────────────────

/**
 * Zhang-Suen : ronge le masque couronne par couronne jusqu'au squelette d'un
 * pixel d'épaisseur, sans jamais couper une ligne ni fermer un trou.
 *
 * Sans lui, rien ne marche, et la raison n'est pas évidente. La réponse de
 * crête est lissée à l'échelle du mur, l'hystérésis l'élargit encore : sur un
 * anneau de 4 m de diamètre, le masque ressort épais de 2,4 m pour un mur d'un
 * mètre. Mesuré : la couronne occupe alors **75 %** de son rectangle englobant,
 * et devient indiscernable d'une tache pleine — le candidat parfait était rejeté
 * comme un bloc. Après amincissement, la même couronne tombe à 31 %.
 *
 * C'est donc l'amincissement qui rend le critère de creux *signifiant*, et lui
 * seul. Son coût croît avec la surface **et** l'épaisseur du masque ; ici le
 * masque pèse moins de 1 % de la dalle, mais le garde-fou de densité reste
 * nécessaire dès qu'on desserre les seuils.
 */
function amincir(masque, W, H) {
  const m = Uint8Array.from(masque);
  const aRetirer = [];
  let change = true;

  const voisins = (i) => {
    const x = i % W, y = (i / W) | 0;
    // P2..P9 dans le sens horaire à partir du nord, convention de l'article.
    const b = (dx, dy) => {
      const xx = x + dx, yy = y + dy;
      return (xx < 0 || yy < 0 || xx >= W || yy >= H) ? 0 : m[yy * W + xx];
    };
    return [b(0, -1), b(1, -1), b(1, 0), b(1, 1), b(0, 1), b(-1, 1), b(-1, 0), b(-1, -1)];
  };

  while (change) {
    change = false;
    for (let passe = 0; passe < 2; passe++) {
      aRetirer.length = 0;
      for (let i = 0; i < m.length; i++) {
        if (!m[i]) continue;
        const p = voisins(i);
        let b = 0, a = 0;
        for (let k = 0; k < 8; k++) {
          b += p[k];
          if (!p[k] && p[(k + 1) % 8]) a++;   // transitions 0→1 sur le tour
        }
        if (b < 2 || b > 6 || a !== 1) continue;
        // Les deux conditions qui changent d'une sous-passe à l'autre : c'est
        // leur alternance qui garantit qu'on ronge symétriquement, sans faire
        // dériver la ligne d'un côté.
        const [p2, p4, p6, p8] = [p[0], p[2], p[4], p[6]];
        if (passe === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        aRetirer.push(i);
      }
      for (const i of aRetirer) m[i] = 0;
      if (aRetirer.length) change = true;
    }
  }
  return m;
}

// ── Composantes et mesures ──────────────────────────────────────────────────

/** Étiquetage en 8-connexité, par parcours en largeur sur une file plate. */
function composantes(masque, W, H) {
  const etiq = new Int32Array(W * H).fill(-1);
  const taches = [];
  const file = new Int32Array(W * H);

  for (let depart = 0; depart < W * H; depart++) {
    if (!masque[depart] || etiq[depart] >= 0) continue;
    const n = taches.length;
    let tete = 0, queue = 0;
    file[queue++] = depart;
    etiq[depart] = n;
    const cellules = [];

    while (tete < queue) {
      const i = file[tete++];
      cellules.push(i);
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (!masque[j] || etiq[j] >= 0) continue;
          etiq[j] = n;
          file[queue++] = j;
        }
      }
    }
    taches.push(cellules);
  }
  return { etiq, taches };
}

/**
 * Mesure de fermeture : **couverture angulaire**, et non « boucle ou pas ».
 *
 * Le test topologique strict — la composante enferme-t-elle un trou — casse dès
 * la première brèche. Or un mur ruiné a une entrée, et l'effondrement en ouvre
 * d'autres : le cas normal est l'anneau troué, pas l'anneau parfait. On mesure
 * donc la part du tour qui est occupée, ce qui rend 1,0 sur un anneau complet et
 * 0,7 sur le même anneau amputé d'un tiers — un candidat, pas un rejet.
 *
 * Le centre vient d'un **ajustement de cercle** (Kåsa) et non du barycentre :
 * sur un arc, le barycentre se déplace vers la corde et surestime la couverture.
 * L'ajustement est un simple système 3×3, sans itération.
 */
function mesurer(cellules, W, pas) {
  const n = cellules.length;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  let sx = 0, sy = 0, xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let k = 0; k < n; k++) {
    const i = cellules[k];
    const x = (i % W) * pas, y = ((i / W) | 0) * pas;
    xs[k] = x; ys[k] = y; sx += x; sy += y;
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  const gx = sx / n, gy = sy / n;

  // Ajustement de cercle de Kåsa : minimise Σ(x² + y² + Dx + Ey + F)².
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (let k = 0; k < n; k++) {
    const u = xs[k] - gx, v = ys[k] - gy;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v;
    suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  let cx = gx, cy = gy, rayon = 0;
  if (Math.abs(det) > 1e-9) {
    const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2;
    const uc = (b1 * svv - b2 * suv) / det;
    const vc = (b2 * suu - b1 * suv) / det;
    cx = gx + uc; cy = gy + vc;
  }
  let sr = 0;
  for (let k = 0; k < n; k++) sr += Math.hypot(xs[k] - cx, ys[k] - cy);
  rayon = sr / n;

  // Couverture : 36 secteurs de 10° autour du centre ajusté.
  const secteurs = new Uint8Array(36);
  let residu = 0;
  for (let k = 0; k < n; k++) {
    const dx = xs[k] - cx, dy = ys[k] - cy;
    const a = Math.atan2(dy, dx);
    secteurs[Math.min(35, ((a + Math.PI) / (2 * Math.PI) * 36) | 0)] = 1;
    residu += Math.abs(Math.hypot(dx, dy) - rayon);
  }
  let occupes = 0;
  for (let k = 0; k < 36; k++) occupes += secteurs[k];

  const largeur = xmax - xmin + pas, hauteur = ymax - ymin + pas;
  return {
    n,
    surface: n * pas * pas,
    cx, cy, rayon,
    couverture: occupes / 36,
    // Dispersion radiale rapportée au rayon : petite sur un anneau, grande sur
    // une tache pleine ou une ligne droite.
    regularite: rayon > 0 ? 1 - Math.min(1, (residu / n) / rayon) : 0,
    largeur, hauteur,
    elongation: Math.max(largeur, hauteur) / Math.max(pas, Math.min(largeur, hauteur)),
    // Part du rectangle englobant réellement occupée. Une ligne fermée est
    // creuse : elle occupe son pourtour, pas sa surface.
    remplissage: (n * pas * pas) / Math.max(pas * pas, largeur * hauteur),
  };
}

/** Médiane d'un champ sur une liste de cellules. */
function medianeSur(champ, cellules) {
  const v = Array.from(cellules, (i) => champ[i]).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : NaN;
}

/** Médiane d'un champ à l'intérieur d'un candidat, sur un disque
 * des deux tiers du rayon — assez large pour être représentatif, assez étroit
 * pour ne pas mordre sur le mur lui-même. */
function medianeInterieure(champ, t, m) {
  const r = m.rayon * 0.67;
  const valeurs = [];
  const x0 = Math.max(0, Math.floor((m.cx - r) / t.pas));
  const x1 = Math.min(t.W - 1, Math.ceil((m.cx + r) / t.pas));
  const y0 = Math.max(0, Math.floor((m.cy - r) / t.pas));
  const y1 = Math.min(t.H - 1, Math.ceil((m.cy + r) / t.pas));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (Math.hypot(x * t.pas - m.cx, y * t.pas - m.cy) > r) continue;
      valeurs.push(champ[y * t.W + x]);
    }
  }
  if (!valeurs.length) return NaN;
  valeurs.sort((a, b) => a - b);
  return valeurs[valeurs.length >> 1];
}

/**
 * Cellules **enfermées** par une ligne, la ligne comprise.
 *
 * Une couronne de murs n'est pas la structure : la structure est ce qu'elle
 * entoure. Sans ce remplissage, la surface remontée serait celle du mur — une
 * quinzaine de mètres carrés pour une cabane qui en fait trente — et le
 * rapprochement avec la BD TOPO comme les exports porteraient sur un anneau
 * plutôt que sur un bâtiment.
 *
 * Le remplissage se fait par l'extérieur : on inonde le fond depuis le pourtour
 * de la boîte englobante, et ce qui n'a pas été atteint est dedans. Une brèche
 * dans le mur laisse fuir l'inondation — l'intérieur est alors vide, et la
 * surface se réduit à la ligne. C'est le comportement voulu : on ne prétend pas
 * refermer ce qui ne l'est pas.
 */
function remplir(cellules, W, H) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const i of cellules) {
    const x = i % W, y = (i / W) | 0;
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  // Une cellule de marge tout autour, pour que l'inondation ait par où entrer.
  xmin--; ymin--; xmax++; ymax++;
  const w = xmax - xmin + 1, h = ymax - ymin + 1;

  const local = new Uint8Array(w * h);
  for (const i of cellules) local[((i / W | 0) - ymin) * w + (i % W) - xmin] = 1;

  const vu = new Uint8Array(w * h);
  const pile = [];
  for (let x = 0; x < w; x++) { pile.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { pile.push(y * w, y * w + w - 1); }

  while (pile.length) {
    const j = pile.pop();
    if (vu[j] || local[j]) continue;
    vu[j] = 1;
    const x = j % w, y = (j / w) | 0;
    // Quatre-connexité pour le fond : le dual de la huit-connexité du masque.
    // Mélanger les deux ferait fuir l'inondation par les diagonales d'un mur
    // pourtant continu.
    if (x > 0) pile.push(j - 1);
    if (x < w - 1) pile.push(j + 1);
    if (y > 0) pile.push(j - w);
    if (y < h - 1) pile.push(j + w);
  }

  const pleines = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      if (vu[j]) continue;
      pleines.push((y + ymin) * W + (x + xmin));
    }
  }
  return pleines;
}

// ── Chaîne complète ─────────────────────────────────────────────────────────

/**
 * De la grille de relief aux candidats.
 *
 * `t` est une grille d'affichage de `RELIEF.preparer`. La surface analysée est
 * l'**enveloppe** — MNT plus hauteur — pour la raison mesurée au banc : une
 * structure classée bâtiment n'existe plus dans le MNT.
 *
 * Le classement final est volontairement pauvre en seuils : taille, couverture,
 * et c'est tout. Les 4,3 % de cellules qu'un chaos rocheux fait franchir au
 * seuil ne se trient pas par un seuil de plus — ils se trient parce qu'un bloc
 * ne referme pas un tour.
 */
function extraire(t, options = {}) {
  // `CONFIG.relief` **aussi**, et pas seulement `CONFIG.lignes` : la portée du
  // balayage d'horizons vit là-bas, et c'est elle qui fixe la marge de bord.
  // Sans elle, `p.svfRayonM` valait `undefined`, la marge devenait `NaN`, toute
  // comparaison avec `NaN` rendait faux, et le masque sortait **vide sur toute
  // la dalle** — la voie par la forme ne remontait donc jamais rien dans
  // l'application, en silence. Les tests ne l'ont pas vu parce qu'ils passaient
  // tous la portée explicitement : depuis, ils s'en remettent aux réglages de
  // production, précisément pour que ce chemin-là soit celui qui est éprouvé.
  const p = { ...CONFIG.relief, ...CONFIG.lignes, ...options, pas: t.pas };
  const chrono = {};
  let t0 = now();

  // 1. Surface enveloppe, puis ouverture négative — la couche où un mur plonge.
  // Surface d'analyse, et non le MNT d'affichage : la première retient le point
  // sol le plus haut de chaque bloc pour préserver les murs, le second en prend
  // la moyenne pour rester lisible. Voir `RELIEF.preparer`.
  const base = t.analyse || t.mnt;
  const enveloppe = new Float32Array(t.N);
  for (let i = 0; i < t.N; i++) enveloppe[i] = base[i] + t.hauteur[i];
  const grille = { ...t, mnt: enveloppe };
  const ouv = RELIEF.ouverture(grille, p, 'negative');
  // L'ouverture positive sort du **même balayage**, donc du mémo : elle ne coûte
  // rien de plus, et c'est elle qui dira si l'intérieur est fermé.
  const ouvPos = RELIEF.ouverture(grille, p, 'positive');
  chrono.ouverture = now() - t0; t0 = now();

  // 2. Du champ d'ouverture au masque. Deux voies, comparées au banc.
  //
  // La marge de bord est effacée d'abord, et pas après : sur une couronne de la
  // portée du balayage l'horizon est tronqué, donc l'ouverture y est fausse.
  const marge = Math.round(p.svfRayonM / t.pas) + 2;
  // Un réglage manquant ne doit pas se traduire par un résultat vide : c'est le
  // mode de panne le plus coûteux du projet, celui qui ressemble à « il n'y a
  // rien à cet endroit ».
  if (!Number.isFinite(marge)) throw new Error('portée du balayage non définie (svfRayonM)');
  const horsMarge = (i) => {
    const x = i % t.W, y = (i / t.W) | 0;
    return x >= marge && y >= marge && x < t.W - marge && y < t.H - marge;
  };

  let masque, seuils;
  if (p.mode === 'frangi') {
    // Voie « forme d'abord » : réponse de crête multi-échelle, puis hystérésis.
    // Mesurée nettement moins bonne — voir le commentaire de `reponseCrete`.
    const { reponse } = reponseCrete(ouv, t.W, t.H, { ...p, signe: 1 });
    for (let i = 0; i < t.N; i++) if (!horsMarge(i)) reponse[i] = 0;
    const h = hysteresis(reponse, t.W, t.H, p);
    masque = h.masque; seuils = { haut: h.haut, bas: h.bas };
  } else {
    // Voie « seuil d'abord », celle que le banc recommande.
    //
    // L'ouverture vaut **90° sur tout plan, quelle que soit sa pente** : le
    // seuil peut donc s'exprimer en degrés sous 90, une valeur absolue qui
    // transfère d'une dalle à l'autre. C'est ce que ni la réponse de Frangi —
    // sans unité — ni le micro-relief — dont le zéro dérive avec la courbure du
    // terrain — ne permettent. Mesuré au banc : à 16° sous 90, un versant nu,
    // une terrasse et un chemin creux laissent passer 0 structure fermée.
    const seuil = 90 - p.creuxMinDeg;
    masque = new Uint8Array(t.N);
    for (let i = 0; i < t.N; i++) if (horsMarge(i) && ouv[i] <= seuil) masque[i] = 1;
    seuils = { haut: seuil, bas: seuil };
  }
  chrono.seuillage = now() - t0; t0 = now();

  // L'amincissement est **désactivé par défaut**, et c'est contre-intuitif.
  //
  // Il était au plan, et il rend bien le masque plus fin. Mais mesuré, il coûte
  // plus qu'il ne rapporte ici : la couverture d'un orri tombe de 0,94 à 0,72 et
  // la position du centre se dégrade de 0,34 à 0,45 m, parce que Zhang-Suen ronge
  // la couronne de façon dissymétrique là où elle est irrégulière. Il ne servait
  // qu'à rendre le critère de remplissage lisible — critère qui, mesuré, n'attrape
  // rien que les autres n'attrapent déjà. Il reste disponible pour la branche des
  // lignes ouvertes, où la vectorisation exige un squelette.
  const analyse = p.amincir ? amincir(masque, t.W, t.H) : masque;
  chrono.amincissement = now() - t0; t0 = now();

  // 3. Composantes, puis mesure de chacune.
  const { taches } = composantes(analyse, t.W, t.H);
  const rejets = { surface: 0, taille: 0, ouvert: 0, interieurOuvert: 0, tropPlat: 0, retenues: 0 };
  const structures = [];
  const ouvertes = [];

  for (const cellules of taches) {
    const m = mesurer(cellules, t.W, t.pas);
    if (m.surface < p.surfaceMinM2) { rejets.surface++; continue; }

    // Une ligne fermée trop grande n'est plus une cabane : parcelle, enclos de
    // pâture, ou artefact de bord. Trop petite, c'est un bloc.
    if (m.rayon < p.rayonMinM || m.rayon > p.rayonMaxM) { rejets.taille++; continue; }

    if (m.couverture < p.couvertureMin) {
      // Ligne ouverte : ce n'est pas une structure, mais c'est peut-être un
      // sentier ou une terrasse. On la garde de côté plutôt que de la jeter —
      // c'est l'autre moitié de la même chaîne.
      ouvertes.push(m);
      rejets.ouvert++;
      continue;
    }

    // Le critère qui sépare une cabane d'une plateforme.
    //
    // Un rebord de plateforme est un anneau parfait : couverture 0,81, forme
    // régulière, taille plausible — la géométrie seule ne peut pas le distinguer
    // d'un mur. Ce qui les sépare est ce qu'il y a **dedans** : l'intérieur d'une
    // cabane est fermé au ciel, celui d'une plateforme ne l'est pas du tout.
    // Mesuré : 16,0° d'enfermement pour un orri, 15,7° pour une cabane,
    // **0,01°** pour une plateforme. Et comme l'ouverture positive vaut elle
    // aussi 90° sur tout plan, le seuil est absolu.
    m.interieur = medianeInterieure(ouvPos, t, m);
    if (!(m.interieur <= 90 - p.interieurMinDeg)) { rejets.interieurOuvert++; continue; }

    // Et le critère physique qui va avec : **un mur dépasse de son intérieur**.
    //
    // Il attrape ce que l'ouverture laisse passer, et le cas est réel et non
    // théorique : sous une structure classée bâtiment, le comblement du MNT
    // reconstruit une surface lisse par propagation depuis les bords, ce qui sur
    // un versant fabrique un léger **dôme**. Son rebord forme alors un anneau
    // fermé, dont l'intérieur paraît même un peu enfermé — 80° mesurés, pas loin
    // du seuil. La différence d'altitude, elle, ne s'y trompe pas : un mur monte
    // de 60 cm au-dessus de son intérieur, un dôme de comblement descend.
    m.hauteurMur = medianeSur(enveloppe, cellules) - medianeInterieure(enveloppe, t, m);
    if (!(m.hauteurMur >= p.hauteurMurMinM)) { rejets.tropPlat++; continue; }

    m.pleines = remplir(cellules, t.W, t.H);
    m.surfacePleine = m.pleines.length * t.pas * t.pas;
    structures.push({ ...m, cellules });
    rejets.retenues++;
  }

  structures.sort((a, b) => b.couverture - a.couverture || b.surface - a.surface);
  chrono.mesure = now() - t0;

  return {
    structures, ouvertes, rejets, chrono,
    seuils,
    // Part du terrain retenue par le seuillage. Au-delà de quelques pour cent,
    // il ne s'agit plus d'un signal mais d'un fond, et le reste de la chaîne ne
    // fera que du bruit — même leçon que le garde-fou de densité des sentiers.
    partMasque: masque.reduce((a, b) => a + b, 0) / (t.W * t.H),
  };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

return { extraire, reponseCrete, hysteresis, amincir, composantes, mesurer, remplir, quantile };
})();
