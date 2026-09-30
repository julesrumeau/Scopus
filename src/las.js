// Écriture d'un nuage en LAS 1.4, point de format 6 (spécification ASPRS).
//
// Pourquoi le format 6 : les formats 0 à 5 rangent la classe sur 5 bits (0 à
// 31), et le LiDAR HD emploie la 64 (sursol pérenne) et la 66. Le format 6 la
// range sur un octet entier.
//
// Les coordonnées sont celles du nuage 3D — mètres, origine au coin de la vue
// —, au centimètre (échelle 0,01, décalage 0) : le fichier ne dit rien du
// Lambert-93 ni d'un CRS, et n'en a pas besoin pour Blender ou FreeCAD.

const LAS = (() => {
  const TAILLE_ENTETE = 375;
  const TAILLE_POINT = 30;
  const POINTS_PAR_PARTIE = 65536;   // ~2 Mo : jamais un tampon de la taille du fichier

  function retenus(nuage, exclues) {
    let n = 0;
    for (let i = 0; i < nuage.n; i++) if (!exclues || !exclues.has(nuage.cls[i])) n++;
    return n;
  }

  /** Combien de points et d'octets donnerait `ecrire` — pour l'annoncer avant. */
  function compter(nuage, exclues) {
    const n = retenus(nuage, exclues);
    return { n, octets: TAILLE_ENTETE + n * TAILLE_POINT };
  }

  function entete(n, boite) {
    const b = new Uint8Array(TAILLE_ENTETE);
    const v = new DataView(b.buffer);
    b.set([0x4c, 0x41, 0x53, 0x46], 0);                        // « LASF »
    v.setUint8(24, 1); v.setUint8(25, 4);                      // version 1.4
    const logiciel = new TextEncoder().encode('Scopus');
    b.set(logiciel, 58);                                       // logiciel générateur
    const jour = new Date();
    v.setUint16(90, Math.floor((jour - Date.UTC(jour.getUTCFullYear(), 0, 1)) / 864e5) + 1, true);
    v.setUint16(92, jour.getUTCFullYear(), true);
    v.setUint16(94, TAILLE_ENTETE, true);
    v.setUint32(96, TAILLE_ENTETE, true);                      // début des points
    v.setUint8(104, 6);                                        // format de point
    v.setUint16(105, TAILLE_POINT, true);
    // 107 à 130 : compteurs hérités, nuls pour un format 6 et plus.
    for (let i = 0; i < 3; i++) v.setFloat64(131 + 8 * i, 0.01, true);   // échelles ; décalages (155) : 0
    const [xmin, xmax, ymin, ymax, zmin, zmax] = boite;
    v.setFloat64(179, xmax, true); v.setFloat64(187, xmin, true);
    v.setFloat64(195, ymax, true); v.setFloat64(203, ymin, true);
    v.setFloat64(211, zmax, true); v.setFloat64(219, zmin, true);
    v.setBigUint64(247, BigInt(n), true);                      // nombre de points
    v.setBigUint64(255, BigInt(n), true);                      // dont premiers retours
    return b;
  }

  /**
   * @param nuage `{ n, x, y, z, cls }` — le nuage de la 3D (`vue-relief.js`)
   * @param exclues ensemble de classes à ne pas écrire
   * @returns `{ parties, n, octets }` — `parties` se passe telle quelle à `new Blob`
   */
  function ecrire(nuage, exclues) {
    const parties = [];
    // Les points d'abord, pour que la boîte de l'en-tête soit celle des points
    // réellement écrits ; l'en-tête est ensuite placé devant.
    let n = 0;
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, zmin = Infinity, zmax = -Infinity;
    let partie = null, v = null, dansPartie = 0;
    const clore = () => { if (partie) parties.push(partie.subarray(0, dansPartie * TAILLE_POINT)); partie = null; };
    for (let i = 0; i < nuage.n; i++) {
      const c = nuage.cls[i];
      if (exclues && exclues.has(c)) continue;
      if (!partie || dansPartie === POINTS_PAR_PARTIE) {
        clore();
        partie = new Uint8Array(POINTS_PAR_PARTIE * TAILLE_POINT);
        v = new DataView(partie.buffer);
        dansPartie = 0;
      }
      const cx = Math.round(nuage.x[i] * 100), cy = Math.round(nuage.y[i] * 100), cz = Math.round(nuage.z[i] * 100);
      const o = dansPartie * TAILLE_POINT;
      v.setInt32(o, cx, true); v.setInt32(o + 4, cy, true); v.setInt32(o + 8, cz, true);
      v.setUint8(o + 14, 0x11);    // retour 1 sur 1 : un numéro de retour nul est invalide
      v.setUint8(o + 16, c);       // classification, un octet entier
      if (cx < xmin) xmin = cx; if (cx > xmax) xmax = cx;
      if (cy < ymin) ymin = cy; if (cy > ymax) ymax = cy;
      if (cz < zmin) zmin = cz; if (cz > zmax) zmax = cz;
      dansPartie++; n++;
    }
    clore();
    const boite = n ? [xmin / 100, xmax / 100, ymin / 100, ymax / 100, zmin / 100, zmax / 100] : [0, 0, 0, 0, 0, 0];
    parties.unshift(entete(n, boite));
    return { parties, n, octets: TAILLE_ENTETE + n * TAILLE_POINT };
  }

  return { ecrire, compter, TAILLE_ENTETE, TAILLE_POINT };
})();
