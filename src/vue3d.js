// Vue 3D du nuage : caméra orbitale, rendu par points, marqueurs de sélection et de mesure. Les gestes
// vivent dans `controles-3d.js`.
// Décalage vertical des marqueurs (sélection, mesure) au-dessus du point
// visé — assez pour ne plus coïncider en profondeur avec le point réel du
// nuage à cet endroit (sans quoi le test de profondeur peut le ronger),
// assez peu pour rester imperceptible à l'échelle où on lit une mesure.
const SURELEVATION_MARQUEUR = 0.15;

// Champ de vision vertical, en degrés — partagé par le rendu (`_rendre`), le
// rayon de clic (`_rayonBrut`, `pointDuNuage`) et l'échelle écran↔monde
// (`_zoomVers`). Une seule constante plutôt que 52 recopié à chaque site : un
// rayon de clic qui suivrait un FOV différent de celui du rendu viserait
// systématiquement à côté de ce que l'écran montre.
const FOV_Y_DEG = 52;

/**
 * La part du nuage à dessiner pendant un geste, d'après le `retard` (ms)
 * entre la demande d'une image et son rendu. Une carte graphique saturée
 * retarde l'image suivante : c'est le seul signal que le navigateur donne, et
 * une pause dans le geste ne l'allonge pas (rien n'est demandé). En retard,
 * la part baisse d'autant (au plus au quart d'un coup) ; rapide, elle
 * remonte doucement ; sans retard mesuré, elle ne bouge pas.
 */
function partEnMouvement(part, retard, m) {
  if (retard == null) return part;
  if (retard > m.imageLenteMs) {
    const cible = (m.imageLenteMs + m.imageRapideMs) / 2;
    return Math.max(m.partMin, part * Math.max(0.25, cible / retard));
  }
  if (retard < m.imageRapideMs) return Math.min(1, part * 1.1);
  return part;
}

class Vue3D {
  constructor(canvas, elementBoussole = null) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,          // inutile sur des points, et coûteux à ces volumes
      depthStencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error("WebGL2 indisponible — Scopus a besoin d'un navigateur récent.");
    this.gl = gl;

    this.progPoints = GL.program(gl, SHADERS.pointsVS, SHADERS.pointsFS);
    this.progLignes = GL.program(gl, SHADERS.lignesVS, SHADERS.lignesFS);
    // Ombrage de profondeur : un triangle plein écran sur le rendu du nuage.
    this.progEDL = GL.program(gl, SHADERS.reliefVS, SHADERS.edlFS);
    this.vaoEDL = gl.createVertexArray();
    gl.bindVertexArray(this.vaoEDL);
    const tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const locEDL = gl.getAttribLocation(this.progEDL, 'a_p');
    gl.enableVertexAttribArray(locEDL);
    gl.vertexAttribPointer(locEDL, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.edl = null;   // { fb, couleur, profondeur, w, h }, à la taille du canevas
    this.palette = GL.paletteClasses(gl, CONFIG.rendu.couleursClasse, CONFIG.rendu.couleurClasseDefaut);

    this.nuage = null;
    this.vao = null;
    this.buffers = [];
    this.nbPoints = 0;
    // Pendant un geste, seule une part du nuage est dessinée (le nuage est
    // rangé pour que n'importe quel début en soit un échantillon régulier),
    // à au plus un pixel physique par pixel ; à l'arrêt, tout.
    this._arrete = true;              // faux pendant un geste
    this._finGeste = 0;               // minuteur de l'image complète
    this._partMouvement = 1;
    this._demandee = 0;               // instant de la demande de l'image en attente
    this._etaitEnMouvement = false;
    this.statsRendu = { dessines: 0, total: 0, enMouvement: false };
    this.dernierMouvement = null;     // points dessinés à la dernière image d'un geste
    this.zmin = 0;
    this.zref = 1;

    this.vaoPointSel = null;
    this.bufPointSel = null;
    this.nbSommetsPointSel = 0;
    this.vaoMesure = null;
    this.bufMesure = null;
    this.nbSommetsMesureLigne = 0;
    this.nbSommetsMesurePoints = 0;

    // Caméra orbitale. Distance et cible en mètres, angles en radians.
    this.cam = { cible: [0, 0, 0], distance: 300, azimut: -Math.PI / 4, elevation: 0.6 };

    // Mode d'interaction du clic — 'deplacement' (défaut), 'selection' (vise
    // un point) ou 'mesure' (vise deux points, l'un après l'autre) —
    // commutable depuis l'extérieur, partagé avec la vue 2D.
    // `onSelectionPoint(rayon)` et `onPointMesure(rayon)` reçoivent le rayon
    // caméra du point cliqué ; trouver où il touche le terrain demande le MNT
    // affiché, que cette classe ne connaît pas — c'est à l'appelant de faire
    // la marche (voir `TERRAIN.pointDuTerrain` dans app.js).
    this.mode = 'deplacement';
    this.onSelectionPoint = null;
    this.onPointMesure = null;
    // Appelé à chaque image rendue, nuage en place : le lien partageable suit
    // la caméra (voir `majLien` dans app.js, qui regroupe les appels).
    this.onVue = null;

    this.boussole = elementBoussole
      ? new Boussole(elementBoussole, (v) => this.controles.orienterVers(v))
      : null;

    this.controles = new ControlesVue3D(this);
    this.controles.brancher();
    this.actif = false;
    this._planifie = false;
  }

  demarrer() {
    if (this.actif) return;
    this.actif = true;

    // Le canevas peut changer de taille sans que rien d'autre ne bouge :
    // bascule d'onglet, fenêtre redimensionnée, panneau replié.
    this._observateur = new ResizeObserver(() => this.invalider());
    this._observateur.observe(this.canvas);

    this.invalider();
  }

  arreter() {
    this.actif = false;
    this._observateur?.disconnect();
  }

  /**
   * Demande une image. À appeler après tout changement visible.
   *
   * Le rendu est **à la demande**, pas continu. Un nuage est statique : le
   * redessiner soixante fois par seconde alors que rien ne bouge ne change
   * rien à l'écran et monopolise la machine. Mesuré sur l'aperçu d'une dalle
   * (4,45 M points) : 1,9 image/s et jusqu'à 1 165 ms sans rendre la main.
   * Le fil principal étant saturé, le navigateur ne pouvait plus servir le
   * défilement du panneau latéral — d'où l'impression qu'il était bloqué.
   *
   * Plusieurs appels dans la même image n'en produisent qu'une.
   */
  invalider() {
    if (!this.actif || this._planifie) return;
    this._planifie = true;
    this._demandee = performance.now();
    requestAnimationFrame(() => { this._planifie = false; this._rendre(); });
  }

  /** Un geste de caméra : images allégées, puis une complète à l'arrêt. */
  _bouger() {
    this._arrete = false;
    clearTimeout(this._finGeste);
    // À l'arrêt, l'image complète. Si une image est déjà en attente, c'est
    // elle qui le sera : le drapeau, pas l'heure, décide.
    this._finGeste = setTimeout(() => { this._arrete = true; this.invalider(); }, CONFIG.rendu.mouvement.arretMs);
    this.invalider();
  }

  /** Charge un nuage dans le GPU. Remplace le précédent. */
  definirNuage(nuage, hauteurs = null) {
    const gl = this.gl;
    this._libererNuage();

    this.nuage = nuage;
    this.nbPoints = nuage.n;
    this.zmin = nuage.zmin;
    this.zref = Math.max(1, nuage.zmax - nuage.zmin);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    // Positions entrelacées : un seul VBO pour x/y/z évite trois liaisons de
    // buffer par frame et améliore la localité au fetch de sommets.
    const pos = new Float32Array(nuage.n * 3);
    for (let i = 0; i < nuage.n; i++) {
      pos[i * 3] = nuage.x[i];
      pos[i * 3 + 1] = nuage.y[i];
      pos[i * 3 + 2] = nuage.z[i];
    }
    this._attribut(vao, 0, pos, 3, gl.FLOAT, false);

    // La classification part en Uint8 non normalisé : le shader la reçoit en
    // float et s'en sert d'index de palette, il ne faut surtout pas la ramener
    // dans [0,1].
    this._attribut(vao, 1, nuage.cls, 1, gl.UNSIGNED_BYTE, false);

    // L'intensité, elle, est normalisée à la volée par le pipeline fixe :
    // 16 bits bruts n'ont aucune signification absolue en LiDAR. Absente du
    // nuage de la vue (plus téléchargée) : l'attribut garde sa valeur fixe.
    if (nuage.intensite) this._attribut(vao, 2, nuage.intensite, 1, gl.UNSIGNED_SHORT, true);

    const h = hauteurs || new Float32Array(nuage.n);
    this._attribut(vao, 3, h, 1, gl.FLOAT, false);

    gl.bindVertexArray(null);
    this.vao = vao;

    this.cadrer();   // cadrer() invalide déjà
  }

  /** Ombrage de profondeur (EDL) actif ou non. */
  definirEDL(actif) {
    CONFIG.rendu.edl.actif = !!actif;
    this.invalider();
  }

  /** Cible de rendu du nuage pour l'EDL, recréée quand la taille change. */
  _cibleEDL(w, h) {
    const gl = this.gl;
    if (this.edl && this.edl.w === w && this.edl.h === h) return this.edl;
    if (this.edl) { gl.deleteFramebuffer(this.edl.fb); gl.deleteTexture(this.edl.couleur); gl.deleteTexture(this.edl.profondeur); }
    const texture = (interne, format, type) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, interne, w, h, 0, format, type, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const couleur = texture(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    const profondeur = texture(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, couleur, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, profondeur, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.edl = { fb, couleur, profondeur, w, h };
    return this.edl;
  }

  /** Met à jour l'attribut de hauteur une fois la rastérisation faite. */
  definirHauteurs(hauteurs) {
    if (!this.vao) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[3]);
    gl.bufferData(gl.ARRAY_BUFFER, hauteurs, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.invalider();
  }

  _attribut(vao, index, donnees, taille, type, normalise) {
    const gl = this.gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, donnees, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(index);
    gl.vertexAttribPointer(index, taille, type, normalise, 0, 0);
    this.buffers[index] = buf;
  }

  _libererNuage() {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    for (const b of this.buffers) if (b) gl.deleteBuffer(b);
    this.buffers = [];
    this.vao = null;
    this.nbPoints = 0;
  }

  /**
   * Décharge le nuage et tout ce qui s'y rapporte.
   *
   * Rendre la mémoire n'est pas un détail ici : un nuage d'affichage et ses
   * grilles pèsent 400 à 520 Mo, retenus tant que l'onglet vit. Sans cette
   * méthode, la seule façon de les libérer était de recharger la page.
   */
  vider() {
    this._libererNuage();
    this.nuage = null;
    this.nbSommetsPointSel = 0;
    this.nbSommetsMesureLigne = 0;
    this.nbSommetsMesurePoints = 0;
    this.controles.arreter();
    this.invalider();
  }

  /** Recentre la caméra sur l'ensemble du nuage. */
  cadrer() {
    if (!this.nuage) return;
    this.controles.arreter();
    const e = this.nuage.emprise;
    const o = this.nuage.origine;
    const cote = Math.max(e.xmax - e.xmin, e.ymax - e.ymin);
    this.cam.cible = [
      (e.xmin + e.xmax) / 2 - o[0],
      (this.nuage.zmax - this.nuage.zmin) * 0.3,
      -((e.ymin + e.ymax) / 2 - o[1]),
    ];
    this.cam.distance = cote * 1.2;
    this.cam.azimut = -Math.PI / 4;
    this.cam.elevation = 0.55;
    this.invalider();
  }

  /**
   * Caméra en coordonnées vraies : point visé en Lambert-93, distance en
   * mètres, angles de `cam`, et la résolution au sol au point visé — mètres
   * par pixel CSS, ce que le lien partageable convertit en zoom de carte.
   * `null` sans nuage, ou tant que le canevas n'a pas de taille.
   */
  camera() {
    if (!this.nuage) return null;
    const hauteur = this.canvas.clientHeight;
    if (!(hauteur > 0)) return null;
    const o = this.nuage.origine;
    const { cible, distance, azimut, elevation } = this.cam;
    return {
      x: cible[0] + o[0], y: -cible[2] + o[1], distance, azimut, elevation,
      metresParPixelCss: 2 * distance * Math.tan((FOV_Y_DEG * Math.PI / 180) / 2) / hauteur,
    };
  }

  /**
   * Masque des classifications. `masquees` est un itérable de numéros de classe.
   *
   * Le filtrage passe par l'alpha de la palette : une texture de 1 Ko réécrite,
   * et rien d'autre. Refiltrer en reconstruisant les buffers de sommets
   * coûterait, sur une dalle, plusieurs centaines de mégaoctets de transfert à
   * chaque case cochée.
   */
  definirClassesMasquees(masquees) {
    GL.paletteClasses(this.gl, CONFIG.rendu.couleursClasse,
      CONFIG.rendu.couleurClasseDefaut, masquees, this.palette);
    this.invalider();
  }

  /**
   * Marqueur du point choisi en mode Sélection (voir app.js) : un point
   * agrandi avec un liseré sombre, dessiné en `gl.POINTS` plutôt qu'une croix
   * reliée au sol — une croix se mélangeait avec les points du nuage en
   * arrière-plan (retour utilisateur du 22/08/2026). La taille est fixe en
   * pixels d'écran, pas en mètres : le marqueur reste lisible quel que soit
   * le zoom, comme la sélection elle-même n'a pas d'échelle propre.
   *
   * `p` est en Lambert-93 absolu, comme partout ailleurs dans l'API publique
   * (`camera`) ; la conversion vers le repère local du
   * nuage se fait ici, une fois.
   */
  definirPointSelectionne(p) {
    // L'altitude peut manquer (sol inconnu, sélectionné depuis la 2D) : sans
    // elle il n'y a pas de hauteur où planter le marqueur, donc pas de
    // marqueur plutôt qu'un marqueur planté à une hauteur inventée.
    if (!p || !this.nuage || !Number.isFinite(p.altitude)) {
      this.nbSommetsPointSel = 0;
      this.invalider();
      return;
    }
    const o = this.nuage.origine;
    // Légèrement surélevé (voir la constante en tête de fichier) : posé pile
    // à l'altitude du point, il coïncide en profondeur avec le point réel du
    // nuage qui l'a motivé, et le test de profondeur peut alors ronger le
    // marqueur au lieu de le laisser par-dessus.
    const sommets = [p.x - o[0], p.y - o[1], p.altitude - o[2] + SURELEVATION_MARQUEUR];
    this.nbSommetsPointSel = this._televerserLignes(sommets, 'PointSel');
    this.invalider();
  }

  /**
   * La chaîne de points de la mesure en cours (voir app.js) : même marqueur
   * ponctuel que la sélection sur chacun, reliés de proche en proche par des
   * traits directs — chaque segment est la ligne d'air dont la longueur est
   * une des distances totales affichées dans le panneau.
   *
   * Un seul tampon, deux plages : les sommets des segments d'abord
   * (`gl.LINES` — chaque paire consécutive de la chaîne redonne ses deux
   * bouts, une bande n'existe pas en `LINES`), les marqueurs ensuite
   * (`gl.POINTS`) — `nbSommetsMesureLigne` dit où l'une finit et l'autre
   * commence au rendu.
   *
   * @param {Array<{x:number,y:number,altitude:number}>} points Lambert-93
   *   absolu, dans l'ordre du clic ; un point sans altitude finie (sol
   *   inconnu à cet endroit) est filtré plutôt que de planter un marqueur à
   *   une hauteur inventée.
   */
  definirMesure(points) {
    const valides = (points || []).filter((p) => p && Number.isFinite(p.altitude));
    if (!valides.length || !this.nuage) {
      this.nbSommetsMesureLigne = 0;
      this.nbSommetsMesurePoints = 0;
      this.invalider();
      return;
    }
    const o = this.nuage.origine;
    const locaux = valides.map((p) => [p.x - o[0], p.y - o[1], p.altitude - o[2] + SURELEVATION_MARQUEUR]);

    const segments = [];
    for (let i = 0; i + 1 < locaux.length; i++) segments.push(...locaux[i], ...locaux[i + 1]);

    this.nbSommetsMesureLigne = segments.length / 3;
    this.nbSommetsMesurePoints = locaux.length;
    this._televerserLignes([...segments, ...locaux.flat()], 'Mesure');
    this.invalider();
  }

  /** Envoie une liste de sommets au GPU sous un jeu de buffers nommé. */
  _televerserLignes(sommets, suffixe) {
    const gl = this.gl;
    const donnees = new Float32Array(sommets);

    let vao = this[`vao${suffixe}`];
    let buf = this[`buf${suffixe}`];
    if (!vao) {
      vao = gl.createVertexArray();
      buf = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this[`vao${suffixe}`] = vao;
      this[`buf${suffixe}`] = buf;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, donnees, gl.DYNAMIC_DRAW);
    return donnees.length / 3;
  }

  // ── Contrôles ─────────────────────────────────────────────────────────────

  /**
   * Repère de la caméra en coordonnées monde.
   *
   * Dérivé de la position orbitale, et non extrait de la matrice de vue : c'est
   * la même source pour le rendu et pour les contrôles, donc pas de dérive
   * possible entre ce qu'on voit et ce qu'on manipule.
   *
   * `elevation` ne se passe que pour la boussole, qui a besoin du même repère à
   * une inclinaison bornée (voir `_repereBoussole`). Le repère renvoyé reste
   * cohérent avec lui-même : c'est celui d'une caméra qui serait là.
   */
  _repere(elevation = this.cam.elevation) {
    const { cible, distance, azimut: a } = this.cam;
    const e = elevation;
    const ce = Math.cos(e), se = Math.sin(e), ca = Math.cos(a), sa = Math.sin(a);

    const oeil = [cible[0] + distance * ce * sa, cible[1] + distance * se, cible[2] + distance * ce * ca];
    return {
      oeil,
      avant: [-ce * sa, -se, -ce * ca],
      droite: [ca, 0, -sa],
      haut: [-sa * se, ce, -ca * se],
    };
  }

  /**
   * Rayon caméra passant par un pixel donné, en repère local — le même que le
   * nuage, `cam.cible` et `oeil`. Direction non unitaire, comme `_repere` la
   * construit : ça ne gêne pas une intersection de plan (`_pointSousCurseur`),
   * qui résout un paramètre sans se soucier de sa norme.
   *
   * `rayonEcran` en fait une version publique et normalisée, pour qui a besoin
   * d'une vraie distance le long du rayon — la sélection d'un point du MNT,
   * qui marche le rayon par pas.
   */
  _rayonBrut(ev) {
    const r = this.canvas.getBoundingClientRect();
    // Canevas masqué ou pas encore dimensionné : sans ce garde, l'aspect vaut
    // 0/0 et la cible de la caméra part en NaN — définitivement, car plus aucun
    // calcul ne la ramène.
    if (!(r.width > 0) || !(r.height > 0)) return null;

    const ndcX = ((ev.clientX - r.left) / r.width) * 2 - 1;
    const ndcY = 1 - ((ev.clientY - r.top) / r.height) * 2;

    const { oeil, avant, droite, haut } = this._repere();
    const tan = Math.tan((FOV_Y_DEG * Math.PI / 180) / 2);
    const aspect = r.width / r.height;

    const dir = [0, 1, 2].map((i) =>
      avant[i] + droite[i] * ndcX * tan * aspect + haut[i] * ndcY * tan);
    return { oeil, dir };
  }

  /** Rayon caméra normalisé passant par un pixel donné, en repère local. */
  rayonEcran(ev) {
    const rayon = this._rayonBrut(ev);
    if (!rayon) return null;
    const n = Math.hypot(...rayon.dir) || 1;
    return { oeil: rayon.oeil, direction: rayon.dir.map((v) => v / n) };
  }

  /**
   * Point du nuage affiché le plus proche d'un rayon de clic — voir
   * `TERRAIN.pointDuNuage`, où vit le calcul lui-même. Cette méthode ne fait
   * que rassembler ce que cette classe est seule à connaître (le nuage, son
   * `zmin`, le canevas) ; `TERRAIN` ne connaît ni WebGL ni le DOM.
   *
   * `null` sans nuage, canevas non dimensionné, ou aucun point dans le seuil
   * — l'appelant retombe alors sur `TERRAIN.pointDuTerrain`.
   */
  pointDuNuage(rayon, classesMasquees = null) {
    if (!this.nuage) return null;
    const r = this.canvas.getBoundingClientRect();
    return TERRAIN.pointDuNuage(rayon, this.nuage, {
      zmin: this.zmin,
      exagerationZ: CONFIG.rendu.exagerationZ,
      fovYdeg: FOV_Y_DEG,
      hauteurPx: r.height,
      toleragePx: CONFIG.rendu.toleragePointagePx,
      classesMasquees,
    });
  }

  // ── Orientation ───────────────────────────────────────────────────────────

  /**
   * Repère servant à dessiner la boussole.
   *
   * L'inclinaison y est bornée à [17°, 74°] : au ras de l'horizon la rose se
   * réduit à un trait, où nord et sud se superposent au centre ; à la verticale
   * c'est l'axe haut/bas qui s'écrase de la même façon. Dans les deux cas les
   * poignées deviennent illisibles et intouchables, alors que ce sont justement
   * les vues d'où l'on veut se réorienter. La rose garde donc toujours un peu de
   * perspective — l'azimut, lui, reste exact, et c'est ce qu'on y lit.
   */
  _repereBoussole() {
    const e = this.cam.elevation;
    const borne = Math.min(1.30, Math.max(0.30, Math.abs(e)));
    return this._repere(e < 0 ? -borne : borne);
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────

  _rendre() {
    const gl = this.gl;
    const c = this.canvas;

    const mv = CONFIG.rendu.mouvement;
    const enMouvement = !this._arrete;
    // Le retard ne compte qu'entre deux images d'un même geste : la première
    // attend peut-être la fin d'une image complète, qui n'est pas en cause.
    if (enMouvement && this._etaitEnMouvement) {
      this._partMouvement = partEnMouvement(this._partMouvement, performance.now() - this._demandee, mv);
    }
    // En mouvement, un pixel physique au plus : sur un écran dense, jusqu'à
    // quatre fois moins de pixels à remplir. Avec l'atténuation, la taille
    // des points suit la hauteur du canevas et ne change pas à l'œil.
    const dpr = Math.min(enMouvement ? 1 : 2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    if (this.nuage) this.onVue?.();

    const [fr, fg, fb] = GL.hexToRgb(CONFIG.rendu.fond);
    gl.clearColor(fr, fg, fb, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Avant le rendu du nuage, et avant tout renoncement : la boussole reste
    // juste même sur une vue vide, et c'est le seul endroit par où passent tous
    // les changements d'orientation.
    this.boussole?.orienter(this._repereBoussole());

    if (!this.vao || !this.nbPoints) return;

    const { cible, distance } = this.cam;
    const { oeil } = this._repere();
    const proche = Math.max(0.5, distance * 0.002), loin = distance * 12 + 3000;
    const proj = GL.perspective(FOV_Y_DEG, w / h, proche, loin);
    // Avec l'EDL, le nuage se rend dans une texture, puis une passe plein
    // écran l'ombre selon la profondeur et l'écrit ici, profondeur comprise.
    const edl = CONFIG.rendu.edl && CONFIG.rendu.edl.actif ? this._cibleEDL(w, h) : null;
    if (edl) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, edl.fb);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    const vp = GL.multiply(proj, GL.lookAt(oeil, cible, [0, 1, 0]));

    const p = this.progPoints;
    gl.useProgram(p);
    gl.uniformMatrix4fv(p.u.u_vp, false, vp);
    gl.uniform3fv(p.u.u_camera, oeil);
    gl.uniform1f(p.u.u_taillePoint, CONFIG.rendu.taillePoint);
    gl.uniform1f(p.u.u_attenuation, CONFIG.rendu.attenuation ? 1 : 0);
    gl.uniform1f(p.u.u_hauteurViewport, h);
    gl.uniform1f(p.u.u_exagerationZ, CONFIG.rendu.exagerationZ);
    gl.uniform1f(p.u.u_zmin, this.zmin);
    gl.uniform1f(p.u.u_zref, this.zref);
    gl.uniform1i(p.u.u_mode, MODES[CONFIG.rendu.coloration] ?? 1);
    gl.uniform1f(p.u.u_ronds, CONFIG.rendu.pointsRonds ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.palette);
    gl.uniform1i(p.u.u_palette, 0);

    gl.bindVertexArray(this.vao);
    const dessines = enMouvement ? Math.max(1, Math.round(this.nbPoints * this._partMouvement)) : this.nbPoints;
    gl.drawArrays(gl.POINTS, 0, dessines);
    this.statsRendu = { dessines, total: this.nbPoints, enMouvement };
    if (enMouvement) this.dernierMouvement = { dessines, total: this.nbPoints };
    else if (this._etaitEnMouvement) this.onFinGeste?.();
    this._etaitEnMouvement = enMouvement;

    if (edl) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const e = this.progEDL;
      gl.useProgram(e);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, edl.couleur);
      gl.uniform1i(e.u.u_couleur, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, edl.profondeur);
      gl.uniform1i(e.u.u_profondeur, 1);
      gl.uniform2f(e.u.u_taille, w, h);
      gl.uniform1f(e.u.u_rayon, CONFIG.rendu.edl.rayon * Math.min(2, window.devicePixelRatio || 1));
      gl.uniform1f(e.u.u_force, CONFIG.rendu.edl.force);
      gl.uniform1f(e.u.u_proche, proche);
      gl.uniform1f(e.u.u_loin, loin);
      // Toujours écrite : la profondeur du nuage remplace celle du tampon,
      // pour que les tracés qui suivent se cachent derrière lui.
      gl.depthFunc(gl.ALWAYS);
      gl.bindVertexArray(this.vaoEDL);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthFunc(gl.LESS);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
    }

    // Les boîtes passent après, en tenant compte de la profondeur : une
    // détection derrière une crête reste masquée, ce qui donne la bonne lecture
    // spatiale.
    const l = this.progLignes;
    if (this.nbSommetsPointSel || this.nbSommetsMesureLigne || this.nbSommetsMesurePoints) {
      gl.useProgram(l);
      gl.uniformMatrix4fv(l.u.u_vp, false, vp);
      gl.uniform1f(l.u.u_exagerationZ, CONFIG.rendu.exagerationZ);
      gl.uniform1f(l.u.u_zmin, this.zmin);
      // Pour que les marqueurs (sélection, mesure) réagissent à la distance
      // exactement comme les points du nuage — voir le commentaire de
      // `lignesVS`. Sans objet pour les tracés en LINES qui suivent.
      gl.uniform3fv(l.u.u_camera, oeil);
      gl.uniform1f(l.u.u_hauteurViewport, h);
      gl.uniform1f(l.u.u_attenuation, CONFIG.rendu.attenuation ? 1 : 0);
      // À plat par défaut : sans ça, un `u_pointRond` resté à 1 d'un dessin de
      // marqueur précédent ferait lire `gl_PointCoord` — non défini hors d'un
      // dessin en POINTS — pendant les tracés en LINES qui suivent.
      gl.uniform1f(l.u.u_pointRond, 0.0);
    }
    // Taille des marqueurs asservie au réglage « Taille des points » : sinon
    // un gros réglage de points fait paraître les marqueurs petits par
    // comparaison, alors qu'ils doivent toujours dominer visuellement le
    // nuage. Plancher à 11 px pour rester visible même au minimum du curseur.
    const tailleMarqueur = Math.max(11, CONFIG.rendu.taillePoint * 2);
    const couleurMarqueur = [1.0, 0.25, 0.85, 1.0];   // rose — la seule couleur du lot qui ne sert à rien d'autre ici
    const tracerMarqueurs = (premier, nb) => {
      gl.uniform1f(l.u.u_pointRond, 1.0);
      // Le liseré et le remplissage partagent le même sommet, donc la même
      // profondeur exacte : au test par défaut (LESS), le second dessin n'est
      // jamais strictement plus proche que le premier et perd systématiquement
      // contre lui, quel que soit l'ordre — le remplissage rose ne s'affichait
      // donc jamais, seul le liseré sombre restait visible. LEQUAL le temps des
      // deux dessins laisse le second l'emporter à profondeur égale.
      gl.depthFunc(gl.LEQUAL);
      // Liseré fin (+4 px), pas épais : un liseré trop large à côté d'un
      // remplissage sombre proche du fond noir donnait l'impression d'un
      // marqueur entièrement noir plutôt que d'un point rose cerclé.
      gl.uniform1f(l.u.u_taillePoint, tailleMarqueur + 4);
      gl.uniform4f(l.u.u_couleur, 0.04, 0.05, 0.07, 1.0);
      gl.drawArrays(gl.POINTS, premier, nb);
      gl.uniform1f(l.u.u_taillePoint, tailleMarqueur);
      gl.uniform4f(l.u.u_couleur, ...couleurMarqueur);
      gl.drawArrays(gl.POINTS, premier, nb);
      gl.uniform1f(l.u.u_pointRond, 0.0);
      gl.depthFunc(gl.LESS);
    };

    // Marqueur ponctuel (croix retirée le 22/08/2026, retour utilisateur —
    // elle se mélangeait avec les points du nuage) : un point agrandi, liseré
    // sombre puis couleur par-dessus.
    if (this.nbSommetsPointSel) {
      gl.bindVertexArray(this.vaoPointSel);
      tracerMarqueurs(0, this.nbSommetsPointSel);
    }
    // Mesure : le trait d'abord, puis les mêmes marqueurs ponctuels que la
    // sélection sur ses deux bouts — même rose, pour lire d'un coup d'œil
    // « un point qu'on a visé », qu'il vienne de la sélection ou de la
    // mesure. Les deux plages vivent dans le même tampon, voir `definirMesure`.
    if (this.nbSommetsMesureLigne || this.nbSommetsMesurePoints) {
      gl.bindVertexArray(this.vaoMesure);
      if (this.nbSommetsMesureLigne) {
        gl.uniform4f(l.u.u_couleur, 0.3, 0.95, 1.0, 1.0);
        gl.drawArrays(gl.LINES, 0, this.nbSommetsMesureLigne);
      }
      if (this.nbSommetsMesurePoints) {
        tracerMarqueurs(this.nbSommetsMesureLigne, this.nbSommetsMesurePoints);
      }
    }
    gl.bindVertexArray(null);
  }
}

const MODES = { elevation: 0, classification: 1, intensite: 2, hauteur: 3, relief: 4 };
