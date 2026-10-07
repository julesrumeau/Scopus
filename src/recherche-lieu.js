// Aller à un lieu : la recherche (champ « Lieu » du panneau : géocodeur de l'IGN, un résultat direct ou une liste à
// choisir, puis la carte va au lieu) et « Ma position » (le GPS de l'appareil, voir `localisation.js`).

function creerRechercheLieu({ $, IGN, carte, statut, alerter, alerterPanne }) {
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
      statut(`${lieux.length} lieux : choisissez`);
    } catch (e) {
      if (e.name !== 'AbortError') alerterPanne('Recherche', e);
    }
  }

  function allerAu(lieu) {
    $('resultats-recherche').hidden = true;
    carte.allerA(lieu.lon, lieu.lat);
    statut(lieu.label);
  }

  $('btn-recherche').addEventListener('click', rechercher);
  $('recherche').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); rechercher(); }
    if (e.key === 'Escape') $('resultats-recherche').hidden = true;
  });

  /** « Ma position » : la carte se recentre sur l'appareil, avec un point bleu et, si elle est large, son incertitude. */
  function brancherLocalisation() {
    let repere = null;
    const centrer = (lat, lon, zoom, precision) => {
      repere?.remove();
      carte.map.setView([lat, lon], zoom, { animate: false });
      // La poignée du rideau est au centre de la carte : on décale la vue d'un dixième de sa largeur pour que le point ne tombe pas dessous.
      carte.map.panBy([Math.round(carte.map.getSize().x * 0.1), 0], { animate: false });
      repere = L.layerGroup().addTo(carte.map);
      // Le volet des outils (au-dessus du relief) existe une fois la vue du relief démarrée.
      const pane = carte.map.getPane('outilsVue') ? 'outilsVue' : 'markerPane';
      if (precision > 15) L.circle([lat, lon], { radius: precision, pane, color: '#3b9cff', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(repere);
      L.marker([lat, lon], { pane: 'markerPane', interactive: false, keyboard: false, icon: L.divIcon({ className: 'repere-position', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(repere);
      statut('Votre position', '');
    };
    creerLocalisation({ bouton: $('btn-localiser'), geolocalisation: navigator.geolocation, centrer, dire: (t) => statut(t, 'travail'), alerter });
  }
  brancherLocalisation();
}
