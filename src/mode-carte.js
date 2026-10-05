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

  /** Le côté montré par le mode « une seule carte » : toujours la gauche. */
  const coteUnique = 'gauche';

  /**
   * Où se place le rideau quand `cote` est montré **en entier** : tout à l'opposé (la gauche seule =
   * rideau à 100 %, la droite seule = rideau à 0 %) ; sans côté seul, la position d'avant.
   * La droite seule sert à la seconde des deux cartes synchronisées (TODO R10).
   */
  function partRideau(cote, partScindee) {
    if (cote === 'gauche') return 1;
    if (cote === 'droite') return 0;
    return partScindee;
  }

  /** Les côtés qu'une carte porte : celui qu'elle montre seul, ou les deux. */
  function cotesDe(cote) {
    return cote === 'gauche' || cote === 'droite' ? [cote] : ['gauche', 'droite'];
  }

  /** Les côtés qui portent une couche à l'écran (et à calculer) selon qu'on est en une seule carte ou non. */
  function cotesAffiches(unique) {
    return cotesDe(unique ? coteUnique : null);
  }

  /** Ce que montre le panneau « Relief » : une seule liste en une seule carte, plus d'échange ni de rideau à centrer. */
  function panneau(unique) {
    return {
      libelleGauche: unique ? 'Couche affichée' : 'Gauche',
      listeDroite: !unique,
      boutonsRideau: !unique,
    };
  }

  return { libelles, coteUnique, partRideau, cotesDe, cotesAffiches, panneau };
})();
