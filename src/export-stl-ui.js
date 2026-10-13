// La partie « STL » de la fenêtre d'export (#dlg-export, pilotée par panneau-3d.js) : la surface de la zone affichée, faite des
// points des classes cochées (la plus haute de chaque case), devient un solide fermé (stl.js). Rien ne part sur le réseau : la
// grille vient du worker du relief, le fichier est écrit dans l'onglet. La fenêtre appelle `ouvrir`, `annoncer`, `telecharger` ;
// `surChangement` (posé par elle) la prévient quand une lecture se termine.

function creerExportStlUI({ api, $, relief, rectVue, telecharger, STL, CONFIG, NOMS_CLASSES }) {
  api.surChangement = null;   // `api` est l'objet que la fenêtre tient déjà : on le remplit sur place, sans le remplacer
  let grille = null, lue = false, listee = false, numero = 0;
  let coches = new Set();

  const reglages = () => ({
    largeurMm: Number($('stl-largeur').value) || CONFIG.stl.largeurMm,
    epaisseurMm: Number($('stl-epaisseur').value) || CONFIG.stl.epaisseurMm,
    maxCotes: CONFIG.stl.maxCotes,
  });

  function listerClasses() {
    $('exp-stl-classes').innerHTML = grille.classes.map(([cls, n]) => {
      const couleur = CONFIG.rendu.couleursClasse[cls] || CONFIG.rendu.couleurClasseDefaut;
      return `<label class="case"><input type="checkbox" data-stl="${cls}"${coches.has(cls) ? ' checked' : ''}>`
        + `<i style="background:${couleur};width:11px;height:11px;border-radius:2px;flex:none"></i>`
        + `<span>${NOMS_CLASSES[cls] || `classe ${cls}`} <small>${n.toLocaleString('fr-FR')} points</small></span></label>`;
    }).join('');
    listee = true;
  }

  async function lire() {
    lue = true;
    const mien = ++numero;
    const g = await relief().grilleStl(rectVue(), [...coches], Number($('stl-pas').value) || CONFIG.stl.pasMinM, CONFIG.stl.maxCotes);
    if (mien !== numero) return;
    grille = g;
    if (g && !listee) listerClasses();
    api.surChangement?.();
  }

  /** À chaque ouverture de la fenêtre : on repart du sol, sur la zone du moment. */
  api.ouvrir = () => {
    grille = null; lue = false; listee = false; numero++;
    coches = new Set(CONFIG.raster.classesSolDefaut);
    $('exp-stl-classes').innerHTML = '';
  };

  /** Ce que la fenêtre dit et si « Télécharger » est permis ; lance la lecture de la grille au premier appel. */
  api.annoncer = () => {
    if (!lue) { lire(); return { actif: false, message: 'Lecture de la surface…' }; }
    if (!grille) return { actif: false, message: 'Aucun point chargé sur cette zone : attendez la fin du chargement, ou zoomez.' };
    const connues = grille.z.reduce((n, v) => n + (Number.isNaN(v) ? 0 : 1), 0);
    if (!connues) return { actif: false, message: 'Aucun point des classes cochées dans cette zone.' };
    const vides = grille.z.length - connues;
    const r = STL.resume({ W: grille.W, H: grille.H, pas: grille.pas, largeurMm: reglages().largeurMm });
    const comble = vides ? ` ${vides.toLocaleString('fr-FR')} ${vides > 1 ? 'cases sans point seront comblées' : 'case sans point sera comblée'}.` : '';
    return { actif: true, message: r.texte + comble };
  };

  $('exp-stl-classes').addEventListener('change', (e) => {
    const c = e.target.closest('input[data-stl]');
    if (!c) return;
    const cls = Number(c.dataset.stl);
    if (c.checked) coches.add(cls); else coches.delete(cls);
    lire();
    api.surChangement?.();
  });
  for (const id of ['stl-largeur', 'stl-epaisseur']) $(id).addEventListener('input', () => api.surChangement?.());
  $('stl-pas').addEventListener('change', () => { lire(); api.surChangement?.(); });   // une autre qualité : une autre grille

  api.telecharger = async () => {
    await new Promise((r) => setTimeout(r, 30));   // laisse la fenêtre se redessiner avant le calcul
    const f = STL.construire(STL.preparer(grille, reglages()));
    telecharger(`scopus-maquette-${new Date().toISOString().slice(0, 10)}.stl`, new Blob(f.parties), 'model/stl');
  };
  return api;
}
