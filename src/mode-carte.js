// Le mode d'affichage de la carte en vue normale : **scindée** par le rideau (l'actuel), ou **une
// seule** couche en pleine page. Un troisième mode, deux cartes synchronisées, viendra plus tard
// (TODO R10) : le bouton qui bascule est fait pour en porter trois.
//
// Ici, la logique sans écran ; `CalqueRelief` (flux-calque.js) l'applique au rideau.

const MODE_CARTE = (() => {
  /** Le côté montré quand on passe en une seule carte : la droite, celle du relief par convention. */
  const coteParDefaut = 'droite';

  const libelles = {
    scinde: 'Carte scindée par le rideau',
    unique: 'Une seule carte en pleine page',
  };

  /** L'autre côté (la valeur inconnue retombe sur le côté par défaut). */
  function autreCote(cote) {
    if (cote === 'gauche') return 'droite';
    if (cote === 'droite') return 'gauche';
    return coteParDefaut;
  }

  /**
   * Où se place le rideau : une seule carte, c'est le côté montré **en entier**, donc le rideau
   * tout à l'opposé (la gauche montrée = rideau à 100 %) ; scindée, la position d'avant.
   */
  function partRideau(coteUnique, partScindee) {
    if (coteUnique === 'gauche') return 1;
    if (coteUnique === 'droite') return 0;
    return partScindee;
  }

  return { coteParDefaut, libelles, autreCote, partRideau };
})();
