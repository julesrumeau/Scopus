// La fenêtre « Exporter la mesure » : le format (GeoJSON par défaut), la case « Avec l'altitude du sol » (décochée
// par défaut, grisée si une altitude manque), et le téléchargement. La logique des fichiers est dans
// `export-mesure.js` (pur, testé) ; ici, seulement la page. Une seule fenêtre, plusieurs boutons (`lier`) : la mesure de
// la carte et celle du profil ne changent que par leurs points.

function creerExportMesure({ $, projVue, telecharger }) {
  let source = () => [];   // les points (coordonnées locales) de la mesure qu'on exporte : carte ou profil
  /** Les points de la mesure en WGS84 : `{ lat, lon, sol, hauteur }` (la mesure les garde en coordonnées locales). */
  function pointsGeo() {
    return source().map((p) => {
      const g = projVue().versGeo(p.x, p.y);
      return { lat: g.lat, lon: g.lon, sol: p.sol, hauteur: p.hauteur || 0 };
    });
  }

  const formatChoisi = () => document.querySelector('input[name="fmt-exm"]:checked')?.value || 'geojson';

  /** Ouvre la fenêtre : décochée à chaque ouverture, grisée si une altitude manque. */
  function ouvrir() {
    const pts = pointsGeo();
    const r = EXPORT_MESURE.resumer(pts);
    $('exm-resume').textContent = r.texte;
    $('exm-altitude').checked = false;
    $('exm-altitude').disabled = !r.altitudeDisponible;
    $('exm-case-altitude').classList.toggle('grisee', !r.altitudeDisponible);
    $('exm-altitude-raison').hidden = !r.raisonAltitude;
    $('exm-altitude-raison').textContent = r.raisonAltitude;
    $('dlg-export-mesure').showModal();
  }

  function telechargerFichier() {
    const f = EXPORT_MESURE.exporter(formatChoisi(), pointsGeo(), { altitude: $('exm-altitude').checked });
    telecharger(f.nom, f.contenu, f.type);
    $('dlg-export-mesure').close();
  }

  $('exm-fermer').addEventListener('click', () => $('dlg-export-mesure').close());
  $('exm-telecharger').addEventListener('click', telechargerFichier);

  /** Un bouton qui exporte la mesure dont `points()` donne les points en coordonnées locales. */
  function lier(idBouton, points) {
    $(idBouton).addEventListener('click', () => { source = points; ouvrir(); });
  }
  return { lier };
}
