// Le geste sur le graphique du profil. Un appui peut être :
//   - la saisie d'un point de la chaîne de mesure, pour le déplacer : à la souris (ou au stylet) tout de
//     suite, au doigt **après un appui long** (sinon on ne distingue pas « je déplace le graphique » de « je
//     déplace ce point ») ;
//   - un clic (poser un point), s'il ne bouge presque pas ;
//   - un glissé du graphique, s'il bouge.
// Une machine à états pure : le minuteur et les actions sont injectés, rien du DOM ici (voir
// `brancherGestesProfil` dans `profil-graphique.js`, qui y relie les évènements du canevas).

function creerGesteProfil({ saisir, delaiMs, minuteur, actions, clicPx = 4, tremblementPx = 8 }) {
  let g = null;   // { mode: 'attente' | 'point' | 'vue', i, x0, y0, x, y, deplace, minuteur }

  const finir = () => {
    if (g?.minuteur) minuteur.annuler(g.minuteur);
    g = null;
  };

  /** Le point `i` est saisi : à la souris dès l'appui, au doigt quand le délai est écoulé. */
  const saisirPoint = (i) => {
    g.mode = 'point';
    g.i = i;
    g.minuteur = null;
    actions.saisi(i);
  };

  function appui(x, y, type) {
    finir();   // un nouvel appui repart de zéro
    const i = saisir(x, y, type);
    g = { mode: 'vue', i: -1, x0: x, y0: y, x, y, deplace: false, minuteur: null };
    if (i < 0) return;
    if (type === 'touch') {
      g.mode = 'attente';
      g.i = i;
      g.minuteur = minuteur.demarrer(() => { if (g && g.mode === 'attente') saisirPoint(i); }, delaiMs);
    } else {
      saisirPoint(i);
    }
  }

  function deplacement(x, y) {
    if (!g) return;
    if (g.mode === 'point') { actions.deplacerPoint(g.i, x, y); return; }
    if (g.mode === 'attente') {
      // Un doigt qui glisse avant le délai : c'est le graphique qu'on déplace, pas le point.
      if (Math.hypot(x - g.x0, y - g.y0) < tremblementPx) return;
      minuteur.annuler(g.minuteur);
      g.minuteur = null;
      g.mode = 'vue';
      g.i = -1;
    }
    if (!g.deplace && Math.hypot(x - g.x0, y - g.y0) < clicPx) return;
    g.deplace = true;
    actions.deplacerVue(x - g.x, y - g.y);
    g.x = x; g.y = y;
  }

  function relache(x, y) {
    if (!g) return;
    const fin = g;
    finir();
    if (fin.mode === 'point') actions.pose(fin.i);
    // 'attente' : un doigt posé puis levé sur un point ne pose rien (il n'en ajoute pas un second à côté).
    else if (fin.mode === 'vue' && !fin.deplace) actions.clic(x, y);
  }

  return { appui, deplacement, relache, annuler: finir, enCours: () => g !== null };
}

/**
 * Le pincement à deux doigts : écarter ou rapprocher zoome autour du milieu des doigts, les déplacer ensemble
 * déplace le graphique. Incrémental : chaque mouvement part du précédent, comme la molette. Pur : les deux
 * positions arrivent en paramètres, le zoom et le déplacement sont des actions injectées.
 */
function creerPincementProfil({ surZoom, surDeplacer }) {
  let prec = null;   // { d, cx, cy } au dernier mouvement ; null hors pincement

  const mesure = (a, b) => ({ d: Math.hypot(b.x - a.x, b.y - a.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 });

  function debut(a, b) { prec = mesure(a, b); }

  function deplacement(a, b) {
    if (!prec) return;
    const m = mesure(a, b);
    // Deux doigts au même endroit : pas d'échelle à tirer, et on ne divise pas par zéro.
    if (prec.d >= 1 && m.d >= 1 && Math.abs(m.d - prec.d) > 1e-6) surZoom(m.cx, m.cy, m.d / prec.d);
    if (m.cx !== prec.cx || m.cy !== prec.cy) surDeplacer(m.cx - prec.cx, m.cy - prec.cy);
    prec = m;
  }

  return { debut, deplacement, fin() { prec = null; }, enCours: () => prec !== null };
}
