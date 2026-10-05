// Le panneau du relief : ce que porte chaque côté du rideau, les réglages du SVF et de l'ombrage, le contraste,
// les classes du sol — et leur traduction vers et depuis le lien partageable (`pourLien`, `depuisLien`).
// Fabrique à dépendances explicites ; l'état (`reglages`) appartient à l'appelant, qui le lit pour calculer
// le relief.

function creerPanneauRelief(d) {
  const { $, carte, reglages, vueCartes, voletDe, reliefCalque, relief, vue3d, MODE_CARTE, CHOIX_COUCHES, RELIEF, CONFIG,
    FONDS_VUE, COUCHES_VUE, TUILES_VUE, AIDES_FONDS, OMBRAGE_RGB, estRelief, libelleCouche, classesMasquees,
    planifierRelief, majStatut, majLien, majLegende, budget3D, surMobile } = d;
  const { cotes } = reglages;

  const BALAYAGE = new Set(['svf', 'ouverture-pos', 'ouverture-neg']);
  // Les réglages propres à une couche, et ceux-là seulement : ils entrent dans la
  // clé du mémo du worker, et bouger le soleil ne doit pas refaire un Sky-View
  // Factor (cinq secondes) ni l'inverse.
  const OMBRAGES = new Set(['ombrage', 'ombrage-simple', OMBRAGE_RGB]);
  const reglagesDe = (cle) => (BALAYAGE.has(cle) ? { svfDirections: reglages.svfDirections, svfRayonM: reglages.svfRayonM }
    : OMBRAGES.has(cle) ? { ombrageAzimut: reglages.ombrageAzimut, ombrageHauteur: reglages.ombrageHauteur } : {});
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
  $('vue-svf-directions').value = reglages.svfDirections;
  $('val-vue-svf-directions').textContent = reglages.svfDirections;
  $('vue-svf-rayon').value = reglages.svfRayonM;
  $('val-vue-svf-rayon').textContent = `${reglages.svfRayonM} m`;
  $('vue-svf-directions').addEventListener('input', (e) => { $('val-vue-svf-directions').textContent = e.target.value; });
  $('vue-svf-directions').addEventListener('change', (e) => { reglages.svfDirections = Number(e.target.value); $('val-vue-svf-directions').textContent = e.target.value; planifierRelief(0); majLien(); });
  $('vue-svf-rayon').addEventListener('input', (e) => { $('val-vue-svf-rayon').textContent = `${e.target.value} m`; });
  $('vue-svf-rayon').addEventListener('change', (e) => { reglages.svfRayonM = Number(e.target.value); $('val-vue-svf-rayon').textContent = `${e.target.value} m`; planifierRelief(0); majLien(); });
  // Soleil des ombrages : appliqué au relâchement du curseur.
  $('vue-ombrage-azimut').value = reglages.ombrageAzimut;
  $('val-vue-ombrage-azimut').textContent = `${reglages.ombrageAzimut}°`;
  $('vue-ombrage-hauteur').value = reglages.ombrageHauteur;
  $('val-vue-ombrage-hauteur').textContent = `${reglages.ombrageHauteur}°`;
  $('vue-ombrage-azimut').addEventListener('input', (e) => { $('val-vue-ombrage-azimut').textContent = `${e.target.value}°`; });
  // « Réinitialiser » : grisé tant que le soleil est celui du défaut (rien à remettre).
  const majReinitSoleil = () => { $('vue-ombrage-reinit').disabled = RELIEF.soleilEstParDefaut(reglages.ombrageAzimut, reglages.ombrageHauteur); };
  $('vue-ombrage-reinit').addEventListener('click', () => {
    const d = RELIEF.soleilParDefaut();
    reglages.ombrageAzimut = d.azimut;
    reglages.ombrageHauteur = d.hauteur;
    $('vue-ombrage-azimut').value = d.azimut;
    $('val-vue-ombrage-azimut').textContent = `${d.azimut}°`;
    $('vue-ombrage-hauteur').value = d.hauteur;
    $('val-vue-ombrage-hauteur').textContent = `${d.hauteur}°`;
    majReinitSoleil();
    planifierRelief(0);
    majLien();
  });
  $('vue-ombrage-azimut').addEventListener('change', (e) => { reglages.ombrageAzimut = Number(e.target.value); $('val-vue-ombrage-azimut').textContent = `${e.target.value}°`; majReinitSoleil(); planifierRelief(0); majLien(); });
  $('vue-ombrage-hauteur').addEventListener('input', (e) => { $('val-vue-ombrage-hauteur').textContent = `${e.target.value}°`; });
  $('vue-ombrage-hauteur').addEventListener('change', (e) => { reglages.ombrageHauteur = Number(e.target.value); $('val-vue-ombrage-hauteur').textContent = `${e.target.value}°`; majReinitSoleil(); planifierRelief(0); majLien(); });
  majReinitSoleil();
  $('vue-lisser').addEventListener('change', (e) => { reglages.lisser = e.target.checked; planifierRelief(0); majLien(); });

  // Le contraste ne recalcule pas la couche (gardée dans le worker) : seule
  // l'image est refaite.
  $('vue-contraste').addEventListener('input', (e) => {
    reglages.contraste = Number(e.target.value);
    $('val-vue-contraste').textContent = `×${reglages.contraste.toFixed(1)}`;
    planifierRelief(0);
    majLien();   // le contraste est dans le lien
  });
  // Les classes du sol s'appliquent tout de suite : les points sont dans le
  // worker, il n'y a rien à retélécharger — contrairement à l'ancien parcours
  // par dalle, qui ne gardait que ses grilles.
  $('vue-classes-sol').addEventListener('change', () => {
    reglages.classesSol = new Set([...$('vue-classes-sol').querySelectorAll('input:checked')].map((i) => Number(i.value)));
    relief.reglages({ classesSol: reglages.classesSol });
    planifierRelief(0);
    majLien();   // les classes du sol sont dans le lien (si elles diffèrent du défaut)
  });

  /**
   * Les réglages de la vue qui diffèrent du défaut — rien d'autre, pour que le lien reste court.
   * Les défauts sont ceux du démarrage : couches carte / SVF, rideau au milieu, contraste ×1,
   * SVF de `CONFIG`, lissage et ombrage de profondeur actifs, couleur par classification,
   * plafond de points de l'appareil.
   */
  const pourLien = () => ({
    gauche: cotes.gauche !== 'carte' ? cotes.gauche : undefined,
    droite: cotes.droite !== 'svf' ? cotes.droite : undefined,
    rideau: vueCartes.mode() !== 'double' && Math.round(reliefCalque.partRideau() * 100) !== 50 ? reliefCalque.partRideau() * 100 : undefined,
    onglet: $('panneau').dataset.vue === '3d' ? '3d' : undefined,
    cartes: vueCartes.mode() === 'double' ? 2 : undefined,
    contraste: reglages.contraste !== 1 ? reglages.contraste : undefined,
    svf: reglages.svfDirections !== CONFIG.relief.svfDirections || reglages.svfRayonM !== CONFIG.relief.svfRayonM
      ? { directions: reglages.svfDirections, rayon: reglages.svfRayonM } : undefined,
    soleil: RELIEF.soleilEstParDefaut(reglages.ombrageAzimut, reglages.ombrageHauteur) ? undefined
      : { azimut: reglages.ombrageAzimut, hauteur: reglages.ombrageHauteur },
    lisse: reglages.lisser ? undefined : false,
    couleur: CONFIG.rendu.coloration !== 'classification' ? CONFIG.rendu.coloration : undefined,
    plafond: budget3D() !== (surMobile() ? CONFIG.rendu.budget3DMobile : CONFIG.rendu.budget3D) ? budget3D() / 1e6 : undefined,
    edl: $('vue-edl').checked ? undefined : false,
    cachees: classesMasquees.size ? [...classesMasquees] : undefined,
  });

  /**
   * Remet les réglages d'un lien en passant par les vrais contrôles : leurs gestionnaires font le
   * reste (recalcul, étiquettes, lien), et rien ne diverge de ce qu'un clic aurait fait. Une couche
   * absente de la liste est ignorée ; un curseur ramène lui-même une valeur hors bornes dans les siennes.
   */
  function depuisLien(v) {
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

  majCotes();
  return {
    majCotes,
    reglagesDe,
    pourLien,
    depuisLien,
    /** Le fond de tuiles posé dans ce volet n'existe plus (la carte a été recréée). */
    oublierFond: (cote) => { fondsPoses[cote] = null; },
  };
}
