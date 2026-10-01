// Le graphique du profil : un canevas 2D, distance le long de l'axe en
// abscisse, altitude vraie en ordonnée, un point par retour LiDAR coloré par
// classe. Pas de bibliothèque : des points, des graduations, deux repères.
// Conception : docs/superpowers/specs/2026-10-01-profil-design.md.

class ProfilGraphique {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(p: ?{s: number, z: number}, q: ?{s: number, z: number}) => void} rappel
   *        appelé à chaque changement de la mesure : aucun repère, un, ou deux
   */
  constructor(canvas, rappel) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.rappel = rappel;
    this.marge = { g: 56, d: 16, h: 12, b: 34 };
    this.d = null;
    this.visibles = null;
    this.s0 = 0;
    this.s1 = 1;
    this.mesure = [];
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      this.clic(e.clientX - r.left, e.clientY - r.top);
    });
  }

  /** Les points du profil (ou `null`). Remet le tronçon à toute la bande et efface la mesure. */
  definir(d) {
    this.d = d;
    this.s0 = 0;
    this.s1 = d ? d.longueur : 1;
    this.mesure = [];
    this._ranger();
    this.rappel(null, null);
    this.rendre();
  }

  /** Les classes affichées (un `Set`), ou `null` pour toutes. */
  definirVisibles(visibles) {
    this.visibles = visibles;
    this.planifier();
  }

  /** Le tronçon affiché, en mètres le long de l'axe : recadre le graphique, ne recalcule rien. */
  definirPortee(s0, s1) {
    this.s0 = s0;
    this.s1 = s1;
    this.planifier();
  }

  effacerMesure() {
    this.mesure = [];
    this.rappel(null, null);
    this.rendre();
  }

  /** Les indices des points rangés par classe : `debut[c]` à `debut[c + 1]` dans `ordre`. */
  _ranger() {
    const d = this.d;
    this.ordre = new Uint32Array(0);
    this.debut = new Uint32Array(257);
    if (!d) return;
    const compte = new Uint32Array(257);
    for (let i = 0; i < d.n; i++) compte[d.cls[i] + 1]++;
    for (let k = 1; k < 257; k++) compte[k] += compte[k - 1];
    this.debut = compte.slice();
    const rang = compte.slice();
    this.ordre = new Uint32Array(d.n);
    for (let i = 0; i < d.n; i++) this.ordre[rang[d.cls[i]]++] = i;
  }

  /** Les classes présentes et affichées, le sol en dernier : il se lit par-dessus la végétation. */
  _classes() {
    const sortie = [];
    for (let c = 0; c < 256; c++) {
      if (this.debut[c + 1] > this.debut[c] && (!this.visibles || this.visibles.has(c))) sortie.push(c);
    }
    return sortie.sort((a, b) => (a === 2) - (b === 2));
  }

  /** Les échelles du moment : portée en abscisse, étendue des points visibles en ordonnée. */
  _echelles() {
    const r = this.c.getBoundingClientRect();
    const W = r.width, H = r.height, m = this.marge;
    const e = this.d && PROFIL.etendueZ(this.d, this.s0, this.s1, this.visibles);
    let zmin = 0, zmax = 1;
    if (e) {
      const marge = Math.max(0.5, (e.zmax - e.zmin) * 0.06);
      zmin = e.zmin - marge;
      zmax = e.zmax + marge;
    }
    const largeur = Math.max(1, W - m.g - m.d), hauteur = Math.max(1, H - m.h - m.b);
    return {
      W, H, zmin, zmax,
      x: (s) => m.g + ((s - this.s0) / (this.s1 - this.s0)) * largeur,
      y: (z) => H - m.b - ((z - zmin) / (zmax - zmin)) * hauteur,
      s: (x) => this.s0 + ((x - m.g) / largeur) * (this.s1 - this.s0),
      z: (y) => zmin + ((H - m.b - y) / hauteur) * (zmax - zmin),
    };
  }

  /** La position à l'écran (pixels CSS) d'un point (s, z). */
  px(s, z) {
    const e = this._echelles();
    return { x: e.x(s), y: e.y(z) };
  }

  /**
   * Un clic au pixel (x, y) du canevas : il s'accroche au point visible le plus
   * proche s'il en est à moins de 14 px — pour mesurer la cime, pas l'endroit
   * où la souris est tombée —, sinon il pose un repère au curseur. Le
   * troisième clic recommence.
   */
  clic(x, y) {
    const d = this.d;
    if (!d) return;
    const e = this._echelles();
    let meilleur = -1, dmin = 14 * 14;
    for (const c of this._classes()) {
      for (let k = this.debut[c]; k < this.debut[c + 1]; k++) {
        const i = this.ordre[k], s = d.s[i];
        if (s < this.s0 || s > this.s1) continue;
        const dx = e.x(s) - x, dy = e.y(d.z[i]) - y;
        const q = dx * dx + dy * dy;
        if (q < dmin) { dmin = q; meilleur = i; }
      }
    }
    const p = meilleur >= 0 ? { s: d.s[meilleur], z: d.z[meilleur] } : { s: e.s(x), z: e.z(y) };
    if (this.mesure.length === 2) this.mesure = [];
    this.mesure.push(p);
    this.rappel(this.mesure[0], this.mesure[1] || null);
    this.planifier();
  }

  /**
   * Un dessin à la prochaine image : plusieurs changements dans la même image
   * (un curseur qu'on glisse en émet des dizaines par seconde, à jusqu'à un
   * million de points chacun) n'en font qu'un. Sans `requestAnimationFrame`
   * (les tests), tout de suite.
   */
  planifier() {
    const raf = globalThis.requestAnimationFrame;
    if (typeof raf !== 'function') { this.rendre(); return; }
    if (this._enAttente) return;
    this._enAttente = true;
    raf.call(globalThis, () => { this._enAttente = false; this.rendre(); });
  }

  /** Dessine tout : fond, graduations, points par classe, repères. */
  rendre() {
    const c = this.c, ctx = this.ctx;
    const dpr = globalThis.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    // Fixer la taille d'un canevas réalloue son tampon, même à l'identique :
    // seulement si elle a changé.
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const e = this._echelles(), m = this.marge;
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    // Graduations : altitude (lignes), distance (repères en bas).
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const z of PROFIL.graduations(e.zmin, e.zmax, 6)) {
      const y = e.y(z);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.moveTo(m.g, y); ctx.lineTo(e.W - m.d, y); ctx.stroke();
      ctx.fillStyle = '#9aa4b2';
      ctx.fillText(`${z} m`, m.g - 6, y);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const s of PROFIL.graduations(this.s0, this.s1, 8)) {
      const x = e.x(s);
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.beginPath(); ctx.moveTo(x, m.h); ctx.lineTo(x, e.H - m.b); ctx.stroke();
      ctx.fillStyle = '#9aa4b2';
      ctx.fillText(`${s} m`, x, e.H - m.b + 6);
    }
    if (!this.d) return;
    // Les points, classe par classe, le sol en dernier.
    for (const cls of this._classes()) {
      ctx.fillStyle = CONFIG.rendu.couleursClasse[cls] || CONFIG.rendu.couleurClasseDefaut;
      for (let k = this.debut[cls]; k < this.debut[cls + 1]; k++) {
        const i = this.ordre[k], s = this.d.s[i];
        if (s < this.s0 || s > this.s1) continue;
        ctx.fillRect(e.x(s) - 1.25, e.y(this.d.z[i]) - 1.25, 2.5, 2.5);
      }
    }
    // Les repères de mesure : un anneau cerné de noir pour se lire sur tout fond, et le trait qui les relie.
    const pts = this.mesure.map((p) => ({ x: e.x(p.s), y: e.y(p.z) }));
    if (pts.length === 2) {
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y); ctx.stroke();
    }
    pts.forEach((p, i) => {
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI); ctx.stroke();
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(String(i + 1), p.x + 9, p.y - 7);
    });
  }
}
