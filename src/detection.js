// Pipeline de détection : grilles → taches candidates → structures retenues.
//
// Aucun apprentissage : uniquement des règles géométriques explicites, chacune
// motivée par une propriété observable du signal. Chaque candidat conserve le
// détail de ses mesures, de sorte qu'un rejet soit toujours explicable — c'est
// ce qui permet de régler les seuils au lieu de les subir.
//
// Le signal de base, vérifié empiriquement sur des ruines connues d'Ariège :
// une structure en pierre effondrée n'apparaît pas comme un trou dans la classe
// « sol », mais comme une zone classée « non classé » posée sur un fond par
// ailleurs plat. Le trou dans le sol existe aussi, mais c'est un indice
// secondaire, pas le déclencheur.

/**
 * @param {object} g grilles issues de `rasteriser`
 * @param {object} [reglages] surcharge de `CONFIG.detection`
 * @returns {{candidats:Array, masque:Uint8Array, signal:object, stats:object}}
 */
function detecter(g, reglages = {}) {
  const p = { ...CONFIG.detection, ...reglages };
  const { W, H, pas } = g;
  const surfaceCellule = pas * pas;
  const sig = RASTER.signal(g, p.inclureBati);

  // ── 1. Masque cellule à cellule ────────────────────────────────────────────
  //
  // Trois conditions simultanées. La condition de pente est ce qui sépare le
  // bâti du cas falaise : une rupture de falaise produit exactement la même
  // signature « non classé sur fond de sol », mais sur un terrain qui n'est
  // justement pas plat.
  const masque = new Uint8Array(W * H);
  const rejets = { hauteur: 0, pente: 0, aucunSignal: 0, retenues: 0 };

  for (let i = 0; i < W * H; i++) {
    if (!(sig.nb[i] > 0)) { rejets.aucunSignal++; continue; }
    const h = sig.hauteur[i];
    if (!(h >= p.hauteurMin && h <= p.hauteurMax)) { rejets.hauteur++; continue; }
    if (g.pente[i] > p.penteMaxDeg) { rejets.pente++; continue; }
    masque[i] = 1;
    rejets.retenues++;
  }

  // ── 2. Morphologie : fermeture PUIS ouverture ──────────────────────────────
  //
  // L'ordre n'est pas interchangeable, et c'est contre-intuitif.
  //
  // Le LiDAR HD porte ~10 points/m². À 25 cm de pas — la résolution qu'exige la
  // lecture d'un mur de 50 cm — une cellule reçoit 0,6 point en moyenne : le
  // masque d'une structure bien réelle est un semis troué, pas une tache
  // pleine. Une ouverture appliquée d'abord éroderait ce semis jusqu'à le faire
  // disparaître entièrement (vérifié : structure de 6 × 4 m totalement perdue).
  //
  // La fermeture rebouche donc d'abord les trous d'échantillonnage et rend la
  // tache compacte ; l'ouverture qui suit peut alors retirer le bruit, qui lui
  // est resté isolé — une cellule seule survit à la fermeture sans grossir.
  let m = masque;
  if (p.rayonFermeture > 0) {
    m = eroder(dilater(m, W, H, p.rayonFermeture), W, H, p.rayonFermeture);
  }
  if (p.rayonOuverture > 0) {
    m = dilater(eroder(m, W, H, p.rayonOuverture), W, H, p.rayonOuverture);
  }

  // ── 3. Composantes connexes ────────────────────────────────────────────────
  const taches = etiqueter(m, W, H);

  // ── 4. Qualification ───────────────────────────────────────────────────────
  const candidats = [];
  const motifs = { surface: 0, forme: 0, elongation: 0, pente: 0, composition: 0, hauteur: 0 };

  for (const tache of taches) {
    const surface = tache.cellules.length * surfaceCellule;
    if (surface < p.surfaceMinM2 || surface > p.surfaceMaxM2) { motifs.surface++; continue; }

    const mes = mesurer(tache, g, sig, surfaceCellule);

    // Pente moyenne du *terrain* sous la tache, et pente maximale rencontrée.
    // Une falaise franchit largement la seconde même quand la première reste
    // basse, parce que la rupture est concentrée sur quelques cellules.
    if (mes.penteMoy > p.penteMaxDeg || mes.penteMax > p.penteLocaleMaxDeg) { motifs.pente++; continue; }

    if (mes.partNonClasse < p.partNonClasseMin) { motifs.composition++; continue; }
    if (mes.ecartTypeHauteur > p.ecartTypeHauteurMax) { motifs.hauteur++; continue; }

    const rect = rectangleMinimal(contour(tache, g));
    const rectangularite = rect.surface > 0 ? Math.min(1, surface / rect.surface) : 0;
    const elongation = rect.largeur > 0 ? rect.longueur / rect.largeur : Infinity;

    if (rectangularite < p.rectangulariteMin) { motifs.forme++; continue; }
    if (elongation > p.elongationMax) { motifs.elongation++; continue; }

    candidats.push(construire(tache, g, mes, rect, surface, rectangularite, elongation));
  }

  // L'identifiant suit l'ordre de découverte, le rang l'ordre de score : le
  // premier sert à retrouver un candidat après un tri, le second à l'annoncer.
  candidats.forEach((c, i) => { c.id = i + 1; });
  for (const c of candidats) c.score = noter(c, p);
  candidats.sort((a, b) => b.score - a.score);
  candidats.forEach((c, i) => { c.rang = i + 1; });

  return {
    candidats,
    masque: m,
    signal: sig,
    stats: {
      cellules: W * H,
      cellulesRetenues: rejets.retenues,
      tachesBrutes: taches.length,
      retenus: candidats.length,
      rejets: motifs,
      pas,
    },
  };
}

/** Assemble le candidat, seul objet que le reste de l'application connaisse. */
function construire(tache, g, mes, rect, surface, rectangularite, elongation) {
  const centre = RASTER.centreCellule(g, mes.cx, mes.cy);
  const gps = PROJ.versWGS84(centre.x, centre.y);
  return {
    id: 0,
    x: centre.x, y: centre.y,
    lon: gps.lon, lat: gps.lat,
    altitude: mes.altitudeSol,
    surface,
    longueur: rect.longueur,
    largeur: rect.largeur,
    azimut: rect.azimut,
    rectangularite,
    elongation,
    hauteurMoy: mes.hauteurMoy,
    hauteurMax: mes.hauteurMax,
    ecartTypeHauteur: mes.ecartTypeHauteur,
    penteMoy: mes.penteMoy,
    penteMax: mes.penteMax,
    partNonClasse: mes.partNonClasse,
    partTrouSol: mes.partTrouSol,
    cellules: tache.cellules,
    empriseCellules: tache.bbox,
    voie: 'classement',
    score: 0,
    dejaRepertorie: false,
    batimentProche: null,
  };
}

/**
 * Mesure un ensemble de cellules **sans le filtrer**, et rend un candidat.
 *
 * C'est le point d'entrée de la voie par la forme : `lignes.js` désigne une
 * emprise que la voie par classement n'aurait jamais vue — une ruine que l'IGN
 * a rangée en « sol » ne produit aucun signal — mais tout ce qui vient après,
 * de la fiche de résultat aux exports en passant par le rapprochement BD TOPO,
 * attend le même objet. On mesure donc les deux voies avec le même instrument,
 * quitte à ce que certaines mesures soient nulles : une structure classée sol a
 * bien une hauteur de signal de zéro, et c'est une information, pas un défaut.
 *
 * Aucun filtre n'est appliqué : celui qui appelle a déjà décidé de retenir ces
 * cellules, avec ses propres critères.
 */
function qualifier(cellules, g, sig) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const c of cellules) {
    const x = c % g.W, y = (c / g.W) | 0;
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  const tache = { cellules, bbox: { xmin, xmax, ymin, ymax } };
  const surfaceCellule = g.pas * g.pas;
  const mes = mesurer(tache, g, sig, surfaceCellule);
  const rect = rectangleMinimal(contour(tache, g));
  const surface = cellules.length * surfaceCellule;
  const rectangularite = rect.surface > 0 ? Math.min(1, surface / rect.surface) : 0;
  const elongation = rect.largeur > 0 ? rect.longueur / rect.largeur : Infinity;
  return construire(tache, g, mes, rect, surface, rectangularite, elongation);
}

/**
 * Score de vraisemblance, dans [0, 1].
 *
 * Pondération assumée plutôt qu'ajustée sur un jeu étiqueté — il n'y en a pas.
 *
 * Le trou dans le sol et la régularité de forme dominent. Le premier est le
 * plus physique des indices disponibles : une masse de pierre est opaque au
 * laser et ne laisse aucun retour sol sous elle, là où un couvert végétal en
 * laisse toujours passer. Le second ordonne les formes sans prétendre trancher
 * (cf. `rectangleMinimal` : un disque y marque 0,78, un rectangle 0,98).
 */
function noter(c, p) {
  const entre = (v, a, b) => Math.max(0, Math.min(1, (v - a) / (b - a)));

  const forme = entre(c.rectangularite, p.rectangulariteMin, 0.95);
  const trou = entre(c.partTrouSol, 0.05, 0.6);

  const purete = entre(c.partNonClasse, p.partNonClasseMin, 0.9);
  const platitude = 1 - entre(c.penteMoy, 0, p.penteMaxDeg);
  const coherence = 1 - entre(c.ecartTypeHauteur, 0.2, p.ecartTypeHauteurMax);
  // Une cabane fait 6 à 30 m² ; en dessous on est dans le tas de pierres, au
  // dessus dans la bergerie ou le hangar — moins probable pour du « hors carte ».
  const taille = c.surface < 6 ? entre(c.surface, p.surfaceMinM2, 6)
    : c.surface > 40 ? 1 - 0.5 * entre(c.surface, 40, p.surfaceMaxM2) : 1;

  return 0.28 * trou + 0.24 * forme + 0.16 * purete
       + 0.14 * platitude + 0.10 * coherence + 0.08 * taille;
}

// ── Mesures agrégées sur une tache ──────────────────────────────────────────

function mesurer(tache, g, sig, surfaceCellule) {
  let sh = 0, sh2 = 0, hMax = -Infinity, nH = 0;
  let sPente = 0, penteMax = 0;
  let nc = 0, total = 0, trous = 0;
  let sx = 0, sy = 0, sSol = 0;

  for (const c of tache.cellules) {
    // La fermeture morphologique ajoute des cellules qui n'ont aucun point
    // porteur : elles appartiennent bien à la structure (elles bouchent un
    // trou du mur), mais leur hauteur vaut NaN. Elles comptent donc dans la
    // surface et la forme, jamais dans les statistiques de hauteur — sinon un
    // seul NaN contaminerait moyenne, écart-type et score.
    if (sig.nb[c] > 0) {
      const h = sig.hauteur[c];
      sh += h; sh2 += h * h; nH++;
      if (h > hMax) hMax = h;
    }

    sPente += g.pente[c];
    if (g.pente[c] > penteMax) penteMax = g.pente[c];

    nc += sig.nb[c];
    total += g.totalN[c];
    if (g.solN[c] === 0) trous++;

    sx += c % g.W;
    sy += (c / g.W) | 0;
    sSol += g.mnt[c];
  }

  const n = tache.cellules.length;
  const moy = nH ? sh / nH : 0;

  return {
    hauteurMoy: moy,
    hauteurMax: nH ? hMax : 0,
    ecartTypeHauteur: nH ? Math.sqrt(Math.max(0, sh2 / nH - moy * moy)) : 0,
    penteMoy: sPente / n,
    penteMax,
    partNonClasse: total > 0 ? nc / total : 0,
    partTrouSol: trous / n,
    cx: sx / n,
    cy: sy / n,
    // Altitude **absolue**, au-dessus du niveau de la mer (IGN69).
    //
    // Les grilles travaillent en relatif par rapport à `origine[2]`, le bas de
    // la dalle : c'est ce qui garde les coordonnées petites et précises en
    // Float32. Mais tout ce qui sort d'ici veut une altitude vraie — l'élévation
    // d'un point GPX, la caméra de Google Earth, la hauteur des boîtes dans le
    // nuage 3D. On remet donc l'origine ici, une fois pour toutes, plutôt que de
    // laisser chaque consommateur s'en charger — ce qu'aucun ne faisait
    // correctement : les boîtes 3D se dessinaient 1 500 m sous les points.
    altitudeSol: g.origine[2] + sSol / n,
    surface: n * surfaceCellule,
  };
}

// ── Morphologie ─────────────────────────────────────────────────────────────
//
// Séparables : l'élément structurant est un carré, donc une passe horizontale
// suivie d'une passe verticale équivaut à la fenêtre 2D, en O(W·H·r) au lieu de
// O(W·H·r²).

function morpho(src, W, H, r, estDilatation) {
  const neutre = estDilatation ? 0 : 1;
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = neutre;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        const s = (xx < 0 || xx >= W) ? neutre : src[y * W + xx];
        v = estDilatation ? (v | s) : (v & s);
      }
      tmp[y * W + x] = v;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = neutre;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        const s = (yy < 0 || yy >= H) ? neutre : tmp[yy * W + x];
        v = estDilatation ? (v | s) : (v & s);
      }
      out[y * W + x] = v;
    }
  }
  return out;
}

const dilater = (s, W, H, r) => morpho(s, W, H, r, true);
const eroder = (s, W, H, r) => morpho(s, W, H, r, false);

// ── Composantes connexes ────────────────────────────────────────────────────
//
// Remplissage par diffusion, 8-connexité, avec une pile explicite. La récursion
// dépasserait la pile d'appels dès quelques milliers de cellules.

function etiqueter(masque, W, H) {
  const vu = new Uint8Array(W * H);
  const taches = [];
  const pile = new Int32Array(W * H);

  for (let depart = 0; depart < W * H; depart++) {
    if (!masque[depart] || vu[depart]) continue;

    let sommet = 0;
    pile[sommet++] = depart;
    vu[depart] = 1;
    const cellules = [];
    let xmin = W, xmax = -1, ymin = H, ymax = -1;

    while (sommet > 0) {
      const c = pile[--sommet];
      cellules.push(c);
      const x = c % W, y = (c / W) | 0;
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (y < ymin) ymin = y; if (y > ymax) ymax = y;

      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const v = yy * W + xx;
          if (masque[v] && !vu[v]) { vu[v] = 1; pile[sommet++] = v; }
        }
      }
    }
    taches.push({ cellules, bbox: { xmin, xmax, ymin, ymax } });
  }
  return taches;
}

// ── Forme ───────────────────────────────────────────────────────────────────

/**
 * Sommets des cellules de bord, en mètres relatifs au coin sud-ouest de la zone.
 *
 * Les quatre coins et non le centre : sur une tache de 20 cellules, l'enveloppe
 * des centres sous-estime la surface d'une demi-cellule tout autour, ce qui
 * gonflerait artificiellement la rectangularité des petits objets.
 */
function contour(tache, g) {
  const dansTache = new Set(tache.cellules);
  const pts = [];

  for (const c of tache.cellules) {
    const x = c % g.W, y = (c / g.W) | 0;
    const bord = x === 0 || x === g.W - 1 || y === 0 || y === g.H - 1
      || !dansTache.has(c - 1) || !dansTache.has(c + 1)
      || !dansTache.has(c - g.W) || !dansTache.has(c + g.W);
    if (!bord) continue;
    const px = x * g.pas, py = y * g.pas;
    pts.push([px, py], [px + g.pas, py], [px, py + g.pas], [px + g.pas, py + g.pas]);
  }
  return enveloppeConvexe(pts);
}

/** Enveloppe convexe — chaîne monotone d'Andrew, sens trigonométrique. */
function enveloppeConvexe(pts) {
  if (pts.length < 3) return pts;
  const t = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const croix = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const bas = [];
  for (const p of t) {
    while (bas.length >= 2 && croix(bas[bas.length - 2], bas[bas.length - 1], p) <= 0) bas.pop();
    bas.push(p);
  }
  const haut = [];
  for (let i = t.length - 1; i >= 0; i--) {
    const p = t[i];
    while (haut.length >= 2 && croix(haut[haut.length - 2], haut[haut.length - 1], p) <= 0) haut.pop();
    haut.push(p);
  }
  bas.pop(); haut.pop();
  return bas.concat(haut);
}

/**
 * Rectangle englobant d'aire minimale, par compas tournant.
 *
 * Repose sur le théorème de Freeman-Shapira : un tel rectangle a
 * nécessairement un côté aligné sur une arête de l'enveloppe convexe. Il suffit
 * donc de tester les |arêtes| orientations, sans optimisation continue.
 *
 * Attention à ce que mesure vraiment la rectangularité qui en découle : c'est un
 * filtre de régularité, **pas** un test « rectangle ou non ». Un disque la
 * sature à π/4 ≈ 0,785 par construction, à peine sous un rectangle parfait, et
 * bien au-dessus du seuil retenu. Valeurs mesurées sur cas synthétiques :
 *
 *   rectangle 6 × 4 m ....... 0,98
 *   disque r = 2,6 m ........ 0,78
 *   forme en L .............. 0,60
 *
 * C'est délibéré : les orris d'Ariège — cabanes d'estive en pierre sèche, la
 * cible même de cet outil — sont fréquemment ronds ou ovales. Un seuil placé
 * au-dessus de 0,785 pour « ne garder que les rectangles » les éliminerait
 * tous, et éliminerait aussi la cabane du plateau de Beille qui mesure 0,67 sur
 * données réelles. Le critère écarte donc les taches franchement irrégulières
 * (déblais, éboulis, formes en L), et le classement final se joue surtout sur
 * l'opacité au laser (`partTrouSol`) et la cohérence de hauteur.
 */
function rectangleMinimal(enveloppe) {
  if (enveloppe.length < 3) return { surface: 0, longueur: 0, largeur: 0, azimut: 0 };

  let meilleur = { surface: Infinity, longueur: 0, largeur: 0, azimut: 0 };

  for (let i = 0; i < enveloppe.length; i++) {
    const a = enveloppe[i];
    const b = enveloppe[(i + 1) % enveloppe.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;

    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const pt of enveloppe) {
      const pu = pt[0] * ux + pt[1] * uy;
      const pv = -pt[0] * uy + pt[1] * ux;
      if (pu < uMin) uMin = pu; if (pu > uMax) uMax = pu;
      if (pv < vMin) vMin = pv; if (pv > vMax) vMax = pv;
    }

    const cu = uMax - uMin, cv = vMax - vMin;
    const surface = cu * cv;
    if (surface < meilleur.surface) {
      // Azimut du grand côté, en degrés depuis le nord, sens horaire.
      const grandEstU = cu >= cv;
      const ax = grandEstU ? ux : -uy;
      const ay = grandEstU ? uy : ux;
      let azimut = Math.atan2(ax, ay) * 180 / Math.PI;
      if (azimut < 0) azimut += 180;
      meilleur = {
        surface,
        longueur: Math.max(cu, cv),
        largeur: Math.min(cu, cv),
        azimut,
      };
    }
  }
  return meilleur;
}

const DETECTION = { detecter, qualifier };
