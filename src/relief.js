// Visualisations de relief : ombrage, micro-relief, Sky-View Factor, hauteur.
//
// Pourquoi ce module existe : un nuage de points est le mauvais instrument pour
// repérer un objet de six mètres dans un kilomètre carré. On y voit l'ensemble
// et jamais le détail — c'est pour cette raison que la prospection lit des
// rasters ombrés depuis toujours, et pas des points.
//
// Rien n'est repris de `sentiers.js`. Sa chaîne ne remonte aujourd'hui aucun
// tracé, et tant qu'on ignore pourquoi, aucune de ses pièces ne peut servir de
// fondation : un flou faux produirait un micro-relief faux, d'apparence
// parfaitement plausible. Les algorithmes ci-dessous sont ceux de la
// littérature, nommés, et vérifiés contre des surfaces à réponse connue
// (`tools/relief.test.js`).
//
// Ce qui est réutilisé, en revanche, c'est `raster.js` : ses grilles ont fait
// leurs preuves, la détection de structures trouve effectivement ce qu'elle
// cherche.
//
// Enveloppé dans une IIFE : les noms naturels ici — `ombrage`, `flou`, `pente` —
// entreraient en collision dans l'environnement lexical partagé par les scripts
// classiques. Seul `RELIEF` en sort.

const RELIEF = (() => {
'use strict';

// ── Grille de travail ───────────────────────────────────────────────────────

/**
 * Sous-échantillonne les grilles de détection en une grille d'affichage.
 *
 * Pourquoi ne pas travailler à 25 cm : à cette finesse une cellule ne reçoit
 * que 0,6 point en moyenne, si bien que le MNT y est surtout du bruit
 * d'échantillonnage. À 50 cm elle en reçoit deux ou trois, et un mur de 50 cm
 * occupe toujours une cellule pleine. Le calcul est en prime seize fois moins
 * lourd, ce qui décide de la faisabilité du Sky-View Factor.
 *
 * Quatre tableaux en sortent, tous à la même géométrie :
 *  - `mnt`      altitude du sol, relative à `origine[2]`, NaN si inconnue ;
 *  - `valide`   1 si le sol est connu — le comblement l'a atteinte ;
 *  - `hauteur`  hauteur de ce qui se dresse au-dessus du sol, en mètres ;
 *  - `trou`     part des cellules fines sans aucun retour sol, dans [0, 1].
 */
function preparer(g, options = {}) {
  const p = { ...CONFIG.relief, ...options };
  const f = Math.max(1, Math.round(p.pasM / g.pas));
  const W = Math.max(1, Math.floor(g.W / f));
  const H = Math.max(1, Math.floor(g.H / f));
  const N = W * H;

  const mnt = new Float32Array(N).fill(NaN);
  const valide = new Uint8Array(N);
  const hauteur = new Float32Array(N);
  const trou = new Float32Array(N);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let somme = 0, connues = 0, fines = 0, sansSol = 0, hMax = 0;

      for (let dy = 0; dy < f; dy++) {
        const yy = y * f + dy;
        if (yy >= g.H) break;
        for (let dx = 0; dx < f; dx++) {
          const xx = x * f + dx;
          if (xx >= g.W) break;
          const c = yy * g.W + xx;
          fines++;

          // Seules les cellules que le comblement a atteintes portent une
          // altitude qui veut dire quelque chose ; ailleurs le MNT garde une
          // valeur de repli sans aucun rapport avec le terrain.
          if (!g.solConnu || g.solConnu[c]) { somme += g.mnt[c]; connues++; }
          if (!g.solN[c]) sansSol++;

          // Hauteur du signal : moyenne des points non classés — et des points
          // « bâtiment » si l'option le demande — au-dessus du sol. Calculée
          // ici plutôt qu'en passant par `RASTER.signal`, qui allouerait deux
          // tableaux à la grille fine, soit ~96 Mo sur une dalle entière.
          const n = g.ncN[c] + (p.inclureBati ? g.batN[c] : 0);
          if (n && (!g.solConnu || g.solConnu[c])) {
            const s = g.ncSomme[c] + (p.inclureBati ? g.batSomme[c] : 0);
            const h = s / n - g.mnt[c];
            if (h > hMax) hMax = h;
          }
        }
      }

      const i = y * W + x;
      if (connues) { mnt[i] = somme / connues; valide[i] = 1; }
      hauteur[i] = hMax;
      trou[i] = fines ? sansSol / fines : 1;
    }
  }

  // Les cellules sans sol connu reçoivent la médiane approchée du reste : les
  // gradients et les flous ont besoin d'un nombre, la carte de validité dira
  // qu'il ne faut pas y croire.
  let somme = 0, nb = 0;
  for (let i = 0; i < N; i++) if (valide[i]) { somme += mnt[i]; nb++; }
  const repli = nb ? somme / nb : 0;
  for (let i = 0; i < N; i++) if (!valide[i]) mnt[i] = repli;

  return {
    W, H, N, pas: g.pas * f, mnt, valide, hauteur, trou,
    emprise: g.emprise, origine: g.origine,
  };
}

// ── Flou de boîte ───────────────────────────────────────────────────────────

/**
 * Trois passes de boîte séparable — l'approximation classique d'une gaussienne.
 *
 * Chaque passe divise par le **nombre réel d'échantillons**, et non par la
 * largeur nominale de la fenêtre. Aux bords, la fenêtre est tronquée : diviser
 * par la largeur nominale y ferait tendre le résultat vers zéro, ce qui se
 * lirait comme une falaise. Le compte réel donne une moyenne unilatérale, qui
 * reste une moyenne — biaisée sur une pente, d'où la marge écartée plus bas,
 * mais jamais absurde.
 */
function flouBoite(src, W, H, rayon) {
  let a = Float32Array.from(src);
  let b = new Float32Array(src.length);
  for (let passe = 0; passe < 3; passe++) {
    boiteH(a, b, W, H, rayon);
    boiteV(b, a, W, H, rayon);
  }
  return a;
}

/**
 * Somme glissante, et non recalculée.
 *
 * D'un pixel au suivant, la fenêtre gagne un échantillon et en perd un : le
 * coût est celui de la grille, pas celui de la grille multipliée par le rayon.
 * La version naïve — refaire la somme entière à chaque pixel — coûtait 49
 * additions par pixel et par passe à rayon 12 m, six passes, quatre millions de
 * cellules. Le micro-relief mettait plusieurs secondes pendant lesquelles
 * l'onglet ne rendait plus la main.
 */
function boiteH(src, dst, W, H, r) {
  for (let y = 0; y < H; y++) {
    const l = y * W;
    let debut = 0;
    let fin = Math.min(W - 1, r);
    let somme = 0;
    for (let k = debut; k <= fin; k++) somme += src[l + k];

    for (let x = 0; x < W; x++) {
      dst[l + x] = somme / (fin - debut + 1);
      const f = Math.min(W - 1, x + 1 + r);
      if (f > fin) { somme += src[l + f]; fin = f; }
      const d = Math.max(0, x + 1 - r);
      if (d > debut) { somme -= src[l + debut]; debut = d; }
    }
  }
}

function boiteV(src, dst, W, H, r) {
  for (let x = 0; x < W; x++) {
    let debut = 0;
    let fin = Math.min(H - 1, r);
    let somme = 0;
    for (let k = debut; k <= fin; k++) somme += src[k * W + x];

    for (let y = 0; y < H; y++) {
      dst[y * W + x] = somme / (fin - debut + 1);
      const f = Math.min(H - 1, y + 1 + r);
      if (f > fin) { somme += src[f * W + x]; fin = f; }
      const d = Math.max(0, y + 1 - r);
      if (d > debut) { somme -= src[debut * W + x]; debut = d; }
    }
  }
}

// ── Micro-relief (Local Relief Model, Hesse 2010) ───────────────────────────

/**
 * MNT moins MNT lissé : le relief général s'annule, le micro-relief reste.
 *
 * Sans cette soustraction, un versant à 30° écraserait le creux de 40 cm qu'on
 * cherche — la pente du terrain est mille fois plus forte que le signal.
 *
 * Le lissage est une **convolution normalisée** : on lisse séparément
 * l'altitude pondérée et le poids, puis on divise. Les cellules sans sol connu
 * ne contribuent donc pas du tout, au lieu d'y injecter une altitude de repli
 * que le lissage étalerait sur tout le voisinage.
 */
function microRelief(t, rayonM) {
  const r = Math.max(1, Math.round(rayonM / t.pas));
  const pondere = new Float32Array(t.N);
  const poids = new Float32Array(t.N);

  for (let i = 0; i < t.N; i++) {
    if (t.valide[i]) { pondere[i] = t.mnt[i]; poids[i] = 1; }
  }

  const sp = flouBoite(pondere, t.W, t.H, r);
  const sw = flouBoite(poids, t.W, t.H, r);

  const out = new Float32Array(t.N).fill(NaN);
  // Marge de **trois** rayons : trois boîtes enchaînées portent à 3r, et c'est
  // sur cette largeur que la moyenne locale devient unilatérale — donc biaisée
  // sur une pente, d'un ordre de grandeur supérieur au signal cherché.
  const marge = 3 * r;
  for (let y = marge; y < t.H - marge; y++) {
    for (let x = marge; x < t.W - marge; x++) {
      const i = y * t.W + x;
      if (t.valide[i] && sw[i] > 0.05) out[i] = t.mnt[i] - sp[i] / sw[i];
    }
  }
  return out;
}

// ── Ombrage (Horn 1981) ─────────────────────────────────────────────────────

/**
 * Gradient de Horn : la pente estimée sur les huit voisins, pondérés 2 sur les
 * quatre orthogonaux. C'est le noyau qu'emploient GDAL, QGIS et ArcGIS, ce qui
 * rend le résultat comparable à ce qu'on obtiendrait ailleurs.
 *
 * Les lignes de la grille vont du sud au nord — `y` croît avec le Y Lambert —
 * donc `dzdy` est bien la dérivée vers le nord.
 */
function gradients(t) {
  const { W, H, mnt, pas } = t;
  const gx = new Float32Array(t.N);
  const gy = new Float32Array(t.N);
  const lire = (x, y) => mnt[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = lire(x - 1, y + 1), b = lire(x, y + 1), c = lire(x + 1, y + 1);
      const d = lire(x - 1, y), f = lire(x + 1, y);
      const g = lire(x - 1, y - 1), h = lire(x, y - 1), i = lire(x + 1, y - 1);
      gx[y * W + x] = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * pas);
      gy[y * W + x] = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * pas);
    }
  }
  return { gx, gy };
}

/**
 * Éclairement lambertien d'une surface, dans [0, 1].
 *
 * Écrit en produit scalaire plutôt qu'en formule trigonométrique : les deux
 * sont équivalents, mais celui-ci se vérifie à la main sur un plan incliné —
 * la normale et la direction du soleil s'écrivent directement.
 *
 * `azimut` se compte en degrés depuis le nord, dans le sens horaire, comme sur
 * une boussole ; `hauteur` est l'élévation du soleil au-dessus de l'horizon.
 */
function ombrage(t, azimut = 315, hauteur = 45, grads = null) {
  const { gx, gy } = grads || gradients(t);
  const az = azimut * Math.PI / 180;
  const el = hauteur * Math.PI / 180;
  // Direction du soleil : x vers l'est, y vers le nord, z vers le haut.
  const lx = Math.cos(el) * Math.sin(az);
  const ly = Math.cos(el) * Math.cos(az);
  const lz = Math.sin(el);

  const out = new Float32Array(t.N);
  for (let i = 0; i < t.N; i++) {
    // Normale à la surface z = f(x, y) : (−∂z/∂x, −∂z/∂y, 1), normalisée.
    const nx = -gx[i], ny = -gy[i];
    const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
    const v = (nx * lx + ny * ly + lz) * inv;
    out[i] = v > 0 ? v : 0;
  }
  return out;
}

/**
 * Ombrage multidirectionnel : la moyenne de quatre soleils à 90° l'un de
 * l'autre.
 *
 * Un ombrage unique est aveugle aux formes parallèles à ses rayons : un muret
 * orienté dans l'axe du soleil ne projette aucune ombre et disparaît. Combiner
 * quatre directions supprime ce biais d'orientation, au prix d'un rendu plus
 * plat — c'est le compromis retenu partout, de l'USGS au RVT.
 */
function ombrageMulti(t) {
  const grads = gradients(t);
  const out = new Float32Array(t.N);
  const azimuts = [315, 45, 135, 225];
  for (const az of azimuts) {
    const o = ombrage(t, az, 45, grads);
    for (let i = 0; i < t.N; i++) out[i] += o[i];
  }
  for (let i = 0; i < t.N; i++) out[i] /= azimuts.length;
  return out;
}

// ── Sky-View Factor (Zakšek, Oštir & Kokalj 2011) ───────────────────────────

/**
 * Part de la voûte céleste visible depuis chaque cellule, dans [0, 1].
 *
 * Pour `n` directions, on cherche l'angle d'élévation maximal de l'horizon
 * dans un rayon donné, puis `SVF = 1 − (1/n)·Σ sin γᵢ`, les horizons négatifs
 * ramenés à zéro — ce qui est plus bas que soi ne masque pas le ciel.
 *
 * Deux propriétés en font la référence de la prospection archéologique : aucune
 * direction d'éclairage, donc aucun biais d'orientation ; et une faible
 * sensibilité à la pente d'ensemble, si bien qu'une structure sur un versant à
 * 30° se lit comme sur du plat. Les creux — fossés, chemins creux, intérieurs
 * de cabane — sortent sombres, les crêtes et les murs clairs.
 *
 * L'angle est suivi en **tangente** dans la boucle, et converti une seule fois
 * à la fin : `sin(atan(u)) = u / √(1+u²)`. Un `atan` par cellule et par pas
 * dominerait tout le calcul.
 */
function svf(t, options = {}) {
  const p = { ...CONFIG.relief, ...options };
  const n = Math.max(4, p.svfDirections | 0);
  const R = Math.max(1, Math.round(p.svfRayonM / t.pas));
  const { W, H, mnt } = t;

  const out = new Float32Array(t.N);
  const maxTan = new Float32Array(t.N);

  for (let d = 0; d < n; d++) {
    const a = (d / n) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    maxTan.fill(0);

    for (let k = 1; k <= R; k++) {
      const ox = Math.round(dx * k);
      const oy = Math.round(dy * k);
      const dist = Math.hypot(ox, oy) * t.pas;
      if (dist <= 0) continue;

      for (let y = 0; y < H; y++) {
        const yy = y + oy;
        if (yy < 0 || yy >= H) continue;
        for (let x = 0; x < W; x++) {
          const xx = x + ox;
          if (xx < 0 || xx >= W) continue;
          const i = y * W + x;
          const tan = (mnt[yy * W + xx] - mnt[i]) / dist;
          if (tan > maxTan[i]) maxTan[i] = tan;
        }
      }
    }

    for (let i = 0; i < t.N; i++) {
      const u = maxTan[i];
      out[i] += u / Math.sqrt(1 + u * u);
    }
  }

  for (let i = 0; i < t.N; i++) out[i] = 1 - out[i] / n;
  return out;
}

// ── Couches ─────────────────────────────────────────────────────────────────

/**
 * Description de chaque couche : comment la calculer, et comment la lire.
 *
 * `etendue` renvoie l'intervalle de valeurs à étaler sur la palette. Pour les
 * couches signées, il est déduit de la dispersion réelle plutôt que des
 * extrêmes : quelques cellules aberrantes suffiraient sinon à éteindre tout le
 * reste de l'image.
 */
const COUCHES = [
  {
    cle: 'ombrage',
    ancrage: 'centre',
    libelle: 'Ombrage',
    aide: 'Quatre soleils combinés. La lecture la plus familière du terrain.',
    calculer: (t) => ombrageMulti(t),
    etendue: () => [0, 1],
    palette: 'gris',
  },
  {
    cle: 'svf',
    ancrage: 'haut',
    libelle: 'Sky-View Factor',
    aide: 'Part de ciel visible. Sans direction d’éclairage, et lisible pareillement sur versant et sur plat.',
    calculer: (t, p) => svf(t, p),
    etendue: (v) => [centile(v, 0.02), 1],
    palette: 'gris',
    lent: true,
  },
  {
    cle: 'microrelief',
    ancrage: 'centre',
    libelle: 'Micro-relief',
    aide: 'MNT moins MNT lissé. Efface le versant, garde ce qui dépasse ou creuse — talus, terrasses, chemins creux.',
    calculer: (t, p) => microRelief(t, p.rayonMicroReliefM),
    etendue: (v) => { const e = dispersion(v) * 3; return [-e, e]; },
    palette: 'divergent',
  },
  {
    cle: 'hauteur',
    ancrage: 'bas',
    libelle: 'Hauteur des structures',
    aide: 'Ce qui se dresse au-dessus du sol, végétation exclue. C’est le signal même de la détection.',
    calculer: (t) => t.hauteur,
    etendue: (v, p) => [0, p.hauteurMaxM],
    palette: 'chaud',
  },
  {
    cle: 'trou',
    ancrage: 'bas',
    libelle: 'Trous dans le sol',
    aide: 'Cellules sans aucun retour au sol. La pierre est opaque au laser ; le couvert végétal, jamais tout à fait.',
    calculer: (t) => t.trou,
    etendue: () => [0, 1],
    palette: 'froid',
  },
];

/** Écart absolu médian approché — mesure de dispersion insensible aux extrêmes. */
function dispersion(v) {
  let somme = 0, nb = 0;
  for (let i = 0; i < v.length; i++) {
    if (Number.isFinite(v[i])) { somme += Math.abs(v[i]); nb++; }
  }
  return nb ? Math.max(1e-4, somme / nb) : 1;
}

/** Centile approché par histogramme — suffisant pour caler un contraste. */
function centile(v, part) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) continue;
    if (v[i] < min) min = v[i];
    if (v[i] > max) max = v[i];
  }
  if (!(max > min)) return min === Infinity ? 0 : min;

  const seaux = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) continue;
    seaux[Math.min(255, ((v[i] - min) / (max - min) * 255) | 0)]++;
    total++;
  }
  let cumul = 0;
  for (let k = 0; k < 256; k++) {
    cumul += seaux[k];
    if (cumul >= total * part) return min + (k / 255) * (max - min);
  }
  return max;
}

/**
 * Resserre ou élargit l'intervalle affiché, autour du point qui compte.
 *
 * Un contraste unique appliqué au milieu de l'intervalle ne convient pas à
 * toutes les couches. Le micro-relief est signé et son zéro doit rester au
 * centre ; le Sky-View Factor a son maximum à 1, le plat parfait, et tout ce
 * qu'on cherche est du côté sombre — c'est donc le bas qu'il faut remonter ; la
 * hauteur part de zéro et c'est son plafond qu'il faut abaisser. D'où l'ancrage
 * déclaré par chaque couche.
 */
function etirer(base, ancrage, contraste) {
  const c = Math.max(0.2, contraste || 1);
  const [min, max] = base;
  const portee = (max - min) / c;
  if (ancrage === 'bas') return [min, min + portee];
  if (ancrage === 'haut') return [max - portee, max];
  const centre = (min + max) / 2;
  return [centre - portee / 2, centre + portee / 2];
}

/**
 * Calcule une couche et son étalement, en chronométrant.
 *
 * Le temps est remonté à l'interface : c'est la seule façon de savoir ce que
 * coûte réellement le Sky-View Factor sur une machine donnée, plutôt que de
 * l'estimer.
 */
function calculer(t, cle, options = {}) {
  const p = { ...CONFIG.relief, ...options };
  const def = COUCHES.find((c) => c.cle === cle) || COUCHES[0];
  const t0 = performance.now();
  const valeurs = def.calculer(t, p);
  // L'intervalle brut est conservé : le contraste se rejoue à l'affichage, sans
  // refaire le calcul. Sur le Sky-View Factor, le refaire à chaque mouvement du
  // curseur coûterait plusieurs secondes par cran.
  const base = def.etendue(valeurs, p);
  const [min, max] = etirer(base, def.ancrage, p.contraste);
  return {
    cle: def.cle, valeurs, base, ancrage: def.ancrage, min, max,
    palette: def.palette, duree: performance.now() - t0,
  };
}

return { preparer, calculer, etirer, COUCHES, ombrage, ombrageMulti, microRelief, svf, flouBoite, gradients };
})();
