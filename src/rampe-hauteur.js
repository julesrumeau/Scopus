// La borne haute de la rampe de couleur « Hauteur/sol » de la 3D. Réglable (5 à 50 m) : un forestier lit des peuplements de 0 à 40 m,
// alors que la rampe d'origine saturait à 8 m (tout ce qui dépasse était du même rouge). Pur : aucun DOM.

const RAMPE_HAUTEUR = (() => {
  const DEFAUT = 8, MIN = 5, MAX = 50;
  // Le jaune est à 35 % de la borne dans le shader (`rampeHauteur`), le rouge à la borne.
  const PART_JAUNE = 0.35;

  /** La borne en mètres entiers dans [5, 50] ; le défaut si ce n'est pas un nombre. */
  function borne(v) {
    const x = typeof v === 'number' ? v : NaN;
    return Number.isFinite(x) ? Math.min(MAX, Math.max(MIN, Math.round(x))) : DEFAUT;
  }

  /** La phrase de légende de la rampe pour cette borne. */
  function legende(h) {
    const b = borne(h);
    return `Sombre = sol · jaune = ${Math.round(b * PART_JAUNE)} m · rouge = ${b} m et plus`;
  }

  return { defaut: DEFAUT, min: MIN, max: MAX, borne, legende };
})();
