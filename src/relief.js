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
// (`test/relief.test.js`).
//
// Ce qui est réutilisé, en revanche, c'est `raster.js` : ses grilles ont fait
// leurs preuves, la détection de structures trouve effectivement ce qu'elle
// cherche.
//
// Enveloppé dans une IIFE : les noms naturels ici — `ombrage`, `flou`, `pente` —
// entreraient en collision dans l'environnement lexical partagé par les scripts
// classiques. Seul `RELIEF` en sort.

// Une fonction nommée plutôt qu'une expression appelée sur place : son texte
// part tel quel dans le worker du relief (relief-travailleur.js).
function fabriqueRelief() {
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
 *
 * Deux de plus s'y ajoutent pour le pointé 3D (`terrain.js`) : `sommet`, le Z
 * maximal relevé, toutes classes confondues (végétation, ponts compris), là
 * où `hauteur` s'en tient au signal de détection ; et `sommetCls`, la classe
 * qui le porte, pour qu'un point démasqué à l'affichage cesse d'y répondre.
 * `sommet` vaut `-Infinity` là où `g` ne porte pas `sommetZ` (grilles de test)
 * ou qu'aucun point n'y a été vu — jamais NaN, pour rester comparable sans
 * propager de faux.
 */
function preparer(g, options = {}) {
  const p = { ...CONFIG.relief, ...options };
  const f = Math.max(1, Math.round(p.pasM / g.pas));
  const W = Math.max(1, Math.floor(g.W / f));
  const H = Math.max(1, Math.floor(g.H / f));
  const N = W * H;

  const mnt = new Float32Array(N).fill(NaN);
  // Deux surfaces, et pas une seule.
  //
  // `mnt` est la **moyenne** des cellules fines du bloc : c'est la surface qu'on
  // affiche, et la seule lisible. `analyse` retient le **maximum des cellules
  // réellement mesurées**, ce qui préserve les murs mais amplifie le bruit
  // d'échantillonnage — à 25 cm une cellule ne reçoit que 0,6 point, prendre le
  // plus haut de quatre valeurs bruitées relève systématiquement le résultat.
  //
  // Les avoir confondues s'est vu tout de suite à l'écran : le Sky-View Factor
  // est devenu franchement plus bruité. Les couches affichées lisent donc `mnt`,
  // et `lignes.js` seul lit `analyse`, où le bruit importe moins que la crête.
  const analyse = new Float32Array(N).fill(NaN);
  const valide = new Uint8Array(N);
  const hauteur = new Float32Array(N);
  const trou = new Float32Array(N);
  const sommet = new Float32Array(N).fill(-Infinity);
  const sommetCls = new Uint8Array(N);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let somme = 0, sommeSol = 0, connues = 0, fines = 0, sansSol = 0, hMax = 0, zMax = -Infinity, mesurees = 0,
        sommetMax = -Infinity, sommetMaxCls = 0;

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
          const connue = !g.solConnu || g.solConnu[c];

          // Altitude moyenne des retours non classés — et « bâtiment » si
          // l'option le demande. Calculée ici plutôt qu'en passant par
          // `RASTER.signal`, qui allouerait deux tableaux à la grille fine, soit
          // ~96 Mo sur une dalle entière.
          const n = g.ncN[c] + (p.inclureBati ? g.batN[c] : 0);
          const zSursol = n
            ? (g.ncSomme[c] + (p.inclureBati ? g.batSomme[c] : 0)) / n
            : NaN;

          // Hauteur du signal : ce sursol au-dessus du sol comblé. Mesurée
          // contre `g.mnt`, jamais contre la surface complétée ci-dessous —
          // sinon la hauteur d'une structure vaudrait zéro par construction.
          if (n && connue) {
            const h = zSursol - g.mnt[c];
            if (h > hMax) hMax = h;
          }

          // Seules les cellules que le comblement a atteintes portent une
          // altitude qui veut dire quelque chose ; ailleurs le MNT garde une
          // valeur de repli sans aucun rapport avec le terrain.
          if (connue) {
            connues++;
            // Le sol seul, qui reste la référence de la surface d'analyse.
            sommeSol += g.mnt[c];

            // La surface **affichée** : le même sol, complété par les retours
            // non classés là où il n'y a aucun retour sol.
            //
            // Une ruine est opaque au laser : elle ne laisse aucun retour sol
            // sous elle, et le comblement met à sa place une surface lisse
            // interpolée depuis ses bords. Elle disparaît donc exactement de la
            // couche où on la cherche. Les points non classés, eux, sont là —
            // ce sont ceux de la ruine. Substituer une mesure à une valeur
            // inventée ne peut pas dégrader la surface : on ne remplace jamais
            // du sol mesuré, seulement du sol interpolé.
            //
            // Le plafond de hauteur n'est pas un raffinement. La classe 1
            // recueille aussi ce que le classificateur n'a pas su ranger,
            // végétation comprise : sans lui, un retour de branche à vingt
            // mètres deviendrait un pic de terrain. Une ruine, un muret, une
            // charbonnière tiennent sous trois mètres ; un arbre non.
            let z = g.mnt[c];
            if (p.inclureSursol && !g.solN[c] && n) {
              const h = zSursol - g.mnt[c];
              if (h > 0 && h <= p.hauteurSursolMaxM) z = zSursol;
            }
            somme += z;
          }

          // Le maximum ne se prend que sur les cellules **réellement mesurées**,
          // et sur `solZ` — l'altitude brute — plutôt que sur le MNT comblé.
          // À 25 cm, une cellule ne reçoit que 0,6 point : plus de la moitié du
          // mur est comblée depuis ses voisines, donc depuis le sol, ce qui
          // rabat la crête d'autant. Prendre le maximum de ces valeurs comblées
          // ne récupérait rien — mesuré : la cabane classée « sol » restait
          // invisible.
          if (g.solN[c] > 0 && g.solZ[c] > zMax) { zMax = g.solZ[c]; mesurees++; }
          // `trou` garde son sens strict : aucun retour **sol**. C'est l'indice
          // le plus physique de la détection, et le compléter ici le viderait.
          if (!g.solN[c]) sansSol++;

          // Le sommet toutes classes, pour le pointé 3D — absent des grilles de
          // test qui n'en ont pas l'usage, d'où la garde.
          if (g.sommetZ && g.sommetZ[c] > sommetMax) {
            sommetMax = g.sommetZ[c];
            sommetMaxCls = g.sommetCls[c];
          }
        }
      }

      const i = y * W + x;
      if (connues) {
        // **Maximum**, et non moyenne, des cellules fines du bloc.
        //
        // Contre-intuitif pour un modèle de terrain, et pourtant décisif ici.
        // Le MNT fin retient déjà le Z **minimum** des points sol de chaque
        // cellule, ce qui est juste — on veut le sol nu — mais érode un mur
        // d'une cellule de chaque côté : à 25 cm, il ne reste que la moitié de
        // la largeur d'un mur d'un mètre. Moyenner ensuite quatre cellules fines
        // dont deux sont du sol **divise la hauteur du mur par deux**, et le
        // creux d'ouverture mesuré passe sous le seuil : mesuré, une cabane
        // classée « sol » devenait totalement invisible à la voie par la forme —
        // c'est-à-dire précisément le cas pour lequel cette voie existe.
        //
        // Le maximum ne fabrique rien : il choisit, parmi des altitudes de sol
        // toutes réelles, la plus haute du bloc. Sur un terrain sans structure il
        // décale la surface de quelques centimètres, ce que l'ouverture ignore
        // — elle mesure des angles entre cellules, pas une altitude absolue.
        mnt[i] = somme / connues;
        // `analyse` ne prend **pas** la substitution : `lignes.js` construit son
        // enveloppe en ajoutant `hauteur` à cette surface, et une structure qui
        // serait déjà dans l'une et encore dans l'autre compterait double.
        analyse[i] = mesurees ? zMax : sommeSol / connues;
        valide[i] = 1;
      }
      hauteur[i] = hMax;
      trou[i] = fines ? sansSol / fines : 1;
      sommet[i] = sommetMax;
      sommetCls[i] = sommetMaxCls;
    }
  }

  // Les cellules sans sol connu reçoivent la médiane approchée du reste : les
  // gradients et les flous ont besoin d'un nombre, la carte de validité dira
  // qu'il ne faut pas y croire.
  //
  // `garderRepli`, au pas même de la grille (f = 1) : elles gardent l'altitude
  // que le terrain leur a déjà donnée — la médiane de repli, lissée. C'est ce
  // que la carte graphique produit sans rien calculer de plus (vue-relief.js),
  // et les deux chemins doivent rendre la même surface.
  if (p.garderRepli && f === 1) {
    for (let i = 0; i < N; i++) if (!valide[i]) { mnt[i] = g.mnt[i]; analyse[i] = g.mnt[i]; }
  } else {
    let somme = 0, nb = 0;
    for (let i = 0; i < N; i++) if (valide[i]) { somme += mnt[i]; nb++; }
    const repli = nb ? somme / nb : 0;
    for (let i = 0; i < N; i++) if (!valide[i]) { mnt[i] = repli; analyse[i] = repli; }
  }

  return {
    W, H, N, pas: g.pas * f, mnt, analyse, valide, hauteur, trou, sommet, sommetCls,
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

// ── Carte graphique ou processeur ───────────────────────────────────────────

/**
 * Les couches coûteuses passent par la carte graphique quand elle est là et
 * vérifiée (gpu-relief.js), et retombent sinon sur le calcul ci-dessous, qui
 * reste la référence. `moteur: 'cpu'` force le processeur — pour comparer, et
 * pour l'autocontrôle de gpu-relief.js, qui s'y compare. `CONFIG.relief.gpu`
 * à `false` fait de même partout.
 */
let dernierMoteur = 'cpu';

function viaGPU(p) {
  return p.moteur !== 'cpu' && p.gpu !== false && typeof GPU_RELIEF !== 'undefined';
}

/** Rend le résultat de la carte graphique s'il existe, et note le moteur. */
function surGPU(resultat) {
  dernierMoteur = resultat ? 'gpu' : 'cpu';
  return resultat;
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
function microRelief(t, rayonM, options = {}) {
  const r = Math.max(1, Math.round(rayonM / t.pas));
  const p = { ...CONFIG.relief, ...options };
  const gpu = viaGPU(p) ? surGPU(GPU_RELIEF.microRelief(t, r)) : surGPU(null);
  if (gpu) return gpu;
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
 * Ombrage multidirectionnel : la moyenne de quatre soleils **dans un même quadrant**, à 45° les uns des autres
 * (225°, 270°, 315°, 360° par défaut, comme GDAL et l'USGS).
 *
 * Un ombrage unique est aveugle aux formes parallèles à ses rayons : un muret orienté dans l'axe du soleil ne
 * projette aucune ombre et disparaît. Quatre lumières voisines couvrent ce biais en gardant un côté éclairé.
 * **Pas quatre soleils opposés** (0°, 90°, 180°, 270°) : leurs parts directionnelles s'annulent exactement, il reste
 * sin(hauteur) × cos(pente), une carte de pente sans orientation (un versant nord et un versant sud y sont identiques).
 */
function ombrageMulti(t, options = {}) {
  const p = { ...CONFIG.relief, ...options };
  const { azimut, hauteur } = soleilDe(p);
  const azimuts = [-90, -45, 0, 45].map((d) => (azimut + d + 360) % 360);
  const gpu = viaGPU(p) ? surGPU(GPU_RELIEF.ombrages(t, azimuts.map((az) => [az, hauteur]))) : surGPU(null);
  if (gpu) {
    // Même somme puis même division que ci-dessous, dans le même ordre.
    const out = new Float32Array(t.N);
    for (const o of gpu) for (let i = 0; i < t.N; i++) out[i] += o[i];
    for (let i = 0; i < t.N; i++) out[i] /= azimuts.length;
    return out;
  }
  const grads = gradients(t);
  const out = new Float32Array(t.N);
  for (const az of azimuts) {
    const o = ombrage(t, az, hauteur, grads);
    for (let i = 0; i < t.N; i++) out[i] += o[i];
  }
  for (let i = 0; i < t.N; i++) out[i] /= azimuts.length;
  return out;
}

/**
 * Ombrage à **un seul soleil** : le rendu classique d'un hillshade, plus
 * contrasté que la moyenne de quatre, mais aveugle aux formes parallèles à son
 * rayon (voir `ombrageMulti`). Le réglage d'azimut sert justement à tourner
 * autour de ce défaut.
 */
function ombrageSimple(t, options = {}) {
  const p = { ...CONFIG.relief, ...options };
  const { azimut, hauteur } = soleilDe(p);
  const gpu = viaGPU(p) ? surGPU(GPU_RELIEF.ombrages(t, [[azimut, hauteur]])) : surGPU(null);
  return gpu ? gpu[0] : ombrage(t, azimut, hauteur);
}

/** Le soleil par défaut des ombrages, tel que la configuration le porte. */
function soleilParDefaut() {
  return { azimut: CONFIG.relief.ombrageAzimut, hauteur: CONFIG.relief.ombrageHauteur };
}

/** Les deux réglages sont-ils ceux du défaut ? Ce que le lien n'écrit pas, et ce qu'un bouton « réinitialiser » n'a pas à changer. */
function soleilEstParDefaut(azimut, hauteur) {
  const d = soleilParDefaut();
  return azimut === d.azimut && hauteur === d.hauteur;
}

/**
 * Le soleil réglé par l'utilisateur : `ombrageAzimut` est celui du soleil central de l'ombrage à quatre (les autres
 * à -90°, -45° et +45°), du **premier** de l'ombrage coloré (les autres à pas égaux de 120°).
 * Les défauts reprennent les valeurs d'avant les curseurs (315°, 45°) : un
 * lien ou une habitude d'avant ne change pas d'image.
 */
function soleilDe(p) {
  const azimut = Number.isFinite(p.ombrageAzimut) ? ((p.ombrageAzimut % 360) + 360) % 360 : 315;
  const hauteur = Number.isFinite(p.ombrageHauteur) ? Math.min(89, Math.max(1, p.ombrageHauteur)) : 45;
  return { azimut, hauteur };
}

/**
 * Ombrage multidirectionnel **coloré** : trois soleils à 120° l'un de
 * l'autre, un par canal (rouge, vert, bleu) plutôt que moyennés en gris.
 *
 * `ombrageMulti` règle déjà la disparition d'un muret parallèle au rayon —
 * mais en moyennant, elle efface aussi l'information de *quelle* direction
 * l'éclairait. La conserver par canal fait ressortir en teinte l'orientation
 * d'un talus ou d'un mur, un rendu proche de ce que d'autres visionneuses
 * LiDAR appellent parfois « RGB hillshade ». 315° reprend l'azimut par
 * défaut d'`ombrage()`, pour rester le point de repère familier.
 *
 * Ne passe pas par `calculer()` : contrairement aux autres couches, il n'y a
 * ni palette ni étalement à choisir, la couleur est déjà le résultat.
 * `Vue2D` la consomme donc comme la photo aérienne — un buffer RGBA tout
 * fait — pas comme une couche à palette (voir `sourceCouche` dans app.js).
 *
 * @returns {Uint8ClampedArray} RGBA, `t.N × 4` octets ; alpha à 0 là où le
 *   sol est inconnu (`!t.valide`), pour que `Vue2D` y pose le même gris
 *   neutre que sur les autres couches plutôt qu'une couleur inventée.
 */
function ombrageRGB(t, options = {}) {
  const p = { ...CONFIG.relief, ...options };
  const { azimut, hauteur } = soleilDe(p);
  // 315° par défaut (le défaut d'ombrage()), puis +120° et +240° (75° et 195°).
  const AZIMUTS = [0, 120, 240].map((d) => (azimut + d) % 360);
  const gpu = viaGPU(p) ? surGPU(GPU_RELIEF.ombrages(t, AZIMUTS.map((az) => [az, hauteur]))) : surGPU(null);
  const [r, v, b] = gpu || (() => {
    const grads = gradients(t);
    return AZIMUTS.map((az) => ombrage(t, az, hauteur, grads));
  })();

  const rgba = new Uint8ClampedArray(t.N * 4);
  for (let i = 0; i < t.N; i++) {
    const k = i * 4;
    rgba[k] = r[i] * 255;
    rgba[k + 1] = v[i] * 255;
    rgba[k + 2] = b[i] * 255;
    rgba[k + 3] = t.valide[i] ? 255 : 0;
  }
  return rgba;
}

// ── Balayage d'horizons : Sky-View Factor et ouverture ──────────────────────

/**
 * Une seule passe pour trois couches, parce qu'elles lisent le même horizon.
 *
 * Pour `n` directions, on parcourt le rayon en suivant la **tangente** de
 * l'angle d'élévation, et on retient son maximum et son minimum. De ces deux
 * nombres sortent :
 *
 *  - **Sky-View Factor** (Zakšek, Oštir & Kokalj 2011), part de voûte céleste
 *    visible : `1 − (1/n)·Σ sin γᵢ`, les horizons négatifs ramenés à zéro — ce
 *    qui est plus bas que soi ne masque pas le ciel ;
 *  - **ouverture positive** (Yokoyama 2002), moyenne des angles zénithaux
 *    `90° − max β`, qui fait ressortir le **convexe** : crêtes, couronnes de
 *    murs, talus ;
 *  - **ouverture négative**, moyenne des angles nadiraux `90° + min β`, qui
 *    fait ressortir le **concave** : fonds de creux, chemins creux, intérieurs
 *    de cabane.
 *
 * Pourquoi l'ouverture en plus du SVF, alors que les deux se ressemblent : elle
 * **efface la pente d'ensemble exactement**, et non seulement à peu près. Sur
 * n'importe quel plan incliné, les deux ouvertures valent 90°, parce que
 * l'élévation vue vers l'amont annule celle vue vers l'aval — c'est ce que
 * vérifie `test/relief.test.js`. Une structure se lit donc à la même valeur en
 * fond de vallée et sur un versant à 30°, ce qu'aucun seuil en mètres ne sait
 * faire. Et les deux signes séparent ce qu'une seule couche mélange : un mur
 * ruiné est une couronne convexe autour d'un intérieur concave.
 *
 * Le SVF évite l'`atan` — `sin(atan(u)) = u / √(1+u²)` — mais l'ouverture est
 * par définition une moyenne d'**angles** : deux `atan` par cellule et par
 * direction, mesurés à environ un cinquième du coût du balayage lui-même. On
 * les paie pour rester sur la définition publiée, donc comparable aux images de
 * la littérature.
 *
 * **Marge de bord :** près du bord, une partie du rayon sort de la grille et
 * l'horizon y est tronqué. Les trois couches sont donc fausses sur une couronne
 * de `svfRayonM` — à écarter avant tout seuillage, comme la marge du
 * micro-relief.
 */
let dernierBalayage = null;

function balayerHorizons(t, options = {}) {
  const p = { ...CONFIG.relief, ...options };
  const n = Math.max(4, p.svfDirections | 0);
  const R = Math.max(1, Math.round(p.svfRayonM / t.pas));

  // Mémo à une entrée : trois couches sortent du même balayage, et l'interface
  // les affiche l'une après l'autre. Sans lui, passer de l'ouverture positive à
  // la négative repaierait plusieurs secondes pour un résultat déjà calculé.
  const moteur = viaGPU(p) ? 'gpu' : 'cpu';
  if (dernierBalayage && dernierBalayage.t === t
      && dernierBalayage.n === n && dernierBalayage.R === R && dernierBalayage.moteur === moteur) {
    dernierMoteur = dernierBalayage.moteurReel;
    return dernierBalayage.res;
  }

  const gpu = moteur === 'gpu' ? surGPU(GPU_RELIEF.horizons(t, n, R)) : surGPU(null);
  if (gpu) {
    dernierBalayage = { t, n, R, moteur, moteurReel: 'gpu', res: gpu };
    return gpu;
  }

  const { W, H, mnt } = t;
  // Les cellules sans donnée sont **écartées du balayage**, pas seulement de la
  // lecture.
  //
  // Elles portent une altitude de repli — la médiane de la dalle — qui n'a
  // aucun rapport avec le terrain local : dans une combe, elle vaut plusieurs
  // mètres de trop. La cellule se comporte alors comme une tour, et toute
  // cellule qui la voit le long d'une des directions balayées voit son horizon
  // monter. Comme il n'y a que huit directions, l'ombre ne s'étale pas : elle
  // forme **une étoile à huit branches** autour de chaque trou, signature
  // observée à l'écran sur données réelles.
  // Repli défensif : une grille sans carte de validité est réputée pleine, ce
  // qui rend exactement le comportement d'avant. Un `valide` manquant ne doit
  // pas se traduire par une couche entièrement vide.
  const valide = t.valide || new Uint8Array(t.N).fill(1);

  // Surface de balayage : le MNT, **NaN dans les cellules sans donnée**.
  //
  // C'est ce qui coûte le moins cher. Un test de validité par échantillon
  // fonctionne mais alourdit la boucle la plus chaude du projet de 36 %
  // (mesuré : 3,77 s → 5,13 s sur 2000 × 2000, 8 directions sur 10 m). NaN, lui,
  // rend fausses **toutes** les comparaisons : `tan > maxTan` et `tan < minTan`
  // échouent ensemble, l'échantillon est ignoré sans qu'aucune ligne ne soit
  // ajoutée à la boucle. Une copie de 16 Mo sur une dalle contre un tiers du
  // temps de calcul.
  //
  // Le prix, assumé : un échantillon dont l'interpolation touche un trou est
  // rejeté en entier, même si l'autre extrémité pèse tout le poids. Le rayon
  // devient donc légèrement aveugle au bord des trous — il éclaircit un peu,
  // là où le défaut d'origine assombrissait en étoile.
  const surface = new Float32Array(t.N);
  for (let i = 0; i < t.N; i++) surface[i] = valide[i] ? mnt[i] : NaN;

  const svf = new Float32Array(t.N);
  const ouvPos = new Float32Array(t.N);
  const ouvNeg = new Float32Array(t.N);
  const maxTan = new Float32Array(t.N);
  const minTan = new Float32Array(t.N);
  const DEMI_PI = Math.PI / 2;

  for (let d = 0; d < n; d++) {
    const a = (d / n) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    // Le maximum n'est plus borné à zéro : l'ouverture a besoin de l'élévation
    // vraie, y compris négative. Le SVF la ramène à zéro à la lecture, ce qui
    // lui rend exactement le comportement d'avant.
    maxTan.fill(-Infinity);
    minTan.fill(Infinity);

    // Le rayon est parcouru **sur son axe dominant**, l'autre coordonnée étant
    // interpolée : l'échantillon tombe alors exactement sur le rayon, pour deux
    // lectures de mémoire au lieu d'une.
    //
    // Pourquoi ne pas se contenter du plus proche voisin, comme avant : avec
    // des décalages entiers le rayon zigzague autour de sa direction. Le
    // maximum retient le pas le plus tourné vers l'amont, le minimum le moins
    // tourné, et les deux ne se compensent plus entre une direction et son
    // opposée. Sur un simple plan à 20°, l'ouverture tombait à **88,6° au lieu
    // de 90** avec 16 directions — un biais de 1,4°, fonction de la pente
    // locale, sur une couche dont le signal utile vaut quelques degrés.
    // Invisible à l'œil, fatal à un seuil. Avec 8 directions il ne se voyait
    // pas : elles tombent sur les axes et les diagonales, où l'arrondi est
    // exact.
    //
    // Une interpolation bilinéaire à quatre points corrigerait aussi, pour 36 %
    // de temps en plus (mesuré, à travail égal). Celle-ci corrige et fait
    // **gagner** 18 %, parce qu'elle ne touche qu'une ligne de la grille au lieu
    // de deux dans le cas dominant en x, et qu'elle prend √2 fois moins de pas
    // en diagonale. Le surcoût du balayage complet — 3,16 s à 4,83 s sur une
    // dalle à 50 cm, 8 directions sur 10 m — vient donc des deux `atan` et du
    // suivi du minimum, pas de l'échantillonnage.
    const majeurX = Math.abs(dx) >= Math.abs(dy);
    const majeur = majeurX ? Math.abs(dx) : Math.abs(dy);
    const K = Math.max(1, Math.floor(R * majeur));

    for (let k = 1; k <= K; k++) {
      const portee = k / majeur;              // distance en cellules
      const dist = portee * t.pas;
      const fx = dx * portee, fy = dy * portee;

      if (majeurX) {
        const ox = Math.round(fx);
        const y0 = Math.floor(fy), ty = fy - y0, w0 = 1 - ty;
        const yDeb = Math.max(0, -y0), yFin = Math.min(H, H - y0 - 1);
        const xDeb = Math.max(0, -ox), xFin = Math.min(W, W - ox);
        for (let y = yDeb; y < yFin; y++) {
          const la = (y + y0) * W, lb = la + W, l = y * W;
          for (let x = xDeb; x < xFin; x++) {
            const xa = x + ox;
            const z = w0 * surface[la + xa] + ty * surface[lb + xa];
            const i = l + x;
            const tan = (z - surface[i]) / dist;
            if (tan > maxTan[i]) maxTan[i] = tan;
            if (tan < minTan[i]) minTan[i] = tan;
          }
        }
      } else {
        const oy = Math.round(fy);
        const x0 = Math.floor(fx), tx = fx - x0, w0 = 1 - tx;
        const yDeb = Math.max(0, -oy), yFin = Math.min(H, H - oy);
        const xDeb = Math.max(0, -x0), xFin = Math.min(W, W - x0 - 1);
        for (let y = yDeb; y < yFin; y++) {
          const la = (y + oy) * W, l = y * W;
          for (let x = xDeb; x < xFin; x++) {
            const xa = x + x0;
            const z = w0 * surface[la + xa] + tx * surface[la + xa + 1];
            const i = l + x;
            const tan = (z - surface[i]) / dist;
            if (tan > maxTan[i]) maxTan[i] = tan;
            if (tan < minTan[i]) minTan[i] = tan;
          }
        }
      }
    }

    for (let i = 0; i < t.N; i++) {
      // Direction entièrement hors grille : horizon plat, faute de mieux.
      const haut = maxTan[i] === -Infinity ? 0 : maxTan[i];
      const bas = minTan[i] === Infinity ? 0 : minTan[i];
      const u = haut > 0 ? haut : 0;
      svf[i] += u / Math.sqrt(1 + u * u);
      ouvPos[i] += DEMI_PI - Math.atan(haut);
      ouvNeg[i] += DEMI_PI + Math.atan(bas);
    }
  }

  const versDeg = 180 / (Math.PI * n);
  for (let i = 0; i < t.N; i++) {
    // Une cellule sans donnée ne rend pas un nombre : elle ne sait rien. Le
    // canevas peint le non-fini en gris neutre, et les seuils des chaînes
    // d'analyse rejettent toute comparaison avec NaN — dans les deux cas, elle
    // est ignorée plutôt que devinée.
    if (!valide[i]) { svf[i] = NaN; ouvPos[i] = NaN; ouvNeg[i] = NaN; continue; }
    svf[i] = 1 - svf[i] / n;
    ouvPos[i] *= versDeg;
    ouvNeg[i] *= versDeg;
  }

  const res = { svf, ouverturePositive: ouvPos, ouvertureNegative: ouvNeg };
  dernierBalayage = { t, n, R, moteur, moteurReel: 'cpu', res };
  return res;
}

/** Part de la voûte céleste visible depuis chaque cellule, dans [0, 1]. */
function svf(t, options = {}) {
  return balayerHorizons(t, options).svf;
}

/** Ouverture de Yokoyama, en degrés. 90° sur tout plan, quelle que soit sa pente. */
function ouverture(t, options = {}, signe = 'positive') {
  const r = balayerHorizons(t, options);
  return signe === 'negative' ? r.ouvertureNegative : r.ouverturePositive;
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
    cle: 'ombrage',
    ancrage: 'centre',
    libelle: 'Ombrage (4 soleils)',
    aide: 'Quatre lumières voisines, du côté nord-ouest, combinées : un muret n’y disparaît pas, et le relief garde un côté éclairé. L’azimut et la hauteur se règlent.',
    calculer: (t, p) => ombrageMulti(t, p),
    etendue: () => [0, 1],
    palette: 'gris',
  },
  {
    cle: 'ombrage-simple',
    ancrage: 'centre',
    libelle: 'Ombrage simple (1 soleil)',
    aide: 'Un seul soleil, plus contrasté : un muret parallèle aux rayons disparaît, tournez l’azimut pour le retrouver.',
    calculer: (t, p) => ombrageSimple(t, p),
    etendue: () => [0, 1],
    palette: 'gris',
  },
  {
    cle: 'ouverture-pos',
    ancrage: 'centre',
    libelle: 'Ouverture positive',
    aide: 'Sombre là où le ciel se referme : intérieurs de cabane, fossés, chemins creux. Vaut 90° sur tout plan, quelle que soit sa pente.',
    calculer: (t, p) => ouverture(t, p, 'positive'),
    etendue: (v) => [centile(v, 0.02), centile(v, 0.98)],
    palette: 'gris',
    lent: true,
  },
  {
    cle: 'ouverture-neg',
    ancrage: 'centre',
    libelle: 'Ouverture négative',
    aide: 'Sombre sur ce qui domine : murs, crêtes, talus. C’est la couche où une couronne de pierres se lit le plus nettement.',
    calculer: (t, p) => ouverture(t, p, 'negative'),
    etendue: (v) => [centile(v, 0.02), centile(v, 0.98)],
    palette: 'gris',
    lent: true,
  },
  {
    cle: 'microrelief',
    ancrage: 'centre',
    libelle: 'Micro-relief',
    aide: 'MNT moins MNT lissé. Efface le versant, garde ce qui dépasse ou creuse : talus, terrasses, chemins creux.',
    calculer: (t, p) => microRelief(t, p.rayonMicroReliefM, p),
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
 * Valeur d'une couche sous chaque point du nuage, ramenée dans [0, 1].
 *
 * C'est ce qui permet de colorer le nuage 3D par une couche de relief : le
 * point prend la valeur de la cellule qu'il survole, et non la sienne. Une
 * couche d'ombrage ou de Sky-View Factor n'a en effet de sens que **par
 * cellule** — elle décrit le voisinage, pas le point.
 *
 * L'intervalle d'étalement est celui déjà calculé pour l'affichage 2D, contraste
 * compris : les deux vues montrent alors exactement la même image, ce qui est
 * tout l'intérêt — on repère une forme sur le canevas, on bascule en 3D, on la
 * retrouve au même endroit avec la même intensité.
 */
function valeurParPoint(nuage, t, couche) {
  const out = new Float32Array(nuage.n);
  const x0 = t.emprise.xmin - nuage.origine[0];
  const y0 = t.emprise.ymin - nuage.origine[1];
  const inv = 1 / t.pas;
  const { valeurs, min, max } = couche;
  const etendue = max - min || 1;

  for (let i = 0; i < nuage.n; i++) {
    const cx = Math.min(t.W - 1, Math.max(0, ((nuage.x[i] - x0) * inv) | 0));
    const cy = Math.min(t.H - 1, Math.max(0, ((nuage.y[i] - y0) * inv) | 0));
    const v = valeurs[cy * t.W + cx];
    // Les couches laissent des NaN là où elles ne savent pas — la marge de bord
    // du micro-relief, par exemple. Un NaN téléversé tel quel donne un point
    // noir aléatoire ; on le ramène au bas de l'échelle, qui est le fond.
    out[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, (v - min) / etendue)) : 0;
  }
  return out;
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
  dernierMoteur = 'cpu';
  const valeurs = def.calculer(t, p);
  // L'intervalle brut est conservé : le contraste se rejoue à l'affichage, sans
  // refaire le calcul. Sur le Sky-View Factor, le refaire à chaque mouvement du
  // curseur coûterait plusieurs secondes par cran.
  const base = def.etendue(valeurs, p);
  const [min, max] = etirer(base, def.ancrage, p.contraste);
  return {
    cle: def.cle, valeurs, base, ancrage: def.ancrage, min, max,
    palette: def.palette, duree: performance.now() - t0, moteur: dernierMoteur,
  };
}

return {
  preparer, calculer, etirer, valeurParPoint, COUCHES, ombrage, ombrageMulti, ombrageSimple, ombrageRGB, soleilParDefaut, soleilEstParDefaut, microRelief, svf, ouverture,
  balayerHorizons, flouBoite, gradients,
  /** Moteur du dernier calcul coûteux : 'gpu' ou 'cpu'. */
  moteur: () => dernierMoteur,
};
}
const RELIEF = fabriqueRelief();
