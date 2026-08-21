// Vue 3D du nuage : caméra orbitale, rendu par points, surlignage des
// détections.

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
    this.palette = GL.paletteClasses(gl, CONFIG.rendu.couleursClasse, CONFIG.rendu.couleurClasseDefaut);

    this.nuage = null;
    this.vao = null;
    this.buffers = [];
    this.nbPoints = 0;
    this.zmin = 0;
    this.zref = 1;

    this.vaoLignes = null;
    this.bufLignes = null;
    this.nbSommetsLignes = 0;
    this.vaoSel = null;
    this.bufSel = null;
    this.nbSommetsSel = 0;
    this.nbSommetsSentiers = 0;
    this.nbSommetsTraceSel = 0;
    this.vaoPointSel = null;
    this.bufPointSel = null;
    this.nbSommetsPointSel = 0;
    this.vaoMesure = null;
    this.bufMesure = null;
    this.nbSommetsMesure = 0;

    // Caméra orbitale. Distance et cible en mètres, angles en radians.
    this.cam = { cible: [0, 0, 0], distance: 300, azimut: -Math.PI / 4, elevation: 0.6 };
    this.focus = null;
    this._animation = 0;

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

    this.boussole = elementBoussole
      ? new Boussole(elementBoussole, (v) => this.orienterVers(v))
      : null;

    this._brancherControles();
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
    requestAnimationFrame(() => { this._planifie = false; this._rendre(); });
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
    // 16 bits bruts n'ont aucune signification absolue en LiDAR.
    this._attribut(vao, 2, nuage.intensite, 1, gl.UNSIGNED_SHORT, true);

    const h = hauteurs || new Float32Array(nuage.n);
    this._attribut(vao, 3, h, 1, gl.FLOAT, false);

    gl.bindVertexArray(null);
    this.vao = vao;

    this.cadrer();   // cadrer() invalide déjà
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
    this.nbSommetsLignes = 0;
    this.nbSommetsSel = 0;
    this.nbSommetsSentiers = 0;
    this.nbSommetsTraceSel = 0;
    this.nbSommetsPointSel = 0;
    this.nbSommetsMesure = 0;
    this.focus = null;
    this._arreterAnimation();
    this.invalider();
  }

  /** Recentre la caméra sur l'ensemble du nuage. */
  cadrer() {
    if (!this.nuage) return;
    this._arreterAnimation();
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
    this.focus = null;
    this.invalider();
  }

  /** Amène la caméra au-dessus d'une détection et la met en avant. */
  viser(candidat, marge = 18) {
    if (!this.nuage) return;
    this._arreterAnimation();
    const o = this.nuage.origine;
    const lx = candidat.x - o[0];
    const ly = candidat.y - o[1];
    this.cam.cible = [lx, (candidat.altitude - o[2] - this.zmin) * CONFIG.rendu.exagerationZ, -ly];
    this.cam.distance = Math.max(25, Math.sqrt(candidat.surface) * 3 + marge);
    this.cam.elevation = 0.45;
    const d = Math.sqrt(candidat.surface) * 1.6 + marge;
    this.focus = [lx - d, ly - d, lx + d, ly + d];
    this.invalider();
  }

  effacerFocus() { this.focus = null; this.invalider(); }

  /**
   * Recentre la caméra sur un point donné, sans toucher à sa distance ni à
   * son angle — contrairement à `viser`, qui cadre une détection. Sert à
   * retrouver un point cherché par ses coordonnées (voir « Point
   * sélectionné » dans app.js) sans le faire disparaître hors champ.
   */
  centrerSur(x, y, altitude) {
    if (!this.nuage) return;
    const o = this.nuage.origine;
    this.cam.cible = [x - o[0], (altitude - o[2] - this.zmin) * CONFIG.rendu.exagerationZ, -(y - o[1])];
    this.invalider();
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
   * Boîtes filaires des détections.
   *
   * Le rectangle englobant orienté serait plus fidèle, mais l'emprise en
   * cellules suffit à guider l'œil et se calcule sans repasser par la géométrie
   * de la tache — la lecture se fait de toute façon sur le nuage lui-même.
   */
  definirDetections(candidats, grille) {
    this.nbSommetsLignes = this._remplirBoites(candidats, grille, 'Lignes');
    this.invalider();
  }

  definirSelection(candidat, grille) {
    this.nbSommetsSel = candidat ? this._remplirBoites([candidat], grille, 'Sel') : 0;
    this.invalider();
  }

  /**
   * Sommets d'une croix posée au-dessus d'un point, reliée au sol par un
   * montant — en repère local. Une croix plutôt qu'un point seul : un point
   * n'a pas d'étendue à l'écran et disparaîtrait de profil selon l'angle de
   * vue. Partagée par `definirPointSelectionne` et `definirMesure`.
   */
  _croix(lx, ly, lz) {
    const h = 1.5, r = 0.5;
    return [
      lx, ly, lz, lx, ly, lz + h,                    // montant, du sol à la croix
      lx - r, ly, lz + h, lx + r, ly, lz + h,         // croix, est-ouest
      lx, ly - r, lz + h, lx, ly + r, lz + h,         // croix, nord-sud
    ];
  }

  /**
   * Marqueur du point choisi en mode Sélection (voir app.js).
   *
   * `p` est en Lambert-93 absolu, comme partout ailleurs dans l'API publique
   * (`viser`, `definirDetections`) ; la conversion vers le repère local du
   * nuage se fait ici, une fois.
   */
  definirPointSelectionne(p) {
    // L'altitude peut manquer (sol inconnu, sélectionné depuis la 2D) : sans
    // elle le montant n'a pas de hauteur à viser, donc pas de marqueur plutôt
    // qu'un marqueur planté à une hauteur inventée.
    if (!p || !this.nuage || !Number.isFinite(p.altitude)) {
      this.nbSommetsPointSel = 0;
      this.invalider();
      return;
    }
    const o = this.nuage.origine;
    const sommets = this._croix(p.x - o[0], p.y - o[1], p.altitude - o[2]);
    this.nbSommetsPointSel = this._televerserLignes(sommets, 'PointSel');
    this.invalider();
  }

  /**
   * Les deux points de la mesure en cours (voir app.js) : une croix sur
   * chacun, reliées par un trait direct — la ligne d'air dont la longueur
   * est la distance totale affichée dans le panneau.
   *
   * `a`/`b` en Lambert-93 absolu, `b` peut être `null` tant que le second
   * point n'a pas encore été cliqué.
   */
  definirMesure(a, b) {
    if (!a || !this.nuage || !Number.isFinite(a.altitude)) {
      this.nbSommetsMesure = 0;
      this.invalider();
      return;
    }
    const o = this.nuage.origine;
    const la = [a.x - o[0], a.y - o[1], a.altitude - o[2]];
    let sommets = this._croix(...la);
    if (b && Number.isFinite(b.altitude)) {
      const lb = [b.x - o[0], b.y - o[1], b.altitude - o[2]];
      sommets = sommets.concat(this._croix(...lb), la, lb);
    }
    this.nbSommetsMesure = this._televerserLignes(sommets, 'Mesure');
    this.invalider();
  }

  _remplirBoites(candidats, grille, suffixe) {
    const gl = this.gl;
    const o = this.nuage.origine;
    const sommets = [];

    for (const c of candidats) {
      const b = c.empriseCellules;
      const x0 = grille.emprise.xmin + b.xmin * grille.pas - o[0];
      const x1 = grille.emprise.xmin + (b.xmax + 1) * grille.pas - o[0];
      const y0 = grille.emprise.ymin + b.ymin * grille.pas - o[1];
      const y1 = grille.emprise.ymin + (b.ymax + 1) * grille.pas - o[1];
      const zb = c.altitude - o[2];
      const zh = zb + Math.max(1.2, c.hauteurMax + 0.4);

      const coins = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      for (let i = 0; i < 4; i++) {
        const a = coins[i], d = coins[(i + 1) % 4];
        sommets.push(a[0], a[1], zb, d[0], d[1], zb);   // ceinture basse
        sommets.push(a[0], a[1], zh, d[0], d[1], zh);   // ceinture haute
        sommets.push(a[0], a[1], zb, a[0], a[1], zh);   // montant
      }
    }

    return this._televerserLignes(sommets, suffixe);
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

  /**
   * Tracés de sentiers, posés sur le terrain.
   *
   * Les polylignes sont **rééchantillonnées** avant d'être tracées : la
   * simplification de Douglas-Peucker laisse parfois des dizaines de mètres
   * entre deux sommets, et un segment droit sur cette distance traverserait le
   * relief au lieu de l'épouser. On redécoupe donc au pas de la grille et l'on
   * relève l'altitude du terrain en chaque point.
   *
   * Le tracé est relevé de quelques centimètres : posé exactement sur le MNT il
   * disparaîtrait derrière les points du sol, à égalité de profondeur.
   */
  definirSentiers(traces, grille) {
    this.nbSommetsSentiers = this._remplirTraces(traces, grille, 'Sentiers');
    this.invalider();
  }

  definirSentierChoisi(trace, grille) {
    this.nbSommetsTraceSel = trace ? this._remplirTraces([trace], grille, 'TraceSel') : 0;
    this.invalider();
  }

  _remplirTraces(traces, grille, suffixe) {
    if (!this.nuage || !grille) return 0;
    const o = this.nuage.origine;
    const sommets = [];

    // Altitude du terrain en un point Lambert-93, relative à l'origine.
    const solA = (x, y) => {
      const cx = Math.min(grille.W - 1, Math.max(0, ((x - grille.emprise.xmin) / grille.pas) | 0));
      const cy = Math.min(grille.H - 1, Math.max(0, ((y - grille.emprise.ymin) / grille.pas) | 0));
      return grille.mnt[cy * grille.W + cx];
    };

    const PAS = 2;            // mètres entre deux échantillons
    const HAUTEUR = 0.35;     // décollement du sol, en mètres

    for (const t of traces) {
      const pts = t.points || [];
      let precedent = null;

      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1];
        const [x2, y2] = pts[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / PAS));

        for (let k = 0; k <= n; k++) {
          const x = x1 + (x2 - x1) * (k / n);
          const y = y1 + (y2 - y1) * (k / n);
          const p = [x - o[0], y - o[1], solA(x, y) + HAUTEUR];
          // Le shader dessine des GL_LINES : chaque segment veut ses deux bouts.
          if (precedent) sommets.push(...precedent, ...p);
          precedent = p;
        }
      }
    }
    return this._televerserLignes(sommets, suffixe);
  }

  /** Amène la caméra sur un tracé, cadré sur toute sa longueur. */
  viserTrace(trace, grille) {
    if (!this.nuage || !trace?.points?.length) return;
    this._arreterAnimation();
    const o = this.nuage.origine;
    const xs = trace.points.map((q) => q[0]);
    const ys = trace.points.map((q) => q[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const etendue = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));

    this.cam.cible = [cx - o[0], (trace.altitude - o[2] - this.zmin) * CONFIG.rendu.exagerationZ, -(cy - o[1])];
    this.cam.distance = Math.max(40, etendue * 1.6);
    this.cam.elevation = 0.7;
    this.focus = null;
    this.invalider();
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
    const tan = Math.tan((52 * Math.PI / 180) / 2);
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
   * Point du plan horizontal passant par la cible, sous un pixel donné.
   *
   * Ce plan sert de sol virtuel : il donne un point d'accroche stable pour
   * saisir le terrain et pour zoomer là où pointe le curseur, sans avoir à
   * relire le tampon de profondeur. À l'échelle où l'on inspecte une structure,
   * il colle de près au relief réel.
   *
   * Renvoie `null` en visée rasante, quand le rayon devient parallèle au plan
   * et que l'intersection part à l'infini.
   */
  _pointSousCurseur(ev) {
    const rayon = this._rayonBrut(ev);
    if (!rayon) return null;
    const { oeil, dir } = rayon;

    if (Math.abs(dir[1]) < 1e-3) return null;
    const t = (this.cam.cible[1] - oeil[1]) / dir[1];
    if (!(t > 0)) return null;

    const p = [oeil[0] + dir[0] * t, this.cam.cible[1], oeil[2] + dir[2] * t];
    return p.every(Number.isFinite) ? p : null;
  }

  /**
   * Contrôles « à la Google Earth » : glisser déplace le terrain, la molette
   * zoome sous le curseur.
   *
   * L'inverse — glisser pour orbiter, molette vers le centre — est l'usage des
   * visionneuses 3D, mais il est pénible ici. On balaie un kilomètre carré à la
   * recherche de structures : le geste dominant est le déplacement, pas la
   * rotation, et l'onglet Carte se manipule déjà ainsi. Surtout, zoomer vers le
   * centre d'orbite éloigne de ce qu'on vient de repérer au bord de l'écran, et
   * oblige à alterner déplacement et zoom sans fin.
   */
  _brancherControles() {
    const c = this.canvas;
    let glisse = null;

    // Pincement à deux doigts : `wheel` ne se déclenche jamais pour un geste
    // tactile réel — sans ce suivi, aucun zoom n'est possible au doigt. Un
    // deuxième doigt qui touche par accident pendant un glissé (la paume, un
    // pouce) est le cas courant à ne pas laisser corrompre le déplacement en
    // cours : avant ce garde, un pointeur en trop remplaçait `glisse` par sa
    // propre référence et son relâchement arrêtait tout le geste en cours,
    // ce qui rendait le déplacement erratique dès qu'un second contact
    // apparaissait — le mode courant sur un écran tactile.
    //
    // Les deux doigts portent aussi l'orientation : sur tactile, ni Maj ni
    // clic droit n'existent pour distinguer orbite et déplacement, donc rien
    // ne pouvait déclencher `glisse.orbite`. Le milieu des deux doigts qui
    // glisse pivote la vue — écarter ou rapprocher les doigts zoome en même
    // temps, les deux gestes se lisent indépendamment sur le même geste.
    const doigts = new Map();
    let pince = null;

    // Point de départ en pixels, pour distinguer un clic d'un glissé — un
    // clic en mode sélection vise un point, un glissé ne doit pas en viser un
    // au relâchement. `pinceUtilisee` fait pareil pour un pincement à deux
    // doigts qui se termine à un seul.
    let depart = null;
    let pinceUtilisee = false;

    const milieu = () => {
      const [a, b] = [...doigts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };
    const ecart = () => {
      const [a, b] = [...doigts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    c.addEventListener('pointerdown', (e) => {
      this._arreterAnimation();
      c.setPointerCapture(e.pointerId);
      doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (doigts.size >= 2) {
        glisse = null;
        depart = null;
        pinceUtilisee = true;
        const m = milieu();
        pince = { distance: ecart(), cx: m.x, cy: m.y };
        return;
      }
      depart = [e.clientX, e.clientY];
      glisse = {
        x: e.clientX, y: e.clientY,
        // Bouton principal : déplacement. Clic droit, bouton du milieu ou
        // Maj+glissé : orbite. Trois voies parce que selon la souris ou le pavé
        // tactile, l'une des trois manque.
        orbite: e.button === 1 || e.button === 2 || e.shiftKey,
      };
    });

    c.addEventListener('pointermove', (e) => {
      if (doigts.has(e.pointerId)) doigts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pince && doigts.size >= 2) {
        const m = milieu();
        const d = ecart();

        // Zoom sur l'écart, ancré au milieu courant — recalculé à chaque
        // image, comme pour la molette, parce que ce milieu se déplace en
        // même temps que la vue pivote.
        if (pince.distance > 0) {
          const avant = this._pointSousCurseur({ clientX: m.x, clientY: m.y });
          const ancienne = this.cam.distance;
          this.cam.distance = Math.max(2, Math.min(6000, ancienne * (pince.distance / d)));
          if (avant) {
            const k = this.cam.distance / ancienne;
            for (const i of [0, 2]) {
              this.cam.cible[i] = avant[i] + (this.cam.cible[i] - avant[i]) * k;
            }
          }
        }
        pince.distance = d;

        this.cam.azimut -= (m.x - pince.cx) * 0.006;
        this.cam.elevation = Math.max(-1.553, Math.min(1.553, this.cam.elevation + (m.y - pince.cy) * 0.006));
        pince.cx = m.x; pince.cy = m.y;

        this.invalider();
        return;
      }

      if (!glisse) return;
      const dx = e.clientX - glisse.x;
      const dy = e.clientY - glisse.y;

      if (glisse.orbite) {
        this.cam.azimut -= dx * 0.006;
        // Bornes strictes : au zénith exact, le vecteur « haut » devient
        // colinéaire à l'axe de visée et lookAt produit une matrice dégénérée.
        // 89° laisse une vue quasi verticale sans l'atteindre.
        this.cam.elevation = Math.max(-1.553, Math.min(1.553, this.cam.elevation + dy * 0.006));
      } else {
        this._deplacer(glisse, e, dx, dy);
      }
      glisse.x = e.clientX; glisse.y = e.clientY;
      this.invalider();
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
        glisse = { x: pos.x, y: pos.y, orbite: false };
      } else if (doigts.size === 0) {
        glisse = null;
      }
    };
    c.addEventListener('pointerup', relacher);
    c.addEventListener('pointercancel', relacher);
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const avant = this._pointSousCurseur(e);
      const ancienne = this.cam.distance;
      this.cam.distance = Math.max(2, Math.min(6000, ancienne * Math.exp(e.deltaY * 0.0012)));

      // Zoom sous le curseur : on rapproche la cible du point visé dans le même
      // rapport que la distance. Ce point reste donc immobile à l'écran, et
      // l'on plonge vers ce qu'on regarde au lieu de vers le centre.
      if (avant) {
        const k = this.cam.distance / ancienne;
        for (const i of [0, 2]) {
          this.cam.cible[i] = avant[i] + (this.cam.cible[i] - avant[i]) * k;
        }
      }
      this.invalider();
    }, { passive: false });

    c.addEventListener('click', (e) => {
      const bouge = pinceUtilisee ||
        (depart && Math.hypot(e.clientX - depart[0], e.clientY - depart[1]) > 4);
      pinceUtilisee = false;
      depart = null;
      if (bouge || this.mode === 'deplacement') return;
      const rayon = this.rayonEcran(e);
      if (!rayon) return;
      if (this.mode === 'selection') this.onSelectionPoint?.(rayon);
      else if (this.mode === 'mesure') this.onPointMesure?.(rayon);
    });

    // Double-clic : amener sous les yeux ce qu'on vient de repérer.
    c.addEventListener('dblclick', (e) => {
      const p = this._pointSousCurseur(e);
      if (!p) return;
      this.cam.cible[0] = p[0];
      this.cam.cible[2] = p[2];
      this.cam.distance = Math.max(8, this.cam.distance * 0.45);
      this.invalider();
    });
  }

  /**
   * Déplacement : le terrain suit le curseur.
   *
   * On mesure le point du plan sous le curseur avant et après le mouvement, et
   * l'on décale la cible de leur différence — la surface reste donc « collée »
   * au doigt, à n'importe quelle inclinaison. En visée rasante l'intersection
   * diverge, on retombe alors sur un déplacement à l'échelle de la distance.
   */
  _deplacer(glisse, ev, dx, dy) {
    const avant = this._pointSousCurseur({ clientX: glisse.x, clientY: glisse.y });
    const apres = this._pointSousCurseur(ev);

    if (avant && apres) {
      this.cam.cible[0] += avant[0] - apres[0];
      this.cam.cible[2] += avant[2] - apres[2];
      return;
    }

    const r = this.canvas.getBoundingClientRect();
    const k = 2 * this.cam.distance * Math.tan((52 * Math.PI / 180) / 2) / Math.max(1, r.height);
    const { droite, avant: dev } = this._repere();
    // Composante horizontale de l'axe de visée : le déplacement vertical de la
    // souris avance ou recule au sol, il ne doit pas changer l'altitude visée.
    const sol = Math.hypot(dev[0], dev[2]) || 1;
    for (const i of [0, 2]) {
      this.cam.cible[i] -= droite[i] * dx * k;
      this.cam.cible[i] += (dev[i] / sol) * dy * k;
    }
  }

  /** Vue verticale, la plus lisible pour balayer une dalle. */
  vueDeDessus() {
    this._animerVers(0, 1.553);
  }

  // ── Orientation ───────────────────────────────────────────────────────────

  /**
   * Amène la vue sur une direction du monde — ce que fait un clic sur la
   * boussole.
   *
   * Deux lectures possibles pour un point cardinal, opposées : « se placer au
   * nord » (le nord finit alors en bas de l'écran) ou « regarder vers le nord »
   * (il finit en haut). C'est la seconde qui est retenue, parce que le besoin
   * est de retrouver l'orientation d'une carte — le nord en haut. L'élévation ne
   * bouge pas : on veut pivoter, pas changer de point de vue.
   *
   * L'axe vertical, lui, ne peut se lire que comme un déplacement : on se met
   * au-dessus ou en dessous, l'azimut restant celui qu'on avait.
   */
  orienterVers(v) {
    if (Math.abs(v[1]) > 0.5) {
      this._animerVers(this.cam.azimut, v[1] > 0 ? 1.553 : -1.553);
    } else {
      // Inversion de `_repere` : l'axe de visée horizontal vaut (−sin a, −cos a).
      this._animerVers(Math.atan2(-v[0], -v[2]), this.cam.elevation);
    }
  }

  /**
   * Pivote la caméra jusqu'aux angles demandés, en un quart de seconde.
   *
   * Le rendu est à la demande — c'est ici la seule chose qui l'anime, et elle
   * s'arrête d'elle-même. Un saut instantané d'un quart de tour est
   * désorientant : sans le mouvement, rien ne dit si l'on a tourné à gauche ou à
   * droite, et il faut relire la scène entière pour s'y retrouver. C'est
   * précisément ce que la boussole cherche à éviter.
   */
  _animerVers(azimut, elevation, duree = 260) {
    this._arreterAnimation();
    const a0 = this.cam.azimut;
    const e0 = this.cam.elevation;
    // Chemin le plus court : sans ce repli dans [−π, π], passer de 3,0 à −3,0
    // rad ferait un tour complet pour 16° d'écart réel.
    const da = Math.atan2(Math.sin(azimut - a0), Math.cos(azimut - a0));
    const de = elevation - e0;
    // Déjà orienté ainsi : une quinzaine d'images d'un nuage de plusieurs
    // millions de points pour ne rien déplacer.
    if (Math.abs(da) < 1e-4 && Math.abs(de) < 1e-4) return;
    const t0 = performance.now();

    const pas = () => {
      const u = Math.min(1, (performance.now() - t0) / duree);
      const k = u * u * (3 - 2 * u);   // départ et arrivée amortis
      this.cam.azimut = a0 + da * k;
      this.cam.elevation = e0 + de * k;
      this.invalider();
      this._animation = u < 1 ? requestAnimationFrame(pas) : 0;
    };
    pas();
  }

  /** Rend la main à l'utilisateur : tout geste prime sur l'animation en cours. */
  _arreterAnimation() {
    if (this._animation) cancelAnimationFrame(this._animation);
    this._animation = 0;
  }

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

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);

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
    const proj = GL.perspective(52, w / h, Math.max(0.5, distance * 0.002), distance * 12 + 3000);
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

    gl.uniform1f(p.u.u_focusActif, this.focus ? 1 : 0);
    gl.uniform4fv(p.u.u_focus, this.focus || [0, 0, 0, 0]);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.nbPoints);

    // Les boîtes passent après, en tenant compte de la profondeur : une
    // détection derrière une crête reste masquée, ce qui donne la bonne lecture
    // spatiale.
    const l = this.progLignes;
    if (this.nbSommetsLignes || this.nbSommetsSel || this.nbSommetsSentiers
      || this.nbSommetsTraceSel || this.nbSommetsPointSel || this.nbSommetsMesure) {
      gl.useProgram(l);
      gl.uniformMatrix4fv(l.u.u_vp, false, vp);
      gl.uniform1f(l.u.u_exagerationZ, CONFIG.rendu.exagerationZ);
      gl.uniform1f(l.u.u_zmin, this.zmin);
    }
    if (this.nbSommetsLignes) {
      gl.uniform4f(l.u.u_couleur, 0.30, 0.85, 1.0, 1.0);
      gl.bindVertexArray(this.vaoLignes);
      gl.drawArrays(gl.LINES, 0, this.nbSommetsLignes);
    }
    if (this.nbSommetsSel) {
      gl.uniform4f(l.u.u_couleur, 1.0, 0.85, 0.25, 1.0);
      gl.bindVertexArray(this.vaoSel);
      gl.drawArrays(gl.LINES, 0, this.nbSommetsSel);
    }
    // Sentiers en orangé, comme sur la carte : le même objet garde la même
    // couleur d'une vue à l'autre.
    if (this.nbSommetsSentiers) {
      gl.uniform4f(l.u.u_couleur, 1.0, 0.54, 0.24, 1.0);
      gl.bindVertexArray(this.vaoSentiers);
      gl.drawArrays(gl.LINES, 0, this.nbSommetsSentiers);
    }
    if (this.nbSommetsTraceSel) {
      gl.uniform4f(l.u.u_couleur, 1.0, 1.0, 1.0, 1.0);
      gl.bindVertexArray(this.vaoTraceSel);
      gl.drawArrays(gl.LINES, 0, this.nbSommetsTraceSel);
    }
    // Magenta : la seule couleur du lot qui ne sert à rien d'autre dans cette
    // vue, pour rester lisible quel que soit ce qu'il y a dessous.
    if (this.nbSommetsPointSel) {
      gl.uniform4f(l.u.u_couleur, 1.0, 0.25, 0.85, 1.0);
      gl.bindVertexArray(this.vaoPointSel);
      gl.drawArrays(gl.LINES, 0, this.nbSommetsPointSel);
    }
    // Cyan clair : distinct du magenta de la sélection, pour les cas — rares
    // mais possibles — où les deux marqueurs sont posés en même temps.
    if (this.nbSommetsMesure) {
      gl.uniform4f(l.u.u_couleur, 0.3, 0.95, 1.0, 1.0);
      gl.bindVertexArray(this.vaoMesure);
      gl.drawArrays(gl.LINES, 0, this.nbSommetsMesure);
    }
    gl.bindVertexArray(null);
  }
}

const MODES = { elevation: 0, classification: 1, intensite: 2, hauteur: 3, relief: 4 };
