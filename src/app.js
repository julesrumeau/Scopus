// Assemblage : relie la carte, le chargeur COPC, la vue 3D et la détection.
//
// Enveloppé dans une IIFE : sans modules ES, tout ce qui est déclaré au premier
// niveau d'un script devient global. Rien ici n'a vocation à sortir.

(() => {
'use strict';

const $ = (id) => document.getElementById(id);

const etat = {
  // `dalle` est celle qu'on vient de désigner sur la carte ; `dalleChargee`
  // celle dont le nuage et les grilles sont en mémoire. Les confondre faisait
  // qu'après avoir cliqué une dalle voisine, le rapprochement BD TOPO et les
  // noms de fichiers exportés désignaient une emprise qu'on n'avait pas
  // analysée.
  dalle: null,
  dalleChargee: null,
  entete: null,
  hierarchie: null,
  couts: [],
  niveau: 0,
  abandonIndex: null,
  promesseIndex: null,
  // Vue d'un lien ouvert (`LIEN.lire`), en attente du chargement de sa dalle
  // pour s'appliquer en 2D et en 3D — voir `appliquerVueDuLien`.
  vueDuLien: null,
  // Un lien du profil est en train de se remettre (carte cadrée, points chargés, modale rouverte) :
  // ne pas réécrire le fragment d'ici là, il perdrait ce qu'il porte encore.
  restaurationPartage: false,
  nuage: null,
  grille: null,
  resultat: null,
  // Statistiques de la voie par la forme. Les candidats qu'elle trouve, eux,
  // rejoignent `resultat.candidats` : une seule liste, une seule sélection, un
  // seul export — seul le champ `voie` dit d'où vient chacun.
  resultatFormes: null,
  sentiers: null,
  reliefGrille: null,
  selection: null,
  abandon: null,
  // Classes de sol qui ont servi à bâtir `grille` — un instantané, pas la
  // sélection courante des cases à cocher, qui peut avoir bougé depuis. Sert
  // uniquement à savoir si « Mettre à jour » (§ Classes du sol) a quelque
  // chose à faire.
  classesSolChargees: null,
};

/**
 * Détection automatique masquée, structures **et** sentiers.
 *
 * Décision du 18 août 2026, prise en regardant l'outil s'en servir : sur une
 * couche d'ouverture ou de Sky-View Factor, un mur ruiné, une terrasse ou un
 * chemin creux **se voient à l'œil en une seconde**. C'est d'ailleurs ainsi que
 * la prospection LiDAR travaille depuis toujours — on lit des images ombrées, on
 * ne s'en remet pas à un détecteur. Les deux chaînes automatiques, elles,
 * demandent des seuils justes pour rendre le même service en moins bien, et
 * aucune des deux n'a jamais été confrontée à une structure réelle connue.
 *
 * Ce qui a emporté la décision : une chaîne livrée qui promet et rend zéro fait
 * conclure que l'**outil** est cassé, pas cette fonction-là. Mieux vaut ne rien
 * promettre. La détection par la forme venait précisément de rendre zéro en
 * silence sur une dalle réelle, faute d'un réglage lu au mauvais endroit.
 *
 * **Rien n'est supprimé** : `detection.js`, `lignes.js` et `sentiers.js`
 * restent, avec leurs 71 tests. Remettre `false` ici rend l'interface entière.
 * Ce qui manque pour ça n'est pas du code, c'est un contrôle positif — une ruine
 * dont on connaisse les coordonnées.
 */
const ANALYSE_MASQUEE = true;

/**
 * Remasqué le 20 août 2026 après un premier vrai usage sur plusieurs dalles.
 *
 * Le retour a corrigé un bogue réel (des tracés en pelote, voir #2 du TODO,
 * `CONFIG.sentiers.compaciteMax`) mais n'a pas réglé la question de fond :
 * même sans boucle, une bonne part de ce qui reste suit vraisemblablement du
 * ravinement naturel plutôt que de vrais chemins — signature identique, et
 * rien à part une coordonnée de sentier connu ne permet de trancher. Démasquer
 * sans ce contrôle promettait plus que la chaîne ne rend, exactement l'écueil
 * qui avait fait masquer les structures. Le drapeau se remet à `false` en une
 * ligne dès qu'un chemin connu existe pour recalibrer.
 */
const SENTIERS_MASQUES = true;

// ── Retours à l'utilisateur ─────────────────────────────────────────────────

let minuteurAlerte = null;

function statut(texte, genre = '') {
  const e = $('etat');
  e.textContent = texte;
  e.className = `etat ${genre}`;
}

function alerter(message) {
  const a = $('alerte');
  a.textContent = message;
  a.hidden = false;
  clearTimeout(minuteurAlerte);
  // La durée suit la longueur : un message qui dit quoi faire fait deux lignes,
  // et sept secondes ne suffisent pas à le lire. Il reste de toute façon dans la
  // barre d'état, mais tronqué.
  const duree = Math.min(20000, Math.max(7000, message.length * 90));
  minuteurAlerte = setTimeout(() => { a.hidden = true; }, duree);
  statut(message, 'erreur');
}

/**
 * Alerte sur une panne réseau, traduite en conduite à tenir.
 *
 * « HTTP 429 sur https://data.geopf.fr/… » est exact et inutile : il ne dit pas
 * si c'est réparable, ni ce qu'il faut faire. `RESEAU.expliquer` s'en charge ;
 * le contexte dit seulement ce qui a échoué.
 */
function alerterPanne(contexte, e) {
  alerter(`${contexte} : ${RESEAU.expliquer(e)}`);
}

const octets = (o) => o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${(o / 1024).toFixed(0)} Ko`;
const milliers = (n) => n.toLocaleString('fr-FR');

/**
 * Appareil vraisemblablement portatif.
 *
 * Heuristique grossière et assumée — pointage tactile et écran étroit — parce
 * qu'il n'y a rien de mieux : `userAgentData.mobile` n'existe pas partout, et
 * l'agent utilisateur ment. Elle ne sert qu'à **avertir**, jamais à interdire :
 * une tablette bien dotée charge une dalle sans peine, et se tromper ne coûte
 * qu'une phrase de trop.
 */
const surMobile = () => (navigator.maxTouchPoints || 0) > 0
  && Math.min(window.screen?.width || 9999, window.innerWidth) < 820;

// ── Vue 3D ──────────────────────────────────────────────────────────────────

/**
 * Sans WebGL2, l'onglet 3D disparaît — et **le reste continue de marcher**.
 *
 * C'est le seul morceau de Scopus qui en dépende : la carte est en Leaflet, la
 * vue 2D est un canevas ordinaire, les grilles et le relief sont du calcul pur.
 * Perdre le nuage de points ne doit donc pas perdre l'outil. Ce n'était pas le
 * cas : `ouvrirDalle` appelait `vue3d.definirNuage` sans précaution, et le
 * chargement entier échouait au milieu — l'utilisateur se retrouvait avec une
 * interface à moitié morte et un message qui parlait de contexte WebGL.
 */
let vue3d = null;
try {
  vue3d = new Vue3D($('canvas3d'), $('boussole'));
  vue3d.onVue = () => majLien();
  // Une fois le geste fini, en diagnostic : ce qu'il a pu dessiner.
  vue3d.onFinGeste = () => { if (DIAGNOSTIC) majHUD(); };
  vue3d.demarrer();
} catch (e) {
  $('onglet-3d').disabled = true;
  $('onglet-3d').title = 'Cet appareil ou ce navigateur ne fournit pas WebGL2';
  $('sans-webgl').hidden = false;
  $('sans-webgl-detail').textContent = e.message;
  statut('Nuage 3D indisponible — la carte et la vue 2D fonctionnent', 'erreur');
}

// ── Vue 2D ──────────────────────────────────────────────────────────────────

/**
 * Ce que le relief dit sous le curseur, en une ligne : position, sol, hauteur
 * de ce qui s'y dresse, et la valeur de la couche nommée. La couche est celle
 * du côté survolé : sous le curseur il n'y a qu'une image, et dire laquelle
 * évite de lire une valeur pour une autre. Commun à l'onglet 2D et à la carte.
 */
function texteCurseur(p, nomCouche) {
  return `x ${p.x.toFixed(0)} · y ${p.y.toFixed(0)}`
    + (p.altitude == null ? ' · sol inconnu' : ` · sol ${p.altitude.toFixed(1)} m`)
    + (p.hauteur > 0.05 ? ` · <b>+${p.hauteur.toFixed(2)} m</b>` : '')
    + (nomCouche != null && p.valeur != null && Number.isFinite(p.valeur)
      ? ` · ${echapper(nomCouche)} <b>${p.valeur.toFixed(2)}</b>` : '');
}

const vue2d = new Vue2D($('canvas-2d'), {
  surCurseur: (p) => {
    $('hud-2d').innerHTML = p ? texteCurseur(p, p.couche || '') : '';
  },
  // Cliquer une boîte sélectionne la détection dans toutes les vues à la fois.
  surClic: (id) => {
    const c = (etat.resultat?.candidats || []).find((x) => x.id === id);
    if (c) selectionner_(c);
  },
  // Mode sélection : `p` est déjà résolu par `lire()`, la même valeur que le
  // survol affiche dans le HUD.
  surSelectionPoint: (p) => { if (p) afficherSelection(p.x, p.y, p.altitude, p.hauteur); },
  surVue: () => majLien(),
});
vue2d.demarrer();

// ── Sélection d'un point (#4) ────────────────────────────────────────────────
//
// Un mode partagé par les onglets 2D et 3D, activé par la sous-barre sous les
// onglets : par défaut on déplace la vue, en « Sélection » un clic vise un
// point plutôt que la vue elle-même. En 3D, ce point ne vient pas du plan
// horizontal qui sert au déplacement de la caméra (`_pointSousCurseur`, une
// approximation délibérée) mais d'une marche du rayon caméra contre le MNT
// affiché — `etat.reliefGrille`, déjà calculé pour l'onglet 2D.

// Le mode Profil quitté en passant en 3D (où il n'a pas de sens), à reprendre au
// retour sur la carte : sans cela, la bande restait dessinée sans sa fenêtre.
let profilAReprendre = false;

function definirModeInteraction(mode, parOnglet = false) {
  // Un choix de mode explicite annule la reprise ; seul le changement d'onglet la garde.
  if (!parOnglet) profilAReprendre = false;
  vue2d.mode = mode;
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
  $('canvas-2d').classList.toggle('mode-vise', mode !== 'deplacement');
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

// Mode vue (relief sur la carte) : ce qui dessine sélection et mesure sur la
// carte, et ce qui lit un point dans le relief calculé. Posés par le bloc du
// mode vue, plus bas ; nuls dans l'ancien parcours.
let carteOutils = null;
let lireVue = null;
// Mode vue : la dalle (avec sa date d'acquisition) qui contient un point local, d'après
// celles que le flux a trouvées. Nul dans l'ancien parcours.
let dalleAuPointVue = null;
// Mode vue : ce qui construit le nuage 3D en passant sur l'onglet, et ce qui
// remplit l'attribut de couleur (hauteur, relief) depuis le worker.
let surPassage3D = null;

// Le territoire de la vue normale (PROJ.TERRITOIRES) : ses coordonnées locales
// — Lambert-93 en métropole, UTM outre-mer — sont celles des dalles, des
// blocs, de la grille du relief et des points lus. Suivi du centre de la carte
// (majVueFlux) ; l'ancien parcours par dalle reste en métropole.
let territoireVue = 'FXX';
// Appelé quand le territoire change par une recherche de lieu (chercherPoint) :
// la bande du profil, posée dans l'autre projection, n'aurait plus de sens.
let surChangementTerritoire = null;
const projVue = () => PROJ.projectionDe(territoireVue);
let surPassageCarte = null;
let majAttributVue = null;

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
  if (dalleAuPointVue) {
    const dl = dalleAuPointVue(x, y);
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

  // Même point dans les deux vues : sélectionner en 2D puis passer en 3D (ou
  // l'inverse) doit retrouver le marqueur au même endroit, pas le perdre.
  vue2d.definirPointSelectionne([x, y]);
  vue3d?.definirPointSelectionne({ x, y, altitude: sommetPoint });
  carteOutils?.selection([x, y]);
  majLien();   // la sélection est dans le lien
}

function effacerSelection() {
  selectionActuelle = null;
  $('selection-vide').hidden = false;
  $('detail-selection').hidden = true;
  $('selection-liens').hidden = true;
  $('selection-effacer').hidden = true;
  vue2d.definirPointSelectionne(null);
  vue3d?.definirPointSelectionne(null);
  carteOutils?.selection(null);
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
  // En vue normale, tout territoire couvert ; l'ancien parcours par dalle
  // reste en Lambert-93, donc en métropole.
  const terr = PROJ.territoireAuPoint(p.lon, p.lat);
  if (!terr || (!MODE_VUE && terr.code !== 'FXX')) {
    alerter(MODE_VUE ? 'Ces coordonnées sont hors des territoires couverts par le LiDAR HD.' : 'Ces coordonnées sont hors de France métropolitaine.');
    return;
  }
  if (MODE_VUE) {
    if (terr.code !== territoireVue) surChangementTerritoire?.();
    territoireVue = terr.code;
  }
  const lambert = projVue().versLocal(p.lon, p.lat);
  // Mode vue : la carte va au point, et l'altitude se lit dans le relief —
  // tout de suite s'il est déjà calculé là, sinon dès la prochaine image.
  if (MODE_VUE && lireVue) {
    carte.allerA(p.lon, p.lat, Math.max(carte.map.getZoom(), 17));
    const pt = await lireVue(lambert.x, lambert.y);
    afficherSelection(lambert.x, lambert.y, pt?.altitude ?? null, pt?.hauteur ?? 0);
    return;
  }
  const t = etat.reliefGrille;
  let altitude = null, hauteur = 0;
  if (t) {
    const cx = Math.floor((lambert.x - t.emprise.xmin) / t.pas);
    const cy = Math.floor((lambert.y - t.emprise.ymin) / t.pas);
    if (cx < 0 || cx >= t.W || cy < 0 || cy >= t.H) {
      alerter('Ce point est en dehors de la dalle chargée.');
      return;
    }
    const i = cy * t.W + cx;
    if (t.valide[i]) { altitude = t.mnt[i] + t.origine[2]; hauteur = t.hauteur[i]; }
  }

  afficherSelection(lambert.x, lambert.y, altitude, hauteur);
  vue2d.viser(lambert.x, lambert.y);
  if (altitude != null) vue3d?.centrerSur(lambert.x, lambert.y, altitude + hauteur);
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
  // Sans grille de dalle (vue normale), pas d'enveloppe de repli : le point
  // visé est dans le nuage, ou nulle part.
  return vue3d.pointDuNuage(rayon, classesMasquees)
    || (etat.reliefGrille ? TERRAIN.pointDuTerrain(rayon, etat.reliefGrille, CONFIG.rendu.exagerationZ, vue3d.zmin, classesMasquees) : null);
}

if (vue3d) {
  vue3d.onSelectionPoint = (rayon) => {
    const pt = viserPoint3D(rayon);
    if (!pt) { statut('Aucun terrain sous ce point — visez le nuage', 'erreur'); return; }
    afficherSelection(pt.x, pt.y, pt.sol, pt.hauteur);
  };
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
  vue2d.definirMesure(pointsMesure.map((p) => [p.x, p.y]));
  vue3d?.definirMesure(pointsMesure.map(versVue3D));
  carteOutils?.mesure(pointsMesure);

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
  if (vue2d.mode !== 'mesure' || !pointsMesure.length) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); retirerDernierPointMesure(); }
});

vue2d.cb.surPointMesure = (p) => { if (p) ajouterPointMesure(p.x, p.y, p.altitude, p.hauteur); };
if (vue3d) {
  vue3d.onPointMesure = (rayon) => {
    const pt = viserPoint3D(rayon);
    if (!pt) { statut('Aucun terrain sous ce point — visez le nuage', 'erreur'); return; }
    ajouterPointMesure(pt.x, pt.y, pt.sol, pt.hauteur);
  };
}

// ── Lien partageable ────────────────────────────────────────────────────────
//
// Le lien porte la **vue**, au format d'osm.org (`#map=zoom/lat/lon`) complété
// comme MapLibre en 3D (`/orientation/inclinaison`) — voir `lien.js`. Il suit
// l'onglet affiché : la carte, le centre et l'échelle de la 2D, ou le point
// visé et les angles de la caméra 3D. Pas les seuils ni les couches : ouvrir un
// lien cadre la carte et sélectionne la dalle sous le centre, exactement comme
// un clic, et laisse le choix de charger le nuage à qui l'ouvre.

/** La vue de l'onglet affiché, dans les termes du lien. `null` si rien à dire. */
function vueCourante() {
  const onglet = $('panneau').dataset.vue;
  if (onglet === '2d' && vue2d.grille) {
    const v = vue2d.vue();
    const { lon, lat } = projVue().versGeo(v.x, v.y);
    return { lat, lon, zoom: LIEN.zoomDepuisResolution(v.metresParPixelCss, lat) };
  }
  if (onglet === '3d') {
    const c = vue3d?.camera();
    if (!c) return null;
    const { lon, lat } = projVue().versGeo(c.x, c.y);
    return {
      lat, lon, zoom: LIEN.zoomDepuisResolution(c.metresParPixelCss, lat),
      ...LIEN.orientationDepuisCamera(c.azimut, c.elevation),
    };
  }
  const centre = carte.map.getCenter();
  return { lat: centre.lat, lon: centre.lng, zoom: carte.map.getZoom() };
}

// ── Le lien du profil (R2) ───────────────────────────────────────────────────
// L'état de la coupe et de la sélection est dans le bloc du mode vue (la bande, la modale, le
// graphique) : il pose ces deux fonctions à sa fin. Un lien ouvert avant cela attend dans
// `partageEnAttente`, que le bloc consomme dès qu'il est prêt.
let etatPartageVue = null;       // () → l'état de la coupe, pour `LIEN.ecrirePartage`
let appliquerPartageVue = null;  // () → remet `partageEnAttente`
let partageEnAttente = null;

/** Ce que le fragment porte en plus de la vue : la coupe, sa mesure, la sélection, les classes du sol. */
function etatPartage() {
  if (!MODE_VUE) return {};
  const e = etatPartageVue ? etatPartageVue() : {};
  if (selectionActuelle) e.sel = { lat: selectionActuelle.lat, lon: selectionActuelle.lon };
  if (pointsMesure.length) {
    e.regle = pointsMesure.map((q) => { const g = projVue().versGeo(q.x, q.y); return { lat: g.lat, lon: g.lon }; });
  }
  return e;
}

/** Un lien ouvert : s'il porte quelque chose de la coupe ou de la sélection, le remettre. */
function demanderPartage(partage) {
  if (!MODE_VUE || !partage || !Object.keys(partage).length) return;
  partageEnAttente = partage;
  etat.restaurationPartage = true;
  appliquerPartageVue?.();
}

/**
 * Réécrit le fragment d'après la vue affichée. `replaceState`, jamais
 * `location.hash =` : le second empile une entrée d'historique à chaque
 * déplacement, et le bouton Retour deviendrait inutilisable.
 */
function ecrireLien() {
  clearTimeout(minuteurLien);
  // L'accueil ouvert, la carte bouge toute seule (cadrage initial) : écrire un
  // fragment ferait sauter l'accueil au prochain rechargement.
  if (!$('accueil').hidden) return;
  // Un lien qui vient d'être ouvert attend le chargement de sa dalle pour
  // s'appliquer en 2D et en 3D (`appliquerVueDuLien`) : ne pas l'écraser
  // d'ici là par la vue de carte, qui n'en garde ni l'échelle fine ni les angles.
  if (etat.vueDuLien) return;
  if (etat.restaurationPartage) return;
  const v = vueCourante();
  if (!v) return;
  const fragment = '#' + LIEN.ecrire(v) + LIEN.ecrirePartage(etatPartage());
  if (fragment !== location.hash) history.replaceState(null, '', fragment);
}

/**
 * Regroupe les demandes : la 3D en émet une par image pendant une animation,
 * et Safari refuse plus de 100 `replaceState` par 30 secondes.
 */
let minuteurLien = 0;
function majLien() {
  clearTimeout(minuteurLien);
  minuteurLien = setTimeout(ecrireLien, 300);
}

/**
 * Ouvre un lien : cadre la carte et, assez près pour qu'une dalle ait un sens,
 * sélectionne celle sous le centre. La vue fine (échelle 2D, angles 3D) attend
 * que la dalle soit chargée — il n'y a rien à cadrer avant.
 */
function ouvrirLien(lien) {
  // Vue normale : le lien cadre la carte, et le relief de la vue suit. Plus de
  // dalle à sélectionner, ni rien à charger d'un bloc.
  if (MODE_VUE) {
    requestAnimationFrame(() => { carte.invalider(); carte.map.setView([lien.lat, lien.lon], lien.zoom); });
    demanderPartage(LIEN.lirePartage(location.hash));
    return;
  }
  // Loin de tout, aucune dalle n'est sélectionnée : rien n'attendra de
  // chargement, et retenir la vue bloquerait l'écriture du lien pour rien.
  const selectionnable = lien.zoom >= CONFIG.carte.zoomGrille
    && PROJ.dansEmpriseFrance(lien.lon, lien.lat);
  etat.vueDuLien = selectionnable ? lien : null;
  requestAnimationFrame(async () => {
    // Fermer l'accueil rend au panneau sa colonne de 380 px, redimensionnement
    // purement CSS que Leaflet ne détecte pas tout seul.
    carte.invalider();
    carte.map.setView([lien.lat, lien.lon], lien.zoom);
    if (!selectionnable) return;
    // Après ce cadrage, le moindre déplacement de la carte — geste, recherche,
    // bouton, clavier — abandonne la vue du lien : qui est allé ailleurs ne
    // veut plus y être ramené après le chargement, et le lien doit de nouveau
    // suivre la vue. `movestart` et pas des évènements de pointeur : la
    // recherche déplace la carte sans qu'on la touche. `setView` sans
    // animation émet le sien avant de rendre la main, d'où `once` posé après.
    carte.map.once('movestart', abandonnerVueDuLien);
    await carte.selectionnerAuPoint(lien.lon, lien.lat);
  });
}

function abandonnerVueDuLien() {
  if (!etat.vueDuLien) return;
  etat.vueDuLien = null;
  majLien();
}

/**
 * Après le chargement d'une dalle : si un lien ouvert attendait, et que son
 * centre est dans cette dalle, la 2D et la 3D reprennent sa vue. Un lien
 * écrit depuis la 3D — donc incliné ou tourné — y ramène directement.
 */
function appliquerVueDuLien(dalle) {
  const v = etat.vueDuLien;
  if (!v) return;
  etat.vueDuLien = null;
  const { x, y } = PROJ.versLambert93(v.lon, v.lat);
  const e = dalle.emprise;
  if (x < e.xmin || x > e.xmax || y < e.ymin || y > e.ymax) return;

  const resolution = LIEN.resolutionDepuisZoom(v.zoom, v.lat);
  vue2d.placer(x, y, resolution);
  if (vue3d && (v.orientation || v.inclinaison)) {
    // L'onglet d'abord : la distance se déduit de la hauteur du canevas, qui
    // ne se mesure qu'une fois affiché — masqué, le zoom repris dérivait d'un
    // quart de cran.
    basculerVue('3d');
    const { azimut, elevation } = LIEN.cameraDepuisOrientation(v.orientation, v.inclinaison);
    vue3d.placerCamera(x, y, vue2d.lire(x, y)?.altitude ?? null, resolution, azimut, elevation);
  }
  majLien();
}

/**
 * Copie le lien courant. `navigator.clipboard` peut refuser en silence — pas
 * seulement en `file://`, mesuré aussi en headless sans geste utilisateur — et
 * l'échec ne doit pas priver du lien : `prompt()` repose sur aucune permission
 * et marche partout, texte déjà sélectionné pour un Ctrl+C manuel.
 */
async function copierLien() {
  ecrireLien();   // la dernière demande peut encore attendre son minuteur
  try {
    await navigator.clipboard.writeText(location.href);
    statut('Lien copié dans le presse-papiers');
  } catch {
    prompt('Copiez ce lien :', location.href);
  }
}

/**
 * Ouvre la même vue sur osm.org — le seul lien sortant, délibérément : osm.org
 * mène à iD, JOSM et au reste de l'écosystème par son propre bouton
 * « Modifier ». Zoom entier et sans angles, ce qu'osm.org sait afficher.
 */
function ouvrirDansOSM() {
  const v = vueCourante();
  if (!v) return;
  const fragment = LIEN.ecrire({ zoom: Math.round(v.zoom), lat: v.lat, lon: v.lon });
  window.open(`https://www.openstreetmap.org/#${fragment}`, '_blank', 'noopener');
}

function basculerMenuPartage(ouvrir = $('menu-partager').hidden) {
  $('menu-partager').hidden = !ouvrir;
  $('btn-partager').setAttribute('aria-expanded', String(ouvrir));
}
$('btn-partager').addEventListener('click', () => basculerMenuPartage());
$('btn-copier-lien').addEventListener('click', () => { basculerMenuPartage(false); copierLien(); });
$('btn-ouvrir-osm').addEventListener('click', () => { basculerMenuPartage(false); ouvrirDansOSM(); });
// Un clic ailleurs ou Échap referme le menu, comme tout menu.
document.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.partage')) basculerMenuPartage(false);
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') basculerMenuPartage(false); });

// ── Mode ────────────────────────────────────────────────────────────────────
//
// Par défaut, le relief se calcule pour la vue affichée, sans dalle à choisir
// (spec docs/superpowers/specs/2026-09-26-flux-vue-design.md). « ?dalle » dans
// l'adresse rend l'ancien parcours — choisir une dalle, la charger, la lire en
// 2D ou en 3D — le temps de la transition. La feuille de style retire ce qui
// n'a pas cours dans le mode (`body[data-mode]`).
// Soutenir : le bouton vers Ko-fi (don ponctuel), Liberapay en petit lien
// dessous ; Liberapay seul, il prend le bouton. Rien de configuré : rien.
{
  const { kofi, liberapay } = CONFIG.soutien;
  if (kofi || liberapay) {
    $('lien-soutien').href = kofi || liberapay;
    $('libelle-soutien').textContent = kofi ? 'Offrir un café' : 'Soutenir sur Liberapay';
    if (kofi && liberapay) {
      $('lien-liberapay').href = liberapay;
      $('soutien-regulier').hidden = false;
    }
    $('section-soutien').hidden = false;
  }
}

const MODE_VUE = !new URLSearchParams(location.search).has('dalle');
// « &debug » ou « &chrono » : les chiffres de diagnostic (statut, HUD 3D).
const DIAGNOSTIC = ['debug', 'chrono'].some((p) => new URLSearchParams(location.search).has(p));
document.body.dataset.mode = MODE_VUE ? 'vue' : 'dalle';

// ── Carte ───────────────────────────────────────────────────────────────────

const carte = new Carte($('vue-carte'), {
  surDalle: (d) => {
    const dl = $('detail-dalle');
    dl.hidden = false;
    dl.innerHTML = ligneDetail('Nom', d.nom)
      + ligneDetail('Points', d.nbPoints ? milliers(d.nbPoints) : '—')
      + ligneDetail('Acquisition', d.dateAcquisition || '—')
      + ligneDetail('Altimétrie', d.systemeAltimetrique || '—')
      + ligneDetail('Emprise', `X ${d.emprise.xmin}–${d.emprise.xmax}\nY ${d.emprise.ymin}–${d.emprise.ymax}`);
    $('info-dalle').hidden = true;
    // Publiée sur `etat` : c'est ce que le bouton « Voir un exemple » attend
    // pour savoir quand l'index COPC est lu et déclencher le chargement à sa
    // place, sans dupliquer cette lecture.
    etat.promesseIndex = ouvrirDalle(d);
  },
  surRecherche: (m) => statut(m, 'travail'),
  surErreur: alerter,
});
carte.map.on('moveend', majLien);

// ── Recherche de lieu ───────────────────────────────────────────────────────

let abandonRecherche = null;

async function rechercher() {
  const q = $('recherche').value.trim();
  const liste = $('resultats-recherche');
  if (!q) { liste.hidden = true; return; }

  abandonRecherche?.abort();
  abandonRecherche = new AbortController();
  statut('Recherche…', 'travail');

  try {
    const lieux = await IGN.geocoder(q, abandonRecherche.signal);
    liste.innerHTML = '';
    if (!lieux.length) {
      statut('Aucun lieu trouvé');
      liste.hidden = true;
      return;
    }

    // Un seul résultat : on y va directement, sans faire cliquer pour rien.
    if (lieux.length === 1) { allerAu(lieux[0]); return; }

    for (const l of lieux) {
      const li = document.createElement('li');
      li.textContent = l.label;
      li.addEventListener('click', () => allerAu(l));
      liste.appendChild(li);
    }
    liste.hidden = false;
    statut(`${lieux.length} lieux — choisissez`);
  } catch (e) {
    if (e.name !== 'AbortError') alerterPanne('Recherche', e);
  }
}

function allerAu(lieu) {
  $('resultats-recherche').hidden = true;
  carte.allerA(lieu.lon, lieu.lat);
  statut(MODE_VUE ? lieu.label : `${lieu.label} — cliquez une dalle`);
}

$('btn-recherche').addEventListener('click', rechercher);
$('recherche').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); rechercher(); }
  if (e.key === 'Escape') $('resultats-recherche').hidden = true;
});

/**
 * Neutralise le HTML d'une chaîne avant insertion.
 *
 * Les noms de dalle, dates et natures de bâtiment viennent des services de
 * l'IGN, pas de l'utilisateur. Le risque est donc théorique — mais ces valeurs
 * traversent le réseau avant d'atterrir dans un `innerHTML`, et rien ne garantit
 * qu'un champ de la BD TOPO ne contiendra jamais de chevron. Échapper coûte une
 * ligne ; s'en remettre à la bonne tenue d'une source tierce, non.
 */
function echapper(v) {
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ligneDetail(cle, valeur) {
  return `<dt>${echapper(cle)}</dt><dd>${echapper(valeur).replace(/\n/g, '<br>')}</dd>`;
}

// ── Étape 1 : dalle choisie → index COPC lu, résolution proposée ────────────

/**
 * Lit l'index d'une dalle dès qu'elle est cliquée, et déplie la résolution.
 *
 * Il y avait autrefois un bouton « Ouvrir la dalle » avant celui-ci. Il ne
 * décidait de rien : l'index coûte deux requêtes de plage et ~50 Ko, et on ne
 * choisit une dalle que pour la charger. Le faire à la sélection laisse un seul
 * bouton dans le panneau, « Charger le nuage », qui est le seul choix réel —
 * celui qui engage des centaines de mégaoctets.
 */
async function ouvrirDalle(d) {
  // Un clic sur une autre dalle prime : l'index en cours de lecture comme le
  // nuage en cours de téléchargement portent sur celle qu'on vient de quitter.
  etat.abandonIndex?.abort();
  etat.abandon?.abort();
  const ctrl = new AbortController();
  etat.abandonIndex = ctrl;

  etat.dalle = d;
  etat.entete = null;
  etat.hierarchie = null;
  etat.couts = [];

  $('bloc-resolution').hidden = false;
  $('niveau').disabled = true;
  $('btn-charger').disabled = true;
  $('btn-annuler').hidden = true;
  $('progression').hidden = true;
  $('barre-progression').style.width = '0';
  $('progression-pct').textContent = '0 %';
  $('progression-detail').textContent = '—';
  $('val-niveau').textContent = '—';
  $('cout').textContent = 'Lecture de l’index COPC…';
  statut('Lecture de l’index COPC…', 'travail');

  try {
    // Deux requêtes de plage — ~50 Ko — pour connaître l'octree entier d'un
    // fichier de 190 Mo. C'est toute la raison d'être du format COPC ici.
    const entete = await COPC.lireEntete(d.url, ctrl.signal);
    const hierarchie = await COPC.lireHierarchie(entete, ctrl.signal);
    if (ctrl.signal.aborted) return;

    etat.entete = entete;
    etat.hierarchie = hierarchie;
    majCouts();
    statut(`Index lu : ${milliers(hierarchie.size)} nœuds, ${milliers(entete.nbPoints)} points`
      + ' — réglez la résolution puis chargez');
  } catch (e) {
    if (ctrl.signal.aborted || e.name === 'AbortError') return;
    $('cout').innerHTML = '<span class="att">Index illisible.</span>';
    alerterPanne('Ouverture de la dalle', e);
  }
}

/**
 * Recalcule le coût de chaque niveau d'octree pour la zone courante et cale le
 * curseur de résolution.
 */
function majCouts() {
  if (!etat.entete || !etat.dalle) return;
  etat.couts = COPC.coutParNiveau(etat.entete, etat.hierarchie, etat.dalle.emprise);

  const curseur = $('niveau');
  if (!etat.couts.length) {
    curseur.disabled = true;
    $('cout').innerHTML = '<span class="att">Aucun point dans cette zone.</span>';
    $('btn-charger').disabled = true;
    return;
  }

  curseur.disabled = false;
  curseur.max = etat.couts.length - 1;

  // Par défaut, le niveau le plus fin qui tienne dans les budgets : c'est
  // celui qu'on veut presque toujours, et le baisser reste possible.
  //
  // Sur un appareil portatif, le budget est ramené à ce qui a une chance
  // d'aboutir. Proposer 190 Mo par défaut sur un téléphone, c'est proposer un
  // échec : le curseur reste libre, mais il ne faut pas y pousser.
  const budgetOctets = surMobile()
    ? Math.min(CONFIG.nuage.budgetOctets, CONFIG.nuage.budgetOctetsMobile)
    : CONFIG.nuage.budgetOctets;
  let defaut = 0;
  for (let i = 0; i < etat.couts.length; i++) {
    const c = etat.couts[i];
    if (c.nbPoints <= CONFIG.nuage.budgetPoints && c.octets <= budgetOctets) defaut = i;
  }
  // Un réglage explicite se conserve d'une dalle à l'autre — on inspecte
  // rarement la seconde à une autre finesse que la première.
  etat.niveau = curseur.dataset.touche
    ? Math.min(Number(curseur.value), etat.couts.length - 1)
    : defaut;
  curseur.value = etat.niveau;

  majAffichageCout();
}

function majAffichageCout() {
  const c = etat.couts[etat.niveau];
  if (!c) return;

  $('val-niveau').textContent = `${c.espacement < 1 ? (c.espacement * 100).toFixed(0) + ' cm' : c.espacement.toFixed(1) + ' m'}`;

  // Le pas de grille est annoncé avant le chargement : sur 1 km² il peut être
  // relevé automatiquement, et l'utilisateur doit le savoir avant d'attendre.
  const cote = etat.dalle.emprise.xmax - etat.dalle.emprise.xmin;
  const pasReel = Math.max(CONFIG.raster.pasM,
    Math.ceil(Math.sqrt((cote * cote) / CONFIG.raster.cellulesMax) * 20) / 20);
  const niveauVue = NUAGE.niveauPourAffichage(etat.couts.slice(0, etat.niveau + 1));

  $('cout').innerHTML =
    `Niveau ${c.niveau} · ${milliers(c.nbNoeuds)} nœuds<br>`
    + `<b>${milliers(c.nbPoints)}</b> points · <b>${octets(c.octets)}</b> à télécharger<br>`
    + `Espacement ≈ <b>${c.espacement < 1 ? (c.espacement * 100).toFixed(0) + ' cm' : c.espacement.toFixed(2) + ' m'}</b>`
    + ` · grille <b>${pasReel.toFixed(2)} m</b><br>`
    + `<span class="doux">Aperçu 3D au niveau ${niveauVue} ; la détection lit tout.</span>`
    // Le dire avant, plutôt que de laisser un téléphone ramer puis planter. Une
    // dalle pleine, c'est 190 Mo à télécharger et 400 à 520 Mo de grilles en
    // mémoire — au-delà de ce qu'un navigateur mobile accorde à un onglet.
    + (surMobile() && c.octets > 40 * 1024 * 1024
      ? `<br><span class="att">Sur téléphone, ${octets(c.octets)} est beaucoup :`
        + ` le téléchargement sera long et l'onglet peut être fermé par le système`
        + ` avant la fin. Baissez la résolution, ou revenez sur un ordinateur.</span>`
      : '');

  $('btn-charger').disabled = false;
}

$('niveau').addEventListener('input', (e) => {
  e.target.dataset.touche = '1';
  etat.niveau = Number(e.target.value);
  majAffichageCout();
});

// ── Étape 1 → 2 : chargement du nuage ───────────────────────────────────────
//
// Fonction nommée plutôt qu'un gestionnaire anonyme : « Mettre à jour » (§
// Classes du sol, plus bas) rejoue exactement cette même chaîne — même dalle,
// même résolution, seule la sélection de classes change — plutôt que de la
// dupliquer.

async function chargerNuage() {
  if (!etat.entete || !etat.dalle) return;
  const dalle = etat.dalle;

  const emprise = etat.dalle.emprise;
  // Budgets neutralisés : la sélection est bornée par le niveau demandé, et la
  // mémoire ne dépend plus du nombre de points depuis que les blocs sont
  // rastérisés puis jetés.
  const sel = COPC.selectionner(etat.entete, etat.hierarchie, emprise, Infinity, Infinity);

  // La sélection est cumulative par niveau : on coupe à celui demandé.
  const noeuds = sel.noeuds.filter((n) => n.cle.n <= etat.couts[etat.niveau].niveau);
  if (!noeuds.length) { alerter('Aucun nœud à charger dans cette zone.'); return; }

  const ctrl = new AbortController();
  etat.abandon = ctrl;
  $('btn-charger').disabled = true;
  $('btn-classes-sol-appliquer').disabled = true;
  $('btn-annuler').hidden = false;
  $('progression').hidden = false;
  const debut = performance.now();

  const origine = [(emprise.xmin + emprise.xmax) / 2, (emprise.ymin + emprise.ymax) / 2,
    etat.entete.bbox.zmin];

  try {
    // Les grilles sont allouées d'emblée et remplies bloc par bloc : c'est ce
    // qui permet d'analyser 1 km² à pleine résolution sans jamais détenir les
    // 39 M de points en mémoire.
    //
    // Elles restent LOCALES jusqu'au succès. Publiées d'emblée dans `etat`, une
    // annulation à mi-parcours laissait la grille à moitié remplie de la
    // nouvelle dalle pendant que la 3D montrait encore l'ancienne — et la
    // détection lisait alors ce mélange sans que rien ne le signale.
    const grille = RASTER.creerGrilles(emprise, origine, undefined, classesSol);
    etat.classesSolChargees = new Set(classesSol);   // instantané : `classesSol` peut encore bouger après ce point
    const niveauVue = NUAGE.niveauPourAffichage(etat.couts.slice(0, etat.niveau + 1));

    // Expérimental (branche `experiment/octets-compresses`) : capturé à
    // chaque avancement, ne sert qu'au message de fin — le volume resservi
    // depuis le cache local plutôt que redemandé au réseau.
    let octetsResservisFinal = 0;

    const nuage = await NUAGE.charger(etat.entete, noeuds, emprise, {
      niveauAffichage: niveauVue,
      surBloc: (bloc) => RASTER.accumuler(grille, bloc),
      surAvancement: (a) => {
        // En octets, pas en blocs : les plages groupées n'ont pas toutes la
        // même taille, et c'est le volume — pas leur nombre — qu'on annonce
        // juste à côté (« X / Y Mo »). Les deux chiffres doivent s'accorder.
        const totalOctets = etat.couts[etat.niveau].octets;
        const pct = totalOctets ? Math.min(100, (a.octets / totalOctets) * 100) : 0;
        $('barre-progression').style.width = `${pct}%`;
        $('progression-pct').textContent = `${pct.toFixed(0)} %`;
        octetsResservisFinal = a.octetsResservis;
        $('progression-detail').textContent =
          `${octets(a.octets)} / ${octets(totalOctets)} · ${milliers(a.points)} points`
          + (a.octetsResservis ? ` · ${octets(a.octetsResservis)} resservis du cache local` : '');
        statut(`Téléchargement ${a.faits}/${a.total} — ${milliers(a.points)} points`, 'travail');
      },
      signal: ctrl.signal,
    });

    if (!nuage.n) { alerter('Dalle vide : aucun point dans cette emprise.'); return; }

    etat.grille = grille;
    etat.nuage = nuage;
    etat.sentiers = null;
    etat.resultat = null;
    etat.resultatFormes = null;
    etat.reliefGrille = null;
    viderCache2D();
    vue2d.definirGrille(null);
    carte.effacerSentiers();
    $('liste-sentiers').innerHTML = '';
    $('compte-sentiers').textContent = '';
    $('stats-sentiers').hidden = true;
    $('exports-sentiers').hidden = true;
    $('liste').innerHTML = '';
    $('compte').textContent = '';
    $('stats-detection').hidden = true;
    $('bloc-resultats').hidden = true;
    carte.afficherDetections([], selectionner_);
    // Un point sélectionné ou une mesure sur l'ancienne dalle n'a plus de
    // sens ici.
    effacerSelection();
    effacerMesure();

    // On bascule AVANT l'analyse, pas après : le voile se poserait sinon sur la
    // carte, qui n'a rien à voir avec ce qui se calcule et qui charge par
    // ailleurs sa couverture à chaque déplacement. Il couvre maintenant la vue
    // qui va recevoir le résultat.
    $('section-vide-3d').hidden = true;
    $('section-affichage').hidden = false;
    $('section-analyse').hidden = ANALYSE_MASQUEE && SENTIERS_MASQUES;
    $('section-selection').hidden = false;
    $('section-mesure').hidden = false;
    $('section-sol').hidden = false;
    // Le nuage est le résultat le plus spectaculaire, mais ce n'est pas celui
    // qu'on vient chercher : un objet de six mètres ne se voit pas dans un
    // kilomètre carré de points. La 2D est la vue d'arrivée.
    basculerVue('2d');

    // Le téléchargement est fini ; ce qui suit est synchrone et bloque le fil
    // principal — d'où le voile, et non plus un simple `statut`.
    await ATTENTE.pendant('Analyse de la dalle', async (etape) => {
      await etape('Nuage vers le GPU…', `${milliers(etat.nuage.n)} points`);
      vue3d?.definirNuage(etat.nuage);
      vue3d?.definirClassesMasquees(classesMasquees);
      vue3d?.definirSentiers([], null);
      vue3d?.definirSentierChoisi(null, null);
      vue3d?.definirDetections([], null);
      vue3d?.definirSelection(null, null);

      await etape('Modèle de terrain…', 'comblement des trous sous les structures');
      RASTER.finaliser(etat.grille);

      await etape('Hauteurs au-dessus du sol…');
      vue3d?.definirHauteurs(RASTER.hauteurParPoint(etat.nuage, etat.grille));

      // La grille d'affichage se prépare ici, sous le même voile : la 2D est la
      // vue d'arrivée, et elle serait sinon vide au moment précis où on y
      // arrive.
      await etape('Grille de relief…', 'agrégation à 50 cm');
      etat.reliefGrille = RELIEF.preparer(etat.grille, { inclureBati: reglages.inclureBati });
    });

    // Puis les deux couches, hors du voile d'analyse : la photo demande une
    // centaine de tuiles, et `preparer2D` pose son propre voile pour chacune.
    await preparer2D();
    appliquerVueDuLien(dalle);

    // Si l'utilisateur regardait le nuage en mode relief, la nouvelle dalle doit
    // s'afficher pareil : sans ça elle reviendrait en hauteurs, sous un bouton
    // qui dit toujours « Relief ».
    if (CONFIG.rendu.coloration === 'relief') await majAttributNuage();

    etat.dalleChargee = dalle;
    carte.marquerChargee(dalle);
    majBandeau();

    majLegende();
    majListeClassesSol();
    majHUD();

    const secondes = ((performance.now() - debut) / 1000).toFixed(1);
    statut(`Dalle analysée en ${secondes} s — grille ${etat.grille.pas.toFixed(2)} m, `
      + `aperçu ${milliers(etat.nuage.n)} points`
      + (octetsResservisFinal ? ` (${octets(octetsResservisFinal)} resservis du cache local, sans réseau)` : ''));

    if (etat.grille.pas > CONFIG.raster.pasM + 1e-6) {
      alerter(`Grille relevée à ${etat.grille.pas.toFixed(2)} m : ${CONFIG.raster.pasM} m dépasserait le plafond de cellules.`);
    }
  } catch (e) {
    if (e.name !== 'AbortError') alerterPanne('Chargement', e);
    // Une annulation venue d'un clic sur une autre dalle n'a rien à dire : le
    // message de celle-ci est déjà à l'écran, et ce chargement-là est caduc.
    else if (etat.dalle === dalle) statut('Chargement annulé');
  } finally {
    // Le panneau appartient peut-être déjà à une autre dalle : ne rendre la
    // main sur les boutons que si celle-ci est encore la dalle courante.
    if (etat.dalle === dalle) {
      $('btn-charger').disabled = !etat.entete;
      $('btn-annuler').hidden = true;
      $('progression').hidden = true;
      $('barre-progression').style.width = '0';
      $('progression-pct').textContent = '0 %';
      $('progression-detail').textContent = '—';
      // Sur un échec, `majListeClassesSol()` (appelée seulement en cas de
      // succès, plus haut) n'aura pas tourné : sans ce rappel, un rechargement
      // raté laisserait le bouton bloqué à « désactivé » pour toujours.
      majBoutonClassesSol();
    }
    if (etat.abandon === ctrl) etat.abandon = null;
  }
}
$('btn-charger').addEventListener('click', chargerNuage);

$('btn-annuler').addEventListener('click', () => etat.abandon?.abort());

// ── Le nuage chargé : le nommer, et pouvoir le fermer ───────────────────────

/**
 * Bandeau du nuage en mémoire, et libellé du bouton de chargement.
 *
 * Deux choses à dire, que rien ne disait : quelle dalle est réellement chargée —
 * la sélection sur la carte a pu changer depuis — et le fait que charger la
 * suivante remplacera celle-là.
 */
function majBandeau() {
  const d = etat.dalleChargee;
  $('bandeau-nuage').hidden = !d;
  if (d) {
    $('bandeau-nom').textContent = d.nom;
    $('bandeau-info').textContent = etat.nuage
      ? `${milliers(etat.nuage.n)} pts · ${etat.grille?.pas.toFixed(2) ?? '—'} m`
      : '';
  }
  $('btn-charger').textContent = d ? 'Remplacer le nuage' : 'Charger le nuage';
}

/**
 * Décharge le nuage et tout ce qui en découle, sans toucher à la sélection.
 *
 * Il n'existait aucune façon de revenir à l'état vide : on rechargeait la page.
 * Et comme les grilles et le nuage d'affichage pèsent 400 à 520 Mo, ils
 * restaient en mémoire pendant tout le temps passé à explorer la carte ensuite.
 *
 * La dalle sélectionnée, elle, survit : fermer un nuage n'est pas renoncer à la
 * zone, et on veut pouvoir le recharger à une autre résolution.
 */
function fermerNuage() {
  etat.abandon?.abort();

  etat.nuage = null;
  etat.grille = null;
  etat.resultat = null;
  etat.resultatFormes = null;
  etat.sentiers = null;
  etat.selection = null;
  etat.dalleChargee = null;
  etat.reliefGrille = null;
  viderCache2D();
  NUAGE.viderCacheOctets();

  vue3d?.vider();
  vue2d.definirGrille(null);
  $('relief-controles').hidden = true;
  $('relief-vide').hidden = false;
  $('relief-stats').hidden = true;
  $('rideau').hidden = true;
  carte.marquerChargee(null);
  carte.effacerSentiers();
  carte.afficherDetections([], selectionner_);

  $('section-affichage').hidden = true;
  $('section-analyse').hidden = true;
  $('section-vide-3d').hidden = false;
  $('section-selection').hidden = true;
  effacerSelection();
  $('section-mesure').hidden = true;
  effacerMesure();
  $('section-sol').hidden = true;
  $('liste').innerHTML = '';
  $('liste-sentiers').innerHTML = '';
  $('compte').textContent = '';
  $('compte-sentiers').textContent = '';
  $('stats-detection').hidden = true;
  $('stats-sentiers').hidden = true;
  $('bloc-resultats').hidden = true;
  $('exports-sentiers').hidden = true;

  majBandeau();
  majLegende();
  majListeClassesSol();
  majHUD();
  basculerVue('carte');
  statut('Nuage fermé — mémoire libérée');
}

$('btn-fermer-nuage').addEventListener('click', fermerNuage);

// ── Onglet 2D ───────────────────────────────────────────────────────────────
//
// Deux couches à la fois, une de chaque côté du rideau. C'est la démonstration
// la plus parlante de l'outil — une structure invisible sur la photo apparaît
// dans le relief — et c'est aussi la vue d'arrivée après le chargement d'une
// dalle.
//
// « Photo aérienne » est une couche comme les autres de ce point de vue : elle
// est rééchantillonnée une fois dans la grille Lambert-93 (`ortho.js`), donc
// elle se lit sur les mêmes cellules que le relief, et le rideau tombe au pixel.

const PHOTO = 'photo';
const PLAN = 'plan';
// Trois soleils à 120°, un par canal RGB, plutôt que moyennés en gris comme
// « Ombrage » — voir `RELIEF.ombrageRGB`. Hors de `RELIEF.COUCHES` : cette
// couche ne suit pas le contrat des autres (palette + étalement), elle
// produit directement un RGBA, comme la photo aérienne — `sourceCouche`
// la traite donc à part plutôt que via `RELIEF.calculer`.
const OMBRAGE_RGB = 'ombrage-rgb';
// Les deux valent 'ortho'/'plan' côté service IGN (`CONFIG.ign.fonds`) — les
// clés ici sont celles du sélecteur, `ortho.js` fait la correspondance.
const FONDS = { [PHOTO]: 'ortho', [PLAN]: 'plan' };

/** Ce que les deux listes proposent : les fonds WMTS, puis les couches de relief. */
const CHOIX_2D = [
  {
    cle: PHOTO,
    libelle: 'Photo aérienne',
    aide: 'Orthophoto de l’IGN, redressée dans la grille Lambert-93. C’est le contexte : ce qu’on verrait en survolant.',
  },
  {
    cle: PLAN,
    libelle: 'Plan IGN',
    aide: 'Carte IGN — routes, toponymes, courbes de niveau — redressée dans la grille comme la photo. Plus lisible pour se repérer que la photo aérienne là où le couvert végétal cache tout.',
  },
  ...RELIEF.COUCHES.map((c) => ({ cle: c.cle, libelle: c.libelle, aide: c.aide })),
  {
    cle: OMBRAGE_RGB,
    libelle: 'Ombrage coloré (3 soleils)',
    aide: 'Trois soleils à 120°, un par canal — l’orientation d’un mur ou d’un talus se lit en teinte, là où « Ombrage » l’aplatit dans une moyenne grise.',
  },
];

const def2D = (cle) => CHOIX_2D.find((c) => c.cle === cle) || CHOIX_2D[0];

// Photo à gauche, relief à droite : c'est le sens de lecture de la comparaison.
// Le Sky-View Factor par défaut coûte plus cher que l'ombrage (calcul « lent »,
// balayage d'horizons) mais lit pareillement versant et plat, sans direction
// d'éclairage à deviner — préféré après usage réel.
let couches2D = { gauche: PHOTO, droite: 'svf' };
let contrasteRelief = CONFIG.relief.contraste;

/**
 * Cache des couches calculées, par dalle.
 *
 * Une seule couche était gardée jusqu'ici. Avec deux côtés, un aller-retour du
 * sélecteur recalculerait un Sky-View Factor à chaque mouvement — cinq secondes
 * la pièce. Le cache est vidé avec la grille, jamais avant : c'est elle qui
 * définit la validité de ce qui est dedans.
 */
const couches2DCalculees = new Map();
// Un fond (photo ou plan) par entrée, chacun avec son résultat, sa promesse en
// cours et son contrôleur d'annulation — la photo et le plan peuvent être
// demandés en même temps si les deux côtés du rideau les choisissent.
const fondsCharges = new Map();
const fondsEnCours = new Map();
const fondsAbort = new Map();

/** Les couches calculées seulement : les fonds ne dépendent pas de la surface. */
function viderCouches2D() {
  couches2DCalculees.clear();
}

/** Tout, fonds compris : à réserver au changement de dalle. */
function viderCache2D() {
  viderCouches2D();
  fondsCharges.clear();
  fondsEnCours.clear();
  for (const controleur of fondsAbort.values()) controleur.abort();
  fondsAbort.clear();
}

for (const cote of ['gauche', 'droite']) {
  $(`couche-${cote}`).innerHTML = CHOIX_2D.map((c) =>
    `<option value="${c.cle}">${echapper(c.libelle)}</option>`).join('');
  $(`couche-${cote}`).value = couches2D[cote];
  $(`couche-${cote}`).addEventListener('change', (e) => choisirCouche2D(cote, e.target.value));
}

/**
 * Réglages du balayage d'horizons (directions, rayon) : propres au
 * Sky-View Factor, affichés seulement quand cette couche est choisie d'un
 * côté ou de l'autre — les autres couches n'en ont pas besoin, les montrer
 * tout le temps encombrerait le panneau pour rien.
 */
function majVisibiliteReglagesSVF() {
  $('svf-reglages').hidden = couches2D.gauche !== 'svf' && couches2D.droite !== 'svf';
}
majVisibiliteReglagesSVF();

$('svf-directions').value = CONFIG.relief.svfDirections;
$('val-svf-directions').textContent = CONFIG.relief.svfDirections;
$('svf-rayon').value = CONFIG.relief.svfRayonM;
$('val-svf-rayon').textContent = `${CONFIG.relief.svfRayonM} m`;

// Coût linéaire au nombre de directions et au rayon (`balayerHorizons`), donc
// on ne recalcule qu'au relâchement (`change`), pas à chaque cran glissé
// (`input`, qui ne fait que rafraîchir le chiffre affiché) — recalculer à
// chaque cran ferait tourner un balayage de plusieurs secondes en boucle
// pendant le glissé.
$('svf-directions').addEventListener('input', (e) => {
  $('val-svf-directions').textContent = e.target.value;
});
$('svf-directions').addEventListener('change', async (e) => {
  CONFIG.relief.svfDirections = Number(e.target.value);
  await recalculerSVF();
});
$('svf-rayon').addEventListener('input', (e) => {
  $('val-svf-rayon').textContent = `${e.target.value} m`;
});
$('svf-rayon').addEventListener('change', async (e) => {
  CONFIG.relief.svfRayonM = Number(e.target.value);
  await recalculerSVF();
});

/** Le SVF partage son balayage avec les deux ouvertures : on vide tout le cache. */
async function recalculerSVF() {
  viderCouches2D();
  await appliquerCote('gauche');
  await appliquerCote('droite');
}

$('btn-echanger').addEventListener('click', async () => {
  const { gauche, droite } = couches2D;
  await choisirCouche2D('gauche', droite);
  await choisirCouche2D('droite', gauche);
});

$('btn-rideau-centre').addEventListener('click', () => placerRideau(0.5));

/**
 * Complément du sol par les retours non classés.
 *
 * Change la surface elle-même, donc la grille d'affichage et toutes les couches
 * qui en dérivent — mais pas la photo, qui n'en dépend pas et coûte cent
 * requêtes.
 */
$('inclure-sursol').checked = CONFIG.relief.inclureSursol;
$('inclure-sursol').addEventListener('change', async (e) => {
  CONFIG.relief.inclureSursol = e.target.checked;
  etat.reliefGrille = null;
  viderCouches2D();
  if ($('panneau').dataset.vue === '2d') await preparer2D();
});

/**
 * Prépare la grille d'affichage, au premier passage sur l'onglet.
 *
 * Paresseux à dessein : c'est une passe sur les 16 M de cellules de la grille
 * fine, inutile tant qu'on n'a pas demandé à voir la dalle en 2D.
 */
async function preparer2D() {
  const dispo = !!etat.grille?.mnt;
  $('relief-vide').hidden = dispo;
  $('relief-controles').hidden = !dispo;
  $('rideau').hidden = !dispo;
  // `mnt` n'existe qu'après `RASTER.finaliser` : la bascule vers cet onglet a
  // lieu **avant** le comblement, pour que le voile se pose sur la vue qui va
  // recevoir le résultat. Préparer le relief sur une grille non comblée
  // rendrait une surface pleine de trous, sans que rien ne le signale.
  if (!dispo) { vue2d.invalider(); return; }

  if (!etat.reliefGrille) {
    await ATTENTE.pendant('Préparation du relief', () => {
      etat.reliefGrille = RELIEF.preparer(etat.grille, { inclureBati: reglages.inclureBati });
    }, 'agrégation des grilles de détection');
  }

  // Idempotent : on ne recadre pas la vue à chaque retour sur l'onglet, sinon
  // le zoom qu'on venait d'ajuster serait perdu au moindre aller-retour.
  if (vue2d.grille !== etat.reliefGrille) {
    vue2d.definirGrille(etat.reliefGrille);
    vue2d.definirDetections(candidatsVisibles(), etat.grille);
    vue2d.definirTraces(etat.sentiers?.traces || []);
    vue2d.definirSelection(etat.selection);
    placerRideau(vue2d.rideau);
  }

  // La droite d'abord : c'est le relief, ce pour quoi on est venu. La photo,
  // elle, demande une centaine de tuiles au réseau.
  if (!vue2d.source('droite')) await appliquerCote('droite');
  if (!vue2d.source('gauche')) await appliquerCote('gauche');
  $('relief-aide').textContent = def2D(couches2D.droite).aide;
  vue2d.invalider();
  avertirReliefVide();
}

/**
 * Une dalle sans sol connu rend un canevas gris, et rien ne dit pourquoi.
 *
 * Le cas existe : couvert dense, plan d'eau, dalle de bord de chantier. Toutes
 * les couches y valent NaN — ce qui est juste — mais un aplat neutre sans un mot
 * se lit comme une panne de l'outil, pas comme une absence de donnée.
 */
function avertirReliefVide() {
  const t = etat.reliefGrille;
  if (!t) return;
  let connues = 0;
  for (let i = 0; i < t.N; i++) if (t.valide[i]) connues++;
  const part = connues / t.N;
  if (part >= 0.02) return;

  alerter(part === 0
    ? 'Aucun point classé « sol » dans cette dalle : le relief ne peut pas être calculé. '
      + 'La photo aérienne, elle, reste lisible.'
    : `Presque aucun sol dans cette dalle (${(part * 100).toFixed(1)} % des cellules) : `
      + 'le relief y est surtout du vide. Essayez une dalle voisine.');
}

async function choisirCouche2D(cote, cle) {
  couches2D[cote] = cle;
  $(`couche-${cote}`).value = cle;
  $('relief-aide').textContent = def2D(cle).aide;
  majVisibiliteReglagesSVF();
  await appliquerCote(cote);
}

/**
 * Installe d'un côté la couche qui lui est assignée, en la calculant au besoin.
 *
 * La durée est remontée à l'écran : sur le Sky-View Factor elle dépend de la
 * machine, du pas et du rayon, et l'annoncer vaut mieux que de l'estimer.
 */
async function appliquerCote(cote) {
  const cle = couches2D[cote];
  if (!etat.reliefGrille) return;

  try {
    const source = (cle === PHOTO || cle === PLAN) ? await sourceFond(cle) : await sourceCouche(cle);
    // Le sélecteur a pu rebouger pendant le calcul : on ne pose que ce qui est
    // encore demandé, sans quoi une couche lente écraserait la couche rapide
    // choisie entre-temps.
    if (couches2D[cote] !== cle) return;
    vue2d.definirSource(cote, source);
    vue2d.definirContraste(contrasteRelief);
    majStats2D();
    majDrapage3D();
    statut(`2D : ${def2D(couches2D.gauche).libelle.toLowerCase()} | ${def2D(couches2D.droite).libelle.toLowerCase()}`);
  } catch (e) {
    if (e.name === 'AbortError') return;
    alerterPanne(`Couche ${def2D(cle).libelle.toLowerCase()}`, e);
    // Une couche qui manque ne doit pas laisser un côté noir sans explication :
    // on retombe sur l'ombrage, qui ne dépend ni du réseau ni d'un calcul long.
    if (cle !== 'ombrage') await choisirCouche2D(cote, 'ombrage');
  }
}

async function sourceCouche(cle) {
  if (cle === OMBRAGE_RGB) {
    // Hors du contrat des autres couches (pas de palette, pas d'étalement) :
    // un RGBA tout fait, consommé comme la photo aérienne — voir la
    // définition d'OMBRAGE_RGB.
    if (!couches2DCalculees.has(cle)) couches2DCalculees.set(cle, RELIEF.ombrageRGB(etat.reliefGrille));
    return { type: 'photo', rgba: couches2DCalculees.get(cle), libelle: def2D(cle).libelle };
  }

  if (!couches2DCalculees.has(cle)) {
    const def = RELIEF.COUCHES.find((c) => c.cle === cle);
    const calcul = () => RELIEF.calculer(etat.reliefGrille, cle, {
      inclureBati: reglages.inclureBati,
      contraste: contrasteRelief,
    });
    // Seules les couches déclarées lentes passent par le voile : sur un calcul
    // de cent millisecondes, l'apparition et la disparition immédiates du voile
    // sont plus désagréables que l'attente elle-même.
    couches2DCalculees.set(cle, def.lent
      ? await ATTENTE.pendant(def.libelle, calcul,
        `${CONFIG.relief.svfDirections} directions sur ${CONFIG.relief.svfRayonM} m`)
      : calcul());
  }
  return { type: 'couche', couche: couches2DCalculees.get(cle), libelle: def2D(cle).libelle };
}

/**
 * Fond WMTS de la dalle (photo aérienne ou Plan IGN), redressé dans la grille.
 *
 * Une centaine de tuiles passent par la file bornée de `reseau.js` — jamais par
 * Leaflet, qui n'y passe pas et sature la connexion HTTP/2 partagée. Le résultat
 * est gardé pour la dalle : on ne repaie pas cent requêtes parce qu'on a bougé
 * un sélecteur. Photo et plan sont mis en cache séparément — les deux peuvent
 * être demandés à la fois si chaque côté du rideau choisit l'un des deux.
 */
async function sourceFond(cle) {
  if (!fondsCharges.has(cle)) {
    // La promesse en cours est partagée : les deux côtés peuvent demander le
    // même fond, et deux chargements simultanés feraient deux cents requêtes
    // pour la même image.
    if (!fondsEnCours.has(cle)) {
      const t = etat.reliefGrille;
      const controleur = new AbortController();
      fondsAbort.set(cle, controleur);
      const promesse = ATTENTE.pendant(def2D(cle).libelle, (etape) =>
        ORTHO.charger(t.emprise, t.pas, t.W, t.H, {
          fond: FONDS[cle],
          signal: controleur.signal,
          surProgres: (faites, total) => {
            if (faites % 5 === 0 || faites === total) etape(null, `${faites} / ${total} tuiles`);
          },
        }), 'tuiles WMTS de l’IGN');
      fondsEnCours.set(cle, promesse);
      // Un échec ne doit pas laisser une promesse rejetée en cache : la
      // prochaine tentative doit repartir de zéro.
      promesse.catch(() => { fondsEnCours.delete(cle); });
    }
    const resultat = await fondsEnCours.get(cle);
    fondsCharges.set(cle, resultat);
    if (resultat.manquantes) {
      statut(`${def2D(cle).libelle} : ${resultat.manquantes} tuile(s) manquante(s)`, 'erreur');
    }
  }
  return { type: 'photo', rgba: fondsCharges.get(cle).rgba, libelle: def2D(cle).libelle };
}

/**
 * Couche de relief que le nuage 3D drape sur ses points.
 *
 * La droite d'abord, parce que c'est le côté du relief par convention ; la
 * gauche si la droite porte la photo. Si les deux portent la photo, il n'y a
 * rien à draper.
 */
function coucheDeReference() {
  return vue2d.couche('droite') || vue2d.couche('gauche');
}

function majDrapage3D() {
  // Le nuage 3D affiche peut-être cette même couche : changer de couche ici
  // doit se voir là-bas aussi, sans quoi les deux vues montreraient deux choses
  // différentes sous le même nom.
  if (CONFIG.rendu.coloration !== 'relief' || !etat.nuage) return;
  const c = coucheDeReference();
  if (!c) return;
  const cote = vue2d.couche('droite') ? 'droite' : 'gauche';
  const [min, max] = vue2d.etendue(cote);
  vue3d?.definirHauteurs(RELIEF.valeurParPoint(etat.nuage, etat.reliefGrille, { ...c, min, max }));
}

function majStats2D() {
  const t = etat.reliefGrille;
  if (!t) { $('relief-stats').hidden = true; return; }
  const lignes = [`Grille <b>${t.pas.toFixed(2)} m</b> · ${milliers(t.W)} × ${milliers(t.H)} cellules`];
  for (const cote of ['gauche', 'droite']) {
    const c = vue2d.couche(cote);
    if (!c) continue;
    const [min, max] = vue2d.etendue(cote);
    lignes.push(`${cote} : étalement <b>${min.toFixed(2)}</b> à <b>${max.toFixed(2)}</b>`
      + ` · calcul <b>${c.duree.toFixed(0)} ms</b>`);
  }
  for (const [cle, fond] of fondsCharges) {
    lignes.push(`${def2D(cle).libelle.toLowerCase()} : niveau <b>${fond.zoom}</b> · ${fond.tuiles} tuiles`
      + ` · <b>${(fond.duree / 1000).toFixed(1)} s</b>`);
  }
  $('relief-stats').hidden = false;
  $('relief-stats').innerHTML = lignes.join('<br>');
}

/**
 * Le contraste ne relance aucun calcul : seul l'intervalle étalé sur la palette
 * change, et la vue se contente de redessiner. Sur le Sky-View Factor, refaire
 * le calcul à chaque cran coûterait des secondes par mouvement du curseur.
 */
$('lisser-2d').addEventListener('change', (e) => vue2d.definirLissage(e.target.checked));
$('contraste-relief').addEventListener('input', (e) => {
  contrasteRelief = Number(e.target.value);
  $('val-contraste').textContent = `×${contrasteRelief.toFixed(1)}`;
  vue2d.definirContraste(contrasteRelief);
  majStats2D();
  // Le contraste ne recalcule pas la couche, il ne fait que resserrer
  // l'intervalle affiché — mais le nuage 3D lit le même intervalle, et doit donc
  // le suivre pour que les deux vues restent la même image.
  majDrapage3D();
});

// Une superposition n'a rien à superposer tant que sa détection est masquée :
// sa case est retirée avec elle, plutôt que de laisser un réglage qui ne fait
// visiblement rien. Les deux chaînes n'étant plus masquées ensemble, chacune
// suit désormais son propre drapeau.
$('relief-detections').closest('label').hidden = ANALYSE_MASQUEE;
$('relief-sentiers').closest('label').hidden = SENTIERS_MASQUES;
$('relief-detections').addEventListener('change', (e) =>
  vue2d.definirCalques({ detections: e.target.checked }));
$('relief-sentiers').addEventListener('change', (e) =>
  vue2d.definirCalques({ sentiers: e.target.checked }));
$('btn-relief-cadrer').addEventListener('click', () => vue2d.cadrer());

// ── Le rideau ───────────────────────────────────────────────────────────────
//
// Il se **glisse**, et ne se pose pas au clic. La question s'est posée — poser
// le rideau au clic éviterait d'avoir à viser la poignée — mais le clic est déjà
// pris : il sélectionne une détection, et un clic qui téléporte la ligne de
// comparaison au milieu d'un déplacement désoriente plus qu'il n'aide. La bande
// sensible fait 22 px de large sur toute la hauteur, ce qui règle le problème
// qu'on voulait résoudre : on n'a jamais à viser la poignée.

function placerRideau(part) {
  const p = Math.max(0, Math.min(1, part));
  vue2d.definirRideau(p);
  $('rideau').style.left = `${p * 100}%`;
}

brancherRideau($('rideau'), $('vue-2d'), placerRideau);


// ── Volets d'analyse ────────────────────────────────────────────────────────

/**
 * Bascule entre les deux chaînes de détection.
 *
 * Les deux vivent dans la même section : seuils, bouton, statistiques et liste
 * d'une chaîne restent ensemble. Réparties sur quatre sections, elles
 * obligeaient à faire l'aller-retour entre les réglages d'en haut et les
 * résultats d'en bas, pour deux traitements qui n'ont rien à voir l'un avec
 * l'autre.
 */
function montrerVolet(nom) {
  // Les structures restent masquées quel que soit l'appelant : sans ce garde,
  // un appel resté câblé sur 'structures' (sélection d'une détection, par
  // exemple) rouvrirait un volet que `ANALYSE_MASQUEE` est censé fermer.
  if (ANALYSE_MASQUEE && nom === 'structures') nom = 'sentiers';
  for (const b of $('volets').children) b.classList.toggle('actif', b.dataset.volet === nom);
  for (const v of document.querySelectorAll('#section-analyse .volet')) {
    v.hidden = v.dataset.volet !== nom;
  }
}

$('volets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) montrerVolet(b.dataset.volet);
});

// Un commutateur à deux options n'a de sens que si les deux mènent quelque
// part : structures masquée, il ne reste qu'un choix, donc plus de choix du
// tout. On force le volet initial en conséquence.
$('volets').hidden = ANALYSE_MASQUEE;
montrerVolet(ANALYSE_MASQUEE ? 'sentiers' : 'structures');

// ── Affichage du nuage ──────────────────────────────────────────────────────

$('coloration').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  for (const autre of $('coloration').children) autre.classList.toggle('actif', autre === b);
  CONFIG.rendu.coloration = b.dataset.mode;
  majLien();   // la couleur du nuage est dans le lien
  majLegende();
  await majAttributNuage();
  vue3d?.invalider();
});

/**
 * Recharge l'attribut par point que le mode courant consomme.
 *
 * Les modes « hauteur » et « relief » partagent le même attribut de sommet :
 * l'un y met la hauteur au-dessus du sol, l'autre la valeur de la couche de
 * relief. Un second attribut coûterait 18 Mo de mémoire graphique sur une dalle
 * pour une donnée dont on n'a jamais besoin des deux à la fois — on réécrit donc
 * le même tampon au changement de mode.
 *
 * Passer en relief prépare la grille et calcule la couche si besoin : on ne va
 * pas demander à l'utilisateur d'aller d'abord dans l'onglet 2D pour que le
 * bouton d'à côté fonctionne. La couche drapée est celle du côté droit du
 * rideau, ou la gauche si la droite porte la photo.
 */
async function majAttributNuage() {
  if (MODE_VUE) { await majAttributVue?.(); return; }
  if (!vue3d || !etat.nuage || !etat.grille) return;

  if (CONFIG.rendu.coloration === 'relief') {
    await preparer2D();
    if (!coucheDeReference()) return;
    majDrapage3D();
  } else if (CONFIG.rendu.coloration === 'hauteur') {
    vue3d?.definirHauteurs(RASTER.hauteurParPoint(etat.nuage, etat.grille));
  }
}

$('taille-point').addEventListener('input', (e) => {
  CONFIG.rendu.taillePoint = Number(e.target.value);
  $('val-taille').textContent = CONFIG.rendu.taillePoint.toFixed(1);
  vue3d?.invalider();
});

$('exag').addEventListener('input', (e) => {
  CONFIG.rendu.exagerationZ = Number(e.target.value);
  $('val-exag').textContent = `×${CONFIG.rendu.exagerationZ.toFixed(1)}`;
  vue3d?.invalider();
});

// Classes masquées à l'affichage. Persiste d'un nuage à l'autre : on ne veut
// pas rétablir la végétation à chaque dalle quand on l'a écartée une fois.
const classesMasquees = new Set();

const NOMS_CLASSES = {
  1: 'non classé', 2: 'sol', 3: 'végét. basse', 4: 'végét. moyenne',
  5: 'végét. haute', 6: 'bâtiment', 9: 'eau', 17: 'pont',
  64: 'sursol pérenne', 66: 'point virtuel', 67: 'divers',
};

/**
 * Légende et filtre des classifications — c'est le même contrôle.
 *
 * Chaque entrée est cliquable : elle dit ce que la couleur signifie et ce que
 * la vue montre. Deux listes séparées obligeraient à faire l'aller-retour entre
 * elles pour savoir ce qui est masqué.
 *
 * Seules les classes réellement présentes sont listées : en afficher onze
 * laisserait croire à une richesse que la dalle n'a pas.
 */
function majLegende() {
  const l = $('legende');
  if (!etat.nuage) { l.innerHTML = ''; majExportPoints(); return; }

  const echelle = {
    hauteur: 'Sombre = sol · jaune = 1–3 m · rouge = &gt; 5 m',
    relief: 'La couche de l’onglet Relief, plaquée sur les points',
    elevation: 'Bleu = point bas · blanc = point haut de la dalle',
    intensite: 'Réflectance brute du laser, normalisée sur 16 bits',
  }[CONFIG.rendu.coloration];

  const presentes = [...etat.nuage.parClasse.entries()].sort((a, b) => b[1] - a[1]);
  l.innerHTML =
    (echelle ? `<div class="echelle">${echelle}</div>` : '')
    + '<div class="titre-filtre">Classes affichées</div>'
    + presentes.map(([cls, n]) => {
      const couleur = CONFIG.rendu.couleursClasse[cls] || CONFIG.rendu.couleurClasseDefaut;
      const part = (100 * n / etat.nuage.n).toFixed(1);
      const off = classesMasquees.has(cls) ? ' off' : '';
      return `<button class="cls${off}" data-cls="${cls}" title="Afficher ou masquer">`
        + `<i style="background:${couleur}"></i>${NOMS_CLASSES[cls] || `classe ${cls}`}`
        + `<b>${part} %</b></button>`;
    }).join('');
  majExportPoints();
}

/**
 * Export des points de la 3D : le bouton ouvre une fenêtre (`#dlg-export`) où
 * l'on choisit le format. LAS : tous les points, la classe est dans le fichier.
 * PLY : les classes cochées dans la fenêtre — toutes au départ, et sans lien
 * avec les cases de la légende. La logique (quoi écrire, bouton actif ou non)
 * est dans `SORTIE.resumerExport` / `exporterPoints`, testée sans navigateur.
 */
const exportExclues = new Set();

function majExportPoints() {
  $('export-points').hidden = !etat.nuage;
  if (!etat.nuage && $('dlg-export').open) $('dlg-export').close();
}

function formatExport() {
  return document.querySelector('input[name="fmt-export"]:checked')?.value || null;
}

function majFenetreExport() {
  const format = formatExport();
  $('exp-classes').hidden = format !== 'ply';
  const r = SORTIE.resumerExport(etat.nuage, format, exportExclues);
  $('exp-telecharger').disabled = !r.actif;
  $('exp-info').textContent = r.actif ? `${milliers(r.n)} points, ~${octets(r.octets)}.` : r.message;
}

function listerClassesExport() {
  const presentes = [...etat.nuage.parClasse.entries()].sort((a, b) => b[1] - a[1]);
  $('exp-liste-classes').innerHTML = presentes.map(([cls, n]) => {
    const couleur = CONFIG.rendu.couleursClasse[cls] || CONFIG.rendu.couleurClasseDefaut;
    return `<label class="case"><input type="checkbox" data-cls="${cls}" checked>`
      + `<i style="background:${couleur};width:11px;height:11px;border-radius:2px;flex:none"></i>`
      + `<span>${NOMS_CLASSES[cls] || `classe ${cls}`} <small>${milliers(n)} points</small></span></label>`;
  }).join('');
}

$('exp-ouvrir').addEventListener('click', () => {
  if (!etat.nuage) return;
  exportExclues.clear();          // toutes les classes cochées, à chaque ouverture
  for (const r of document.querySelectorAll('input[name="fmt-export"]')) r.checked = false;
  listerClassesExport();
  majFenetreExport();
  $('dlg-export').showModal();
});
$('exp-fermer').addEventListener('click', () => $('dlg-export').close());
$('dlg-export').addEventListener('change', (e) => {
  const c = e.target.closest('input[data-cls]');
  if (c) {
    const cls = Number(c.dataset.cls);
    if (c.checked) exportExclues.delete(cls); else exportExclues.add(cls);
  }
  majFenetreExport();
});
$('exp-telecharger').addEventListener('click', () => {
  const format = formatExport();
  if (!etat.nuage || !format) return;
  const f = SORTIE.exporterPoints(etat.nuage, format, exportExclues);
  SORTIE.telecharger(f.nom, new Blob(f.parties), 'application/octet-stream');
  $('dlg-export').close();
});

$('legende').addEventListener('click', (e) => {
  const b = e.target.closest('button.cls');
  if (!b) return;
  const cls = Number(b.dataset.cls);
  if (classesMasquees.has(cls)) classesMasquees.delete(cls); else classesMasquees.add(cls);
  b.classList.toggle('off', classesMasquees.has(cls));
  vue3d?.definirClassesMasquees(classesMasquees);
  majLien();   // les classes cachées sont dans le lien
});

// ── Classes du sol ────────────────────────────────────────────────────────
//
// Quelles classes ASPRS forment le sol (`RASTER.accumuler`, `g.solZ`) : sol +
// eau par défaut (`CONFIG.raster.classesSolDefaut`), réglable une fois la
// dalle chargée et ses classes connues — on ne les sait pas avant, un LAS
// n'annonce pas d'avance ce qu'il contient. Persiste d'un nuage à l'autre,
// comme `classesMasquees`.
//
// Redéfinir le sol change la surface elle-même — mnt, donc les couches de
// relief ET le point visé au clic en 2D (`Vue2D.lire`) — jamais un simple
// filtre d'affichage. D'où le bouton « Mettre à jour » plutôt qu'un recalcul
// au clic sur une case : les points bruts ne sont pas gardés (voir
// `RASTER.creerGrilles`), la seule façon de refaire `solZ` avec une autre
// sélection est de retélécharger la dalle — `chargerNuage()` déjà écrit pour
// « Charger le nuage » fait exactement ça.
let classesSol = new Set(CONFIG.raster.classesSolDefaut);

function majListeClassesSol() {
  const l = $('liste-classes-sol');
  if (!etat.nuage) { l.innerHTML = ''; majBoutonClassesSol(); return; }

  const presentes = [...etat.nuage.parClasse.entries()].sort((a, b) => b[1] - a[1]);
  l.innerHTML = presentes.map(([cls, n]) => {
    const part = (100 * n / etat.nuage.n).toFixed(1);
    const coche = classesSol.has(cls) ? ' checked' : '';
    return `<label class="case">`
      + `<input type="checkbox" data-cls="${cls}"${coche}>`
      + `<span>${NOMS_CLASSES[cls] || `classe ${cls}`} <b>${part} %</b></span></label>`;
  }).join('');
  majBoutonClassesSol();
}

/**
 * « Mettre à jour » n'a de raison d'être actif que si la sélection courante
 * diffère de celle qui a servi à bâtir la grille en mémoire (`memeEnsemble`),
 * et jamais pendant qu'un chargement tourne déjà (`btn-charger` porte ce
 * second état, réutilisé plutôt que dupliqué). Appelée aussi bien après un
 * chargement réussi qu'après un échec — sans quoi un rechargement raté
 * laisserait le bouton bloqué à « désactivé » pour toujours.
 */
function majBoutonClassesSol() {
  const memeEnsemble = etat.classesSolChargees
    && classesSol.size === etat.classesSolChargees.size
    && [...classesSol].every((c) => etat.classesSolChargees.has(c));
  $('btn-classes-sol-appliquer').disabled = !etat.nuage || $('btn-charger').disabled || memeEnsemble;
}

$('liste-classes-sol').addEventListener('change', (e) => {
  const cb = e.target.closest('input[data-cls]');
  if (!cb) return;
  const cls = Number(cb.dataset.cls);
  if (cb.checked) classesSol.add(cls); else classesSol.delete(cls);
  majBoutonClassesSol();
});

$('btn-classes-sol-appliquer').addEventListener('click', chargerNuage);

function majHUD() {
  if (!etat.nuage) { $('hud').textContent = ''; return; }
  const e = etat.nuage.emprise;
  $('hud').innerHTML = `${milliers(etat.nuage.n)} points · ${Math.round(e.xmax - e.xmin)} × ${Math.round(e.ymax - e.ymin)} m<br>`
    + `altitudes ${(etat.nuage.origine[2] + etat.nuage.zmin).toFixed(0)} – ${(etat.nuage.origine[2] + etat.nuage.zmax).toFixed(0)} m`
    + (etat.grille ? ` · grille ${etat.grille.pas.toFixed(2)} m` : '')
    // Avec &debug ou &chrono : la part dessinée pendant le dernier geste.
    + (DIAGNOSTIC && vue3d?.dernierMouvement
      ? `<br>en mouvement : ${milliers(vue3d.dernierMouvement.dessines)} points`
        + ` (${Math.round((100 * vue3d.dernierMouvement.dessines) / vue3d.dernierMouvement.total)} %)` : '');
}

// ── Étape 3 : détection ─────────────────────────────────────────────────────

const REGLAGES = [
  { cle: 'hauteurMin', libelle: 'Hauteur min.', min: 0.1, max: 2, pas: 0.05, unite: ' m' },
  { cle: 'hauteurMax', libelle: 'Hauteur max.', min: 1, max: 15, pas: 0.5, unite: ' m' },
  { cle: 'surfaceMinM2', libelle: 'Surface min.', min: 1, max: 30, pas: 1, unite: ' m²' },
  { cle: 'surfaceMaxM2', libelle: 'Surface max.', min: 20, max: 400, pas: 10, unite: ' m²' },
  { cle: 'penteMaxDeg', libelle: 'Pente moy. max.', min: 5, max: 45, pas: 1, unite: '°' },
  { cle: 'penteLocaleMaxDeg', libelle: 'Pente locale max.', min: 20, max: 89, pas: 1, unite: '°' },
  { cle: 'partNonClasseMin', libelle: 'Part « non classé » min.', min: 0, max: 0.9, pas: 0.05, unite: '' },
  { cle: 'rectangulariteMin', libelle: 'Rectangularité min.', min: 0.2, max: 0.95, pas: 0.05, unite: '' },
  { cle: 'elongationMax', libelle: 'Élongation max.', min: 1.5, max: 10, pas: 0.5, unite: '' },
];

const reglages = { ...CONFIG.detection };

function construireReglages() {
  $('reglages').innerHTML = REGLAGES.map((r) => `
    <label class="champ">
      <span>${r.libelle} <b id="v-${r.cle}">${reglages[r.cle]}${r.unite}</b></span>
      <input type="range" id="r-${r.cle}" min="${r.min}" max="${r.max}" step="${r.pas}" value="${reglages[r.cle]}">
    </label>`).join('');

  for (const r of REGLAGES) {
    $(`r-${r.cle}`).addEventListener('input', (e) => {
      reglages[r.cle] = Number(e.target.value);
      $(`v-${r.cle}`).textContent = `${reglages[r.cle]}${r.unite}`;
    });
  }
}
construireReglages();

$('inclure-bati').addEventListener('change', (e) => {
  reglages.inclureBati = e.target.checked;
  // La couche « hauteur des structures » lit le même signal : sa grille est
  // périmée, on la refera au prochain passage sur l'onglet 2D — et tout ce qui
  // en dérive est périmé avec elle. La photo, non : elle ne dépend pas du sol.
  etat.reliefGrille = null;
  viderCouches2D();
  if ($('panneau').dataset.vue === '2d') preparer2D();
});

$('btn-defauts').addEventListener('click', () => {
  Object.assign(reglages, CONFIG.detection);
  construireReglages();
  $('inclure-bati').checked = reglages.inclureBati;
});

$('btn-detecter').addEventListener('click', async () => {
  if (!etat.grille) return;
  $('btn-detecter').disabled = true;
  montrerVolet('structures');

  try {
    const { erreur } = await ATTENTE.pendant('Détection de structures', async (etape) => {
      etat.resultat = DETECTION.detecter(etat.grille, reglages);

      if ($('voie-forme').checked) {
        await etape('Recherche par la forme du relief…', 'ouverture, fermeture des lignes');
        etat.resultatFormes = detecterParLaForme();
      } else {
        etat.resultatFormes = null;
      }

      await etape('Rapprochement avec la BD TOPO…', 'bâti connu, interrogé en direct');
      return SORTIE.rapprocher(etat.resultat.candidats, etat.dalleChargee.emprise);
    }, 'morphologie et filtres de forme');
    if (erreur) alerter(`BD TOPO indisponible (${erreur}) — aucun rapprochement effectué.`);

    afficherResultats();

    const s = etat.resultat.stats;
    const f = etat.resultatFormes;
    $('stats-detection').hidden = false;
    $('stats-detection').innerHTML =
      `Grille <b>${s.pas.toFixed(2)} m</b> · <b>${milliers(s.cellulesRetenues)}</b> cellules candidates sur ${milliers(s.cellules)}<br>`
      + `<b>${s.tachesBrutes}</b> taches, <b>${s.retenus}</b> retenues<br>`
      + `écartées — surface ${s.rejets.surface} · forme ${s.rejets.forme} · élongation ${s.rejets.elongation}`
      + ` · pente ${s.rejets.pente} · composition ${s.rejets.composition} · hauteur ${s.rejets.hauteur}`
      + (f ? `<br>Par la forme — <b>${f.retenues}</b> ligne(s) fermée(s), dont <b>${f.nouvelles}</b> que le classement n’avait pas vue(s)<br>`
        + `écartées — ouvertes ${f.rejets.ouvert} · taille ${f.rejets.taille} · intérieur ouvert ${f.rejets.interieurOuvert}`
        + ` · trop plates ${f.rejets.tropPlat}` : '');

    statut(`${etat.resultat.candidats.length} structure(s) candidate(s)`);
  } catch (e) {
    alerter(`Détection : ${e.message}`);
  } finally {
    $('btn-detecter').disabled = false;
  }
});

/**
 * Voie par la forme : lignes fermées du relief, versées dans la même liste.
 *
 * Les deux voies ne voient pas les mêmes objets, et c'est tout l'intérêt. Celle
 * par classement lit un signal — des points « non classés » ou « bâtiment »
 * au-dessus du sol — et rate tout ce que le classificateur de l'IGN a rangé en
 * « sol », ce qui est le sort ordinaire d'un mur écroulé. Celle par la forme ne
 * lit que le relief et ne voit pas la différence entre une ruine et un rocher,
 * mais elle voit la ruine. On les réunit donc, en gardant la trace de qui a
 * trouvé quoi — sans quoi on ne saurait plus quel seuil régler.
 *
 * La grille de relief est à 50 cm et la détection à 25 cm : chaque cellule de
 * l'une en recouvre exactement quatre de l'autre, et c'est sur la grille fine
 * que le candidat est mesuré, pour que les deux voies rendent des fiches
 * comparables.
 */
function detecterParLaForme() {
  if (!etat.reliefGrille) {
    etat.reliefGrille = RELIEF.preparer(etat.grille, { inclureBati: reglages.inclureBati });
  }
  const rel = etat.reliefGrille;
  const r = LIGNES.extraire(rel);
  const f = Math.max(1, Math.round(rel.pas / etat.grille.pas));
  const sig = etat.resultat.signal;
  const candidats = etat.resultat.candidats;
  let nouvelles = 0;

  for (const s of r.structures) {
    // Une cellule de relief en recouvre f × f de la grille fine.
    const fines = [];
    for (const i of s.pleines) {
      const x = (i % rel.W) * f, y = ((i / rel.W) | 0) * f;
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < etat.grille.W && yy < etat.grille.H) fines.push(yy * etat.grille.W + xx);
        }
      }
    }
    if (!fines.length) continue;

    const c = DETECTION.qualifier(fines, etat.grille, sig);
    c.voie = 'forme';
    c.fermeture = s.couverture;
    c.interieur = s.interieur;
    c.hauteurMur = s.hauteurMur;
    c.score = noterForme(s);

    // Déjà trouvée par l'autre voie ? On ne la compte pas deux fois — on note
    // qu'elle a deux témoins, ce qui est le meilleur indice dont on dispose.
    const jumelle = candidats.find((x) => Math.hypot(x.x - c.x, x.y - c.y) < CONFIG.lignes.rayonMaxM);
    if (jumelle) {
      jumelle.voie = 'les deux';
      jumelle.fermeture = c.fermeture;
      jumelle.interieur = c.interieur;
      jumelle.hauteurMur = c.hauteurMur;
      jumelle.score = Math.max(jumelle.score, c.score);
      continue;
    }
    c.id = candidats.length + 1;
    candidats.push(c);
    nouvelles++;
  }

  candidats.sort((a, b) => b.score - a.score);
  candidats.forEach((c, i) => { c.rang = i + 1; });
  return { retenues: r.structures.length, nouvelles, rejets: r.rejets, chrono: r.chrono };
}

/**
 * Score d'une structure trouvée par la forme.
 *
 * Il ne peut pas être celui de `DETECTION.noter` : celui-là pèse la part de
 * points non classés et la hauteur du signal, qui valent zéro pour une ruine
 * que l'IGN a classée « sol » — la meilleure trouvaille de cette voie y
 * marquerait donc le plus mauvais score. On note ici sur les trois preuves
 * propres à la voie : la ligne se referme, l'intérieur est fermé au ciel, le mur
 * dépasse. Pondération assumée, comme l'autre, faute de jeu étiqueté.
 */
function noterForme(s) {
  const fermeture = Math.min(1, (s.couverture - CONFIG.lignes.couvertureMin)
    / (1 - CONFIG.lignes.couvertureMin));
  const enfermement = Math.min(1, (90 - s.interieur) / 25);
  const mur = Math.min(1, s.hauteurMur / 0.8);
  return Math.max(0, 0.4 * enfermement + 0.35 * fermeture + 0.25 * mur);
}

// ── Étape 3 bis : sentiers ──────────────────────────────────────────────────

const REGLAGES_SENTIERS = [
  { cle: 'longueurMinM', libelle: 'Longueur min.', min: 10, max: 200, pas: 5, unite: ' m' },
  { cle: 'profondeurMinM', libelle: 'Creux min.', min: 0.05, max: 1, pas: 0.05, unite: ' m' },
  { cle: 'profondeurMaxM', libelle: 'Creux max.', min: 0.5, max: 6, pas: 0.5, unite: ' m' },
  { cle: 'penteLongueMaxDeg', libelle: 'Pente du tracé max.', min: 5, max: 45, pas: 1, unite: '°' },
  { cle: 'alignementMax', libelle: 'Tolérance « ravine »', min: 0.3, max: 1, pas: 0.05, unite: '' },
  { cle: 'seuilHaut', libelle: 'Seuil de déclenchement', min: 0.05, max: 0.8, pas: 0.05, unite: '' },
  { cle: 'compaciteMax', libelle: 'Tolérance « pelote »', min: 1.2, max: 8, pas: 0.1, unite: '' },
];

const reglagesSentiers = { ...CONFIG.sentiers };

function construireReglagesSentiers() {
  $('reglages-sentiers').innerHTML = REGLAGES_SENTIERS.map((r) => `
    <label class="champ">
      <span>${r.libelle} <b id="vs-${r.cle}">${reglagesSentiers[r.cle]}${r.unite}</b></span>
      <input type="range" id="rs-${r.cle}" min="${r.min}" max="${r.max}" step="${r.pas}"
             value="${reglagesSentiers[r.cle]}">
    </label>`).join('');

  for (const r of REGLAGES_SENTIERS) {
    $(`rs-${r.cle}`).addEventListener('input', (e) => {
      reglagesSentiers[r.cle] = Number(e.target.value);
      $(`vs-${r.cle}`).textContent = `${reglagesSentiers[r.cle]}${r.unite}`;
    });
  }
}
construireReglagesSentiers();

$('btn-defauts-sentiers').addEventListener('click', () => {
  Object.assign(reglagesSentiers, CONFIG.sentiers);
  construireReglagesSentiers();
});

$('btn-sentiers').addEventListener('click', async () => {
  if (!etat.grille) return;
  $('btn-sentiers').disabled = true;
  montrerVolet('sentiers');

  try {
    const t0 = performance.now();
    etat.sentiers = await ATTENTE.pendant('Recherche de sentiers',
      () => SENTIERS.detecterSentiers(etat.grille, reglagesSentiers),
      'relief local, puis amincissement');
    const secondes = ((performance.now() - t0) / 1000).toFixed(1);

    const st = etat.sentiers.stats;
    $('stats-sentiers').hidden = false;
    $('stats-sentiers').innerHTML =
      `Grille <b>${st.pas.toFixed(2)} m</b> · <b>${st.chainesBrutes}</b> tracés bruts, `
      + `<b>${st.retenues}</b> retenus — ${secondes} s<br>`
      + `écartés — longueur ${st.rejets.longueur} · pelote ${st.rejets.pelote}`
      + ` · ravine ${st.rejets.ravine} · pente ${st.rejets.penteLongue}`
      + ` · profondeur ${st.rejets.profondeur}`;

    afficherSentiers();
    statut(`${etat.sentiers.traces.length} sentier(s) candidat(s)`);

    $('diag-sentiers').hidden = false;
    dessinerDiagnosticSentiers();
  } catch (e) {
    alerter(`Sentiers : ${e.message}`);
  } finally {
    $('btn-sentiers').disabled = false;
  }
});

$('diag-sentiers-couche').addEventListener('change', dessinerDiagnosticSentiers);

/**
 * Diagnostic (#2 du todo) : affiche telle quelle une étape interne de
 * `SENTIERS.detecterSentiers`, jamais visible autrement puisque seul le
 * résultat final (`squelette` vectorisé) sort de la chaîne. Sans vérité
 * terrain, c'est le seul moyen de voir où un tracé repéré à l'œil disparaît.
 *
 * Étirement min/max simple, propre à chaque couche : le but est de voir la
 * structure du signal, pas de comparer des amplitudes d'une couche à l'autre.
 *
 * La grille des sentiers suit la même convention que `RASTER` — ligne 0 au
 * sud — alors qu'un canevas peint sa ligne 0 en haut. Le piège est documenté
 * pour la photo aérienne (voir CLAUDE.md) et reproduit ici à l'identique
 * faute d'inverser : nord en haut, comme partout ailleurs dans l'outil.
 */
function dessinerDiagnosticSentiers() {
  const t = etat.sentiers?.carte;
  if (!t) return;
  const valeurs = t[$('diag-sentiers-couche').value];
  const { W, H } = t;

  const canvas = $('diag-sentiers-canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);

  let min = Infinity, max = -Infinity;
  for (let i = 0; i < valeurs.length; i++) {
    const v = valeurs[i];
    if (Number.isFinite(v) && v < min) min = v;
    if (Number.isFinite(v) && v > max) max = v;
  }
  const etendue = (max - min) || 1;

  for (let cy = 0; cy < H; cy++) {
    const sy = H - 1 - cy; // ligne 0 de `t` = sud, ligne 0 du canevas = haut
    for (let cx = 0; cx < W; cx++) {
      const v = valeurs[sy * W + cx];
      const g = Number.isFinite(v) ? Math.round(255 * (v - min) / etendue) : 0;
      const o = (cy * W + cx) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = g;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function afficherSentiers() {
  const traces = etat.sentiers?.traces || [];
  $('compte-sentiers').textContent = traces.length;
  $('exports-sentiers').hidden = !traces.length;

  const liste = $('liste-sentiers');
  liste.innerHTML = traces.length ? '' :
    '<li class="vide" style="cursor:default;border-style:dashed">Aucun tracé avec ces seuils. '
    + 'Baissez le seuil de déclenchement ou la longueur minimale.</li>';

  for (const s of traces) {
    const l = SORTIE.liens(s);
    const li = document.createElement('li');
    li.dataset.id = s.id;
    li.innerHTML = `
      <div class="ligne-titre">
        <span class="rang">#${s.rang}</span>
        <span class="score">${s.score.toFixed(2)}</span>
        <span class="puce" style="background:${s.score > 0.6 ? '#ff8a3c' : s.score > 0.4 ? '#ffc247' : '#ffe9a3'}"></span>
      </div>
      <div class="mesures">${s.longueur.toFixed(0)} m · creux ${(s.profondeurMed * 100).toFixed(0)} cm
        · large ${s.largeurMed.toFixed(1)} m · pente ${s.penteLongueMed.toFixed(0)}°
        · ravine ${s.alignementPente.toFixed(2)} · pelote ${s.compacite.toFixed(1)}
        · croise ${s.autocroisements}</div>
      <div class="coords">${l.dms} · ${s.altitude.toFixed(0)} m</div>
      <div class="actions">
        <a href="${l.earth}" target="_blank" rel="noopener">Google&nbsp;Earth</a>
        <a href="${l.geoportail}" target="_blank" rel="noopener">Géoportail</a>
      </div>`;
    li.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;
      choisirSentier(s, true);
    });
    liste.appendChild(li);
  }

  carte.afficherSentiers(traces, (s) => choisirSentier(s, false));
  vue2d.definirTraces(traces);
  vue3d?.definirSentiers(traces, etat.grille);
  vue3d?.definirSentierChoisi(null, etat.grille);
}

/**
 * Sélectionne un tracé dans les deux vues à la fois.
 *
 * On ne bascule pas d'office : depuis la carte on veut rester sur la carte,
 * depuis la liste on veut voir le relief. Mais les deux vues restent
 * synchronisées, si bien qu'un `v` suffit ensuite à passer de l'une à l'autre
 * sans rien reperdre.
 */
function choisirSentier(s, versLa3D) {
  const traces = etat.sentiers?.traces || [];
  montrerVolet('sentiers');
  for (const li of $('liste-sentiers').children) {
    li.classList?.toggle('actif', li.dataset.id === String(s.id));
  }
  document.querySelector(`#liste-sentiers li[data-id="${s.id}"]`)?.scrollIntoView({ block: 'nearest' });

  carte.surlignerSentier(s, traces);
  vue2d.definirTraceChoisie(s);
  vue3d?.definirSentierChoisi(s, etat.grille);
  vue3d?.viserTrace(s, etat.grille);
  if (versLa3D) basculerVue('3d');
}

$('exp-sent-gpx').addEventListener('click', () => SORTIE.telecharger(
  `${NOM_BASE()}_sentiers.gpx`, SORTIE.tracesVersGPX(etat.sentiers?.traces || []), 'application/gpx+xml'));
$('exp-sent-geojson').addEventListener('click', () => SORTIE.telecharger(
  `${NOM_BASE()}_sentiers.geojson`, SORTIE.tracesVersGeoJSON(etat.sentiers?.traces || [], META()),
  'application/geo+json'));

// ── Étape 4 : résultats ─────────────────────────────────────────────────────

function candidatsVisibles() {
  const tous = etat.resultat?.candidats || [];
  return $('masquer-repertories').checked ? tous.filter((c) => !c.dejaRepertorie) : tous;
}

function afficherResultats() {
  const visibles = candidatsVisibles();
  $('bloc-resultats').hidden = false;
  $('compte').textContent = visibles.length;

  const liste = $('liste');
  liste.innerHTML = '';

  if (!visibles.length) {
    liste.innerHTML = '<li class="vide" style="cursor:default;border-style:dashed">Rien à cet endroit avec ces seuils. '
      + 'Élargissez la surface ou baissez la rectangularité.</li>';
  }

  for (const c of visibles) {
    const l = SORTIE.liens(c);
    const couleur = c.dejaRepertorie ? '#7d8794'
      : c.score > 0.65 ? '#ff5a3c' : c.score > 0.45 ? '#ffa62b' : '#ffe066';

    const li = document.createElement('li');
    li.className = c.dejaRepertorie ? 'repertorie' : '';
    li.dataset.id = c.id;
    li.innerHTML = `
      <div class="ligne-titre">
        <span class="rang">#${c.rang}</span>
        <span class="score">${c.score.toFixed(2)}</span>
        ${c.voie && c.voie !== 'classement' ? `<span class="marque voie">${c.voie === 'les deux' ? 'les deux voies' : 'forme du relief'}</span>` : ''}
        ${c.dejaRepertorie ? `<span class="marque">BD TOPO · ${echapper(c.batimentProche)}</span>` : ''}
        <span class="puce" style="background:${couleur}"></span>
      </div>
      <div class="mesures">${c.surface.toFixed(0)} m² · ${c.longueur.toFixed(1)} × ${c.largeur.toFixed(1)} m
        · h ${c.hauteurMoy.toFixed(1)} m · rect. ${c.rectangularite.toFixed(2)} · pente ${c.penteMoy.toFixed(0)}°</div>
      ${c.fermeture !== undefined ? `<div class="mesures">mur fermé à ${(c.fermeture * 100).toFixed(0)} %
        · intérieur ${(90 - c.interieur).toFixed(0)}° sous le ciel ouvert · mur ${(c.hauteurMur * 100).toFixed(0)} cm</div>` : ''}
      <div class="coords">${l.dms} · ${c.altitude.toFixed(0)} m</div>
      <div class="actions">
        <a href="${l.earth}" target="_blank" rel="noopener">Google&nbsp;Earth</a>
        <a href="${l.maps}" target="_blank" rel="noopener">Maps</a>
        <a href="${l.geoportail}" target="_blank" rel="noopener">Géoportail</a>
      </div>`;
    li.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') return;   // les liens gardent leur comportement
      selectionner_(c);
    });
    liste.appendChild(li);
  }

  carte.afficherDetections(visibles, selectionner_);
  vue3d?.definirDetections(visibles, etat.grille);
  vue2d.definirDetections(visibles, etat.grille);
  selectionner_(null);
}

function selectionner_(c) {
  etat.selection = c;
  if (c) montrerVolet('structures');
  for (const li of $('liste').children) {
    li.classList?.toggle('actif', c && li.dataset.id === String(c.id));
  }
  carte.surlignerDetection(c, candidatsVisibles());
  vue2d.definirSelection(c);

  if (c) {
    vue3d?.viser(c);
    vue2d.viser(c.x, c.y, Math.max(80, Math.sqrt(c.surface) * 12));
    vue3d?.definirSelection(c, etat.grille);
    document.querySelector(`#liste li[data-id="${c.id}"]`)?.scrollIntoView({ block: 'nearest' });
  } else {
    vue3d?.effacerFocus();
    vue3d?.definirSelection(null, etat.grille);
  }
}

$('masquer-repertories').addEventListener('change', afficherResultats);

const NOM_BASE = () => `scopus_${etat.dalleChargee?.nom || 'zone'}`;
const META = () => ({
  dalle: etat.dalleChargee?.nom,
  emprise_lambert93: etat.dalleChargee?.emprise,
  pas_grille_m: etat.grille?.pas,
  seuils: reglages,
});

$('exp-gpx').addEventListener('click', () =>
  SORTIE.telecharger(`${NOM_BASE()}.gpx`, SORTIE.versGPX(candidatsVisibles()), 'application/gpx+xml'));
$('exp-geojson').addEventListener('click', () =>
  SORTIE.telecharger(`${NOM_BASE()}.geojson`, SORTIE.versGeoJSON(candidatsVisibles(), META()), 'application/geo+json'));
$('exp-csv').addEventListener('click', () =>
  SORTIE.telecharger(`${NOM_BASE()}.csv`, SORTIE.versCSV(candidatsVisibles()), 'text/csv'));

// ── Onglets ─────────────────────────────────────────────────────────────────

const VUES = [
  ['carte', 'vue-carte', 'onglet-carte',
    'Cliquez pour choisir une dalle · vert : dalle chargée · jaune : sélection'],
  ['2d', 'vue-2d', 'onglet-2d',
    'Glisser la poignée du milieu pour comparer · glisser l’image : déplacer · molette : zoom sous le curseur'],
  ['3d', 'vue-3d', 'onglet-3d',
    'Glisser : déplacer · molette : zoom sous le curseur · Maj+glisser : pivoter · double-clic : recentrer le pivot'],
];
// Sur écran tactile, l'aide parle des doigts : « molette » et « Maj » n'y
// existent pas. (Sous 600 px, l'aide est masquée — styles.css.)
const TACTILE = window.matchMedia?.('(pointer: coarse)').matches;
const AIDE_TACTILE = {
  '3d': 'Un doigt : déplacer · pincer : zoomer · deux doigts : pivoter',
};

function basculerVue(quoi) {
  // Un onglet désactivé ne se visite pas : sans WebGL2, la 3D n'a qu'un canevas
  // noir à montrer, et les raccourcis clavier y mèneraient quand même.
  if ($(`onglet-${quoi}`)?.disabled) return;

  // Le panneau suit : les sections marquées `data-vue` s'affichent ou non selon
  // l'onglet, sans que rien d'autre n'ait à le savoir.
  $('panneau').dataset.vue = quoi;
  for (const [nom, vue, onglet, aide] of VUES) {
    $(vue).hidden = nom !== quoi;
    $(onglet).classList.toggle('actif', nom === quoi);
    if (nom === quoi) $('aide-vue').textContent = (TACTILE && AIDE_TACTILE[nom]) || aide;
  }
  // Le mode sélection n'a de sens qu'en 2D et en 3D — « cliquer un point » sur
  // la carte n'en est pas un.
  // En mode vue, la carte porte le relief : sélection et mesure s'y font.
  $('barre-mode').hidden = quoi === 'carte' && !MODE_VUE;
  // Le profil se pose sur la carte : en 3D le bouton est grisé, et le mode
  // quitté s'il était actif.
  $('mode-profil').disabled = quoi !== 'carte';
  if (quoi !== 'carte' && vue2d.mode === 'profil') { definirModeInteraction('deplacement', true); profilAReprendre = true; }
  // Retour sur la carte : le mode Profil revient, avec sa fenêtre, si rien d'autre n'a été choisi entre-temps.
  if (quoi === 'carte' && profilAReprendre && vue2d.mode === 'deplacement') definirModeInteraction('profil', true);
  if (quoi === 'carte') profilAReprendre = false;

  // Leaflet mesure son conteneur à l'initialisation ; masqué, il l'a mesuré à
  // zéro et n'affiche aucune tuile tant qu'on ne le lui redit pas.
  if (quoi === 'carte') { requestAnimationFrame(() => carte.invalider()); surPassageCarte?.(); }
  else if (quoi === '3d') { vue3d?.invalider(); surPassage3D?.(); }
  else preparer2D();
  majLien();   // le lien décrit l'onglet affiché
}

$('onglet-carte').addEventListener('click', () => basculerVue('carte'));
$('onglet-2d').addEventListener('click', () => basculerVue('2d'));
$('onglet-3d').addEventListener('click', () => basculerVue('3d'));

// ── Le panneau sous 900 px ──────────────────────────────────────────────────
// Sous 600 px, une feuille tirée du bas à trois hauteurs (`data-feuille`) ;
// de 600 à 900 px, un panneau latéral replié par une languette (`.replie`).
// La forme est dans styles.css : au-delà de 900 px, rien de ceci n'a d'effet
// visible. Non modal dans les deux cas — la carte reste utilisable.

const HAUTEURS_FEUILLE = ['replie', 'mi', 'plein'];
/** Hauteur en pixels de chaque état, pour aimanter la feuille lâchée. */
function hauteursFeuille() {
  const repliee = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--feuille-repliee')) || 136;
  return { replie: repliee, mi: window.innerHeight * 0.5, plein: window.innerHeight - 46 };
}
function poserFeuille(etat) {
  const p = $('panneau');
  p.dataset.feuille = etat;
  p.style.height = '';
  // Repliée, elle montre le haut de la section principale, pas un milieu.
  if (etat === 'replie') p.scrollTop = 0;
  $('poignee-panneau').setAttribute('aria-expanded', String(etat !== 'replie'));
}
function feuilleSuivante() {
  const i = HAUTEURS_FEUILLE.indexOf($('panneau').dataset.feuille);
  poserFeuille(HAUTEURS_FEUILLE[(i + 1) % HAUTEURS_FEUILLE.length]);
}
{
  // Tirer la poignée suit le doigt ; lâchée, la feuille va à la hauteur la
  // plus proche. Un appui sans glisser passe à la hauteur suivante.
  const poignee = $('poignee-panneau');
  let tire = null;
  poignee.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tire = { y: e.clientY, h: $('panneau').getBoundingClientRect().height, bouge: false };
    $('panneau').classList.add('tiree');
    try { poignee.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
  });
  poignee.addEventListener('pointermove', (e) => {
    if (!tire) return;
    const dy = tire.y - e.clientY;
    if (Math.abs(dy) > 6) tire.bouge = true;
    if (tire.bouge) {
      const h = hauteursFeuille();
      $('panneau').style.height = `${Math.max(h.replie * 0.6, Math.min(h.plein, tire.h + dy))}px`;
    }
  });
  const lacher = () => {
    if (!tire) return;
    $('panneau').classList.remove('tiree');
    if (!tire.bouge) { tire = null; feuilleSuivante(); return; }
    const actuelle = $('panneau').getBoundingClientRect().height;
    const h = hauteursFeuille();
    const proche = HAUTEURS_FEUILLE.reduce((a, b) => (Math.abs(h[b] - actuelle) < Math.abs(h[a] - actuelle) ? b : a));
    tire = null;
    poserFeuille(proche);
  };
  poignee.addEventListener('pointerup', lacher);
  poignee.addEventListener('pointercancel', lacher);
  poignee.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); feuilleSuivante(); }
  });
}
function replierLateral(replie) {
  $('panneau').classList.toggle('replie', replie);
  const l = $('languette-panneau');
  l.textContent = replie ? '▶' : '◀';
  l.setAttribute('aria-expanded', String(!replie));
  l.setAttribute('aria-label', replie ? 'Déplier le panneau' : 'Replier le panneau');
}
$('languette-panneau').addEventListener('click', () => replierLateral(!$('panneau').classList.contains('replie')));
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if ($('dlg-profil').open || $('dlg-aide-profil').open) return;   // Échap ferme la fenêtre, pas le panneau
  poserFeuille('replie');
  replierLateral(true);
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (!$('accueil').hidden) return;   // l'accueil couvre tout : rien à piloter dessous
  if ($('dlg-profil').open || $('dlg-aide-profil').open) return;   // la modale du profil, et son aide, couvrent tout aussi
  // Un chiffre par vue, plus les initiales d'avant : 'r' pour le relief est
  // devenu la 2D, et le désapprendre n'apporterait rien.
  if (e.key === 'c' || e.key === '1') basculerVue('carte');
  if (e.key === 'r' || e.key === '2') basculerVue('2d');
  if (e.key === 'v' || e.key === '3') basculerVue('3d');
  if (e.key === 'f') { if ($('panneau').dataset.vue === '2d') vue2d.cadrer(); else vue3d?.cadrer(); }
  if (e.key === 't') { vue3d?.vueDeDessus(); basculerVue('3d'); }
});

$('btn-dessus').addEventListener('click', () => { vue3d?.vueDeDessus(); basculerVue('3d'); });
$('btn-cadrer').addEventListener('click', () => { vue3d?.cadrer(); basculerVue('3d'); });

// ── Page d'accueil ──────────────────────────────────────────────────────────
//
// Sans elle, qui ouvre Scopus tombe sur une carte de France et doit deviner où
// cliquer : tout le reste de l'outil devient inatteignable. Elle ne pose qu'une
// question — voir un exemple, ou entrer avec ses propres coordonnées — et
// s'efface au premier des deux gestes, définitivement.

function masquerAccueil() {
  $('accueil').hidden = true;
}

// Un `mailto:` suppose un client de bureau configuré — de moins en moins
// vrai, la plupart ne lisant leur courrier que dans le navigateur, où cliquer
// le lien ne fait alors rien de visible. Copier l'adresse marche partout,
// même repli sur `prompt()` que le lien partageable (`copierLien`) si le
// presse-papiers refuse. Reconstruite plutôt qu'écrite en clair dans le HTML :
// freine les moissonneurs de spam les plus bêtes, sans prétendre à une vraie
// protection.
$('lien-contact').addEventListener('click', async (e) => {
  e.preventDefault();
  const adresse = `${'jules.rumeau1'}@${'gmail.com'}`;
  try {
    await navigator.clipboard.writeText(adresse);
  } catch {
    prompt('Copiez cette adresse :', adresse);
    return;
  }
  const lien = e.target;
  const texteAvant = lien.textContent;
  lien.textContent = 'Adresse copiée !';
  setTimeout(() => { lien.textContent = texteAvant; }, 2000);
});

function entrerDansLaCarte() {
  masquerAccueil();
  basculerVue('carte');
  // « J'ai déjà des coordonnées » : le champ les accepte telles quelles
  // (« 42.74, 1.68 »), autant y poser le curseur plutôt que de le faire viser.
  $('recherche').focus();
}

/**
 * Sélectionne la dalle dont les indices kilométriques Lambert-93 sont `x, y`
 * — le calcul commun au lien partagé (`#d=x,y`) et au bouton « Voir un
 * exemple ». Recentre la carte dessus et attend la fin de la sélection avant
 * de résoudre, pour qu'un appelant puisse enchaîner sur `etat.promesseIndex`.
 */
function selectionnerDalleParIndices(x, y, zoom = 16) {
  const centre = PROJ.versWGS84(x * 1000 + 500, y * 1000 + 500);
  return new Promise((resolve) => {
    // `carte.invalider()` d'abord : fermer l'accueil rend au panneau sa colonne
    // de 380 px, et Leaflet ne le détecte pas tout seul — un redimensionnement
    // purement CSS, sans évènement `resize` — même piège que le retour sur
    // l'onglet Carte.
    requestAnimationFrame(async () => {
      carte.invalider();
      carte.allerA(centre.lon, centre.lat, zoom);
      await carte.selectionnerAuPoint(centre.lon, centre.lat);
      resolve();
    });
  });
}

$('btn-exemple').addEventListener('click', async () => {
  masquerAccueil();
  basculerVue('carte');
  if (MODE_VUE) {
    // Le Bois des Caures cadré : le relief de la vue arrive seul.
    const { x, y } = CONFIG.carte.dalleExemple;
    const c = PROJ.versWGS84(x * 1000 + 500, y * 1000 + 500);
    requestAnimationFrame(() => { carte.invalider(); carte.allerA(c.lon, c.lat, 16); });
    return;
  }
  const { x, y } = CONFIG.carte.dalleExemple;
  await selectionnerDalleParIndices(x, y);
  // `surDalle` publie `etat.promesseIndex` de façon synchrone avant que
  // `selectionnerAuPoint` ne rende la main : l'attendre à son tour signale que
  // l'index COPC est prêt, sans relire ce que la sélection a déjà lu.
  await etat.promesseIndex;
  if (!etat.entete) return;   // sélection ou lecture d'index en échec : déjà signalé par une alerte
  $('btn-charger').click();
});
$('btn-carte-directe').addEventListener('click', entrerDansLaCarte);
// La croix : la carte telle qu'elle est, sans rien viser (ni exemple, ni champ de
// recherche). Fermer l'accueil rend au panneau sa colonne : `invalider()` d'abord.
$('accueil-croix').addEventListener('click', () => {
  masquerAccueil();
  basculerVue('carte');
  requestAnimationFrame(() => carte.invalider());
});

// ── Le relief de la vue (mode par défaut) ───────────────────────────────────
//
// Spec docs/superpowers/specs/2026-09-26-flux-vue-design.md : les blocs de la
// vue se chargent (flux.js), le relief se calcule dans un worker
// (relief-travailleur.js) et se pose sur la carte derrière un rideau
// (CalqueRelief). « ?dalle » dans l'adresse rend l'ancien parcours à la place.
// Diagnostic : « &debug » (contours des blocs, statut chiffré), « &chrono »
// (temps du fil principal, gels détaillés).
if (MODE_VUE) (async () => {
  // Pas de dalle à sélectionner au clic ; la 2D et la 3D attendent leur
  // retour sur le relief de la vue (TODO #3, #4) — désactivées, y compris aux
  // raccourcis clavier, que basculerVue refuse pour un onglet désactivé.
  carte.selectionAuClic = false;
  // Ni le quadrillage kilométrique : il servait à choisir une dalle, et sur
  // le relief il ne faisait que rayer l'image. Gardé avec « &debug », où il
  // aide à lire les contours des blocs.
  if (!new URLSearchParams(location.search).has('debug')) carte.grille.remove();
  $('onglet-2d').disabled = true;
  // La 3D, elle, revient : le nuage de la zone vue sur la carte (spec
  // 2026-09-27-vue-3d-design). Sans WebGL2, elle reste désactivée.
  $('onglet-3d').disabled = !vue3d;

  // Chronométrage du fil principal, avec « &chrono » dans l'adresse : où part
  // le temps quand la carte ralentit. Chaque morceau de travail mesuré est
  // compté (appels, total, pire) ; les « tâches longues » sont celles que le
  // navigateur voit bloquer plus de 50 ms, mesurées ou non. Un tableau dans la
  // console toutes les 5 s. Un outil de diagnostic, pas une fonction.
  const chrono = new Map();
  const noter = (nom, ms) => {
    const c = chrono.get(nom) || { appels: 0, totalMs: 0, pireMs: 0 };
    c.appels++; c.totalMs += ms; c.pireMs = Math.max(c.pireMs, ms);
    chrono.set(nom, c);
  };
  const mesurer = (nom, f) => function (...a) {
    const t0 = performance.now();
    try { return f.apply(this, a); } finally { noter(nom, performance.now() - t0); }
  };
  const chronometrer = new URLSearchParams(location.search).has('chrono');
  const activite = { relief: false, decodages: 0 };
  if (chronometrer) {
    console.info('Chrono du fil principal actif : un tableau toutes les 5 s dès que la carte travaille.');
    for (const [objet, nomObjet, noms] of [
      [FLUX_CHOIX, 'FLUX_CHOIX', ['blocsPourVue', 'aLiberer']],
      [COPC, 'COPC', ['lireFin', 'lireEntrees', 'grouperPlages']],
    ]) for (const n of noms) objet[n] = mesurer(`${nomObjet}.${n}`, objet[n]);
    for (const n of ['afficher', 'vider']) CalqueRelief.prototype[n] = mesurer(`image du relief : ${n}`, CalqueRelief.prototype[n]);
    for (const n of ['ajouter', 'retirer']) CalqueFlux.prototype[n] = mesurer(`contours des blocs : ${n}`, CalqueFlux.prototype[n]);
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) noter('TÂCHES LONGUES (> 50 ms, tout compris)', e.duration); })
        .observe({ type: 'longtask', buffered: true });
    } catch { /* navigateur sans longtask */ }
    // Le détail de chaque gel de plus de 150 ms : quels scripts (fonction,
    // fichier, qui l'a appelée) et combien de rendu (style, mise en page,
    // dessin). Le temps qui n'est ni l'un ni l'autre est hors JavaScript —
    // ramasse-miettes compris. API « long animation frames » de Chrome.
    const gels = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          if (e.duration < 150) continue;
          const scripts = [...(e.scripts || [])].sort((a, b) => b.duration - a.duration);
          const js = scripts.reduce((t, x) => t + x.duration, 0);
          const rendu = e.renderStart ? e.startTime + e.duration - e.renderStart : 0;
          const styleMiseEnPage = e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0;
          gels.push({
            gelMs: Math.round(e.duration),
            // Ce qui tournait ailleurs au même moment : les workers ne
            // bloquent pas la page, sauf à saturer les cœurs du processeur.
            reliefEnCalcul: activite.relief ? 'oui' : 'non',
            decompressions: activite.decodages,
            scriptsMs: Math.round(js),
            renduMs: Math.round(rendu),
            dontStyleEtMiseEnPageMs: Math.round(styleMiseEnPage),
            resteMs: Math.round(e.duration - js - rendu),
            scriptsPrincipaux: scripts.slice(0, 3).map((x) => `${Math.round(x.duration)} ms ${x.invoker || '?'} → ${x.sourceFunctionName || '?'} @${(x.sourceURL || '').split('/').pop()}:${x.sourceCharPosition}`).join(' | '),
          });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch { /* navigateur sans long-animation-frame */ }
    setInterval(() => {
      if (!chrono.size) return;
      const lignes = [...chrono].sort((a, b) => b[1].totalMs - a[1].totalMs).map(([nom, c]) => ({
        travail: nom, appels: c.appels, totalMs: Math.round(c.totalMs), pireMs: Math.round(c.pireMs),
      }));
      console.log(`Chrono du fil principal, 5 dernières secondes, ${new Date().toLocaleTimeString()}`);
      console.table(lignes);
      if (gels.length) { console.log('Détail des gels de plus de 150 ms :'); console.table(gels.splice(0)); }
      chrono.clear();
    }, 5000);
  }

  // Les contours des blocs chargés, pour voir le chargement : « &debug ».
  const calque = new URLSearchParams(location.search).has('debug') ? new CalqueFlux().addTo(carte.map) : null;
  const reliefCalque = new CalqueRelief().addTo(carte.map);
  // La position du rideau est dans le lien : le geste (et « Rideau au centre ») passent par
  // `placerRideau`, qu'on enveloppe sur cette instance.
  const placerRideauSeul = reliefCalque.placerRideau.bind(reliefCalque);
  reliefCalque.placerRideau = (part) => { placerRideauSeul(part); majLien(); };
  // Le calcul du relief tourne dans un worker (relief-travailleur.js) : sur le
  // fil principal, il figeait la carte une à plusieurs secondes à chaque
  // arrivée de blocs. S'il ne démarre pas, le même calcul se fait ici.
  // Le rangement des points se fait au processeur, même dans le worker : sur
  // la carte graphique, la page gelait pendant chaque calcul — elle partage
  // la carte (et le processus graphique de Chrome) avec le worker, et son
  // affichage attendait que le calcul soit passé : gels de 0,5 à 1 s sur la
  // carte AMD, jusqu'à 11 s sous émulation, sans une ligne de script (mesuré
  // avec &chrono, API long-animation-frame).
  // Les couches (SVF…), elles, passent par la carte graphique : un calcul
  // court, qui ne fait pas geler la page à l'usage (essayé, aucun
  // ralentissement ressenti), là où le rangement des points la gelait. « &cpu » : tout au processeur ; « &gpu » : tout sur la carte,
  // pour comparer.
  const params = new URLSearchParams(location.search);
  const optionsRelief = params.has('gpu') ? {} : params.has('cpu') ? { moteur: 'cpu' } : { moteur: 'cpu', couches: 'gpu' };
  let relief = RELIEF_TRAVAILLEUR.creer(optionsRelief);
  let infoRelief = null;
  if (relief) {
    try { infoRelief = await relief.pret; } catch (err) {
      console.warn(`Relief calculé sur le fil principal : ${err.message}`);
      relief.arreter();
      relief = null;
    }
  }
  if (!relief) {
    relief = RELIEF_TRAVAILLEUR.surFilPrincipal(optionsRelief);
    infoRelief = { ...(await relief.pret), filPrincipal: true };
  }
  const surAppareilPortatif = surMobile();
  // Le rangement des points est incrémental, dans le worker : chaque bloc n'est
  // rangé qu'une fois, le budget n'a plus à être réduit pour lui.
  const budget = surAppareilPortatif ? CONFIG.flux.budgetPointsMobile : CONFIG.flux.budgetPoints;

  let dernierEtat = null, texteRelief = '', vueCourante = null, minuteur = null;
  // Ce que porte chaque côté du rideau, comme dans l'onglet 2D : « carte »
  // (la carte Leaflet, qui remplace ici la photo aérienne) ou une couche de
  // relief. Par défaut, la carte à gauche et le Sky-View Factor à droite.
  const cotes = { gauche: 'carte', droite: 'svf' };
  // Les couches de l'onglet 2D, fonds de carte à part (la carte Leaflet les
  // porte, avec son propre choix de fond) : relief.js, plus l'ombrage coloré.
  // L'ombrage gris en avait été retiré (« sur une grille au pixel, il sortait
  // pâle ») : revenu avec ses curseurs d'azimut et de hauteur, qui rendent le
  // contraste que la moyenne de quatre soleils efface.
  const COUCHES_VUE = CHOIX_2D.filter((c) => c.cle !== PHOTO && c.cle !== PLAN);
  // Ce qui n'est pas du relief : la carte telle qu'affichée, et le Plan IGN,
  // posé dans le côté même — la carte n'a qu'un fond à la fois, et ainsi un
  // côté peut montrer la photo et l'autre le plan.
  const FONDS_VUE = {
    carte: 'Photo aérienne', plan: 'Plan IGN',
    'mnt-ign': 'MNT ombré (IGN)', 'mns-ign': 'MNS ombré (IGN)',
  };
  // Les fonds de tuiles posés dans le volet de leur côté, avec leurs réglages propres :
  // l'estompage de l'IGN n'est servi que jusqu'au niveau 18, au-delà la tuile est agrandie.
  const TUILES_VUE = { plan: {}, 'mnt-ign': { maxNativeZoom: 18 }, 'mns-ign': { maxNativeZoom: 18 } };
  const AIDES_FONDS = {
    'mnt-ign': 'Estompage du MNT LiDAR HD (le sol nu), calculé par l’IGN : éclairage fixe, pas de réglage du soleil. Servi jusqu’au zoom 18.',
    'mns-ign': 'Estompage du MNS LiDAR HD (le dessus : cimes, toits), calculé par l’IGN : éclairage fixe, pas de réglage du soleil. Servi jusqu’au zoom 18.',
  };
  // Les listes Gauche / Droite choisissent le fond de chaque côté : le
  // sélecteur de fond de Leaflet ferait doublon. La carte garde la photo.
  carte.controleFonds.remove();
  const estRelief = (cle) => !(cle in FONDS_VUE);
  const libelleCouche = (cle) => FONDS_VUE[cle] || COUCHES_VUE.find((c) => c.cle === cle).libelle;
  // Le statut dit à l'utilisateur où en est son relief ; le détail chiffré
  // (surface, dalles, blocs, points, durées) ne sert qu'au diagnostic, avec
  // « &debug » ou « &chrono ».
  const diagnostic = DIAGNOSTIC;
  // Une requête restée sans réponse (reseau.js) : l'avis dure le temps de la
  // fenêtre de lenteur, puis le statut se redit tout seul.
  // L'avis sur la carte, lui, ne reste que `dureeAvisLenteurMs` par épisode
  // de lenteur : une fois lu, il gênerait. Le statut « Chargement ralenti »
  // reste, discret, tant que dure l'épisode ; un nouvel épisode le remontre.
  let lenteIGN = false, minuteurLenteur = null, debutAvisLenteur = 0;
  RESEAU.surLenteur(() => {
    if (!lenteIGN) {
      debutAvisLenteur = Date.now();
      setTimeout(() => majStatut(), CONFIG.reseau.dureeAvisLenteurMs + 50);
    }
    lenteIGN = true;
    clearTimeout(minuteurLenteur);
    minuteurLenteur = setTimeout(() => { lenteIGN = RESEAU.lenteRecente(); majStatut(); }, CONFIG.reseau.fenetreLenteurMs + 50);
    majStatut();
  });
  const majStatut = () => {
    const e = dernierEtat;
    if (!e) return;
    // Seulement pendant qu'on attend des blocs : une fois tout arrivé, la
    // lenteur passée n'a plus rien à expliquer.
    carte.avisLenteurIGN(lenteIGN && !!e.attente && !e.tropLarge && !e.sansLidar
      && Date.now() - debutAvisLenteur < CONFIG.reseau.dureeAvisLenteurMs);
    // Pas de LiDAR dans la vue : dit à l'écran, pas seulement dans la console.
    // Hors de France, ou une zone française pas encore volée ou publiée.
    let sansLidar = '';
    if (e.sansLidar) {
      const c = carte.map.getCenter();
      // Un territoire du projet est un rectangle (PROJ.territoireAuPoint) :
      // celui de la métropole déborde sur l'Espagne, la Suisse et la mer.
      // Dedans, la phrase doit valoir pour les deux cas.
      sansLidar = PROJ.territoireAuPoint(c.lng, c.lat)
        ? 'Pas de LiDAR HD ici : hors de France, ou zone pas encore volée ou publiée par l’IGN'
        : 'Hors des territoires couverts : le LiDAR HD de l’IGN ne couvre que la France, métropole et outre-mer';
      for (const cote of ['gauche', 'droite']) {
        if (!estRelief(cotes[cote])) continue;
        reliefCalque.definirLibelle(cote, 'Pas de LiDAR HD ici');
        reliefCalque.vider(cote);
      }
    }
    $('vue-etat').textContent = e.attente && !e.tropLarge
      ? `Affinage… ${e.attente} bloc${e.attente > 1 ? 's' : ''} attendu${e.attente > 1 ? 's' : ''}` : '';
    if (!diagnostic) {
      statut(sansLidar || (e.tropLarge && ['gauche', 'droite'].some((c) => estRelief(cotes[c])) ? 'Zoomez pour calculer le relief'
        : e.echecs ? `${e.echecs} dalle${e.echecs > 1 ? 's' : ''} en échec, réessai en cours — ${e.erreur}`
          : erreurRelief ? `Le relief n’a pas pu être calculé — ${erreurRelief}`
            : !['gauche', 'droite'].some((c) => estRelief(cotes[c])) ? 'Aucune couche de relief affichée'
              : e.attente && lenteIGN ? 'Chargement ralenti'
              : e.attente ? 'Relief en cours d’affinage…'
                : texteRelief ? 'Relief à jour' : 'Relief en calcul…'),
      e.echecs || erreurRelief ? 'erreur' : e.attente ? 'travail' : undefined);
      return;
    }
    statut(sansLidar ? `Flux : ${sansLidar}` : (e.tropLarge
      ? `Flux : ${e.surfaceKm2.toFixed(0)} km² affichés, trop pour les points (seuil ${CONFIG.flux.surfaceMaxPointsKm2} km²) — zoomez`
      : `Flux : ${e.surfaceKm2.toFixed(1)} km² · ${e.dallesOuvertes} dalles · ${e.charges} blocs · ${milliers(e.points)} points`
        + (e.attente ? ` · ${e.attente} en attente` : '')
        + (e.echecs ? ` · ${e.echecs} dalle${e.echecs > 1 ? 's' : ''} en échec, réessai en cours — ${e.erreur}` : ''))
      + (texteRelief ? ` · ${texteRelief}` : ''),
    e.echecs ? 'erreur' : e.attente ? 'travail' : undefined);
  };

  // Un seul calcul à la fois : le worker les traite dans l'ordre, et en
  // empiler pendant un déplacement ne ferait que retarder le dernier, le seul
  // qui compte. Une demande pendant un calcul est retenue, et relancée à la
  // fin avec la vue du moment. `enCalcul` est la promesse du calcul en
  // cours, qui se tient à la fin : qui doit l'attendre l'attend, sans sonder.
  let enCalcul = null, aRefaire = false;
  let contrasteFlux = 1, dernieresClasses = [], erreurRelief = '';
  // L'étirement de la dernière image de chaque côté : le relief drapé sur le
  // nuage 3D reprend le même, pour que les deux vues soient la même image.
  const derniersEtirements = {};
  // Réglages du balayage d'horizons (SVF, ouvertures) et du lissage, comme
  // dans l'onglet 2D.
  let svfDirections = CONFIG.relief.svfDirections, svfRayonM = CONFIG.relief.svfRayonM, lisserFlux = true;
  let ombrageAzimut = CONFIG.relief.ombrageAzimut, ombrageHauteur = CONFIG.relief.ombrageHauteur;
  let classesSolFlux = new Set(CONFIG.raster.classesSolDefaut), classesAffichees = '';
  // Une case par classe présente dans les points reçus, cochée si elle compte
  // comme sol. Reconstruite seulement quand la liste change.
  const majClassesSol = () => {
    const cle = dernieresClasses.map(([c]) => c).join(',');
    if (cle === classesAffichees) return;
    classesAffichees = cle;
    $('vue-classes-sol').innerHTML = dernieresClasses.map(([c]) => `<label class="case"><input type="checkbox" value="${c}"`
      + `${classesSolFlux.has(c) ? ' checked' : ''}><span>${NOMS_CLASSES[c] || `classe ${c}`}</span></label>`).join('');
  };
  // Palettes de 256 couleurs, une par couche, calculées une fois.
  const luts = new Map();
  const lutCouche = (cle) => {
    const def = RELIEF.COUCHES.find((c) => c.cle === cle);
    if (!def) return null;   // l'ombrage coloré porte ses couleurs
    if (!luts.has(cle)) luts.set(cle, construireLUT(def.palette));
    return luts.get(cle);
  };
  const calculerRelief = async (forcer = false) => {
    // En 3D, la carte est masquée : ses images attendront le retour (spec
    // 2026-09-27, « rien ne suit la carte pendant qu'on est en 3D »). Les
    // calculer quand même mettait le nuage 3D en file derrière elles. Seul
    // le nuage lui-même peut forcer un calcul, pour lire la bonne surface.
    if (!forcer && !$('vue-3d').hidden) return;
    if (enCalcul) { aRefaire = true; return; }
    // Au-delà du seuil, aucun point n'est demandé, donc aucun relief de plus :
    // la dernière image calculée reste, et rétrécit avec la carte ; ailleurs,
    // le voile du côté laisse voir la carte, et le libellé du rideau dit de
    // zoomer. Rien que du COPC (choix de l'utilisateur) : le MNT puis
    // l'ombrage de l'IGN y ont été essayés, puis écartés.
    const tropLarge = vueCourante && FLUX_CHOIX.surfaceKm2(vueCourante) > CONFIG.flux.surfaceMaxPointsKm2;
    const aCalculer = ['gauche', 'droite'].filter((c) => estRelief(cotes[c]));
    for (const c of ['gauche', 'droite']) {
      reliefCalque.definirLibelle(c, tropLarge && estRelief(cotes[c]) ? 'Zoomez pour calculer le relief' : libelleCouche(cotes[c]));
    }
    if (!vueCourante || tropLarge || !aCalculer.length) {
      // Gardée seulement si c'est bien la couche du côté : après un
      // changement de couche, l'ancienne image mentirait sous le libellé.
      for (const c of aCalculer) if (derniersEtirements[c]?.cle !== cotes[c]) reliefCalque.vider(c);
      texteRelief = '';
      majStatut();
      return;
    }
    const pas = FLUX_CHOIX.pasPourVue(vueCourante.xmax - vueCourante.xmin, vueCourante.largeurPx, CONFIG.flux.pasMinM);
    const geo = VUE_GRILLE.definir(vueCourante, pas, VUE_GRILLE.marge({ ...CONFIG.relief, ...CONFIG.flux, svfRayonM }), infoRelief.coteMax);
    let terminer;
    enCalcul = new Promise((ok) => { terminer = ok; });
    activite.relief = true;
    try {
      // L'écran de la carte au moment de la demande : le worker y reprojette
      // le relief, et l'image se pose sur ces bornes-là — pas sur celles du
      // retour, si la carte a bougé entre-temps.
      const z = carte.map.getZoom();
      const pb = carte.map.getPixelBounds();
      const ecran = { x0: pb.min.x, y0: pb.min.y, W: Math.round(pb.max.x - pb.min.x), H: Math.round(pb.max.y - pb.min.y), z, territoire: territoireVue };
      const bornes = L.latLngBounds(carte.map.unproject(pb.getBottomLeft(), z), carte.map.unproject(pb.getTopRight(), z));
      const actifs = [...flux.voulues()];
      erreurRelief = '';
      const textes = [];
      // Un côté après l'autre : la surface est rangée une fois pour les deux,
      // seule la couche change (gardée par le worker d'un calcul à l'autre).
      for (const c of aCalculer) {
        const cle = cotes[c];
        const r = await relief.image(geo, cle, ecran, lutCouche(cle), {
          contraste: contrasteFlux, lisser: lisserFlux, actifs, couche: reglagesDe(cle),
        });
        if (cotes[c] !== cle) continue;   // le côté a changé pendant le calcul
        if (!r) { reliefCalque.vider(c); continue; }
        reliefCalque.afficher(c, r, bornes);
        derniersEtirements[c] = { cle, min: r.min, max: r.max };
        textes.push(`${c} ${(r.duree / 1000).toFixed(2)} s (${r.moteurSurface}${r.moteurCouche && r.moteurCouche !== r.moteurSurface ? ' + ' + r.moteurCouche : ''}`
          + `${infoRelief.filPrincipal ? ', fil principal' : ''} ; surface ${(r.dureeSurface / 1000).toFixed(2)} s`
          + `, couche ${r.recalcul ? (r.dureeCouche / 1000).toFixed(2) + ' s' : 'gardée'}, image ${((r.dureeImage || 0) / 1000).toFixed(2)} s)`);
        dernieresClasses = r.classes || [];
      }
      texteRelief = textes.length ? `relief ${textes.join(' · ')} · ${geo.W}×${geo.H} cases de ${geo.pas.toFixed(2)} m` : '';
      majClassesSol();
      // Un point cherché par ses coordonnées avant que le relief n'y soit
      // calculé : son altitude arrive avec cette image.
      if (selectionActuelle && selectionActuelle.sol == null) {
        const pt = await relief.lire(selectionActuelle.x, selectionActuelle.y);
        if (pt?.altitude != null) afficherSelection(selectionActuelle.x, selectionActuelle.y, pt.altitude, pt.hauteur);
      }
    } catch (err) {
      console.error(err);
      texteRelief = `relief en échec : ${err.message}`;
      erreurRelief = err.message;
    } finally {
      enCalcul = null;
      terminer();
      activite.relief = false;
    }
    majStatut();
    if (aRefaire) { aRefaire = false; calculerRelief(); }
  };
  // Pendant l'arrivée des blocs, un recalcul au plus toutes les 1,5 s ; au
  // déplacement, tout de suite — la vue d'avant n'a plus de sens.
  const planifierRelief = (delai) => {
    if (delai === 0 && minuteur) { clearTimeout(minuteur); minuteur = null; }
    if (minuteur) return;
    minuteur = setTimeout(() => { minuteur = null; calculerRelief(); }, delai);
  };

  const depsFlux = {
    chercherDalles: (z) => {
      const p = projVue();
      const so = p.versGeo(z.xmin, z.ymin), ne = p.versGeo(z.xmax, z.ymax);
      return IGN.dalles(so.lat, so.lon, ne.lat, ne.lon);
    },
    recuperer: RESEAU.recuperer,
    expliquer: RESEAU.expliquer,
    decoder: NUAGE.decoder,
    cache: CACHE_DISQUE.creer(CACHE_DISQUE.stockageIndexedDB(), CONFIG.flux.quotaDisqueOctets),
    config: { ...CONFIG.flux, budgetPoints: budget },
    surBloc: (b) => { calque?.ajouter(b, projVue().versGeo); relief.ajouter(b); planifierRelief(1500); },
    surLibere: (cle) => { calque?.retirer(cle); relief.retirer(cle); },
    surEtat: (e) => { dernierEtat = e; majStatut(); },
  };
  if (chronometrer) {
    // Seule la part synchrone est comptée : ce qui bloque le fil principal.
    for (const n of ['surBloc', 'surLibere', 'surEtat', 'recuperer', 'decoder', 'chercherDalles']) depsFlux[n] = mesurer(`flux : ${n}`, depsFlux[n]);
    const decoder = depsFlux.decoder;
    depsFlux.decoder = (charge) => { activite.decodages++; return decoder(charge).finally(() => { activite.decodages--; }); };
    for (const n of ['lire', 'ecrire']) depsFlux.cache[n] = mesurer(`cache disque : ${n}`, depsFlux.cache[n]);
    for (const n of ['ajouter', 'retirer', 'reglages', 'image']) relief[n] = mesurer(`worker du relief : ${n} (envoi)`, relief[n]);
  }
  const flux = FLUX.creer(depsFlux);
  dalleAuPointVue = (x, y) => flux.dalleAu(x, y);
  if (chronometrer) for (const n of ['majVue']) flux[n] = mesurer(`flux : ${n}`, flux[n]);

  const majVueFlux = () => {
    const b = carte.map.getBounds();
    // Le territoire sous le centre fixe la projection de tout ce qui suit ;
    // en mer, entre deux, le dernier reste.
    const c = b.getCenter();
    const territoireAvant = territoireVue;
    territoireVue = PROJ.territoireAuPoint(c.lng, c.lat)?.code ?? territoireVue;
    // Une bande posée dans un territoire n'a pas de sens dans l'autre (autre projection).
    if (territoireVue !== territoireAvant) effacerProfil();
    const { versLocal } = projVue();
    const so = versLocal(b.getWest(), b.getSouth());
    const ne = versLocal(b.getEast(), b.getNorth());
    const no = versLocal(b.getWest(), b.getNorth());
    const se = versLocal(b.getEast(), b.getSouth());
    vueCourante = {
      xmin: Math.min(so.x, no.x), xmax: Math.max(ne.x, se.x),
      ymin: Math.min(so.y, se.y), ymax: Math.max(ne.y, no.y),
      largeurPx: carte.map.getSize().x,
    };
    flux.majVue(vueCourante);
    planifierRelief(0);
  };

  // ── Le panneau du relief ──
  const BALAYAGE = new Set(['svf', 'ouverture-pos', 'ouverture-neg']);
  // Les réglages propres à une couche, et ceux-là seulement : ils entrent dans la
  // clé du mémo du worker, et bouger le soleil ne doit pas refaire un Sky-View
  // Factor (cinq secondes) ni l'inverse.
  const OMBRAGES = new Set(['ombrage', 'ombrage-simple', OMBRAGE_RGB]);
  const reglagesDe = (cle) => (BALAYAGE.has(cle) ? { svfDirections, svfRayonM }
    : OMBRAGES.has(cle) ? { ombrageAzimut, ombrageHauteur } : {});
  const fondsPoses = { gauche: null, droite: null };   // la clé du fond de tuiles posé dans le volet, ou null
  const majCotes = () => {
    for (const c of ['gauche', 'droite']) {
      $(`vue-${c}`).value = cotes[c];
      reliefCalque.definirActif(c, cotes[c] !== 'carte');
      // Reposé seulement s'il change : recréer la couche rechargerait toutes
      // ses tuiles à chaque changement de l'autre côté.
      const voulu = cotes[c] in TUILES_VUE ? cotes[c] : null;
      if (fondsPoses[c] !== voulu) {
        fondsPoses[c] = voulu;
        reliefCalque.definirFond(c, voulu
          ? carte.nouveauFond(voulu, { pane: c === 'gauche' ? 'reliefGauche' : 'reliefDroite', ...TUILES_VUE[voulu] }) : null);
      }
      reliefCalque.definirLibelle(c, libelleCouche(cotes[c]));
    }
    // L'aide de la couche de relief affichée — celle de droite par défaut,
    // côté du relief par convention.
    const cle = estRelief(cotes.droite) ? cotes.droite : cotes.gauche;
    const fondAide = [cotes.droite, cotes.gauche].find((k) => AIDES_FONDS[k]);
    $('vue-aide').textContent = estRelief(cle) ? COUCHES_VUE.find((x) => x.cle === cle).aide
      : fondAide ? AIDES_FONDS[fondAide] : 'Choisissez une couche de relief d’un côté du rideau.';
    $('vue-svf-reglages').hidden = !(BALAYAGE.has(cotes.gauche) || BALAYAGE.has(cotes.droite));
    $('vue-ombrage-reglages').hidden = !(OMBRAGES.has(cotes.gauche) || OMBRAGES.has(cotes.droite));
    // L'azimut ne change rien à l'ombrage à quatre soleils (opposés deux à deux, leur part
    // directionnelle s'annule) : grisé quand aucun côté n'en porte d'autre.
    const ombragesPoses = [cotes.gauche, cotes.droite].filter((k) => OMBRAGES.has(k));
    const sansEffet = ombragesPoses.length > 0 && ombragesPoses.every((k) => k === 'ombrage');
    $('vue-ombrage-azimut').disabled = sansEffet;
    $('vue-ombrage-note').hidden = !sansEffet;
    majLien();   // les couches de chaque côté sont dans le lien
  };
  for (const c of ['gauche', 'droite']) {
    const sel = $(`vue-${c}`);
    for (const [cle, libelle] of Object.entries(FONDS_VUE)) sel.add(new Option(libelle, cle));
    for (const k of COUCHES_VUE) sel.add(new Option(k.libelle, k.cle));
    sel.addEventListener('change', () => { cotes[c] = sel.value; majCotes(); majStatut(); planifierRelief(0); });
  }
  $('vue-echanger').addEventListener('click', () => {
    [cotes.gauche, cotes.droite] = [cotes.droite, cotes.gauche];
    majCotes();
    planifierRelief(0);
  });
  $('vue-rideau-centre').addEventListener('click', () => reliefCalque.placerRideau(0.5));
  // Réglages du balayage : appliqués au relâchement du curseur, un SVF coûte
  // trop cher pour suivre chaque cran.
  $('vue-svf-directions').value = svfDirections;
  $('val-vue-svf-directions').textContent = svfDirections;
  $('vue-svf-rayon').value = svfRayonM;
  $('val-vue-svf-rayon').textContent = `${svfRayonM} m`;
  $('vue-svf-directions').addEventListener('input', (e) => { $('val-vue-svf-directions').textContent = e.target.value; });
  $('vue-svf-directions').addEventListener('change', (e) => { svfDirections = Number(e.target.value); $('val-vue-svf-directions').textContent = e.target.value; planifierRelief(0); majLien(); });
  $('vue-svf-rayon').addEventListener('input', (e) => { $('val-vue-svf-rayon').textContent = `${e.target.value} m`; });
  $('vue-svf-rayon').addEventListener('change', (e) => { svfRayonM = Number(e.target.value); $('val-vue-svf-rayon').textContent = `${e.target.value} m`; planifierRelief(0); majLien(); });
  // Soleil des ombrages : appliqué au relâchement du curseur.
  $('vue-ombrage-azimut').value = ombrageAzimut;
  $('val-vue-ombrage-azimut').textContent = `${ombrageAzimut}°`;
  $('vue-ombrage-hauteur').value = ombrageHauteur;
  $('val-vue-ombrage-hauteur').textContent = `${ombrageHauteur}°`;
  $('vue-ombrage-azimut').addEventListener('input', (e) => { $('val-vue-ombrage-azimut').textContent = `${e.target.value}°`; });
  $('vue-ombrage-azimut').addEventListener('change', (e) => { ombrageAzimut = Number(e.target.value); $('val-vue-ombrage-azimut').textContent = `${e.target.value}°`; planifierRelief(0); majLien(); });
  $('vue-ombrage-hauteur').addEventListener('input', (e) => { $('val-vue-ombrage-hauteur').textContent = `${e.target.value}°`; });
  $('vue-ombrage-hauteur').addEventListener('change', (e) => { ombrageHauteur = Number(e.target.value); $('val-vue-ombrage-hauteur').textContent = `${e.target.value}°`; planifierRelief(0); majLien(); });
  $('vue-lisser').addEventListener('change', (e) => { lisserFlux = e.target.checked; planifierRelief(0); majLien(); });

  // ── Sélection d'un point et mesure, sur la carte ──
  // Les mêmes sections et le même tableau que l'onglet 2D ; le point se lit
  // dans le relief calculé par le worker (relief.lire), jamais recalculé.
  $('barre-mode').hidden = false;
  // La barre de modes vient de réduire la hauteur de la carte, ce que Leaflet
  // ne détecte pas seul (redimensionnement purement CSS) : sans ce rappel, il
  // gardait l'ancienne hauteur, les bornes lues pour la vue et pour poser le
  // relief étaient décalées, et la première emprise glissait de ~17 m au
  // premier redimensionnement suivant — un nuage 3D reconstruit pour rien.
  carte.invalider();
  for (const id of ['section-selection', 'section-mesure']) {
    $(id).dataset.vue = 'carte 2d 3d';
    $(id).hidden = false;
  }
  lireVue = (x, y) => relief.lire(x, y);

  // ── L'onglet 3D : le nuage de la zone vue sur la carte ──
  // Rien n'est téléchargé pour lui : ce sont les points déjà là pour le
  // relief, échantillonnés par le worker sous un plafond. Le nuage reste figé
  // tant qu'on est en 3D ; revenu en 3D sans que la carte ait bougé, on
  // garde le même, sinon on le reconstruit (spec 2026-09-27-vue-3d-design).
  $('section-affichage').hidden = false;
  $('section-vide-3d').hidden = true;
  let budget3D = surMobile() ? CONFIG.rendu.budget3DMobile : CONFIG.rendu.budget3D;
  $('vue-budget3d').value = budget3D / 1e6;
  $('val-vue-budget3d').textContent = `${budget3D / 1e6} M`;
  $('vue-edl').checked = CONFIG.rendu.edl.actif;
  const avis3D = (texte) => {
    $('avis-3d').hidden = !texte;
    $('avis-3d').textContent = texte || '';
  };
  let empriseNuage = null, construction = null;
  const construire3D = async () => {
    if (!vue3d) return;
    if (construction) return construction;
    const e = vueCourante;
    const tropLarge = !e || FLUX_CHOIX.surfaceKm2(e) > CONFIG.flux.surfaceMaxPointsKm2;
    // Reconstruit si la vue a bougé, si le plafond a changé, ou si des points
    // sont arrivés depuis : un nuage bâti en plein chargement ne doit pas
    // rester clairsemé une fois tout arrivé.
    const cle = e && JSON.stringify([e.xmin, e.xmax, e.ymin, e.ymax].map((v) => Math.round(v))
      .concat(budget3D, dernierEtat ? dernierEtat.points : 0));
    if (!tropLarge && cle === empriseNuage && etat.nuage) return;   // rien n'a bougé
    vue3d.vider();
    etat.nuage = null;
    empriseNuage = null;
    majLegende();
    majHUD();
    if (tropLarge) { avis3D('Zoomez sur la carte pour afficher le nuage en 3D.'); return; }
    construction = (async () => {
      try {
        const n = await ATTENTE.pendant('Nuage 3D', async (etape) => {
          // La surface de la vue d'abord : hauteurs et drapé s'y lisent, et le
          // relief de la carte a pu rester en retard (en pause pendant la 3D,
          // ou un calcul encore en cours au moment de basculer).
          await etape('Relief de la vue…');
          while (enCalcul) await enCalcul;
          await calculerRelief(true);
          await etape('Nuage de la vue…', 'les points déjà chargés pour le relief');
          const r = await relief.nuage3d(e, budget3D, [...flux.voulues()]);
          if (r && !r.vide) {
            await etape('Nuage vers la carte graphique…', `${milliers(r.n)} points`);
            r.parClasse = new Map(r.parClasse);
            vue3d.definirNuage(r, r.hauteur);
          }
          return r;
        });
        if (!n || n.vide) {
          avis3D(n?.raison || 'Zoomez sur la carte pour afficher le nuage en 3D.');
          return;
        }
        avis3D(null);
        etat.nuage = n;
        empriseNuage = cle;
        vue3d.definirClassesMasquees(classesMasquees);
        majLegende();
        majHUD();
        await majAttributNuage();
      } catch (err) {
        console.error(err);
        avis3D(`Le nuage 3D n’a pas pu être construit — ${err.message}`);
      } finally {
        construction = null;
      }
    })();
    return construction;
  };
  surPassage3D = construire3D;
  surPassageCarte = () => planifierRelief(0);

  // Hauteur au-dessus du sol : venue avec le nuage. Relief : la couche du côté
  // droit du rideau (ou du gauche si la droite n'en porte pas), drapée par le
  // worker avec l'étirement de sa dernière image.
  majAttributVue = async () => {
    if (!vue3d || !etat.nuage) return;
    if (CONFIG.rendu.coloration === 'hauteur') { vue3d.definirHauteurs(etat.nuage.hauteur); return; }
    if (CONFIG.rendu.coloration !== 'relief') return;
    const cote = estRelief(cotes.droite) && cotes.droite !== OMBRAGE_RGB ? 'droite' : 'gauche';
    const etirement = derniersEtirements[cote];
    if (!estRelief(cotes[cote]) || !etirement || etirement.cle !== cotes[cote] || etirement.min == null) return;
    const valeurs = await relief.drape3d(etirement.cle, reglagesDe(etirement.cle), etirement.min, etirement.max);
    if (valeurs && etat.nuage && valeurs.length === etat.nuage.n) vue3d.definirHauteurs(valeurs);
  };

  $('vue-budget3d').addEventListener('input', (e) => { $('val-vue-budget3d').textContent = `${e.target.value} M`; });
  $('vue-budget3d').addEventListener('change', (e) => {
    budget3D = Number(e.target.value) * 1e6;
    if (!$('vue-3d').hidden) construire3D();
    majLien();   // le plafond de points est dans le lien
  });
  $('vue-edl').addEventListener('change', (e) => { vue3d?.definirEDL(e.target.checked); majLien(); });
  // Un volet à part, au-dessus du relief (450) et sous le rideau (700) : les
  // marqueurs restent visibles des deux côtés.
  carte.map.createPane('outilsVue').style.zIndex = 660;
  // En SVG, pas dans le canevas de la carte (preferCanvas) : quelques
  // marqueurs et traits, qui restent ainsi des éléments qu'on peut viser et
  // vérifier.
  const traceOutils = L.svg({ pane: 'outilsVue' });
  const versLatLng = (x, y) => { const w = projVue().versGeo(x, y); return [w.lat, w.lon]; };
  let coucheSelection = null, coucheMesure = null;
  carteOutils = {
    selection(p) {
      coucheSelection?.remove();
      coucheSelection = p ? L.circleMarker(versLatLng(p[0], p[1]), {
        pane: 'outilsVue', renderer: traceOutils, radius: 7, color: '#fff', weight: 2, fillColor: '#ffd24a', fillOpacity: 1,
        className: 'marqueur-selection', interactive: false,
      }).addTo(carte.map) : null;
    },
    mesure(points) {
      coucheMesure?.remove();
      coucheMesure = L.layerGroup().addTo(carte.map);
      const lls = points.map((p) => versLatLng(p.x, p.y));
      if (lls.length > 1) {
        L.polyline(lls, { pane: 'outilsVue', renderer: traceOutils, color: '#ffd24a', weight: 2.5, className: 'trace-mesure', interactive: false }).addTo(coucheMesure);
      }
      for (const ll of lls) {
        L.circleMarker(ll, { pane: 'outilsVue', renderer: traceOutils, radius: 4, color: '#fff', weight: 1.5, fillColor: '#ffd24a', fillOpacity: 1, interactive: false }).addTo(coucheMesure);
      }
      // La distance horizontale au milieu de chaque segment, comme en 2D : la
      // seule des trois qui se lise sur un plan.
      MESURE.segments(points).forEach((sg, i) => {
        L.tooltip({ permanent: true, direction: 'center', className: 'etiquette-mesure', interactive: false })
          .setLatLng([(lls[i][0] + lls[i + 1][0]) / 2, (lls[i][1] + lls[i + 1][1]) / 2])
          .setContent(`${sg.horizontale.toFixed(1)} m`)
          .addTo(coucheMesure);
      });
    },
  };
  // Un clic (pas un glisser : Leaflet ne l'émet pas après un déplacement)
  // vise un point en mode Sélection ou Mesure, et pose un point de la bande en mode Profil.
  carte.map.on('click', async (e) => {
    const mode = vue2d.mode;
    if (mode === 'profil') { poserPointProfil(e.latlng); return; }
    if (mode !== 'selection' && mode !== 'mesure') return;
    const { x, y } = projVue().versLocal(e.latlng.lng, e.latlng.lat);
    const pt = await relief.lire(x, y);
    if (mode === 'selection') afficherSelection(x, y, pt?.altitude ?? null, pt?.hauteur ?? 0);
    else ajouterPointMesure(x, y, pt?.altitude ?? null, pt?.hauteur ?? 0);
  });

  // ── Le profil : choisir la bande ──
  // Deux points A et B (coordonnées locales de la vue), une largeur ; la bande
  // se dessine dans le volet SVG des outils, le graphique ne s'ouvre qu'à la
  // validation. Pas de calcul tant qu'on n'a pas validé.
  const profil = {
    A: null, B: null, largeur: CONFIG.profil.largeurDefautM,
    donnees: null,          // le dernier profil calculé
    masquees: new Set(),    // classes décochées dans la modale
    numero: 0,              // un calcul plus récent invalide les réponses en retard
  };
  let profilGroupe = null;
  const iconePoignee = (lettre) => L.divIcon({ className: '', html: `<div class="poignee-profil">${lettre}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] });

  /** (Re)dessine A, B et la bande. Pendant un glissé, seules la bande et l'axe bougent. */
  function dessinerProfil() {
    profilGroupe?.remove();
    profilGroupe = null;
    if (!profil.A) return;
    profilGroupe = L.layerGroup().addTo(carte.map);
    const bande = L.polygon([], { pane: 'outilsVue', renderer: traceOutils, color: '#4ad0ff', weight: 1.5, fillOpacity: 0.16, interactive: false, className: 'bande-profil' }).addTo(profilGroupe);
    const axe = L.polyline([], { pane: 'outilsVue', renderer: traceOutils, color: '#4ad0ff', weight: 1.5, dashArray: '5 5', interactive: false, className: 'axe-profil' }).addTo(profilGroupe);
    const tracer = () => {
      if (!profil.B || !PROFIL.axe(profil.A, profil.B)) { bande.setLatLngs([]); axe.setLatLngs([]); return; }
      bande.setLatLngs(PROFIL.coins(profil.A, profil.B, profil.largeur).map(([x, y]) => versLatLng(x, y)));
      axe.setLatLngs([versLatLng(profil.A[0], profil.A[1]), versLatLng(profil.B[0], profil.B[1])]);
    };
    tracer();
    [['A', profil.A], ['B', profil.B]].forEach(([cle, p]) => {
      if (!p) return;
      const m = L.marker(versLatLng(p[0], p[1]), { pane: 'outilsVue', draggable: true, keyboard: false, icon: iconePoignee(cle) }).addTo(profilGroupe);
      m.on('drag', () => {
        const ll = m.getLatLng();
        const q = projVue().versLocal(ll.lng, ll.lat);
        profil[cle] = [q.x, q.y];
        tracer();
      });
      m.on('dragend', majFenetreProfil);
    });
  }

  /** La consigne, les boutons et les champs de largeur suivent l'état. */
  function majFenetreProfil() {
    const v = profil.A && profil.B ? PROFIL.verdict(profil.A, profil.B) : null;
    // La part « glissez A ou B » est masquée sur écran bas (`.profil-conseil`) : la fenêtre n'y tient qu'en une ligne.
    $('profil-consigne').innerHTML = !profil.A ? 'Cliquez le premier point sur la carte.'
      : !profil.B ? 'Cliquez le second point.'
      : v.ok ? `Axe de ${Math.round(PROFIL.axe(profil.A, profil.B).longueur)} m<span class="profil-conseil"> — glissez A ou B pour l’ajuster.</span>`
      : v.raison;
    $('profil-valider').disabled = !(v && v.ok);
    $('profil-effacer').disabled = !profil.A;
    $('profil-largeur').value = PROFIL.curseurDepuisLargeur(profil.largeur);
    $('profil-largeur-n').value = profil.largeur;
    $('profil-largeur-modale').value = profil.largeur;
    majLien();   // la bande est dans le lien
  }

  function effacerProfil() {
    profil.A = profil.B = null;
    dessinerProfil();
    majFenetreProfil();
  }
  surChangementTerritoire = effacerProfil;

  /** Un clic en mode Profil : A, puis B ; avec les deux posés, un clic recommence en A (voir `PROFIL.pointSuivant`). */
  function poserPointProfil(ll) {
    const q = projVue().versLocal(ll.lng, ll.lat);
    ({ A: profil.A, B: profil.B } = PROFIL.pointSuivant(profil.A, profil.B, [q.x, q.y]));
    dessinerProfil();
    majFenetreProfil();
  }

  /** Une largeur saisie (curseur ou champ) : bornée, la bande suit. */
  function fixerLargeur(valeur) {
    profil.largeur = PROFIL.largeurValide(Number(valeur));
    dessinerProfil();
    majFenetreProfil();
  }

  $('profil-largeur').addEventListener('input', (e) => fixerLargeur(PROFIL.largeurDepuisCurseur(Number(e.target.value))));
  $('profil-largeur-n').addEventListener('change', (e) => fixerLargeur(e.target.value));
  $('profil-effacer').addEventListener('click', effacerProfil);
  $('profil-valider').addEventListener('click', () => validerProfil());
  // Un clic ou une molette sur la fenêtre ne doit pas arriver à la carte
  // (il poserait un point, ou zoomerait).
  L.DomEvent.disableClickPropagation($('fenetre-profil'));
  L.DomEvent.disableScrollPropagation($('fenetre-profil'));
  majFenetreProfil();

  // ── Le profil : lire la coupe ──
  // La validation ouvre la modale et demande les points de la bande au worker ;
  // changer la largeur dans la modale recalcule sur place (au `change`, pas à
  // l'`input` : l'essai le plus fréquent sur un arbre est « un peu plus large »).
  let graphique = null;

  /** Les classes affichées : toutes celles de la bande, sauf les décochées dans la modale. */
  const visiblesProfil = () => new Set([...profil.donnees.parClasse.keys()].filter((c) => !profil.masquees.has(c)));

  function listerClassesProfil() {
    const d = profil.donnees;
    $('profil-classes').innerHTML = !d ? '' : [...d.parClasse.entries()].sort((a, b) => b[1] - a[1]).map(([cls, n]) => {
      const couleur = CONFIG.rendu.couleursClasse[cls] || CONFIG.rendu.couleurClasseDefaut;
      return `<label class="case"><input type="checkbox" data-cls="${cls}"${profil.masquees.has(cls) ? '' : ' checked'}>`
        + `<i style="background:${couleur};width:11px;height:11px;border-radius:2px;flex:none"></i>`
        + `<span>${NOMS_CLASSES[cls] || `classe ${cls}`} <small>${milliers(n)} points</small></span></label>`;
    }).join('');
  }

  /**
   * La tranche de la largeur de la bande que choisissent les deux curseurs :
   * le curseur de gauche est le côté gauche de l'axe (A→B), celui de droite le
   * côté droit. Aux deux extrémités, toute la bande — sans borne, pour qu'un
   * point à l'arrondi près du bord ne soit jamais écarté. Recadre le
   * graphique, ne recalcule rien.
   */
  function appliquerTrancheProfil() {
    const d = profil.donnees;
    if (!d || !graphique) { $('profil-tranche').textContent = ''; return; }
    const a0 = Number($('profil-d0').value), a1 = Number($('profil-d1').value);
    const demi = d.largeur / 2;
    const max = a0 <= 0 ? Infinity : demi - (d.largeur * a0) / 1000;
    const min = a1 >= 1000 ? -Infinity : demi - (d.largeur * a1) / 1000;
    graphique.definirLateral(min, max);
    const cote = (v, defaut) => {
      const x = Number.isFinite(v) ? v : defaut;
      return Math.abs(x) < 0.005 ? 'l’axe' : x > 0 ? `${x.toFixed(1)} m à gauche` : `${(-x).toFixed(1)} m à droite`;
    };
    $('profil-tranche').textContent = `Partie de la bande gardée : de ${cote(max, demi)} à ${cote(min, -demi)}`;
  }

  /** La chaîne de mesure du graphique, au même tableau que la carte (`MESURE.tableauHtml`). */
  function afficherMesureProfil(pts) {
    // Le graphique en (distance le long de l'axe, altitude) devient des points de la mesure :
    // l'horizontale est alors l'écart de distance, le dénivelé celui d'altitude.
    const chaine = pts.map((p) => ({ x: p.s, y: 0, sol: p.z, hauteur: 0 }));
    $('profil-mesure-vide').hidden = chaine.length > 0;
    $('profil-mesure-detail').hidden = !chaine.length;
    $('profil-mesure-actions').hidden = !chaine.length;
    $('profil-mesure-detail').innerHTML = chaine.length < 2
      ? '<p class="vide">Point A posé — cliquez un second point pour mesurer.</p>'
      : MESURE.tableauHtml(chaine);
  }

  // ── Les outils du graphique : déplacement, point de référence, mesure ──
  // L'outil décide de ce que fait un clic (le glisser et la molette déplacent et zooment
  // toujours). La mesure par défaut. Le point de référence est un par un : un clic remplace
  // le précédent ; il s'efface par un bouton (ou Retour arrière / Suppr quand son outil est
  // actif) et à la fermeture de la fenêtre.
  profil.outil = 'mesure';
  const CONSIGNES_OUTIL = {
    deplacement: 'Glissez pour déplacer le graphique, molette pour zoomer. Un clic ne pose rien.',
    reference: 'Cliquez un point du graphique : il devient le 0. Un nouveau clic le remplace.',
    mesure: 'Cliquez des points du graphique pour mesurer, de suite.',
  };

  function majOutilsProfil() {
    for (const b of document.querySelectorAll('#dlg-profil [data-outil]')) {
      const actif = b.dataset.outil === profil.outil;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-pressed', String(actif));
    }
    $('profil-consigne-outil').textContent = CONSIGNES_OUTIL[profil.outil];
    $('profil-canvas').classList.toggle('outil-deplacement', profil.outil === 'deplacement');
    graphique?.definirOutil(profil.outil);
  }

  /** La ligne de la référence : son altitude, et le bouton qui l'efface — seulement quand elle existe. */
  function afficherReferenceProfil(p) {
    $('profil-reference-ligne').hidden = !p;
    if (p) $('profil-reference-etat').textContent = `Référence : ${p.z.toFixed(1)} m`;
  }

  for (const b of document.querySelectorAll('#dlg-profil [data-outil]')) {
    b.addEventListener('click', () => { profil.outil = b.dataset.outil; majOutilsProfil(); });
  }
  $('profil-reference-effacer').addEventListener('click', () => graphique?.effacerReference());
  // Fermer la fenêtre (croix, Échap) efface la référence : changer la ligne la rendrait caduque.
  $('dlg-profil').addEventListener('close', () => { graphique?.effacerReference(); });
  majOutilsProfil();

  /** La ligne d'état : combien de points, quelle bande, et ce qui peut tromper. */
  function texteEtatProfil(r) {
    const densite = r.total / (r.longueur * r.largeur);
    const avis = [];
    if (r.plafonne) avis.push('échantillon : plafond de points atteint');
    if (r.longueur > CONFIG.profil.longueurAvertM) avis.push('bande longue : la densité dépend du zoom');
    if (densite < CONFIG.profil.densiteMinPtsM2) avis.push('peu de points — zoomez sur la zone puis revalidez');
    return `${milliers(r.n)} points · ${Math.round(r.longueur)} m × ${r.largeur} m · ≈ ${densite.toFixed(1)} pt/m²`
      + (avis.length ? ` · ${avis.join(' · ')}` : '');
  }

  async function calculerProfil() {
    const num = ++profil.numero;
    $('profil-etat').textContent = 'Calcul…';
    let r;
    try {
      r = await relief.profil(profil.A, profil.B, profil.largeur, CONFIG.profil.budgetPoints, [...flux.voulues()]);
    } catch (err) {
      console.error(err);
      if (num === profil.numero) $('profil-etat').textContent = `Le profil n’a pas pu être calculé — ${err.message}`;
      return;
    }
    if (num !== profil.numero) return;   // un calcul plus récent a pris la suite
    if (!graphique) { graphique = new ProfilGraphique($('profil-canvas'), afficherMesureProfil, afficherReferenceProfil); graphique.definirOutil(profil.outil); }
    $('profil-d0').value = 0;
    $('profil-d1').value = 1000;
    if (r.vide) {
      profil.donnees = null;
      graphique.definir(null);
      $('profil-etat').textContent = r.raison;
    } else {
      profil.donnees = { ...r, parClasse: new Map(r.parClasse) };
      graphique.definir(profil.donnees);
      graphique.definirVisibles(visiblesProfil());
      $('profil-etat').textContent = texteEtatProfil(r);
    }
    listerClassesProfil();
    appliquerTrancheProfil();
    afficherMesureProfil([]);
  }

  function validerProfil() {
    if (!profil.A || !profil.B || !PROFIL.verdict(profil.A, profil.B).ok) return Promise.resolve();
    // Les classes de départ sont celles de la légende 3D ; les changer ici ne
    // touche pas la légende.
    profil.masquees = new Set(classesMasquees);
    profil.outil = 'mesure';          // chaque ouverture repart de la mesure, sans référence
    graphique?.effacerReference();
    majOutilsProfil();
    $('dlg-profil').showModal();
    return calculerProfil();
  }

  $('profil-fermer').addEventListener('click', () => $('dlg-profil').close());
  // L'aide : la même pastille « ? » que les autres, mais elle ouvre une fenêtre — une
  // infobulle `title` ne s'affiche pas au toucher, et le profil s'utilise sur téléphone.
  // Depuis la modale du profil, la fenêtre d'aide s'ouvre par-dessus (couche supérieure).
  // Chaque pastille est posée là où le doute arrive (la largeur, la partie de la bande
  // gardée) et ouvre la fenêtre sur l'entrée qui l'explique (`data-aide` = son id).
  const ouvrirAideProfil = (entree) => {
    const d = $('dlg-aide-profil');
    d.showModal();
    // Remise en haut d'abord : sans cela, le focus donné au dernier bouton la fait s'ouvrir défilée.
    d.scrollTop = 0;
    if (entree) $(entree).scrollIntoView({ block: 'start' });
  };
  for (const b of document.querySelectorAll('[data-aide]')) b.addEventListener('click', () => ouvrirAideProfil(b.dataset.aide));
  $('aide-profil-fermer').addEventListener('click', () => $('dlg-aide-profil').close());
  $('aide-profil-croix').addEventListener('click', () => $('dlg-aide-profil').close());
  $('profil-largeur-modale').addEventListener('change', (e) => { fixerLargeur(e.target.value); calculerProfil(); });
  $('profil-classes').addEventListener('change', (e) => {
    const c = e.target.closest('input[data-cls]');
    if (!c || !profil.donnees) return;
    const cls = Number(c.dataset.cls);
    if (c.checked) profil.masquees.delete(cls); else profil.masquees.add(cls);
    graphique.definirVisibles(visiblesProfil());
    majLien();
  });
  // Les deux curseurs de la tranche ne se croisent pas : au moins 1 % d'écart.
  for (const id of ['profil-d0', 'profil-d1']) {
    $(id).addEventListener('input', () => {
      let a = Number($('profil-d0').value), b = Number($('profil-d1').value);
      if (id === 'profil-d0' && a > b - 10) { a = Math.max(0, b - 10); $('profil-d0').value = a; }
      if (id === 'profil-d1' && b < a + 10) { b = Math.min(1000, a + 10); $('profil-d1').value = b; }
      appliquerTrancheProfil();
    });
  }
  // La chaîne de mesure se corrige comme sur la carte : bouton, ou Retour arrière / Suppr.
  $('profil-recadrer').addEventListener('click', () => graphique?.recadrer());
  $('profil-mesure-annuler').addEventListener('click', () => graphique?.retirerDernier());
  $('profil-mesure-effacer').addEventListener('click', () => graphique?.effacerMesure());
  window.addEventListener('keydown', (e) => {
    if (!$('dlg-profil').open || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (profil.outil === 'reference') graphique?.effacerReference();
      else if (profil.outil === 'mesure') graphique?.retirerDernier();
    }
  });
  window.addEventListener('resize', () => { if ($('dlg-profil').open) graphique?.rendre(); });

  // ── Ce que le relief dit sous le curseur ──
  // Une lecture à la fois : pendant qu'elle revient du worker, seul le dernier
  // mouvement est retenu.
  const hud = $('hud-vue');
  let hudEnCours = false, hudProchain = null;
  const lireHud = async () => {
    hudEnCours = true;
    while (hudProchain) {
      const ll = hudProchain;
      hudProchain = null;
      const { x, y } = projVue().versLocal(ll.lng, ll.lat);
      // La valeur de la couche du côté survolé ; côté carte, aucune.
      const cle = cotes[reliefCalque.coteSous(ll.px)];
      const p = await relief.lire(x, y, estRelief(cle) ? cle : undefined);
      if (!ll.dedans) continue;
      hud.hidden = false;
      hud.innerHTML = texteCurseur({ x, y, altitude: null, ...p }, estRelief(cle) ? libelleCouche(cle) : null);
    }
    hudEnCours = false;
  };
  let dedans = false;
  carte.map.on('mousemove', (e) => {
    dedans = true;
    hudProchain = { lng: e.latlng.lng, lat: e.latlng.lat, px: e.containerPoint.x, get dedans() { return dedans; } };
    if (!hudEnCours) lireHud();
  });
  carte.map.on('mouseout', () => { dedans = false; hud.hidden = true; });
  majCotes();
  // Le contraste ne recalcule pas la couche (gardée dans le worker) : seule
  // l'image est refaite.
  $('vue-contraste').addEventListener('input', (e) => {
    contrasteFlux = Number(e.target.value);
    $('val-vue-contraste').textContent = `×${contrasteFlux.toFixed(1)}`;
    planifierRelief(0);
    majLien();   // le contraste est dans le lien
  });
  // Les classes du sol s'appliquent tout de suite : les points sont dans le
  // worker, il n'y a rien à retélécharger — contrairement à l'ancien parcours
  // par dalle, qui ne gardait que ses grilles.
  $('vue-classes-sol').addEventListener('change', () => {
    classesSolFlux = new Set([...$('vue-classes-sol').querySelectorAll('input:checked')].map((i) => Number(i.value)));
    relief.reglages({ classesSol: classesSolFlux });
    planifierRelief(0);
    majLien();   // les classes du sol sont dans le lien (si elles diffèrent du défaut)
  });
  $('recherche').closest('section').querySelector('h2').textContent = 'Lieu';
  VUES[0][3] = 'Zoomez sur une zone : le relief se calcule tout seul · glisser le rideau pour comparer';
  $('aide-vue').textContent = VUES[0][3];

  // ── Le lien du profil : l'état à écrire, et le lien à remettre (R2) ──
  const versGeoProfil = ([x, y]) => {
    const g = projVue().versGeo(x, y);
    return { lat: g.lat, lon: g.lon };
  };

  etatPartageVue = () => {
    const e = { sol: LIEN.sansDefaut(classesSolFlux, CONFIG.raster.classesSolDefaut, dernieresClasses.map(([c]) => c)) };
    if (profil.A && profil.B) {
      e.profil = { a: versGeoProfil(profil.A), b: versGeoProfil(profil.B), largeur: profil.largeur };
    }
    e.vue = reglagesVue();
    return e;
  };

  /**
   * Les réglages de la vue qui diffèrent du défaut — rien d'autre, pour que le lien reste court.
   * Les défauts sont ceux du démarrage : couches carte / SVF, rideau au milieu, contraste ×1,
   * SVF de `CONFIG`, lissage et ombrage de profondeur actifs, couleur par classification,
   * plafond de points de l'appareil.
   */
  const reglagesVue = () => ({
    gauche: cotes.gauche !== 'carte' ? cotes.gauche : undefined,
    droite: cotes.droite !== 'svf' ? cotes.droite : undefined,
    rideau: Math.round(reliefCalque.partRideau() * 100) !== 50 ? reliefCalque.partRideau() * 100 : undefined,
    contraste: contrasteFlux !== 1 ? contrasteFlux : undefined,
    svf: svfDirections !== CONFIG.relief.svfDirections || svfRayonM !== CONFIG.relief.svfRayonM
      ? { directions: svfDirections, rayon: svfRayonM } : undefined,
    soleil: ombrageAzimut !== CONFIG.relief.ombrageAzimut || ombrageHauteur !== CONFIG.relief.ombrageHauteur
      ? { azimut: ombrageAzimut, hauteur: ombrageHauteur } : undefined,
    lisse: lisserFlux ? undefined : false,
    couleur: CONFIG.rendu.coloration !== 'classification' ? CONFIG.rendu.coloration : undefined,
    plafond: budget3D !== (surMobile() ? CONFIG.rendu.budget3DMobile : CONFIG.rendu.budget3D) ? budget3D / 1e6 : undefined,
    edl: $('vue-edl').checked ? undefined : false,
    cachees: classesMasquees.size ? [...classesMasquees] : undefined,
  });

  /**
   * Remet les réglages d'un lien en passant par les vrais contrôles : leurs gestionnaires font le
   * reste (recalcul, étiquettes, lien), et rien ne diverge de ce qu'un clic aurait fait. Une couche
   * absente de la liste est ignorée ; un curseur ramène lui-même une valeur hors bornes dans les siennes.
   */
  function reglerVue(v) {
    const regler = (id, valeur, evenement) => {
      const e = $(id);
      e.value = valeur;
      e.dispatchEvent(new Event(evenement, { bubbles: true }));
    };
    const aOption = (id, valeur) => [...$(id).options].some((o) => o.value === valeur);
    for (const c of ['gauche', 'droite']) {
      if (v[c] && aOption(`vue-${c}`, v[c])) regler(`vue-${c}`, v[c], 'change');
    }
    if (v.rideau !== undefined) reliefCalque.placerRideau(v.rideau / 100);
    if (v.contraste !== undefined) regler('vue-contraste', v.contraste, 'input');
    if (v.svf) {
      regler('vue-svf-directions', v.svf.directions, 'change');
      regler('vue-svf-rayon', v.svf.rayon, 'change');
    }
    if (v.soleil) {
      regler('vue-ombrage-azimut', v.soleil.azimut, 'change');
      regler('vue-ombrage-hauteur', v.soleil.hauteur, 'change');
    }
    if (v.lisse === false) {
      $('vue-lisser').checked = false;
      $('vue-lisser').dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (v.couleur) $('coloration').querySelector(`[data-mode="${v.couleur}"]`)?.click();
    if (v.plafond !== undefined) regler('vue-budget3d', v.plafond, 'change');
    if (v.edl === false) {
      $('vue-edl').checked = false;
      $('vue-edl').dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (v.cachees) {
      classesMasquees.clear();
      for (const c of v.cachees) classesMasquees.add(c);
      vue3d?.definirClassesMasquees(classesMasquees);
      majLegende();
    }
  }

  /**
   * Remet ce que le lien ouvert porte : classes du sol, point sélectionné, bande (la fenêtre
   * flottante prête à « Valider » : la modale ne s'ouvre jamais d'elle-même). Un paramètre refusé à la lecture n'arrive pas jusqu'ici (`LIEN.lirePartage`).
   */
  async function appliquerPartage() {
    const p = partageEnAttente;
    partageEnAttente = null;
    if (!p) { etat.restaurationPartage = false; return; }
    const lien = LIEN.lire(location.hash);
    try {
      // Le territoire d'abord : il donne la projection des coordonnées du lien.
      const ancre = p.profil?.a ?? p.sel;
      const terr = ancre && PROJ.territoireAuPoint(ancre.lon, ancre.lat);
      if (terr) {
        if (terr.code !== territoireVue) effacerProfil();
        territoireVue = terr.code;
      }
      if (p.sol) {
        classesSolFlux = new Set(p.sol);
        for (const i of $('vue-classes-sol').querySelectorAll('input')) i.checked = classesSolFlux.has(Number(i.value));
        relief.reglages({ classesSol: classesSolFlux });
        planifierRelief(0);
      }
      if (p.vue) reglerVue(p.vue);
      if (p.sel) {
        const l = projVue().versLocal(p.sel.lon, p.sel.lat);
        // Sans relief calculé là, l'altitude arrive avec l'image suivante (voir plus haut).
        const pt = lireVue ? await lireVue(l.x, l.y) : null;
        afficherSelection(l.x, l.y, pt?.altitude ?? null, pt?.hauteur ?? 0);
      }
      if (p.regle) {
        // Les points reviennent avec leur altitude relue dans la vue calculée (jamais écrite dans le lien).
        const pts = [];
        for (const q of p.regle) {
          const l = projVue().versLocal(q.lon, q.lat);
          const pt = lireVue ? await lireVue(l.x, l.y) : null;
          pts.push({ x: l.x, y: l.y, sol: pt?.altitude ?? null, hauteur: pt?.hauteur ?? 0 });
        }
        pointsMesure = pts;
        afficherMesure();
        if (!p.profil) definirModeInteraction('mesure');
      }
      if (p.profil) {
        // Un lien avec une bande remplace celle qui était là.
        if ($('dlg-profil').open) $('dlg-profil').close();
        effacerProfil();
        const a = projVue().versLocal(p.profil.a.lon, p.profil.a.lat);
        const b = projVue().versLocal(p.profil.b.lon, p.profil.b.lat);
        profil.A = [a.x, a.y];
        profil.B = [b.x, b.y];
        profil.largeur = PROFIL.largeurValide(p.profil.largeur);
        if (PROFIL.verdict(profil.A, profil.B).ok) {
          dessinerProfil();
          majFenetreProfil();
          definirModeInteraction('profil');
        } else {
          effacerProfil();   // trop courte ou trop longue : ignorée, comme un lien abîmé
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      etat.restaurationPartage = false;
      majLien();
    }
  }
  appliquerPartageVue = appliquerPartage;
  if (partageEnAttente) appliquerPartage();

  carte.map.on('moveend', majVueFlux);
  majVueFlux();
  // Pour la console et les harnais, en diagnostic seulement.
  if (diagnostic) {
    window.fluxDeControle = flux;
    window.reliefDeControle = relief;
    window.vue3dDeControle = vue3d;
  }
})();

// Un hash non vide veut dire qu'on arrive par un lien qui désigne déjà une
// destination : s'interposer serait une gêne. Les anciens liens `#d=x,y`, qui
// ne portaient que la dalle, restent lisibles ; la carte réécrit ensuite le
// fragment au format courant dès qu'elle bouge.
function suivreLien() {
  const lien = LIEN.lire(location.hash);
  if (lien?.dalle && MODE_VUE) {
    // Un ancien lien « #d=x,y » : le centre de la dalle, au zoom où l'on lit.
    const c = PROJ.versWGS84(lien.dalle.x * 1000 + 500, lien.dalle.y * 1000 + 500);
    ouvrirLien({ lon: c.lon, lat: c.lat, zoom: 16 });
  } else if (lien?.dalle) selectionnerDalleParIndices(lien.dalle.x, lien.dalle.y);
  else if (lien) ouvrirLien(lien);
}
if (location.hash.length > 1) {
  masquerAccueil();
  suivreLien();
}
// Un fragment modifié à la main dans la barre d'adresse — ou par un greffon —
// ne recharge pas la page : on le suit quand même. `replaceState` ne déclenche
// pas cet évènement, nos propres écritures n'y repassent donc pas.
window.addEventListener('hashchange', () => {
  masquerAccueil();
  basculerVue('carte');
  suivreLien();
});

})();
