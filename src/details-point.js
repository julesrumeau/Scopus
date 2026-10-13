// « Détails du point » : à la demande, le bloc entier qui contient le point chargé le plus proche de la sélection est
// téléchargé (une seule requête, 25 Ko à 1,2 Mo), le point lu avec tous ses champs, et mis en lignes
// (`ATTRIBUTS_POINT`). Rien n'est gardé : la vue ne porte que XY, Z et la classe. Les dépendances sont injectées.

const DETAILS_POINT = (() => {
  function creer({ pointProche, descripteurBloc, recuperer, decoder, ATTRIBUTS_POINT, nomsClasses }) {
    /** `{ lignes, contexte }` ou `{ erreur }` pour le point visé en (x, y) Lambert-93, d'altitude `z` (ou `null`). */
    async function lire({ x, y, z }) {
      const p = await pointProche(x, y, z);
      if (!p) return { erreur: 'Aucun point chargé à cet endroit : zoomez, ou attendez la fin du chargement.' };
      const d = descripteurBloc(p.cle);
      if (!d) return { erreur: 'Ce bloc n’est plus chargé : zoomez à nouveau sur la zone, puis réessayez.' };
      try {
        const octets = await recuperer(d.url, { plage: [d.offset, d.offset + d.taille - 1] });
        const r = await decoder({
          type: 'point', octets: octets.slice().buffer, indice: p.indice, nbPoints: d.nbPoints,
          formatPoint: d.formatPoint, longueurPoint: d.longueurPoint,
        });
        const point = ATTRIBUTS_POINT.lirePoint(r.enregistrement, { echelle: d.echelle, decalage: d.decalage });
        const code = /_(\d{4}_\d{4})_/.exec(d.nomDalle || '')?.[1];
        return { lignes: ATTRIBUTS_POINT.lignes(point, { nomsClasses }), contexte: `Dalle ${code || 'n/d'}, niveau ${d.niveau}, point ${p.indice + 1} sur ${d.nbPoints}` };
      } catch (e) {
        return { erreur: 'Lecture impossible : le réseau ou le décodage a échoué. Réessayez dans un instant.' };
      }
    }
    return { lire };
  }
  return { creer };
})();

/** Le bouton « Détails du point » et sa fenêtre : branchés sur la sélection courante (`outils.selection()`). */
function creerDetailsPointUI({ $, outils, flux, relief, ATTRIBUTS_POINT, NOMS_CLASSES, recuperer, decoder }) {
  const details = DETAILS_POINT.creer({
    pointProche: (x, y, z) => relief().pointProche(x, y, z, 2),
    descripteurBloc: (cle) => flux.descripteurBloc(cle),
    recuperer, decoder, ATTRIBUTS_POINT, nomsClasses: NOMS_CLASSES,
  });
  const dlg = $('dlg-details-point');
  let numero = 0;   // une réponse tardive d'une demande précédente ne s'affiche pas

  $('btn-details-point').addEventListener('click', async () => {
    const s = outils.selection();
    if (!s) return;
    const mien = ++numero;
    $('details-contexte').textContent = '';
    $('details-tableau').tBodies[0].innerHTML = '';
    $('details-etat').hidden = false;
    $('details-etat').textContent = 'Lecture du point…';
    if (!dlg.open) dlg.showModal();
    const r = await details.lire({ x: s.x, y: s.y, z: s.sommet ?? null });
    if (mien !== numero) return;
    if (r.erreur) { $('details-etat').textContent = r.erreur; return; }
    $('details-etat').hidden = true;
    $('details-contexte').textContent = r.contexte;
    let groupe = null;
    $('details-tableau').tBodies[0].innerHTML = r.lignes.map((l) => {
      const entete = l.groupe !== groupe ? `<tr><th colspan="2">${l.groupe}</th></tr>` : '';
      groupe = l.groupe;
      return `${entete}<tr><td>${l.libelle}</td><td>${l.valeur}</td></tr>`;
    }).join('');
  });
  $('details-fermer').addEventListener('click', () => dlg.close());
  return { fermer: () => dlg.close() };
}
