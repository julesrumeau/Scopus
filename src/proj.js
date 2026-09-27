// Conversion Lambert-93 (EPSG:2154) ↔ WGS84, sans dépendance.
//
// Lambert-93 est une conique conforme sécante (LCC 2SP) sur l'ellipsoïde GRS80,
// dans le système géodésique RGF93. RGF93 et WGS84 partagent le même ellipsoïde
// et ne divergent que de quelques centimètres en France métropolitaine : on les
// confond ici, ce qui est sans conséquence pour un point d'intérêt qu'on ira
// chercher au GPS.

const A = 6378137.0;                  // demi-grand axe GRS80
const F = 1 / 298.257222101;          // aplatissement GRS80
const E = Math.sqrt(2 * F - F * F);   // première excentricité

const LON0 = 3 * Math.PI / 180;       // méridien d'origine
const LAT0 = 46.5 * Math.PI / 180;    // latitude d'origine
const LAT1 = 44 * Math.PI / 180;      // 1er parallèle automécoïque
const LAT2 = 49 * Math.PI / 180;      // 2nd parallèle automécoïque
const X0 = 700000.0;
const Y0 = 6600000.0;

// Facteur d'échelle du parallèle : rayon du parallèle rapporté au demi-grand axe.
function m(phi) {
  const s = Math.sin(phi);
  return Math.cos(phi) / Math.sqrt(1 - E * E * s * s);
}

// Fonction isométrique de Mercator, exprimée en « t » (tangente de la
// colatitude réduite). Décroît de 1 à l'équateur vers 0 au pôle nord.
function t(phi) {
  const s = Math.sin(phi);
  return Math.tan(Math.PI / 4 - phi / 2) / Math.pow((1 - E * s) / (1 + E * s), E / 2);
}

// Constantes de la projection, calculées une fois pour toutes.
const M1 = m(LAT1), M2 = m(LAT2);
const T0 = t(LAT0), T1 = t(LAT1), T2 = t(LAT2);
const N = Math.log(M1 / M2) / Math.log(T1 / T2);   // exposant de la conique
const BIGF = M1 / (N * Math.pow(T1, N));
const R0 = A * BIGF * Math.pow(T0, N);             // rayon polaire à LAT0

/**
 * WGS84 → Lambert-93.
 * @param {number} lon degrés décimaux
 * @param {number} lat degrés décimaux
 * @returns {{x:number, y:number}} mètres
 */
function versLambert93(lon, lat) {
  const phi = lat * Math.PI / 180;
  const lam = lon * Math.PI / 180;
  const r = A * BIGF * Math.pow(t(phi), N);
  const theta = N * (lam - LON0);
  return { x: X0 + r * Math.sin(theta), y: Y0 + R0 - r * Math.cos(theta) };
}

/**
 * Lambert-93 → WGS84.
 * @param {number} x mètres
 * @param {number} y mètres
 * @returns {{lon:number, lat:number}} degrés décimaux
 */
function versWGS84(x, y) {
  const dx = x - X0;
  const dy = R0 - (y - Y0);
  const signe = N >= 0 ? 1 : -1;
  const r = signe * Math.hypot(dx, dy);
  const theta = Math.atan2(signe * dx, signe * dy);

  const tp = Math.pow(r / (A * BIGF), 1 / N);
  const lam = theta / N + LON0;

  // La latitude n'a pas de forme fermée : on itère sur la correction
  // d'excentricité. La convergence est quadratique, six tours suffisent
  // largement pour descendre sous le micromètre.
  let phi = Math.PI / 2 - 2 * Math.atan(tp);
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(phi);
    const suivant = Math.PI / 2 - 2 * Math.atan(tp * Math.pow((1 - E * s) / (1 + E * s), E / 2));
    if (Math.abs(suivant - phi) < 1e-12) { phi = suivant; break; }
    phi = suivant;
  }

  return { lon: lam * 180 / Math.PI, lat: phi * 180 / Math.PI };
}

/** Formatage en degrés/minutes/secondes, pour copie dans un GPS de rando. */
function versDMS(lon, lat) {
  const part = (v, pos, neg) => {
    const hemi = v >= 0 ? pos : neg;
    const abs = Math.abs(v);
    const d = Math.floor(abs);
    const mn = Math.floor((abs - d) * 60);
    const sec = ((abs - d) * 60 - mn) * 60;
    return `${d}°${String(mn).padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}"${hemi}`;
  };
  return `${part(lat, 'N', 'S')} ${part(lon, 'E', 'W')}`;
}

/**
 * Le point tombe-t-il dans l'emprise de la France métropolitaine ?
 *
 * C'est un **rectangle englobant**, pas une frontière : il déborde sur la mer,
 * l'Espagne et l'Italie. Il ne sert qu'à distinguer deux messages qui n'ont rien
 * à voir — « le LiDAR HD ne couvre que la France » quand on a cliqué à l'autre
 * bout du monde, et « cette zone n'a pas encore été volée » quand on est bien en
 * France mais hors chantier. Pour cet usage, un rectangle suffit et une
 * frontière exacte serait un poids mort.
 *
 * Il protège aussi la projection : Lambert-93 n'est défini que pour la France et
 * rend n'importe quoi ailleurs.
 */
function dansEmpriseFrance(lon, lat) {
  return lon >= -5.6 && lon <= 9.8 && lat >= 41.2 && lat <= 51.2;
}

// ── Territoires d'outre-mer : Mercator transverse (UTM) ─────────────────────
//
// Le LiDAR HD des DROM est publié dans leur projection légale, UTM, avec le
// même découpage en carrés de 1 km nommés d'après leur coin nord-ouest
// (LHD_REU_0338_7664…). Les systèmes géodésiques (RGR92, RGAF09, RGM04,
// RGFG95) coïncident avec WGS84 bien sous le mètre : aucune transformation
// de datum, seulement la projection, sur l'ellipsoïde GRS80.

/**
 * Mercator transverse de la zone UTM `zone`, hémisphère sud si `sud` : série
 * de Krüger à l'ordre 4 en n, sous le micromètre dans la zone (vérifiée contre les
 * coins de dalles publiés par l'IGN, test/proj.test.js). Ne ferme que sur
 * les constantes de l'ellipsoïde : le worker du relief la reprend en texte.
 */
function projectionUTM(zone, sud) {
  const k0 = 0.9996, FE = 500000, FN = sud ? 10000000 : 0;
  const lon0 = ((zone * 6 - 183) * Math.PI) / 180;
  const n = F / (2 - F), n2 = n * n, n3 = n2 * n, n4 = n3 * n;
  const Ak = (A / (1 + n)) * (1 + n2 / 4 + (n2 * n2) / 64) * k0;
  const al = [
    n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180,
    (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440,
    (61 * n3) / 240 - (103 * n4) / 140,
    (49561 * n4) / 161280,
  ];
  const be = [
    n / 2 - (2 * n2) / 3 + (37 * n3) / 96 - n4 / 360,
    n2 / 48 + n3 / 15 - (437 * n4) / 1440,
    (17 * n3) / 480 - (37 * n4) / 840,
    (4397 * n4) / 161280,
  ];
  const de = [
    2 * n - (2 * n2) / 3 - 2 * n3 + (116 * n4) / 45,
    (7 * n2) / 3 - (8 * n3) / 5 - (227 * n4) / 45,
    (56 * n3) / 15 - (136 * n4) / 35,
    (4279 * n4) / 630,
  ];
  const c = (2 * Math.sqrt(n)) / (1 + n);
  return {
    versLocal(lon, lat) {
      const phi = (lat * Math.PI) / 180, dl = (lon * Math.PI) / 180 - lon0;
      const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
      const xi1 = Math.atan2(t, Math.cos(dl)), eta1 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
      let xi = xi1, eta = eta1;
      for (let j = 1; j <= 4; j++) {
        xi += al[j - 1] * Math.sin(2 * j * xi1) * Math.cosh(2 * j * eta1);
        eta += al[j - 1] * Math.cos(2 * j * xi1) * Math.sinh(2 * j * eta1);
      }
      return { x: FE + Ak * eta, y: FN + Ak * xi };
    },
    versGeo(x, y) {
      const xi = (y - FN) / Ak, eta = (x - FE) / Ak;
      let xi1 = xi, eta1 = eta;
      for (let j = 1; j <= 4; j++) {
        xi1 -= be[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        eta1 -= be[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      }
      const chi = Math.asin(Math.sin(xi1) / Math.cosh(eta1));
      let phi = chi;
      for (let j = 1; j <= 4; j++) phi += de[j - 1] * Math.sin(2 * j * chi);
      const lam = lon0 + Math.atan2(Math.sinh(eta1), Math.cos(xi1));
      return { lon: (lam * 180) / Math.PI, lat: (phi * 180) / Math.PI };
    },
  };
}

/**
 * Les territoires du LiDAR HD : code des noms de dalle, projection (zone UTM,
 * ou Lambert-93), et un rectangle englobant [ouest, sud, est, nord] en degrés
 * — les territoires ne se chevauchent pas. Martinique, Mayotte et Guyane :
 * aucune dalle publiée à nos points d'essai (27 septembre 2026), prêts pour
 * le jour où elles le seront.
 */
const TERRITOIRES = [
  { code: 'FXX', nom: 'France métropolitaine', lambert93: true, rectangle: [-5.6, 41.2, 9.8, 51.2] },
  { code: 'REU', nom: 'La Réunion', zone: 40, sud: true, rectangle: [55.1, -21.5, 56.0, -20.8] },
  { code: 'GLP', nom: 'Guadeloupe', zone: 20, sud: false, rectangle: [-61.9, 15.8, -60.9, 16.6] },
  { code: 'MTQ', nom: 'Martinique', zone: 20, sud: false, rectangle: [-61.3, 14.35, -60.75, 14.95] },
  { code: 'MYT', nom: 'Mayotte', zone: 38, sud: true, rectangle: [44.9, -13.1, 45.35, -12.55] },
  { code: 'GUF', nom: 'Guyane', zone: 22, sud: false, rectangle: [-54.7, 2.0, -51.5, 5.9] },
];

/** La projection d'un territoire : `{ versLocal(lon, lat) → {x, y}, versGeo(x, y) → {lon, lat} }`. */
function projectionDe(code) {
  const t = TERRITOIRES.find((u) => u.code === code) || TERRITOIRES[0];
  return t.lambert93 ? { versLocal: versLambert93, versGeo: versWGS84 } : projectionUTM(t.zone, t.sud);
}

/** Le territoire qui contient ce point, ou `null` (hors de tout territoire couvert). */
function territoireAuPoint(lon, lat) {
  return TERRITOIRES.find(({ rectangle: [o, s, e, n] }) => lon >= o && lon <= e && lat >= s && lat <= n) || null;
}

/**
 * Une paire de coordonnées tapée directement, dans les deux conventions
 * courantes — « 42.74, 1.68 » (latitude, longitude, comme un GPS) ou une
 * paire de valeurs Lambert-93 à six/sept chiffres. `null` si le texte n'est
 * pas une paire de nombres — c'est alors un nom de lieu, à chercher ailleurs.
 *
 * Partagé par la recherche de dalle (`ign.js`) et la recherche d'un point
 * dans « Point sélectionné » (`app.js`) : deux occasions de taper des
 * coordonnées, une seule règle pour les reconnaître.
 */
function depuisTexte(texte) {
  const paire = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(texte.trim());
  if (!paire) return null;
  const a = parseFloat(paire[1].replace(',', '.'));
  const b = parseFloat(paire[2].replace(',', '.'));
  // Au-delà de 180, ce ne peut plus être un angle : c'est du Lambert-93.
  if (Math.abs(a) > 180 || Math.abs(b) > 180) return versWGS84(a, b);
  return { lon: b, lat: a };
}

const PROJ = {
  versLambert93, versWGS84, versDMS, dansEmpriseFrance, depuisTexte,
  TERRITOIRES, projectionUTM, projectionDe, territoireAuPoint,
};
