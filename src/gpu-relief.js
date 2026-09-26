// Calcul du relief sur la carte graphique.
//
// Le relief de relief.js est du calcul pur, cellule par cellule : exactement ce
// que fait une carte graphique, des milliers à la fois. Mesuré sur une dalle
// entière à 50 cm (2000 × 2000), sur une puce graphique intégrée d'ordinateur
// portable : Sky-View Factor en 0,31 s contre 11,6 s en JavaScript. C'est ce
// qui rend envisageable un relief recalculé à chaque vue.
//
// relief.js reste la **référence** : chaque noyau (shaders.js, section « Calcul
// du relief ») en est la traduction ligne à ligne, et ce module ne rend rien
// qu'il n'ait d'abord vérifié contre elle. Au premier usage, il calcule une
// petite surface d'essai des deux façons et compare ; au moindre écart, ou sans
// WebGL2 et texture flottante, il se déclare indisponible et relief.js calcule
// comme avant. Un pilote graphique défaillant ne produit donc jamais une image
// fausse, seulement une image plus lente.
//
// Un contexte WebGL à part, jamais celui de la vue 3D : les deux ne partagent
// ni état ni programme, et la perte de l'un ne touche pas l'autre.

const GPU_RELIEF = (() => {
  // Bande de lignes traitée par appel de dessin. Un seul appel sur une dalle
  // entière peut dépasser le délai au-delà duquel Windows réinitialise la carte
  // graphique (environ 2 s) sur une machine lente ; par bandes, chaque appel
  // reste court.
  const LIGNES_PAR_BANDE = 256;

  let etat = null;   // { gl, programmes, tri } ; `false` = indisponible
  let raison = '';

  function creer() {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2', { antialias: false, depth: false, preserveDrawingBuffer: false });
    if (!gl) { raison = 'WebGL2 absent'; return false; }
    // Rendre dans une texture flottante n'est pas garanti par WebGL2 seul.
    if (!gl.getExtension('EXT_color_buffer_float')) { raison = 'textures flottantes non rendables'; return false; }
    canvas.addEventListener('webglcontextlost', () => { etat = false; raison = 'contexte perdu'; });

    const programmes = {};
    for (const [nom, fs] of [['horizons', SHADERS.horizonsFS], ['ombrages', SHADERS.ombragesFS],
      ['microPrep', SHADERS.microPrepFS], ['boite', SHADERS.boiteFS], ['microFin', SHADERS.microFinFS]]) {
      programmes[nom] = GL.program(gl, SHADERS.reliefVS, fs);
    }
    const tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    return { gl, programmes, tri, max: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
  }

  /** Le contexte, créé et vérifié au premier appel. `null` si indisponible. */
  function contexte() {
    if (etat === null) {
      try {
        etat = creer();
        if (etat) {
          const ecart = autocontrole();
          if (ecart) { raison = ecart; etat = false; }
        }
      } catch (e) {
        raison = e.message || String(e);
        etat = false;
      }
      if (!etat) console.warn(`Relief calculé sur le processeur : ${raison}`);
    }
    return etat || null;
  }

  // ── Textures et passes ────────────────────────────────────────────────────

  function texture(gl, W, H, interne, format, donnees) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, interne, W, H, 0, format, gl.FLOAT, donnees);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Grille → texture RG32F (altitude, validité). */
  function textureGrille(gl, t) {
    const rg = new Float32Array(t.N * 2);
    for (let i = 0; i < t.N; i++) {
      rg[2 * i] = t.mnt[i];
      rg[2 * i + 1] = t.valide ? t.valide[i] : 1;
    }
    return texture(gl, t.W, t.H, gl.RG32F, gl.RG, rg);
  }

  function cible(gl, W, H) {
    const tex = texture(gl, W, H, gl.RGBA32F, gl.RGBA, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('cible de rendu flottante refusée');
    }
    return { tex, fb };
  }

  /**
   * Lance un programme sur toute la cible, par bandes de lignes, avec les
   * textures d'entrée données (`unites` : nom d'uniform → texture).
   */
  function passe(e, prog, dest, W, H, unites) {
    const { gl, tri } = e;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    const loc = gl.getAttribLocation(prog, 'a_p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    let unite = 0;
    for (const [nom, tex] of Object.entries(unites)) {
      gl.activeTexture(gl.TEXTURE0 + unite);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(prog.u[nom], unite++);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fb);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.SCISSOR_TEST);
    for (let y = 0; y < H; y += LIGNES_PAR_BANDE) {
      gl.scissor(0, y, W, Math.min(LIGNES_PAR_BANDE, H - y));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.flush();
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  function lire(gl, dest, W, H) {
    const px = new Float32Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fb);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, px);
    return px;
  }

  function liberer(gl, ...objets) {
    for (const o of objets) {
      if (!o) continue;
      if (o.fb) { gl.deleteFramebuffer(o.fb); gl.deleteTexture(o.tex); } else gl.deleteTexture(o);
    }
  }

  function tropGrande(e, t) {
    return t.W > e.max || t.H > e.max;
  }

  // ── Noyaux ────────────────────────────────────────────────────────────────

  /**
   * SVF et ouvertures, mêmes sorties que `RELIEF.balayerHorizons`.
   * @returns {?{svf, ouverturePositive, ouvertureNegative}} `null` = à faire sur le processeur
   */
  function horizons(t, n, R, e = contexte()) {
    if (!e || tropGrande(e, t) || n > 32) return null;
    const { gl } = e;
    const prog = e.programmes.horizons;

    // Directions en double précision, puis le pas de chaque direction comme
    // le parcourt relief.js : `portee = k / majeur`, soit un pas de
    // `(dx, dy) / majeur` cellules et de `pas / majeur` mètres.
    const dir = new Float32Array(32 * 4);
    const reste = new Float32Array(32 * 2);
    const majeurX = new Int32Array(32);
    for (let d = 0; d < n; d++) {
      const a = (d / n) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      const mx = Math.abs(dx) >= Math.abs(dy);
      const majeur = mx ? Math.abs(dx) : Math.abs(dy);
      const px = dx / majeur, py = dy / majeur;
      dir.set([px, py, t.pas / majeur, Math.max(1, Math.floor(R * majeur))], d * 4);
      reste.set([px - Math.fround(px), py - Math.fround(py)], d * 2);
      majeurX[d] = mx ? 1 : 0;
    }

    const grille = textureGrille(gl, t);
    const dest = cible(gl, t.W, t.H);
    try {
      gl.useProgram(prog);
      gl.uniform1i(prog.u.u_W, t.W);
      gl.uniform1i(prog.u.u_H, t.H);
      gl.uniform1i(prog.u.u_n, n);
      gl.uniform4fv(gl.getUniformLocation(prog, 'u_dir[0]'), dir);
      gl.uniform2fv(gl.getUniformLocation(prog, 'u_dirReste[0]'), reste);
      gl.uniform1iv(gl.getUniformLocation(prog, 'u_majeurX[0]'), majeurX);
      passe(e, prog, dest, t.W, t.H, { u_grille: grille });
      const px = lire(gl, dest, t.W, t.H);

      const svf = new Float32Array(t.N);
      const pos = new Float32Array(t.N);
      const neg = new Float32Array(t.N);
      for (let i = 0; i < t.N; i++) {
        const k = i * 4;
        // Cellule sans donnée : NaN, exactement comme relief.js.
        if (px[k + 3] < 0.5) { svf[i] = NaN; pos[i] = NaN; neg[i] = NaN; continue; }
        svf[i] = px[k]; pos[i] = px[k + 1]; neg[i] = px[k + 2];
      }
      return { svf, ouverturePositive: pos, ouvertureNegative: neg };
    } finally {
      liberer(gl, grille, dest);
    }
  }

  /**
   * Ombrages de Horn, un par soleil (quatre au plus), comme `RELIEF.ombrage`
   * sur les gradients partagés. Soleils en degrés : `[[azimut, hauteur], …]`.
   * @returns {?Float32Array[]}
   */
  function ombrages(t, soleils, e = contexte()) {
    if (!e || tropGrande(e, t) || soleils.length > 4) return null;
    const { gl } = e;
    const prog = e.programmes.ombrages;
    const L = new Float32Array(12);
    soleils.forEach(([azimut, hauteur], s) => {
      const az = azimut * Math.PI / 180, el = hauteur * Math.PI / 180;
      L.set([Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)], s * 3);
    });

    // Même entrée que les gradients côté processeur : le MNT tel quel, y
    // compris l'altitude de repli des cellules sans donnée.
    const grille = texture(gl, t.W, t.H, gl.R32F, gl.RED, t.mnt instanceof Float32Array ? t.mnt : Float32Array.from(t.mnt));
    const dest = cible(gl, t.W, t.H);
    try {
      gl.useProgram(prog);
      gl.uniform1i(prog.u.u_W, t.W);
      gl.uniform1i(prog.u.u_H, t.H);
      gl.uniform1f(prog.u.u_pas, t.pas);
      gl.uniform1i(prog.u.u_nbSoleils, soleils.length);
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_soleil[0]'), L);
      passe(e, prog, dest, t.W, t.H, { u_grille: grille });
      const px = lire(gl, dest, t.W, t.H);
      return soleils.map((_, s) => {
        const out = new Float32Array(t.N);
        for (let i = 0; i < t.N; i++) out[i] = px[i * 4 + s];
        return out;
      });
    } finally {
      liberer(gl, grille, dest);
    }
  }

  /**
   * Micro-relief, mêmes sorties que `RELIEF.microRelief` : MNT moins sa
   * moyenne locale en convolution normalisée (trois boîtes), NaN hors marge.
   * @returns {?Float32Array}
   */
  function microRelief(t, r, e = contexte()) {
    if (!e || tropGrande(e, t)) return null;
    const { gl } = e;
    const P = e.programmes;

    // Référence d'altitude : la moyenne des cellules valides, pour que les
    // sommes de la boîte portent sur des écarts de quelques mètres et non sur
    // des altitudes de mille mètres, où la simple précision perdrait le
    // centimètre.
    let somme = 0, nb = 0;
    for (let i = 0; i < t.N; i++) if (!t.valide || t.valide[i]) { somme += t.mnt[i]; nb++; }
    const ref = nb ? somme / nb : 0;

    const grille = textureGrille(gl, t);
    const a = cible(gl, t.W, t.H), b = cible(gl, t.W, t.H), fin = cible(gl, t.W, t.H);
    try {
      gl.useProgram(P.microPrep);
      gl.uniform1f(P.microPrep.u.u_ref, ref);
      passe(e, P.microPrep, a, t.W, t.H, { u_grille: grille });

      gl.useProgram(P.boite);
      gl.uniform1i(P.boite.u.u_W, t.W);
      gl.uniform1i(P.boite.u.u_H, t.H);
      gl.uniform1i(P.boite.u.u_r, r);
      // Trois fois horizontal puis vertical, dans l'ordre de flouBoite.
      for (let k = 0; k < 3; k++) {
        gl.useProgram(P.boite);
        gl.uniform1i(P.boite.u.u_horizontal, 1);
        passe(e, P.boite, b, t.W, t.H, { u_src: a.tex });
        gl.useProgram(P.boite);
        gl.uniform1i(P.boite.u.u_horizontal, 0);
        passe(e, P.boite, a, t.W, t.H, { u_src: b.tex });
      }

      gl.useProgram(P.microFin);
      gl.uniform1i(P.microFin.u.u_W, t.W);
      gl.uniform1i(P.microFin.u.u_H, t.H);
      gl.uniform1i(P.microFin.u.u_marge, 3 * r);
      gl.uniform1f(P.microFin.u.u_ref, ref);
      passe(e, P.microFin, fin, t.W, t.H, { u_grille: grille, u_lisse: a.tex });
      const px = lire(gl, fin, t.W, t.H);
      const out = new Float32Array(t.N);
      for (let i = 0; i < t.N; i++) out[i] = px[i * 4 + 3] > 0.5 ? px[i * 4] : NaN;
      return out;
    } finally {
      liberer(gl, grille, a, b, fin);
    }
  }

  // ── Autocontrôle ──────────────────────────────────────────────────────────

  /**
   * Calcule une petite surface d'essai sur la carte graphique et sur le
   * processeur, et compare. Rend `''` si tout concorde, sinon la raison.
   *
   * La surface mêle ce qui a déjà piégé ce code : une pente, une bosse, un
   * creux, et des cellules sans donnée — c'est au bord des trous que les
   * arrondis de la simple précision se voient. Tolérances : l'écart **moyen**
   * doit rester infime ; l'écart maximal est plus large, parce qu'au bord
   * d'un trou un échantillon peut basculer d'une ligne à la voisine en simple
   * précision (mesuré : 0,013 de SVF au pire, sur une seule cellule).
   */
  function autocontrole() {
    const W = 72, H = 64, N = W * H, pas = 0.5;
    const mnt = new Float32Array(N), valide = new Uint8Array(N).fill(1);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const bosse = 1.2 * Math.exp(-((x - 30) ** 2 + (y - 28) ** 2) / 40);
        const creux = -0.8 * Math.exp(-((x - 50) ** 2 + (y - 40) ** 2) / 25);
        mnt[y * W + x] = 300 + 0.36 * x * pas + 0.1 * y * pas + bosse + creux;
      }
    }
    for (let y = 20; y < 24; y++) for (let x = 44; x < 48; x++) valide[y * W + x] = 0;
    const t = { W, H, N, pas, mnt, valide };
    const cpu = { moteur: 'cpu' };

    const compare = (nom, a, b, tolMoy, tolMax) => {
      let s = 0, n = 0, m = 0;
      for (let i = 0; i < a.length; i++) {
        const fa = Number.isFinite(a[i]), fb = Number.isFinite(b[i]);
        if (fa !== fb) return `${nom} : cellule ${i} définie d'un côté seulement`;
        if (!fa) continue;
        const d = Math.abs(a[i] - b[i]);
        s += d; n++; if (d > m) m = d;
      }
      if (n && (s / n > tolMoy || m > tolMax)) {
        return `${nom} : écart moyen ${(s / n).toExponential(1)}, maximal ${m.toExponential(1)}`;
      }
      return '';
    };

    const e = etat;
    const h = horizons(t, 8, 20, e);
    const hc = RELIEF.balayerHorizons(t, { ...cpu, svfDirections: 8, svfRayonM: 10 });
    const o = ombrages(t, [[315, 45], [45, 45], [135, 45], [225, 45]], e);
    const g = RELIEF.gradients(t);
    const m = microRelief(t, 4, e);
    const mc = RELIEF.microRelief(t, 2, cpu);
    return compare('SVF', h.svf, hc.svf, 1e-4, 0.03)
      || compare('ouverture positive', h.ouverturePositive, hc.ouverturePositive, 1e-2, 2)
      || compare('ouverture négative', h.ouvertureNegative, hc.ouvertureNegative, 1e-2, 2)
      || [315, 45, 135, 225].map((az, s) => compare(`ombrage ${az}°`, o[s], RELIEF.ombrage(t, az, 45, g), 1e-5, 1e-4)).find(Boolean)
      || compare('micro-relief', m, mc, 1e-4, 2e-3)
      || '';
  }

  return {
    horizons: (t, n, R) => horizons(t, n, R),
    ombrages: (t, soleils) => ombrages(t, soleils),
    microRelief: (t, r) => microRelief(t, r),
    /** `true` si la carte graphique est prête et vérifiée. */
    disponible: () => !!contexte(),
    raison: () => raison,
  };
})();
