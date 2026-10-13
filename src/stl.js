// Export STL de la surface du relief, pour l'impression 3D. Une grille d'altitudes (une par case) devient un solide
// **fermé** : le dessus (deux triangles par case), quatre murs verticaux sur le pourtour, un dessous plat. Une surface à
// une altitude par case n'a ni dessous ni vide sous les feuilles : le solide est étanche par construction. Seules les
// cases sans donnée l'abîmeraient, d'où `combler`. Pur : aucun DOM.
//
// Repère du maillage (mètres) : x vers l'est, y vers le nord, z vers le haut, dessous à z = 0. À l'écriture, une échelle
// convertit les mètres en millimètres de la maquette (les logiciels de découpe lisent un STL en millimètres).

const STL = (() => {
  const TRIANGLES_PAR_PARTIE = 65536;   // ~3,3 Mo : jamais un tampon de la taille du fichier

  /** Nombre de sommets et de triangles d'une grille W × H. */
  function compter(W, H) {
    return { triangles: 2 * (W - 1) * (H - 1) + 4 * (W - 1) + 4 * (H - 1) + 2 * (W + H - 2) };
  }

  /**
   * Remplit les cases sans donnée (NaN) par la moyenne de leurs voisines, de proche en proche. Une grille sans aucune
   * donnée devient plate à 0. L'entrée n'est pas modifiée.
   */
  function combler(z, W, H) {
    const out = Float32Array.from(z);
    let manquantes = [];
    for (let i = 0; i < out.length; i++) if (Number.isNaN(out[i])) manquantes.push(i);
    const remplies = manquantes.length;
    if (remplies === out.length) { out.fill(0); return { z: out, remplies }; }
    while (manquantes.length) {
      const pose = [];
      const reste = [];
      for (const k of manquantes) {
        const x = k % W, y = (k - x) / W;
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const a = x + dx, b = y + dy;
            if ((dx || dy) && a >= 0 && b >= 0 && a < W && b < H) {
              const v = out[b * W + a];
              if (!Number.isNaN(v)) { s += v; n++; }
            }
          }
        }
        if (n) pose.push([k, s / n]); else reste.push(k);
      }
      // Posées après le balayage : une case remplie ne sert pas aux voisines du même passage (pas de dérive).
      for (const [k, v] of pose) out[k] = v;
      manquantes = reste;
    }
    return { z: out, remplies };
  }

  /** Ramène la grille sous `max` cases par côté, par moyenne de blocs entiers ; le pas grandit d'autant. */
  function reduire(z, W, H, pas, max) {
    const facteur = Math.max(1, Math.ceil(Math.max(W, H) / max));
    if (facteur === 1) return { z, W, H, pas, facteur };
    const W2 = Math.ceil(W / facteur), H2 = Math.ceil(H / facteur);
    const out = new Float32Array(W2 * H2);
    for (let j = 0; j < H2; j++) {
      for (let i = 0; i < W2; i++) {
        let s = 0, n = 0;
        for (let b = j * facteur; b < Math.min(H, (j + 1) * facteur); b++) {
          for (let a = i * facteur; a < Math.min(W, (i + 1) * facteur); a++) {
            const v = z[b * W + a];
            if (!Number.isNaN(v)) { s += v; n++; }
          }
        }
        out[j * W2 + i] = n ? s / n : NaN;
      }
    }
    return { z: out, W: W2, H: H2, pas: pas * facteur, facteur };
  }

  /**
   * Le solide fermé. `z` : altitudes (m) sans NaN, `W × H` cases de côté `pas` (m). `epaisseurM` : épaisseur de la base
   * sous le point le plus bas.
   * @returns `{ sommets: Float32Array (x y z), triangles: Uint32Array (3 indices chacun), nbTriangles }`
   */
  function maillage({ z, W, H, pas, epaisseurM }) {
    let zmin = Infinity;
    for (let i = 0; i < z.length; i++) if (z[i] < zmin) zmin = z[i];
    const nHaut = W * H;
    const bas = new Int32Array(nHaut).fill(-1);
    const perimetre = [];   // indices du dessus, dans le sens inverse des aiguilles d'une montre vu d'en haut
    for (let i = 0; i < W - 1; i++) perimetre.push(i);
    for (let j = 0; j < H - 1; j++) perimetre.push(j * W + (W - 1));
    for (let i = W - 1; i > 0; i--) perimetre.push((H - 1) * W + i);
    for (let j = H - 1; j > 0; j--) perimetre.push(j * W);
    const nSommets = nHaut + perimetre.length + 1;
    const sommets = new Float32Array(nSommets * 3);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        sommets[3 * k] = i * pas; sommets[3 * k + 1] = j * pas; sommets[3 * k + 2] = z[k] - zmin + epaisseurM;
      }
    }
    perimetre.forEach((k, r) => {
      const s = nHaut + r;
      bas[k] = s;
      sommets[3 * s] = sommets[3 * k]; sommets[3 * s + 1] = sommets[3 * k + 1]; sommets[3 * s + 2] = 0;
    });
    const centre = nSommets - 1;
    sommets[3 * centre] = (W - 1) * pas / 2; sommets[3 * centre + 1] = (H - 1) * pas / 2; sommets[3 * centre + 2] = 0;

    const nb = compter(W, H).triangles;
    const tri = new Uint32Array(nb * 3);
    let t = 0;
    const T = (a, b, c) => { tri[t++] = a; tri[t++] = b; tri[t++] = c; };
    const Q = (a, b, c, d) => { T(a, b, c); T(a, c, d); };   // a, b, c, d dans le sens direct vu de l'extérieur

    for (let j = 0; j < H - 1; j++) {
      for (let i = 0; i < W - 1; i++) {
        const a = j * W + i, b = a + 1, c = a + W + 1, d = a + W;
        T(a, b, c); T(a, c, d);
      }
    }
    for (let i = 0; i < W - 1; i++) {
      const s0 = i, s1 = i + 1, n0 = (H - 1) * W + i, n1 = n0 + 1;
      Q(bas[s0], bas[s1], s1, s0);        // mur sud, vu du sud
      Q(bas[n1], bas[n0], n0, n1);        // mur nord, vu du nord
    }
    for (let j = 0; j < H - 1; j++) {
      const o0 = j * W, o1 = o0 + W, e0 = o0 + W - 1, e1 = o1 + W - 1;
      Q(bas[o1], bas[o0], o0, o1);        // mur ouest, vu de l'ouest
      Q(bas[e0], bas[e1], e1, e0);        // mur est, vu de l'est
    }
    // Dessous : éventail depuis un sommet central (aucun triangle dégénéré, aucune arête en T).
    for (let r = 0; r < perimetre.length; r++) T(centre, nHaut + ((r + 1) % perimetre.length), nHaut + r);
    return { sommets, triangles: tri, nbTriangles: nb };
  }

  /** Largeur réelle (m) vers largeur de la maquette (mm) : millimètres de maquette par mètre de terrain. */
  const echelleDepuisLargeur = (largeurM, largeurMm) => largeurMm / largeurM;

  /** STL binaire : 80 octets d'en-tête, le nombre de triangles, puis 50 octets par triangle. `parties` va tel quel dans un Blob. */
  function ecrire(m, { echelle = 1 } = {}) {
    const tete = new Uint8Array(84);
    new TextEncoder().encodeInto('Scopus LiDAR HD, STL binaire, millimetres', tete);
    new DataView(tete.buffer).setUint32(80, m.nbTriangles, true);
    const parties = [tete];
    const { sommets: s, triangles: tri } = m;
    for (let debut = 0; debut < m.nbTriangles; debut += TRIANGLES_PAR_PARTIE) {
      const n = Math.min(TRIANGLES_PAR_PARTIE, m.nbTriangles - debut);
      const partie = new Uint8Array(n * 50);
      const v = new DataView(partie.buffer);
      for (let q = 0; q < n; q++) {
        const base = (debut + q) * 3;
        const p = [0, 1, 2].map((e) => [s[3 * tri[base + e]] * echelle, s[3 * tri[base + e] + 1] * echelle, s[3 * tri[base + e] + 2] * echelle]);
        const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
        const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
        let nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
        const l = Math.hypot(nx, ny, nz) || 1;
        if (l === 1 && !nx && !ny && !nz) nz = 1; else { nx /= l; ny /= l; nz /= l; }
        const o = q * 50;
        v.setFloat32(o, nx, true); v.setFloat32(o + 4, ny, true); v.setFloat32(o + 8, nz, true);
        for (let e = 0; e < 3; e++) for (let c = 0; c < 3; c++) v.setFloat32(o + 12 + 12 * e + 4 * c, p[e][c], true);
      }
      parties.push(partie);
    }
    return { parties, octets: 84 + 50 * m.nbTriangles };
  }

  const groupes = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const poids = (o) => (o >= 1e6 ? `${(o / 1e6).toFixed(o >= 1e8 ? 0 : 1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(o / 1e3))} Ko`);

  /** Ce que donnerait l'export, annoncé avant : triangles, poids, taille de la maquette. */
  function resume({ W, H, pas, largeurMm }) {
    const { triangles } = compter(W, H);
    const octets = 84 + 50 * triangles;
    const largeurM = (W - 1) * pas;
    const echelle = echelleDepuisLargeur(largeurM, largeurMm);
    const hauteurMm = (H - 1) * pas * echelle;
    return {
      triangles, octets, echelle, hauteurMm,
      texte: `${groupes(W)} × ${groupes(H)} cases de ${String(pas.toFixed(2)).replace('.', ',')} m, ${groupes(triangles)} triangles, environ ${poids(octets)}. `
        + `Maquette de ${groupes(largeurMm)} × ${groupes(hauteurMm)} mm.`,
    };
  }

  /**
   * De la grille des classes choisies aux données prêtes à écrire : réduite sous `maxCotes` (déjà le cas en pratique), comblée, maillée à l'échelle de la maquette
   * (la largeur voulue en mm fixe l'échelle ; l'épaisseur de la base est en mm de maquette). `maillage` est en mètres de terrain,
   * `echelle` les convertit à l'écriture.
   */
  function preparer(grille, { largeurMm, epaisseurMm, maxCotes }) {
    if (grille.W < 2 || grille.H < 2) throw new Error('Zone trop petite pour une maquette : zoomez moins.');
    const r = reduire(grille.z, grille.W, grille.H, grille.pas, maxCotes);
    const c = combler(r.z, r.W, r.H);
    const echelle = echelleDepuisLargeur((r.W - 1) * r.pas, largeurMm);
    const maille = maillage({ z: c.z, W: r.W, H: r.H, pas: r.pas, epaisseurM: epaisseurMm / echelle });
    return { z: c.z, W: r.W, H: r.H, pas: r.pas, remplies: c.remplies, echelle, maillage: maille, resume: resume({ W: r.W, H: r.H, pas: r.pas, largeurMm }) };
  }

  /** Le fichier : `{ parties, octets }` pour un Blob. */
  const construire = (p) => ecrire(p.maillage, { echelle: p.echelle });

  return { compter, combler, reduire, maillage, ecrire, echelleDepuisLargeur, resume, preparer, construire };
})();
