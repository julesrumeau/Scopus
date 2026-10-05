// Les cartes de la vue normale : les volets (une carte Leaflet, son calque de relief, les côtés qu'elle
// porte), le passage d'un mode à l'autre — scindée par le rideau, une seule carte, deux cartes
// synchronisées (voir `MODE_CARTE`) — et les crédits réunis.
//
// Un seul métier : savoir **quelles cartes existent et ce qu'elles portent**. Tout ce qui lui est
// étranger lui est passé (dépendances explicites, `app.js` les assemble) : la création des cartes et des
// calques, le branchement du curseur, l'affichage dans la page, ce qu'il faut faire après un changement
// (panneau, outils, zone à charger, lien). Elle ne connaît ni le DOM ni Leaflet directement, d'où des
// cartes factices dans les tests.

/**
 * Les crédits des deux cartes réunis dans le cadre de la seconde (en bas à droite de l'écran), celui de la
 * première masqué : une seule fois. Leaflet compte les doublons, « IGN » n'apparaît qu'une fois.
 * `obtenirCarteB` rend la seconde carte (qui peut ne pas exister encore).
 */
function creerCreditsReunis(carteA, obtenirCarteB) {
  const ajoutes = new Map();   // texte → nombre de fois où il a été ajouté au cadre de la seconde carte
  const ajouter = (e) => {
    const t = e.layer.getAttribution?.();
    if (!t) return;
    obtenirCarteB().attributionControl.addAttribution(t);
    ajoutes.set(t, (ajoutes.get(t) || 0) + 1);
  };
  const retirer = (e) => {
    const t = e.layer.getAttribution?.();
    if (!t || !ajoutes.get(t)) return;
    obtenirCarteB().attributionControl.removeAttribution(t);
    ajoutes.set(t, ajoutes.get(t) - 1);
  };
  return {
    /** `true` : réunir ; `false` : défaire (le cadre de la première revient, la seconde est nettoyée). */
    reunir(oui) {
      const cadreA = carteA.attributionControl.getContainer();
      if (oui) {
        cadreA.style.display = 'none';
        carteA.eachLayer((l) => ajouter({ layer: l }));
        carteA.on('layeradd', ajouter);
        carteA.on('layerremove', retirer);
      } else {
        carteA.off('layeradd', ajouter);
        carteA.off('layerremove', retirer);
        for (const [t, n] of ajoutes) for (let i = 0; i < n; i++) obtenirCarteB()?.attributionControl.removeAttribution(t);
        ajoutes.clear();
        cadreA.style.display = '';
      }
    },
  };
}

/**
 * @param {object} deps
 *  - `carte` : la carte principale `{ map, invalider() }`
 *  - `calquePrincipal` : son calque de relief
 *  - `creerCarteSecondaire({ centre, zoom })` : la seconde carte, prête (vue posée, photo en fond)
 *  - `creerCalque(carteLeaflet)` : le calque de relief posé sur une carte
 *  - `creerRepere(carteLeaflet)` : le repère du curseur de l'autre carte `{ deplacer(latlng), cacher() }`
 *  - `brancherCurseur(carteLeaflet, volet)` : ce que le relief dit sous le curseur
 *  - `surDeplacement()` : la seconde carte a bougé (le lien le suit)
 *  - `affichage` : `{ montrerSecondaire(bool), marquerMode(mode) }`, l'effet dans la page
 *  - `oublierFond(cote)` : le panneau oublie le fond de tuiles posé de ce côté
 *  - `apres(mode)` : après un changement (panneau, outils, zone à charger, lien)
 *  - `VOLETS`, `MODE_CARTE`, `SYNCHRO` : les modules purs
 */
function creerVueCartes(deps) {
  const { carte, calquePrincipal, VOLETS, MODE_CARTE, SYNCHRO } = deps;
  const voletA = { carte: carte.map, calque: calquePrincipal, cotes: ['gauche', 'droite'] };
  let voletB = null, carteB = null, liaison = null, reperes = null;
  let volets = [voletA];
  let mode = 'scinde';
  const credits = creerCreditsReunis(carte.map, () => carteB);
  const voletDe = (cote) => VOLETS.voletDe(volets, cote);

  /** La seconde carte, créée au premier passage. */
  function creerSeconde() {
    // Une vue d'abord : un calque Leaflet n'est ajouté (`onAdd`) qu'une fois la carte prête.
    carteB = deps.creerCarteSecondaire({ centre: carte.map.getCenter(), zoom: carte.map.getZoom() });
    voletB = { carte: carteB, calque: deps.creerCalque(carteB), cotes: ['droite'] };
    deps.brancherCurseur(carteB, voletB);
    reperes = new Map([[carte.map, deps.creerRepere(carte.map)], [carteB, deps.creerRepere(carteB)]]);
    carteB.on('moveend', deps.surDeplacement);
  }

  function passerEnDeuxCartes() {
    deps.affichage.montrerSecondaire(true);
    if (!carteB) creerSeconde();
    carte.invalider();
    carteB.invalidateSize();
    voletA.cotes = ['gauche'];
    calquePrincipal.definirUnique('gauche');
    voletB.calque.definirUnique('droite');
    volets = [voletA, voletB];
    liaison?.delier();
    liaison = SYNCHRO.lier(carte.map, carteB, { reperes });
    credits.reunir(false);   // jamais deux fois les écouteurs
    credits.reunir(true);
  }

  function revenirAUneCarte() {
    liaison?.delier();
    liaison = null;
    if (carteB) credits.reunir(false);
    for (const r of reperes?.values() ?? []) r.cacher();
    deps.affichage.montrerSecondaire(false);
    voletA.cotes = ['gauche', 'droite'];
    volets = [voletA];
    calquePrincipal.definirUnique(mode === 'unique' ? MODE_CARTE.coteUnique : null);
    carte.invalider();
  }

  /** Passe au mode `nouveau` (`scinde`, `unique` ou `double`) ; un mode inconnu ne change rien. */
  function changerMode(nouveau) {
    if (!(nouveau in MODE_CARTE.libelles)) return;
    // Les fonds de tuiles et les images changent peut-être de calque : on repart d'une page blanche,
    // le panneau les reposera dans le bon.
    for (const c of ['gauche', 'droite']) {
      const v = voletDe(c);
      v.calque.definirFond(c, null);
      v.calque.vider(c);
      deps.oublierFond(c);
    }
    mode = nouveau;
    if (mode === 'double') passerEnDeuxCartes(); else revenirAUneCarte();
    deps.affichage.marquerMode(mode);
    deps.apres(mode);
  }

  return {
    mode: () => mode,
    volets: () => volets,
    voletDe,
    changerMode,
    /** La carte principale, la seconde (si elle existe) : pour ce qui doit suivre toutes les cartes. */
    cartes: () => (carteB ? [carte.map, carteB] : [carte.map]),
  };
}
