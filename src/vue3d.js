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
    this._boucle = this._boucle.bind(this);
    this.actif = false;
  }

  demarrer() {
    if (this.actif) return;
    this.actif = true;
    requestAnimationFrame(this._boucle);
  }

  arreter() { this.actif = false; }

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

    this.cadrer();
  }

  /** Met à jour l'attribut de hauteur une fois la rastérisation faite. */
  definirHauteurs(hauteurs) {
    if (!this.vao) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[3]);
    gl.bufferData(gl.ARRAY_BUFFER, hauteurs, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
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
  }

  effacerFocus() { this.focus = null; }

  /**
   * Boîtes filaires des détections.
   *
   * Le rectangle englobant orienté serait plus fidèle, mais l'emprise en
   * cellules suffit à guider l'œil et se calcule sans repasser par la géométrie
   * de la tache — la lecture se fait de toute façon sur le nuage lui-même.
   */
  definirDetections(candidats, grille) {
    this.nbSommetsLignes = this._remplirBoites(candidats, grille, 'Lignes');
  }

  definirSelection(candidat, grille) {
    this.nbSommetsSel = candidat ? this._remplirBoites([candidat], grille, 'Sel') : 0;
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

  _brancherControles() {
    const c = this.canvas;
    let glisse = null;

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      glisse = {
        x: e.clientX, y: e.clientY,
        // Le bouton du milieu, le clic droit et Maj+glissé font tous du
        // déplacement : selon la souris ou le pavé, l'un des trois manque.
        pan: e.button === 1 || e.button === 2 || e.shiftKey,
      };
    });

    c.addEventListener('pointermove', (e) => {
      if (!glisse) return;
      const dx = e.clientX - glisse.x;
      const dy = e.clientY - glisse.y;
      glisse.x = e.clientX; glisse.y = e.clientY;

      if (glisse.pan) {
        // Déplacement dans le plan de l'écran, à l'échelle de la distance :
        // le point sous le curseur suit à peu près le curseur quel que soit le
        // niveau de zoom.
        const k = this.cam.distance * 0.0016;
        const ca = Math.cos(this.cam.azimut), sa = Math.sin(this.cam.azimut);
        this.cam.cible[0] -= (dx * ca - dy * sa * Math.sin(this.cam.elevation)) * k;
        this.cam.cible[2] -= (dx * sa + dy * ca * Math.sin(this.cam.elevation)) * k;
        this.cam.cible[1] += dy * k * Math.cos(this.cam.elevation);
      } else {
        this.cam.azimut -= dx * 0.006;
        // Bornes strictes : au zénith exact, le vecteur « haut » devient
        // colinéaire à l'axe de visée et lookAt produit une matrice dégénérée.
        this.cam.elevation = Math.max(-1.5, Math.min(1.5, this.cam.elevation + dy * 0.006));
      }
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
      this.cam.distance = Math.max(3, Math.min(4000, this.cam.distance * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
  }

  // ── Boucle de rendu ───────────────────────────────────────────────────────

  _boucle() {
    if (!this.actif) return;
    this._rendre();
    requestAnimationFrame(this._boucle);
  }

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

    const { cible, distance, azimut, elevation } = this.cam;
    const oeil = [
      cible[0] + distance * Math.cos(elevation) * Math.sin(azimut),
      cible[1] + distance * Math.sin(elevation),
      cible[2] + distance * Math.cos(elevation) * Math.cos(azimut),
    ];
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
