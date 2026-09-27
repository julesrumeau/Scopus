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
   * Les tracés d'une surface de vue (`t` : `W`, `H`, `pas`, `emprise`) et de
   * son SVF (`reglages.svf`, NaN hors données), en polylignes Lambert-93.
   * Pas encore écrite : le banc part de zéro (plan, Task 3).
   */
  function detecter(t, reglages = {}) {
    return { lignes: [], stats: {} };
  }

  return { longueur, decouper, mesurer, distanceCarree, detecter };
}
const TRACES = fabriqueTraces();
