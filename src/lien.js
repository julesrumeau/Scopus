// Lien partageable : la vue courante, dans le format que tout le monde lit.
//
// `#map=zoom/lat/lon` est celui d'osm.org ; MapLibre y ajoute
// `/orientation/inclinaison`, et ne les écrit que s'ils ne sont pas nuls. Le
// suivre à la lettre, c'est ce qui permet de coller un lien Scopus dans osm.org,
// iD ou un greffon qui passe d'une carte à l'autre, et d'y retrouver la même
// zone : osm.org ne lit que les trois premiers champs (`OSM.parseHash`) et
// ignore le reste. Rien n'est inventé ici — voir « Le lien partageable » dans
// CLAUDE.md.
//
// Le zoom est celui de Leaflet et d'osm.org — un monde de 256 px au zoom 0 —,
// pas celui de MapLibre, décalé d'un cran. C'est la carte de Scopus qui fixe
// l'échelle, et c'est vers osm.org qu'on veut que le lien mène.
//
// Module pur : aucune dépendance au DOM, pour se tester à froid.

const LIEN = (() => {
  /** Mètres par pixel à l'équateur au zoom 0, tuiles de 256 px. */
  const RESOLUTION_ZOOM0 = 2 * Math.PI * 6378137 / 256;

  /** Élévation de `Vue3D.vueDeDessus`, un poil sous la verticale. */
  const ELEVATION_MAX = 1.553;

  const arrondi = (v, decimales) => {
    const m = 10 ** decimales;
    // `+ 0` efface le zéro négatif, qui s'écrirait « -0 ».
    return Math.round(v * m) / m + 0;
  };

  /**
   * Décimales de latitude et longitude : de quoi placer le centre au
   * demi-pixel près à ce zoom, sans plus — la règle de MapLibre, ramenée aux
   * tuiles de 256 px.
   */
  function decimales(zoom) {
    return Math.max(0, Math.ceil((zoom * Math.LN2 + Math.log(256 / 360 / 0.5)) / Math.LN10));
  }

  /**
   * @param {{zoom:number, lat:number, lon:number, orientation?:number, inclinaison?:number}} v
   *   orientation en degrés depuis le nord, sens horaire ; inclinaison en
   *   degrés depuis la verticale (0 = vue de dessus)
   * @returns {string} le fragment, sans le `#`
   */
  function ecrire({ zoom, lat, lon, orientation = 0, inclinaison = 0 }) {
    const p = decimales(zoom);
    let s = `map=${arrondi(zoom, 2)}/${arrondi(lat, p)}/${arrondi(lon, p)}`;
    const o = arrondi(((orientation % 360) + 360) % 360, 1) % 360;
    const i = Math.round(inclinaison);
    if (o || i) s += `/${o}`;
    if (i) s += `/${i}`;
    return s;
  }

  /**
   * @param {string} hash `location.hash`, `#` compris ou non
   * @returns {?object} `{zoom, lat, lon, orientation, inclinaison}`, ou
   *   `{dalle: {x, y}}` pour un ancien lien `#d=x,y`, ou `null` si le fragment
   *   ne désigne rien — jamais une position devinée
   */
  function lire(hash) {
    const brut = String(hash || '').replace(/^#/, '');
    const ancien = /^d=(-?\d+),(-?\d+)$/.exec(brut);
    if (ancien) return { dalle: { x: Number(ancien[1]), y: Number(ancien[2]) } };

    const map = new URLSearchParams(brut).get('map');
    if (!map) return null;
    const champs = map.split('/').map(Number);
    if (champs.length < 3 || champs.some((c) => !Number.isFinite(c))) return null;
    const [zoom, lat, lon, orientation = 0, inclinaison = 0] = champs;
    if (zoom < 0 || zoom > 24 || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { zoom, lat, lon, orientation, inclinaison };
  }

  /** Mètres au sol par pixel CSS, à ce zoom et cette latitude. */
  function resolutionDepuisZoom(zoom, lat) {
    return RESOLUTION_ZOOM0 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
  }

  /** Zoom qui donne cette résolution (m par pixel CSS) à cette latitude. */
  function zoomDepuisResolution(resolution, lat) {
    return Math.log2(RESOLUTION_ZOOM0 * Math.cos(lat * Math.PI / 180) / resolution);
  }

  /**
   * Angles de la caméra orbitale de `Vue3D` → angles du lien.
   *
   * `_repere` vise l'horizontale (−sin a, −cos a) en (X est, Z sud), soit un
   * cap de −a depuis le nord. L'élévation est la hauteur de l'œil au-dessus de
   * l'horizon ; l'inclinaison se compte, elle, depuis la verticale.
   */
  function orientationDepuisCamera(azimut, elevation) {
    const orientation = ((-azimut * 180 / Math.PI) % 360 + 360) % 360;
    let inclinaison = 90 - elevation * 180 / Math.PI;
    // La vue de dessus de Scopus s'arrête à 89° : ce degré-là n'est que du
    // bruit au bout de chaque lien. Pas d'autre arrondi ici — c'est `ecrire`
    // qui arrondit, une seule fois.
    if (inclinaison < 1.5) inclinaison = 0;
    return { orientation, inclinaison: Math.min(180, inclinaison) };
  }

  /** Inverse d'`orientationDepuisCamera`, élévation bornée comme les contrôles. */
  function cameraDepuisOrientation(orientation, inclinaison) {
    const elevation = (90 - inclinaison) * Math.PI / 180;
    return {
      azimut: -orientation * Math.PI / 180,
      elevation: Math.max(-ELEVATION_MAX, Math.min(ELEVATION_MAX, elevation)),
    };
  }

  return {
    ecrire, lire, resolutionDepuisZoom, zoomDepuisResolution,
    orientationDepuisCamera, cameraDepuisOrientation,
  };
})();
