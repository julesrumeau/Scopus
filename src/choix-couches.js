// Les listes de couches du rideau, rangées par famille (des <optgroup>) pour qu'elles restent
// lisibles à mesure qu'elles s'allongent. Seul le rangement change : ni les clés des couches (les
// liens partagés restent valables), ni leurs libellés.
//
// Une couche qu'aucune famille ne connaît tombe dans « Autres », en dernier : en ajouter une
// sans la classer ne la fait jamais disparaître de la liste.

const CHOIX_COUCHES = (() => {
  /** Les familles, dans l'ordre de la liste, chacune avec ses clés dans leur ordre d'affichage. */
  const FAMILLES = [
    { titre: 'Fonds de carte', cles: ['carte', 'plan', 'osm'] },
    { titre: 'Relief : lumière et ombres', cles: ['ombrage', 'ombrage-simple', 'ombrage-rgb'] },
    { titre: 'Relief : formes du terrain', cles: ['svf', 'ouverture-pos', 'ouverture-neg', 'microrelief'] },
    { titre: 'Relief : mesures du sol', cles: ['hauteur', 'trou'] },
    { titre: 'Relief de l’IGN', cles: ['mnt-ign', 'mns-ign'] },
  ];

  /**
   * Range `couches` (`{ cle, libelle }`, dans n'importe quel ordre) en groupes `{ titre, couches }`.
   * Les familles vides n'apparaissent pas.
   */
  function groupes(couches) {
    const parCle = new Map(couches.map((c) => [c.cle, c]));
    const placees = new Set();
    const sortie = [];
    for (const f of FAMILLES) {
      const dedans = f.cles.filter((k) => parCle.has(k)).map((k) => { placees.add(k); return parCle.get(k); });
      if (dedans.length) sortie.push({ titre: f.titre, couches: dedans });
    }
    const autres = couches.filter((c) => !placees.has(c.cle));
    if (autres.length) sortie.push({ titre: 'Autres', couches: autres });
    return sortie;
  }

  return { groupes };
})();
