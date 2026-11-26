// Le sol prolongé sous les trous, pour les hauteurs de la 3D. La hauteur d'un point est son altitude moins celle du sol de sa case ; or
// sous un grand toit, sous une canopée fermée ou sur l'eau, aucun retour sol : la surface ne comble que 3 m, et au-delà la hauteur valait 0,
// le point sortait de la couleur du sol alors qu'on n'en savait rien (45 % des bâtiments d'un centre-ville). Ici, le sol connu est
// prolongé jusqu'à un rayon fixe (30 m) ; plus loin il reste inconnu, et la 3D le peint d'une couleur à part. Pur : aucun DOM.
// Écrit en `function fabriqueSolEstime()` : son texte part tel quel dans le worker du relief (relief-travailleur.js).

function fabriqueSolEstime() {
  /** Valeur sentinelle d'une hauteur inconnue dans le tampon des hauteurs de la 3D (le shader la reconnaît : `h < -500`). */
  const INCONNUE = -1000;
  const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];
  const SANS = 65535;

  /**
   * L'altitude du sol de chaque case d'une grille `{ W, H, pas, mnt, valide }` : celle du terrain là où le sol est connu ; ailleurs, la
   * moyenne des sols connus les plus proches dans huit directions, pesés en 1/d² (d en mètres), jusqu'à `rayonM` ; sinon `NaN`.
   * `null` si la grille dépasse `maxCases` (par défaut 12 millions : on ne prolonge pas, tout reste inconnu).
   */
  function prolonger(g, rayonM, { maxCases = 12e6 } = {}) {
    const { W, H, pas, mnt, valide } = g;
    const N = W * H;
    if (N > maxCases) return null;
    const somme = new Float32Array(N), poids = new Float32Array(N);
    const pasCases = new Uint16Array(N), val = new Float32Array(N);
    for (const [dx, dy] of DIRECTIONS) {
      const longueur = pas * Math.hypot(dx, dy), maxPas = Math.floor(rayonM / longueur);
      const ys = dy < 0 ? [H - 1, -1, -1] : [0, H, 1], xs = dx < 0 ? [W - 1, -1, -1] : [0, W, 1];
      for (let y = ys[0]; y !== ys[1]; y += ys[2]) {
        for (let x = xs[0]; x !== xs[1]; x += xs[2]) {
          const i = y * W + x;
          if (valide[i]) { pasCases[i] = 0; val[i] = mnt[i]; continue; }
          const px = x - dx, py = y - dy;
          if (px < 0 || py < 0 || px >= W || py >= H || pasCases[py * W + px] === SANS) { pasCases[i] = SANS; continue; }
          const p = py * W + px;
          pasCases[i] = pasCases[p] + 1;
          val[i] = val[p];
          if (pasCases[i] <= maxPas) { const d = pasCases[i] * longueur; poids[i] += 1 / (d * d); somme[i] += val[i] / (d * d); }
        }
      }
    }
    const sol = new Float32Array(N);
    for (let i = 0; i < N; i++) sol[i] = valide[i] ? mnt[i] : poids[i] > 0 ? somme[i] / poids[i] : NaN;
    return sol;
  }

  return { inconnue: INCONNUE, prolonger };
}
const SOL_ESTIME = fabriqueSolEstime();
