// Le mode d'affichage de la carte en vue normale, trois états du bouton qui bascule :
//   · `scinde`  une carte, deux couches séparées par le rideau glissant (l'actuel) ;
//   · `unique`  une carte, **la gauche** en pleine page : une seule liste de couches, rien à deviner ;
//   · `double`  deux cartes synchronisées, une couche chacune (la gauche à gauche, la droite à droite).
//
// Ici, la logique sans écran ; `CalqueRelief` (flux-calque.js) l'applique au rideau, `app.js` au panneau
// et aux cartes.

const MODE_CARTE = (() => {
  const libelles = {
    scinde: 'Carte scindée par le rideau',
    unique: 'Une seule carte en pleine page',
    double: 'Deux cartes synchronisées',
  };

  /** Le côté montré par le mode « une seule carte » : toujours la gauche. */
  const coteUnique = 'gauche';

  /**
   * Où se place le rideau quand `cote` est montré **en entier** : tout à l'opposé (la gauche seule =
   * rideau à 100 %, la droite seule = rideau à 0 %) ; sans côté seul, la position d'avant.
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

  /** Les côtés qui portent une couche à l'écran (et à calculer). Un mode inconnu vaut la carte scindée. */
  function cotesAffiches(mode) {
    return cotesDe(mode === 'unique' ? coteUnique : null);
  }

  /**
   * Les cartes du mode, et pour chacune le côté qu'elle montre **seul** (`null` : elle porte les deux,
   * séparés par le rideau). Une carte par entrée, de gauche à droite (ou de haut en bas).
   */
  function cartes(mode) {
    if (mode === 'unique') return [{ coteSeul: coteUnique }];
    if (mode === 'double') return [{ coteSeul: 'gauche' }, { coteSeul: 'droite' }];
    return [{ coteSeul: null }];
  }

  /**
   * Ce que montre le panneau « Relief » : une seule liste en une seule carte, plus d'échange ni de
   * rideau à centrer ; en deux cartes, les deux listes et l'échange, sans rideau à centrer.
   */
  function panneau(mode) {
    const unique = mode === 'unique';
    return {
      libelleGauche: unique ? 'Couche affichée' : 'Gauche',
      listeDroite: !unique,
      echanger: !unique,
      rideauAuCentre: mode !== 'unique' && mode !== 'double',
    };
  }

  return { libelles, coteUnique, partRideau, cotesDe, cotesAffiches, cartes, panneau };
})();
