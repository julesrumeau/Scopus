// Calque de contrôle du chargement piloté par la vue : le contour de chaque
// bloc chargé, coloré par niveau. Provisoire — il rend visible le plan 1
// (chargement) avant que le relief (plan 2) n'existe. Activé par « ?flux »
// dans l'adresse.

const CalqueFlux = L.LayerGroup.extend({
  initialize() {
    L.LayerGroup.prototype.initialize.call(this);
    this._parCle = new Map();
  },
  ajouter(bloc) {
    const couleurs = ['#5ec8f0', '#4ade80', '#ffd24a', '#ff9f43', '#ff6b52', '#c084fc'];
    const forme = L.polygon(GRILLE.contourEmprise(bloc.emprise), {
      color: couleurs[Math.min(bloc.niveau, couleurs.length - 1)],
      weight: 1, fillOpacity: 0.08, interactive: false,
    });
    this._parCle.set(bloc.cle, forme);
    this.addLayer(forme);
  },
  retirer(cle) {
    const f = this._parCle.get(cle);
    if (f) { this.removeLayer(f); this._parCle.delete(cle); }
  },
});

// Relief de la vue, provisoire : la couche calculée, étirée sur sa palette,
// posée en image sur la carte. Le plan 3 le remplace par un calque WebGL
// redessiné à chaque image ; celui-ci ne sert qu'à voir le calcul.
//
// L'image est posée sur le rectangle WGS84 des coins sud-ouest et nord-est de
// la grille : un carré Lambert-93 étant tourné d'environ 1° en Mercator, elle
// glisse de quelques mètres vers les bords d'une grande vue. Acceptable pour
// un contrôle, pas pour l'affichage final.
const CalqueReliefControle = L.Layer.extend({
  onAdd(map) { this._carte = map; },
  onRemove() { this.vider(); },
  vider() {
    if (this._image) { this._carte.removeLayer(this._image); this._image = null; }
    if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
  },
  afficher(r) {
    const { W, H } = r.geo;
    const lut = construireLUT(r.palette);
    const toile = document.createElement('canvas');
    toile.width = W;
    toile.height = H;
    const ctx = toile.getContext('2d');
    const img = ctx.createImageData(W, H);
    const etendue = r.max - r.min || 1;
    // Ligne 0 de la grille au sud, ligne 0 de l'image au nord.
    for (let y = 0; y < H; y++) {
      const source = (H - 1 - y) * W;
      for (let x = 0; x < W; x++) {
        const v = r.valeurs[source + x];
        if (!Number.isFinite(v)) continue;
        const i = Math.max(0, Math.min(255, Math.round(((v - r.min) / etendue) * 255))) * 3;
        const k = (y * W + x) * 4;
        img.data[k] = lut[i]; img.data[k + 1] = lut[i + 1]; img.data[k + 2] = lut[i + 2]; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const e = r.geo.emprise;
    const so = PROJ.versWGS84(e.xmin, e.ymin), ne = PROJ.versWGS84(e.xmax, e.ymax);
    const bornes = L.latLngBounds([so.lat, so.lon], [ne.lat, ne.lon]);
    toile.toBlob((blob) => {
      if (!this._carte) return;
      const ancien = this._url;
      this._url = URL.createObjectURL(blob);
      if (this._image) { this._image.setUrl(this._url); this._image.setBounds(bornes); }
      else this._image = L.imageOverlay(this._url, bornes, { opacity: 0.9, interactive: false }).addTo(this._carte);
      if (ancien) URL.revokeObjectURL(ancien);
    });
  },
});
