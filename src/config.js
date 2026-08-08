// Source de vérité des paramètres. Un seul objet, commenté valeur par valeur.
// Le panneau de réglages écrit directement dedans — aucun état dupliqué.
//
// Script classique exposant un global : Scopus s'ouvre en file://, où les
// modules ES sont refusés (origine « null »).

const CONFIG = {

  // ── Sources IGN ───────────────────────────────────────────────────────────
  ign: {
    // Couche WFS de la grille de dalles LiDAR HD. C'est exactement la grille
    // affichée par cartes.gouv.fr : chaque entité porte l'URL de son .copc.laz.
    wfs: 'https://data.geopf.fr/wfs/ows',
    coucheDalles: 'IGNF_NUAGES-DE-POINTS-LIDAR-HD:dalle',
    // Emprises des chantiers d'acquisition : la couche « de loin », celle qui
    // montre la couverture LiDAR sur toute la France.
    coucheBlocs: 'IGNF_NUAGES-DE-POINTS-LIDAR-HD:bloc',
    geocodage: 'https://data.geopf.fr/geocodage/search',
    // Bâti de la BD TOPO, utilisé pour écarter les détections déjà cartographiées.
    coucheBati: 'BDTOPO_V3:batiment',
    // Fonds WMTS. Le format n'est pas interchangeable : le plan est en png,
    // l'ortho en jpeg, et l'autre combinaison renvoie une erreur XML.
    wmts: 'https://data.geopf.fr/wmts',
    fonds: {
      plan: { couche: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', format: 'image/png' },
      ortho: { couche: 'ORTHOIMAGERY.ORTHOPHOTOS', format: 'image/jpeg' },
    },
  },

  // ── Réseau ────────────────────────────────────────────────────────────────
  reseau: {
    // La passerelle IGN annonce `x-ratelimit-limit-second: 1`. Le plafond mord
    // vraiment : une rafale de 24 requêtes à 4 en parallèle s'est fait refuser
    // en totalité (429) lors d'un essai en ligne de commande. Le navigateur
    // passe mieux — connexions HTTP/2 multiplexées — mais reste borderline.
    //
    // D'où 3 requêtes en vol seulement, et une marge de réessais confortable :
    // le facteur limitant du chargement est la décompression, pas le débit,
    // donc rien n'est perdu à rester poli.
    requetesParallèles: 3,
    tentatives: 6,
    reculInitialMs: 700,
  },

  // ── Chargement du nuage ───────────────────────────────────────────────────
  nuage: {
    // Repères servant à choisir le niveau proposé par défaut. Ce ne sont plus
    // des limites dures : depuis que les blocs sont rastérisés puis jetés, la
    // mémoire ne dépend plus du nombre de points, et seul le temps de
    // téléchargement reste en jeu.
    budgetPoints: 30_000_000,
    budgetOctets: 200 * 1024 * 1024,
  },

  // ── Carte ─────────────────────────────────────────────────────────────────
  carte: {
    // Vue d'ouverture : Ariège, parce que c'est le terrain de départ. Rien
    // d'autre n'est régional — l'outil fonctionne partout où l'IGN a volé.
    vueInitiale: { lat: 42.87, lon: 1.42, zoom: 12 },
    // Zoom à partir duquel la grille kilométrique est tracée. En dessous, les
    // carrés seraient plus petits que le trait qui les dessine ; on n'affiche
    // alors que les emprises de chantier.
    zoomGrille: 11,
    // Plafond de lignes tracées. Garde-fou : à un zoom trop large la grille
    // deviendrait un aplat illisible et coûteux.
    maxLignesGrille: 420,
  },

  // ── Rendu ─────────────────────────────────────────────────────────────────
  rendu: {
    taillePoint: 2.0,       // taille de base en pixels, à distance de référence
    attenuation: true,      // taille décroissante avec la distance
    pointsRonds: false,     // découpe en disque : plus propre de près, plus coûteux
    // Plafond de points téléversés au GPU. La détection, elle, travaille à
    // pleine résolution : ce budget ne concerne que l'aperçu 3D. 6 M points
    // ≈ 114 Mo de VRAM, ce qui passe partout ; la dalle entière à 21 cm en
    // demanderait 708.
    budgetAffichage: 6_000_000,
    fond: '#0b0e13',
    // Colorisation : 'elevation' | 'classification' | 'intensite' | 'hauteur'
    coloration: 'classification',
    exagerationZ: 1.0,
    // Palette des classifications LiDAR HD (norme ASPRS + usage IGN).
    couleursClasse: {
      1: '#e8c15a',   // non classé  — c'est le signal recherché
      2: '#8a7a64',   // sol
      3: '#4f7a3a',   // végétation basse
      4: '#5f9a45',   // végétation moyenne
      5: '#76b955',   // végétation haute
      6: '#d8564f',   // bâtiment
      9: '#3d7fb5',   // eau
      17: '#b06fd0',  // pont
      64: '#c0c0c0',  // sursol pérenne
      66: '#404852',  // point virtuel
      67: '#606870',  // divers (bruit)
    },
    couleurClasseDefaut: '#9aa4b2',
  },

  // ── Rastérisation ─────────────────────────────────────────────────────────
  raster: {
    // Pas de la grille en mètres. 25 cm : en dessous, la densité LiDAR HD
    // (≈10 pts/m²) laisse trop de cellules vides pour que les statistiques par
    // cellule aient un sens.
    pasM: 0.25,
    // Rayon (en cellules) du bouchage de trous du MNT sol. Une ruine crée un
    // trou dans la classe sol : il faut le combler pour disposer d'une
    // référence d'altitude *sous* la structure.
    rayonComblementSol: 12,
    // Demi-fenêtre du lissage appliqué au MNT sol avant calcul de pente.
    rayonLissageSol: 2,
    // Plafond du nombre de cellules. Au-delà, le pas est relevé automatiquement.
    //
    // 17 M laisse passer une dalle entière (1 km²) à 25 cm, soit 16 M de
    // cellules — l'usage principal depuis que l'analyse porte sur la dalle
    // complète. À 21 octets par cellule cela fait ~336 Mo de grilles, ce qui
    // tient sur une machine de bureau ; au-delà le pas est relevé et annoncé.
    cellulesMax: 17_000_000,
  },

  // ── Détection ─────────────────────────────────────────────────────────────
  detection: {
    hauteurMin: 0.35,       // m au-dessus du sol — sous ça, c'est du bruit de classification
    hauteurMax: 6.0,        // m — au-delà, c'est un arbre isolé ou une falaise
    surfaceMinM2: 4,
    surfaceMaxM2: 100,
    // Pente moyenne du sol tolérée sur l'emprise, en degrés. Au-delà on est sur
    // un versant raide ou une falaise : le signal « non classé » y est un
    // artefact de rupture, pas du bâti.
    penteMaxDeg: 22,
    // Pente maximale ponctuelle admise dans le voisinage immédiat. Sépare le
    // cas falaise du cas bâti : une falaise a une pente locale extrême même si
    // sa pente moyenne reste modérée.
    penteLocaleMaxDeg: 55,
    // Part minimale de cellules « non classé » dans l'emprise. En dessous, la
    // tache est portée par la végétation et non par le signal recherché.
    partNonClasseMin: 0.35,
    // Rectangularité = surface / surface du rectangle englobant orienté.
    // Filtre de régularité, pas test « rectangle » : un disque y marque π/4 ≈
    // 0.785 et passe volontairement — les orris ariégeois sont souvent ronds.
    // Écarte les taches franchement informes (formes en L ≈ 0.60, éboulis en
    // dessous). Cf. le commentaire de `rectangleMinimal` dans detection.js.
    rectangulariteMin: 0.55,
    // Élongation maximale (longueur/largeur du rectangle englobant). Écarte les
    // structures linéaires : murets, talus, banquettes.
    elongationMax: 4.0,
    // Écart-type maximal de la hauteur dans l'emprise, en mètres. Un mur, même
    // arasé, a une hauteur cohérente ; un bouquet d'arbres non classés, non.
    ecartTypeHauteurMax: 1.6,
    // Ouverture morphologique (érosion + dilatation) avant étiquetage, en
    // cellules. Détache les taches reliées par un filament de bruit.
    rayonOuverture: 1,
    // Fermeture morphologique après ouverture : recolle un mur interrompu.
    rayonFermeture: 2,
    // Ajoute la classe 6 au signal.
    //
    // La spec ne retenait que « non classé ». Mesure faite sur une cabane
    // d'estive isolée du plateau de Beille (1.68416 / 42.74010) : la structure
    // est intégralement classée **6 (bâtiment)** par le classement automatique
    // IGN, et le signal « non classé » seul ne la voit pas du tout. Une ruine
    // effondrée tombe bien en « non classé » comme observé, mais une cabane
    // encore debout tombe en « bâtiment ».
    //
    // Comme une structure classée bâtiment mais absente de la BD TOPO est
    // exactement ce qu'on cherche, et que l'étape de rapprochement écarte
    // ensuite le bâti déjà cartographié, inclure la classe 6 gagne du rappel
    // sans coûter de précision. D'où le défaut à `true` — décochable dans
    // l'interface pour retrouver le comportement de la spec.
    inclureBati: true,
  },

  // ── Sortie ────────────────────────────────────────────────────────────────
  sortie: {
    // Rayon de rapprochement avec le bâti BD TOPO, en mètres. Une détection
    // dont le centre tombe à moins de ça d'un bâtiment connu est marquée
    // « déjà répertoriée ».
    rayonDedupM: 25,
  },
};
