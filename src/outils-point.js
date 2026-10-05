// Les outils du clic : déplacement, sélection d'un point, mesure en chaîne, et le mode Profil (dont la bande vit
// dans `profil-ui.js`). Un mode partagé par la carte et la 3D : par défaut on déplace la vue, en
// « Sélection » ou « Mesure » un clic vise un point. Sur la carte ce point se lit dans le relief calculé ;
// en 3D il vient du rayon caméra contre le nuage affiché.
//
// Ce que la fabrique ne peut pas connaître à sa création (le calcul du relief et le flux naissent plus tard
// dans le démarrage) arrive dans `liaisons`, posé ensuite par l'appelant.

function creerOutilsPoint(d) {
  const { $, vue3d, MESURE, IGN, PROJ, carte, projVue, majLien, statut, alerter, ligneDetail,
    territoire, surChangementTerritoire } = d;
  /** Ce que le démarrage pose plus tard : `carteOutils` (marqueurs), `lireVue(x, y)`, `dalleAuPoint(x, y)`. */
  const liaisons = { carteOutils: null, lireVue: null, dalleAuPoint: null };

  // Le mode Profil quitté en passant en 3D (où il n'a pas de sens), à reprendre au
  // retour sur la carte : sans cela, la bande restait dessinée sans sa fenêtre.
  let profilAReprendre = false;

  // L'outil du clic sur la carte et dans la 3D : déplacement, sélection, mesure ou profil.
  let modeOutil = 'deplacement';

  function definirModeInteraction(mode, parOnglet = false) {
    // Un choix de mode explicite annule la reprise ; seul le changement d'onglet la garde.
    if (!parOnglet) profilAReprendre = false;
    modeOutil = mode;
    if (vue3d) vue3d.mode = mode;
    $('mode-deplacement').classList.toggle('actif', mode === 'deplacement');
    $('mode-selection').classList.toggle('actif', mode === 'selection');
    $('mode-mesure').classList.toggle('actif', mode === 'mesure');
    $('mode-profil').classList.toggle('actif', mode === 'profil');
    // La petite fenêtre de choix de la bande n'existe que dans ce mode.
    $('fenetre-profil').hidden = mode !== 'profil';
    // La flèche plutôt que la main : un curseur qui dit « cliquer un point »
    // plutôt que « glisser pour déplacer ». Une classe, pas un style en ligne —
    // un style en ligne l'emporterait aussi sur `:active { cursor: grabbing }`
    // pendant un glissé effectif, ce qui casserait le déplacement en sélection
    // comme en mesure.
    $('canvas3d').classList.toggle('mode-vise', mode !== 'deplacement');
    $('vue-carte').classList.toggle('mode-vise', mode !== 'deplacement');
  }
  $('mode-deplacement').addEventListener('click', () => definirModeInteraction('deplacement'));
  $('mode-selection').addEventListener('click', () => definirModeInteraction('selection'));
  $('mode-mesure').addEventListener('click', () => definirModeInteraction('mesure'));
  $('mode-profil').addEventListener('click', () => definirModeInteraction('profil'));

  // Coordonnées du point actuellement affiché — lues par les liens « Ouvrir
  // dans » au clic, pas mémorisées dans `etat` : rien d'autre n'en a besoin.
  let selectionActuelle = null;

  /**
   * @param {number} x Lambert-93
   * @param {number} y Lambert-93
   * @param {?number} sol altitude du sol comblé, ou `null` si inconnue
   * @param {number} [hauteur] sursol au-dessus de ce sol (bâtiment, ruine…), 0 si aucun
   */
  function afficherSelection(x, y, sol, hauteur = 0) {
    const { lon, lat } = projVue().versGeo(x, y);
    // Le sommet est ce qui a été visé — un toit s'il y en a un à cet endroit,
    // le sol sinon — donc c'est lui qui porte le marqueur, pas le sol seul.
    const sommetPoint = MESURE.sommet({ sol, hauteur });
    selectionActuelle = { x, y, lon, lat, sol, hauteur, sommet: sommetPoint };
    $('selection-vide').hidden = true;
    $('detail-selection').hidden = false;
    // Quand le point a été pris : la plage de vol de la dalle qui le contient. Deux
    // dalles voisines ont des plages différentes, d'où le nom de la dalle à côté.
    // Sans date publiée : « — », jamais une date inventée.
    let acquisition = null;
    if (liaisons.dalleAuPoint) {
      const dl = liaisons.dalleAuPoint(x, y);
      const date = dl && IGN.formaterAcquisition(dl.dateDebutAcquisition, dl.dateAcquisition);
      const code = /_(\d{4}_\d{4})_/.exec(dl?.nom || '')?.[1];
      acquisition = (date || '—') + (code ? `\ndalle ${code}` : '');
    }
    $('detail-selection').innerHTML = ligneDetail('Longitude', `${lon.toFixed(6)}°`)
      + ligneDetail('Latitude', `${lat.toFixed(6)}°`)
      + ligneDetail('Altitude', sommetPoint == null ? '—' : `${sommetPoint.toFixed(1)} m`)
      + (hauteur > 0.05 ? ligneDetail('Hauteur au-dessus du sol', `+${hauteur.toFixed(2)} m`) : '')
      + (acquisition != null ? ligneDetail('Acquisition', acquisition) : '');
    $('selection-liens').hidden = false;
    $('selection-effacer').hidden = false;

    // Même point sur la carte et en 3D : passer de l'une à l'autre retrouve le marqueur au même endroit.
    vue3d?.definirPointSelectionne({ x, y, altitude: sommetPoint });
    liaisons.carteOutils?.selection([x, y]);
    majLien();   // la sélection est dans le lien
  }

  function effacerSelection() {
    selectionActuelle = null;
    $('selection-vide').hidden = false;
    $('detail-selection').hidden = true;
    $('selection-liens').hidden = true;
    $('selection-effacer').hidden = true;
    vue3d?.definirPointSelectionne(null);
    liaisons.carteOutils?.selection(null);
    majLien();
  }

  $('btn-effacer-selection').addEventListener('click', effacerSelection);

  $('lien-gmaps').addEventListener('click', () => {
    if (!selectionActuelle) return;
    const { lon, lat } = selectionActuelle;
    window.open(`https://www.google.com/maps?q=${lat},${lon}`, '_blank', 'noopener');
  });
  $('lien-osm').addEventListener('click', () => {
    if (!selectionActuelle) return;
    const { lon, lat } = selectionActuelle;
    window.open(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}`, '_blank', 'noopener');
  });

  /**
   * Recherche un point par ses coordonnées (GPS ou Lambert-93, mêmes formats
   * que la recherche de dalle — `PROJ.depuisTexte`), depuis le champ de
   * « Point sélectionné ». Même circuit qu'un clic en mode Sélection :
   * `afficherSelection` pose le marqueur et remplit le panneau dans les deux
   * vues à la fois, et les deux caméras se recentrent pour que le marqueur ne
   * tombe pas hors champ.
   */
  async function chercherPoint() {
    const texte = $('recherche-point').value.trim();
    if (!texte) return;

    const p = PROJ.depuisTexte(texte);
    if (!p) { alerter('Coordonnées non reconnues — attendu « latitude, longitude ».'); return; }
    const terr = PROJ.territoireAuPoint(p.lon, p.lat);
    if (!terr) {
      alerter('Ces coordonnées sont hors des territoires couverts par le LiDAR HD.');
      return;
    }
    if (terr.code !== territoire.lire()) surChangementTerritoire();
    territoire.ecrire(terr.code);
    const lambert = projVue().versLocal(p.lon, p.lat);
    // La carte va au point, et l'altitude se lit dans le relief — tout de suite s'il est déjà calculé là,
    // sinon dès la prochaine image.
    if (!liaisons.lireVue) { afficherSelection(lambert.x, lambert.y, null, 0); return; }
    carte.allerA(p.lon, p.lat, Math.max(carte.map.getZoom(), 17));
    const pt = await liaisons.lireVue(lambert.x, lambert.y);
    afficherSelection(lambert.x, lambert.y, pt?.altitude ?? null, pt?.hauteur ?? 0);
  }
  $('btn-recherche-point').addEventListener('click', chercherPoint);
  $('recherche-point').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); chercherPoint(); }
  });

  // La géométrie (marche du rayon contre le MNT) vit dans `terrain.js`, pure et
  // testée pour elle-même — ici, on ne fait que lui fournir les réglages du
  // moment (grille affichée, exagération, altitude de référence du nuage).
  //
  // Deux essais, dans l'ordre : le nuage réellement affiché d'abord — un point
  // trouvé là est exactement celui qu'on voit, jamais une moyenne de cellule
  // (voir CLAUDE.md, « Le pointé au clic ») — puis, s'il n'y en a aucun dans le
  // seuil (clic imprécis, ou zone du terrain sans point rendu tout près),
  // l'enveloppe du MNT en repli plutôt que de rendre la main bredouille.
  function viserPoint3D(rayon) {
    // Pas d'enveloppe de repli : le point visé est dans le nuage, ou nulle part.
    return vue3d.pointDuNuage(rayon, d.classesMasquees());
  }

  // ── Mesure en chaîne ──────────────────────────────────────────────────────────
  //
  // Comme l'outil « Mesurer une ligne » de QGIS : chaque clic en mode Mesure
  // ajoute un point à la chaîne (A, B, C…) plutôt que de se limiter à une paire.
  // Chaque segment consécutif (A→B, B→C…) porte ses trois distances dans le
  // tableau du panneau, et le pied de tableau totalise l'horizontale et la 3D —
  // jamais le dénivelé total : signé et sommé sur la chaîne, il ne dirait que le
  // dénivelé net du premier au dernier point, pas ce qu'on a réellement monté et
  // descendu, et se lirait à tort comme une troisième distance.
  //
  // Retirer le dernier point (bouton, ou Retour arrière/Suppr — repris de
  // QGIS) corrige un clic sans tout recommencer ; Effacer repart de zéro. Pas
  // de geste « terminer la chaîne » séparé : rien n'est enregistré comme objet,
  // la mesure reste une lecture à l'écran, donc rien à clore formellement — on
  // clique tant qu'on veut, et on efface quand on a fini.

  let pointsMesure = [];   // [{ x, y, sol, hauteur }, ...] Lambert-93 absolu, dans l'ordre du clic

  function afficherMesure() {
    majLien();   // la règle est dans le lien
    const versVue3D = (p) => (MESURE.sommet(p) != null ? { x: p.x, y: p.y, altitude: MESURE.sommet(p) } : null);
    vue3d?.definirMesure(pointsMesure.map(versVue3D));
    liaisons.carteOutils?.mesure(pointsMesure);

    if (!pointsMesure.length) {
      $('mesure-vide').hidden = false;
      $('detail-mesure').hidden = true;
      $('mesure-actions').hidden = true;
      return;
    }
    $('mesure-vide').hidden = true;
    $('mesure-actions').hidden = false;

    if (pointsMesure.length < 2) {
      $('detail-mesure').innerHTML = '<p class="vide">Point A posé — cliquez un second point pour mesurer.</p>';
      $('detail-mesure').hidden = false;
      return;
    }

    // Le même tableau que dans la modale du profil : un seul outil de mesure.
    $('detail-mesure').innerHTML = MESURE.tableauHtml(pointsMesure);
    $('detail-mesure').hidden = false;
  }

  function ajouterPointMesure(x, y, sol, hauteur = 0) {
    pointsMesure.push({ x, y, sol, hauteur });
    afficherMesure();
  }

  function retirerDernierPointMesure() {
    if (!pointsMesure.length) return;
    pointsMesure.pop();
    afficherMesure();
  }

  function effacerMesure() {
    pointsMesure = [];
    afficherMesure();
  }

  $('btn-mesure-effacer').addEventListener('click', effacerMesure);
  $('btn-mesure-annuler').addEventListener('click', retirerDernierPointMesure);

  // Retour arrière / Suppr retire le dernier point posé, comme dans QGIS — mais
  // seulement en mode Mesure et hors saisie, sinon la touche reprendrait son
  // rôle habituel (revenir en arrière dans un champ de texte).
  window.addEventListener('keydown', (e) => {
    if (modeOutil !== 'mesure' || !pointsMesure.length) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); retirerDernierPointMesure(); }
  });

  /** En 3D, un clic en mode Sélection ou Mesure vise un point du nuage affiché (`viserPoint3D`). */
  function brancher3D() {
    if (!vue3d) return;
    const viser = (action) => (rayon) => {
      const pt = viserPoint3D(rayon);
      if (!pt) { statut('Aucun terrain sous ce point — visez le nuage', 'erreur'); return; }
      action(pt);
    };
    vue3d.onSelectionPoint = viser((pt) => afficherSelection(pt.x, pt.y, pt.sol, pt.hauteur));
    vue3d.onPointMesure = viser((pt) => ajouterPointMesure(pt.x, pt.y, pt.sol, pt.hauteur));
  }
  brancher3D();

  /** Quitte le mode Profil en passant en 3D (où il n'a pas de sens) et le reprend au retour sur la carte. */
  function changerOnglet(quoi) {
    if (quoi !== 'carte' && modeOutil === 'profil') { definirModeInteraction('deplacement', true); profilAReprendre = true; }
    // Retour sur la carte : le mode Profil revient, avec sa fenêtre, si rien d'autre n'a été choisi entre-temps.
    if (quoi === 'carte' && profilAReprendre && modeOutil === 'deplacement') definirModeInteraction('profil', true);
    if (quoi === 'carte') profilAReprendre = false;
  }

  return {
    liaisons,
    mode: () => modeOutil,
    definirMode: definirModeInteraction,
    changerOnglet,
    selection: () => selectionActuelle,
    afficherSelection,
    pointsMesure: () => pointsMesure,
    definirMesure(pts) { pointsMesure = pts; afficherMesure(); },
    ajouterPointMesure,
  };
}
