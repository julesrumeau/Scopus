// Le graphique du profil : un canevas 2D, distance le long de l'axe en
// abscisse, altitude vraie en ordonnée, un point par retour LiDAR coloré par
// classe. Pas de bibliothèque : des points, des graduations, deux repères.
// Conception : docs/superpowers/specs/2026-10-01-profil-design.md.

class ProfilGraphique {
  /**
   * @param {(points: Array<{s: number, z: number}>) => void} rappel appelé à chaque changement de la chaîne de mesure
   * @param {(p: ?{s: number, z: number}) => void} [rappelReference] appelé quand la référence est posée, remplacée ou effacée
   */
  constructor(canvas, rappel, rappelReference = () => {}) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.rappel = rappel;
    this.rappelReference = rappelReference;
    // L'outil décide de ce que fait un **clic** (le glisser et la molette déplacent et zooment toujours) ; la mesure par défaut.
    this.outil = 'mesure';
    this.reference = null;   // { s, z } : le 0 du graphique, ou null
    // La marge gauche porte les altitudes (« 1514.65 m » zoomé à fond) ; le double curseur du CSS (`.double-curseur`) suit la même valeur.
    this.marge = { g: 68, d: 16, h: 12, b: 34 };
    this.d = null;
    this.visibles = null;
    this.s0 = 0;
    this.s1 = 1;
    this.lat = { min: -Infinity, max: Infinity };   // la tranche de largeur gardée
    this.mesure = [];
    this.zv = null;       // l'étendue verticale choisie en zoomant ; absente : ajustée aux points
    // Échelles égales : autant de mètres par pixel en X qu'en Z (le défaut) ; l'étendue verticale se déduit de l'horizontale, `zv` n'en garde que le centre.
    this.egales = true;
    this.droit = false;   // Shift tenu : le prochain point se pose à angle droit du précédent
    this.curseur = null;  // la dernière position du curseur sur le canevas (pour l'aperçu)
    this.survole = -1;    // le point de la chaîne sous la souris, ou -1 : il grossit
    this.saisi = -1;      // le point de la chaîne qu'on déplace, ou -1
    // Le geste (profil-geste.js) : saisir un point, poser un clic, glisser le graphique.
    this.pincement = creerPincementProfil({ surZoom: (x, y, f) => this.zoomer(x, y, f), surDeplacer: (dx, dy) => this.deplacer(dx, dy) });
    this.gesteur = creerGesteProfil({
      saisir: (x, y, type) => (this.outil === 'mesure' ? this.pointMesureProche(x, y, type) : -1),
      delaiMs: CONFIG.profil.appuiLongMs,
      minuteur: { demarrer: (f, ms) => globalThis.setTimeout(f, ms), annuler: (id) => globalThis.clearTimeout(id) },
      actions: {
        saisi: (i) => this._saisir(i),
        deplacerPoint: (i, x, y) => this.deplacerPoint(i, x, y),
        pose: () => this._saisir(-1),
        clic: (x, y) => this.clic(x, y),
        deplacerVue: (dx, dy) => this.deplacer(dx, dy),
      },
    });
    brancherGestesProfil(this, canvas);
  }

  /** L'outil du clic : 'deplacement' (rien), 'reference' (pose le 0) ou 'mesure' (ajoute un point). */
  definirOutil(outil) {
    if (outil === 'deplacement' || outil === 'reference' || outil === 'mesure') this.outil = outil;
  }

  /** Retire le point de référence : les graduations redeviennent des altitudes. Sans référence, ne dit rien. */
  effacerReference() {
    if (!this.reference) return;
    this.reference = null;
    this.rappelReference(null);
    this.planifier();
  }

  /**
   * Les points du profil (ou `null`). **Garde la chaîne de mesure et la référence** : ce sont des
   * positions sur l'axe (distance, altitude), valables tant que la ligne A→B ne change pas ; c'est
   * l'appelant qui les efface (`reinitialiser`) quand elle bouge. Un recalcul de la même ligne (largeur,
   * fenêtre rouverte) les retrouve donc, et l'appelant reçoit la chaîne gardée.
   *
   * @param {{garder?: boolean}} [options] `garder` : la vue zoomée et la tranche de largeur restent
   *        (même ligne, même largeur) ; sinon la bande entière.
   */
  definir(d, { garder = false } = {}) {
    this.d = d;
    if (!(garder && d)) {
      this.s0 = 0;
      this.s1 = d ? d.longueur : 1;
      this.lat = { min: -Infinity, max: Infinity };
      this.zv = null;
      if (d && this.egales) this._cadrerEgal();
    }
    this._ranger();
    this.rappel(this.mesure.slice());
    this.rendre();
  }

  /** La ligne a bougé : chaîne, référence, tranche et zoom n'ont plus de sens. Le dit à l'appelant. */
  reinitialiser() {
    const avait = this.mesure.length > 0 || this.reference !== null;
    this.mesure = [];
    this.reference = null;
    this.lat = { min: -Infinity, max: Infinity };
    this.zv = null;
    this.s0 = 0;
    this.s1 = this.d ? this.d.longueur : 1;
    if (this.d && this.egales) this._cadrerEgal();
    if (avait) { this.rappel([]); this.rappelReference(null); }
    this.planifier();
  }

  /** Active ou coupe les échelles égales, et remet la vue entière à la nouvelle échelle. */
  definirEgales(actives) {
    this.egales = !!actives;
    this.recadrer();
  }

  /** La zone de tracé en pixels : largeur et hauteur utiles, hors marges. */
  _zone() {
    const r = this.c.getBoundingClientRect(), m = this.marge;
    return { largeur: Math.max(1, r.width - m.g - m.d), hauteur: Math.max(1, r.height - m.h - m.b) };
  }

  /** Le cadrage à échelle égale de tout le profil : abscisses, et altitudes avec la même marge qu'ajustées. */
  _cadrageEgal() {
    const d = this.d, e = PROFIL.etendueZ(d, 0, d.longueur, this.visibles, this.lat);
    const z0 = e ? e.zmin : 0, z1 = e ? e.zmax : 1;
    const marge = Math.max(0.5, (z1 - z0) * 0.06);
    const { largeur, hauteur } = this._zone();
    return PROFIL.cadrageEgal(d.longueur, z0 - marge, z1 + marge, largeur, hauteur);
  }

  _cadrerEgal() {
    const v = this._cadrageEgal();
    this.s0 = v.s0;
    this.s1 = v.s1;
    this.zv = { z0: v.z0, z1: v.z1 };
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
    if (this.d && this.egales) {
      this._cadrerEgal();
    } else {
      this.s0 = 0;
      this.s1 = this.d ? this.d.longueur : 1;
      this.zv = null;
    }
    this.planifier();
  }

  /** Cale un tronçon [a, b] dans la bande en gardant sa largeur ; plus large qu'elle : la bande entière. */
  _caler(a, b) {
    const L = this.d ? this.d.longueur : 1, span = b - a;
    // À échelle égale la fenêtre peut être plus large que la bande (du vide de chaque côté, quand
    // la hauteur commande) : elle glisse alors tant que la bande reste dedans.
    if (this.egales) {
      const lo = Math.min(0, L - span), hi = Math.max(0, L - span);
      const s0 = Math.min(hi, Math.max(lo, a));
      return [s0, s0 + span];
    }
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
    const v = this.egales ? this._cadrageEgal() : null;
    // Pas plus loin que la vue entière : la bande, ou à échelle égale le cadrage qui montre tout.
    if (span >= (v ? v.s1 - v.s0 : this.d.longueur)) { this.recadrer(); return; }
    const r = span / (this.s1 - this.s0);
    [this.s0, this.s1] = this._caler(sc - (sc - this.s0) * r, sc - (sc - this.s0) * r + span);
    // Échelle égale : la portée verticale suit la même raison que l'horizontale.
    const zspan = this.egales ? (e.zmax - e.zmin) * r : Math.max(0.5, (e.zmax - e.zmin) / f);
    const rz = zspan / (e.zmax - e.zmin);
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

  /** Un appui (`type` : 'mouse', 'touch' ou 'pen') : saisie d'un point, clic ou glissé (voir `profil-geste.js`). */
  debutGeste(x, y, type = 'mouse') { this.gesteur.appui(x, y, type); }

  deplacerGeste(x, y) { this.gesteur.deplacement(x, y); }

  /** Un second doigt arrive : le geste du premier (saisie d'un point, clic, glissé) est abandonné. */
  annulerGeste() {
    this.gesteur.annuler();
    this._saisir(-1);
  }

  finGeste(x, y) { this.gesteur.relache(x, y); }

  /** Retire le dernier point de la chaîne de mesure. */
  retirerDernier() {
    if (!this.mesure.length) return;
    this.mesure.pop();
    this.rappel(this.mesure.slice());
    this.planifier();
  }

  /** Retire le point `i` de la chaîne de mesure (la croix du tableau). Un indice hors chaîne ne fait rien. */
  retirerPoint(i) {
    if (!(i >= 0 && i < this.mesure.length)) return;
    this.mesure.splice(i, 1);
    this.survole = this.saisi = -1;
    this.rappel(this.mesure.slice());
    this.planifier();
  }

  /** Le point `i` suit le curseur : accroché au point visible le plus proche, comme à la pose. */
  deplacerPoint(i, x, y) {
    if (!(i >= 0 && i < this.mesure.length) || !this.d) return;
    this.mesure[i] = this._accrocher(x, y);
    this.rappel(this.mesure.slice());
    this.planifier();
  }

  /** L'indice du point de la chaîne le plus proche du pixel (x, y), ou -1 : voir `pointMesureProcheProfil`. */
  pointMesureProche(x, y, type = 'mouse') { return pointMesureProcheProfil(this, x, y, type); }

  /** Shift est tenu (ou relâché) : le prochain point se pose à angle droit du précédent (mesure seulement). */
  definirDroit(actif) {
    if (this.droit === !!actif) return;
    this.droit = !!actif;
    this.planifier();
  }

  /** Le curseur est en (x, y) : retenu pour l'aperçu de la ligne à angle droit. */
  suivre(x, y) {
    this.curseur = { x, y };
    if (this.droit) this.planifier();
  }

  /** Où tomberait un point posé en `c` avec Shift : `{ de, vers, point }` (pixels et point du profil), ou `null`. */
  _surAxe(c) {
    const dernier = this.mesure.at(-1);
    if (!this.droit || !dernier || !c || this.outil !== 'mesure') return null;
    const de = this.px(dernier.s, dernier.z), vers = MESURE.surAxe(de, c), e = this._echelles();
    return { de, vers, point: { s: vers.axe === 'v' ? dernier.s : e.s(vers.x), z: vers.axe === 'h' ? dernier.z : e.z(vers.y) } };
  }

  /** La ligne pointillée du point précédent à l'endroit où le point va tomber : `{ de, vers }`, ou `null`. */
  apercuDroit() {
    const a = this._surAxe(this.curseur);
    return a && { de: a.de, vers: a.vers };
  }

  /** Le point `i` est celui qu'on déplace (il grossit), ou -1 : plus aucun. */
  _saisir(i) {
    this.saisi = i;
    this.planifier();
  }

  /** La souris survole le point `i` de la chaîne : il grossit et le curseur dit qu'on peut le saisir. */
  survoler(x, y) {
    const i = this.outil === 'mesure' ? this.pointMesureProche(x, y, 'mouse') : -1;
    if (i === this.survole) return;
    this.survole = i;
    this.c.style.cursor = i >= 0 ? 'grab' : '';
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
    ({ ordre: this.ordre, debut: this.debut } = rangerParClasse(this.d));
  }

  /** Les classes présentes et affichées, le sol en dernier : il se lit par-dessus la végétation. */
  _classes() {
    const sortie = [];
    for (let c = 0; c < 256; c++) {
      if (this.debut[c + 1] > this.debut[c] && (!this.visibles || this.visibles.has(c))) sortie.push(c);
    }
    return sortie.sort((a, b) => (a === 2) - (b === 2));
  }

  /** Les échelles du moment : voir `echellesProfil`. */
  _echelles() { return echellesProfil(this); }

  /** La position à l'écran (pixels CSS) d'un point (s, z). */
  px(s, z) {
    const e = this._echelles();
    return { x: e.x(s), y: e.y(z) };
  }

  /** Le point (s, z) où tombe le pixel : voir `accrocherProfil`. */
  _accrocher(x, y) { return accrocherProfil(this, x, y); }

  /**
   * Un clic au pixel (x, y) du canevas : il s'accroche au point visible le plus
   * proche s'il en est à moins de 14 px — pour mesurer la cime, pas l'endroit
   * où la souris est tombée —, sinon il pose un repère au curseur. Chaque
   * clic ajoute un point à la chaîne, comme l'outil de mesure de la carte.
   */
  clic(x, y) {
    if (!this.d || this.outil === 'deplacement') return;
    // Shift tenu : à angle droit du point précédent, sans accrochage au nuage (la ligne resterait de travers).
    const p = this._surAxe({ x, y })?.point ?? this._accrocher(x, y);
    if (this.outil === 'reference') {
      // Un seul point à la fois : le clic suivant remplace le précédent.
      this.reference = p;
      this.rappelReference({ s: p.s, z: p.z });
      this.planifier();
      return;
    }
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
    dessinerGraduationsProfil(ctx, e, m, this.s0, this.s1, this.reference);
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
    if (this.reference) dessinerReferenceProfil(ctx, e, m, this.reference);
    const apercu = this.apercuDroit();
    if (apercu) dessinerApercuDroitProfil(ctx, apercu);
    dessinerChaineProfil(ctx, this.mesure.map((p) => ({ x: e.x(p.s), y: e.y(p.z) })), this.saisi >= 0 ? this.saisi : this.survole, this.saisi >= 0);
    ctx.restore();
  }
}

/** Les indices des points rangés par classe : `debut[c]` à `debut[c + 1]` dans `ordre` (rien sans données). */
function rangerParClasse(d) {
  if (!d) return { ordre: new Uint32Array(0), debut: new Uint32Array(257) };
  const compte = new Uint32Array(257);
  for (let i = 0; i < d.n; i++) compte[d.cls[i] + 1]++;
  for (let k = 1; k < 257; k++) compte[k] += compte[k - 1];
  const debut = compte.slice();
  const rang = compte.slice();
  const ordre = new Uint32Array(d.n);
  for (let i = 0; i < d.n; i++) ordre[rang[d.cls[i]]++] = i;
  return { ordre, debut };
}

/** Les échelles du moment : portée en abscisse, étendue des points visibles en ordonnée (`g` : le graphique). */
function echellesProfil(g) {
  const r = g.c.getBoundingClientRect();
  const W = r.width, H = r.height, m = g.marge;
  const e = g.d && PROFIL.etendueZ(g.d, g.s0, g.s1, g.visibles, g.lat);
  let zmin = 0, zmax = 1;
  const largeur = Math.max(1, W - m.g - m.d), hauteur = Math.max(1, H - m.h - m.b);
  if (g.egales) {
    // Déduite de l'horizontale : seul le centre vient de `zv` ou des points.
    const zc = g.zv ? (g.zv.z0 + g.zv.z1) / 2 : e ? (e.zmin + e.zmax) / 2 : 0.5;
    ({ zmin, zmax } = PROFIL.etendueEgale(g.s0, g.s1, largeur, hauteur, zc));
  } else if (g.zv) {
    zmin = g.zv.z0;
    zmax = g.zv.z1;
  } else if (e) {
    const marge = Math.max(0.5, (e.zmax - e.zmin) * 0.06);
    zmin = e.zmin - marge;
    zmax = e.zmax + marge;
  }
  return {
    W, H, zmin, zmax,
    x: (s) => m.g + ((s - g.s0) / (g.s1 - g.s0)) * largeur,
    y: (z) => H - m.b - ((z - zmin) / (zmax - zmin)) * hauteur,
    s: (x) => g.s0 + ((x - m.g) / largeur) * (g.s1 - g.s0),
    z: (y) => zmin + ((H - m.b - y) / hauteur) * (zmax - zmin),
  };
}

/** Les graduations : altitudes (lignes) et distances (repères en bas), lues depuis la référence quand il y en a une. */
function dessinerGraduationsProfil(ctx, e, m, s0, s1, reference) {
  ctx.font = '11px system-ui, sans-serif';
  ctx.lineWidth = 1;
  // Graduations : altitude (lignes), distance (repères en bas).
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  // Autant de graduations que la place en porte : trop serrées, elles
  // s'écrivent les unes sur les autres (« 0 m5 m10 m15 m… » sur un téléphone).
  const nbX = Math.max(2, Math.floor((e.W - m.g - m.d) / 90)), nbZ = Math.max(2, Math.floor((e.H - m.h - m.b) / 48));
  // Avec une référence, les graduations se lisent depuis elle (0 en son point, négatif
  // en bas et à gauche) ; sans, ce sont des altitudes.
  const sr = reference ? reference.s : 0, zr = reference ? reference.z : 0;
  for (const v of PROFIL.graduations(e.zmin - zr, e.zmax - zr, nbZ)) {
    const z = v + zr;
    const y = e.y(z);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.moveTo(m.g, y); ctx.lineTo(e.W - m.d, y); ctx.stroke();
    ctx.fillStyle = '#9aa4b2';
    ctx.fillText(`${v} m`, m.g - 6, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const v of PROFIL.graduations(s0 - sr, s1 - sr, nbX)) {
    const x = e.x(v + sr);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.moveTo(x, m.h); ctx.lineTo(x, e.H - m.b); ctx.stroke();
    ctx.fillStyle = '#9aa4b2';
    ctx.fillText(`${v} m`, x, e.H - m.b + 6);
  }
}

// Le point de référence : deux traits fins qui le traversent (les axes du 0), et une croix
// cernée de noir marquée « 0 », d'une autre couleur que les points de mesure.
function dessinerReferenceProfil(ctx, e, m, ref) {
  const rx = e.x(ref.s), ry = e.y(ref.z);
  ctx.strokeStyle = 'rgba(74,208,255,0.55)'; ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(m.g, ry); ctx.lineTo(e.W - m.d, ry); ctx.moveTo(rx, m.h); ctx.lineTo(rx, e.H - m.b); ctx.stroke();
  ctx.setLineDash([]);
  for (const [couleur, largeur] of [['#000', 4], ['#4ad0ff', 2]]) {
    ctx.strokeStyle = couleur; ctx.lineWidth = largeur;
    ctx.beginPath(); ctx.moveTo(rx - 8, ry); ctx.lineTo(rx + 8, ry); ctx.moveTo(rx, ry - 8); ctx.lineTo(rx, ry + 8); ctx.stroke();
  }
  ctx.fillStyle = '#4ad0ff'; ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('0', rx + 10, ry + 6);
}

/**
 * La chaîne de mesure : un trait cerné de noir pour se lire sur tout fond, et des anneaux lettrés A, B, C… comme
 * sur la carte. Le point `actif` (survolé, ou saisi pour être déplacé) grossit ; saisi, il grossit davantage
 * et se remplit, pour qu'on sache qu'il suit le doigt.
 */
function dessinerChaineProfil(ctx, pts, actif, saisi) {
  if (pts.length > 1) {
    for (const [couleur, largeur] of [['#000', 4], ['#ffd24a', 2]]) {
      ctx.strokeStyle = couleur; ctx.lineWidth = largeur;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
  }
  pts.forEach((p, i) => {
    const rayon = i === actif ? (saisi ? 12 : 9) : 6;
    for (const [couleur, largeur] of [['#000', 4], ['#ffd24a', 2]]) {
      ctx.strokeStyle = couleur; ctx.lineWidth = largeur;
      ctx.beginPath(); ctx.arc(p.x, p.y, rayon, 0, 2 * Math.PI); ctx.stroke();
    }
    if (i === actif && saisi) { ctx.fillStyle = 'rgba(255,210,74,0.35)'; ctx.beginPath(); ctx.arc(p.x, p.y, rayon, 0, 2 * Math.PI); ctx.fill(); }
    ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(i < 26 ? String.fromCharCode(65 + i) : String(i + 1), p.x + rayon + 3, p.y - rayon - 1);
  });
}

/** Le point (s, z) où tombe le pixel (x, y) : celui du profil le plus proche s'il est à moins de 14 px, sinon la position du curseur. */
function accrocherProfil(g, x, y) {
  const d = g.d;
  const e = g._echelles();
  let meilleur = -1, dmin = 14 * 14;
  for (const c of g._classes()) {
    for (let k = g.debut[c]; k < g.debut[c + 1]; k++) {
      const i = g.ordre[k];
      if (!g._dedans(i)) continue;
      const dx = e.x(d.s[i]) - x, dy = e.y(d.z[i]) - y;
      const q = dx * dx + dy * dy;
      if (q < dmin) { dmin = q; meilleur = i; }
    }
  }
  return meilleur >= 0 ? { s: d.s[meilleur], z: d.z[meilleur] } : { s: e.s(x), z: e.z(y) };
}

/** L'indice du point de la chaîne le plus proche du pixel (x, y), ou -1 : 10 px à la souris, 24 px au doigt. */
function pointMesureProcheProfil(g, x, y, type) {
  const rayon = type === 'touch' ? CONFIG.profil.saisieTactilePx : CONFIG.profil.saisiePx;
  let meilleur = -1, dmin = rayon * rayon;
  g.mesure.forEach((p, i) => {
    const q = g.px(p.s, p.z);
    const dd = (q.x - x) ** 2 + (q.y - y) ** 2;
    if (dd <= dmin) { dmin = dd; meilleur = i; }
  });
  return meilleur;
}

/** L'aperçu de Shift + clic : un trait pointillé du point précédent à l'endroit où le point va tomber, et un petit anneau. */
function dessinerApercuDroitProfil(ctx, { de, vers }) {
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(255,210,74,0.9)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(de.x, de.y); ctx.lineTo(vers.x, vers.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(vers.x, vers.y, 4, 0, 2 * Math.PI); ctx.stroke();
  ctx.restore();
}

/** Les gestes sur le canevas : appui, déplacement, relâchement (clic ou glisser selon qu'on a bougé), molette. */
function brancherGestesProfil(g, canvas) {
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // Les doigts posés (pointerType 'touch') : à deux, c'est un pincement ; un seul, le geste ordinaire.
  const doigts = new Map();
  const deuxDoigts = () => [...doigts.values()];
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    const p = pos(e);
    if (e.pointerType === 'touch') {
      doigts.set(e.pointerId, p);
      if (doigts.size === 2) { g.annulerGeste(); g.pincement.debut(...deuxDoigts()); return; }
      if (doigts.size > 2) return;
    }
    g.debutGeste(p.x, p.y, e.pointerType || 'mouse');
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pos(e);
    g.suivre(p.x, p.y);
    g.definirDroit(e.shiftKey);
    if (doigts.has(e.pointerId)) doigts.set(e.pointerId, p);
    if (g.pincement.enCours()) { if (doigts.size === 2) g.pincement.deplacement(...deuxDoigts()); return; }
    if (g.gesteur.enCours()) g.deplacerGeste(p.x, p.y);
    else if (e.pointerType === 'mouse') g.survoler(p.x, p.y);
  });
  const lever = (e) => {
    const p = pos(e);
    g.droit = e.shiftKey;   // l'état au moment du clic, pas celui du dernier mouvement
    const pince = g.pincement.enCours();
    doigts.delete(e.pointerId);
    // Le doigt resté après un pincement ne doit ni poser un point ni déplacer : il n'a plus de geste.
    if (pince) { if (doigts.size < 2) g.pincement.fin(); return; }
    g.finGeste(p.x, p.y);
  };
  canvas.addEventListener('pointerup', lever);
  canvas.addEventListener('pointercancel', (e) => {
    doigts.delete(e.pointerId);
    g.pincement.fin();
    g.annulerGeste();
  });
  canvas.addEventListener('pointerleave', () => { if (!g.gesteur.enCours()) g.survoler(-1e6, -1e6); });
  // Un appui long (la saisie d'un point au doigt) ne doit pas ouvrir le menu du navigateur.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // Shift tenu sans bouger la souris : l'aperçu apparaît (seulement si le graphique est à l'écran).
  const majShift = (e) => { if (e.key === 'Shift' && canvas.offsetParent !== null) g.definirDroit(e.type === 'keydown'); };
  globalThis.addEventListener?.('keydown', majShift);   // absent dans les tests
  globalThis.addEventListener?.('keyup', majShift);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pos(e);
    g.zoomer(p.x, p.y, e.deltaY < 0 ? 1.25 : 0.8);
  }, { passive: false });
}
