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

const PROJ = { versLambert93, versWGS84, versDMS };
