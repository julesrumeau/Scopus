// Carte Leaflet : fonds IGN, grille des dalles LiDAR, zone d'intérêt
// déplaçable, marqueurs de détection.

/* global L */

const ATTRIBUTION = '<a href="https://www.ign.fr/">IGN</a> — Géoplateforme';

class Carte {
  constructor(element, callbacks) {
    this.cb = callbacks;

    this.map = L.map(element, { zoomControl: true, preferCanvas: true })
      .setView([42.87, 1.42], 12);   // Ariège, vallée de Vicdessos

    const plan = L.tileLayer(IGN.gabaritWMTS('plan'), { attribution: ATTRIBUTION, maxZoom: 19 });
    const ortho = L.tileLayer(IGN.gabaritWMTS('ortho'), { attribution: ATTRIBUTION, maxZoom: 21 });
    ortho.addTo(this.map);
    L.control.layers({ 'Photo aérienne': ortho, 'Plan IGN': plan }, null, { collapsed: true }).addTo(this.map);

    this.coucheDalles = L.layerGroup().addTo(this.map);
    this.coucheDetections = L.layerGroup().addTo(this.map);
    this.rectDalle = null;
    this.rectAOI = null;
    this.dalleSelectionnee = null;
    this.aoi = null;
    this.dallesConnues = new Map();
    this.marqueurs = new Map();

    // Le rafraîchissement de la grille est différé : un déplacement continu
    // déclencherait une requête WFS par image.
    let minuteur = null;
    const planifier = () => {
      clearTimeout(minuteur);
      minuteur = setTimeout(() => this.rafraichirDalles(), 350);
    };
    this.map.on('moveend zoomend', planifier);
    this.map.on('click', (e) => this._surClic(e));

    this.rafraichirDalles();
  }

  /**
   * Charge la grille des dalles couvrant la fenêtre courante.
   *
   * En dessous du zoom 11 la grille kilométrique devient illisible et la requête
   * ramènerait des milliers d'entités : on s'abstient plutôt que de saturer le
   * service.
   */
  async rafraichirDalles() {
    const z = this.map.getZoom();
    this.cb.surZoom?.(z);
    if (z < 11) { this.coucheDalles.clearLayers(); this.dallesConnues.clear(); return; }

    const b = this.map.getBounds();
    let liste;
    try {
      liste = await IGN.dalles(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
    } catch (e) {
      this.cb.surErreur?.(`Grille des dalles : ${e.message}`);
      return;
    }

    this.coucheDalles.clearLayers();
    for (const d of liste) {
      this.dallesConnues.set(d.nom, d);
      const poly = L.polygon(d.anneau, {
        color: '#5ec8f0', weight: 1, opacity: 0.55,
        fillColor: '#5ec8f0', fillOpacity: 0.05, interactive: false,
      });
      this.coucheDalles.addLayer(poly);
    }
    this.cb.surDalles?.(liste.length);
  }

  _surClic(e) {
    const { lat, lng } = e.latlng;
    const p = PROJ.versLambert93(lng, lat);

    // Recherche par emprise plutôt que par test point-dans-polygone : les
    // emprises sont des carrés kilométriques exacts déduits du nom de dalle, et
    // le polygone WFS n'est que leur reprojection approchée en WGS84.
    let trouvee = null;
    for (const d of this.dallesConnues.values()) {
      const em = d.emprise;
      if (p.x >= em.xmin && p.x < em.xmax && p.y >= em.ymin && p.y < em.ymax) { trouvee = d; break; }
    }
    if (!trouvee) { this.cb.surErreur?.('Aucune dalle LiDAR HD à cet endroit (zoom ≥ 11 requis).'); return; }

    this.selectionnerDalle(trouvee, p);
  }

  selectionnerDalle(dalle, pointClic = null) {
    this.dalleSelectionnee = dalle;

    if (this.rectDalle) this.map.removeLayer(this.rectDalle);
    this.rectDalle = L.polygon(dalle.anneau, {
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

    const so = PROJ.versWGS84(this.aoi.xmin, this.aoi.ymin);
    const ne = PROJ.versWGS84(this.aoi.xmax, this.aoi.ymax);

    if (this.rectAOI) this.map.removeLayer(this.rectAOI);
    this.rectAOI = L.rectangle([[so.lat, so.lon], [ne.lat, ne.lon]], {
      color: '#4ade80', weight: 2, dashArray: '5 4', fillColor: '#4ade80', fillOpacity: 0.12,
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
