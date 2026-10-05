// La recherche de lieu (champ « Lieu » du panneau) : géocodeur de l'IGN, un résultat direct ou une liste à
// choisir, puis la carte va au lieu.

function creerRechercheLieu({ $, IGN, carte, statut, alerterPanne }) {
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
}
