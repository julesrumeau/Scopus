// Les cartes géologiques du BRGM proposées dans les listes du rideau, pour les comparer au relief. Deux couches WMS du même
// service (`geoservices.brgm.fr/geologie`, `Access-Control-Allow-Origin: *`, « no conditions apply » dans ses capacités,
// mesuré le 14 octobre 2026) : la carte **harmonisée** au 1/50 000 (aplats de couleur sans texte, continue d'une feuille à
// l'autre) et la carte **scannée** d'origine (codes des formations, topographie imprimée, feuille par feuille). Le BRGM est cité
// dans l'attribution. Au-delà du zoom 17, une carte au 1/50 000 ne dit rien de plus fin : la tuile est agrandie.
// Il n'y a pas de légende dans Scopus : celle des feuilles est sur infoterre.brgm.fr (dit dans l'aide).

const FONDS_GEOLOGIE = (() => {
  const commun = {
    url: 'https://geoservices.brgm.fr/geologie',
    version: '1.3.0',
    format: 'image/png',
    options: {
      attribution: '&copy; <a href="https://www.brgm.fr">BRGM</a>, carte géologique de la France',
      maxNativeZoom: 17,
    },
  };
  const fin = ' Légende des formations : infoterre.brgm.fr. Ne dit rien sous le zoom 17 de plus que ce que montre la carte au 1/50 000.';
  const harmonisee = {
    ...commun,
    cle: 'geologie',
    libelle: 'Géologie 1/50 000 (BRGM)',
    couche: 'SCAN_H_GEOL50',
    aide: 'Carte géologique de la France au 1/50 000, harmonisée, du BRGM : des couleurs par formation, continues d’une feuille à l’autre, sans texte. À comparer au relief de l’autre côté du rideau.' + fin,
  };
  const scannee = {
    ...commun,
    cle: 'geologie-scan',
    libelle: 'Géologie scannée (BRGM)',
    couche: 'SCAN_D_GEOL50',
    aide: 'Feuilles de la carte géologique de la France au 1/50 000 scannées par le BRGM, telles qu’imprimées : codes des formations, structures, topographie. Une feuille à la fois, avec ses propres limites.' + fin,
  };
  return { parCle: { [harmonisee.cle]: harmonisee, [scannee.cle]: scannee } };
})();
