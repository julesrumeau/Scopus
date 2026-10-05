// Le calcul du relief de la vue : un seul calcul à la fois (le worker les traite dans l'ordre), les demandes
// qui arrivent pendant un calcul sont retenues et relancées avec la vue du moment, et chaque côté du rideau
// reçoit son image. Fabrique à dépendances explicites : ce qui change au fil du temps (la vue, le flux, le
// territoire) arrive par des fonctions ; l'état lisible du dehors est `etat`.

function creerCalculRelief(d) {
  const { $, relief, infoRelief, activite, FLUX_CHOIX, VUE_GRILLE, VOLETS, MODE_CARTE, RELIEF, CONFIG, L,
    NOMS_CLASSES, construireLUT, vueCartes, voletDe, reglages, estRelief, libelleCouche, outils,
    vueCourante, flux, territoire, reglagesDe, majStatut } = d;
  const { cotes } = reglages;

  // Un seul calcul à la fois : le worker les traite dans l'ordre, et en
  // empiler pendant un déplacement ne ferait que retarder le dernier, le seul
  // qui compte. Une demande pendant un calcul est retenue, et relancée à la
  // fin avec la vue du moment. `enCalcul` est la promesse du calcul en
  // cours, qui se tient à la fin : qui doit l'attendre l'attend, sans sonder.
  let enCalcul = null, aRefaire = false, minuteur = null;
  const etatRelief = { texte: '', erreur: '', classes: [], etirements: {} };
  // L'étirement de la dernière image de chaque côté : le relief drapé sur le
  // nuage 3D reprend le même, pour que les deux vues soient la même image.
  let classesAffichees = '';
  // Une case par classe présente dans les points reçus, cochée si elle compte
  // comme sol. Reconstruite seulement quand la liste change.
  const majClassesSol = () => {
    const cle = etatRelief.classes.map(([c]) => c).join(',');
    if (cle === classesAffichees) return;
    classesAffichees = cle;
    $('vue-classes-sol').innerHTML = etatRelief.classes.map(([c]) => `<label class="case"><input type="checkbox" value="${c}"`
      + `${reglages.classesSol.has(c) ? ' checked' : ''}><span>${NOMS_CLASSES[c] || `classe ${c}`}</span></label>`).join('');
  };
  // Palettes de 256 couleurs, une par couche, calculées une fois.
  const luts = new Map();
  const lutCouche = (cle) => {
    const def = RELIEF.COUCHES.find((c) => c.cle === cle);
    if (!def) return null;   // l'ombrage coloré porte ses couleurs
    if (!luts.has(cle)) luts.set(cle, construireLUT(def.palette));
    return luts.get(cle);
  };
  const calculer = async (forcer = false) => {
    // En 3D, la carte est masquée : ses images attendront le retour (spec
    // 2026-09-27, « rien ne suit la carte pendant qu'on est en 3D »). Les
    // calculer quand même mettait le nuage 3D en file derrière elles. Seul
    // le nuage lui-même peut forcer un calcul, pour lire la bonne surface.
    if (!forcer && !$('vue-3d').hidden) return;
    if (enCalcul) { aRefaire = true; return; }
    const vue = vueCourante();
    // Au-delà du seuil, aucun point n'est demandé, donc aucun relief de plus :
    // la dernière image calculée reste, et rétrécit avec la carte ; ailleurs,
    // le voile du côté laisse voir la carte, et le libellé du rideau dit de
    // zoomer. Rien que du COPC (choix de l'utilisateur) : le MNT puis
    // l'ombrage de l'IGN y ont été essayés, puis écartés.
    const tropLarge = vue && FLUX_CHOIX.surfaceKm2(vue) > CONFIG.flux.surfaceMaxPointsKm2;
    const aCalculer = MODE_CARTE.cotesAffiches(vueCartes.mode()).filter((c) => estRelief(cotes[c]));
    for (const c of ['gauche', 'droite']) {
      voletDe(c).calque.definirLibelle(c, tropLarge && estRelief(cotes[c]) ? 'Zoomez pour calculer le relief' : libelleCouche(cotes[c]));
    }
    if (!vue || tropLarge || !aCalculer.length) {
      // Gardée seulement si c'est bien la couche du côté : après un
      // changement de couche, l'ancienne image mentirait sous le libellé.
      for (const c of aCalculer) if (etatRelief.etirements[c]?.cle !== cotes[c]) voletDe(c).calque.vider(c);
      etatRelief.texte = '';
      majStatut();
      return;
    }
    const pas = FLUX_CHOIX.pasPourVue(vue.xmax - vue.xmin, vue.largeurPx, CONFIG.flux.pasMinM);
    const geo = VUE_GRILLE.definir(vue, pas, VUE_GRILLE.marge({ ...CONFIG.relief, ...CONFIG.flux, svfRayonM: reglages.svfRayonM }), infoRelief.coteMax);
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
          ecran: VOLETS.ecran(pb, z, territoire()),
          bornes: L.latLngBounds(v.carte.unproject(pb.getBottomLeft(), z), v.carte.unproject(pb.getTopRight(), z)),
        }];
      }));
      const actifs = [...flux().voulues()];
      etatRelief.erreur = '';
      const textes = [];
      // Un côté après l'autre : la surface est rangée une fois pour les deux,
      // seule la couche change (gardée par le worker d'un calcul à l'autre).
      for (const c of aCalculer) {
        const cle = cotes[c];
        const volet = voletDe(c);
        const { ecran, bornes } = ecrans.get(volet);
        const r = await relief.image(geo, cle, ecran, lutCouche(cle), {
          contraste: reglages.contraste, lisser: reglages.lisser, actifs, couche: reglagesDe(cle),
        });
        if (cotes[c] !== cle) continue;   // le côté a changé pendant le calcul
        if (!r) { volet.calque.vider(c); continue; }
        volet.calque.afficher(c, r, bornes);
        etatRelief.etirements[c] = { cle, min: r.min, max: r.max };
        textes.push(`${c} ${(r.duree / 1000).toFixed(2)} s (${r.moteurSurface}${r.moteurCouche && r.moteurCouche !== r.moteurSurface ? ' + ' + r.moteurCouche : ''}`
          + `${infoRelief.filPrincipal ? ', fil principal' : ''} ; surface ${(r.dureeSurface / 1000).toFixed(2)} s`
          + `, couche ${r.recalcul ? (r.dureeCouche / 1000).toFixed(2) + ' s' : 'gardée'}, image ${((r.dureeImage || 0) / 1000).toFixed(2)} s)`);
        etatRelief.classes = r.classes || [];
      }
      etatRelief.texte = textes.length ? `relief ${textes.join(' · ')} · ${geo.W}×${geo.H} cases de ${geo.pas.toFixed(2)} m` : '';
      majClassesSol();
      // Un point cherché par ses coordonnées avant que le relief n'y soit
      // calculé : son altitude arrive avec cette image.
      const sel = outils.selection();
      if (sel && sel.sol == null) {
        const pt = await relief.lire(sel.x, sel.y);
        if (pt?.altitude != null) outils.afficherSelection(sel.x, sel.y, pt.altitude, pt.hauteur);
      }
    } catch (err) {
      console.error(err);
      etatRelief.texte = `relief en échec : ${err.message}`;
      etatRelief.erreur = err.message;
    } finally {
      enCalcul = null;
      terminer();
      activite.relief = false;
    }
    majStatut();
    if (aRefaire) { aRefaire = false; calculer(); }
  };
  // Pendant l'arrivée des blocs, un recalcul au plus toutes les 1,5 s ; au
  // déplacement, tout de suite — la vue d'avant n'a plus de sens.
  const planifier = (delai) => {
    if (delai === 0 && minuteur) { clearTimeout(minuteur); minuteur = null; }
    if (minuteur) return;
    minuteur = setTimeout(() => { minuteur = null; calculer(); }, delai);
  };
  return {
    /** Ce que le dernier calcul a dit : `texte` (diagnostic), `erreur`, `classes` présentes, `etirements` par côté. */
    etat: etatRelief,
    calculer,
    planifier,
    /** Attend le calcul en cours (s'il y en a un), puis en lance un à jour, même en 3D. */
    async aJour() { while (enCalcul) await enCalcul; await calculer(true); },
  };
}
