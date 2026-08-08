// Carte Leaflet : fonds IGN, couverture LiDAR, grille kilométrique, zone
// d'intérêt, marqueurs de détection.
//
// Trois principes, chacun corrigeant un défaut constaté :
//
//   · La **couverture** vient de la couche « bloc » du WFS, valable partout en
//     France et jamais tronquée. Elle s'affiche à tous les zooms : plus besoin
//     de zoomer à l'aveugle pour découvrir s'il y a du LiDAR.
//   · La **grille** kilométrique est générée localement (`grille.js`), pas
//     téléchargée : exacte par construction, sans le plafond de 600 entités qui
//     laissait des bandes vides.
//   · La **sélection** interroge le WFS en un point, ce qui ne peut désigner
//     qu'une dalle.

/* global L */

const ATTRIBUTION = '<a href="https://www.ign.fr/">IGN</a> — Géoplateforme';

class Carte {
  constructor(element, callbacks) {
    this.cb = callbacks;

    const v = CONFIG.carte.vueInitiale;
    this.map = L.map(element, { zoomControl: true, preferCanvas: true })
      .setView([v.lat, v.lon], v.zoom);

    const plan = L.tileLayer(IGN.gabaritWMTS('plan'), { attribution: ATTRIBUTION, maxZoom: 19 });
    const ortho = L.tileLayer(IGN.gabaritWMTS('ortho'), { attribution: ATTRIBUTION, maxZoom: 21 });
    ortho.addTo(this.map);
    L.control.layers({ 'Photo aérienne': ortho, 'Plan IGN': plan }, null, { collapsed: true }).addTo(this.map);

    this.grille = new GRILLE.GrilleDalles().addTo(this.map);
    this.coucheDetections = L.layerGroup().addTo(this.map);
    this.rectDalle = null;
    this.rectAOI = null;
    this.dalleSelectionnee = null;
    this.aoi = null;
    this.marqueurs = new Map();
    this.chargementBlocs = null;

    // Le rafraîchissement est différé : un déplacement continu déclencherait
    // une requête WFS par image.
    let minuteur = null;
    this.map.on('moveend zoomend', () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => this.rafraichirBlocs(), 300);
    });
    this.map.on('click', (e) => this._surClic(e));

    this.rafraichirBlocs();
  }

  /** Charge les emprises de chantier couvrant la fenêtre courante. */
  async rafraichirBlocs() {
    const b = this.map.getBounds();
    // Une seule requête à la fois : pendant un déplacement rapide, les réponses
    // arriveraient dans le désordre et la dernière affichée ne serait pas celle
    // de la vue courante.
    this.chargementBlocs?.abort();
    const ctrl = new AbortController();
    this.chargementBlocs = ctrl;

    try {
      const liste = await IGN.blocs(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), ctrl.signal);
      if (ctrl.signal.aborted) return;
      this.grille.definirBlocs(liste);
      this.cb.surCouverture?.(liste.length, this.map.getZoom());
    } catch (e) {
      if (e.name !== 'AbortError') this.cb.surErreur?.(`Couverture LiDAR : ${e.message}`);
    }
  }

  async _surClic(e) {
    const { lat, lng } = e.latlng;
    this.cb.surRecherche?.('Recherche de la dalle…');

    let dalle;
    try {
      dalle = await IGN.dalleAuPoint(lng, lat);
    } catch (err) {
      this.cb.surErreur?.(`Dalle : ${err.message}`);
      return;
    }
    if (!dalle) {
      this.cb.surErreur?.('Pas de dalle LiDAR HD à cet endroit — la zone n’a pas encore été volée.');
      return;
    }
    this.selectionnerDalle(dalle, PROJ.versLambert93(lng, lat));
  }

  selectionnerDalle(dalle, pointClic = null) {
    this.dalleSelectionnee = dalle;

    if (this.rectDalle) this.map.removeLayer(this.rectDalle);
    // Contour reconstruit depuis l'emprise kilométrique exacte, et non depuis la
    // géométrie du WFS : c'est ce qui garantit qu'il se superpose au pixel près
    // à la grille tracée localement.
    this.rectDalle = L.polygon(GRILLE.contourEmprise(dalle.emprise), {
      color: '#ffd24a', weight: 2, fillColor: '#ffd24a', fillOpacity: 0.06, interactive: false,
    }).addTo(this.map);

    const centre = pointClic || {
      x: (dalle.emprise.xmin + dalle.emprise.xmax) / 2,
      y: (dalle.emprise.ymin + dalle.emprise.ymax) / 2,
    };
    this.definirAOI(centre.x, centre.y, this.aoi?.cote ?? CONFIG.nuage.aoiParDefautM);
    this.cb.surDalle?.(dalle);
  }

  /**
   * Place la zone d'intérêt, en la contraignant à la dalle sélectionnée.
   *
   * Le débordement est refusé plutôt que découpé : une zone à cheval sur deux
   * dalles produirait un nuage tronqué sur un bord, et la détection y verrait
   * des structures fantômes le long de la coupure.
   */
  definirAOI(cx, cy, cote) {
    const d = this.dalleSelectionnee;
    if (!d) return;
    const em = d.emprise;
    const demi = Math.min(cote, em.xmax - em.xmin, em.ymax - em.ymin) / 2;

    cx = Math.max(em.xmin + demi, Math.min(em.xmax - demi, cx));
    cy = Math.max(em.ymin + demi, Math.min(em.ymax - demi, cy));

    this.aoi = {
      cote: demi * 2,
      xmin: cx - demi, xmax: cx + demi,
      ymin: cy - demi, ymax: cy + demi,
    };

    if (this.rectAOI) this.map.removeLayer(this.rectAOI);
    // Polygone des quatre côtés reprojetés, et non `L.rectangle` : un rectangle
    // Leaflet est aligné sur les axes de l'écran, alors qu'un carré Lambert-93
    // apparaît légèrement tourné en WGS84. La zone semblait donc de travers
    // dans la dalle qui la contient — c'était bien un défaut, pas une illusion.
    this.rectAOI = L.polygon(GRILLE.contourEmprise(this.aoi), {
      color: '#4ade80', weight: 2, dashArray: '5 4', fillColor: '#4ade80', fillOpacity: 0.12,
      interactive: false,
    }).addTo(this.map);

    this.cb.surAOI?.(this.aoi);
  }

  redimensionnerAOI(cote) {
    if (!this.aoi) return;
    this.definirAOI((this.aoi.xmin + this.aoi.xmax) / 2, (this.aoi.ymin + this.aoi.ymax) / 2, cote);
  }

  cadrerAOI() {
    if (this.rectAOI) this.map.fitBounds(this.rectAOI.getBounds(), { padding: [40, 40] });
  }

  /** Recentre la carte sur un résultat de recherche. */
  allerA(lon, lat, zoom = 15) {
    this.map.setView([lat, lon], Math.max(this.map.getZoom(), zoom));
  }

  /** Marqueurs des détections, colorés par score. */
  afficherDetections(candidats, surSelection) {
    this.coucheDetections.clearLayers();
    this.marqueurs.clear();

    for (const c of candidats) {
      const m = L.circleMarker([c.lat, c.lon], this._styleMarqueur(c, false))
        .bindTooltip(`#${c.rang} · ${c.surface.toFixed(0)} m² · score ${c.score.toFixed(2)}`, { direction: 'top' })
        .on('click', (e) => { L.DomEvent.stopPropagation(e); surSelection(c); });
      this.coucheDetections.addLayer(m);
      this.marqueurs.set(c.id, m);
    }
  }

  _styleMarqueur(c, selectionne) {
    const couleur = c.dejaRepertorie ? '#7d8794'
      : c.score > 0.65 ? '#ff5a3c'
      : c.score > 0.45 ? '#ffa62b'
      : '#ffe066';
    return {
      radius: selectionne ? 11 : 7,
      color: selectionne ? '#ffffff' : couleur,
      weight: selectionne ? 3 : 2,
      fillColor: couleur,
      fillOpacity: c.dejaRepertorie ? 0.3 : 0.75,
    };
  }

  surlignerDetection(candidat, candidats) {
    for (const c of candidats) {
      const m = this.marqueurs.get(c.id);
      if (m) m.setStyle(this._styleMarqueur(c, candidat && c.id === candidat.id));
    }
    if (candidat) {
      const m = this.marqueurs.get(candidat.id);
      m?.bringToFront();
      this.map.setView([candidat.lat, candidat.lon], Math.max(this.map.getZoom(), 18));
    }
  }

  effacerDetections() {
    this.coucheDetections.clearLayers();
    this.marqueurs.clear();
  }

  invalider() { this.map.invalidateSize(); }
}
