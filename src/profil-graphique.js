// Le graphique du profil : un canevas 2D, distance le long de l'axe en
// abscisse, altitude vraie en ordonnée, un point par retour LiDAR coloré par
// classe. Pas de bibliothèque : des points, des graduations, deux repères.
// Conception : docs/superpowers/specs/2026-10-01-profil-design.md.

class ProfilGraphique {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {(points: Array<{s: number, z: number}>) => void} rappel
   *        appelé à chaque changement de la chaîne de mesure, avec ses points
   *        dans l'ordre du clic (vide : aucun)
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
    this.lat = { min: -Infinity, max: Infinity };   // la tranche de largeur gardée
    this.mesure = [];
    this.zv = null;       // l'étendue verticale choisie en zoomant ; absente : ajustée aux points
    this.geste = null;    // un appui en cours : clic ou déplacement, selon qu'on a bougé
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture?.(e.pointerId);
      const p = pos(e);
      this.debutGeste(p.x, p.y);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.geste) return;
      const p = pos(e);
      this.deplacerGeste(p.x, p.y);
    });
    canvas.addEventListener('pointerup', (e) => {
      const p = pos(e);
      this.finGeste(p.x, p.y);
    });
    canvas.addEventListener('pointercancel', () => { this.geste = null; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      this.zoomer(p.x, p.y, e.deltaY < 0 ? 1.25 : 0.8);
    }, { passive: false });
  }

  /** Les points du profil (ou `null`). Remet toute la bande et efface la mesure. */
  definir(d) {
    this.d = d;
    this.s0 = 0;
    this.s1 = d ? d.longueur : 1;
    this.lat = { min: -Infinity, max: Infinity };
    this.zv = null;
    this.mesure = [];
    this._ranger();
    this.rappel([]);
    this.rendre();
  }

  /** Les classes affichées (un `Set`), ou `null` pour toutes. */
  definirVisibles(visibles) {
    this.visibles = visibles;
    this.planifier();
  }

  /**
   * La tranche de la largeur de la bande qu'on regarde, en mètres de part et
   * d'autre de l'axe (positif à gauche de A→B) : les points hors tranche ne
   * sont ni dessinés ni visés. Ne recalcule rien.
   */
  definirLateral(min, max) {
    this.lat = { min, max };
    this.planifier();
  }

  /** Rend la vue entière : toute la bande, l'étendue verticale ajustée aux points. */
  recadrer() {
    this.s0 = 0;
    this.s1 = this.d ? this.d.longueur : 1;
    this.zv = null;
    this.planifier();
  }

  /** Cale un tronçon [a, b] dans la bande en gardant sa largeur ; plus large qu'elle : la bande entière. */
  _caler(a, b) {
    const L = this.d ? this.d.longueur : 1, span = b - a;
    if (span >= L) return [0, L];
    if (a < 0) return [0, span];
    if (b > L) return [L - span, L];
    return [a, b];
  }

  /**
   * Zoom d'un facteur `f` (plus de 1 : on s'approche) autour du pixel (x, y) :
   * le point sous le curseur reste en place, comme le zoom de la 3D. Jamais
   * au-delà de la bande, ni sous 0,5 m de côté.
   */
  zoomer(x, y, f) {
    if (!this.d) return;
    const e = this._echelles();
    const sc = e.s(x), zc = e.z(y);
    const span = Math.max(0.5, (this.s1 - this.s0) / f);
    if (span >= this.d.longueur) { this.recadrer(); return; }
    const r = span / (this.s1 - this.s0);
    [this.s0, this.s1] = this._caler(sc - (sc - this.s0) * r, sc - (sc - this.s0) * r + span);
    const zspan = Math.max(0.5, (e.zmax - e.zmin) / f), rz = zspan / (e.zmax - e.zmin);
    const z0 = zc - (zc - e.zmin) * rz;
    this.zv = { z0, z1: z0 + zspan };
    this.planifier();
  }

  /** Fait glisser le contenu de (dx, dy) pixels, comme la main qui le tire ; sans sortir de la bande. */
  deplacer(dx, dy) {
    if (!this.d) return;
    const e = this._echelles(), m = this.marge;
    const largeur = Math.max(1, e.W - m.g - m.d), hauteur = Math.max(1, e.H - m.h - m.b);
    const ds = -(dx / largeur) * (this.s1 - this.s0);
    [this.s0, this.s1] = this._caler(this.s0 + ds, this.s1 + ds);
    if (dy !== 0 || this.zv) {
      const dz = (dy / hauteur) * (e.zmax - e.zmin);
      this.zv = { z0: e.zmin + dz, z1: e.zmax + dz };
    }
    this.planifier();
  }

  /** Un appui : clic ou déplacement, selon qu'on bouge de plus de 4 px avant de relâcher. */
  debutGeste(x, y) { this.geste = { x0: x, y0: y, x, y, deplace: false }; }

  deplacerGeste(x, y) {
    const g = this.geste;
    if (!g) return;
    if (!g.deplace && Math.hypot(x - g.x0, y - g.y0) < 4) return;
    g.deplace = true;
    this.deplacer(x - g.x, y - g.y);
    g.x = x; g.y = y;
  }

  finGeste(x, y) {
    const g = this.geste;
    this.geste = null;
    if (g && !g.deplace) this.clic(x, y);
  }

  /** Retire le dernier point de la chaîne de mesure. */
  retirerDernier() {
    if (!this.mesure.length) return;
    this.mesure.pop();
    this.rappel(this.mesure.slice());
    this.planifier();
  }

  effacerMesure() {
    this.mesure = [];
    this.rappel([]);
    this.rendre();
  }

  /** Le point `i` est-il à l'écran : dans le tronçon et dans la tranche de largeur ? */
  _dedans(i) {
    const d = this.d, s = d.s[i];
    if (s < this.s0 || s > this.s1) return false;
    return !d.d || (d.d[i] >= this.lat.min && d.d[i] <= this.lat.max);
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
    const e = this.d && PROFIL.etendueZ(this.d, this.s0, this.s1, this.visibles, this.lat);
    let zmin = 0, zmax = 1;
    if (this.zv) {
      zmin = this.zv.z0;
      zmax = this.zv.z1;
    } else if (e) {
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
   * où la souris est tombée —, sinon il pose un repère au curseur. Chaque
   * clic ajoute un point à la chaîne, comme l'outil de mesure de la carte.
   */
  clic(x, y) {
    const d = this.d;
    if (!d) return;
    const e = this._echelles();
    let meilleur = -1, dmin = 14 * 14;
    for (const c of this._classes()) {
      for (let k = this.debut[c]; k < this.debut[c + 1]; k++) {
        const i = this.ordre[k];
        if (!this._dedans(i)) continue;
        const dx = e.x(d.s[i]) - x, dy = e.y(d.z[i]) - y;
        const q = dx * dx + dy * dy;
        if (q < dmin) { dmin = q; meilleur = i; }
      }
    }
    const p = meilleur >= 0 ? { s: d.s[meilleur], z: d.z[meilleur] } : { s: e.s(x), z: e.z(y) };
    this.mesure.push(p);
    this.rappel(this.mesure.slice());
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
    // Zoomé, ni points ni mesure ne débordent sur les graduations.
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.g, m.h, e.W - m.g - m.d, e.H - m.h - m.b);
    ctx.clip();
    // Les points, classe par classe, le sol en dernier.
    for (const cls of this._classes()) {
      ctx.fillStyle = CONFIG.rendu.couleursClasse[cls] || CONFIG.rendu.couleurClasseDefaut;
      for (let k = this.debut[cls]; k < this.debut[cls + 1]; k++) {
        const i = this.ordre[k];
        if (!this._dedans(i)) continue;
        ctx.fillRect(e.x(this.d.s[i]) - 1.25, e.y(this.d.z[i]) - 1.25, 2.5, 2.5);
      }
    }
    // La chaîne de mesure : un trait cerné de noir pour se lire sur tout fond, et des anneaux lettrés A, B, C… comme sur la carte.
    const pts = this.mesure.map((p) => ({ x: e.x(p.s), y: e.y(p.z) }));
    if (pts.length > 1) {
      for (const [couleur, largeur] of [['#000', 4], ['#ffd24a', 2]]) {
        ctx.strokeStyle = couleur; ctx.lineWidth = largeur;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
      }
    }
    pts.forEach((p, i) => {
      for (const [couleur, largeur] of [['#000', 4], ['#ffd24a', 2]]) {
        ctx.strokeStyle = couleur; ctx.lineWidth = largeur;
        ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI); ctx.stroke();
      }
      ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(i < 26 ? String.fromCharCode(65 + i) : String(i + 1), p.x + 9, p.y - 7);
    });
    ctx.restore();
  }
}
