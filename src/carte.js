// Carte Leaflet : fonds IGN, couverture LiDAR, grille kilométrique, sélection
// de dalle, marqueurs de détection.
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
//     qu'une dalle. Cliquer une dalle, c'est choisir de l'analyser **en entier**
//     — un sous-carré de 250 m était trop petit pour y chercher quoi que ce
//     soit, et la rastérisation incrémentale rend le kilomètre carré tenable.

/* global L */

const ATTRIBUTION = '<a href="https://www.ign.fr/">IGN</a> — Géoplateforme';

class Carte {
  constructor(element, callbacks) {
    this.cb = callbacks;

    const v = CONFIG.carte.vueInitiale;
    this.map = L.map(element, { zoomControl: true, preferCanvas: true })
      .setView([v.lat, v.lon], v.zoom);

    // Les tuiles ne se chargent qu'une fois le geste fini, et pas pendant.
    //
    // Tout le projet tape sur le **même hôte** — tuiles WMTS, WFS des blocs,
    // dalle au point, BD TOPO, et les centaines de requêtes de plage du COPC —
    // donc sur une seule connexion HTTP/2. Leaflet, lui, ne passe pas par la
    // file bornée de `reseau.js` : un déplacement de carte lance des dizaines de
    // tuiles d'un coup, sans limite. Ajoutez un téléchargement de dalle en cours
    // et le serveur refuse d'ouvrir un flux de plus — `REFUSED_STREAM`, qui
    // arrive côté `fetch` comme une panne réseau franche et consomme les
    // réessais de requêtes qui, elles, comptent.
    //
    // `updateWhenIdle` attend la fin du déplacement, `updateWhenZooming` celle du
    // zoom, et `keepBuffer` réduit la couronne de tuiles hors écran demandées en
    // prime. Le prix est un affichage qui se remplit à la fin du geste plutôt
    // que pendant — invisible en pratique, la carte servant surtout à désigner
    // une dalle.
    const tuiles = { attribution: ATTRIBUTION, updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1 };
    const plan = L.tileLayer(IGN.gabaritWMTS('plan'), { ...tuiles, maxZoom: 19 });
    const ortho = L.tileLayer(IGN.gabaritWMTS('ortho'), { ...tuiles, maxZoom: 21 });
    // Une tuile refusée est redemandée, jusqu'à trois fois.
    //
    // Même cause que le réessai des 400 dans `reseau.js` : la passerelle répond
    // par intermittence « Layer ORTHOIMAGERY.ORTHOPHOTOS unknown » à une URL
    // valide, qui marche à l'essai suivant. Leaflet, lui, ne réessaie jamais —
    // il laisse un trou gris dans la carte, définitivement. Sur vingt tuiles
    // demandées d'affilée, quatre à huit manquaient.
    //
    // Le `src` est vidé avant d'être réécrit : réaffecter la même chaîne ne
    // relance pas forcément le chargement.
    for (const couche of [plan, ortho]) {
      couche.on('tileerror', (e) => {
        const img = e.tile;
        const url = img.src;
        if (!url) return;
        const n = (img._reprises = (img._reprises || 0) + 1);
        if (n > 3) return;
        img.src = '';
        setTimeout(() => { img.src = url; }, 350 * n * (0.7 + Math.random() * 0.6));
      });
    }

    ortho.addTo(this.map);
    L.control.layers({ 'Photo aérienne': ortho, 'Plan IGN': plan }, null, { collapsed: true }).addTo(this.map);

    this.grille = new GRILLE.GrilleDalles().addTo(this.map);
    this.coucheDetections = L.layerGroup().addTo(this.map);
    this.coucheSentiers = L.layerGroup().addTo(this.map);
    this.rectDalle = null;
    this.dalleSelectionnee = null;
    this.rectChargee = null;
    this.dalleChargee = null;
    this.marqueurs = new Map();
    this.chargementBlocs = null;

    // Le rafraîchissement est différé : un déplacement continu déclencherait
    // une requête WFS par image.
    let minuteur = null;
    this.map.on('moveend zoomend', () => {
      clearTimeout(minuteur);
      // 300 ms suffisaient tant que la carte était seule à parler à l'IGN. Une
      // demi-seconde évite qu'un enchaînement de petits déplacements ne mette
      // trois requêtes WFS en vol au moment précis où les tuiles repartent.
      minuteur = setTimeout(() => this.rafraichirBlocs(), 500);
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
    this.selectionnerDalle(dalle);
  }

  selectionnerDalle(dalle) {
    this.dalleSelectionnee = dalle;

    if (this.rectDalle) this.map.removeLayer(this.rectDalle);
    // Contour reconstruit depuis l'emprise kilométrique exacte, et non depuis la
    // géométrie du WFS : c'est ce qui garantit qu'il se superpose au pixel près
    // à la grille tracée localement.
    this.rectDalle = L.polygon(GRILLE.contourEmprise(dalle.emprise), {
      color: '#ffd24a', weight: 2, fillColor: '#ffd24a', fillOpacity: 0.06, interactive: false,
    }).addTo(this.map);

    this.cb.surDalle?.(dalle);
  }

  /**
   * Marque la dalle dont le nuage est en mémoire. `null` efface la marque.
   *
   * Deux carrés distincts, et c'est le but : le vert dit ce qui est chargé et
   * analysé, le jaune ce qu'on vient de désigner. Tant qu'il n'y en avait qu'un,
   * choisir une autre dalle laissait l'écran montrer la précédente sans que rien
   * ne dise laquelle des deux on regardait.
   */
  marquerChargee(dalle) {
    if (this.rectChargee) { this.map.removeLayer(this.rectChargee); this.rectChargee = null; }
    this.dalleChargee = dalle || null;
    if (!dalle) return;

    this.rectChargee = L.polygon(GRILLE.contourEmprise(dalle.emprise), {
      color: '#4ade80', weight: 2, fillColor: '#4ade80', fillOpacity: 0.10, interactive: false,
    }).addTo(this.map);
    // Sous le carré de sélection : quand les deux coïncident — le cas juste
    // après un chargement — c'est le liseré jaune qui doit rester lisible.
    this.rectChargee.bringToBack();
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

  /** Tracés de sentiers, en polylignes. */
  afficherSentiers(traces, surSelection) {
    this.coucheSentiers.clearLayers();
    this.lignes = new Map();

    for (const s of traces) {
      const l = L.polyline(s.gps, this._styleTrace(s, false))
        .bindTooltip(`#${s.rang} · ${s.longueur.toFixed(0)} m · creux ${(s.profondeurMed * 100).toFixed(0)} cm`,
          { sticky: true })
        .on('click', (e) => { L.DomEvent.stopPropagation(e); surSelection(s); });
      this.coucheSentiers.addLayer(l);
      this.lignes.set(s.id, l);
    }
  }

  _styleTrace(s, choisi) {
    const couleur = s.score > 0.6 ? '#ff8a3c' : s.score > 0.4 ? '#ffc247' : '#ffe9a3';
    return {
      color: choisi ? '#ffffff' : couleur,
      weight: choisi ? 5 : 3,
      opacity: choisi ? 1 : 0.85,
    };
  }

  surlignerSentier(trace, traces) {
    for (const s of traces) this.lignes?.get(s.id)?.setStyle(this._styleTrace(s, trace && s.id === trace.id));
    if (trace) {
      const l = this.lignes?.get(trace.id);
      l?.bringToFront();
      if (l) this.map.fitBounds(l.getBounds(), { padding: [60, 60] });
    }
  }

  effacerSentiers() { this.coucheSentiers.clearLayers(); this.lignes?.clear(); }

  effacerDetections() {
    this.coucheDetections.clearLayers();
    this.marqueurs.clear();
  }

  invalider() { this.map.invalidateSize(); }
}
