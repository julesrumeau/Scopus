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

  // ── Extraction de lignes (crêtes de murs) ─────────────────────────────────
  //
  // Valeurs de départ, à régler sur `npm run banc` — aucune n'a encore vu de
  // structure réelle.
  lignes: {
    // Échelles de la réponse de crête, en mètres. Un mur de pierre sèche fait
    // 50 cm à 1,5 m de large ; au-delà de 2 m on lit du talus, pas du mur.
    echellesM: [0.5, 1, 1.5],
    // Sensibilité au contraste : `c` de Frangi, en part de la courbure maximale
    // observée. Une constante en dur ne transférerait pas d'un terrain lisse à
    // un plateau rocheux.
    sensibilite: 0.25,
    // `beta` de Frangi : tolérance à ce qui n'est pas une ligne. Plus il est
    // petit, plus une tache ronde est rejetée.
    beta: 0.5,
    // Voie retenue : `seuil` lit directement l'ouverture, `frangi` passe par la
    // réponse de crête. Comparées au banc.
    mode: 'seuil',
    // Profondeur minimale du creux d'ouverture, en degrés sous 90°. L'ouverture
    // valant exactement 90° sur tout plan, ce seuil est **absolu** : il ne se
    // recale pas d'une dalle à l'autre. Mesuré au banc — la couronne d'un orri
    // de 60 cm plonge à 63°, un versant nu ne bouge pas d'un degré.
    creuxMinDeg: 16,
    // Hystérésis. `partHaute` se lit en part des cellules **qui répondent**, et
    // jamais en valeur absolue : la réponse de Frangi n'a pas d'unité. Le seuil
    // bas s'en déduit par un rapport, comme chez Canny — deux quantiles
    // indépendants peuvent dégénérer chacun de leur côté.
    partHaute: 0.15,
    ratioBas: 0.4,
    // Une cabane fait 6 à 30 m² au sol ; sa couronne en occupe une fraction.
    surfaceMinM2: 4,
    rayonMinM: 1.2,
    rayonMaxM: 12,
    // Part du tour occupée pour qu'une ligne compte comme fermée. À 0,6, un
    // anneau amputé d'un tiers reste un candidat — un mur ruiné a une entrée.
    couvertureMin: 0.6,
    // Enfermement minimal de l'intérieur, en degrés sous 90° d'ouverture
    // positive. C'est ce qui sépare une cabane d'une plateforme, dont le rebord
    // forme pourtant un anneau parfait : mesuré 16° pour un orri, 0,01° pour une
    // plateforme. Seuil absolu, là encore, l'ouverture valant 90° sur tout plan.
    //
    // Réglé à 12 sur les valeurs mesurées : les huit structures du banc
    // s'enferment de 18 à 26°, le rebord de plateforme de 9,9°. La marge du
    // côté du faux positif ne fait que 2° — c'est le point le plus fragile de
    // la chaîne, et le premier à surveiller sur une dalle réelle.
    interieurMinDeg: 12,
    // Hauteur minimale du mur au-dessus de son propre intérieur. Un mur ruiné
    // de moins de 25 cm ne se distingue plus du bruit d'échantillonnage ; et ce
    // seuil est ce qui écarte le dôme fabriqué par le comblement du MNT, qui
    // descend au lieu de monter.
    hauteurMurMinM: 0.25,
    // L'amincissement de Zhang-Suen dégrade la couverture et la position du
    // centre sans rien apporter au tri — mesuré. Il reste là pour la branche des
    // lignes ouvertes, où la vectorisation exige un squelette.
    amincir: false,
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
    // Délai maximal par tentative. `fetch` n'en a pas : sans lui, une requête
    // que la passerelle laisse pendre immobilise une place en vol pour toujours
    // et le chargement s'arrête en silence. 30 s laissent passer un bloc de
    // 8 Mo sur une connexion lente, tout en coupant court à ce qui pend.
    delaiMaxMs: 30000,
  },

  // ── Chargement du nuage ───────────────────────────────────────────────────
  nuage: {
    // Repères servant à choisir le niveau proposé par défaut. Ce ne sont plus
    // des limites dures : depuis que les blocs sont rastérisés puis jetés, la
    // mémoire ne dépend plus du nombre de points, et seul le temps de
    // téléchargement reste en jeu.
    budgetPoints: 30_000_000,
    budgetOctets: 200 * 1024 * 1024,
    // Budget proposé par défaut sur un appareil portatif. Un navigateur mobile
    // accorde bien moins de mémoire à un onglet, et ferme celui-ci sans
    // prévenir : mieux vaut proposer un niveau qui aboutit. Le curseur reste
    // libre d'aller plus loin, avec un avertissement.
    budgetOctetsMobile: 40 * 1024 * 1024,
  },

  // ── Carte ─────────────────────────────────────────────────────────────────
  carte: {
    // Vue d'ouverture : **la France entière**, avec ses chantiers LiDAR.
    //
    // Elle s'ouvrait sur l'Ariège, terrain de départ du projet — et c'était la
    // seule chose régionale de tout le dépôt. Un visiteur de Bretagne ou du
    // Massif central en concluait que ce n'était pas pour lui, alors que sa zone
    // est couverte. La carte de France répond du même coup à sa première
    // question, « est-ce que ça couvre chez moi ? », sans qu'il ait à chercher.
    //
    // Une **emprise** et non un centre plus un zoom : le même zoom 5 remplit un
    // écran de portable et laisse la France minuscule sur un grand écran.
    // `fitBounds` s'adapte, un nombre en dur non.
    empriseInitiale: { sud: 41.2, ouest: -5.6, nord: 51.2, est: 9.8 },
    // Repli quand le conteneur n'a pas encore de taille : `fitBounds` calculerait
    // alors n'importe quoi.
    vueDeRepli: { lat: 46.6, lon: 2.4, zoom: 5 },
    // Zoom à partir duquel la grille kilométrique est tracée. En dessous, les
    // carrés seraient plus petits que le trait qui les dessine ; on n'affiche
    // alors que les emprises de chantier.
    zoomGrille: 11,
    // Plafond de lignes tracées. Garde-fou : à un zoom trop large la grille
    // deviendrait un aplat illisible et coûteux.
    maxLignesGrille: 420,
    // Dernier niveau de tuiles réellement servi par la Géoplateforme.
    //
    // Mesuré, et non supposé : sur les deux fonds et en trois lieux — Ariège,
    // Paris, Vanoise — le niveau 19 répond 200, les niveaux 20 et 21 répondent
    // **404**, le 22 un 400 (la matrice n'existe pas). Ce n'est donc pas une
    // limite régionale, contrairement à ce qu'on croyait : c'est le plafond de
    // la couche, partout.
    zoomTuilesMax: 19,
    // Un cran d'agrandissement au-dessus, et pas plus. Leaflet étire alors la
    // dernière tuile disponible au lieu d'en demander d'inexistantes — on peut
    // encore se rapprocher d'un détail, et un avis dit pourquoi c'est flou.
    // Sans cette borne, la carte devenait entièrement grise, sans rien pour
    // dire pourquoi : un écran gris sans message se lit comme une panne.
    zoomMax: 20,
    // Dalle que le bouton « Voir un exemple » de l'accueil sélectionne et
    // charge tout seul. Les deux nombres sont les indices kilométriques
    // Lambert-93 de la dalle — exactement ceux du lien partageable
    // (`#d=877,6904`) : coller ceux d'un lien copié dans l'outil suffit à
    // changer l'exemple, aucun autre fichier à toucher.
    //
    // Bois des Caures, Verdun (Meuse) — champ de bataille de 1916, trous
    // d'obus et tranchées intacts sous la forêt depuis plus d'un siècle.
    // Une étude LiDAR académique existe spécifiquement sur cette zone :
    // 600 000 « polémoformes » et 400 km de tranchées recensés sur la
    // forêt domaniale de Verdun (De Matos-Machado et al.).
    dalleExemple: { x: 877, y: 6904 },
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

  // ── Visualisations de relief ──────────────────────────────────────────────
  relief: {
    // Pas de la grille d'affichage. À 25 cm une cellule ne reçoit que 0,6 point
    // et le MNT y est surtout du bruit d'échantillonnage ; à 50 cm elle en
    // reçoit deux ou trois, et un mur de 50 cm occupe toujours une cellule
    // pleine. Le calcul est en prime seize fois plus léger, ce qui décide de la
    // faisabilité du Sky-View Factor.
    pasM: 0.5,
    // Rayon du lissage qui définit le « relief général » à soustraire. Doit
    // dépasser nettement la taille des objets cherchés, sans quoi une cabane
    // serait absorbée dans sa propre référence.
    rayonMicroReliefM: 12,
    // Sky-View Factor : nombre de directions balayées et portée de l'horizon.
    // Le coût est le produit des deux — 8 directions sur 10 m suffisent à lire
    // un chemin creux, 16 affinent les formes rondes pour le double du temps.
    svfDirections: 8,
    svfRayonM: 10,
    // Plafond de la palette de hauteur. Au-delà de 3 m on ne cherche plus une
    // ruine mais un arbre isolé, et l'étaler écraserait tout le reste.
    hauteurMaxM: 3,
    // Inclure la classe « bâtiment » dans la hauteur affichée, comme dans le
    // signal de détection.
    inclureBati: true,
    // Compléter la surface affichée par les retours **non classés** là où il
    // n'y a aucun retour sol.
    //
    // Une ruine ne laisse pas passer le laser : elle creuse un trou dans la
    // classe sol, que le comblement referme par une surface lisse. Elle
    // s'efface donc de l'ombrage, du micro-relief et du Sky-View Factor —
    // c'est-à-dire des couches où on la cherche. Les points non classés sont
    // ceux de la ruine ; les mettre à la place d'une valeur interpolée rend une
    // mesure là où il n'y avait qu'une invention.
    inclureSursol: true,
    // Plafond de cette substitution, en mètres au-dessus du sol comblé.
    //
    // La classe 1 recueille tout ce que le classificateur n'a pas su ranger,
    // végétation comprise. Sans plafond, un retour de branche à vingt mètres
    // deviendrait un pic de terrain. Une ruine, un muret, une charbonnière
    // tiennent tous sous trois mètres.
    hauteurSursolMaxM: 3,
    // Resserrement de l'intervalle affiché. Au-dessus de 1 le contraste monte,
    // en dessous il s'adoucit. Rejoué à l'affichage seul : changer ce réglage
    // ne recalcule jamais la couche.
    contraste: 1,
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
    // Compacité maximale : longueur parcourue divisée par l'envergure — la
    // distance à vol d'oiseau entre les deux bouts du tracé simplifié, pas la
    // diagonale de sa boîte englobante (essayé d'abord : une boucle occupe une
    // vraie surface, la boîte ne la distinguait donc pas d'un sentier sinueux —
    // 2,2 à 2,9 contre 1,2, à peine séparés). `vectoriser` produit des boucles
    // quand le squelette contient un cycle, sans extrémité franche à privilégier
    // (voir son commentaire) ; un vrai chemin, lui, ne revient pas près de son
    // point de départ à cette échelle. Mesuré : le sentier sinueux du test
    // synthétique (ondulation de ±8 m tous les 60 m) vaut 1,20 à 1,24 avec
    // cette définition. Sur la dalle de Beille, ce filtre écarte 107 tracés
    // (133 retenus avant ce filtre → 110 après) — les deux amas de tracés
    // enchevêtrés visibles sur le canevas 2D disparaissent.
    compaciteMax: 3.0,
  },

  // ── Sortie ────────────────────────────────────────────────────────────────
  sortie: {
    // Rayon de rapprochement avec le bâti BD TOPO, en mètres. Une détection
    // dont le centre tombe à moins de ça d'un bâtiment connu est marquée
    // « déjà répertoriée ».
    rayonDedupM: 25,
  },
};
