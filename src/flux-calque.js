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

// Le relief de la vue sur la carte, derrière un rideau comme dans l'onglet
// 2D : la carte Leaflet à gauche, le relief à droite. L'image arrive du
// worker déjà reprojetée au pixel de la carte (Web Mercator) : posée sur les
// bornes de la carte, elle tombe exactement, sans le glissement vers les bords
// qu'avait une image Lambert-93 posée sur un rectangle WGS84.
//
// Le côté droit est noir tant que rien n'y est calculé : un relief absent doit
// se voir comme absent, pas comme la carte qui transparaît.
const CalqueRelief = L.Layer.extend({
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

  /**
   * Pose l'image rendue par le worker (déjà reprojetée au pixel de la carte,
   * relief-travailleur.js) exactement sur `bornes` — celles de la carte au
   * moment de la demande : si la carte a bougé entre-temps, l'image tombe
   * quand même à sa place. Encodée dans le worker quand le navigateur le
   * permet (`blob`) ; sinon les pixels (`rgba`) passent par un canevas ici.
   */
  afficher(image, bornes) {
    const generation = ++this._generation;
    const poser = (blob) => {
      // Un vider() ou une image plus récente est passé entre-temps : celle-ci
      // est périmée, la poser ferait revenir une vue qu'on a quittée.
      if (!this._carte || !blob || generation !== this._generation) return;
      const ancien = this._url;
      this._url = URL.createObjectURL(blob);
      if (this._image) { this._image.setUrl(this._url); this._image.setBounds(bornes); }
      else this._image = L.imageOverlay(this._url, bornes, { pane: 'reliefFlux', interactive: false }).addTo(this._carte);
      if (ancien) URL.revokeObjectURL(ancien);
    };
    if (image.blob) { poser(image.blob); return; }
    const toile = document.createElement('canvas');
    toile.width = image.W;
    toile.height = image.H;
    toile.getContext('2d').putImageData(new ImageData(image.rgba, image.W, image.H), 0, 0);
    toile.toBlob(poser);
  },
});
