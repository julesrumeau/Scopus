// Ce que les outils de la carte dessinent : le point sélectionné, la chaîne de mesure. En SVG dans un volet à
// part (`outilsVue`), au-dessus du relief et sous le rideau : les marqueurs restent visibles des deux côtés.
// `traceOutils` et `versLatLng` sont aussi ceux de la bande du profil.

function creerOutilsCarte({ carte, projVue, MESURE, deplacerPoint }) {
  // Un volet à part, au-dessus du relief (450) et sous le rideau (700) : les
  // marqueurs restent visibles des deux côtés.
  carte.map.createPane('outilsVue').style.zIndex = 660;
  // En SVG, pas dans le canevas de la carte (preferCanvas) : quelques
  // marqueurs et traits, qui restent ainsi des éléments qu'on peut viser et
  // vérifier.
  const traceOutils = L.svg({ pane: 'outilsVue' });
  const versLatLng = (x, y) => { const w = projVue().versGeo(x, y); return [w.lat, w.lon]; };
  let coucheSelection = null, coucheMesure = null, coucheMarqueurs = null, apercuDroit = null;
  const outils = {
    selection(p) {
      coucheSelection?.remove();
      coucheSelection = p ? L.circleMarker(versLatLng(p[0], p[1]), {
        pane: 'outilsVue', renderer: traceOutils, radius: 7, color: '#fff', weight: 2, fillColor: '#ffd24a', fillOpacity: 1,
        className: 'marqueur-selection', interactive: false,
      }).addTo(carte.map) : null;
    },
    /** Shift + clic : le trait pointillé du point précédent à l'endroit où le point va tomber (`[de, vers]` en [lat, lon]) ; `null` l'efface. */
    apercu(lls) {
      apercuDroit?.remove();
      apercuDroit = lls ? L.polyline(lls, { pane: 'outilsVue', renderer: traceOutils, color: '#ffd24a', weight: 1.5, dashArray: '5 5', className: 'apercu-droit', interactive: false }).addTo(carte.map) : null;
    },
    /** La chaîne entière : trait, étiquettes, et un marqueur déplaçable par point. */
    mesure(points) {
      coucheMarqueurs?.remove();
      coucheMarqueurs = L.layerGroup().addTo(carte.map);
      points.forEach((p, i) => poserMarqueur(i, versLatLng(p.x, p.y)));
      outils.trace(points);
    },
    /** Le trait et les distances seulement (pendant qu'on glisse un point, les marqueurs ne sont pas refaits). */
    trace(points) {
      coucheMesure?.remove();
      coucheMesure = L.layerGroup().addTo(carte.map);
      const lls = points.map((p) => versLatLng(p.x, p.y));
      if (lls.length > 1) {
        L.polyline(lls, { pane: 'outilsVue', renderer: traceOutils, color: '#ffd24a', weight: 2.5, className: 'trace-mesure', interactive: false }).addTo(coucheMesure);
      }
      // La distance horizontale au milieu de chaque segment, comme en 2D : la
      // seule des trois qui se lise sur un plan.
      MESURE.segments(points).forEach((sg, i) => {
        L.tooltip({ permanent: true, direction: 'center', className: 'etiquette-mesure', interactive: false })
          .setLatLng([(lls[i][0] + lls[i + 1][0]) / 2, (lls[i][1] + lls[i + 1][1]) / 2])
          .setContent(`${sg.horizontale.toFixed(1)} m`)
          .addTo(coucheMesure);
      });
    },
  };
  /**
   * Un point de la mesure : un marqueur que Leaflet sait glisser (souris et doigt). Il ne se saisit qu'en mode Mesure
   * (le CSS coupe `pointer-events` sinon). Pendant le glissé, `deplacerPoint(i, lat, lng, false)` ; au lâcher, `true`.
   */
  function poserMarqueur(i, ll) {
    const icone = L.divIcon({ className: 'point-mesure', html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 11] });
    const m = L.marker(ll, { icon: icone, draggable: true, keyboard: false, pane: 'markerPane' }).addTo(coucheMarqueurs);
    const lire = (fin) => { const q = m.getLatLng(); deplacerPoint(i, q.lat, q.lng, fin); };
    m.on('drag', () => lire(false));
    m.on('dragend', () => lire(true));
  }
  return { traceOutils, versLatLng, ...outils };
}
