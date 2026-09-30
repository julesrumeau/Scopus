// Écriture d'un nuage en PLY binaire : x, y, z en flottants 32 bits et la
// classe en `uchar` — 13 octets par point.
//
// L'en-tête est celui qu'exige le lecteur de FreeCAD (`PlyReader`,
// Mod/Points) : `binary_little_endian 1.0`, aucune autre version. FreeCAD lit
// toutes les propriétés d'un sommet mais n'en retient que celles qu'il
// connaît (x y z, normales, `intensity`, couleurs) : la classe passe donc sans
// erreur et y est ignorée. Blender (extension Point Cloud I/O) et CloudCompare
// la gardent, en attribut de point.
//
// Coordonnées locales, celles de la 3D : ni Lambert-93 ni CRS dans le fichier.

const PLY = (() => {
  const TAILLE_POINT = 13;
  const POINTS_PAR_PARTIE = 65536;   // ~850 Ko : jamais un tampon de la taille du fichier

  function entete(n) {
    return new TextEncoder().encode([
      'ply',
      'format binary_little_endian 1.0',
      'comment Scopus - nuage de points LiDAR HD, coordonnees locales en metres',
      `element vertex ${n}`,
      'property float x',
      'property float y',
      'property float z',
      'property uchar classification',
      'end_header',
    ].join('\n') + '\n');
  }

  function retenus(nuage, exclues) {
    let n = 0;
    for (let i = 0; i < nuage.n; i++) if (!exclues || !exclues.has(nuage.cls[i])) n++;
    return n;
  }

  /** Combien de points et d'octets donnerait `ecrire` — pour l'annoncer avant. */
  function compter(nuage, exclues) {
    const n = retenus(nuage, exclues);
    return { n, octets: entete(n).length + n * TAILLE_POINT };
  }

  /**
   * @param nuage `{ n, x, y, z, cls }` — le nuage de la 3D (`vue-relief.js`)
   * @param exclues ensemble de classes à ne pas écrire
   * @returns `{ parties, n, octets }` — `parties` se passe telle quelle à `new Blob`
   */
  function ecrire(nuage, exclues) {
    const n = retenus(nuage, exclues);
    const tete = entete(n);
    const parties = [tete];
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
      const o = dansPartie * TAILLE_POINT;
      v.setFloat32(o, nuage.x[i], true);
      v.setFloat32(o + 4, nuage.y[i], true);
      v.setFloat32(o + 8, nuage.z[i], true);
      v.setUint8(o + 12, c);
      dansPartie++;
    }
    clore();
    return { parties, n, octets: tete.length + n * TAILLE_POINT };
  }

  return { ecrire, compter, TAILLE_POINT };
})();
