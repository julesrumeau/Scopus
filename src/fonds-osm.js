// Les fonds OpenStreetMap proposés dans les listes du rideau.
//
// Le serveur de tuiles de la Fondation n'est pas sans conditions (voir la politique d'usage
// des tuiles, operations.osmfoundation.org/policies/tiles) : un **Referer** valide, qui
// identifie le site (d'où `referrerPolicy`) ; une **attribution** visible avec un lien vers
// le copyright ; pas de téléchargement en masse. En `file://` il n'y a pas de Referer : la
// tuile dit « Referer is required », accepté — le site déployé est le seul usage visé.
//
// Le fond **OSM France** (`tile.openstreetmap.fr/osmfr`) n'est pas ici : ses serveurs sont
// limités par liste blanche de Referer, il faut l'accord de l'association (TODO R8).

const FONDS_OSM = (() => {
  const standard = {
    cle: 'osm',
    libelle: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      referrerPolicy: 'origin',
      // Le serveur ne sert rien au-delà : plus loin, Leaflet agrandit la dernière tuile.
      maxNativeZoom: 19,
    },
  };
  return { standard, parCle: { [standard.cle]: standard } };
})();
