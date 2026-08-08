// Couche Leaflet dessinant la grille kilométrique des dalles LiDAR HD.
//
// Pourquoi ne pas simplement afficher les polygones que renvoie le WFS :
//
//   1. Le service plafonne à 600 entités. Sur une vue de 30 × 60 km, 1717
//      dalles correspondent et 600 reviennent — triées par colonne, ce qui
//      produit des bandes verticales trouées sans qu'aucune erreur ne le
//      signale. C'est exactement le défaut d'affichage observé.
//   2. Il y a 505 294 dalles en France : les précharger est hors de question.
//   3. Une requête par déplacement de carte, pour redessiner un quadrillage
//      parfaitement régulier, est un gaspillage.
//
// Or ce quadrillage se déduit : une dalle est exactement le carré
// [X·1000, (X+1)·1000] × [(Y−1)·1000, Y·1000] en Lambert-93. On le génère donc
// localement — exact par construction, instantané, jamais tronqué. Le WFS n'est
// plus interrogé que sur clic, pour un point, ce qui ne peut désigner qu'une
// dalle et échappe au plafond.
//
// Le tracé passe par un canevas unique plutôt que par des milliers d'objets
// Leaflet : une vue au zoom 12 contient environ 1 300 cellules, soit autant de
// couches vectorielles à créer et détruire à chaque déplacement.

/* global L */

const GrilleDalles = L.Layer.extend({

  initialize(options) {
    L.setOptions(this, options);
    this._blocs = [];
  },

  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create('canvas', 'scopus-grille');
    // `pointer-events: none` : la grille est un repère, pas une cible. Les clics
    // doivent traverser jusqu'à la carte, qui interroge alors le WFS au point.
    this._canvas.style.pointerEvents = 'none';
    map.getPanes().overlayPane.appendChild(this._canvas);

    // Pendant l'animation de zoom, Leaflet ne publie aucun événement de
    // déplacement continu : le canevas resterait dessiné pour l'échelle
    // précédente, visiblement décalé de la carte. On le masque le temps de
    // l'animation plutôt que d'afficher une grille fausse.
    this._masquer = () => { this._canvas.style.visibility = 'hidden'; };
    this._afficher = () => { this._canvas.style.visibility = ''; this._redessiner(); };

    map.on('move viewreset resize', this._redessiner, this);
    map.on('zoomstart', this._masquer, this);
    map.on('zoomend', this._afficher, this);
    this._redessiner();
  },

  onRemove(map) {
    map.off('move viewreset resize', this._redessiner, this);
    map.off('zoomstart', this._masquer, this);
    map.off('zoomend', this._afficher, this);
    this._canvas.remove();
  },

  /** Emprises de chantier servant de gabarit de découpe. */
  definirBlocs(blocs) {
    this._blocs = blocs || [];
    this._redessiner();
  },

  _redessiner() {
    const map = this._map;
    if (!map) return;

    const taille = map.getSize();
    const cnv = this._canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    if (cnv.width !== taille.x * dpr || cnv.height !== taille.y * dpr) {
      cnv.width = taille.x * dpr;
      cnv.height = taille.y * dpr;
      cnv.style.width = `${taille.x}px`;
      cnv.style.height = `${taille.y}px`;
    }
    // Le canevas vit dans un volet que Leaflet translate au fil du déplacement :
    // on le replace à chaque image sur le coin haut-gauche courant, sinon il
    // dérive avec la carte et le quadrillage se décale de la carte.
    L.DomUtil.setPosition(cnv, map.containerPointToLayerPoint([0, 0]));

    const ctx = cnv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, taille.x, taille.y);

    // Lambert-93 → pixel écran, en une étape.
    const versEcran = (x, y) => {
      const g = PROJ.versWGS84(x, y);
      return map.latLngToContainerPoint([g.lat, g.lon]);
    };

    // ── Emprises de chantier ────────────────────────────────────────────────
    const chemin = new Path2D();
    let aDesBlocs = false;
    for (const bloc of this._blocs) {
      for (const anneau of bloc.anneaux) {
        aDesBlocs = true;
        anneau.forEach(([lat, lon], i) => {
          const p = map.latLngToContainerPoint([lat, lon]);
          if (i === 0) chemin.moveTo(p.x, p.y); else chemin.lineTo(p.x, p.y);
        });
        chemin.closePath();
      }
    }
    if (aDesBlocs) {
      ctx.fillStyle = 'rgba(94, 200, 240, 0.10)';
      ctx.strokeStyle = 'rgba(94, 200, 240, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.fill(chemin, 'evenodd');
      ctx.stroke(chemin);
    }

    if (map.getZoom() < CONFIG.carte.zoomGrille) return;

    // ── Quadrillage kilométrique ────────────────────────────────────────────
    const b = map.getBounds();
    // Les quatre coins de la vue, reprojetés : en Lambert-93 la fenêtre n'est
    // pas alignée sur les axes, prendre seulement deux coins amputerait la
    // grille dans les angles.
    const coins = [
      PROJ.versLambert93(b.getWest(), b.getSouth()),
      PROJ.versLambert93(b.getEast(), b.getSouth()),
      PROJ.versLambert93(b.getWest(), b.getNorth()),
      PROJ.versLambert93(b.getEast(), b.getNorth()),
    ];
    const xmin = Math.floor(Math.min(...coins.map((c) => c.x)) / 1000) * 1000;
    const xmax = Math.ceil(Math.max(...coins.map((c) => c.x)) / 1000) * 1000;
    const ymin = Math.floor(Math.min(...coins.map((c) => c.y)) / 1000) * 1000;
    const ymax = Math.ceil(Math.max(...coins.map((c) => c.y)) / 1000) * 1000;

    const nbLignes = (xmax - xmin) / 1000 + (ymax - ymin) / 1000;
    if (nbLignes > CONFIG.carte.maxLignesGrille) return;

    // La grille n'est tracée qu'à l'intérieur des chantiers : ailleurs il n'y a
    // pas de LiDAR, et un quadrillage y laisserait croire le contraire.
    ctx.save();
    if (aDesBlocs) ctx.clip(chemin, 'evenodd');

    ctx.strokeStyle = 'rgba(94, 200, 240, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();

    // Une droite de Lambert-93 devient légèrement courbe une fois projetée en
    // Web Mercator. Sur un kilomètre l'écart passe sous le pixel, mais une
    // ligne qui traverse tout l'écran se voit : on l'échantillonne en segments.
    // Le nombre de segments est calculé pour que le dernier point tombe
    // exactement sur la borne — sinon la grille s'arrête avant le bord.
    const segments = (a, b) => Math.max(1, Math.ceil((b - a) / 4000));

    // `point(t)` parcourt la ligne de t = 0 à t = 1 ; le dernier échantillon
    // tombe donc exactement sur la borne.
    const tracer = (point, n) => {
      for (let i = 0; i <= n; i++) {
        const p = versEcran(...point(i / n));
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
    };

    const nY = segments(ymin, ymax);
    for (let x = xmin; x <= xmax; x += 1000) tracer((t) => [x, ymin + (ymax - ymin) * t], nY);

    const nX = segments(xmin, xmax);
    for (let y = ymin; y <= ymax; y += 1000) tracer((t) => [xmin + (xmax - xmin) * t, y], nX);
    ctx.stroke();
    ctx.restore();
  },
});

/** Emprise Lambert-93 exacte de la dalle contenant un point. */
function dalleContenant(x, y) {
  const xmin = Math.floor(x / 1000) * 1000;
  const ymin = Math.floor(y / 1000) * 1000;
  return { xmin, xmax: xmin + 1000, ymin, ymax: ymin + 1000 };
}

/**
 * Contour d'une emprise Lambert-93, en [lat, lon] pour Leaflet.
 *
 * Les côtés sont échantillonnés et non réduits à leurs extrémités : en WGS84 un
 * carré Lambert-93 n'est ni aligné sur les axes ni tout à fait droit. C'est
 * précisément l'erreur qui faisait qu'une zone d'intérêt tracée en
 * `L.rectangle` — donc alignée sur l'écran — paraissait de travers par rapport
 * à la dalle qui la contenait.
 */
function contourEmprise(em, parCote = 8) {
  const pts = [];
  const ajouter = (x, y) => { const g = PROJ.versWGS84(x, y); pts.push([g.lat, g.lon]); };
  for (let i = 0; i < parCote; i++) ajouter(em.xmin + (em.xmax - em.xmin) * i / parCote, em.ymin);
  for (let i = 0; i < parCote; i++) ajouter(em.xmax, em.ymin + (em.ymax - em.ymin) * i / parCote);
  for (let i = 0; i < parCote; i++) ajouter(em.xmax - (em.xmax - em.xmin) * i / parCote, em.ymax);
  for (let i = 0; i < parCote; i++) ajouter(em.xmin, em.ymax - (em.ymax - em.ymin) * i / parCote);
  return pts;
}

const GRILLE = { GrilleDalles, dalleContenant, contourEmprise };
