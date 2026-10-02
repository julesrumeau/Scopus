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

  // ── Le profil dans le lien (R2) ───────────────────────────────────────────
  //
  // Des paramètres **nommés et lisibles** après `map=`, comme osm.org y ajoute
  // `&layers=` : `&profil=latA/lonA/latB/lonB/largeur`, `&coupe=1`, `&classes=2.5.6`,
  // `&mesure=s/z/s/z`, `&ref=s/z`, `&sel=lat/lon`, `&sol=2.6`. Pas de compression
  // (un état aussi petit n'en a pas besoin, et un lien opaque ne se répare pas à la
  // main) ; osm.org ne lit que `map=` et ignore le reste.
  //
  // **Sûr dans un forum** : Discourse casse un lien nu à la virgule et veut des
  // parenthèses équilibrées, et `URLSearchParams` lit `+` comme une espace. On sépare
  // donc les nombres par `/` (comme `map=`) et les codes par `.`, et rien d'autre.
  //
  // **En bloc** : un paramètre abîmé est ignoré en entier, jamais à moitié — un
  // profil à demi lu serait pire qu'un profil absent.

  /** Au plus ce nombre de points de mesure dans un lien écrit : il reste court. */
  const MESURE_MAX = 40;

  /** Un nombre arrondi, sans zéros de queue ni « -0 » : « 3 », « 2.5 », « 42.857552 ». */
  const nombre = (v, decimales) => {
    const x = arrondi(v, decimales);
    return String(x === 0 ? 0 : x);
  };

  /** Des numéros de classe, uniques et triés (tableau ou `Set`) ; rien d'autre ne passe. */
  const classesTriees = (c) => [...new Set(c ?? [])]
    .filter((x) => Number.isInteger(x) && x >= 0 && x <= 255)
    .sort((a, b) => a - b);

  /**
   * Les classes du sol, ou `undefined` si ce sont celles par défaut : un lien n'écrit que
   * ce qui diffère de ce qu'on obtient sans lui. `presentes` (les classes de la zone) évite
   * de prendre le défaut pour un choix : le sol par défaut est 2 et 9, mais une zone sans eau
   * ne propose pas la 9, et la liste de cases en rend {2}, qui est le défaut pour elle.
   */
  function sansDefaut(classes, defaut, presentes) {
    if (!classes) return undefined;
    const a = classesTriees(classes), b = classesTriees(defaut);
    const p = presentes && [...presentes].length ? new Set(presentes) : null;
    const ca = p ? a.filter((c) => p.has(c)) : a, cb = p ? b.filter((c) => p.has(c)) : b;
    return ca.length === cb.length && ca.every((c, i) => c === cb[i]) ? undefined : a;
  }

  /**
   * Les paramètres de la coupe et de la sélection, à la suite de `map=…`.
   * @param {{profil?: {a: {lat:number, lon:number}, b: {lat:number, lon:number}, largeur:number},
   *          coupe?: boolean, classes?: Iterable<number>, mesure?: Array<{s:number, z:number}>,
   *          ref?: {s:number, z:number}, sel?: {lat:number, lon:number}, sol?: Iterable<number>}} [p]
   * @returns {string} `&profil=…&coupe=1…`, ou `''`
   */
  function ecrirePartage(p) {
    if (!p) return '';
    const parties = [];
    const { profil } = p;
    // Sans bande, la coupe, ses classes, sa mesure et sa référence n'ont aucun sens.
    if (profil && profil.a && profil.b && Number.isFinite(profil.largeur)) {
      const { a, b } = profil;
      parties.push(`profil=${nombre(a.lat, 6)}/${nombre(a.lon, 6)}/${nombre(b.lat, 6)}/${nombre(b.lon, 6)}/${nombre(profil.largeur, 1)}`);
      // Modale fermée : classes, mesure et référence ne décrivent rien d'affiché.
      if (p.coupe) {
        parties.push('coupe=1');
        const classes = classesTriees(p.classes);
        if (classes.length) parties.push(`classes=${classes.join('.')}`);
        if (p.mesure && p.mesure.length) {
          parties.push('mesure=' + p.mesure.slice(0, MESURE_MAX).map((m) => `${nombre(m.s, 2)}/${nombre(m.z, 2)}`).join('/'));
        }
        if (p.ref) parties.push(`ref=${nombre(p.ref.s, 2)}/${nombre(p.ref.z, 2)}`);
      }
    }
    if (p.sel) parties.push(`sel=${nombre(p.sel.lat, 6)}/${nombre(p.sel.lon, 6)}`);
    const sol = classesTriees(p.sol);
    if (sol.length) parties.push(`sol=${sol.join('.')}`);
    return parties.map((x) => `&${x}`).join('');
  }

  /** Des nombres décimaux stricts (ni exposant, ni « + », ni vide) séparés par `/`, ou `null`. */
  function nombres(texte, attendu) {
    const c = String(texte ?? '').split('/');
    if (!c.every((x) => /^-?\d+(\.\d+)?$/.test(x))) return null;
    if (attendu && c.length !== attendu) return null;
    return c.map(Number);
  }

  /** Des numéros de classe séparés par `.`, uniques et triés, ou `null` s'il y a le moindre doute. */
  function classesLues(texte) {
    const c = String(texte ?? '').split('.');
    if (!c.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)) return null;
    return classesTriees(c.map(Number));
  }

  const latLonValides = (lat, lon) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

  /**
   * Ce que le fragment dit de la coupe et de la sélection. Jamais `null` : `{}` si rien.
   * Chaque paramètre est validé en entier, ou ignoré en entier ; ceux qui dépendent de la
   * bande (coupe, classes, mesure, référence) tombent avec elle.
   * @param {string} hash `location.hash`, `#` compris ou non
   * @returns {{profil?: object, coupe?: boolean, classes?: number[], mesure?: object[],
   *            ref?: object, sel?: object, sol?: number[]}}
   */
  function lirePartage(hash) {
    const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    const sortie = {};

    const p = nombres(params.get('profil'), 5);
    if (p) {
      const [latA, lonA, latB, lonB, largeur] = p;
      const confondus = latA === latB && lonA === lonB;
      if (latLonValides(latA, lonA) && latLonValides(latB, lonB) && !confondus && largeur > 0 && largeur <= 1000) {
        sortie.profil = { a: { lat: latA, lon: lonA }, b: { lat: latB, lon: lonB }, largeur };
      }
    }
    if (sortie.profil && params.get('coupe') === '1') {
      sortie.coupe = true;
      const classes = params.has('classes') ? classesLues(params.get('classes')) : null;
      if (classes) sortie.classes = classes;
      const m = params.has('mesure') ? nombres(params.get('mesure')) : null;
      if (m && m.length % 2 === 0 && m.length <= 2 * 40) {
        sortie.mesure = [];
        for (let i = 0; i < m.length; i += 2) sortie.mesure.push({ s: m[i], z: m[i + 1] });
      }
      const r = nombres(params.get('ref'), 2);
      if (r) sortie.ref = { s: r[0], z: r[1] };
    }
    const sel = nombres(params.get('sel'), 2);
    if (sel && latLonValides(sel[0], sel[1])) sortie.sel = { lat: sel[0], lon: sel[1] };
    const sol = params.has('sol') ? classesLues(params.get('sol')) : null;
    if (sol) sortie.sol = sol;
    return sortie;
  }

  return {
    ecrire, lire, resolutionDepuisZoom, zoomDepuisResolution,
    orientationDepuisCamera, cameraDepuisOrientation,
    ecrirePartage, lirePartage, sansDefaut,
  };
})();
