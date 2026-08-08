// Vue 3D du nuage : caméra orbitale, rendu par points, surlignage des
// détections.

class Vue3D {
  constructor(canvas) {
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

    // Caméra orbitale. Distance et cible en mètres, angles en radians.
    this.cam = { cible: [0, 0, 0], distance: 300, azimut: -Math.PI / 4, elevation: 0.6 };
    this.focus = null;

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

  /** Recentre la caméra sur l'ensemble du nuage. */
  cadrer() {
    if (!this.nuage) return;
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
   */
  _repere() {
    const { cible, distance, azimut: a, elevation: e } = this.cam;
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

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      glisse = {
        x: e.clientX, y: e.clientY,
        // Bouton principal : déplacement. Clic droit, bouton du milieu ou
        // Maj+glissé : orbite. Trois voies parce que selon la souris ou le pavé
        // tactile, l'une des trois manque.
        orbite: e.button === 1 || e.button === 2 || e.shiftKey,
      };
    });

    c.addEventListener('pointermove', (e) => {
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
      if (glisse) c.releasePointerCapture?.(e.pointerId);
      glisse = null;
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
    this.cam.elevation = 1.553;
    this.cam.azimut = 0;
    this.invalider();
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
    if (this.nbSommetsLignes || this.nbSommetsSel) {
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
    gl.bindVertexArray(null);
  }
}

const MODES = { elevation: 0, classification: 1, intensite: 2, hauteur: 3 };
