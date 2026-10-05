// La synchronisation de deux cartes Leaflet (les deux cartes du mode « deux cartes synchronisées ») :
// le déplacement et le zoom de l'une se retrouvent sur l'autre, dans les deux sens, **sans écho** ; et
// le curseur de l'une est un repère sur l'autre. Ne dépend de Leaflet que par quatre méthodes
// (`on`, `off`, `getCenter`/`getZoom`, `setView`), pour se tester avec des cartes factices.

const SYNCHRO = (() => {
  const memeVue = (a, b) => {
    const ca = a.getCenter(), cb = b.getCenter();
    return a.getZoom() === b.getZoom() && Math.abs(ca.lat - cb.lat) < 1e-9 && Math.abs(ca.lng - cb.lng) < 1e-9;
  };

  /**
   * Lie `a` et `b`. Au départ `b` se cale sur `a`. `options.reperes` : une `Map` carte → repère
   * (`deplacer(latlng)`, `cacher()`) pour montrer le curseur de l'une sur l'autre. Rend `{ delier }`.
   */
  function lier(a, b, options = {}) {
    // Verrou : pendant qu'une carte est mise à jour à la demande de l'autre, ses évènements ne repartent pas.
    let enCours = false;
    const suivre = (source, cible) => () => {
      if (enCours || memeVue(source, cible)) return;
      enCours = true;
      try {
        cible.setView(source.getCenter(), source.getZoom(), { animate: false });
      } finally {
        enCours = false;
      }
    };
    const ab = suivre(a, b), ba = suivre(b, a);
    a.on('move zoom', ab);
    b.on('move zoom', ba);

    // Le curseur : un repère sur l'autre carte, qui disparaît quand le curseur quitte celle-ci.
    const reperes = options.reperes;
    const ecouteurs = [];
    if (reperes) {
      for (const [source, cible] of [[a, b], [b, a]]) {
        const repere = reperes.get(cible);
        if (!repere) continue;
        const sur = (e) => repere.deplacer(e.latlng);
        const hors = () => repere.cacher();
        source.on('mousemove', sur);
        source.on('mouseout', hors);
        ecouteurs.push([source, 'mousemove', sur], [source, 'mouseout', hors]);
      }
    }

    ab();   // la seconde se cale sur la première
    return {
      delier() {
        a.off('move zoom', ab);
        b.off('move zoom', ba);
        for (const [source, evenement, f] of ecouteurs) source.off(evenement, f);
      },
    };
  }

  return { lier };
})();
