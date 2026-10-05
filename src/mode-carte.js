// Le mode d'affichage de la carte en vue normale : **scindée** par le rideau (l'actuel), ou **une
// seule** couche en pleine page. Un troisième mode, deux cartes synchronisées, viendra plus tard
// (TODO R10) : le bouton qui bascule est fait pour en porter trois.
//
// Une seule carte montre **toujours la gauche** : une seule liste de couches, rien à deviner (avec
// deux listes, on ne saurait pas laquelle commande ce qu'on voit). La droite n'est ni affichée ni
// calculée, et reste telle quelle pour le retour à la carte scindée.
//
// Ici, la logique sans écran ; `CalqueRelief` (flux-calque.js) l'applique au rideau, `app.js` au panneau.

const MODE_CARTE = (() => {
  const libelles = {
    scinde: 'Carte scindée par le rideau',
    unique: 'Une seule carte en pleine page',
  };

  /**
   * Où se place le rideau : une seule carte, c'est la gauche **en entier**, donc le rideau tout à
   * droite ; scindée, la position d'avant.
   */
  function partRideau(unique, partScindee) {
    return unique ? 1 : partScindee;
  }

  /** Les côtés qui portent une couche à l'écran (et à calculer). */
  function cotesAffiches(unique) {
    return unique ? ['gauche'] : ['gauche', 'droite'];
  }

  /** Ce que montre le panneau « Relief » : une seule liste en une seule carte, plus d'échange ni de rideau à centrer. */
  function panneau(unique) {
    return {
      libelleGauche: unique ? 'Couche affichée' : 'Gauche',
      listeDroite: !unique,
      boutonsRideau: !unique,
    };
  }

  return { libelles, partRideau, cotesAffiches, panneau };
})();
