// La fenêtre « Exporter en STL » : la surface de la dernière vue calculée, rognée à la zone affichée, devient un solide fermé
// (stl.js). Rien ne part sur le réseau : la grille vient du worker du relief, le fichier est écrit dans l'onglet.

function creerExportStlUI({ $, relief, rectVue, telecharger, STL, CONFIG }) {
  const dlg = $('dlg-stl');
  let grille = null;   // celle de la surface choisie, relue à chaque ouverture et quand on change de surface
  let numero = 0;

  const sommet = () => document.querySelector('input[name="stl-surface"]:checked')?.value === 'sommet';
  const reglages = () => ({
    largeurMm: Number($('stl-largeur').value) || CONFIG.stl.largeurMm,
    exageration: Number($('stl-exageration').value) || CONFIG.stl.exageration,
    epaisseurMm: Number($('stl-epaisseur').value) || CONFIG.stl.epaisseurMm,
    maxCotes: CONFIG.stl.maxCotes,
  });

  function annoncer() {
    const avis = $('stl-avis');
    avis.hidden = true;
    $('stl-telecharger').disabled = !grille;
    if (!grille) return;
    const d = STL.dimensions(grille.W, grille.H, CONFIG.stl.maxCotes);
    $('stl-resume').textContent = STL.resume({ W: d.W, H: d.H, pas: grille.pas * d.facteur, largeurMm: reglages().largeurMm }).texte;
    const trous = grille.z.reduce((n, v) => n + (Number.isNaN(v) ? 1 : 0), 0);
    if (trous) { avis.hidden = false; avis.textContent = `${trous} cases sans donnée (eau, zone vide) seront comblées par leurs voisines.`; }
  }

  async function lireGrille() {
    const mien = ++numero;
    $('stl-resume').textContent = 'Lecture de la surface…';
    $('stl-telecharger').disabled = true;
    const g = await relief().grilleStl(rectVue(), sommet());
    if (mien !== numero) return;
    grille = g;
    if (!g) { $('stl-resume').textContent = 'Aucun relief calculé sur cette zone : attendez la fin du calcul, ou zoomez.'; return; }
    annoncer();
  }

  $('stl-ouvrir').addEventListener('click', () => {
    if (!rectVue()) return;
    grille = null;
    dlg.showModal();
    lireGrille();
  });
  $('stl-fermer').addEventListener('click', () => dlg.close());
  for (const r of document.querySelectorAll('input[name="stl-surface"]')) r.addEventListener('change', lireGrille);
  for (const id of ['stl-largeur', 'stl-exageration', 'stl-epaisseur']) $(id).addEventListener('input', annoncer);

  $('stl-telecharger').addEventListener('click', async () => {
    if (!grille) return;
    $('stl-telecharger').disabled = true;
    $('stl-resume').textContent = 'Fabrication du maillage…';
    await new Promise((r) => setTimeout(r, 30));   // laisse la fenêtre se redessiner avant le calcul
    try {
      const f = STL.construire(STL.preparer(grille, reglages()));
      telecharger(`scopus-maquette-${new Date().toISOString().slice(0, 10)}.stl`, new Blob(f.parties), 'model/stl');
      dlg.close();
    } catch (e) {
      $('stl-resume').textContent = e.message;
    }
    annoncer();
  });
  return { fermer: () => dlg.close() };
}
