// Fabrique les derniers octets d'un fichier COPC tel que l'IGN les range :
// des données, l'en-tête d'EVLR « copc » / 1000 (60 octets), les entrées de
// hiérarchie (32 octets chacune), puis un dernier EVLR (~830 octets, la
// projection). Sert aux tests de lecture sans en-tête ; aucun fichier binaire
// n'est versionné.

export function fabriquerFin({ entrees, avant = 64, apres = 830, leurre = false, tableBlocs = null }) {
  const tailleIndex = entrees.length * 32;
  const o = new Uint8Array(avant + 60 + tailleIndex + apres);
  const dv = new DataView(o.buffer);
  if (leurre) {
    // « copc » dans les données, avec un autre identifiant d'enregistrement :
    // ne doit pas être pris pour l'index.
    o.set([0x63, 0x6f, 0x70, 0x63, 0], 2);
    dv.setUint16(18, 1, true);
  }
  if (tableBlocs) {
    // Table des blocs LAZ, juste après le dernier bloc : 4 octets nuls (version)
    // puis le nombre de blocs.
    dv.setUint32(tableBlocs.position, 0, true);
    dv.setUint32(tableBlocs.position + 4, tableBlocs.nombre, true);
  }
  let p = avant;
  o.set([0x63, 0x6f, 0x70, 0x63], p + 2);
  dv.setUint16(p + 18, 1000, true);
  dv.setBigUint64(p + 20, BigInt(tailleIndex), true);
  p += 60;
  for (const e of entrees) {
    dv.setInt32(p, e.n, true);
    dv.setInt32(p + 4, e.x ?? 0, true);
    dv.setInt32(p + 8, e.y ?? 0, true);
    dv.setInt32(p + 12, e.z ?? 0, true);
    dv.setBigUint64(p + 16, BigInt(e.offset), true);
    dv.setInt32(p + 24, e.taille, true);
    dv.setInt32(p + 28, e.nbPoints, true);
    p += 32;
  }
  return o;
}

/** Premiers 256 octets d'un fichier LAS 1.4, format 6. */
export function fabriquerEntete({ longueurPoint = 30 } = {}) {
  const o = new Uint8Array(256);
  const dv = new DataView(o.buffer);
  o.set([0x4c, 0x41, 0x53, 0x46], 0);            // « LASF »
  dv.setUint8(24, 1); dv.setUint8(25, 4);        // LAS 1.4
  dv.setUint8(104, 6 | 0x80);                    // format 6, compressé
  dv.setUint16(105, longueurPoint, true);
  for (let k = 0; k < 3; k++) dv.setFloat64(131 + 8 * k, 0.01, true);
  for (let k = 0; k < 3; k++) dv.setFloat64(155 + 8 * k, 0, true);
  return o;
}

/**
 * Un bloc LAZ 1.4 « en couches » (formats 6 à 8) : le premier point brut
 * (`longueurPoint` octets, remplis de 7), le nombre de points, la taille de
 * chaque couche, puis les couches bout à bout, la couche i remplie de i + 1.
 */
export function fabriquerBloc({ longueurPoint = 30, tailles, nbPoints = 1000 }) {
  const entete = longueurPoint + 4 + 4 * tailles.length;
  const o = new Uint8Array(entete + tailles.reduce((a, t) => a + t, 0));
  const dv = new DataView(o.buffer);
  o.fill(7, 0, longueurPoint);
  dv.setUint32(longueurPoint, nbPoints, true);
  tailles.forEach((t, i) => dv.setUint32(longueurPoint + 4 + 4 * i, t, true));
  let p = entete;
  tailles.forEach((t, i) => { o.fill(i + 1, p, p + t); p += t; });
  return o;
}
