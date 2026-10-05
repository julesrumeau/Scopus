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

// ── Lien partageable (partage.js) ───────────────────────────────────────────
const partage = creerPartage({ $, LIEN, carte: () => carte, vue3d, etat, projVue: () => projVue(), statut, outils: () => outils });
const { majLien, ouvrirLien } = partage;

// ── Soutenir ────────────────────────────────────────────────────────────────
//
// Le bouton vers Ko-fi : le bouton vers Ko-fi (don ponctuel), Liberapay en petit lien
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

// ── Recherche de lieu (recherche-lieu.js) ─────────────────────────────────
creerRechercheLieu({ $, IGN, carte, statut, alerterPanne });

// Classes masquées à l'affichage. Persiste d'un nuage à l'autre : on ne veut
// pas rétablir la végétation à chaque dalle quand on l'a écartée une fois.
const classesMasquees = new Set();

// ── Les outils du clic : déplacement, sélection, mesure (outils-point.js) ────────
const outils = creerOutilsPoint({
  $, vue3d, MESURE, IGN, PROJ, carte, projVue: () => projVue(), majLien: () => majLien(), statut, alerter,
  classesMasquees: () => classesMasquees, ligneDetail,
  territoire: { lire: () => territoireVue, ecrire: (code) => { territoireVue = code; } },
  surChangementTerritoire: () => surChangementTerritoire?.(),
});


const NOMS_CLASSES = {
  1: 'non classé', 2: 'sol', 3: 'végét. basse', 4: 'végét. moyenne',
  5: 'végét. haute', 6: 'bâtiment', 9: 'eau', 17: 'pont',
  64: 'sursol pérenne', 66: 'point virtuel', 67: 'divers',
};

// ── L'affichage de la 3D (panneau-3d.js) ───────────────────────────────────
const panneau3D = creerPanneau3D({ $, vue3d, etat, CONFIG, SORTIE, classesMasquees, NOMS_CLASSES, milliers, octets, majLien: () => majLien(), DIAGNOSTIC });
const { majLegende, majHUD, majAttributNuage } = panneau3D;


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
  outils.changerOnglet(quoi);

  // Leaflet mesure son conteneur à l'initialisation ; masqué, il l'a mesuré à
  // zéro et n'affiche aucune tuile tant qu'on ne le lui redit pas.
  if (quoi === 'carte') { requestAnimationFrame(() => carte.invalider()); surPassageCarte?.(); }
  else if (quoi === '3d') { vue3d?.invalider(); surPassage3D?.(); }
  majOutilsCarte?.();
  majLien();   // le lien décrit l'onglet affiché
}

$('onglet-carte').addEventListener('click', () => basculerVue('carte'));
$('onglet-3d').addEventListener('click', () => basculerVue('3d'));

// ── Le panneau sous 900 px (panneau-mobile.js) ─────────────────────────────
creerPanneauMobile({ $ });

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (!$('accueil').hidden) return;   // l'accueil couvre tout : rien à piloter dessous
  if ($('dlg-profil').open || $('dlg-aide-profil').open) return;   // la modale du profil, et son aide, couvrent tout aussi
  // Un chiffre par vue, plus les initiales.
  if (e.key === 'c' || e.key === '1') basculerVue('carte');
  if (e.key === 'v' || e.key === '3') basculerVue('3d');
  if (e.key === 'f') vue3d?.cadrer();
  if (e.key === 't') { vue3d?.controles.vueDeDessus(); basculerVue('3d'); }
});

$('btn-dessus').addEventListener('click', () => { vue3d?.controles.vueDeDessus(); basculerVue('3d'); });
$('btn-cadrer').addEventListener('click', () => { vue3d?.cadrer(); basculerVue('3d'); });

// ── Page d'accueil (accueil.js) ─────────────────────────────────────────────
const { masquerAccueil } = creerAccueil({ $, carte, basculerVue, CONFIG, PROJ });

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
    oublierFond: (cote) => panneau.oublierFond(cote),
    // Le panneau et les fonds suivent les côtés affichés ; la zone à charger suit la taille de la carte.
    apres: () => { majOutils(); majCotes(); majVueFlux(); majLien(); },
  });
  const voletDe = vueCartes.voletDe;
  // Les outils (sélection, mesure, profil) sont liés à la carte principale : grisés quand la carte est en
  // deux cartes (première version), de retour sinon.
  const majOutils = () => {
    const surCarte = $('panneau').dataset.vue === 'carte';
    const double = vueCartes.mode() === 'double' && surCarte;
    if (double && outils.mode() !== 'deplacement') outils.definirMode('deplacement');
    for (const id of ['mode-selection', 'mode-mesure', 'mode-profil']) $(id).disabled = double || (id === 'mode-profil' && !surCarte);
  };
  majOutilsCarte = majOutils;
  for (const [m, id] of Object.entries(idsModes)) $(id).addEventListener('click', () => vueCartes.changerMode(m));
  // La position du rideau est dans le lien : le geste (et « Rideau au centre ») passent par
  // `placerRideau`, qu'on enveloppe sur cette instance.
  const placerRideauSeul = reliefCalque.placerRideau.bind(reliefCalque);
  reliefCalque.placerRideau = (part) => { placerRideauSeul(part); majLien(); };
  // Le calcul du relief tourne dans un worker (relief-travailleur.js), sinon il figeait la carte ; s'il ne démarre
  // pas, il se fait ici. Le rangement des points y est au processeur (sur la carte graphique la page gelait, 0,5 à
  // 11 s, mesuré avec &chrono) ; les couches (SVF…) passent par la carte graphique. « &cpu » : tout au processeur ;
  // « &gpu » : tout sur la carte, pour comparer.
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

  let dernierEtat = null, vueCourante = null, etatNuage3D = null;   // `etatNuage3D` : posé avec le nuage 3D, que le flux prévient quand des blocs arrivent
  // Ce que porte chaque côté du rideau, comme dans l'onglet 2D : « carte »
  // (la carte Leaflet, qui remplace ici la photo aérienne) ou une couche de
  // relief. Par défaut, la carte à gauche et le Sky-View Factor à droite.
  const reglages = {
    cotes: { gauche: 'carte', droite: 'svf' },
    // Balayage d'horizons (SVF, ouvertures), soleil des ombrages, contraste, lissage, classes du sol.
    svfDirections: CONFIG.relief.svfDirections, svfRayonM: CONFIG.relief.svfRayonM,
    ombrageAzimut: CONFIG.relief.ombrageAzimut, ombrageHauteur: CONFIG.relief.ombrageHauteur,
    contraste: 1, lisser: true, classesSol: new Set(CONFIG.raster.classesSolDefaut),
  };
  const cotes = reglages.cotes;
  // Ce que peut porter un côté du rideau : une couche de relief ou un fond de carte (catalogue-vue.js).
  const { OMBRAGE_RGB, couches: COUCHES_VUE, fonds: FONDS_VUE, tuiles: TUILES_VUE, aides: AIDES_FONDS, estRelief, libelleCouche } =
    creerCatalogueVue({ RELIEF, FONDS_OSM, protocole: location.protocol });
  // Les listes Gauche / Droite choisissent le fond de chaque côté : le
  // sélecteur de fond de Leaflet ferait doublon. La carte garde la photo.
  carte.controleFonds.remove();
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
    $('vue-etat').textContent = STATUT_RELIEF.ligneAttente(e);
    const { texte, genre } = STATUT_RELIEF.message({
      e, lenteIGN, erreurRelief: etatRelief.erreur, texteRelief: etatRelief.texte, diagnostic, sansLidar, milliers,
      reliefAffiche: ['gauche', 'droite'].some((c) => estRelief(cotes[c])), surfaceMaxKm2: CONFIG.flux.surfaceMaxPointsKm2,
    });
    statut(texte, genre);
  };

  // Le calcul du relief (images de chaque côté du rideau) : voir calcul-relief.js.
  const calcul = creerCalculRelief({
    $, relief, infoRelief, activite, FLUX_CHOIX, VUE_GRILLE, VOLETS, MODE_CARTE, RELIEF, CONFIG, L,
    NOMS_CLASSES, construireLUT, vueCartes, voletDe, reglages, estRelief, libelleCouche, outils,
    vueCourante: () => vueCourante, flux: () => flux, territoire: () => territoireVue,
    reglagesDe: (cle) => panneau.reglagesDe(cle), majStatut: () => majStatut(),
  });
  const etatRelief = calcul.etat;
  const planifierRelief = calcul.planifier;

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
    surEtat: (e) => { dernierEtat = e; majStatut(); etatNuage3D?.(e); },
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
  outils.liaisons.dalleAuPoint = (x, y) => flux.dalleAu(x, y);
  if (chronometrer) for (const n of ['majVue']) flux[n] = mesurer(`flux : ${n}`, flux[n]);

  const majVueFlux = (fixe = null) => {
    const rect = Number.isFinite(fixe?.xmin) ? fixe : null;   // un rectangle imposé (lien 3D) ; tout autre argument (un événement) est ignoré
    if (!rect && !$('vue-3d').hidden) return;   // en 3D la carte est masquée (taille nulle) : la zone est celle de la 3D
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
    vueCourante = rect || {
      xmin: Math.min(so.x, no.x), xmax: Math.max(ne.x, se.x),
      ymin: Math.min(so.y, se.y), ymax: Math.max(ne.y, no.y),
      largeurPx: carte.map.getSize().x,
    };
    flux.majVue(vueCourante);
    planifierRelief(0);
  };

  // Le panneau du relief (listes de couches, réglages, lien) : voir panneau-relief.js.
  const panneau = creerPanneauRelief({
    $, carte, reglages, vueCartes, voletDe, reliefCalque, relief, vue3d, MODE_CARTE, CHOIX_COUCHES, RELIEF, CONFIG,
    FONDS_VUE, COUCHES_VUE, TUILES_VUE, AIDES_FONDS, OMBRAGE_RGB, estRelief, libelleCouche, classesMasquees,
    planifierRelief, majStatut, majLien, majLegende, budget3D: () => nuage3D.budget(), surMobile,
  });
  const { majCotes, reglagesDe } = panneau;

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
  outils.liaisons.lireVue = (x, y) => relief.lire(x, y);

  // ── L'onglet 3D : le nuage de la zone vue (nuage-3d.js) ──
  const nuage3D = creerNuage3D({
    $, vue3d, relief, flux, etat, ATTENTE, FLUX_CHOIX, CONFIG, milliers, surMobile, classesMasquees,
    vueCourante: () => vueCourante, dernierEtat: () => dernierEtat,
    reliefAJour: () => calcul.aJour(),
    majLegende, majHUD, majAttributNuage, majLien,
    carte, projVue, majVueFlux: (rect) => majVueFlux(rect), basculerVue, LIEN, RECTANGLE_3D, apresNuage: () => outils.republier3D(),
  });
  etatNuage3D = nuage3D.etatChange;
  surPassage3D = nuage3D.construire;
  surPassageCarte = () => { vueCartes.cartes()[1]?.invalidateSize(); planifierRelief(0); };

  // Hauteur au-dessus du sol : venue avec le nuage. Relief : la couche du côté
  // droit du rideau (ou du gauche si la droite n'en porte pas), drapée par le
  // worker avec l'étirement de sa dernière image.
  panneau3D.liaisons.majAttributVue = async () => {
    if (!vue3d || !etat.nuage) return;
    if (CONFIG.rendu.coloration === 'hauteur') { vue3d.definirHauteurs(etat.nuage.hauteur); return; }
    if (CONFIG.rendu.coloration !== 'relief') return;
    const cote = estRelief(cotes.droite) && cotes.droite !== OMBRAGE_RGB ? 'droite' : 'gauche';
    const etirement = etatRelief.etirements[cote];
    if (!estRelief(cotes[cote]) || !etirement || etirement.cle !== cotes[cote] || etirement.min == null) return;
    const valeurs = await relief.drape3d(etirement.cle, reglagesDe(etirement.cle), etirement.min, etirement.max);
    if (valeurs && etat.nuage && valeurs.length === etat.nuage.n) vue3d.definirHauteurs(valeurs);
  };

  $('vue-edl').addEventListener('change', (e) => { vue3d?.definirEDL(e.target.checked); majLien(); });
  const { traceOutils, versLatLng, selection, mesure } = creerOutilsCarte({ carte, projVue, MESURE });
  outils.liaisons.carteOutils = { selection, mesure };
  // Un clic (pas un glisser : Leaflet ne l'émet pas après un déplacement)
  // vise un point en mode Sélection ou Mesure, et pose un point de la bande en mode Profil.
  carte.map.on('click', async (e) => {
    const mode = outils.mode();
    if (mode === 'profil') { poserPointProfil(e.latlng); return; }
    if (mode !== 'selection' && mode !== 'mesure') return;
    const { x, y } = projVue().versLocal(e.latlng.lng, e.latlng.lat);
    const pt = await relief.lire(x, y);
    if (mode === 'selection') outils.afficherSelection(x, y, pt?.altitude ?? null, pt?.hauteur ?? 0);
    else outils.ajouterPointMesure(x, y, pt?.altitude ?? null, pt?.hauteur ?? 0);
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
  $('recherche').closest('section').querySelector('h2').textContent = 'Lieu';
  VUES[0][3] = 'Zoomez sur une zone : le relief se calcule tout seul · glisser le rideau pour comparer';
  $('aide-vue').textContent = VUES[0][3];

  // ── Le lien du profil : l'état à écrire, et le lien à remettre (R2) ──
  const versGeoProfil = ([x, y]) => {
    const g = projVue().versGeo(x, y);
    return { lat: g.lat, lon: g.lon };
  };

  partage.liaisons.etatPartageVue = () => {
    const e = { sol: LIEN.sansDefaut(reglages.classesSol, CONFIG.raster.classesSolDefaut, etatRelief.classes.map(([c]) => c)) };
    if (profil.A && profil.B) {
      e.profil = { a: versGeoProfil(profil.A), b: versGeoProfil(profil.B), largeur: profil.largeur };
    }
    e.vue = panneau.pourLien();
    return e;
  };


  /**
   * Remet ce que le lien ouvert porte : classes du sol, point sélectionné, bande (la fenêtre
   * flottante prête à « Valider » : la modale ne s'ouvre jamais d'elle-même). Un paramètre refusé à la lecture n'arrive pas jusqu'ici (`LIEN.lirePartage`).
   */
  async function appliquerPartage() {
    const p = partage.prendre();
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
        reglages.classesSol = new Set(p.sol);
        for (const i of $('vue-classes-sol').querySelectorAll('input')) i.checked = reglages.classesSol.has(Number(i.value));
        relief.reglages({ classesSol: reglages.classesSol });
        planifierRelief(0);
      }
      if (p.vue) panneau.depuisLien(p.vue);
      if (p.vue?.onglet === '3d') nuage3D.ouvrirDepuisLien(lien);
      if (p.sel) {
        const l = projVue().versLocal(p.sel.lon, p.sel.lat);
        // Sans relief calculé là, l'altitude arrive avec l'image suivante (voir plus haut).
        const pt = outils.liaisons.lireVue ? await outils.liaisons.lireVue(l.x, l.y) : null;
        outils.afficherSelection(l.x, l.y, pt?.altitude ?? null, pt?.hauteur ?? 0);
      }
      if (p.regle) {
        // Les points reviennent avec leur altitude relue dans la vue calculée (jamais écrite dans le lien).
        const pts = [];
        for (const q of p.regle) {
          const l = projVue().versLocal(q.lon, q.lat);
          const pt = outils.liaisons.lireVue ? await outils.liaisons.lireVue(l.x, l.y) : null;
          pts.push({ x: l.x, y: l.y, sol: pt?.altitude ?? null, hauteur: pt?.hauteur ?? 0 });
        }
        outils.definirMesure(pts);
        if (!p.profil) outils.definirMode('mesure');
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
          outils.definirMode('profil');
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
  partage.liaisons.appliquerPartageVue = appliquerPartage;
  if (partage.enAttente()) appliquerPartage();

  carte.map.on('moveend', () => majVueFlux());   // sans argument : Leaflet passerait l'événement
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
