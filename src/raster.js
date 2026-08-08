// Rastérisation du nuage en grilles régulières, et dérivation du modèle de
// terrain.
//
// Toute la détection travaille sur ces grilles plutôt que sur le nuage : croiser
// « non classé » et « sol » cellule par cellule est le signal recherché, et un
// tableau régulier rend triviaux le voisinage, la morphologie et l'étiquetage
// en composantes connexes.

// Classes ASPRS telles que l'IGN les emploie en LiDAR HD.
const CLASSE = {
  NON_CLASSE: 1,
  SOL: 2,
  VEG_BASSE: 3,
  VEG_MOYENNE: 4,
  VEG_HAUTE: 5,
  BATIMENT: 6,
  EAU: 9,
  PONT: 17,
  SURSOL_PERENNE: 64,
  POINT_VIRTUEL: 66,
  DIVERS: 67,
};

/**
 * Construit les grilles à partir du nuage.
 *
 * Le pas demandé est relevé si la zone est trop vaste : à 25 cm, une dalle
 * entière ferait 16 M de cellules et plus de 400 Mo de tableaux, ce qui fait
 * tomber l'onglet. On préfère une grille plus grossière annoncée qu'un plantage.
 */
function rasteriser(nuage, pasDemande = CONFIG.raster.pasM) {
  const { emprise } = nuage;
  const largeurM = emprise.xmax - emprise.xmin;
  const hauteurM = emprise.ymax - emprise.ymin;

  let pas = pasDemande;
  const max = CONFIG.raster.cellulesMax;
  if ((largeurM / pas) * (hauteurM / pas) > max) {
    pas = Math.sqrt((largeurM * hauteurM) / max);
    pas = Math.ceil(pas * 20) / 20;   // arrondi au multiple de 5 cm supérieur
  }

  const W = Math.max(1, Math.ceil(largeurM / pas));
  const H = Math.max(1, Math.ceil(hauteurM / pas));
  const N = W * H;

  const g = {
    W, H, pas, emprise,
    origine: nuage.origine,
    solZ: new Float32Array(N).fill(NaN),   // Z minimal des points « sol »
    solN: new Uint16Array(N),
    ncSomme: new Float32Array(N),          // cumul des Z « non classé »
    ncN: new Uint16Array(N),
    batSomme: new Float32Array(N),         // idem pour la classe « bâtiment »
    batN: new Uint16Array(N),
    vegN: new Uint16Array(N),
    totalN: new Uint16Array(N),
  };

  // Coordonnées du nuage relatives à `origine` : on repasse en absolu pour
  // indexer, puis on garde tout en relatif dans les grilles.
  const x0 = emprise.xmin - nuage.origine[0];
  const y0 = emprise.ymin - nuage.origine[1];
  const inv = 1 / pas;

  for (let i = 0; i < nuage.n; i++) {
    const cx = ((nuage.x[i] - x0) * inv) | 0;
    const cy = ((nuage.y[i] - y0) * inv) | 0;
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
    const c = cy * W + cx;
    const z = nuage.z[i];
    const cl = nuage.cls[i];

    if (g.totalN[c] < 65535) g.totalN[c]++;

    switch (cl) {
      case CLASSE.SOL:
        // Le minimum, pas la moyenne : un point de sol mal classé sur un muret
        // tirerait la référence vers le haut et masquerait la structure.
        if (!(g.solZ[c] <= z)) g.solZ[c] = z;
        if (g.solN[c] < 65535) g.solN[c]++;
        break;
      case CLASSE.NON_CLASSE:
        g.ncSomme[c] += z;
        if (g.ncN[c] < 65535) g.ncN[c]++;
        break;
      case CLASSE.VEG_BASSE: case CLASSE.VEG_MOYENNE: case CLASSE.VEG_HAUTE:
        if (g.vegN[c] < 65535) g.vegN[c]++;
        break;
      case CLASSE.BATIMENT:
        g.batSomme[c] += z;
        if (g.batN[c] < 65535) g.batN[c]++;
        break;
      default:
        break;
    }
  }

  g.mnt = modeleTerrain(g);
  g.pente = pente(g.mnt, W, H, pas);
  return g;
}

/**
 * Grilles du « signal » : nombre de points porteurs et hauteur au-dessus du
 * terrain.
 *
 * Le signal est par défaut la seule classe « non classé ». L'option
 * `inclureBati` y ajoute la classe 6 : le classificateur automatique de l'IGN
 * étiquette parfois une cabane debout comme bâtiment, et une cabane classée
 * bâtiment mais absente de la BD TOPO reste exactement ce qu'on cherche.
 *
 * Calculé ici plutôt qu'à la rastérisation pour que l'option se change sans
 * refaire une passe sur des millions de points.
 */
function signal(g, inclureBati = false) {
  const N = g.W * g.H;
  const nb = new Uint16Array(N);
  const hauteur = new Float32Array(N).fill(NaN);

  for (let i = 0; i < N; i++) {
    const n = g.ncN[i] + (inclureBati ? g.batN[i] : 0);
    if (!n) continue;
    const somme = g.ncSomme[i] + (inclureBati ? g.batSomme[i] : 0);
    nb[i] = n;
    hauteur[i] = somme / n - g.mnt[i];
  }
  return { nb, hauteur };
}

/**
 * Modèle numérique de terrain : la surface du sol, trous comblés.
 *
 * C'est la pièce maîtresse. Une ruine se manifeste précisément par une **absence
 * de points « sol »** là où elle se dresse — le laser ne voit pas le sol sous
 * les pierres. Sans comblement, la case sous la structure n'aurait aucune
 * altitude de référence et la hauteur de la structure serait incalculable
 * exactement là où elle compte.
 *
 * Le comblement propage les bords vers l'intérieur, une couronne par passe : le
 * trou se remplit par interpolation depuis son pourtour, ce qui donne bien
 * l'altitude qu'aurait le terrain sans la structure.
 */
function modeleTerrain(g) {
  const { W, H } = g;
  const N = W * H;
  let cour = Float32Array.from(g.solZ);
  let valide = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (g.solN[i] > 0) valide[i] = 1;

  let suiv = new Float32Array(N);
  let valideSuiv = new Uint8Array(N);

  for (let passe = 0; passe < CONFIG.raster.rayonComblementSol; passe++) {
    suiv.set(cour);
    valideSuiv.set(valide);
    let comblees = 0;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = y * W + x;
        if (valide[c]) continue;
        let somme = 0, nb = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const v = yy * W + xx;
            if (valide[v]) { somme += cour[v]; nb++; }
          }
        }
        if (nb) { suiv[c] = somme / nb; valideSuiv[c] = 1; comblees++; }
      }
    }

    [cour, suiv] = [suiv, cour];
    [valide, valideSuiv] = [valideSuiv, valide];
    if (!comblees) break;   // plus rien à propager : trous restants isolés du reste
  }

  // Les cellules jamais atteintes (zone sans aucun point sol) reçoivent la
  // médiane globale : elles seront de toute façon écartées, mais un NaN se
  // propagerait dans le calcul de pente.
  const connues = [];
  for (let i = 0; i < N; i++) if (valide[i]) connues.push(cour[i]);
  const repli = connues.length
    ? connues.sort((a, b) => a - b)[connues.length >> 1]
    : 0;
  for (let i = 0; i < N; i++) if (!valide[i] || !Number.isFinite(cour[i])) cour[i] = repli;

  g.solConnu = valide;
  return flouBoite(cour, W, H, CONFIG.raster.rayonLissageSol);
}

/**
 * Flou de boîte séparable à somme glissante : O(W·H) quel que soit le rayon.
 *
 * Un flou plutôt qu'une médiane : le MNT est déjà une statistique robuste (le
 * minimum des points sol), il ne reste que du bruit d'échantillonnage. Le calcul
 * de pente, lui, amplifie violemment ce bruit et exige une surface lisse.
 */
function flouBoite(src, W, H, rayon) {
  if (rayon <= 0) return src;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);

  for (let y = 0; y < H; y++) {
    const l = y * W;
    let somme = 0;
    for (let x = -rayon; x <= rayon; x++) somme += src[l + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[l + x] = somme / (2 * rayon + 1);
      somme -= src[l + Math.min(W - 1, Math.max(0, x - rayon))];
      somme += src[l + Math.min(W - 1, Math.max(0, x + rayon + 1))];
    }
  }
  for (let x = 0; x < W; x++) {
    let somme = 0;
    for (let y = -rayon; y <= rayon; y++) somme += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = somme / (2 * rayon + 1);
      somme -= tmp[Math.min(H - 1, Math.max(0, y - rayon)) * W + x];
      somme += tmp[Math.min(H - 1, Math.max(0, y + rayon + 1)) * W + x];
    }
  }
  return out;
}

/** Pente en degrés, gradient de Sobel sur le MNT. */
function pente(mnt, W, H, pas) {
  const out = new Float32Array(W * H);
  const lire = (x, y) => mnt[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dzdx = ((lire(x + 1, y - 1) + 2 * lire(x + 1, y) + lire(x + 1, y + 1))
                  - (lire(x - 1, y - 1) + 2 * lire(x - 1, y) + lire(x - 1, y + 1))) / (8 * pas);
      const dzdy = ((lire(x - 1, y + 1) + 2 * lire(x, y + 1) + lire(x + 1, y + 1))
                  - (lire(x - 1, y - 1) + 2 * lire(x, y - 1) + lire(x + 1, y - 1))) / (8 * pas);
      out[y * W + x] = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
    }
  }
  return out;
}

/** Hauteur au-dessus du terrain pour chaque point du nuage — colorisation. */
function hauteurParPoint(nuage, g) {
  const out = new Float32Array(nuage.n);
  const x0 = g.emprise.xmin - nuage.origine[0];
  const y0 = g.emprise.ymin - nuage.origine[1];
  const inv = 1 / g.pas;

  for (let i = 0; i < nuage.n; i++) {
    const cx = Math.min(g.W - 1, Math.max(0, ((nuage.x[i] - x0) * inv) | 0));
    const cy = Math.min(g.H - 1, Math.max(0, ((nuage.y[i] - y0) * inv) | 0));
    out[i] = nuage.z[i] - g.mnt[cy * g.W + cx];
  }
  return out;
}

/** Centre d'une cellule, en Lambert-93 absolu. */
function centreCellule(g, x, y) {
  return {
    x: g.emprise.xmin + (x + 0.5) * g.pas,
    y: g.emprise.ymin + (y + 0.5) * g.pas,
  };
}

const RASTER = { CLASSE, rasteriser, signal, hauteurParPoint, centreCellule };
