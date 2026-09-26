// Le MNT LiDAR HD de l'IGN, en WMS, pour les vues trop larges pour les points.
//
// Au-delà de CONFIG.flux.surfaceMaxPointsKm2, les points coûteraient une
// requête par dalle pour un niveau 0 trop grossier : le MNT de l'IGN, calculé
// par eux depuis les mêmes points, natif à 50 cm, arrive en une image à la
// taille demandée. Mesuré : 1 km² en ~6 s, une sous-zone de 500 m en moins
// d'une seconde, CORS ouvert. Flottants petit-boutistes, ligne 0 au nord,
// -9999 hors couverture — vérifié sur une vraie réponse.

const MNT_IGN = (() => {
  const COUCHE = 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93';
  const SANS_DONNEE = -9000;   // tout ce qui est en dessous

  function url(geo) {
    const e = geo.emprise;
    const p = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', LAYERS: COUCHE, STYLES: '',
      CRS: 'EPSG:2154', FORMAT: 'image/x-bil;bits=32',
      WIDTH: String(geo.W), HEIGHT: String(geo.H),
      BBOX: `${e.xmin},${e.ymin},${e.xmax},${e.ymax}`,
    });
    return `https://data.geopf.fr/wms-r/wms?${p}`;
  }

  function lire(octets, geo) {
    const { W, H } = geo;
    const N = W * H;
    if (octets.byteLength !== N * 4) {
      throw new Error(`MNT de l'IGN : ${octets.byteLength} octets reçus, ${N * 4} attendus`);
    }
    // RESEAU.recuperer rend un Uint8Array, peut-être vue d'un tampon plus grand.
    const dv = octets instanceof ArrayBuffer ? new DataView(octets) : new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
    const mnt = new Float32Array(N), valide = new Uint8Array(N);
    let somme = 0, nb = 0;
    for (let y = 0; y < H; y++) {
      const ligne = (H - 1 - y) * W;   // l'image commence au nord
      for (let x = 0; x < W; x++) {
        const v = dv.getFloat32((ligne + x) * 4, true);
        const i = y * W + x;
        if (v > SANS_DONNEE) { mnt[i] = v; valide[i] = 1; somme += v; nb++; }
      }
    }
    // Même convention que RELIEF.preparer : une altitude de repli là où rien
    // n'est connu, la validité disant qu'il ne faut pas y croire.
    const repli = nb ? somme / nb : 0;
    for (let i = 0; i < N; i++) if (!valide[i]) mnt[i] = repli;
    return {
      W, H, N, pas: geo.pas, mnt, valide, hauteur: new Float32Array(N), trou: new Float32Array(N),
      emprise: geo.emprise, origine: [geo.emprise.xmin, geo.emprise.ymin, 0],
    };
  }

  async function charger(geo, recuperer, signal) {
    return lire(await recuperer(url(geo), { signal, file: 'tuiles' }), geo);
  }

  return { url, lire, charger };
})();
