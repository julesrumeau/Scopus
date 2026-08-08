// Assemblage : relie la carte, le chargeur COPC, la vue 3D et la détection.
//
// Enveloppé dans une IIFE : sans modules ES, tout ce qui est déclaré au premier
// niveau d'un script devient global. Rien ici n'a vocation à sortir.

(() => {
'use strict';

const $ = (id) => document.getElementById(id);

const etat = {
  dalle: null,
  entete: null,
  hierarchie: null,
  couts: [],
  niveau: 0,
  nuage: null,
  grille: null,
  resultat: null,
  selection: null,
  abandon: null,
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
  minuteurAlerte = setTimeout(() => { a.hidden = true; }, 7000);
  statut(message, 'erreur');
}

const octets = (o) => o > 1048576 ? `${(o / 1048576).toFixed(1)} Mo` : `${(o / 1024).toFixed(0)} Ko`;
const milliers = (n) => n.toLocaleString('fr-FR');

// ── Vue 3D ──────────────────────────────────────────────────────────────────

let vue3d = null;
try {
  vue3d = new Vue3D($('canvas3d'));
  vue3d.demarrer();
} catch (e) {
  alerter(e.message);
}

// ── Carte ───────────────────────────────────────────────────────────────────

const carte = new Carte($('vue-carte'), {
  surDalle: (d) => {
    etat.dalle = d;
    etat.entete = null;
    etat.hierarchie = null;
    $('info-dalle').hidden = true;
    const dl = $('detail-dalle');
    dl.hidden = false;
    dl.innerHTML = ligneDetail('Nom', d.nom)
      + ligneDetail('Points', d.nbPoints ? milliers(d.nbPoints) : '—')
      + ligneDetail('Acquisition', d.dateAcquisition || '—')
      + ligneDetail('Altimétrie', d.systemeAltimetrique || '—')
      + ligneDetail('Emprise', `X ${d.emprise.xmin}–${d.emprise.xmax}\nY ${d.emprise.ymin}–${d.emprise.ymax}`);
    $('btn-ouvrir').disabled = false;
    statut('Dalle sélectionnée — ouvrez-la pour lire son index');
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

function ligneDetail(cle, valeur) {
  return `<dt>${cle}</dt><dd>${String(valeur).replace(/\n/g, '<br>')}</dd>`;
}

// ── Étape 1 → 2 : lecture de l'index COPC ───────────────────────────────────

$('btn-ouvrir').addEventListener('click', async () => {
  if (!etat.dalle) return;
  const bouton = $('btn-ouvrir');
  bouton.disabled = true;
  statut('Lecture de l’index COPC…', 'travail');

  try {
    // Deux requêtes de plage — ~50 Ko — pour connaître l'octree entier d'un
    // fichier de 190 Mo. C'est toute la raison d'être du format COPC ici.
    etat.entete = await COPC.lireEntete(etat.dalle.url);
    etat.hierarchie = await COPC.lireHierarchie(etat.entete);

    $('section-zone').hidden = false;
    majCouts();
    statut(`Index lu : ${milliers(etat.hierarchie.size)} nœuds, ${milliers(etat.entete.nbPoints)} points`);
  } catch (e) {
    alerter(`Ouverture de la dalle : ${e.message}`);
  } finally {
    bouton.disabled = false;
  }
});

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
  etat.niveau = Math.min(Number(curseur.value) || defaut, etat.couts.length - 1);
  if (!curseur.dataset.touche) { etat.niveau = defaut; curseur.value = defaut; }

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

// ── Étape 2 → 3 : chargement du nuage ───────────────────────────────────────

$('btn-charger').addEventListener('click', async () => {
  if (!etat.entete || !etat.dalle) return;

  const emprise = etat.dalle.emprise;
  // Budgets neutralisés : la sélection est bornée par le niveau demandé, et la
  // mémoire ne dépend plus du nombre de points depuis que les blocs sont
  // rastérisés puis jetés.
  const sel = COPC.selectionner(etat.entete, etat.hierarchie, emprise, Infinity, Infinity);

  // La sélection est cumulative par niveau : on coupe à celui demandé.
  const noeuds = sel.noeuds.filter((n) => n.cle.n <= etat.couts[etat.niveau].niveau);
  if (!noeuds.length) { alerter('Aucun nœud à charger dans cette zone.'); return; }

  etat.abandon = new AbortController();
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
    etat.grille = RASTER.creerGrilles(emprise, origine);
    const niveauVue = NUAGE.niveauPourAffichage(etat.couts.slice(0, etat.niveau + 1));

    etat.nuage = await NUAGE.charger(etat.entete, noeuds, emprise, {
      niveauAffichage: niveauVue,
      surBloc: (bloc) => RASTER.accumuler(etat.grille, bloc),
      surAvancement: (a) => {
        $('barre-progression').style.width = `${(a.faits / a.total) * 100}%`;
        statut(`Téléchargement ${a.faits}/${a.total} — ${milliers(a.points)} points`, 'travail');
      },
      signal: etat.abandon.signal,
    });

    if (!etat.nuage.n) { alerter('Dalle vide : aucun point dans cette emprise.'); return; }

    vue3d.definirNuage(etat.nuage);
    vue3d.definirClassesMasquees(classesMasquees);
    vue3d.definirDetections([], null);
    vue3d.definirSelection(null, null);

    statut('Modèle de terrain…', 'travail');
    // Laisse l'image se rafraîchir avant une passe synchrone qui bloque le fil
    // principal plusieurs centaines de millisecondes.
    await new Promise((r) => requestAnimationFrame(r));
    RASTER.finaliser(etat.grille);
    vue3d.definirHauteurs(RASTER.hauteurParPoint(etat.nuage, etat.grille));

    $('section-affichage').hidden = false;
    $('section-detection').hidden = false;
    majLegende();
    majHUD();
    basculerVue('3d');

    const secondes = ((performance.now() - debut) / 1000).toFixed(1);
    statut(`Dalle analysée en ${secondes} s — grille ${etat.grille.pas.toFixed(2)} m, `
      + `aperçu ${milliers(etat.nuage.n)} points`);

    if (etat.grille.pas > CONFIG.raster.pasM + 1e-6) {
      alerter(`Grille relevée à ${etat.grille.pas.toFixed(2)} m : ${CONFIG.raster.pasM} m dépasserait le plafond de cellules.`);
    }
  } catch (e) {
    if (e.name !== 'AbortError') alerter(`Chargement : ${e.message}`);
    else statut('Chargement annulé');
  } finally {
    $('btn-charger').disabled = false;
    $('btn-annuler').hidden = true;
    $('progression').hidden = true;
    $('barre-progression').style.width = '0';
    etat.abandon = null;
  }
});

$('btn-annuler').addEventListener('click', () => etat.abandon?.abort());

// ── Étape 3 : affichage ─────────────────────────────────────────────────────

$('coloration').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  for (const autre of $('coloration').children) autre.classList.toggle('actif', autre === b);
  CONFIG.rendu.coloration = b.dataset.mode;
  majLegende();
});

$('taille-point').addEventListener('input', (e) => {
  CONFIG.rendu.taillePoint = Number(e.target.value);
  $('val-taille').textContent = CONFIG.rendu.taillePoint.toFixed(1);
});

$('exag').addEventListener('input', (e) => {
  CONFIG.rendu.exagerationZ = Number(e.target.value);
  $('val-exag').textContent = `×${CONFIG.rendu.exagerationZ.toFixed(1)}`;
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

// ── Étape 4 : détection ─────────────────────────────────────────────────────

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

$('inclure-bati').addEventListener('change', (e) => { reglages.inclureBati = e.target.checked; });

$('btn-defauts').addEventListener('click', () => {
  Object.assign(reglages, CONFIG.detection);
  construireReglages();
  $('inclure-bati').checked = reglages.inclureBati;
});

$('btn-detecter').addEventListener('click', async () => {
  if (!etat.grille) return;
  $('btn-detecter').disabled = true;
  statut('Détection…', 'travail');
  await new Promise((r) => requestAnimationFrame(r));

  try {
    etat.resultat = DETECTION.detecter(etat.grille, reglages);

    statut('Rapprochement avec la BD TOPO…', 'travail');
    const { erreur } = await SORTIE.rapprocher(etat.resultat.candidats, etat.dalle.emprise);
    if (erreur) alerter(`BD TOPO indisponible (${erreur}) — aucun rapprochement effectué.`);

    afficherResultats();

    const s = etat.resultat.stats;
    $('stats-detection').hidden = false;
    $('stats-detection').innerHTML =
      `Grille <b>${s.pas.toFixed(2)} m</b> · <b>${milliers(s.cellulesRetenues)}</b> cellules candidates sur ${milliers(s.cellules)}<br>`
      + `<b>${s.tachesBrutes}</b> taches, <b>${s.retenus}</b> retenues<br>`
      + `écartées — surface ${s.rejets.surface} · forme ${s.rejets.forme} · élongation ${s.rejets.elongation}`
      + ` · pente ${s.rejets.pente} · composition ${s.rejets.composition} · hauteur ${s.rejets.hauteur}`;

    statut(`${etat.resultat.candidats.length} structure(s) candidate(s)`);
  } catch (e) {
    alerter(`Détection : ${e.message}`);
  } finally {
    $('btn-detecter').disabled = false;
  }
});

// ── Étape 5 : résultats ─────────────────────────────────────────────────────

function candidatsVisibles() {
  const tous = etat.resultat?.candidats || [];
  return $('masquer-repertories').checked ? tous.filter((c) => !c.dejaRepertorie) : tous;
}

function afficherResultats() {
  const visibles = candidatsVisibles();
  $('section-resultats').hidden = false;
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
        ${c.dejaRepertorie ? `<span class="marque">BD TOPO · ${c.batimentProche}</span>` : ''}
        <span class="puce" style="background:${couleur}"></span>
      </div>
      <div class="mesures">${c.surface.toFixed(0)} m² · ${c.longueur.toFixed(1)} × ${c.largeur.toFixed(1)} m
        · h ${c.hauteurMoy.toFixed(1)} m · rect. ${c.rectangularite.toFixed(2)} · pente ${c.penteMoy.toFixed(0)}°</div>
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
  selectionner_(null);
}

function selectionner_(c) {
  etat.selection = c;
  for (const li of $('liste').children) {
    li.classList?.toggle('actif', c && li.dataset.id === String(c.id));
  }
  carte.surlignerDetection(c, candidatsVisibles());

  if (c) {
    vue3d?.viser(c);
    vue3d?.definirSelection(c, etat.grille);
    document.querySelector(`#liste li[data-id="${c.id}"]`)?.scrollIntoView({ block: 'nearest' });
  } else {
    vue3d?.effacerFocus();
    vue3d?.definirSelection(null, etat.grille);
  }
}

$('masquer-repertories').addEventListener('change', afficherResultats);

const NOM_BASE = () => `scopus_${etat.dalle?.nom || 'zone'}`;
const META = () => ({
  dalle: etat.dalle?.nom,
  emprise_lambert93: etat.dalle?.emprise,
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

function basculerVue(quoi) {
  const carteActive = quoi === 'carte';
  $('vue-carte').hidden = !carteActive;
  $('vue-3d').hidden = carteActive;
  $('onglet-carte').classList.toggle('actif', carteActive);
  $('onglet-3d').classList.toggle('actif', !carteActive);
  $('aide-vue').textContent = carteActive
    ? 'Cliquez dans une zone bleue · la zone verte est analysée'
    : 'Glisser : déplacer · molette : zoom sous le curseur · Maj+glisser : pivoter · double-clic : y aller';
  // Leaflet mesure son conteneur à l'initialisation ; masqué, il l'a mesuré à
  // zéro et n'affiche aucune tuile tant qu'on ne le lui redit pas.
  if (carteActive) requestAnimationFrame(() => carte.invalider());
}

$('onglet-carte').addEventListener('click', () => basculerVue('carte'));
$('onglet-3d').addEventListener('click', () => basculerVue('3d'));

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'c') basculerVue('carte');
  if (e.key === 'v') basculerVue('3d');
  if (e.key === 'f') vue3d?.cadrer();
  if (e.key === 't') { vue3d?.vueDeDessus(); basculerVue('3d'); }
});

$('btn-dessus').addEventListener('click', () => { vue3d?.vueDeDessus(); basculerVue('3d'); });
$('btn-cadrer').addEventListener('click', () => { vue3d?.cadrer(); basculerVue('3d'); });

})();
