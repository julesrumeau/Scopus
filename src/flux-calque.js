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
// posée en image sur la carte, derrière un rideau comme dans l'onglet 2D — la
// carte Leaflet à gauche, le relief à droite. Le plan 3 le remplace par un
// calque WebGL redessiné à chaque image ; celui-ci ne sert qu'à voir le calcul.
//
// Le côté droit est noir tant que rien n'y est calculé : un relief absent doit
// se voir comme absent, pas comme la carte qui transparaît.
//
// L'image est posée sur le rectangle WGS84 des coins sud-ouest et nord-est de
// la grille : un carré Lambert-93 étant tourné d'environ 1° en Mercator, elle
// glisse de quelques mètres vers les bords d'une grande vue. Acceptable pour
// un contrôle, pas pour l'affichage final.
const CalqueReliefControle = L.Layer.extend({
  onAdd(map) {
    this._carte = map;
    this._generation = 0;
    this._part = 0.5;
    // Un volet à lui, au-dessus des contours de blocs, découpé à la position du
    // rideau. Le fond noir et l'image y vivent ensemble : le découpage leur
    // vaut à tous deux.
    this._volet = map.getPane('reliefFlux') || map.createPane('reliefFlux');
    this._volet.style.zIndex = 450;
    this._volet.style.pointerEvents = 'none';
    this._noir = L.DomUtil.create('div', '', this._volet);
    Object.assign(this._noir.style, {
      position: 'absolute', left: '-500000px', top: '-500000px', width: '1000000px', height: '1000000px', background: '#000',
    });
    this._creerRideau(map.getContainer());
    map.on('move zoomend viewreset resize', this._decouper, this);
    this._decouper();
  },

  onRemove(map) {
    map.off('move zoomend viewreset resize', this._decouper, this);
    this.vider();
    this._noir.remove();
    this._rideau.remove();
    this._volet.style.clipPath = '';
    this._carte = null;
  },

  /** Libellé du côté droit, collé au rideau. */
  definirLibelle(texte) {
    this._libelleDroit.textContent = texte;
  },

  _creerRideau(conteneur) {
    const r = this._rideau = L.DomUtil.create('div', 'rideau rideau-flux', conteneur);
    L.DomUtil.create('div', 'rideau-poignee', r).title = 'Glisser pour comparer la carte et le relief';
    L.DomUtil.create('span', 'rideau-flux-libelle gauche', r).textContent = 'Carte';
    this._libelleDroit = L.DomUtil.create('span', 'rideau-flux-libelle droite', r);
    // Le geste appartient au rideau, pas à la carte : sans ça, tirer le rideau
    // déplacerait la carte en même temps.
    L.DomEvent.disableClickPropagation(r);
    L.DomEvent.on(r, 'pointerdown mousedown touchstart wheel', L.DomEvent.stopPropagation);
    let tire = false;   // un drapeau, pas hasPointerCapture (voir le rideau 2D)
    r.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      tire = true;
      r.classList.add('tire');
      try { r.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    });
    r.addEventListener('pointermove', (e) => {
      if (!tire) return;
      const b = conteneur.getBoundingClientRect();
      if (b.width > 0) { this._part = Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)); this._decouper(); }
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      r.addEventListener(type, (e) => {
        tire = false;
        r.classList.remove('tire');
        try { r.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
      });
    }
  },

  /**
   * Découpe le volet à la position du rideau. Le volet vit en coordonnées de
   * calque, qui glissent avec la carte : la limite se recalcule à chaque
   * mouvement depuis la position à l'écran.
   */
  _decouper() {
    if (!this._carte) return;
    const x = this._carte.getSize().x * this._part;
    const lx = this._carte.containerPointToLayerPoint([x, 0]).x;
    this._volet.style.clipPath = `inset(-1000000px -1000000px -1000000px ${lx}px)`;
    this._rideau.style.left = `${this._part * 100}%`;
  },

  vider() {
    this._generation++;   // une image en cours d'encodage n'a plus à s'afficher
    if (this._image) { this._carte.removeLayer(this._image); this._image = null; }
    if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
  },

  afficher(r) {
    const generation = ++this._generation;
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
      // Un vider() ou un calcul plus récent est passé entre-temps : cette
      // image est périmée, la poser ferait revenir une vue qu'on a quittée.
      if (!this._carte || !blob || generation !== this._generation) return;
      const ancien = this._url;
      this._url = URL.createObjectURL(blob);
      if (this._image) { this._image.setUrl(this._url); this._image.setBounds(bornes); }
      else this._image = L.imageOverlay(this._url, bornes, { pane: 'reliefFlux', interactive: false }).addTo(this._carte);
      if (ancien) URL.revokeObjectURL(ancien);
    });
  },
});
