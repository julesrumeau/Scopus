// Photo aérienne rééchantillonnée dans la grille Lambert-93.
//
// Le point qui décide de tout : les tuiles WMTS arrivent en **Web Mercator**,
// les grilles sont en **Lambert-93**. Un carré Lambert-93 est tourné d'environ
// 1° en Mercator, soit une vingtaine de mètres en travers d'une dalle :
// superposer les deux naïvement les ferait glisser l'une sur l'autre.
//
// Des deux issues possibles, celle-ci est la retenue : **garder le canevas
// Lambert-93 et y déformer la photo**. Le relief garde sa lecture au pixel —
// une cellule, un pixel, aucun rééchantillonnage — et l'artefact tombe sur la
// photo, qui n'est que du contexte. C'est le bon endroit pour perdre de la
// précision. L'autre issue (une carte Leaflet avec le relief en surcouche)
// obligerait à reprojeter le relief, c'est-à-dire à lui faire perdre la netteté
// qui le rend lisible.
//
// Rien n'est mis en cache ici : c'est l'appelant qui garde le raster d'une
// dalle, comme il garde ses couches de relief.

const ORTHO = (() => {

// Grille « PM » du WMTS de l'IGN : Web Mercator sphérique, tuiles de 256 px,
// le monde entier dans une tuile au niveau 0.
const TUILE = 256;
const R = 6378137;                    // rayon de la sphère de Mercator
const CIRC = 2 * Math.PI * R;         // 40 075 016,686 m
const ORIGINE = -CIRC / 2;            // coin haut-gauche du niveau 0, en mètres

/** Taille d'un pixel, en mètres à l'équateur, au niveau `z`. */
const resolution = (z) => CIRC / (TUILE * 2 ** z);

/**
 * Niveau de tuile dont le pixel au sol est au plus égal au pas de la grille.
 *
 * Sur-échantillonner la photo est sans intérêt — elle n'y gagne aucun détail —
 * et sous-échantillonner la rend floue là où on compare justement des formes de
 * quelques mètres. On prend donc le niveau juste assez fin, et pas plus : chaque
 * niveau supplémentaire quadruple le nombre de tuiles à demander.
 *
 * Le plafond à 19 n'est pas décoratif : au-delà, la passerelle répond 404. Mesuré
 * en Ariège, à Paris et en Vanoise — c'est le plafond de la couche, partout, et
 * non une limite régionale. `CONFIG.carte.zoomTuilesMax` porte le même chiffre.
 */
function zoomPour(pasM, latDeg, zMax = 19) {
  const cos = Math.cos(latDeg * Math.PI / 180);
  const z = Math.ceil(Math.log2(CIRC * cos / (TUILE * pasM)));
  return Math.max(8, Math.min(zMax, z));
}

/** Coordonnées en pixels du niveau `z`, origine au coin haut-gauche du monde. */
function versPixelPM(lonDeg, latDeg, z) {
  const res = resolution(z);
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latDeg)) * Math.PI / 180;
  const x = R * lonDeg * Math.PI / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + lat / 2));
  return [(x - ORIGINE) / res, (-y - ORIGINE) / res];
}

/**
 * Maillage de correspondance grille → pixels Mercator, interpolé bilinéairement.
 *
 * Une projection inverse par pixel de sortie ferait quatre millions d'appels sur
 * une dalle. Inutile : Lambert-93 et Mercator sont **tous deux conformes**, donc
 * leur composition est localement une similitude, dont l'échelle ne varie que de
 * 1,5·10⁻⁷ par mètre en latitude. Sur un pas de maillage de 64 cellules, l'écart
 * à l'interpolation linéaire est très inférieur au pixel — mesuré, et non
 * supposé : `test/ortho.test.js` le compare au calcul exact sur une dalle
 * entière.
 */
function maillage(emprise, pas, W, H, z, pasMaillage = 64) {
  const nx = Math.ceil(W / pasMaillage) + 1;
  const ny = Math.ceil(H / pasMaillage) + 1;
  const px = new Float64Array(nx * ny);
  const py = new Float64Array(nx * ny);

  // Les nœuds restent à pas constant, quitte à ce que le dernier tombe hors de
  // la grille : les ramener sur le bord romprait l'espacement, et
  // `interpoler` — qui divise par le pas — lirait alors la dernière bande avec
  // un poids faux. Mesuré : 13 px d'erreur, soit six mètres au sol.
  for (let j = 0; j < ny; j++) {
    // **La ligne 0 est au sud**, comme dans toutes les grilles du projet
    // (`RASTER.centreCellule` : y = ymin + (cy + 0,5)·pas). L'image est ensuite
    // retournée à l'affichage, qui met le nord en haut. Prendre ici la
    // convention inverse — ligne 0 au nord, celle des images — donne une photo
    // parfaitement lisible et parfaitement retournée par rapport au relief.
    const cy = j * pasMaillage;
    const y = emprise.ymin + cy * pas;
    for (let i = 0; i < nx; i++) {
      const cx = i * pasMaillage;
      const g = PROJ.versWGS84(emprise.xmin + cx * pas, y);
      const [a, b] = versPixelPM(g.lon, g.lat, z);
      px[j * nx + i] = a;
      py[j * nx + i] = b;
    }
  }
  return { nx, ny, px, py, pasMaillage };
}

/** Position en pixels Mercator du centre de la cellule (cx, cy) de la grille. */
function interpoler(m, cx, cy) {
  const u = cx / m.pasMaillage, v = cy / m.pasMaillage;
  const i = Math.min(m.nx - 2, u | 0), j = Math.min(m.ny - 2, v | 0);
  const fu = u - i, fv = v - j;
  const k = j * m.nx + i;
  const w00 = (1 - fu) * (1 - fv), w10 = fu * (1 - fv);
  const w01 = (1 - fu) * fv, w11 = fu * fv;
  return [
    m.px[k] * w00 + m.px[k + 1] * w10 + m.px[k + m.nx] * w01 + m.px[k + m.nx + 1] * w11,
    m.py[k] * w00 + m.py[k + 1] * w10 + m.py[k + m.nx] * w01 + m.py[k + m.nx + 1] * w11,
  ];
}

/** Emprise en pixels Mercator du contour de la grille, marge comprise. */
function empriseTuiles(m) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < m.px.length; i++) {
    if (m.px[i] < xmin) xmin = m.px[i];
    if (m.px[i] > xmax) xmax = m.px[i];
    if (m.py[i] < ymin) ymin = m.py[i];
    if (m.py[i] > ymax) ymax = m.py[i];
  }
  // Un pixel de marge : l'échantillonnage bilinéaire lit la cellule suivante.
  return { xmin: xmin - 2, xmax: xmax + 2, ymin: ymin - 2, ymax: ymax + 2 };
}

/**
 * Charge la mosaïque de tuiles et la rééchantillonne dans la grille.
 *
 * Rend un RGBA de W × H, une entrée par cellule — donc directement superposable
 * aux couches de relief, qui vivent sur la même grille.
 *
 * Les tuiles passent par `RESEAU.recuperer`, comme tout le reste : file bornée,
 * réessais, et le 400 fantôme de la passerelle traité comme transitoire. Leaflet
 * ne passe pas par là, ce qui est précisément la raison de son `updateWhenIdle`.
 */
async function charger(emprise, pas, W, H, opts = {}) {
  const { signal, surProgres, zMax = 19 } = opts;
  const t0 = performance.now();
  const centre = PROJ.versWGS84((emprise.xmin + emprise.xmax) / 2, (emprise.ymin + emprise.ymax) / 2);
  const z = zoomPour(pas, centre.lat, zMax);

  const m = maillage(emprise, pas, W, H, z);
  const b = empriseTuiles(m);
  const tx0 = Math.floor(b.xmin / TUILE), tx1 = Math.floor(b.xmax / TUILE);
  const ty0 = Math.floor(b.ymin / TUILE), ty1 = Math.floor(b.ymax / TUILE);
  const ntx = tx1 - tx0 + 1, nty = ty1 - ty0 + 1;

  const gabarit = IGN.gabaritWMTS('ortho');
  const total = ntx * nty;
  let faites = 0, manquantes = 0;

  const toile = document.createElement('canvas');
  toile.width = ntx * TUILE;
  toile.height = nty * TUILE;
  const ctx = toile.getContext('2d', { willReadFrequently: true });

  const demandes = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const url = gabarit.replace('{z}', z).replace('{x}', tx).replace('{y}', ty);
      demandes.push((async () => {
        try {
          const octets = await RESEAU.recuperer(url, { signal });
          const image = await createImageBitmap(new Blob([octets], { type: 'image/jpeg' }));
          ctx.drawImage(image, (tx - tx0) * TUILE, (ty - ty0) * TUILE);
          image.close?.();
        } catch (e) {
          if (signal?.aborted) throw e;
          // Une tuile manquante laisse un trou, elle ne fait pas échouer la
          // photo entière : une zone sans orthophoto est un cas normal, et le
          // relief, lui, est là.
          manquantes++;
        }
        surProgres?.(++faites, total);
      })());
    }
  }
  await Promise.all(demandes);

  const mosaique = ctx.getImageData(0, 0, toile.width, toile.height).data;
  const mw = toile.width, mh = toile.height;
  const rgba = new Uint8ClampedArray(W * H * 4);

  // `cy` est un indice de cellule, pas une ligne d'image : il compte vers le
  // nord, comme `mnt`, `hauteur` et `trou`, avec lesquels ce raster partage son
  // indexation.
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < W; cx++) {
      const [gx, gy] = interpoler(m, cx + 0.5, cy + 0.5);
      const sx = gx - tx0 * TUILE, sy = gy - ty0 * TUILE;
      const o = (cy * W + cx) * 4;
      if (sx < 0 || sy < 0 || sx >= mw - 1 || sy >= mh - 1) { rgba[o + 3] = 0; continue; }

      // Bilinéaire : la photo est agrandie d'un facteur proche de 1, mais un
      // échantillonnage au plus proche ferait battre les bords de toit d'un
      // pixel à l'autre le long de la rotation de 1°.
      const x0 = sx | 0, y0 = sy | 0;
      const fx = sx - x0, fy = sy - y0;
      const k00 = (y0 * mw + x0) * 4, k10 = k00 + 4;
      const k01 = k00 + mw * 4, k11 = k01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy, w11 = fx * fy;
      for (let c = 0; c < 3; c++) {
        rgba[o + c] = mosaique[k00 + c] * w00 + mosaique[k10 + c] * w10
          + mosaique[k01 + c] * w01 + mosaique[k11 + c] * w11;
      }
      rgba[o + 3] = 255;
    }
  }

  return { rgba, W, H, zoom: z, tuiles: total, manquantes, duree: performance.now() - t0 };
}

return { charger, zoomPour, versPixelPM, maillage, interpoler, resolution, TUILE };
})();
