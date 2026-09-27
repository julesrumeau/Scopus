// Calque de diagnostic du chargement piloté par la vue : le contour de chaque
// bloc chargé, coloré par niveau, pour voir ce qui arrive et dans quel ordre.
// Activé par « &debug » dans l'adresse.

/**
 * Le geste d'un rideau de comparaison : glisser la bande `el` place la limite
 * à la position du pointeur dans `conteneur`, en part de sa largeur. Commun au
 * rideau de l'onglet 2D et à celui de la carte.
 *
 * L'état du geste est tenu par un drapeau, et non par `hasPointerCapture` : la
 * capture est une commodité, pas une source de vérité — elle échoue si le
 * pointeur n'est plus actif, et le rideau resterait alors sourd au mouvement.
 * Elle garde le geste sur la poignée quand il sort de la bande, ce qui arrive
 * dès qu'on tire un peu vite.
 */
function brancherRideau(el, conteneur, placer) {
  let tire = false;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tire = true;
    el.classList.add('tire');
    try { el.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (!tire) return;
    const b = conteneur.getBoundingClientRect();
    if (b.width > 0) placer((e.clientX - b.left) / b.width);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    el.addEventListener(type, (e) => {
      tire = false;
      el.classList.remove('tire');
      try { el.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
    });
  }
}

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
// 2D : chaque côté porte la carte, un fond de tuiles ou une couche de relief
// (app.js, `cotes`). L'image arrive du
// worker déjà reprojetée au pixel de la carte (Web Mercator) : posée sur les
// bornes de la carte, elle tombe exactement, sans le glissement vers les bords
// qu'avait une image Lambert-93 posée sur un rectangle WGS84.
//
// Sous le relief, un côté porte un voile sur la carte : là où rien n'est
// calculé (vue trop large, blocs pas encore arrivés, case sans sol), la carte
// se voit, assombrie — un relief absent doit se lire comme absent, sans
// l'écran noir d'avant. Le relief le recouvre à mesure qu'il se calcule : les
// pixels sans valeur de l'image sont transparents (VUE_IMAGE.peindre).
const CalqueRelief = L.Layer.extend({
  onAdd(map) {
    this._carte = map;
    this._part = 0.5;
    // Un volet par côté, découpé à la position du rideau : le relief peut être
    // à gauche comme à droite, comme dans l'onglet 2D. Le voile et l'image
    // d'un côté vivent dans son volet : le découpage leur vaut à tous deux.
    // Un côté qui porte la carte a son volet masqué — la carte transparaît.
    this._cotes = {};
    for (const cote of ['gauche', 'droite']) {
      const nom = cote === 'gauche' ? 'reliefGauche' : 'reliefDroite';
      const volet = map.getPane(nom) || map.createPane(nom);
      volet.style.zIndex = 450;
      volet.style.pointerEvents = 'none';
      // Immense, pour couvrir le volet où que la carte ait glissé ; sa teinte
      // est dans styles.css (.voile-relief).
      const voile = L.DomUtil.create('div', 'voile-relief', volet);
      this._cotes[cote] = { nom, volet, voile, image: null, url: null, generation: 0, actif: cote === 'droite', fond: null };
      volet.style.display = this._cotes[cote].actif ? '' : 'none';
    }
    this._creerRideau(map.getContainer());
    map.on('move zoomend viewreset resize', this._decouper, this);
    this._decouper();
  },

  onRemove(map) {
    map.off('move zoomend viewreset resize', this._decouper, this);
    for (const cote of ['gauche', 'droite']) {
      this.definirFond(cote, null);
      this.vider(cote);
      this._cotes[cote].voile.remove();
      this._cotes[cote].volet.style.clipPath = '';
    }
    this._rideau.remove();
    this._carte = null;
  },

  /** Libellé d'un côté, collé au rideau. */
  definirLibelle(cote, texte) {
    this._libelles[cote].textContent = texte;
  },

  /**
   * Un côté porte-t-il du relief (volet visible, voilé tant que rien n'est
   * calculé), ou la carte (volet masqué) ?
   */
  definirActif(cote, actif) {
    const c = this._cotes[cote];
    c.actif = actif;
    c.volet.style.display = actif ? '' : 'none';
    if (!actif) this.vider(cote);
  },

  /**
   * Un fond de tuiles (le Plan IGN…) posé dans un côté, ou `null` pour le
   * retirer. La carte principale n'a qu'un fond à la fois ; ainsi un côté
   * peut montrer la photo et l'autre le plan. Le côté doit être actif.
   */
  definirFond(cote, couche) {
    const c = this._cotes[cote];
    if (c.fond) { this._carte.removeLayer(c.fond); c.fond = null; }
    if (couche) { this.vider(cote); c.fond = couche.addTo(this._carte); }
  },

  /** Position du rideau, en part de la largeur. */
  placerRideau(part) {
    this._part = Math.max(0, Math.min(1, part));
    this._decouper();
  },

  /** Le côté du rideau sous un point de la carte (pixels du conteneur). */
  coteSous(x) {
    return x < this._carte.getSize().x * this._part ? 'gauche' : 'droite';
  },

  _creerRideau(conteneur) {
    const r = this._rideau = L.DomUtil.create('div', 'rideau rideau-flux', conteneur);
    L.DomUtil.create('div', 'rideau-poignee', r).title = 'Glisser pour comparer les deux côtés';
    this._libelles = {
      gauche: L.DomUtil.create('span', 'rideau-flux-libelle gauche', r),
      droite: L.DomUtil.create('span', 'rideau-flux-libelle droite', r),
    };
    // Le geste appartient au rideau, pas à la carte : sans ça, tirer le rideau
    // déplacerait la carte en même temps.
    L.DomEvent.disableClickPropagation(r);
    L.DomEvent.on(r, 'pointerdown mousedown touchstart wheel', L.DomEvent.stopPropagation);
    brancherRideau(r, conteneur, (part) => this.placerRideau(part));
  },

  /**
   * Découpe les volets à la position du rideau : le droit garde ce qui est à
   * droite de la limite, le gauche ce qui est à gauche. Les volets vivent en
   * coordonnées de calque, qui glissent avec la carte : la limite se
   * recalcule à chaque mouvement depuis la position à l'écran. Un volet est
   * une boîte vide posée à l'origine du calque ; ses bords de découpe se
   * mesurent donc depuis cette origine.
   */
  _decouper() {
    if (!this._carte) return;
    const x = this._carte.getSize().x * this._part;
    const lx = this._carte.containerPointToLayerPoint([x, 0]).x;
    this._cotes.droite.volet.style.clipPath = `inset(-1000000px -1000000px -1000000px ${lx}px)`;
    this._cotes.gauche.volet.style.clipPath = `inset(-1000000px ${-lx}px -1000000px -1000000px)`;
    this._rideau.style.left = `${this._part * 100}%`;
  },

  vider(cote) {
    const c = this._cotes[cote];
    c.generation++;   // une image en cours d'encodage n'a plus à s'afficher
    if (c.image) { this._carte.removeLayer(c.image); c.image = null; }
    if (c.url) { URL.revokeObjectURL(c.url); c.url = null; }
  },

  /**
   * Pose l'image rendue par le worker (déjà reprojetée au pixel de la carte,
   * relief-travailleur.js) exactement sur `bornes` — celles de la carte au
   * moment de la demande : si la carte a bougé entre-temps, l'image tombe
   * quand même à sa place. Encodée dans le worker quand le navigateur le
   * permet (`blob`) ; sinon les pixels (`rgba`) passent par un canevas ici.
   */
  afficher(cote, image, bornes) {
    const c = this._cotes[cote];
    if (!c.actif) return;
    const generation = ++c.generation;
    const poser = (blob) => {
      // Un vider() ou une image plus récente est passé entre-temps : celle-ci
      // est périmée, la poser ferait revenir une vue qu'on a quittée.
      if (!this._carte || !blob || generation !== c.generation) return;
      const ancien = c.url;
      c.url = URL.createObjectURL(blob);
      if (c.image) { c.image.setUrl(c.url); c.image.setBounds(bornes); }
      else c.image = L.imageOverlay(c.url, bornes, { pane: c.nom, interactive: false }).addTo(this._carte);
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
