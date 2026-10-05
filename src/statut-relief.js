// Ce que le statut dit à l'utilisateur de l'état de son relief : une phrase simple (« Relief à jour »,
// « Zoomez pour calculer le relief »…), ou, avec « &debug » / « &chrono », le détail chiffré (surface, dalles,
// blocs, points, durées). Des fonctions pures : l'état arrive en paramètre, l'effet (écrire dans la page,
// vider une couche) reste à l'appelant.

const STATUT_RELIEF = (() => {
  const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;

  /** La ligne sous la liste des couches : les blocs encore attendus. */
  function ligneAttente(e) {
    return e.attente && !e.tropLarge ? `Affinage… ${pluriel(e.attente, 'bloc')} attendu${e.attente > 1 ? 's' : ''}` : '';
  }

  /**
   * @returns {{texte: string, genre: (string|undefined)}} `genre` : 'erreur', 'travail' ou rien.
   */
  function message({ e, lenteIGN, erreurRelief, texteRelief, diagnostic, reliefAffiche, sansLidar, surfaceMaxKm2, milliers }) {
    const genre = e.echecs || erreurRelief ? 'erreur' : e.attente ? 'travail' : undefined;
    if (!diagnostic) {
      const texte = sansLidar || (e.tropLarge && reliefAffiche ? 'Zoomez pour calculer le relief'
        : e.echecs ? `${pluriel(e.echecs, 'dalle')} en échec, réessai en cours — ${e.erreur}`
          : erreurRelief ? `Le relief n’a pas pu être calculé — ${erreurRelief}`
            : !reliefAffiche ? 'Aucune couche de relief affichée'
              : e.attente && lenteIGN ? 'Chargement ralenti'
              : e.attente ? 'Relief en cours d’affinage…'
                : texteRelief ? 'Relief à jour' : 'Relief en calcul…');
      return { texte, genre };
    }
    const flux = e.tropLarge
      ? `Flux : ${e.surfaceKm2.toFixed(0)} km² affichés, trop pour les points (seuil ${surfaceMaxKm2} km²) — zoomez`
      : `Flux : ${e.surfaceKm2.toFixed(1)} km² · ${e.dallesOuvertes} dalles · ${e.charges} blocs · ${milliers(e.points)} points`
        + (e.attente ? ` · ${e.attente} en attente` : '')
        + (e.echecs ? ` · ${pluriel(e.echecs, 'dalle')} en échec, réessai en cours — ${e.erreur}` : '');
    return {
      texte: sansLidar ? `Flux : ${sansLidar}` : flux + (texteRelief ? ` · ${texteRelief}` : ''),
      genre: e.echecs ? 'erreur' : e.attente ? 'travail' : undefined,
    };
  }

  return { message, ligneAttente };
})();
