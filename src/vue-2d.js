// Vue 2D : une carte de la dalle, nord en haut, en Lambert-93 — et **deux
// couches à la fois**, l'une à gauche, l'autre à droite d'un rideau qu'on
// glisse.
//
// Pourquoi un canevas 2D et pas la carte Leaflet : la grille *est* en
// Lambert-93. La dessiner telle quelle, une cellule pour un pixel, évite toute
// reprojection et tout rééchantillonnage — on regarde la donnée, pas une
// interprétation de la donnée. Superposer les détections et les tracés est
// gratuit pour la même raison : eux aussi sont en Lambert-93. Et c'est la photo
// aérienne qui vient se déformer ici (`ortho.js`), parce que l'artefact de
// rééchantillonnage doit tomber sur le contexte, jamais sur la mesure.
//
// Le rideau est la démonstration même de l'outil : une structure invisible sur
// la photo apparaît dans le relief, et on le voit d'un seul geste. Les deux
// côtés partagent tout — même caméra, même échelle, même grille — donc rien ne
// glisse quand on déplace la vue.
//
// Les gestes sont ceux de la vue 3D — glisser déplace, la molette zoome sous le
// curseur — et le rendu est à la demande, pour la même raison qu'ailleurs : une
// image fixe redessinée soixante fois par seconde ne change rien à l'écran.

const COTES = ['gauche', 'droite'];

class Vue2D {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks;

    this.grille = null;      // sortie de RELIEF.preparer
    // Une source par côté : soit une couche calculée (valeurs + palette), soit
    // la photo aérienne (RGBA déjà dans la grille). Les deux vivent sur les
    // mêmes cellules, ce qui rend le rideau exact au pixel.
    this.sources = { gauche: null, droite: null };
    this.rideau = 0.5;       // position du rideau, en part de la largeur
    this.contraste = CONFIG.relief.contraste;
    this.detections = [];
    this.traces = [];
    this.selection = null;
    this.traceChoisie = null;
    this.pointSelectionne = null;   // [x, y] Lambert-93, voir definirPointSelectionne
    this.montrerDetections = true;
    this.montrerSentiers = true;
    // Mode sélection : un clic vise un point (coordonnées) plutôt que de
    // choisir une détection — commutable depuis l'extérieur, partagé avec la
    // vue 3D.
    this.modeSelection = false;

    // Caméra : centre visé en Lambert-93, et mètres par pixel écran.
    this.centre = [0, 0];
    this.echelle = 1;

    this._planifie = false;
    this.actif = false;
    this._brancherControles();
  }

  demarrer() {
    if (this.actif) return;
    this.actif = true;
    this._observateur = new ResizeObserver(() => this.invalider());
    this._observateur.observe(this.canvas);
    this.invalider();
  }

  invalider() {
    if (!this.actif || this._planifie) return;
    this._planifie = true;
    requestAnimationFrame(() => { this._planifie = false; this._rendre(); });
  }

  definirGrille(t) {
    this.grille = t;
    this.sources = { gauche: null, droite: null };
    if (t) this.cadrer();
    else this.invalider();
  }

  /**
   * Installe la source d'un côté du rideau.
   *
   * `{ type: 'couche', couche, libelle }` pour une couche calculée par
   * `RELIEF.calculer`, `{ type: 'photo', rgba, libelle }` pour l'orthophoto
   * rééchantillonnée par `ORTHO.charger`.
   *
   * La palette est précalculée en 256 entrées : une conversion par pixel et par
   * image, sur un canevas plein écran, ferait plusieurs millions d'appels.
   */
  definirSource(cote, source) {
    this.sources[cote] = source
      ? { ...source, lut: source.type === 'couche' ? construireLUT(source.couche.palette) : null }
      : null;
    this.invalider();
  }

  source(cote) { return this.sources[cote]; }

  /** Couche calculée d'un côté, ou `null` si ce côté porte la photo. */
  couche(cote) {
    const s = this.sources[cote];
    return s && s.type === 'couche' ? s.couche : null;
  }

  /** Position du rideau, en part de la largeur. */
  definirRideau(part) {
    this.rideau = Math.max(0, Math.min(1, part));
    this.invalider();
  }

  /**
   * Change le contraste sans rien recalculer.
   *
   * Seul l'intervalle étalé sur la palette bouge : les valeurs, elles, sont
   * déjà là. Une image de plus coûte quelques millisecondes, là où refaire un
   * Sky-View Factor à chaque cran du curseur en coûterait des milliers.
   */
  definirContraste(c) {
    this.contraste = c;
    this.invalider();
  }

  /** Intervalle réellement étalé sur la palette d'un côté, contraste compris. */
  etendue(cote) {
    const c = this.couche(cote);
    if (!c) return [0, 1];
    return RELIEF.etirer(c.base, c.ancrage, this.contraste);
  }

  definirDetections(candidats, grilleDetection) {
    this.detections = (candidats || []).map((c) => ({
      id: c.id,
      rang: c.rang,
      boite: boiteLambert(c, grilleDetection),
      score: c.score,
      repertorie: c.dejaRepertorie,
    })).filter((d) => d.boite);
    this.invalider();
  }

  definirSelection(candidat) { this.selection = candidat ? candidat.id : null; this.invalider(); }

  /** Marqueur du point choisi en mode Sélection. `p` : [x, y] Lambert-93, ou `null`. */
  definirPointSelectionne(p) { this.pointSelectionne = p; this.invalider(); }

  definirTraces(traces) {
    this.traces = (traces || []).map((s) => ({ id: s.id, points: s.points || [] }));
    this.invalider();
  }

  definirTraceChoisie(trace) { this.traceChoisie = trace ? trace.id : null; this.invalider(); }

  definirCalques({ detections, sentiers }) {
    if (detections !== undefined) this.montrerDetections = detections;
    if (sentiers !== undefined) this.montrerSentiers = sentiers;
    this.invalider();
  }

  /** Cadre la dalle entière. */
  cadrer() {
    if (!this.grille) return;
    const e = this.grille.emprise;
    this.centre = [(e.xmin + e.xmax) / 2, (e.ymin + e.ymax) / 2];
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // Marge de 4 % pour que le bord de dalle ne colle pas au cadre.
    this.echelle = Math.max((e.xmax - e.xmin) / (w * dpr), (e.ymax - e.ymin) / (h * dpr)) * 1.04;
    this.invalider();
  }

  /** Amène un point Lambert-93 au centre, à une échelle donnée. */
  viser(x, y, metresParEcran = 120) {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, r.width * dpr);
    this.centre = [x, y];
    this.echelle = metresParEcran / w;
    this.invalider();
  }

  // ── Contrôles ─────────────────────────────────────────────────────────────

  _lambertSousCurseur(ev) {
    const r = this.canvas.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = (ev.clientX - r.left) * dpr;
    const py = (ev.clientY - r.top) * dpr;
    const w = r.width * dpr, h = r.height * dpr;
    return [
      this.centre[0] + (px - w / 2) * this.echelle,
      // L'écran descend, le nord monte.
      this.centre[1] - (py - h / 2) * this.echelle,
    ];
  }

  _brancherControles() {
    const c = this.canvas;
    let glisse = null;

    // Point de départ en pixels, gardé pour distinguer un clic d'un glissé :
    // relâcher après un déplacement produit aussi un `click`, et sans ce test
    // chaque déplacement finissant sur une boîte sélectionnerait la détection.
    let depart = null;

    // Pincement à deux doigts : `wheel` ne se déclenche jamais pour un geste
    // tactile réel (seul le pinch de pavé tactile passe par là, en `wheel` +
    // `ctrlKey`) — sans ce suivi, aucun zoom n'est possible au doigt. Un
    // deuxième doigt qui touche par accident pendant un glissé (la paume, un
    // pouce) est le cas courant à ne pas laisser corrompre le déplacement en
    // cours, d'où le passage explicite en mode pincement dès deux pointeurs.
    const doigts = new Map();
    let pince = null;
    let pinceUtilisee = false;

    const milieu = () => {
      const [a, b] = [...doigts.values()];
      return { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
    };
    const ecart = () => {
      const [a, b] = [...doigts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (doigts.size >= 2) {
        glisse = null;
        pinceUtilisee = true;
        pince = { distance: ecart(), lambert: this._lambertSousCurseur(milieu()) };
        return;
      }
      glisse = this._lambertSousCurseur(e);
      depart = [e.clientX, e.clientY];
    });

    c.addEventListener('pointermove', (e) => {
      if (doigts.has(e.pointerId)) doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pince && doigts.size >= 2) {
        const d = ecart();
        if (pince.distance > 0) {
          const ancienne = this.echelle;
          this.echelle = Math.max(0.02, Math.min(8, ancienne * (pince.distance / d)));
          if (pince.lambert) {
            const k = this.echelle / ancienne;
            this.centre[0] = pince.lambert[0] + (this.centre[0] - pince.lambert[0]) * k;
            this.centre[1] = pince.lambert[1] + (this.centre[1] - pince.lambert[1]) * k;
          }
        }
        pince.distance = d;
        this.invalider();
        return;
      }

      const p = this._lambertSousCurseur(e);
      if (glisse && p) {
        // Déplacement mesuré par différence de points visés, comme en 3D : la
        // surface reste collée au curseur quelle que soit l'échelle.
        this.centre[0] += glisse[0] - p[0];
        this.centre[1] += glisse[1] - p[1];
        this.invalider();
      } else if (p) {
        this.cb.surCurseur?.(this.lire(p[0], p[1], this._coteSous(e)));
      }
    });

    const relacher = (e) => {
      c.releasePointerCapture?.(e.pointerId);
      doigts.delete(e.pointerId);
      if (doigts.size < 2) pince = null;
      if (doigts.size === 1) {
        // Un doigt reste au sol : reprendre le glissé depuis sa position
        // actuelle, pas depuis le point de départ d'origine — sinon la vue
        // saute au relâchement du second doigt.
        const [pos] = doigts.values();
        glisse = this._lambertSousCurseur({ clientX: pos.x, clientY: pos.y });
      } else if (doigts.size === 0) {
        glisse = null;
      }
    };
    c.addEventListener('pointerup', relacher);
    c.addEventListener('pointercancel', relacher);
    c.addEventListener('pointerleave', () => this.cb.surCurseur?.(null));

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const avant = this._lambertSousCurseur(e);
      const ancienne = this.echelle;
      this.echelle = Math.max(0.02, Math.min(8, ancienne * Math.exp(e.deltaY * 0.0012)));
      // Le point sous le curseur reste immobile : on rapproche le centre dans
      // le même rapport que l'échelle.
      if (avant) {
        const k = this.echelle / ancienne;
        this.centre[0] = avant[0] + (this.centre[0] - avant[0]) * k;
        this.centre[1] = avant[1] + (this.centre[1] - avant[1]) * k;
      }
      this.invalider();
    }, { passive: false });

    c.addEventListener('click', (e) => {
      const bouge = pinceUtilisee ||
        (depart && Math.hypot(e.clientX - depart[0], e.clientY - depart[1]) > 4);
      pinceUtilisee = false;
      depart = null;
      const p = this._lambertSousCurseur(e);
      if (bouge || !p) return;

      // Mode sélection : le clic vise un point plutôt que de choisir une
      // détection. `lire` fait déjà tout le travail — c'est la même valeur
      // que le survol affiche dans le HUD, simplement figée par le clic.
      if (this.modeSelection) {
        this.cb.surSelectionPoint?.(this.lire(p[0], p[1], this._coteSous(e)));
        return;
      }
      if (!this.cb.surClic) return;
      this.cb.surClic(this._detectionA(p[0], p[1]));
    });
  }

  /** Détection dont la boîte contient ce point, la plus petite d'abord. */
  _detectionA(x, y) {
    let trouvee = null;
    let aire = Infinity;
    for (const d of this.detections) {
      const b = d.boite;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      const a = (b[2] - b[0]) * (b[3] - b[1]);
      if (a < aire) { aire = a; trouvee = d; }
    }
    return trouvee ? trouvee.id : null;
  }

  /** Côté du rideau sous un événement pointeur. */
  _coteSous(ev) {
    const r = this.canvas.getBoundingClientRect();
    if (!(r.width > 0)) return 'droite';
    return (ev.clientX - r.left) / r.width < this.rideau ? 'gauche' : 'droite';
  }

  /**
   * Valeurs sous un point Lambert-93, pour la ligne de lecture.
   *
   * La valeur lue est celle du côté survolé, et non d'un côté choisi une fois
   * pour toutes : sous le curseur il n'y a qu'une image, celle qu'on regarde.
   */
  lire(x, y, cote = 'droite') {
    const t = this.grille;
    if (!t) return null;
    const cx = Math.floor((x - t.emprise.xmin) / t.pas);
    const cy = Math.floor((y - t.emprise.ymin) / t.pas);
    if (cx < 0 || cx >= t.W || cy < 0 || cy >= t.H) return { x, y };
    const i = cy * t.W + cx;
    return {
      x, y,
      // Les grilles travaillent en altitude relative, la lecture veut de
      // l'absolu : on remet l'origine, une fois, ici.
      altitude: t.valide[i] ? t.mnt[i] + t.origine[2] : null,
      hauteur: t.hauteur[i],
      valeur: this.couche(cote) ? this.couche(cote).valeurs[i] : null,
      couche: this.sources[cote]?.libelle || null,
    };
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  _rendre() {
    const c = this.canvas;
    const ctx = this.ctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }

    ctx.fillStyle = CONFIG.rendu.fond;
    ctx.fillRect(0, 0, w, h);
    if (!this.grille) return;

    const t = this.grille;
    const sg = this._preparerSource('gauche');
    const sd = this._preparerSource('droite');
    if (!sg && !sd) return;
    // Un seul côté servi tient toute la largeur : pendant qu'une couche se
    // calcule, mieux vaut montrer l'autre que du fond noir.
    const coupe = (sg && sd) ? Math.round(w * this.rideau) : (sg ? w : 0);

    // Le tampon d'image est conservé d'une image à l'autre : à 2400 × 1800, en
    // réallouer un à chaque déplacement de souris ferait passer 17 Mo par le
    // ramasse-miettes soixante fois par seconde.
    if (!this._image || this._image.width !== w || this._image.height !== h) {
      this._image = ctx.createImageData(w, h);
    }
    const image = this._image;
    const px = image.data;
    const [fr, fg, fb] = hexVersRVB(CONFIG.rendu.fond);

    // Correspondance écran → cellule, en incrémental : une multiplication par
    // pixel suffit, sans repasser par la transformation complète.
    const bordGauche = this.centre[0] - (w / 2) * this.echelle;
    const haut = this.centre[1] + (h / 2) * this.echelle;
    const parCellule = this.echelle / t.pas;
    const cx0 = (bordGauche - t.emprise.xmin) / t.pas;
    const cy0 = (haut - t.emprise.ymin) / t.pas;

    for (let y = 0; y < h; y++) {
      // Troncature seulement après le test : `-0.5 | 0` vaut 0, ce qui ferait
      // passer pour la première ligne un pixel situé hors de la dalle.
      const fy = cy0 - y * parCellule;
      let o = y * w * 4;
      const dehorsY = fy < 0 || fy >= t.H;
      const ligne = dehorsY ? 0 : (fy | 0) * t.W;

      for (let x = 0; x < w; x++, o += 4) {
        // Le côté est choisi par un test par pixel plutôt que par deux boucles
        // séparées : la branche est parfaitement prédite, et découper la ligne
        // demanderait de dupliquer tout le corps.
        const src = x < coupe ? sg : sd;
        const fx = cx0 + x * parCellule;
        if (!src || dehorsY || fx < 0 || fx >= t.W) {
          px[o] = fr; px[o + 1] = fg; px[o + 2] = fb; px[o + 3] = 255;
          continue;
        }
        const cellule = ligne + (fx | 0);

        if (src.rgba) {
          const k = cellule * 4;
          if (src.rgba[k + 3] === 0) {
            // Tuile manquante : le même gris que le sol inconnu, pour la même
            // raison — un vide visible vaut mieux qu'une couleur inventée.
            px[o] = 42; px[o + 1] = 46; px[o + 2] = 54; px[o + 3] = 255;
          } else {
            px[o] = src.rgba[k]; px[o + 1] = src.rgba[k + 1]; px[o + 2] = src.rgba[k + 2];
            px[o + 3] = 255;
          }
          continue;
        }

        const v = src.valeurs[cellule];
        if (!Number.isFinite(v)) {
          // Hors marge ou sol inconnu : un gris neutre, qui se distingue de
          // toute valeur de la palette. Mieux vaut un vide visible qu'une
          // couleur qui laisserait croire à une mesure.
          px[o] = 42; px[o + 1] = 46; px[o + 2] = 54; px[o + 3] = 255;
          continue;
        }
        let u = ((v - src.min) / src.span) * 255;
        u = u < 0 ? 0 : u > 255 ? 255 : u;
        const k = (u | 0) * 3;
        px[o] = src.lut[k]; px[o + 1] = src.lut[k + 1]; px[o + 2] = src.lut[k + 2];
        px[o + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);

    ctx.save();
    ctx.lineWidth = Math.max(1, dpr);
    if (this.montrerSentiers) this._tracerSentiers(ctx, w, h);
    if (this.montrerDetections) this._tracerDetections(ctx, w, h);
    if (this.pointSelectionne) this._tracerPointSelectionne(ctx, w, h);
    this._tracerEchelle(ctx, w, h, dpr);
    if (sg && sd) this._tracerEtiquettes(ctx, w, dpr, coupe, sg, sd);
    ctx.restore();
  }

  /**
   * Met une source en forme pour la boucle de rendu.
   *
   * L'étalement est résolu ici, une fois par image et non par pixel : c'est lui
   * que le curseur de contraste déplace, sans rien recalculer de la couche.
   */
  _preparerSource(cote) {
    const s = this.sources[cote];
    if (!s) return null;
    if (s.type === 'photo') return { rgba: s.rgba, libelle: s.libelle };
    const [min, max] = this.etendue(cote);
    return { valeurs: s.couche.valeurs, lut: s.lut, min, span: (max - min) || 1, libelle: s.libelle };
  }

  /**
   * Nom de chaque couche, de part et d'autre du rideau.
   *
   * Sans eux, deux nuances de gris côte à côte ne disent pas laquelle est
   * laquelle — et le rideau perd tout son sens dès qu'on a bougé le sélecteur
   * une fois. Le libellé se colle au rideau plutôt qu'au bord de l'écran : c'est
   * là que se fait la comparaison, et c'est là que l'œil est.
   */
  _tracerEtiquettes(ctx, w, dpr, coupe, sg, sd) {
    ctx.font = `${11.5 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    const y = 16 * dpr, marge = 9 * dpr;

    for (const [src, aDroite] of [[sg, false], [sd, true]]) {
      const texte = src.libelle || '';
      if (!texte) continue;
      const l = ctx.measureText(texte).width;
      // Repoussée vers le bord quand le rideau est trop près de celui-ci, pour
      // qu'une étiquette ne déborde jamais sur l'autre moitié.
      let x = aDroite ? coupe + marge : coupe - marge - l;
      x = Math.max(marge, Math.min(w - marge - l, x));
      ctx.fillStyle = 'rgba(11, 14, 19, 0.78)';
      ctx.beginPath();
      ctx.roundRect(x - 6 * dpr, y - 9 * dpr, l + 12 * dpr, 18 * dpr, 4 * dpr);
      ctx.fill();
      ctx.fillStyle = '#dbe1ea';
      ctx.fillText(texte, x, y);
    }
  }

  _versEcran(x, y, w, h) {
    return [
      (x - this.centre[0]) / this.echelle + w / 2,
      (this.centre[1] - y) / this.echelle + h / 2,
    ];
  }

  _tracerDetections(ctx, w, h) {
    for (const d of this.detections) {
      const [x0, y0] = this._versEcran(d.boite[0], d.boite[3], w, h);
      const [x1, y1] = this._versEcran(d.boite[2], d.boite[1], w, h);
      const choisi = d.id === this.selection;
      ctx.strokeStyle = choisi ? '#ffd24a'
        : d.repertorie ? '#7d8794'
        : d.score > 0.65 ? '#ff5a3c' : d.score > 0.45 ? '#ffa62b' : '#ffe066';
      ctx.lineWidth = choisi ? 3 : 1.5;
      // Une boîte de 6 m tombe sous le pixel quand la dalle entière est à
      // l'écran : on lui impose une taille minimale, sans quoi les détections
      // seraient invisibles à la seule échelle où on les cherche.
      const lx = Math.max(7, x1 - x0), ly = Math.max(7, y0 - y1);
      ctx.strokeRect(x0 - (lx - (x1 - x0)) / 2, y1 - (ly - (y0 - y1)) / 2, lx, ly);
    }
  }

  /**
   * Marqueur du point choisi en mode Sélection — même couleur qu'en 3D
   * (`vue3d.js`, `definirPointSelectionne`), pour que ce soit lisiblement le
   * même point d'une vue à l'autre.
   */
  _tracerPointSelectionne(ctx, w, h) {
    const [sx, sy] = this._versEcran(this.pointSelectionne[0], this.pointSelectionne[1], w, h);
    const r = 7;
    ctx.save();
    // Contour sombre d'abord : la couleur du marqueur reste lisible sur un
    // fond clair comme sur un fond sombre.
    ctx.strokeStyle = '#0b0e13';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - r - 6, sy); ctx.lineTo(sx - r + 2, sy);
    ctx.moveTo(sx + r - 2, sy); ctx.lineTo(sx + r + 6, sy);
    ctx.moveTo(sx, sy - r - 6); ctx.lineTo(sx, sy - r + 2);
    ctx.moveTo(sx, sy + r - 2); ctx.lineTo(sx, sy + r + 6);
    ctx.stroke();

    ctx.strokeStyle = '#ff40d9';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx - r - 6, sy); ctx.lineTo(sx - r + 2, sy);
    ctx.moveTo(sx + r - 2, sy); ctx.lineTo(sx + r + 6, sy);
    ctx.moveTo(sx, sy - r - 6); ctx.lineTo(sx, sy - r + 2);
    ctx.moveTo(sx, sy + r - 2); ctx.lineTo(sx, sy + r + 6);
    ctx.stroke();
    ctx.restore();
  }

  _tracerSentiers(ctx, w, h) {
    for (const s of this.traces) {
      if (s.points.length < 2) continue;
      ctx.strokeStyle = s.id === this.traceChoisie ? '#ffffff' : '#ff8a3c';
      ctx.lineWidth = s.id === this.traceChoisie ? 3 : 1.5;
      ctx.beginPath();
      for (let i = 0; i < s.points.length; i++) {
        const [sx, sy] = this._versEcran(s.points[i][0], s.points[i][1], w, h);
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }
  }

  /** Barre d'échelle : sans elle, rien ne dit si l'on regarde 20 m ou 400. */
  _tracerEchelle(ctx, w, h, dpr) {
    const cibleEcran = 120 * dpr;
    const brut = cibleEcran * this.echelle;
    const puissance = 10 ** Math.floor(Math.log10(brut));
    const metres = [1, 2, 5, 10].map((k) => k * puissance).find((v) => v >= brut) || puissance * 10;
    const largeur = metres / this.echelle;

    const x = 14 * dpr, y = h - 16 * dpr;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 4 * dpr;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + largeur, y); ctx.stroke();
    ctx.strokeStyle = '#dbe1ea';
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + largeur, y);
    ctx.moveTo(x, y - 4 * dpr); ctx.lineTo(x, y + 4 * dpr);
    ctx.moveTo(x + largeur, y - 4 * dpr); ctx.lineTo(x + largeur, y + 4 * dpr);
    ctx.stroke();

    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = '#dbe1ea';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3 * dpr;
    const texte = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
    ctx.strokeText(texte, x, y - 8 * dpr);
    ctx.fillText(texte, x, y - 8 * dpr);
  }
}

/**
 * Emprise Lambert-93 d'une détection, depuis son emprise en cellules.
 *
 * Même calcul que les boîtes de la vue 3D, et pour la même raison : l'emprise
 * en cellules suffit à guider l'œil, la lecture se fait ensuite sur l'image.
 */
function boiteLambert(c, g) {
  if (!g || !c.empriseCellules) return null;
  const b = c.empriseCellules;
  return [
    g.emprise.xmin + b.xmin * g.pas,
    g.emprise.ymin + b.ymin * g.pas,
    g.emprise.xmin + (b.xmax + 1) * g.pas,
    g.emprise.ymin + (b.ymax + 1) * g.pas,
  ];
}

/**
 * Tables de couleurs, 256 entrées, en triplets.
 *
 * Quatre familles, chacune choisie pour ce que la couche veut faire voir :
 * `gris` pour les couches d'éclairement, où l'œil lit le modelé et non la
 * valeur ; `divergent` pour les couches signées, où le zéro doit se distinguer
 * du reste ; `chaud` et `froid` pour les couches positives qu'on veut voir
 * ressortir du fond.
 */
/** `#0b0e13` → `[11, 14, 19]`. Évite de dépendre de `gl.js` pour trois octets. */
function hexVersRVB(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function construireLUT(nom) {
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const u = i / 255;
    let r, v, b;
    if (nom === 'divergent') {
      // Creux en bleu froid, bosses en ocre, zéro en gris moyen.
      if (u < 0.5) { const k = u * 2; r = 60 + k * 130; v = 90 + k * 100; b = 130 + k * 60; }
      else { const k = (u - 0.5) * 2; r = 190 + k * 60; v = 190 - k * 20; b = 190 - k * 110; }
    } else if (nom === 'chaud') {
      r = 30 + u * 225; v = 30 + u * 150 * (u < 0.7 ? 1 : 0.7); b = 40 * (1 - u);
    } else if (nom === 'froid') {
      r = 20 + u * 60; v = 30 + u * 170; b = 45 + u * 210;
    } else {
      r = v = b = 12 + u * 236;
    }
    lut[i * 3] = Math.max(0, Math.min(255, r));
    lut[i * 3 + 1] = Math.max(0, Math.min(255, v));
    lut[i * 3 + 2] = Math.max(0, Math.min(255, b));
  }
  return lut;
}
