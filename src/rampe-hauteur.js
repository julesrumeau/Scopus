// La rampe de couleur « Hauteur/sol » de la 3D. Sa borne haute se règle (5 à 50 m : un forestier lit des peuplements de 0 à 40 m, la
// rampe d'origine saturait à 8 m), et elle a deux modes : un **dégradé** (sombre, jaune, rouge) ou un **seuil** (jaune sous la valeur,
// rouge au-delà, sans transition : on cherche la hauteur où il ne reste plus de rouge). Pur : aucun DOM.
//
// Le shader ne connaît pas la formule : il lit une **texture de 1024 couleurs** (0 à 50 m, 5 cm par case) que ce module remplit
// (`texels`). Dégradé et seuil ne diffèrent que par ce remplissage, et un éditeur de paliers n'aurait qu'à remplir la même texture.

const RAMPE_HAUTEUR = (() => {
  const DEFAUT = 8, MIN = 5, MAX = 50, LARGEUR = 1024, PORTEE = MAX;
  const MODES = ['degrade', 'seuil'];
  // Le jaune est à 35 % de la borne en dégradé, le rouge à la borne. En seuil, « sol » = moins de 50 cm au-dessus du sol.
  const PART_JAUNE = 0.35, SOL_SEUIL_M = 0.5;
  const COULEURS = { sol: [0.18, 0.19, 0.22], jaune: [0.90, 0.72, 0.28], rouge: [0.95, 0.35, 0.25] };

  /** La borne en mètres entiers dans [5, 50] ; le défaut si ce n'est pas un nombre. */
  function borne(v) {
    const x = typeof v === 'number' ? v : NaN;
    return Number.isFinite(x) ? Math.min(MAX, Math.max(MIN, Math.round(x))) : DEFAUT;
  }

  /** `'seuil'` ou `'degrade'` (le défaut pour tout le reste). */
  const mode = (m) => (MODES.includes(m) ? m : 'degrade');

  const mixer = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);

  /** La couleur (RVB, 0 à 1) d'un point à `h` mètres au-dessus du sol. */
  function couleur(h, m, hmax) {
    const { sol, jaune, rouge } = COULEURS;
    if (mode(m) === 'seuil') return h < SOL_SEUIL_M ? sol : h < borne(hmax) ? jaune : rouge;
    const t = Math.min(1, Math.max(0, h / borne(hmax)));
    return t < PART_JAUNE ? mixer(sol, jaune, t / PART_JAUNE) : mixer(jaune, rouge, (t - PART_JAUNE) / (1 - PART_JAUNE));
  }

  /** La texture de la rampe : 1024 couleurs RGBA (8 bits) de 0 à 50 m ; au-delà, la dernière. */
  function texels(m, hmax) {
    const px = new Uint8Array(LARGEUR * 4);
    for (let i = 0; i < LARGEUR; i++) {
      couleur((i + 0.5) / LARGEUR * PORTEE, m, hmax).forEach((v, k) => { px[i * 4 + k] = Math.round(v * 255); });
      px[i * 4 + 3] = 255;
    }
    return px;
  }

  /** La phrase de légende de la rampe pour ce mode et cette borne. */
  function legende(h, m) {
    const b = borne(h);
    return mode(m) === 'seuil' ? `Sombre = sol · jaune = moins de ${b} m · rouge = ${b} m et plus`
      : `Sombre = sol · jaune = ${Math.round(b * PART_JAUNE)} m · rouge = ${b} m et plus`;
  }

  return { defaut: DEFAUT, min: MIN, max: MAX, largeur: LARGEUR, portee: PORTEE, modes: MODES, couleurs: COULEURS, borne, mode, couleur, texels, legende };
})();
