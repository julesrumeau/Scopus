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

  // ── Détection de sentiers ─────────────────────────────────────────────────
  //
  // Chaîne distincte de celle des ruines : on cherche des lignes, pas des
  // taches, et sur le relief seul — jamais sur les classifications.
  sentiers: {
    // Pas de la grille de travail. Un sentier fait 0,6 à 4 m de large : à 25 cm
    // on paierait seize fois le calcul pour du bruit en plus.
    pasM: 0.5,
    // Rayon du lissage qui définit le « relief général » à soustraire. Doit
    // dépasser nettement la largeur d'un sentier, sans quoi le creux cherché
    // serait absorbé dans sa propre référence.
    rayonReliefM: 12,
    // Largeurs de structures recherchées, en mètres. Le balayage multi-échelle
    // attrape aussi bien une sente étroite qu'un chemin creux de charroi.
    //
    // L'échelle 0,5 m a été retirée : sur données réelles elle ne remonte que
    // le grain du MNT, sans jamais rien ajouter d'exploitable.
    echellesM: [1, 2, 4],
    // Seuil de la réponse hessienne, exprimé **en multiples de la rugosité
    // locale** — donc sans dimension, et de même sens sur une prairie que sur
    // un pierrier. Plus bas = plus sensible.
    //
    // Le besoin d'une échelle locale vient d'une mesure : sur le plateau de
    // Beille, le relief local médian atteint 79 cm sur 12 m de rayon, contre
    // 2 cm sur terrain synthétique lisse. Aucune constante ne pouvait servir
    // les deux — celle calibrée sur le lisse faisait déborder la moitié de la
    // dalle réelle.
    //
    // Abaissé à 0,35 : à 1,0 on exigeait un creux aussi marqué que la rugosité
    // du versant, ce qu'un sentier de 20 cm n'est jamais. On accepte donc
    // beaucoup de candidats faibles, et c'est la **forme** qui fait le tri —
    // tortuosité, longueur après recollement, traversée de la pente.
    sensibilite: 0.35,
    // Rayon sur lequel s'estime cette rugosité, et son plancher — le bruit
    // propre du MNT, en dessous duquel diviser n'aurait plus de sens.
    rayonRugositeM: 15,
    rugositePlancherM: 0.03,
    // Part minimale de cellules fines ayant réellement vu le sol. Sous couvert
    // dense, le MNT est interpolé sur de longues distances et ne décrit plus
    // rien d'exploitable.
    partSolMin: 0.25,
    // Part du voisinage de lissage dont le sol doit être connu. En dessous, la
    // référence locale repose sur trop peu de cellules pour valoir quoi que ce
    // soit.
    voisinageSolMin: 0.35,
    // Sensibilité au caractère allongé (β de Frangi). Plus bas = plus exigeant
    // sur la linéarité.
    beta: 0.5,
    // Hystérésis : germer sur `seuilHaut`, prolonger jusqu'à `seuilBas`. Un
    // sentier s'efface par endroits ; un seuil unique le hacherait.
    seuilHaut: 0.30,
    seuilBas: 0.12,
    longueurMinM: 30,
    // Profondeur du creux — **la borne haute compte plus que la basse**.
    //
    // Un sentier creuse peu : 50 cm au grand maximum, souvent 20, parfois 10.
    // Le plafond de 3 m qui figurait ici laissait entrer les ravines, et c'est
    // exactement ce qu'il remontait — les tracés trouvés sur le plateau de
    // Beille faisaient 70 à 250 cm de creux.
    profondeurMinM: 0.06,
    profondeurMaxM: 0.60,
    // Sommets conservés par la simplification, pour 100 m de tracé.
    //
    // C'est le critère de forme, et il a remplacé l'amplitude comme filtre
    // principal : un creux de 20 cm est sous la rugosité naturelle d'un
    // versant, donc indétectable par sa seule force. Un sentier est faible
    // mais **organisé** — il serpente en courbes amples et se résume à peu de
    // sommets ; le bruit change de cap à chaque pas et en garde beaucoup.
    //
    // On ne pénalise pas la courbure : un sentier de montagne n'est jamais
    // droit, il épouse le relief et lace. C'est l'irrégularité qu'on écarte.
    tortuositeMax: 14,
    // Recollement des tronçons. L'amincissement coupe à chaque croisement et un
    // sentier s'efface par endroits ; sans cette étape un chemin de 300 m
    // ressort en douze bouts de 25 m. La tolérance angulaire est large, sans
    // quoi on ne recollerait que les lignes droites.
    recollementM: 12,
    angleRecollementDeg: 70,
    // Passes de recollement. Chacune ne raboute qu'un tronçon à chaque bout,
    // d'où plusieurs tours pour reconstituer un long chemin ; les fusions se
    // faisant en parallèle, la convergence est rapide.
    passesRecollement: 6,
    // Part maximale de la dalle que le masque peut couvrir avant qu'on renonce.
    // Au-delà, la squelettisation coûte des minutes et ne produit que le graphe
    // du bruit : autant s'arrêter et demander de remonter la sensibilité.
    masqueMaxPart: 0.45,
    // Pente médiane le long du tracé. Un sentier reste praticable ; au-delà
    // c'est une ligne d'écoulement.
    penteLongueMaxDeg: 28,
    // **Le critère décisif.** Cosinus entre la direction du tracé et le gradient
    // du terrain. Une ravine suit la ligne de plus grande pente (≈ 1) ; un
    // sentier la traverse pour rester praticable (≈ 0). Sans lui, tout ravin et
    // tout fossé de drainage ressortent — même signature creuse et linéaire.
    alignementMax: 0.80,
    // Tolérance de simplification des polylignes, en mètres.
    toleranceM: 1.0,
  },

  // ── Sortie ────────────────────────────────────────────────────────────────
  sortie: {
    // Rayon de rapprochement avec le bâti BD TOPO, en mètres. Une détection
    // dont le centre tombe à moins de ça d'un bâtiment connu est marquée
    // « déjà répertoriée ».
    rayonDedupM: 25,
  },
};
