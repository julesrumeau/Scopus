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
  constructor(element) {
    this.map = L.map(element, {
      zoomControl: true,
      preferCanvas: true,
      // Borne explicite : sans elle, le zoom maximal de la carte serait celui
      // de la couche la plus permissive, et l'on zoomerait dans le vide.
      maxZoom: CONFIG.carte.zoomMax,
    });

    // La France entière au départ, cadrée sur l'emprise plutôt qu'à un zoom
    // fixe — le zoom qui va bien dépend de la taille de la fenêtre.
    //
    // `fitBounds` a besoin d'un conteneur mesurable : monté masqué, Leaflet le
    // mesure à zéro et le cadrage part en vrille. D'où le repli, qui donne au
    // moins une vue plausible ; `invalidateSize` fera le reste au retour sur
    // l'onglet.
    const e = CONFIG.carte.empriseInitiale;
    const r = CONFIG.carte.vueDeRepli;
    if (element.clientWidth > 0 && element.clientHeight > 0) {
      this.map.fitBounds([[e.sud, e.ouest], [e.nord, e.est]], { padding: [10, 10] });
    } else {
      this.map.setView([r.lat, r.lon], r.zoom);
    }

    // Les tuiles ne se chargent qu'une fois le geste fini, et pas pendant.
    //
    // Tout le projet tape sur le **même hôte** — tuiles WMTS, WFS des dalles,
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
    //
    // `maxNativeZoom` est l'autre moitié de la borne : au-delà du dernier niveau
    // servi, Leaflet **agrandit la dernière tuile** au lieu d'en demander qui
    // n'existent pas. Sans lui, chaque tuile revenait en 404 et la carte
    // devenait entièrement grise — sans rien pour dire pourquoi, ce qui se lit
    // comme une panne de l'outil.
    const tuiles = {
      attribution: ATTRIBUTION,
      updateWhenIdle: true,
      updateWhenZooming: false,
      keepBuffer: 1,
      maxZoom: CONFIG.carte.zoomMax,
      maxNativeZoom: CONFIG.carte.zoomTuilesMax,
    };
    // Une couche de fond IGN, avec ses réglages et ses réessais — aussi pour
    // un côté du rideau en vue normale (app.js), qui en pose une dans son volet.
    this.nouveauFond = (cle, options = {}) => {
      // Un fond OpenStreetMap : son serveur, son attribution, son Referer (`fonds-osm.js`). Pas de
      // réessai sur erreur : insister sur un serveur qui refuse ne ferait qu'aggraver le blocage.
      const osm = FONDS_OSM.parCle[cle];
      if (osm) return L.tileLayer(osm.url, { ...tuiles, ...osm.options, ...options });
      const couche = L.tileLayer(IGN.gabaritWMTS(cle), { ...tuiles, ...options });
      reessayer(couche);
      return couche;
    };
    const plan = L.tileLayer(IGN.gabaritWMTS('plan'), tuiles);
    const ortho = L.tileLayer(IGN.gabaritWMTS('ortho'), tuiles);
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
    const reessayer = (couche) => {
      couche.on('tileload', () => this._majAvisPanne(true));
      couche.on('tileerror', (e) => {
        const img = e.tile;
        const url = img.src;
        if (!url) return;
        // Hors des territoires de l'IGN, pas de tuile (404) : ni réessai, ni
        // avis de panne — rien n'est cassé.
        const { x, y, z } = e.coords;
        const n2 = 2 ** z;
        const lon = ((x + 0.5) / n2) * 360 - 180;
        const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n2))) * 180) / Math.PI;
        if (!PROJ.territoireAuPoint(lon, lat)) return;
        const n = (img._reprises = (img._reprises || 0) + 1);
        if (n > 3) { this._majAvisPanne(false); return; }
        img.src = '';
        setTimeout(() => { img.src = url; }, 350 * n * (0.7 + Math.random() * 0.6));
      });
    };
    for (const couche of [plan, ortho]) reessayer(couche);

    ortho.addTo(this.map);
    this.controleFonds = L.control.layers({ 'Photo aérienne': ortho, 'Plan IGN': plan }, null, { collapsed: true }).addTo(this.map);

    // Dire qu'on est au maximum, plutôt que de laisser croire à une image
    // dégradée sans raison. Le bouton « + » de Leaflet se grise tout seul à la
    // borne ; ce qui manquait, c'était la phrase.
    this._avisZoom = L.control({ position: 'bottomleft' });
    this._avisZoom.onAdd = () => {
      const d = L.DomUtil.create('div', 'avis-zoom');
      d.textContent = `Zoom maximal — les images de l'IGN s'arrêtent au niveau `
        + `${CONFIG.carte.zoomTuilesMax} : la vue est agrandie, pas plus détaillée.`;
      return d;
    };
    this._avisZoom.addTo(this.map);
    this.map.on('zoomend', () => this._majAvisZoom());
    this._majAvisZoom();

    // Avis de panne du fond de carte — distinct de l'avis de zoom ci-dessus,
    // et de la file bornée de `reseau.js` : les tuiles Plan IGN / Photo
    // aérienne ne passent pas par elle, se chargent sans qu'on clique sur
    // rien, et n'affichaient jusqu'ici aucun message quand `data.geopf.fr`
    // reste indisponible — une tuile ratée devenait juste grise, en silence,
    // et le rechargement à chaque déplacement de carte donnait l'impression
    // d'un échec sans fin plutôt que d'un problème identifiable.
    //
    // Le compteur ne retient que les échecs **consécutifs** : une tuile isolée
    // qui rate ses 3 reprises est courante (le 400 fantôme de l'IGN, § pièges
    // connus) et n'importe rien ; il faut plusieurs tuiles en échec de suite,
    // sans qu'aucune n'ait réussi entre-temps, pour distinguer une vraie panne
    // d'un accident isolé.
    this._echecsTuilesConsecutifs = 0;
    this._avisPanne = L.control({ position: 'bottomleft' });
    this._avisPanne.onAdd = () => {
      const d = L.DomUtil.create('div', 'avis-zoom avis-panne');
      d.textContent = 'Le fond de carte de l’IGN ne répond pas. Réessayez plus tard.';
      d.hidden = true;
      return d;
    };
    this._avisPanne.addTo(this.map);

    // L'IGN laisse pendre des requêtes (reseau.js, `RESEAU.lenteRecente`) :
    // le relief arrive par à-coups, et sans un mot on croirait Scopus en
    // panne. En haut à droite, sous les libellés du rideau : en bas, la
    // feuille du téléphone le cacherait.
    this._avisIGN = L.control({ position: 'topright' });
    this._avisIGN.onAdd = () => {
      const d = L.DomUtil.create('div', 'avis-zoom avis-ign');
      d.textContent = 'Les serveurs de l’IGN semblent un peu chargés en ce moment : le relief '
        + 'peut mettre plus de temps à s’afficher. Scopus réessaie automatiquement, merci de votre patience.';
      d.hidden = true;
      return d;
    };
    this._avisIGN.addTo(this.map);
  }

  /** Montre ou retire l'avis de lenteur de l'IGN. */
  avisLenteurIGN(visible) {
    const el = this._avisIGN.getContainer();
    if (el) el.hidden = !visible;
  }

  _majAvisZoom() {
    const el = this._avisZoom.getContainer();
    if (el) el.hidden = this.map.getZoom() <= CONFIG.carte.zoomTuilesMax;
  }

  /** Suit les échecs consécutifs de tuiles de fond ; affiche l'avis au-delà du seuil. */
  _majAvisPanne(succes) {
    this._echecsTuilesConsecutifs = succes ? 0 : this._echecsTuilesConsecutifs + 1;
    const el = this._avisPanne.getContainer();
    if (el) el.hidden = this._echecsTuilesConsecutifs < CONFIG.carte.echecsTuilesPourAvis;
  }

  /** Recentre la carte sur un résultat de recherche. */
  allerA(lon, lat, zoom = 15) {
    this.map.setView([lat, lon], Math.max(this.map.getZoom(), zoom));
  }

  invalider() { this.map.invalidateSize(); }
}
