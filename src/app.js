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
  minuteurAlerte = setTimeout(() => { a.hidden = true; }, 7000);
  statut(message, 'erreur');
}

const octets = (o) => o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${(o / 1024).toFixed(0)} Ko`;
const milliers = (n) => n.toLocaleString('fr-FR');

// ── Vue 3D ──────────────────────────────────────────────────────────────────

let vue3d = null;
try {
  vue3d = new Vue3D($('canvas3d'), $('boussole'));
  vue3d.demarrer();
} catch (e) {
  alerter(e.message);
}

// ── Relief ──────────────────────────────────────────────────────────────────

const vueRelief = new VueRelief($('canvas-relief'), {
  surCurseur: (p) => {
    if (!p) { $('hud-relief').innerHTML = ''; return; }
    $('hud-relief').innerHTML =
      `x ${p.x.toFixed(0)} · y ${p.y.toFixed(0)}`
      + (p.altitude == null ? ' · sol inconnu' : ` · sol ${p.altitude.toFixed(1)} m`)
      + (p.hauteur > 0.05 ? ` · <b>+${p.hauteur.toFixed(2)} m</b>` : '');
  },
  // Cliquer une boîte sélectionne la détection dans toutes les vues à la fois.
  surClic: (id) => {
    const c = (etat.resultat?.candidats || []).find((x) => x.id === id);
    if (c) selectionner_(c);
  },
});
vueRelief.demarrer();

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
    ouvrirDalle(d);
  },
  surCouverture: (nb, zoom) => {
    if (etat.dalle) return;   // ne pas écraser l'état d'une dalle déjà choisie
    statut(nb === 0
      ? 'Aucune couverture LiDAR dans cette vue — déplacez-vous ou dézoomez'
      : zoom < CONFIG.carte.zoomGrille
        ? `${nb} chantier(s) LiDAR en vue — zoomez pour voir les dalles`
        : `${nb} chantier(s) LiDAR — cliquez une dalle`);
  },
  surRecherche: (m) => statut(m, 'travail'),
  surErreur: alerter,
});

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
    if (e.name !== 'AbortError') alerter(`Recherche : ${e.message}`);
  }
}

function allerAu(lieu) {
  $('resultats-recherche').hidden = true;
  carte.allerA(lieu.lon, lieu.lat);
  statut(`${lieu.label} — cliquez une dalle`);
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
    alerter(`Ouverture de la dalle : ${e.message}`);
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
  let defaut = 0;
  for (let i = 0; i < etat.couts.length; i++) {
    const c = etat.couts[i];
    if (c.nbPoints <= CONFIG.nuage.budgetPoints && c.octets <= CONFIG.nuage.budgetOctets) defaut = i;
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
    + `<span class="doux">Aperçu 3D au niveau ${niveauVue} ; la détection lit tout.</span>`;

  $('btn-charger').disabled = false;
}

$('niveau').addEventListener('input', (e) => {
  e.target.dataset.touche = '1';
  etat.niveau = Number(e.target.value);
  majAffichageCout();
});

// ── Étape 1 → 2 : chargement du nuage ───────────────────────────────────────

$('btn-charger').addEventListener('click', async () => {
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
    const grille = RASTER.creerGrilles(emprise, origine);
    const niveauVue = NUAGE.niveauPourAffichage(etat.couts.slice(0, etat.niveau + 1));

    const nuage = await NUAGE.charger(etat.entete, noeuds, emprise, {
      niveauAffichage: niveauVue,
      surBloc: (bloc) => RASTER.accumuler(grille, bloc),
      surAvancement: (a) => {
        $('barre-progression').style.width = `${(a.faits / a.total) * 100}%`;
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
    vueRelief.definirGrille(null);
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

    // On bascule AVANT l'analyse, pas après : le voile se poserait sinon sur la
    // carte, qui n'a rien à voir avec ce qui se calcule et qui charge par
    // ailleurs sa couverture à chaque déplacement. Il couvre maintenant la vue
    // qui va recevoir le résultat.
    $('section-vide-3d').hidden = true;
    $('section-affichage').hidden = false;
    $('section-analyse').hidden = ANALYSE_MASQUEE;
    basculerVue('3d');

    // Le téléchargement est fini ; ce qui suit est synchrone et bloque le fil
    // principal — d'où le voile, et non plus un simple `statut`.
    await ATTENTE.pendant('Analyse de la dalle', async (etape) => {
      await etape('Nuage vers le GPU…', `${milliers(etat.nuage.n)} points`);
      vue3d.definirNuage(etat.nuage);
      vue3d.definirClassesMasquees(classesMasquees);
      vue3d.definirSentiers([], null);
      vue3d.definirSentierChoisi(null, null);
      vue3d.definirDetections([], null);
      vue3d.definirSelection(null, null);

      await etape('Modèle de terrain…', 'comblement des trous sous les structures');
      RASTER.finaliser(etat.grille);

      await etape('Hauteurs au-dessus du sol…');
      vue3d.definirHauteurs(RASTER.hauteurParPoint(etat.nuage, etat.grille));
    });

    etat.dalleChargee = dalle;
    carte.marquerChargee(dalle);
    majBandeau();

    majLegende();
    majHUD();

    const secondes = ((performance.now() - debut) / 1000).toFixed(1);
    statut(`Dalle analysée en ${secondes} s — grille ${etat.grille.pas.toFixed(2)} m, `
      + `aperçu ${milliers(etat.nuage.n)} points`);

    if (etat.grille.pas > CONFIG.raster.pasM + 1e-6) {
      alerter(`Grille relevée à ${etat.grille.pas.toFixed(2)} m : ${CONFIG.raster.pasM} m dépasserait le plafond de cellules.`);
    }
  } catch (e) {
    if (e.name !== 'AbortError') alerter(`Chargement : ${e.message}`);
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
    }
    if (etat.abandon === ctrl) etat.abandon = null;
  }
});

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
  coucheCalculee = null;

  vue3d?.vider();
  vueRelief.definirGrille(null);
  $('relief-controles').hidden = true;
  $('relief-vide').hidden = false;
  $('relief-stats').hidden = true;
  carte.marquerChargee(null);
  carte.effacerSentiers();
  carte.afficherDetections([], selectionner_);

  $('section-affichage').hidden = true;
  $('section-analyse').hidden = true;
  $('section-vide-3d').hidden = false;
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
  majHUD();
  basculerVue('carte');
  statut('Nuage fermé — mémoire libérée');
}

$('btn-fermer-nuage').addEventListener('click', fermerNuage);

// ── Onglet Relief ───────────────────────────────────────────────────────────

let coucheRelief = 'ombrage';
let coucheCalculee = null;
let contrasteRelief = CONFIG.relief.contraste;

$('couches-relief').innerHTML = RELIEF.COUCHES.map((c, i) =>
  `<button data-couche="${c.cle}"${i === 0 ? ' class="actif"' : ''}>${echapper(c.libelle)}</button>`).join('');

$('couches-relief').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) calculerCouche(b.dataset.couche);
});

/**
 * Prépare la grille d'affichage, au premier passage sur l'onglet.
 *
 * Paresseux à dessein : c'est une passe sur les 16 M de cellules de la grille
 * fine, inutile tant qu'on n'a pas demandé à voir le relief.
 */
async function preparerRelief() {
  const prete = !!etat.reliefGrille;
  $('relief-vide').hidden = !!etat.grille;
  $('relief-controles').hidden = !etat.grille;
  if (!etat.grille || prete) { vueRelief.invalider(); return; }

  await ATTENTE.pendant('Préparation du relief', () => {
    etat.reliefGrille = RELIEF.preparer(etat.grille, { inclureBati: reglages.inclureBati });
  }, 'agrégation des grilles de détection');
  vueRelief.definirGrille(etat.reliefGrille);
  vueRelief.definirDetections(candidatsVisibles(), etat.grille);
  vueRelief.definirTraces(etat.sentiers?.traces || []);
  vueRelief.definirSelection(etat.selection);
  await calculerCouche(coucheRelief);
}

/**
 * Calcule et affiche une couche.
 *
 * La durée est remontée à l'écran : sur le Sky-View Factor elle dépend de la
 * machine, du pas et du rayon, et l'annoncer vaut mieux que de l'estimer.
 */
async function calculerCouche(cle) {
  coucheRelief = cle;
  const def = RELIEF.COUCHES.find((c) => c.cle === cle) || RELIEF.COUCHES[0];
  for (const b of $('couches-relief').children) b.classList.toggle('actif', b.dataset.couche === cle);
  $('relief-aide').textContent = def.aide;
  if (!etat.reliefGrille) return;

  const calcul = () => RELIEF.calculer(etat.reliefGrille, cle, {
    inclureBati: reglages.inclureBati,
    contraste: contrasteRelief,
  });

  try {
    // Seules les couches déclarées lentes passent par le voile : sur un calcul
    // de cent millisecondes, l'apparition et la disparition immédiates du voile
    // sont plus désagréables que l'attente elle-même.
    coucheCalculee = def.lent
      ? await ATTENTE.pendant(def.libelle, calcul,
        `${CONFIG.relief.svfDirections} directions sur ${CONFIG.relief.svfRayonM} m`)
      : calcul();
    vueRelief.definirCouche(coucheCalculee);
    vueRelief.definirContraste(contrasteRelief);
    majStatsRelief();
    statut(`Relief : ${def.libelle.toLowerCase()}`);
  } catch (e) {
    alerter(`Relief : ${e.message}`);
  }
}

function majStatsRelief() {
  const t = etat.reliefGrille;
  if (!t || !coucheCalculee) { $('relief-stats').hidden = true; return; }
  const [min, max] = vueRelief.etendue();
  $('relief-stats').hidden = false;
  $('relief-stats').innerHTML =
    `Grille <b>${t.pas.toFixed(2)} m</b> · ${milliers(t.W)} × ${milliers(t.H)} cellules<br>`
    + `étalement <b>${min.toFixed(2)}</b> à <b>${max.toFixed(2)}</b>`
    + ` · calcul <b>${coucheCalculee.duree.toFixed(0)} ms</b>`;
}

/**
 * Le contraste ne relance aucun calcul : seul l'intervalle étalé sur la palette
 * change, et la vue se contente de redessiner. Sur le Sky-View Factor, refaire
 * le calcul à chaque cran coûterait des secondes par mouvement du curseur.
 */
$('contraste-relief').addEventListener('input', (e) => {
  contrasteRelief = Number(e.target.value);
  $('val-contraste').textContent = `×${contrasteRelief.toFixed(1)}`;
  vueRelief.definirContraste(contrasteRelief);
  majStatsRelief();
});

// Les deux superpositions n'ont plus rien à superposer tant que l'analyse est
// masquée : leurs cases sont retirées avec elle, plutôt que de laisser deux
// réglages qui ne font visiblement rien.
for (const id of ['relief-detections', 'relief-sentiers']) {
  $(id).closest('label').hidden = ANALYSE_MASQUEE;
}
$('relief-detections').addEventListener('change', (e) =>
  vueRelief.definirCalques({ detections: e.target.checked }));
$('relief-sentiers').addEventListener('change', (e) =>
  vueRelief.definirCalques({ sentiers: e.target.checked }));
$('btn-relief-cadrer').addEventListener('click', () => vueRelief.cadrer());

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
  for (const b of $('volets').children) b.classList.toggle('actif', b.dataset.volet === nom);
  for (const v of document.querySelectorAll('#section-analyse .volet')) {
    v.hidden = v.dataset.volet !== nom;
  }
}

$('volets').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) montrerVolet(b.dataset.volet);
});

// ── Affichage du nuage ──────────────────────────────────────────────────────

$('coloration').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  for (const autre of $('coloration').children) autre.classList.toggle('actif', autre === b);
  CONFIG.rendu.coloration = b.dataset.mode;
  majLegende();
  vue3d?.invalider();
});

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
  if (!etat.nuage) { l.innerHTML = ''; return; }

  const echelle = {
    hauteur: 'Sombre = sol · jaune = 1–3 m · rouge = &gt; 5 m',
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
}

$('legende').addEventListener('click', (e) => {
  const b = e.target.closest('button.cls');
  if (!b) return;
  const cls = Number(b.dataset.cls);
  if (classesMasquees.has(cls)) classesMasquees.delete(cls); else classesMasquees.add(cls);
  b.classList.toggle('off', classesMasquees.has(cls));
  vue3d?.definirClassesMasquees(classesMasquees);
});

function majHUD() {
  if (!etat.nuage) { $('hud').textContent = ''; return; }
  const e = etat.nuage.emprise;
  $('hud').innerHTML = `${milliers(etat.nuage.n)} points · ${Math.round(e.xmax - e.xmin)} × ${Math.round(e.ymax - e.ymin)} m<br>`
    + `altitudes ${(etat.nuage.origine[2] + etat.nuage.zmin).toFixed(0)} – ${(etat.nuage.origine[2] + etat.nuage.zmax).toFixed(0)} m`
    + (etat.grille ? ` · grille ${etat.grille.pas.toFixed(2)} m` : '');
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
  // périmée, on la refera au prochain passage sur l'onglet Relief.
  etat.reliefGrille = null;
  if ($('panneau').dataset.vue === 'relief') preparerRelief();
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
      + `écartés — longueur ${st.rejets.longueur} · ravine ${st.rejets.ravine}`
      + ` · pente ${st.rejets.penteLongue} · profondeur ${st.rejets.profondeur}`;

    afficherSentiers();
    statut(`${etat.sentiers.traces.length} sentier(s) candidat(s)`);
  } catch (e) {
    alerter(`Sentiers : ${e.message}`);
  } finally {
    $('btn-sentiers').disabled = false;
  }
});

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
        · ravine ${s.alignementPente.toFixed(2)}</div>
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
  vueRelief.definirTraces(traces);
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
  vueRelief.definirTraceChoisie(s);
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
  vueRelief.definirDetections(visibles, etat.grille);
  selectionner_(null);
}

function selectionner_(c) {
  etat.selection = c;
  if (c) montrerVolet('structures');
  for (const li of $('liste').children) {
    li.classList?.toggle('actif', c && li.dataset.id === String(c.id));
  }
  carte.surlignerDetection(c, candidatsVisibles());
  vueRelief.definirSelection(c);

  if (c) {
    vue3d?.viser(c);
    vueRelief.viser(c.x, c.y, Math.max(80, Math.sqrt(c.surface) * 12));
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
    'Cliquez dans une zone bleue · vert : dalle chargée · jaune : sélection'],
  ['3d', 'vue-3d', 'onglet-3d',
    'Glisser : déplacer · molette : zoom sous le curseur · Maj+glisser : pivoter · double-clic : y aller'],
  ['relief', 'vue-relief', 'onglet-relief',
    'Glisser : déplacer · molette : zoom sous le curseur · cliquer une boîte : sélectionner'],
];

function basculerVue(quoi) {
  // Le panneau suit : les sections marquées `data-vue` s'affichent ou non selon
  // l'onglet, sans que rien d'autre n'ait à le savoir.
  $('panneau').dataset.vue = quoi;
  for (const [nom, vue, onglet, aide] of VUES) {
    $(vue).hidden = nom !== quoi;
    $(onglet).classList.toggle('actif', nom === quoi);
    if (nom === quoi) $('aide-vue').textContent = aide;
  }

  // Leaflet mesure son conteneur à l'initialisation ; masqué, il l'a mesuré à
  // zéro et n'affiche aucune tuile tant qu'on ne le lui redit pas.
  if (quoi === 'carte') requestAnimationFrame(() => carte.invalider());
  else if (quoi === '3d') vue3d?.invalider();
  else preparerRelief();
}

$('onglet-carte').addEventListener('click', () => basculerVue('carte'));
$('onglet-3d').addEventListener('click', () => basculerVue('3d'));
$('onglet-relief').addEventListener('click', () => basculerVue('relief'));

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'c') basculerVue('carte');
  if (e.key === 'v') basculerVue('3d');
  if (e.key === 'r') basculerVue('relief');
  if (e.key === 'f') vue3d?.cadrer();
  if (e.key === 't') { vue3d?.vueDeDessus(); basculerVue('3d'); }
});

$('btn-dessus').addEventListener('click', () => { vue3d?.vueDeDessus(); basculerVue('3d'); });
$('btn-cadrer').addEventListener('click', () => { vue3d?.cadrer(); basculerVue('3d'); });

})();
