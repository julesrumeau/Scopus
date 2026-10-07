// Le profil topographique côté interface : poser la bande sur la carte (deux points A et B, une largeur),
// puis, à la validation, lire la coupe dans une modale (graphique, classes, tranche, outils de mesure).
// Fabrique à dépendances explicites (comme `creerVueCartes`) : tout ce qui vient d'`app.js` arrive par
// `d`, rien n'est lu en global hors des modules (`PROFIL`, `MESURE`, `CONFIG`, `ProfilGraphique`).

/** Ce que dit la ligne sous les outils du graphique, par outil. */
const CONSIGNES_OUTIL = {
  deplacement: 'Glissez pour déplacer le graphique, molette pour zoomer. Un clic ne pose rien.',
  reference: 'Cliquez un point du graphique : il devient le 0. Un nouveau clic le remplace.',
  mesure: 'Cliquez des points du graphique pour mesurer, de suite. Maj + clic : à angle droit du point précédent (une hauteur au-dessus du sol).',
};

function creerProfilUI(d) {
  const { $, carte, traceOutils, versLatLng, projVue, majLien, relief, flux, classesMasquees,
    milliers, NOMS_CLASSES } = d;

  // ── Le profil : choisir la bande ── deux points A et B (coordonnées locales de la vue) et une largeur, dessinés
  // dans le volet SVG des outils ; le graphique ne s'ouvre, et rien ne se calcule, qu'à la validation.
  const profil = {
    A: null, B: null, largeur: CONFIG.profil.largeurDefautM,
    donnees: null,          // le dernier profil calculé
    masquees: null,         // classes décochées dans la modale : celles de la légende 3D à la première ouverture, puis le choix de la personne
    numero: 0,              // un calcul plus récent invalide les réponses en retard
    ligneChangee: true,     // A ou B a bougé depuis le dernier calcul : la chaîne, la référence, la tranche et le zoom ne valent plus
    largeurCalculee: null,  // la largeur du dernier calcul : une autre largeur remet la tranche et le zoom, pas la chaîne
  };
  let profilGroupe = null;
  let chaineGroupe = null;
  let graphique = null;
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
      m.on('dragstart', nouvelleLigne);
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
      : v.ok ? `Axe de ${Math.round(PROFIL.axe(profil.A, profil.B).longueur)} m<span class="profil-conseil"> Glissez A ou B pour l’ajuster.</span>`
      : v.raison;
    $('profil-valider').disabled = !(v && v.ok);
    $('profil-effacer').disabled = !profil.A;
    $('profil-largeur').value = PROFIL.curseurDepuisLargeur(profil.largeur);
    $('profil-largeur-n').value = profil.largeur;
    $('profil-largeur-modale').value = profil.largeur;
    majLien();   // la bande est dans le lien
  }

  /** A ou B vient de bouger (ou la bande est effacée) : ce qui s'y rapportait dans la coupe s'efface avec. */
  function nouvelleLigne() {
    profil.ligneChangee = true;
    graphique?.reinitialiser();
  }

  function effacerProfil() {
    nouvelleLigne();
    profil.A = profil.B = null;
    dessinerProfil();
    majFenetreProfil();
  }

  /** Un clic en mode Profil : A, puis B ; avec les deux posés, un clic recommence en A (voir `PROFIL.pointSuivant`). */
  function poserPointProfil(ll) {
    const q = projVue().versLocal(ll.lng, ll.lat);
    nouvelleLigne();
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

  /** La fenêtre flottante du mode Profil : largeur, Effacer, Valider. */
  function brancherBande() {
    $('profil-largeur').addEventListener('input', (e) => fixerLargeur(PROFIL.largeurDepuisCurseur(Number(e.target.value))));
    $('profil-largeur-n').addEventListener('change', (e) => fixerLargeur(e.target.value));
    $('profil-effacer').addEventListener('click', effacerProfil);
    $('profil-valider').addEventListener('click', () => validerProfil());
    // Un clic ou une molette sur la fenêtre ne doit pas arriver à la carte
    // (il poserait un point, ou zoomerait).
    L.DomEvent.disableClickPropagation($('fenetre-profil'));
    L.DomEvent.disableScrollPropagation($('fenetre-profil'));
  }
  brancherBande();
  majFenetreProfil();

  // ── Le profil : lire la coupe ── la validation ouvre la modale et demande les points au worker ; changer la
  // largeur dans la modale recalcule sur place (au `change`, pas à l'`input`).

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
    dessinerChaine(pts, graphique?.reference);
    $('profil-mesure-vide').hidden = chaine.length > 0;
    $('profil-mesure-detail').hidden = !chaine.length;
    $('profil-mesure-actions').hidden = !chaine.length;
    $('profil-mesure-detail').innerHTML = chaine.length < 2
      ? '<p class="vide">Point A posé. Cliquez un second point pour mesurer.</p>'
      : MESURE.tableauHtml(chaine);
  }

  // ── Les outils du graphique : déplacement, point de référence, mesure ── l'outil décide de ce que fait un clic
  // (le glisser et la molette déplacent et zooment toujours) ; la mesure par défaut ; un seul point de référence.
  profil.outil = 'mesure';

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
    dessinerChaine(graphique ? graphique.mesure : [], p);
  }

  /**
   * Les points cliqués sur le graphique, posés sur la carte : chacun est à sa distance `s` sur l'axe A→B.
   * Ils y restent quand la fenêtre est fermée (on revient à la carte pour les situer) ; la référence est
   * un point à part, d'une autre couleur. Effacés avec la bande.
   */
  function dessinerChaine(pts, reference) {
    chaineGroupe?.remove();
    chaineGroupe = null;
    if (!profil.A || !profil.B || (!pts.length && !reference)) return;
    const ll = (q) => { const m = PROFIL.pointSurAxe(profil.A, profil.B, q.s); return m && versLatLng(m[0], m[1]); };
    chaineGroupe = L.layerGroup().addTo(carte.map);
    const lls = pts.map(ll).filter(Boolean);
    const style = { pane: 'outilsVue', renderer: traceOutils, interactive: false };
    if (lls.length > 1) L.polyline(lls, { ...style, color: '#ffd24a', weight: 2, dashArray: '4 4', className: 'chaine-profil' }).addTo(chaineGroupe);
    for (const p of lls) L.circleMarker(p, { ...style, radius: 4, color: '#fff', weight: 1.5, fillColor: '#ffd24a', fillOpacity: 1, className: 'point-profil' }).addTo(chaineGroupe);
    const r = reference && ll(reference);
    if (r) L.circleMarker(r, { ...style, radius: 5, color: '#fff', weight: 1.5, fillColor: '#ff6bd6', fillOpacity: 1, className: 'reference-profil' }).addTo(chaineGroupe);
  }

  for (const b of document.querySelectorAll('#dlg-profil [data-outil]')) {
    b.addEventListener('click', () => { profil.outil = b.dataset.outil; majOutilsProfil(); });
  }
  $('profil-reference-effacer').addEventListener('click', () => graphique?.effacerReference());
  majOutilsProfil();

  /** La ligne d'état : combien de points, quelle bande, et ce qui peut tromper. */
  function texteEtatProfil(r) {
    const densite = r.total / (r.longueur * r.largeur);
    const avis = [];
    if (r.plafonne) avis.push('échantillon : plafond de points atteint');
    if (r.longueur > CONFIG.profil.longueurAvertM) avis.push('bande longue : la densité dépend du zoom');
    if (densite < CONFIG.profil.densiteMinPtsM2) avis.push('peu de points : zoomez sur la zone puis revalidez');
    return `${milliers(r.n)} points · ${Math.round(r.longueur)} m × ${r.largeur} m · ≈ ${densite.toFixed(1)} pt/m²`
      + (avis.length ? ` · ${avis.join(' · ')}` : '');
  }

  /** Calcule le profil ; pendant « Calcul… » l'ancien graphique est grisé et ne reçoit plus de clic (jusqu'au dernier calcul en vol). */
  async function calculerProfil() {
    if (!profil.A || !profil.B) return;   // pas de bande : rien à calculer (un champ de largeur modifié sans A ni B)
    profil.enVol = (profil.enVol || 0) + 1;
    $('profil-canvas').classList.add('en-calcul');
    try {
      await calculerProfilDe();
    } finally {
      if (--profil.enVol === 0) $('profil-canvas').classList.remove('en-calcul');
    }
  }

  async function calculerProfilDe() {
    const num = ++profil.numero;
    $('profil-etat').textContent = 'Calcul…';
    let r;
    try {
      r = await relief.profil(profil.A, profil.B, profil.largeur, CONFIG.profil.budgetPoints, [...flux.voulues()]);
    } catch (err) {
      console.error(err);
      if (num === profil.numero) $('profil-etat').textContent = `Le profil n’a pas pu être calculé : ${err.message}`;
      return;
    }
    if (num !== profil.numero) return;   // un calcul plus récent a pris la suite
    if (!graphique) { graphique = new ProfilGraphique($('profil-canvas'), afficherMesureProfil, afficherReferenceProfil); graphique.definirOutil(profil.outil); }
    // Même ligne et même largeur : la vue zoomée et la tranche restent ; une autre largeur les remet
    // (la tranche se lit dans la largeur), mais la chaîne et la référence restent (mêmes distances).
    const garder = !profil.ligneChangee && profil.largeurCalculee === profil.largeur;
    profil.ligneChangee = false;
    profil.largeurCalculee = profil.largeur;
    if (!garder) { $('profil-d0').value = 0; $('profil-d1').value = 1000; }
    if (r.vide) {
      profil.donnees = null;
      graphique.definir(null);
      $('profil-etat').textContent = r.raison;
    } else {
      profil.donnees = { ...r, parClasse: new Map(r.parClasse) };
      graphique.definir(profil.donnees, { garder });
      graphique.definirVisibles(visiblesProfil());
      $('profil-etat').textContent = texteEtatProfil(r);
    }
    listerClassesProfil();
    appliquerTrancheProfil();
    afficherReferenceProfil(graphique.reference);
  }

  function validerProfil() {
    if (!profil.A || !profil.B || !PROFIL.verdict(profil.A, profil.B).ok) return Promise.resolve();
    // Les classes de départ sont celles de la légende 3D (les changer ici ne touche pas la légende),
    // la première fois ; ensuite on garde le choix fait ici, comme l'outil, la chaîne et la référence
    // tant que la ligne ne bouge pas.
    profil.masquees = profil.masquees || new Set(classesMasquees);
    majOutilsProfil();
    $('dlg-profil').showModal();
    return calculerProfil();
  }

  $('profil-fermer').addEventListener('click', () => $('dlg-profil').close());
  /** La fenêtre d'aide du profil et ses pastilles « ? ». */
  function brancherAide() {
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
  }
  brancherAide();
  /** La modale : largeur, classes visibles, tranche de la bande. */
  function brancherModale() {
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
  }
  brancherModale();
  /** Les commandes du graphique : recadrer, échelles égales, mesure, clavier, redimensionnement. */
  function brancherGraphique() {
    // La chaîne de mesure se corrige comme sur la carte : bouton, ou Retour arrière / Suppr.
    $('profil-recadrer').addEventListener('click', () => graphique?.recadrer());
    $('profil-egales').addEventListener('change', (e) => graphique?.definirEgales(e.target.checked));
    $('profil-mesure-annuler').addEventListener('click', () => graphique?.retirerDernier());
    // La croix d'une ligne du tableau retire le point d'arrivée de ce segment.
    $('profil-mesure-detail').addEventListener('click', (e) => {
      const b = e.target.closest('[data-retirer]');
      if (b) graphique?.retirerPoint(Number(b.dataset.retirer));
    });
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
  }
  brancherGraphique();

  return {
    /** L'état de la bande : A, B (coordonnées locales de la vue), largeur. */
    etat: profil,
    dessiner: dessinerProfil,
    majFenetre: majFenetreProfil,
    effacer: effacerProfil,
    poserPoint: poserPointProfil,
    valider: validerProfil,
  };
}
