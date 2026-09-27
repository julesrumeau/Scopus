// Reprojection d'une couche de relief (grille Lambert-93) en image au pixel de
// la carte (Web Mercator). La carte pose ensuite l'image sur ses propres bornes,
// sans rien déformer : pas de glissement vers les bords, contrairement à une
// image Lambert posée sur un rectangle WGS84 (un carré Lambert-93 est tourné
// d'environ 1° en Mercator).
//
// Même technique que la photo aérienne (ortho.js), dans l'autre sens : un nœud
// de maillage tous les 32 pixels projeté exactement, l'intérieur interpolé. Les
// deux projections sont conformes, leur composition est localement une
// similitude : l'écart reste sous le dixième de case (test/vue-image.test.js).
//
// Écrit en fabrique : le worker du relief l'emporte (relief-travailleur.js).

function fabriqueVueImage() {
  const TUILE = 256;

  function pixelVersLonLat(px, py, z) {
    const n = TUILE * 2 ** z;
    return { lon: (px / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI };
  }

  /** Coordonnée continue de case (centres aux entiers) de chaque pixel. */
  function cases(geo, ecran, versLambert93, pasMaillage = 32) {
    const { W, H, x0, y0, z } = ecran;
    const nx = Math.ceil(W / pasMaillage) + 1, ny = Math.ceil(H / pasMaillage) + 1;
    const nu = new Float64Array(nx * ny), nv = new Float64Array(nx * ny);
    // Centre de la case (0, 0) : xmin + pas/2, ymin + pas/2 (RASTER.centreCellule).
    const cx0 = geo.emprise.xmin + geo.pas / 2, cy0 = geo.emprise.ymin + geo.pas / 2;
    for (let b = 0; b < ny; b++) {
      for (let a = 0; a < nx; a++) {
        // Nœuds à pas constant, le dernier au-delà du bord s'il le faut : un
        // dernier intervalle raccourci fausserait l'interpolation (piège déjà
        // payé par ortho.js, 13 px de décalage).
        const ll = pixelVersLonLat(x0 + a * pasMaillage + 0.5, y0 + b * pasMaillage + 0.5, z);
        const L = versLambert93(ll.lon, ll.lat);
        nu[b * nx + a] = (L.x - cx0) / geo.pas;
        nv[b * nx + a] = (L.y - cy0) / geo.pas;
      }
    }
    const u = new Float32Array(W * H), v = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const fb = j / pasMaillage, b = Math.min(ny - 2, Math.floor(fb)), tb = fb - b;
      for (let i = 0; i < W; i++) {
        const fa = i / pasMaillage, a = Math.min(nx - 2, Math.floor(fa)), ta = fa - a;
        const k00 = b * nx + a, k10 = k00 + 1, k01 = k00 + nx, k11 = k01 + 1;
        const k = j * W + i;
        u[k] = (nu[k00] * (1 - ta) + nu[k10] * ta) * (1 - tb) + (nu[k01] * (1 - ta) + nu[k11] * ta) * tb;
        v[k] = (nv[k00] * (1 - ta) + nv[k10] * ta) * (1 - tb) + (nv[k01] * (1 - ta) + nv[k11] * ta) * tb;
      }
    }
    return { u, v };
  }

  /**
   * L'image : chaque pixel prend la valeur de sa case, étirée sur la palette.
   * `lisser` interpole entre les centres des quatre cases voisines (quand une
   * case couvre plusieurs pixels), et retombe sur la plus proche si l'une est
   * sans valeur — comme le lissage de l'onglet 2D.
   */
  function peindre(valeurs, geo, uv, min, max, lut, lisser) {
    const { u, v } = uv;
    const n = u.length;
    const rgba = new Uint8ClampedArray(n * 4);
    const Wg = geo.W, Hg = geo.H;
    const echelle = 255 / (max - min || 1);
    for (let k = 0; k < n; k++) {
      const o = k * 4;
      rgba[o + 3] = 255;
      const uu = u[k], vv = v[k];
      const ix = Math.round(uu), iy = Math.round(vv);
      if (ix < 0 || iy < 0 || ix >= Wg || iy >= Hg) continue;
      let val = valeurs[iy * Wg + ix];
      if (lisser) {
        const x0 = Math.floor(uu), y0 = Math.floor(vv);
        if (x0 >= 0 && y0 >= 0 && x0 + 1 < Wg && y0 + 1 < Hg) {
          const fx = uu - x0, fy = vv - y0, i0 = y0 * Wg + x0;
          const bi = (valeurs[i0] * (1 - fx) + valeurs[i0 + 1] * fx) * (1 - fy)
            + (valeurs[i0 + Wg] * (1 - fx) + valeurs[i0 + Wg + 1] * fx) * fy;
          // Une voisine NaN rend la somme NaN : on garde alors la plus proche.
          if (bi === bi) val = bi;
        }
      }
      if (!(val === val)) continue;
      const i = Math.max(0, Math.min(255, Math.round((val - min) * echelle))) * 3;
      rgba[o] = lut[i]; rgba[o + 1] = lut[i + 1]; rgba[o + 2] = lut[i + 2];
    }
    return rgba;
  }

  /**
   * Même chose pour une couche déjà en couleurs (l'ombrage coloré,
   * RELIEF.ombrageRGB) : chaque pixel prend la couleur de sa case, sans
   * palette ni étirement. Une case sans valeur (alpha nul) est noire ; le
   * lissage n'interpole qu'entre quatre cases valides.
   */
  function peindreRGBA(grille, geo, uv, lisser) {
    const { u, v } = uv;
    const n = u.length;
    const rgba = new Uint8ClampedArray(n * 4);
    const Wg = geo.W, Hg = geo.H;
    for (let k = 0; k < n; k++) {
      const o = k * 4;
      rgba[o + 3] = 255;
      const uu = u[k], vv = v[k];
      if (lisser) {
        const x0 = Math.floor(uu), y0 = Math.floor(vv);
        if (x0 >= 0 && y0 >= 0 && x0 + 1 < Wg && y0 + 1 < Hg) {
          const i00 = (y0 * Wg + x0) * 4, i10 = i00 + 4, i01 = i00 + Wg * 4, i11 = i01 + 4;
          if (grille[i00 + 3] && grille[i10 + 3] && grille[i01 + 3] && grille[i11 + 3]) {
            const fx = uu - x0, fy = vv - y0;
            for (let c = 0; c < 3; c++) {
              rgba[o + c] = (grille[i00 + c] * (1 - fx) + grille[i10 + c] * fx) * (1 - fy)
                + (grille[i01 + c] * (1 - fx) + grille[i11 + c] * fx) * fy;
            }
            continue;
          }
        }
      }
      const ix = Math.round(uu), iy = Math.round(vv);
      if (ix < 0 || iy < 0 || ix >= Wg || iy >= Hg) continue;
      const i = (iy * Wg + ix) * 4;
      if (!grille[i + 3]) continue;
      rgba[o] = grille[i]; rgba[o + 1] = grille[i + 1]; rgba[o + 2] = grille[i + 2];
    }
    return rgba;
  }

  return { pixelVersLonLat, cases, peindre, peindreRGBA };
}
const VUE_IMAGE = fabriqueVueImage();
