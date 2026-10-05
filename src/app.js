// Assemblage : relie la carte, le chargeur COPC, la vue 3D et la détection.
//
// Enveloppé dans une IIFE : sans modules ES, tout ce qui est déclaré au premier
// niveau d'un script devient global. Rien ici n'a vocation à sortir.

(() => {
'use strict';

const $ = (id) => document.getElementById(id);

const etat = {
  // Un lien du profil est en train de se remettre (carte cadrée, points chargés, modale rouverte) :
  // ne pas réécrire le fragment d'ici là, il perdrait ce qu'il porte encore.
  restaurationPartage: false,
  // Le nuage 3D affiché (voir `construire3D`), ou null.
  nuage: null,
};

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

// ── Le curseur ──────────────────────────────────────────────────────────────

/**
 * Ce que le relief dit sous le curseur, en une ligne : position, sol, hauteur
 * de ce qui s'y dresse, et la valeur de la couche nommée. La couche est celle
 * du côté survolé : sous le curseur il n'y a qu'une image, et dire laquelle
 * évite de lire une valeur pour une autre.
 */
function texteCurseur(p, nomCouche) {
  return `x ${p.x.toFixed(0)} · y ${p.y.toFixed(0)}`
    + (p.altitude == null ? ' · sol inconnu' : ` · sol ${p.altitude.toFixed(1)} m`)
    + (p.hauteur > 0.05 ? ` · <b>+${p.hauteur.toFixed(2)} m</b>` : '')
    + (nomCouche != null && p.valeur != null && Number.isFinite(p.valeur)
      ? ` · ${echapper(nomCouche)} <b>${p.valeur.toFixed(2)}</b>` : '');
}


// ── Sélection d'un point (#4) ────────────────────────────────────────────────
//
// Un mode partagé par les onglets 2D et 3D, activé par la sous-barre sous les
// onglets : par défaut on déplace la vue, en « Sélection » un clic vise un
// point plutôt que la vue elle-même. En 3D, ce point ne vient pas du plan
// horizontal qui sert au déplacement de la caméra (`ControlesVue3D._pointSousCurseur`, une
// approximation délibérée) mais d'une marche du rayon caméra contre le MNT
// affiché — `etat.reliefGrille`, déjà calculé pour l'onglet 2D.

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
let majOutilsCarte = null;   // grise les outils quand la carte est en mode « deux cartes » ; rappelé à chaque changement d'onglet
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

  // Même point sur la carte et en 3D : passer de l'une à l'autre retrouve le marqueur au même endroit.
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
  const terr = PROJ.territoireAuPoint(p.lon, p.lat);
  if (!terr) {
    alerter('Ces coordonnées sont hors des territoires couverts par le LiDAR HD.');
    return;
  }
  if (terr.code !== territoireVue) surChangementTerritoire?.();
  territoireVue = terr.code;
  const lambert = projVue().versLocal(p.lon, p.lat);
  // La carte va au point, et l'altitude se lit dans le relief — tout de suite s'il est déjà calculé là,
  // sinon dès la prochaine image.
  if (!lireVue) { afficherSelection(lambert.x, lambert.y, null, 0); return; }
  carte.allerA(p.lon, p.lat, Math.max(carte.map.getZoom(), 17));
  const pt = await lireVue(lambert.x, lambert.y);
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
  return vue3d.pointDuNuage(rayon, classesMasquees);
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
  if (modeOutil !== 'mesure' || !pointsMesure.length) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); retirerDernierPointMesure(); }
});

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
// l'onglet affiché : la carte, ou le point visé et les angles de la caméra 3D.

/** La vue de l'onglet affiché, dans les termes du lien. `null` si rien à dire. */
function vueCourante() {
  const onglet = $('panneau').dataset.vue;
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
  const e = etatPartageVue ? etatPartageVue() : {};
  if (selectionActuelle) e.sel = { lat: selectionActuelle.lat, lon: selectionActuelle.lon };
  if (pointsMesure.length) {
    e.regle = pointsMesure.map((q) => { const g = projVue().versGeo(q.x, q.y); return { lat: g.lat, lon: g.lon }; });
  }
  return e;
}

/** Un lien ouvert : s'il porte quelque chose de la coupe ou de la sélection, le remettre. */
function demanderPartage(partage) {
  if (!partage || !Object.keys(partage).length) return;
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

/** Ouvre un lien : le lien cadre la carte, et le relief de la vue suit. */
function ouvrirLien(lien) {
  requestAnimationFrame(() => { carte.invalider(); carte.map.setView([lien.lat, lien.lon], lien.zoom); });
  demanderPartage(LIEN.lirePartage(location.hash));
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

// « &debug » ou « &chrono » : les chiffres de diagnostic (statut, HUD 3D).
const DIAGNOSTIC = ['debug', 'chrono'].some((p) => new URLSearchParams(location.search).has(p));

// ── Carte ───────────────────────────────────────────────────────────────────

const carte = new Carte($('vue-carte'));
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
  statut(lieu.label);
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
 * Recharge l'attribut par point que le mode courant consomme : la hauteur au-dessus du sol ou la valeur de la
 * couche de relief drapée (même tampon de sommet, réécrit au changement de mode — un second attribut coûterait
 * 18 Mo de mémoire graphique pour une donnée dont on n'a jamais besoin des deux à la fois). Voir `majAttributVue`.
 */
async function majAttributNuage() {
  await majAttributVue?.();
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

function majHUD() {
  if (!etat.nuage) { $('hud').textContent = ''; return; }
  const e = etat.nuage.emprise;
  $('hud').innerHTML = `${milliers(etat.nuage.n)} points · ${Math.round(e.xmax - e.xmin)} × ${Math.round(e.ymax - e.ymin)} m<br>`
    + `altitudes ${(etat.nuage.origine[2] + etat.nuage.zmin).toFixed(0)} – ${(etat.nuage.origine[2] + etat.nuage.zmax).toFixed(0)} m`
    // Avec &debug ou &chrono : la part dessinée pendant le dernier geste.
    + (DIAGNOSTIC && vue3d?.dernierMouvement
      ? `<br>en mouvement : ${milliers(vue3d.dernierMouvement.dessines)} points`
        + ` (${Math.round((100 * vue3d.dernierMouvement.dessines) / vue3d.dernierMouvement.total)} %)` : '');
}

// ── Onglets ─────────────────────────────────────────────────────────────────

const VUES = [
  ['carte', 'cartes', 'onglet-carte',
    'Zoomez sur une zone : le relief se calcule tout seul · glisser le rideau pour comparer'],
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
  // Le profil se pose sur la carte : en 3D le bouton est grisé, et le mode
  // quitté s'il était actif.
  $('mode-profil').disabled = quoi !== 'carte';
  if (quoi !== 'carte' && modeOutil === 'profil') { definirModeInteraction('deplacement', true); profilAReprendre = true; }
  // Retour sur la carte : le mode Profil revient, avec sa fenêtre, si rien d'autre n'a été choisi entre-temps.
  if (quoi === 'carte' && profilAReprendre && modeOutil === 'deplacement') definirModeInteraction('profil', true);
  if (quoi === 'carte') profilAReprendre = false;

  // Leaflet mesure son conteneur à l'initialisation ; masqué, il l'a mesuré à
  // zéro et n'affiche aucune tuile tant qu'on ne le lui redit pas.
  if (quoi === 'carte') { requestAnimationFrame(() => carte.invalider()); surPassageCarte?.(); }
  else if (quoi === '3d') { vue3d?.invalider(); surPassage3D?.(); }
  majOutilsCarte?.();
  majLien();   // le lien décrit l'onglet affiché
}

$('onglet-carte').addEventListener('click', () => basculerVue('carte'));
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
  if (e.key === 'f') vue3d?.cadrer();
  if (e.key === 't') { vue3d?.controles.vueDeDessus(); basculerVue('3d'); }
});

$('btn-dessus').addEventListener('click', () => { vue3d?.controles.vueDeDessus(); basculerVue('3d'); });
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

$('btn-exemple').addEventListener('click', () => {
  masquerAccueil();
  basculerVue('carte');
  // Le Bois des Caures cadré : le relief de la vue arrive seul.
  const { x, y } = CONFIG.carte.dalleExemple;
  const c = PROJ.versWGS84(x * 1000 + 500, y * 1000 + 500);
  requestAnimationFrame(() => { carte.invalider(); carte.allerA(c.lon, c.lat, 16); });
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
// (CalqueRelief).
// Diagnostic : « &debug » (contours des blocs, statut chiffré), « &chrono »
// (temps du fil principal, gels détaillés).
(async () => {
  // La 3D : le nuage de la zone vue sur la carte (spec 2026-09-27-vue-3d-design). Sans WebGL2, elle reste
  // désactivée, y compris aux raccourcis clavier, que basculerVue refuse pour un onglet désactivé.
  $('onglet-3d').disabled = !vue3d;

  // Le chronométrage (« &chrono », diagnostic) : voir chrono.js.
  const { actif: chronometrer, activite, mesurer } = creerChrono({
    actif: new URLSearchParams(location.search).has('chrono'), FLUX_CHOIX, COPC, CalqueRelief, CalqueFlux,
  });

  // Les contours des blocs chargés, pour voir le chargement : « &debug ».
  const calque = new URLSearchParams(location.search).has('debug') ? new CalqueFlux().addTo(carte.map) : null;
  const reliefCalque = new CalqueRelief().addTo(carte.map);
  // Le repère du curseur de l'autre carte : un petit cercle (un élément du DOM, pas du canevas) posé sur la carte qu'on ne survole pas.
  const faireRepere = (map) => {
    let marque = null;
    return {
      deplacer(ll) {
        if (marque) marque.setLatLng(ll);
        else marque = L.marker(ll, { icon: L.divIcon({ className: 'repere-curseur', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, keyboard: false }).addTo(map);
      },
      cacher() { if (marque) { marque.remove(); marque = null; } },
    };
  };
  const idsModes = { scinde: 'mode-carte-scinde', unique: 'mode-carte-unique', double: 'mode-carte-double' };
  // L'effet des modes dans la page (la fabrique des cartes n'en sait rien).
  const affichageCartes = {
    montrerSecondaire(oui) {
      $('vue-carte-b').hidden = !oui;
      $('cartes').classList.toggle('double', oui);
    },
    marquerMode(mode) {
      for (const [m, id] of Object.entries(idsModes)) {
        $(id).classList.toggle('actif', m === mode);
        $(id).setAttribute('aria-pressed', String(m === mode));
      }
    },
  };
  // Les cartes (volets, modes, crédits réunis) : voir vue-cartes.js ; `app.js` fournit ce qui leur est étranger.
  $('modes-carte').hidden = false;
  const vueCartes = creerVueCartes({
    carte, calquePrincipal: reliefCalque, VOLETS, MODE_CARTE, SYNCHRO,
    // Créée visible (Leaflet mesure son conteneur), la photo en fond comme la carte principale.
    creerCarteSecondaire: ({ centre, zoom }) => {
      const map = L.map($('vue-carte-b'), { preferCanvas: true, maxZoom: CONFIG.carte.zoomMax });
      map.setView(centre, zoom, { animate: false });
      carte.nouveauFond('ortho').addTo(map);
      return map;
    },
    creerCalque: (map) => new CalqueRelief().addTo(map),
    creerRepere: faireRepere,
    brancherCurseur: (map, volet) => brancherCurseurHud(map, volet),
    surDeplacement: () => majLien(),
    affichage: affichageCartes,
    oublierFond: (cote) => { fondsPoses[cote] = null; },
    // Le panneau et les fonds suivent les côtés affichés ; la zone à charger suit la taille de la carte.
    apres: () => { majOutils(); majCotes(); majVueFlux(); majLien(); },
  });
  const voletDe = vueCartes.voletDe;
  // Les outils (sélection, mesure, profil) sont liés à la carte principale : grisés quand la carte est en
  // deux cartes (première version), de retour sinon.
  const majOutils = () => {
    const surCarte = $('panneau').dataset.vue === 'carte';
    const double = vueCartes.mode() === 'double' && surCarte;
    if (double && modeOutil !== 'deplacement') definirModeInteraction('deplacement');
    for (const id of ['mode-selection', 'mode-mesure', 'mode-profil']) $(id).disabled = double || (id === 'mode-profil' && !surCarte);
  };
  majOutilsCarte = majOutils;
  for (const [m, id] of Object.entries(idsModes)) $(id).addEventListener('click', () => vueCartes.changerMode(m));
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
  const OMBRAGE_RGB = 'ombrage-rgb';
  const COUCHES_VUE = [
    ...RELIEF.COUCHES.map((c) => ({ cle: c.cle, libelle: c.libelle, aide: c.aide })),
    // L'ombrage coloré ne suit pas le contrat de `RELIEF.calculer` (palette + étalement) : il rend directement des couleurs.
    { cle: OMBRAGE_RGB, libelle: 'Ombrage coloré (3 soleils)', aide: 'Trois soleils à 120°, un par canal — l’orientation d’un mur ou d’un talus se lit en teinte, là où « Ombrage » l’aplatit dans une moyenne grise.' },
  ];
  // Ce qui n'est pas du relief : la carte telle qu'affichée, et le Plan IGN,
  // posé dans le côté même — la carte n'a qu'un fond à la fois, et ainsi un
  // côté peut montrer la photo et l'autre le plan.
  const FONDS_VUE = {
    carte: 'Photo aérienne', plan: 'Plan IGN',
    'mnt-ign': 'MNT ombré (IGN)', 'mns-ign': 'MNS ombré (IGN)',
    [FONDS_OSM.standard.cle]: FONDS_OSM.standard.libelle,
  };
  // Les fonds de tuiles posés dans le volet de leur côté, avec leurs réglages propres :
  // l'estompage de l'IGN n'est servi que jusqu'au niveau 18, au-delà la tuile est agrandie.
  const TUILES_VUE = { plan: {}, 'mnt-ign': { maxNativeZoom: 18 }, 'mns-ign': { maxNativeZoom: 18 }, [FONDS_OSM.standard.cle]: {} };
  const AIDES_FONDS = {
    [FONDS_OSM.standard.cle]: FONDS_OSM.standard.aide(location.protocol),
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
        voletDe(cote).calque.definirLibelle(cote, 'Pas de LiDAR HD ici');
        voletDe(cote).calque.vider(cote);
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
    const aCalculer = MODE_CARTE.cotesAffiches(vueCartes.mode()).filter((c) => estRelief(cotes[c]));
    for (const c of ['gauche', 'droite']) {
      voletDe(c).calque.definirLibelle(c, tropLarge && estRelief(cotes[c]) ? 'Zoomez pour calculer le relief' : libelleCouche(cotes[c]));
    }
    if (!vueCourante || tropLarge || !aCalculer.length) {
      // Gardée seulement si c'est bien la couche du côté : après un
      // changement de couche, l'ancienne image mentirait sous le libellé.
      for (const c of aCalculer) if (derniersEtirements[c]?.cle !== cotes[c]) voletDe(c).calque.vider(c);
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
      // Un écran et des bornes par volet (une carte chacun).
      const ecrans = new Map(vueCartes.volets().map((v) => {
        const z = v.carte.getZoom();
        const pb = v.carte.getPixelBounds();
        return [v, {
          ecran: VOLETS.ecran(pb, z, territoireVue),
          bornes: L.latLngBounds(v.carte.unproject(pb.getBottomLeft(), z), v.carte.unproject(pb.getTopRight(), z)),
        }];
      }));
      const actifs = [...flux.voulues()];
      erreurRelief = '';
      const textes = [];
      // Un côté après l'autre : la surface est rangée une fois pour les deux,
      // seule la couche change (gardée par le worker d'un calcul à l'autre).
      for (const c of aCalculer) {
        const cle = cotes[c];
        const volet = voletDe(c);
        const { ecran, bornes } = ecrans.get(volet);
        const r = await relief.image(geo, cle, ecran, lutCouche(cle), {
          contraste: contrasteFlux, lisser: lisserFlux, actifs, couche: reglagesDe(cle),
        });
        if (cotes[c] !== cle) continue;   // le côté a changé pendant le calcul
        if (!r) { volet.calque.vider(c); continue; }
        volet.calque.afficher(c, r, bornes);
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
    const cotesVus = MODE_CARTE.cotesAffiches(vueCartes.mode());
    // Le panneau suit le mode : une seule liste (« Couche affichée ») ou deux, avec ou sans échange et rideau à centrer.
    const pan = MODE_CARTE.panneau(vueCartes.mode());
    $('vue-gauche-libelle').textContent = pan.libelleGauche;
    $('vue-droite-champ').hidden = !pan.listeDroite;
    $('vue-echanger').hidden = !pan.echanger;
    $('vue-rideau-centre').hidden = !pan.rideauAuCentre;
    $('vue-rangee-rideau').hidden = !pan.echanger && !pan.rideauAuCentre;
    for (const c of ['gauche', 'droite']) {
      const calque = voletDe(c).calque;
      $(`vue-${c}`).value = cotes[c];
      calque.definirActif(c, cotes[c] !== 'carte');
      // Reposé seulement s'il change : recréer la couche rechargerait toutes
      // ses tuiles à chaque changement de l'autre côté.
      // Un côté qu'on ne voit pas (une seule carte) ne charge pas de tuiles pour rien.
      const voulu = cotes[c] in TUILES_VUE && cotesVus.includes(c) ? cotes[c] : null;
      if (fondsPoses[c] !== voulu) {
        fondsPoses[c] = voulu;
        calque.definirFond(c, voulu
          ? carte.nouveauFond(voulu, { pane: c === 'gauche' ? 'reliefGauche' : 'reliefDroite', ...TUILES_VUE[voulu] }) : null);
      }
      calque.definirLibelle(c, libelleCouche(cotes[c]));
    }
    // L'aide de la couche de relief affichée — celle de droite par défaut,
    // côté du relief par convention.
    const cle = cotesVus.includes('droite') && estRelief(cotes.droite) ? cotes.droite : cotes.gauche;
    const fondAide = [...cotesVus].reverse().map((c) => cotes[c]).find((k) => AIDES_FONDS[k]);
    $('vue-aide').textContent = estRelief(cle) ? COUCHES_VUE.find((x) => x.cle === cle).aide
      : fondAide ? AIDES_FONDS[fondAide] : 'Choisissez une couche de relief d’un côté du rideau.';
    $('vue-svf-reglages').hidden = !cotesVus.some((c) => BALAYAGE.has(cotes[c]));
    $('vue-ombrage-reglages').hidden = !cotesVus.some((c) => OMBRAGES.has(cotes[c]));
    // L'azimut ne change rien à l'ombrage à quatre soleils (opposés deux à deux, leur part
    // directionnelle s'annule) : grisé quand aucun côté n'en porte d'autre.
    const ombragesPoses = cotesVus.map((c) => cotes[c]).filter((k) => OMBRAGES.has(k));
    const sansEffet = ombragesPoses.length > 0 && ombragesPoses.every((k) => k === 'ombrage');
    $('vue-ombrage-azimut').disabled = sansEffet;
    $('vue-ombrage-note').hidden = !sansEffet;
    majLien();   // les couches de chaque côté sont dans le lien
  };
  for (const c of ['gauche', 'droite']) {
    const sel = $(`vue-${c}`);
    // Rangées par famille (des <optgroup>) : la liste porte une quinzaine de choix.
    const choix = [
      ...Object.entries(FONDS_VUE).map(([cle, libelle]) => ({ cle, libelle })),
      ...COUCHES_VUE.map((k) => ({ cle: k.cle, libelle: k.libelle })),
    ];
    for (const g of CHOIX_COUCHES.groupes(choix)) {
      const groupe = document.createElement('optgroup');
      groupe.label = g.titre;
      for (const { cle, libelle } of g.couches) groupe.appendChild(new Option(libelle, cle));
      sel.appendChild(groupe);
    }
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
  // « Réinitialiser » : grisé tant que le soleil est celui du défaut (rien à remettre).
  const majReinitSoleil = () => { $('vue-ombrage-reinit').disabled = RELIEF.soleilEstParDefaut(ombrageAzimut, ombrageHauteur); };
  $('vue-ombrage-reinit').addEventListener('click', () => {
    const d = RELIEF.soleilParDefaut();
    ombrageAzimut = d.azimut;
    ombrageHauteur = d.hauteur;
    $('vue-ombrage-azimut').value = d.azimut;
    $('val-vue-ombrage-azimut').textContent = `${d.azimut}°`;
    $('vue-ombrage-hauteur').value = d.hauteur;
    $('val-vue-ombrage-hauteur').textContent = `${d.hauteur}°`;
    majReinitSoleil();
    planifierRelief(0);
    majLien();
  });
  $('vue-ombrage-azimut').addEventListener('change', (e) => { ombrageAzimut = Number(e.target.value); $('val-vue-ombrage-azimut').textContent = `${e.target.value}°`; majReinitSoleil(); planifierRelief(0); majLien(); });
  $('vue-ombrage-hauteur').addEventListener('input', (e) => { $('val-vue-ombrage-hauteur').textContent = `${e.target.value}°`; });
  $('vue-ombrage-hauteur').addEventListener('change', (e) => { ombrageHauteur = Number(e.target.value); $('val-vue-ombrage-hauteur').textContent = `${e.target.value}°`; majReinitSoleil(); planifierRelief(0); majLien(); });
  majReinitSoleil();
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
  surPassageCarte = () => { vueCartes.cartes()[1]?.invalidateSize(); planifierRelief(0); };

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
  const { traceOutils, versLatLng, selection, mesure } = creerOutilsCarte({ carte, projVue, MESURE });
  carteOutils = { selection, mesure };
  // Un clic (pas un glisser : Leaflet ne l'émet pas après un déplacement)
  // vise un point en mode Sélection ou Mesure, et pose un point de la bande en mode Profil.
  carte.map.on('click', async (e) => {
    const mode = modeOutil;
    if (mode === 'profil') { poserPointProfil(e.latlng); return; }
    if (mode !== 'selection' && mode !== 'mesure') return;
    const { x, y } = projVue().versLocal(e.latlng.lng, e.latlng.lat);
    const pt = await relief.lire(x, y);
    if (mode === 'selection') afficherSelection(x, y, pt?.altitude ?? null, pt?.hauteur ?? 0);
    else ajouterPointMesure(x, y, pt?.altitude ?? null, pt?.hauteur ?? 0);
  });

  // ── Le profil : la bande sur la carte, puis la coupe dans la modale (profil-ui.js) ──
  const profilUI = creerProfilUI({ $, carte, traceOutils, versLatLng, projVue, majLien, relief, flux, classesMasquees, milliers, NOMS_CLASSES });
  const profil = profilUI.etat;
  const { poserPoint: poserPointProfil, effacer: effacerProfil, dessiner: dessinerProfil, majFenetre: majFenetreProfil } = profilUI;
  surChangementTerritoire = effacerProfil;
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
      const cle = cotes[VOLETS.coteSous(ll.volet, ll.px)];
      const p = await relief.lire(x, y, estRelief(cle) ? cle : undefined);
      if (!ll.dedans) continue;
      hud.hidden = false;
      hud.innerHTML = texteCurseur({ x, y, altitude: null, ...p }, estRelief(cle) ? libelleCouche(cle) : null);
    }
    hudEnCours = false;
  };
  let dedans = false;
  // Un branchement par carte : ce que le relief dit sous le curseur, pour la couche du côté survolé.
  const brancherCurseurHud = (map, volet) => {
    map.on('mousemove', (e) => {
      dedans = true;
      hudProchain = { lng: e.latlng.lng, lat: e.latlng.lat, px: e.containerPoint.x, volet, get dedans() { return dedans; } };
      if (!hudEnCours) lireHud();
    });
    map.on('mouseout', () => { dedans = false; hud.hidden = true; });
  };
  brancherCurseurHud(carte.map, vueCartes.volets()[0]);
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
    rideau: vueCartes.mode() !== 'double' && Math.round(reliefCalque.partRideau() * 100) !== 50 ? reliefCalque.partRideau() * 100 : undefined,
    cartes: vueCartes.mode() === 'double' ? 2 : undefined,
    contraste: contrasteFlux !== 1 ? contrasteFlux : undefined,
    svf: svfDirections !== CONFIG.relief.svfDirections || svfRayonM !== CONFIG.relief.svfRayonM
      ? { directions: svfDirections, rayon: svfRayonM } : undefined,
    soleil: RELIEF.soleilEstParDefaut(ombrageAzimut, ombrageHauteur) ? undefined
      : { azimut: ombrageAzimut, hauteur: ombrageHauteur },
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
    if (v.cartes === 2) vueCartes.changerMode('double');
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
  if (lien?.dalle) {
    // Un ancien lien « #d=x,y » : le centre de la dalle, au zoom où l'on lit.
    const c = PROJ.versWGS84(lien.dalle.x * 1000 + 500, lien.dalle.y * 1000 + 500);
    ouvrirLien({ lon: c.lon, lat: c.lat, zoom: 16 });
  } else if (lien) ouvrirLien(lien);
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
