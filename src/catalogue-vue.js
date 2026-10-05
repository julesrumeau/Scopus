// Ce qu'un côté du rideau peut porter : une couche de relief (calculée par le worker, `RELIEF.COUCHES` plus
// l'ombrage coloré) ou un fond de carte (la photo de la carte Leaflet, le plan IGN, les estompages IGN,
// OpenStreetMap). Des définitions, sans état : le panneau et le calcul les lisent.

function creerCatalogueVue({ RELIEF, FONDS_OSM, protocole }) {
  // L'ombrage coloré ne suit pas le contrat de `RELIEF.calculer` (palette + étalement) : il rend directement
  // des couleurs.
  const OMBRAGE_RGB = 'ombrage-rgb';
  const couches = [
    ...RELIEF.COUCHES.map((c) => ({ cle: c.cle, libelle: c.libelle, aide: c.aide })),
    { cle: OMBRAGE_RGB, libelle: 'Ombrage coloré (3 soleils)', aide: 'Trois soleils à 120°, un par canal — l’orientation d’un mur ou d’un talus se lit en teinte, là où « Ombrage » l’aplatit dans une moyenne grise.' },
  ];
  // Ce qui n'est pas du relief : la carte telle qu'affichée, et les fonds posés dans le côté même — la carte
  // n'a qu'un fond à la fois, et ainsi un côté peut montrer la photo et l'autre le plan.
  const fonds = {
    carte: 'Photo aérienne', plan: 'Plan IGN',
    'mnt-ign': 'MNT ombré (IGN)', 'mns-ign': 'MNS ombré (IGN)',
    [FONDS_OSM.standard.cle]: FONDS_OSM.standard.libelle,
  };
  // Les fonds de tuiles posés dans le volet de leur côté, avec leurs réglages propres : l'estompage de l'IGN
  // n'est servi que jusqu'au niveau 18, au-delà la tuile est agrandie.
  const tuiles = { plan: {}, 'mnt-ign': { maxNativeZoom: 18 }, 'mns-ign': { maxNativeZoom: 18 }, [FONDS_OSM.standard.cle]: {} };
  const aides = {
    [FONDS_OSM.standard.cle]: FONDS_OSM.standard.aide(protocole),
    'mnt-ign': 'Estompage du MNT LiDAR HD (le sol nu), calculé par l’IGN : éclairage fixe, pas de réglage du soleil. Servi jusqu’au zoom 18.',
    'mns-ign': 'Estompage du MNS LiDAR HD (le dessus : cimes, toits), calculé par l’IGN : éclairage fixe, pas de réglage du soleil. Servi jusqu’au zoom 18.',
  };
  const estRelief = (cle) => !(cle in fonds);
  const libelleCouche = (cle) => fonds[cle] || couches.find((c) => c.cle === cle).libelle;
  return { OMBRAGE_RGB, couches, fonds, tuiles, aides, estRelief, libelleCouche };
}
