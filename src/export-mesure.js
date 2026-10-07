// L'export de la mesure de la carte : la liste de ses points (longitude, latitude, et si on le demande l'altitude du sol)
// en GeoJSON, GPX ou OSM XML. Des fonctions pures : ni DOM ni réseau ; la fenêtre et le téléchargement sont dans
// `export-mesure-ui.js`.
//
// Un point : `{ lat, lon, sol, hauteur }` en WGS84 (`sol` : altitude du sol, ou null/absente ; `hauteur` : sursol, 0 si aucun).
// **Une altitude n'est jamais écrite à moitié** : si un seul point n'en a pas, aucun n'en porte (comme `totale3D`).
// Formats : GeoJSON (RFC 7946, `[longitude, latitude, altitude]`), GPX 1.1 (`trk`/`trkseg`/`trkpt`), OSM XML 0.6
// (identifiants négatifs : de nouveaux objets, `upload='false'` : rien à envoyer à OpenStreetMap par mégarde).

const EXPORT_MESURE = (() => {
  const lettre = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
  /** Les coordonnées au centimètre (7 décimales), sans bruit de flottant. */
  const coord = (v) => Number(v.toFixed(7));
  const metres = (v) => Number(v.toFixed(2));

  function altitudeDisponible(points) {
    return points.length > 0 && points.every((p) => Number.isFinite(p.sol));
  }

  /** L'altitude est écrite seulement si on l'a demandée ET si elle existe pour tous les points. */
  const avecAltitude = (points, options) => !!options?.altitude && altitudeDisponible(points);
  const sursol = (p) => (p.hauteur > 0.05 ? metres(p.hauteur) : null);

  function versGeoJSON(points, options) {
    const alt = avecAltitude(points, options);
    const position = (p) => (alt ? [coord(p.lon), coord(p.lat), metres(p.sol)] : [coord(p.lon), coord(p.lat)]);
    const features = [];
    if (points.length >= 2) {
      features.push({ type: 'Feature', properties: { name: 'Mesure Scopus' }, geometry: { type: 'LineString', coordinates: points.map(position) } });
    }
    points.forEach((p, i) => {
      const proprietes = { name: lettre(i) };
      if (alt && sursol(p) !== null) proprietes.height = sursol(p);
      features.push({ type: 'Feature', properties: proprietes, geometry: { type: 'Point', coordinates: position(p) } });
    });
    return JSON.stringify({ type: 'FeatureCollection', features }, null, 2);
  }

  function versGPX(points, options) {
    const alt = avecAltitude(points, options);
    // Un élément vide s'écrit auto-fermé : certains lecteurs légers ne lisent pas `<trkpt ...></trkpt>`.
    const pts = points.map((p) => `      <trkpt lat="${coord(p.lat)}" lon="${coord(p.lon)}"${alt ? `><ele>${metres(p.sol)}</ele></trkpt>` : '/>'}`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Scopus" xmlns="http://www.topografix.com/GPX/1/1">\n`
      + `  <trk>\n    <name>Mesure Scopus</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n</gpx>\n`;
  }

  function versOSM(points, options) {
    const alt = avecAltitude(points, options);
    // Pas de nom ni d'étiquette inventée : un `name=A` ou un tag douteux pollue OpenStreetMap si on envoie par erreur.
    const noeuds = points.map((p, i) => {
      const tags = alt ? `<tag k='ele' v='${metres(p.sol)}'/>${sursol(p) !== null ? `<tag k='height' v='${sursol(p)}'/>` : ''}` : '';
      // Sans étiquette : auto-fermé (`<node ... />`, comme JOSM). uMap lit le .osm avec osm2geojson, dont l'analyseur
      // ne tire rien d'un `<node ...></node>` (« No data has been found for import »).
      return `  <node id='${-(i + 1)}' visible='true' lat='${coord(p.lat)}' lon='${coord(p.lon)}'${tags ? `>${tags}</node>` : '/>'}`;
    }).join('\n');
    const chemin = points.length >= 2
      ? `\n  <way id='${-(points.length + 1)}' visible='true'>\n${points.map((_, i) => `    <nd ref='${-(i + 1)}'/>`).join('\n')}\n  </way>`
      : '';
    return `<?xml version='1.0' encoding='UTF-8'?>\n<osm version='0.6' generator='Scopus' upload='false'>\n${noeuds}${chemin}\n</osm>\n`;
  }

  const formats = [
    { cle: 'geojson', extension: 'geojson', type: 'application/geo+json', ecrire: versGeoJSON },
    { cle: 'gpx', extension: 'gpx', type: 'application/gpx+xml', ecrire: versGPX },
    { cle: 'osm', extension: 'osm', type: 'application/xml', ecrire: versOSM },
  ];

  /** `scopus-mesure-AAAA-MM-JJ.<extension>`. */
  function nomFichier(cle, date = new Date()) {
    const f = formats.find((x) => x.cle === cle);
    const deux = (n) => String(n).padStart(2, '0');
    return `scopus-mesure-${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}.${f.extension}`;
  }

  /** Le fichier d'un format : `{ nom, type, contenu }`. */
  function exporter(cle, points, options, date) {
    const f = formats.find((x) => x.cle === cle);
    if (!f) throw new Error(`Format d'export inconnu : ${cle}`);
    return { nom: nomFichier(cle, date), type: f.type, contenu: f.ecrire(points, options) };
  }

  /** Ce que la fenêtre dit de la mesure : son nombre de points, la présence d'un tracé, et si l'altitude peut être écrite. */
  function resumer(points) {
    const n = points.length, trace = n >= 2, altitude = altitudeDisponible(points);
    return {
      n, tracé: trace, altitudeDisponible: altitude,
      texte: `${n} point${n > 1 ? 's' : ''}${trace ? ', avec un tracé' : ''}`,
      raisonAltitude: altitude || n === 0 ? '' : 'L’altitude du sol est inconnue pour certains points : elle n’est pas écrite.',
    };
  }

  return { versGeoJSON, versGPX, versOSM, altitudeDisponible, resumer, nomFichier, formats, exporter };
})();
