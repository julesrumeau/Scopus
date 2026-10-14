// Les cartes géologiques du BRGM proposées dans les listes du rideau, pour les comparer au relief. Deux couches WMS du même
// service (`geoservices.brgm.fr/geologie`, `Access-Control-Allow-Origin: *`, « no conditions apply » dans ses capacités,
// mesuré le 14 octobre 2026) : la carte **harmonisée** au 1/50 000 (aplats de couleur sans texte, continue d'une feuille à
// l'autre) et la carte **scannée** d'origine (codes des formations, topographie imprimée, feuille par feuille). Le BRGM est cité
// dans l'attribution. **Le service ne dessine qu'aux zooms 12 à 16** (mesuré le 14 octobre 2026, tuiles de 256 px sur six lieux : à
// 11 et en dessous, à 17 et au-delà, des tuiles blanches ; l'échelle des couches est bornée côté serveur) : sous le 12 on ne demande
// rien et le rideau dit de zoomer, au-dessus du 16 la tuile du 16 est agrandie.
// Il n'y a pas de légende dans Scopus : celle des feuilles est sur infoterre.brgm.fr (dit dans l'aide).

const FONDS_GEOLOGIE = (() => {
  const commun = {
    url: 'https://geoservices.brgm.fr/geologie',
    version: '1.3.0',
    format: 'image/png',
    options: {
      attribution: '&copy; <a href="https://www.brgm.fr">BRGM</a>, carte géologique de la France',
      minZoom: 12,
      maxNativeZoom: 16,
    },
    zoomMin: 12,
    zoomMax: 16,
  };
  const fin = ' Apparaît à partir du zoom 12 (plus loin, le service ne dessine rien) ; légende des formations : infoterre.brgm.fr.';
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
