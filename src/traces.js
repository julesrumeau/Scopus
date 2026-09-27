// Détection des tracés : tout ce qui dessine une ligne comme un chemin dans
// le relief — sentiers, chemins, routes, ruisseaux, sentes —, sans chercher à
// les distinguer. Conception : docs/superpowers/specs/2026-09-27-traces-design.md.
//
// Le détecteur ne lit que le Sky-View Factor ; la BD TOPO ne sert qu'à le
// noter (`mesurer`), comme un corrigé, dans le banc (tools/banc-traces.js).
//
// Écrit en fabrique : le worker du relief compose son source avec le texte de
// `fabriqueTraces`, qui ne doit donc fermer sur rien (voir relief-travailleur.js).

function fabriqueTraces() {
  // ── Géométrie des polylignes (Lambert-93, mètres) ──────────────────────────

  /** Longueur totale de polylignes `[[x, y], …]`. */
  function longueur(lignes) {
    let L = 0;
    for (const l of lignes) for (let i = 1; i < l.length; i++) L += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    return L;
  }

  /**
   * Les morceaux de polylignes dans l'emprise. Chaque segment est coupé
   * (Liang–Barsky) : une traversée sans sommet dedans est gardée ; les
   * morceaux qui se suivent sont recollés en une seule polyligne.
   */
  function decouper(lignes, e) {
    const out = [];
    for (const l of lignes) {
      let courant = null;
      for (let i = 1; i < l.length; i++) {
        const [x0, y0] = l[i - 1], [x1, y1] = l[i];
        const dx = x1 - x0, dy = y1 - y0;
        let t0 = 0, t1 = 1, dehors = false;
        for (const [p, q] of [[-dx, x0 - e.xmin], [dx, e.xmax - x0], [-dy, y0 - e.ymin], [dy, e.ymax - y0]]) {
          if (p === 0) { if (q < 0) dehors = true; continue; }
          const t = q / p;
          if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
        }
        if (dehors || t0 >= t1) { courant = null; continue; }
        const a = [x0 + t0 * dx, y0 + t0 * dy], b = [x0 + t1 * dx, y0 + t1 * dy];
        // Recollé si le morceau commence là où finit le précédent.
        if (courant && t0 === 0) courant.push(b);
        else { courant = [a, b]; out.push(courant); }
        if (t1 < 1) courant = null;
      }
    }
    return out;
  }

  // ── Mesure ─────────────────────────────────────────────────────────────────

  /**
   * Longueur de chaque jeu de lignes par case d'une grille (ligne 0 au sud) :
   * chaque segment est parcouru par pas d'un quart de case.
   */
  function rasteriser(lignes, e, pas, W, H) {
    const g = new Float32Array(W * H);
    const q = pas / 4;
    for (const l of lignes) {
      for (let i = 1; i < l.length; i++) {
        const [x0, y0] = l[i - 1], [x1, y1] = l[i];
        const L = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(1, Math.ceil(L / q));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const cx = Math.floor((x0 + t * (x1 - x0) - e.xmin) / pas), cy = Math.floor((y0 + t * (y1 - y0) - e.ymin) / pas);
          if (cx >= 0 && cy >= 0 && cx < W && cy < H) g[cy * W + cx] += L / n;
        }
      }
    }
    return g;
  }

  /**
   * Distance euclidienne exacte (au carré, en cases) de chaque case à la plus
   * proche case non nulle de `g` — Felzenszwalb & Huttenlocher (2012), deux
   * passes 1D.
   */
  function distanceCarree(g, W, H) {
    const INF = 1e20;
    const d = new Float64Array(W * H);
    for (let i = 0; i < W * H; i++) d[i] = g[i] > 0 ? 0 : INF;
    const n = Math.max(W, H);
    const f = new Float64Array(n), r = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const passe1D = (len) => {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) {
        while (z[k + 1] < q) k++;
        r[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
      }
    };
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) f[y] = d[y * W + x];
      passe1D(H);
      for (let y = 0; y < H; y++) d[y * W + x] = r[y];
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) f[x] = d[y * W + x];
      passe1D(W);
      for (let x = 0; x < W; x++) d[y * W + x] = r[x];
    }
    return d;
  }

  /**
   * La détection notée contre une référence, sur l'emprise : `rappel`, la part
   * de la longueur de référence à moins de `tolerance` mètres d'un tracé
   * détecté ; `precision`, la part de la longueur détectée à moins de
   * `tolerance` d'un tracé de référence (NaN sans rien de détecté). Les deux
   * jeux sont découpés sur l'emprise, puis comptés sur une grille de `pas`
   * mètres (1 m suffit pour des tolérances de quelques mètres).
   */
  function mesurer(detectes, reference, e, tolerance, pas = 1) {
    const W = Math.ceil((e.xmax - e.xmin) / pas), H = Math.ceil((e.ymax - e.ymin) / pas);
    const ref = rasteriser(decouper(reference, e), e, pas, W, H);
    const det = rasteriser(decouper(detectes, e), e, pas, W, H);
    const t2 = (tolerance / pas) ** 2;
    const couverte = (a, dVersB) => {
      let tout = 0, proche = 0;
      for (let i = 0; i < a.length; i++) {
        if (!a[i]) continue;
        tout += a[i];
        if (dVersB[i] <= t2) proche += a[i];
      }
      return { tout, proche };
    };
    const r = couverte(ref, distanceCarree(det, W, H));
    const p = couverte(det, distanceCarree(ref, W, H));
    return {
      rappel: r.tout ? r.proche / r.tout : NaN,
      precision: p.tout ? p.proche / p.tout : NaN,
      longueurReference: r.tout,
      longueurDetectee: p.tout,
    };
  }

  // ── Détection ──────────────────────────────────────────────────────────────

  /**
   * Flou gaussien séparable des seules cases connues (convolution normalisée) :
   * une case sans donnée ne prête rien, et reçoit la moyenne de ses voisines
   * connues (NaN si aucune à portée). `sigma` en cases.
   */
  function flouGauss(valeurs, W, H, sigma) {
    const r = Math.max(1, Math.ceil(3 * sigma));
    const k = new Float32Array(2 * r + 1);
    for (let i = -r; i <= r; i++) k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    const N = W * H;
    const v = new Float32Array(N), w = new Float32Array(N);
    for (let i = 0; i < N; i++) if (valeurs[i] === valeurs[i]) { v[i] = valeurs[i]; w[i] = 1; }
    const tv = new Float32Array(N), tw = new Float32Array(N);
    for (let y = 0; y < H; y++) {
      const l = y * W;
      for (let x = 0; x < W; x++) {
        let sv = 0, sw = 0;
        const a = Math.max(0, x - r), b = Math.min(W - 1, x + r);
        for (let xx = a; xx <= b; xx++) { const c = k[xx - x + r]; sv += c * v[l + xx]; sw += c * w[l + xx]; }
        tv[l + x] = sv; tw[l + x] = sw;
      }
    }
    const out = new Float32Array(N);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        let sv = 0, sw = 0;
        const a = Math.max(0, y - r), b = Math.min(H - 1, y + r);
        for (let yy = a; yy <= b; yy++) { const c = k[yy - y + r]; sv += c * tv[yy * W + x]; sw += c * tw[yy * W + x]; }
        out[y * W + x] = sw > 1e-3 ? sv / sw : NaN;
      }
    }
    return out;
  }

  /**
   * Réponse de ligne sombre (Frangi et al., 1998), maximum sur les échelles :
   * sur un creux allongé, la courbure est forte en travers (λ1 > 0) et nulle
   * le long (λ2 ≈ 0) ; sur une tache, forte dans les deux sens. Courbures
   * normalisées par σ², pour comparer les échelles.
   */
  function reponseLignes(svf, W, H, pas, p) {
    const N = W * H;
    const rep = new Float32Array(N);
    const b2 = 2 * p.beta * p.beta, c2 = 2 * p.contraste * p.contraste;
    for (const sM of p.echellesM) {
      const s = sM / pas;
      const f = flouGauss(svf, W, H, s);
      const n = s * s;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          const c = f[i];
          if (c !== c) continue;
          const dxx = (f[i + 1] - 2 * c + f[i - 1]) * n;
          const dyy = (f[i + W] - 2 * c + f[i - W]) * n;
          const dxy = (f[i + W + 1] - f[i + W - 1] - f[i - W + 1] + f[i - W - 1]) * 0.25 * n;
          if (!(dxx === dxx && dyy === dyy && dxy === dxy)) continue;
          const m = (dxx + dyy) / 2, d = Math.sqrt(((dxx - dyy) / 2) ** 2 + dxy * dxy);
          const l1 = m + d, l2 = m - d;   // l1 ≥ l2 : la plus forte courbure positive
          if (l1 <= 0 || Math.abs(l2) > l1) continue;
          const rb = l2 / l1, sc = l1 * l1 + l2 * l2;
          const v = Math.exp(-(rb * rb) / b2) * (1 - Math.exp(-sc / c2));
          if (v > rep[i]) rep[i] = v;
        }
      }
    }
    return rep;
  }

  /** Hystérésis : les germes au-dessus du seuil haut, étendus en 8-connexité au-dessus du bas. */
  function hysteresis(rep, valide, W, H, haut, bas) {
    const N = W * H;
    const m = new Uint8Array(N);
    const pile = [];
    for (let i = 0; i < N; i++) if (rep[i] >= haut && valide[i]) { m[i] = 1; pile.push(i); }
    while (pile.length) {
      const i = pile.pop();
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (!m[j] && valide[j] && rep[j] >= bas) { m[j] = 1; pile.push(j); }
      }
    }
    return m;
  }

  /** Amincissement de Zhang & Suen (1984) : un squelette d'un pixel, en place. */
  function amincir(m, W, H) {
    const aSupprimer = [];
    let change = true;
    while (change) {
      change = false;
      for (let etape = 0; etape < 2; etape++) {
        aSupprimer.length = 0;
        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            if (!m[i]) continue;
            const p2 = m[i - W], p3 = m[i - W + 1], p4 = m[i + 1], p5 = m[i + W + 1];
            const p6 = m[i + W], p7 = m[i + W - 1], p8 = m[i - 1], p9 = m[i - W - 1];
            const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (b < 2 || b > 6) continue;
            const a = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
            if (a !== 1) continue;
            if (etape === 0 ? (p2 && p4 && p6) || (p4 && p6 && p8) : (p2 && p4 && p8) || (p2 && p6 && p8)) continue;
            aSupprimer.push(i);
          }
        }
        for (const i of aSupprimer) m[i] = 0;
        if (aSupprimer.length) change = true;
      }
    }
    return m;
  }

  /**
   * Nettoyage des escaliers : là où le trait est en biais, l'amincissement
   * laisse des pixels redondants (un escalier de deux pixels d'épaisseur),
   * chacun à trois voisins, donc un faux carrefour. Un pixel est retiré si
   * ses voisins restent reliés entre eux sans lui — une seule composante
   * 8-connexe dans son anneau — et qu'il n'est pas un bout (≥ 2 voisins).
   */
  function nettoyerEscaliers(m, W, H) {
    // Anneau dans l'ordre N, NE, E, SE, S, SO, O, NO.
    const D = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1];
    const parent = [0, 1, 2, 3, 4, 5, 6, 7];
    const racine = (i) => { while (parent[i] !== i) i = parent[i]; return i; };
    let change = true;
    while (change) {
      change = false;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (!m[i]) continue;
          const v = D.map((d) => m[i + d]);
          const n = v.reduce((a, b) => a + b, 0);
          if (n < 2) continue;
          for (let k = 0; k < 8; k++) parent[k] = k;
          const unir = (a, b) => { if (v[a] && v[b]) parent[racine(a)] = racine(b); };
          for (let k = 0; k < 8; k++) unir(k, (k + 1) % 8);                  // voisins dans l'anneau
          for (let k = 0; k < 8; k += 2) unir(k, (k + 2) % 8);               // N et E se touchent en diagonale, etc.
          const composantes = new Set();
          for (let k = 0; k < 8; k++) if (v[k]) composantes.add(racine(k));
          if (composantes.size === 1) { m[i] = 0; change = true; }
        }
      }
    }
    return m;
  }

  /**
   * Le squelette en chaînes de pixels : coupées aux bouts et aux carrefours
   * (voisins ≠ 2), plus les boucles isolées. Indices de cases.
   */
  function chaines(m, W, H) {
    const V = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
    const voisins = (i) => {
      const x = i % W, out = [];
      for (const d of V) {
        const j = i + d, xj = j % W;
        if (j < 0 || j >= W * H || Math.abs(xj - x) > 1 || !m[j]) continue;
        out.push(j);
      }
      return out;
    };
    const vu = new Uint8Array(W * H);   // arêtes parcourues, marquées sur la case d'arrivée
    const noeud = (i) => voisins(i).length !== 2;
    const out = [];
    const suivre = (depart, suivant) => {
      const c = [depart, suivant];
      let prec = depart, cour = suivant;
      while (!noeud(cour)) {
        vu[cour] = 1;
        const n = voisins(cour).filter((j) => j !== prec);
        if (!n.length || (vu[n[0]] && !noeud(n[0]))) break;
        prec = cour; cour = n[0]; c.push(cour);
        if (cour === depart) break;
      }
      return c;
    };
    for (let i = 0; i < W * H; i++) {
      if (!m[i] || !noeud(i)) continue;
      for (const j of voisins(i)) {
        if (vu[j] && !noeud(j)) continue;
        if (noeud(j) && j < i) continue;   // arête entre deux nœuds : une fois
        out.push(suivre(i, j));
      }
    }
    for (let i = 0; i < W * H; i++) if (m[i] && !vu[i] && !noeud(i)) {   // boucles sans nœud
      const n = voisins(i);
      vu[i] = 1;
      out.push([i, ...suivre(i, n[0]).slice(1)]);
    }
    return out;
  }

  /** Douglas–Peucker, tolérance en mètres. */
  function simplifier(l, tol) {
    if (l.length < 3) return l;
    const garde = new Uint8Array(l.length);
    garde[0] = garde[l.length - 1] = 1;
    const pile = [[0, l.length - 1]];
    while (pile.length) {
      const [a, b] = pile.pop();
      const [ax, ay] = l[a], [bx, by] = l[b];
      const L = Math.hypot(bx - ax, by - ay) || 1e-9;
      let dmax = 0, k = -1;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((bx - ax) * (ay - l[i][1]) - (ax - l[i][0]) * (by - ay)) / L;
        if (d > dmax) { dmax = d; k = i; }
      }
      if (dmax > tol) { garde[k] = 1; pile.push([a, k], [k, b]); }
    }
    return l.filter((_, i) => garde[i]);
  }

  /** Direction sortante d'un bout de polyligne, sur ses `dM` derniers mètres. */
  function directionBout(l, auDebut, dM) {
    const pts = auDebut ? l : [...l].reverse();
    const [x0, y0] = pts[0];
    let k = 1;
    while (k < pts.length - 1 && Math.hypot(pts[k][0] - x0, pts[k][1] - y0) < dM) k++;
    const dx = x0 - pts[k][0], dy = y0 - pts[k][1];
    const L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L];
  }

  /**
   * Raccorde les bouts proches et alignés, du plus proche au plus lointain :
   * un chemin coupé par un trou sans sol, un arbre tombé ou un carrefour reste
   * un seul tracé si ses deux bouts se regardent.
   */
  function raccorder(lignes, dMax, angleMax) {
    const cosMax = Math.cos((angleMax * Math.PI) / 180);
    // Les bouts : 2k le début de la ligne k, 2k + 1 sa fin. Une grille de
    // `dMax` de côté ne compare que les bouts voisins.
    const n = lignes.length;
    const bout = (b) => (b & 1 ? lignes[b >> 1][lignes[b >> 1].length - 1] : lignes[b >> 1][0]);
    const dir = new Float64Array(4 * n);
    for (let b = 0; b < 2 * n; b++) {
      const [dx, dy] = directionBout(lignes[b >> 1], !(b & 1), 5);
      dir[2 * b] = dx; dir[2 * b + 1] = dy;
    }
    const cases = new Map();
    const cle = (x, y) => `${Math.floor(x / dMax)},${Math.floor(y / dMax)}`;
    for (let b = 0; b < 2 * n; b++) {
      const [x, y] = bout(b);
      const k = cle(x, y);
      if (!cases.has(k)) cases.set(k, []);
      cases.get(k).push(b);
    }
    const paires = [];
    for (let a = 0; a < 2 * n; a++) {
      const [x, y] = bout(a);
      const cx = Math.floor(x / dMax), cy = Math.floor(y / dMax);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        for (const b of cases.get(`${cx + i},${cy + j}`) || []) {
          if (b <= a || (b >> 1) === (a >> 1)) continue;
          const [bx, by] = bout(b);
          const d = Math.hypot(bx - x, by - y);
          if (d > dMax) continue;
          const ax_ = dir[2 * a], ay_ = dir[2 * a + 1], bx_ = dir[2 * b], by_ = dir[2 * b + 1];
          // Les deux bouts se font face, et l'écart suit leur direction.
          if (-(ax_ * bx_ + ay_ * by_) < cosMax) continue;
          if (d > 0.5) {
            const ux = (bx - x) / d, uy = (by - y) / d;
            if (ax_ * ux + ay_ * uy < cosMax || -(bx_ * ux + by_ * uy) < cosMax) continue;
          }
          paires.push([d, a, b]);
        }
      }
    }
    paires.sort((u, v) => u[0] - v[0]);
    // Fusion gloutonne, du plus proche au plus lointain. Chaque ligne fusionnée
    // devient une chaîne : `suite[b]` relie un bout à celui qu'on lui a
    // raccordé ; un bout déjà pris ne l'est pas deux fois, et on refuse de
    // refermer une chaîne sur elle-même.
    const suite = new Int32Array(2 * n).fill(-1);
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const racine = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (const [, a, b] of paires) {
      if (suite[a] >= 0 || suite[b] >= 0) continue;
      const ra = racine(a >> 1), rb = racine(b >> 1);
      if (ra === rb) continue;
      suite[a] = b; suite[b] = a;
      parent[ra] = rb;
    }
    // Relecture des chaînes : partir d'un bout libre, traverser la ligne,
    // sauter au bout raccordé, et ainsi de suite.
    const faite = new Uint8Array(n), out = [];
    for (let k = 0; k < n; k++) {
      if (faite[k]) continue;
      // Remonter jusqu'à un bout libre de la chaîne de k.
      let b = 2 * k;
      for (let garde = 0; suite[b] >= 0 && garde <= 2 * n; garde++) b = suite[b] ^ 1;
      const l = [];
      for (;;) {
        const k2 = b >> 1;
        faite[k2] = 1;
        const pts = b & 1 ? [...lignes[k2]].reverse() : lignes[k2];
        l.push(...pts);
        const fin = b ^ 1;
        if (suite[fin] < 0) break;
        b = suite[fin];
      }
      out.push(l);
    }
    return out;
  }

  /**
   * Les tracés d'une surface de vue (`t` : `W`, `H`, `pas`, `emprise`,
   * `valide`) et de son SVF (`reglages.svf`, NaN hors données), en polylignes
   * Lambert-93. Réglages : CONFIG.traces, surchargés par `reglages`.
   */
  function detecter(t, reglages = {}) {
    const p = { ...CONFIG.traces, ...reglages };
    const { W, H, pas, emprise } = t;
    const valide = t.valide || new Uint8Array(W * H).fill(1);
    const d0 = Date.now();
    const rep = reponseLignes(p.svf, W, H, pas, p);
    const d1 = Date.now();
    const m = nettoyerEscaliers(amincir(hysteresis(rep, valide, W, H, p.seuilHaut, p.seuilBas), W, H), W, H);
    const d2 = Date.now();
    const versL93 = (i) => { const x = i % W; return [emprise.xmin + (x + 0.5) * pas, emprise.ymin + ((i - x) / W + 0.5) * pas]; };
    // Élagage des barbules : l'amincissement d'un trait épais laisse de
    // petites branches d'un ou deux pixels sur ses bords, chacune un carrefour
    // qui coupe le tracé. Une chaîne courte qui finit en bout libre d'un côté
    // et sur un carrefour de l'autre en est une.
    const degre = (i) => {
      const x = i % W;
      let n = 0;
      for (const dd of [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1]) {
        const j = i + dd;
        if (j >= 0 && j < W * H && Math.abs((j % W) - x) <= 1 && m[j]) n++;
      }
      return n;
    };
    const cs = chaines(m, W, H).filter((c) => {
      const libres = (degre(c[0]) === 1) + (degre(c[c.length - 1]) === 1);
      return !(libres === 1 && c.length * pas < p.barbuleM);
    });
    const brutes = cs.map((c) => simplifier(c.map(versL93), pas)).filter((l) => l.length >= 2);
    const raccordees = raccorder(brutes, p.raccordM, p.angleMaxDeg);
    const lignes = raccordees.filter((l) => {
      const L = longueur([l]);
      const corde = Math.hypot(l[l.length - 1][0] - l[0][0], l[l.length - 1][1] - l[0][1]);
      return L >= p.longueurMinM && L <= p.compaciteMax * Math.max(corde, 1e-9);
    });
    return {
      lignes,
      stats: { chaines: brutes.length, raccordees: raccordees.length, retenues: lignes.length, dureeReponse: d1 - d0, dureeSquelette: d2 - d1, dureeTotale: Date.now() - d0 },
    };
  }

  return { longueur, decouper, mesurer, distanceCarree, detecter };
}
const TRACES = fabriqueTraces();
