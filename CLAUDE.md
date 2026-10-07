# CLAUDE.md — Scopus

Référence architecturale, pour tout développeur (ou IA) intervenant sur le projet.
Ne garde que ce qui n'est pas lisible dans le code : décisions, pièges, mesures
qui les justifient. Le reste à faire est dans `TODO.md`.

---

## Présentation

Outil web personnel d'exploration du LiDAR HD de l'IGN, utilisable partout en
France (métropole + DROM). Il calcule et affiche le relief caché sous la
végétation — ombrage, micro-relief, Sky-View Factor, ouverture — et le compare à
la photo aérienne : cabanes, ruines, sentiers, terrasses s'y lisent à l'œil.

Aucune détection automatique : l'œil lit le relief (voir « Détection retirée »).

**Convention d'écriture** : **pas de tiret cadratin** (le long tiret) dans ce qui est écrit pour la personne : texte de
l'interface, messages d'erreur, aide, README, messages de commit, réponses. Le remplacer par deux-points, virgule,
point ou parenthèses. Une valeur inconnue s'écrit « n/d » (jamais un tiret seul). Un test garde `index.html` ; les chaînes des scripts
suivent la règle par relecture. Les anciens commentaires de code en contiennent encore : on ne les réécrit pas en bloc.

---

## Contraintes structurantes

1. **Ouverture par double-clic (`file://`), sans serveur ni commande.** La plus
   structurante.
2. **Rien côté serveur.** Aucun backend, base ni compte ; le dépôt *est* le site
   (GitHub Pages). Seule entorse : un compteur GoatCounter (sans cookie), dit
   dans la ligne de crédit. Aucune donnée LiDAR ni résultat ne quitte l'onglet.
3. **Aucune étape de construction.** Un `git push` déploie. Seule exception :
   `vendor/lazperf/lazperf-embarque.js`, généré par `tools/embarquer-lazperf.js`.
4. **Le volume de données est le problème central** (dalle ≈ 190 Mo, 30 M de
   points) : toute l'architecture de chargement en découle.

## Vivre en `file://`

Origine « null ». Mesuré sur Chrome 151 :

| Capacité | En `file://` | Conséquence |
|---|---|---|
| `fetch` distant vers un service CORS `*` | ✅ | Toutes les données IGN arrivent directement |
| Requête de plage `206` | ✅ | Le lecteur COPC marche tel quel |
| WebGL2, Worker depuis URL **blob**, `<script type="module">` **inline** | ✅ | — |
| `<script type="module" src>` + `import` | ❌ | → scripts classiques exposant des globaux |
| `fetch`/XHR d'un **fichier local** | ❌ | → laz-perf embarqué en chaînes, passé en `wasmBinary` |
| `new Worker("file://…")` | ❌ | → worker monté depuis une URL blob |

**Le réseau n'est pas le problème, seul le disque local est fermé.** Ne pas
convertir en modules ES : ça casse `file://`, raison d'être de l'architecture.
Pas de dépendance CDN.

Les scripts partagent l'environnement lexical global : un `const` de premier
niveau est visible des fichiers suivants mais **n'est pas** une propriété de
`window` (`CONFIG`, pas `window.CONFIG`).

**Pas de backtick dans un commentaire GLSL** : les shaders vivent dans des
template literals, le backtick termine la chaîne et l'erreur
(`Unexpected identifier`, « SHADERS is not defined ») remonte loin de sa cause.

Repris de FlowField : `compile`, `program`, `createTarget`, `perspective`,
`lookAt`, `multiply`, `hexToRgb`, l'objet `CONFIG` unique commenté valeur par
valeur, les scripts classiques chargés dans l'ordre.

---

## Chargement COPC

Les dalles sont des **COPC** (LAZ rangé en octree, table des nœuds dans le
fichier). `data.geopf.fr` donne `access-control-allow-origin: *` et un vrai
`206` : en-tête (64 Ko) → hiérarchie (47 Ko) → seuls les nœuds utiles. L'index
coûte 48 Ko contre 187 Mo. La hiérarchie tient en une page (le code suit quand
même les renvois). Le facteur limitant est **le réseau, pas le CPU** ; la
passerelle annonce 1 req/s mais encaisse des rafales, d'où `reseau.js` (file
bornée, réessais 429/5xx).

- `selectionner()` retient un niveau d'octree **en entier ou pas du tout** : un
  niveau à moitié donnerait une frontière fine/grossière visible.
- Chaque niveau divise l'espacement par deux (dalle entière : 1 = 3,4 m / 7 Mo …
  5 = 21 cm / 185 Mo).
- **Worker** : pour la fluidité, pas la vitesse (gel max 54–64 ms contre
  188–193 ms au repli). Les durées totales ne se comparent pas (variance du
  réseau, cache HTTP). Un préchauffage du worker a été écrit puis retiré : le
  démarrage coûte 22 ms.
- Les workers ne font que décompresser ; le fil principal garde les requêtes.
  Coordonnées ramenées à une origine locale **avant** le Float32 (Y Lambert-93
  ≈ 6,2 M, résolu à ~0,5 m seulement).
- `grouperPlages` fusionne les nœuds contigus (1554 requêtes → 24) ; redécoupage
  à 8 Mo pour garder une progression.
- **Rastériser au vol, ne rien garder** : chaque bloc est
  versé dans les grilles (`RASTER.accumuler`) puis abandonné. Grilles dégraissées
  (21 octets/cellule). **Ne pas réintroduire un tableau par cellule sans
  compter** : à 16 M de cellules, un `Float32Array` = 64 Mo.
- **Octets compressés retenus** (`cacheOctets` dans `nuage.js`, une dalle à la
  fois, vidé par `fermerNuage()`) : le cache HTTP ne resservait pas les `206`.
  Un second `charger()` repart de la décompression locale (6,3× plus rapide,
  100 % des octets resservis).

## Le chargement piloté par la vue (`flux.js`)

`&debug` ajoute un calque des blocs (`flux-calque.js`). Conception :
`docs/superpowers/specs/2026-09-26-flux-vue-design.md`.

- **Une requête par dalle : la fin du fichier.** L'IGN range ses COPC
  `[en-tête][niveau 5 … 1][niveau 0][index][~830 o]`. `Range: bytes=-1000000`
  ramène l'index **et** le niveau 0 (relecture à 4 Mo en secours ; sinon
  `COPC.lireFin` cherche l'EVLR `copc`). La longueur d'un point varie **par lot
  de publication** (30 ou 46 octets) : 256 octets d'en-tête une fois par lot,
  demandé **dès la première ouverture**.
- **La taille du fichier est invisible en navigateur** (pas de
  `Access-Control-Expose-Headers` : `total: null` sur un `206`). L'ancre : juste
  après le dernier bloc, la table des blocs commence par 4 octets nuls puis le
  nombre de blocs (= nombre de nœuds de l'index). Un test simulé qui fournit la
  taille ne voit pas le problème : vérifier sur données réelles.
- **Quota** : 10 req/s par IP. Au-delà de 60 km² de surface affichée
  (`CONFIG.flux.surfaceMaxPointsKm2`), rien n'est demandé. La surface, pas le zoom
  ni la largeur, fixe le nombre de dalles.
- **Quels blocs** : pas = pixel au sol (jamais sous `pasMinM`) ; niveau visé = le
  plus grossier dont la densité atteint `pointsParCase`. Ordre : niveau
  croissant puis distance au centre ; liste tronquée au budget de points.
  **`pomper` ne sert que le niveau en cours** (un niveau entier avant le suivant).
- **File de priorité** unique, recalculée à chaque vue, `plagesEnVol` = 5
  plages d'au plus `plageMaxOctets` (2 Mo). Le débit ligne plafonne vers
  3,4 Mo/s ; le quota ne mord que sous ~500 Ko.
- **Seules les couches lues** : le relief ne lit que les 4 premières couches
  LAZ 1.4 (XY, Z, classe, drapeaux ≈ 60 % du bloc). Un bloc ≥ `coupeMinOctets`
  est demandé tronqué (`fractionCoupe` 68 %, reste redemandé si besoin via
  `COPC.tailleUtileBloc`) puis **réduit** (`COPC.reduireBloc`). Un bloc se décode
  **dès que ses octets sont là**.
- **Centimètres entiers** : les workers rendent `xc/yc/zc` relatifs au coin de
  la dalle (échelle 0,01, décalage 0 chez l'IGN) : l'affectation d'un point à
  une case ne dépend plus d'un arrondi de flottant.
- **Emprise d'un bloc sans l'en-tête** : le cube d'octree coïncide avec la dalle
  (demi-côté 500 m, centré). Si une dalle y dérogeait, les blocs seraient mal
  placés sans erreur : contrôle à refaire au moindre doute.
- **Cache disque** (`cache-disque.js`, IndexedDB) : octets compressés des blocs
  et fins de fichier, sous `quotaDisqueOctets`, LRU. Ne fait jamais échouer un
  chargement.

## Le calcul de la vue (`vue-relief.js`)

Grille de la vue → rangement des points → terrain → surface → couche par
`RELIEF.calculer`, posée derrière un rideau (`CalqueRelief`).

- **Grille en centimètres entiers** (`VUE_GRILLE`) : coin multiple du pas, case
  = division entière, identique processeur (`RASTER.accumulerCm`) et carte
  graphique. Pas = pixel au sol (≥ 50 cm), marge = plus grande portée des
  couches ; comblement et lissage réglés **en mètres**.
- **Deux chemins, une référence** : `VUE_RELIEF.surfaceCPU` et
  `GPU_RELIEF.surfaceVue`, avec **autocontrôle** (`controleGPU`) avant tout
  usage. La carte graphique n'est **pas** plus rapide pour ranger les points
  (coût dans les passes à test de profondeur, dépend de l'ordre des points).
- **Le calcul tourne dans un worker, au processeur** (`relief-travailleur.js`) :
  **un calcul sur la carte graphique n'est jamais « en arrière-plan »**, même
  depuis un worker (la page gelait 0,5–1 s). `&gpu` tout carte, `&cpu` tout
  processeur, `&gpusvf` essai. Défaut : surface au processeur, couches (SVF,
  ouvertures, ombrages) sur la carte.
- **En `file://`, le source du worker est composé du texte des fonctions** :
  modules écrits en `function fabriqueX()` puis `const X = fabriqueX()`
  (`vue-grille.js`, `relief.js`, `gpu-relief.js`, `vue-relief.js`), `raster.js`
  repris fonction par fonction. Une fonction ajoutée à `raster.js` sans être
  listée dans `relief-travailleur.js` n'échoue que dans le worker :
  `test/relief-travailleur.test.js` compare les listes.
- Un seul calcul à la fois (une demande pendant un calcul est retenue et
  relancée avec la vue du moment). Les points sont cédés au worker.
- **L'image arrive du worker déjà reprojetée** (Web Mercator) via `VUE_IMAGE`
  (nœud de maillage tous les 32 px, < 1/10 de case d'écart), encodée en PNG par
  `OffscreenCanvas`, posée sur les bornes de la carte **au moment de la demande**.
- **Chaque bloc n'est rangé qu'une fois** : grille gardée dans le worker, bloc
  arrivé rangé seul, déplacement = recopie de la partie commune + bande
  entrante. Tout est refait si pas/taille/réglages changent ou si un bloc rangé
  est retiré (un minimum ne se défait pas). **La taille d'une grille ne dépend
  que de celle de la vue**, jamais de sa position. Seules les classes du sol
  obligent à tout ranger de nouveau.
- La couche est gardée tant que la surface ne change pas (le contraste ne
  réétire que l'intervalle).
- **Ombrage coloré** : `RELIEF.ombrageRGB`, reprojeté par `VUE_IMAGE.peindreRGBA`,
  sans palette ni contraste.
- **Deux côtés** : chaque côté du rideau = « Photo aérienne » (la
  carte Leaflet), « Plan IGN » (couche de tuiles dans le volet du côté) ou une
  couche de relief ; défaut carte à gauche, SVF à droite. Le worker garde
  plusieurs couches par surface : un aller-retour ne refait rien.
- **Outils sur la carte** (modes, point sélectionné, mesure en
  chaîne) : le point se **lit** dans la dernière vue calculée (`relief.lire`),
  jamais recalculé. Marqueurs et traits en **SVG** dans un volet à part. La case
  « Compléter le sol par les non classés » est masquée (TODO #3).
- **Sous le relief, la carte voilée ; rien que du COPC.** Pixels sans valeur
  transparents (`VUE_IMAGE.peindre`) ; au-delà du seuil de surface, la dernière
  image reste et le rideau dit « Zoomez pour calculer le relief ». L'ombrage
  tout fait de l'IGN et le MNT WMS (`mnt-ign.js`, commit `90c7321`) ont été
  écartés : on ne saurait plus d'où vient ce qu'on voit.

## La 3D de la vue

Nuage de ce que la carte affichait, sans rien télécharger de plus
(`VUE_RELIEF.nuage3d`). Conception : `docs/superpowers/specs/2026-09-27-vue-3d-design.md`.

- Points des blocs que `flux.voulues()` demande, dans l'emprise (bord gauche et
  bas inclus, droit et haut exclus).
- **Plafond** 5 M (2 M mobile) ; sous-échantillonnage par **hachage des
  centimètres** : mêmes points à chaque aller-retour, densité régulière.
- Figé en 3D (même carte = même nuage ; sinon l'ancien est libéré avant le
  nouveau). Le relief de la carte est **en pause** pendant qu'on est en 3D.
- Couleurs : hauteur au-dessus du sol (lue dans la dernière surface) ; relief
  drapé calculé par le worker (`drape3d`), même étirement que le même côté du
  rideau. Pas d'intensité.
- **EDL** par défaut (`CONFIG.rendu.edl`, force 1, rayon 1,4 px, comme Potree) :
  profondeur réécrite telle quelle, la sélection garde son test de profondeur.
- **Export** (`las.js`, `ply.js`, `#dlg-export`) : LAS 1.4 **format 6** (la
  classe tient sur 5 bits en formats 0–5, or le LiDAR HD emploie 64 et 66),
  tous les points ; PLY binaire little-endian, classes **cochées dans la
  fenêtre** seulement (FreeCAD ignore la classe, d'où l'export par sélection ;
  non essayé dans FreeCAD). Coordonnées **locales** (Blender perdrait ~50 cm en
  absolu). Logique dans `SORTIE.resumerExport` / `exporterPoints`.
- **Le rectangle de la 3D** (5 octobre 2026, `rectangle-3d.js` pur et testé, `pose-3d.js`) : la 3D est une
  **fenêtre sur la zone de la carte**. Le rectangle au sol est celui que la carte montrerait à ce zoom sur la
  taille de la scène (`RECTANGLE_3D.depuisCentre`, calculé et non lu sur la carte : Leaflet arrondit le zoom,
  un lien en a deux décimales). La caméra y est posée **à l'échelle de la carte** (`distance = mpp × hauteur /
  (2 tan(fov/2))`) et **n'en sort pas** : cible bornée au rectangle, distance bornée à 1,3 fois ce qui le
  montre entier (`Pose3D.borner`, appelée par `_bouger`). Un lien porte `onglet=3d` (`&onglet=3d` après
  `map=zoom/lat/lon/orientation/inclinaison`) : il **ouvre la 3D**, à la zone et aux angles du lien
  (`nuage3D.ouvrirDepuisLien`) — la règle « jamais l'onglet » est levée ; la bascule manuelle reprend la même
  zone et la même échelle (angles par défaut). Le nuage **s'étoffe tout seul** tant que des blocs arrivent :
  reconstruit en silence (ni voile, ni retour de la caméra : `definirNuage(…, { cadrer: false })`) au plus une
  fois par `CONFIG.rendu.affinage3dMs` (4 s), la carte restant en pause. Une seule densité : celle que la
  carte aurait chargée à ce zoom ; **la 3D ne télécharge pas plus fin en zoomant** (décision : trop lourd).
- Non fait : une caméra 3D qui pilote le niveau de détail du téléchargement (TODO #4, phase 2, écartée).

## Le profil

Demande OSM (forum OSM-FR, « Hauteur depuis LidarHD IGN ») : la coupe
verticale des points d'une bande tracée sur la carte, pour mesurer la hauteur
d'arbres et de bâtiments sans QGIS. Conception :
`docs/superpowers/specs/2026-10-01-profil-design.md`.

- **Deux temps, jamais affichés ensemble.** Le mode Profil (icône à côté de la
  règle) pose deux points A et B sur la carte, déplaçables, avec une petite
  fenêtre flottante (largeur, Effacer, Valider) ; « Valider » ouvre la modale
  `#dlg-profil`. Aucun calcul avant la validation.
- **Les points viennent du worker** (`VUE_RELIEF.profil`, message `profil`) :
  balayage linéaire des blocs gardés, comparaisons **en centimètres entiers**
  (un point pile sur le bord de la bande est gardé), tirage par hachage de
  `nuage3d` au-delà de `CONFIG.profil.budgetPoints`. L'altitude est vraie
  (`zc / 100` : les blocs du flux portent `origineCm[2] = 0`).
- **La géométrie est pure** (`profil.js`, `fabriqueProfil`) pour se tester à
  froid et se composer dans le worker.
- **Le graphique** (`profil-graphique.js`) est un canevas 2D : classes par
  couleur, sol dessiné en dernier, molette pour zoomer sous le curseur, glisser
  pour déplacer. Un appui qui bouge de moins de 4 px est un clic (ce qu'il fait
  dépend de l'outil, voir plus bas).
- **Trois outils** (une barre dans la modale, comme celle de la carte) :
  Déplacement (un clic ne pose rien), Point de référence, Mesure — **la mesure par
  défaut**. Le glisser et la molette déplacent et zooment avec tous : seul le
  **clic** dépend de l'outil (`ProfilGraphique.definirOutil`). La première
  ouverture part de la mesure ; ensuite l'outil, les classes cochées et les échelles égales se **gardent**.
- **Point de référence** (demandé pour lire des altitudes depuis un sol choisi) :
  un seul à la fois, le clic suivant remplace le précédent ; il s'accroche comme la
  mesure. Il devient le **0, en altitude et en distance** : graduations relatives
  (positives en haut et à droite, négatives en bas et à gauche), croix « 0 » et
  deux axes pointillés ; sans référence, des altitudes absolues, **sans bascule**.
  Pas de colonnes de plus dans le tableau : la demande était « tel point est
  l'altitude 0 », pas d'afficher des cotes. S'efface par « Effacer la référence »
  et par Retour arrière / Suppr (outil actif) ; **elle reste à la fermeture de la modale** (on revient à la carte
  pour situer ses points). Elle s'efface, avec la chaîne de mesure, la tranche et le zoom, quand **A ou B bouge**
  (`nouvelleLigne` : poser un point, glisser une poignée, effacer la bande) ; changer seulement la largeur garde
  la chaîne et la référence (mêmes distances) mais remet la tranche et le zoom (`definir(d, { garder })`).
  La chaîne et la référence sont **dessinées sur la carte** (`dessinerChaine`, SVG du volet des outils, à leur
  distance `s` sur l'axe : `PROFIL.pointSurAxe`). C'est une **constante** : valable sur un sol plat
  ou pour un seul bâtiment, pas un MNT (dit dans l'aide ; le sol comblé est R7).
- **Modifier la chaîne** (`profil-geste.js`, machine à états pure, minuteur injecté, testée à froid) : à la
  **souris** (ou au stylet) un appui à moins de 10 px d'un point de la chaîne le **saisit** tout de suite (il
  grossit au survol, le curseur devient une main) et le glisse en gardant l'accrochage de la pose ; au **doigt**
  il faut un **appui long** (`CONFIG.profil.appuiLongMs`, 400 ms) dans une zone de 24 px, sinon c'est un
  déplacement du graphique (un doigt qui glisse de plus de 8 px avant le délai l'annule). Un doigt posé puis levé
  sur un point **ne pose rien** (pas de doublon). Seul l'outil Mesure saisit les points. La **croix** en bout de
  ligne du tableau (`data-retirer`, `MESURE.tableauHtml`) retire le **point d'arrivée** du segment : le tableau
  est partagé, donc la mesure de la carte l'a aussi (`retirerPointMesure`) ; pour corriger A, on le déplace.
  **Pas essayé sur un vrai téléphone** (émulation tactile seulement) : le menu contextuel d'un appui long est
  bloqué (`contextmenu`, `touch-callout: none`) mais à vérifier sur iOS et Android.
- **Le pincement à deux doigts** (`creerPincementProfil`, pur et testé) : écarter ou rapprocher zoome autour du
  milieu des deux doigts, les déplacer ensemble déplace le graphique, incrémental comme la molette. Un second
  doigt **abandonne** le geste du premier (saisie d'un point, clic) ; le doigt resté après le pincement ne fait
  rien. Il **n'existait pas** avant le 5 octobre (la ligne « pincement non essayé » le laissait croire) : le
  graphique n'avait que la molette et un doigt. Vérifié en tactile émulé (CDP), pas sur un vrai téléphone.
- **Maj + clic : à angle droit** (R20, `MESURE.surAxe`, pur) : en **mesure** seulement, sur le graphique du profil
  et sur la carte, le point se pose sur la verticale ou l'horizontale (celle où le curseur est le plus loin, à
  égalité l'horizontale) du **point précédent** de la chaîne, dans l'espace de l'écran. Dans le profil, une
  verticale garde la même distance (la hauteur au-dessus du sol), une horizontale la même altitude, et **le
  point ne s'accroche pas au nuage** (la ligne ne serait plus droite). Un **aperçu pointillé** suit la souris
  tant que Shift est tenu (`apercuDroit` sur le graphique, `apercu` sur la carte). Sans point précédent, Shift ne
  fait rien. **Pas** de verrou à bascule, de magnétisme ni de 45° (décision : rester simple), **pas** la 3D
  (Maj+glisser y pivote), **pas** le tactile (pas de Shift). Piège : la poignée du **rideau** (centre de la carte)
  intercepte les clics sur ses 22 px : un test automatisé qui clique là croit à un défaut.
- **Position de la mesure dans la bande** (7 octobre 2026, `profil.ecart`, `PROFIL.pointSurAxe(a, b, s, d)`) : un point du
  profil est `(s, z)` et sa position exacte est `A + u·s + n·d`, `d` étant **un seul écart latéral (m, + à gauche de A→B)
  pour toute la chaîne et la référence** : une ligne parallèle à l'axe. Un **troisième curseur, jaune**, sur le double curseur
  (même échelle : 0 = gauche, 1000 = droite, `ecartDepuisCurseur`/`curseurDepuisEcart`) le règle ; il n'existe que s'il y a
  un point de mesure ou la référence (`majCurseurPosition`). Il ne recalcule rien : la chaîne se redessine sur la carte
  (`dessinerChaine`). Une autre largeur ramène `d` dans la bande (`ecartBorne`), déplacer A ou B le remet à 0. Il n'est pas
  dans le lien. **Pas de lien avec la tranche** : il peut sortir de la partie gardée. Les trois pouces se superposent : le
  jaune, dernier dans le DOM, passe au-dessus s'ils coïncident. Fondement des futurs exports du profil (R18, point 3).
- **Une seule mesure.** Le graphique alimente la chaîne de mesure de la carte
  (`MESURE.tableauHtml`, partagé) : ses points deviennent `{ x: distance sur
  l'axe, sol: altitude }`. Le clic s'accroche au point visible le plus proche
  (14 px) — pour mesurer la cime, pas l'endroit où la souris est tombée.
- **Le double curseur choisit une tranche de la largeur de la bande** (le worker
  rend l'écart latéral de chaque point), il ne recalcule rien.
- **La largeur** va de 0,5 à 100 m, curseur logarithmique (une échelle linéaire
  n'aurait aucune finesse à l'échelle d'un arbre) et champ précis ; elle est
  aussi dans la modale et recalcule au `change`. Les classes de la modale
  partent de la légende 3D mais lui sont **locales**.
- **L'aide** (`#dlg-aide-profil`) s'ouvre par une pastille `?` — la même que les
  autres (`.aide-info`), un peu plus grande pour se toucher (`.ouvre`) — **posée là
  où le doute arrive**, pas en tête d'écran : à côté de « Largeur » (fenêtre
  flottante et modale) et de « Partie de la bande gardée ». Chacune ouvre la
  fenêtre **défilée sur l'entrée qui l'explique** (`data-aide` = id du titre).
  Une fenêtre et non une infobulle `title`, qui ne s'affiche pas au toucher. Elle
  porte une croix en haut : sans elle, le focus allait au dernier bouton et la
  fenêtre s'ouvrait défilée en bas. Pas de pastille avant un `<input>` dans un
  `<label>` : elle deviendrait le contrôle du label.
  **Son texte est à réviser** si un sol comblé (TODO R7) arrive.
- Pas de hauteur automatique (la valeur d'une cime et du sol se lit sur le
  graphique), pas de profil en 3D, pas d'export du nuage (la mesure s'exporte, voir plus bas).
- **La date d'acquisition se lit dans « Point sélectionné »**, pas dans le
  profil : on y sélectionne le point (l'arbre), et la fiche donne ses
  coordonnées, ses boutons « ouvrir ailleurs » et la **plage de vol de la dalle
  qui le contient** (`flux.dalleAu`, `IGN.formaterAcquisition`). Le WFS
  publie `date_debut_acquisition` / `date_fin_acquisition` par dalle : une plage
  de un à trois jours, **différente d'une dalle voisine à l'autre** (vu en
  Ariège : 12–13, 12–14 juillet 2022). Le jour exact exigerait le temps GPS de
  chaque point, retiré des blocs : inutile, la plage suffit au tag OSM (un
  contributeur l'a confirmé). Sans
  date publiée : « — », jamais une date inventée.
  **Format du service changé (octobre 2026)** : la couche `IGNF_LIDAR-HD_METADONNEE:metadata` n'a plus de champ `metadata` en
  JSON, les champs (`date_debut_acquisition`, `date_fin_acquisition`, `nombre_points`…) sont des **propriétés directes**, et les
  dates portent un **Z final** (`2025-02-01Z`). Scopus lisait l'ancien format : « non publiée » partout (signalé sur le forum). Les
  deux formats sont lus (`champ()` dans `ign.js`), le Z est accepté (`formaterAcquisition`). **Le test de fumée ne le voit pas** :
  contrôler à la main ce que renvoie le WFS (`node` + `fetch`) quand une donnée IGN disparaît.

## La carte

- **La grille des dalles est calculée, pas téléchargée** : une dalle est
  exactement `[X·1000, (X+1)·1000] × [(Y−1)·1000, Y·1000]` en Lambert-93. Le
  WFS plafonne à **600 entités en silence** (triées par colonne → bandes vides)
  et ne s'interroge qu'**au point**, lors d'un clic.
- Plus de quadrillage kilométrique. La couche WFS des emprises de chantier (`bloc`) a disparu fin
  septembre 2026 : les zones bleues sont retirées, pas remplacées.
- **Un carré Lambert-93 est tourné en WGS84** : toute emprise est un polygone de
  côtés reprojetés (`GRILLE.contourEmprise`), jamais `L.rectangle`.
- Ouverture sur la France entière par `fitBounds` (repli zoom 5 si le conteneur
  n'a pas de taille).
- **Zoom borné à 19** (plafond de la couche IGN, mesuré en trois lieux) :
  `maxNativeZoom: 19`, `maxZoom: 20`, avis « zoom maximal » ; même borne pour
  `ORTHO.zoomPour`. À vérifier en temps réel, pas sous `--virtual-time-budget`.

- **« Ma position »** (6 octobre 2026, `localisation.js`, pur + fabrique testés) : un bouton viseur sous les
  trois modes de la carte ; `navigator.geolocation` (HTTPS exigé, rien n'est envoyé : la position reste dans
  l'onglet), position précise demandée avec un délai de 15 s. La carte se recentre au zoom choisi selon la
  précision (`LOCALISATION.zoomPour` : 18 sous 30 m, jusqu'à 12 au-delà de 3 km), avec un point bleu et, si
  elle dépasse 15 m, son cercle d'incertitude. **La vue est décalée d'un dixième de sa largeur** : la poignée du
  rideau est au centre de la carte et cachait le point. Refus, indisponible, délai dépassé : un message en clair
  (`messageErreur`), jamais le texte brut du navigateur. Câblé dans `recherche-lieu.js`. Sur tablette (601–900 px)
  le panneau ouvert couvre le bouton comme le zoom : on le replie.

## L'outre-mer

Même découpage en dalles de 1 km nommées par leur coin nord-ouest, même cube
d'octree ; **seule la projection change** (UTM 40 S Réunion, 20 N Antilles,
38 S Mayotte, 22 N Guyane). `PROJ.TERRITOIRES`, `PROJ.territoireAuPoint`,
`PROJ.projectionDe(code)` (Krüger ordre 4, vérifié au mm). Aucun changement de
datum. En vue normale, `territoireVue` (`app.js`) suit le centre de la carte et
tout passe par `projVue()` ; le worker reçoit le territoire avec chaque image.
Martinique, Mayotte, Guyane : pas de dalle publiée
(27/09/2026), la carte dit « Pas de LiDAR HD ici ».

---

## Navigation 3D

Contrôles « à la Google Earth » : glisser déplace, molette zoome sous le curseur,
Maj+glisser pivote. Trois pièces à ne pas défaire :

- **`_repere()` est la source unique** du repère caméra (rendu et contrôles).
- **Le déplacement se mesure par intersection** avec le plan horizontal de la
  cible, pas par un facteur d'échelle.
- **Le zoom recentre** : `cible ← P + (cible − P)·k`.

### Pointé au clic

`TERRAIN.pointDuNuage` cherche dans `etat.nuage` le point le plus proche du
rayon (`viserPoint3D` l'essaie en premier) ; `pointDuTerrain` (enveloppe
`mnt + hauteur`, plus `sommetZ`/`sommetCls` pour tous les points hors filtre de
classe) n'est qu'un **repli**. Viser une surface lissée donnait « rien » ou
« à côté ». Décisions :

- Seuil d'acceptation **en pixels écran** (`CONFIG.rendu.toleragePointagePx`),
  converti en monde à la profondeur de chaque candidat.
- Parmi les points dans le seuil, **le plus proche de la caméra** gagne.
- Balayage linéaire (un clic, pas une image).
- Un point rejeté au rendu (classe décochée) l'est aussi au pointé.
- `FOV_Y_DEG` (`vue3d.js`) est une constante unique : rendu, rayon de clic et
  zoom doivent suivre le même champ de vision.

### Boussole (`boussole.js`)

Rose SVG **projetée** sur le cercle d'horizon. Repère issu de
`Vue3D._repere()`. Cliquer « N » regarde vers le nord (nord en *haut*). Inclinaison de
dessin bornée à [17°, 74°], azimut jamais. Conventions de signe vérifiées dans
`test/boussole.test.js`.

### Mesure en chaîne

`pointsMesure` (`app.js`) est un tableau ; `mesure.js` : `segments`, `totaux`.
**Pas de total de dénivelé** (somme signée = écart net, trompeur).
**`totale3D` vaut `null` si une altitude manque** (jamais une somme partielle) ;
`totaleHorizontale` se somme toujours. **Pente par segment** (`MESURE.pente`,
colonne du tableau partagé avec le profil) : **en pourcentage seul**, signé comme
le dénivelé (45° = 100 %, une pente raide dépasse 100 %) ; c'est la forme du tag
OSM `incline=15%` (le wiki OSM ne préfère les degrés que là où ils sont d'usage
courant), recopiable telle quelle. Les degrés ont été essayés puis retirés :
deux valeurs l'une sous l'autre faisaient trop. « — » si l'horizontale est nulle
ou une altitude inconnue ; pas de pente totale (même raison que le dénivelé).
Cinq colonnes ne tiennent pas dans 340 px sans resserrer les cellules (requête
de conteneur CSS sur `.mesure-scroll`). `definirMesure` des
deux vues prend un tableau. Pas de lettres sur les marqueurs (atlas de glyphes disproportionné).

**Déplacer un point de la mesure sur la carte** (7 octobre 2026) : chaque point est un `L.marker` à icône `divIcon` glissable
(`creerOutilsCarte`, `poserMarqueur`), saisi **seulement en mode Mesure** (classe `mode-mesure` sur `#vue-carte`, `pointer-events`
coupé sinon : en Déplacement on fait glisser la carte). Pendant le glissé, `trace()` redessine le trait et les distances sans
refaire les marqueurs (`MESURE.deplacerPoint` : altitude inconnue, « n/d » au tableau) ; au lâcher, l'altitude se **relit** dans la
vue calculée (`MESURE.poserLecture`, ignorée si le point a été retiré entre-temps). Pas de Maj ni d'accrochage au glissé ; la chaîne du
profil dessinée sur la carte n'est pas déplaçable.

### Export de la mesure de la carte

Bouton « Exporter… » sous le tableau (`export-mesure.js` pur et testé, `export-mesure-ui.js` la fenêtre) : **GeoJSON**
(par défaut), **GPX** ou **OSM XML**, avec une case **« Avec l'altitude du sol », décochée par défaut** (par défaut : seulement
longitude et latitude). Le GeoJSON porte une `LineString` et un `Point` par sommet nommé A, B, C… (`[lon, lat]`, ordre
de la RFC 7946) ; le GPX un `trk` d'un `trkseg` ; le `.osm` un nœud par sommet à **identifiant négatif** (objets nouveaux)
et un way, `upload='false'`, **sans aucun nom ni étiquette inventée** (un `name=A` polluerait OpenStreetMap). Avec la
case cochée : `ele` = le **sol** (jamais le sommet), et `height` / une propriété quand un sursol est mesuré. **Une altitude
n'est jamais écrite à moitié** : si un point n'en a pas, la case est grisée et le dit, comme `totale3D`. Coordonnées au
centimètre (7 décimales), fichier `scopus-mesure-AAAA-MM-JJ.<ext>`. **Réserve** (dite dans la fenêtre) : l'altitude est
celle du LiDAR HD (NGF, niveau de la mer) : bonne pour `ele` d'OSM et le GPX ; au sens strict du GeoJSON (hauteur sur
l'ellipsoïde) elle diffère de ~50 m en France. **Piège (7 octobre 2026)** : uMap lit le `.osm` avec `osm2geojson` (et non `osmtogeojson`), dont l'analyseur ne tire
**rien** d'un nœud vide à balise fermante (`<node ...></node>`, message « No data has been found for import ») ; un nœud
sans étiquette s'écrit donc auto-fermé (`<node ... />`, comme JOSM), de même un `<trkpt ... />` ; un test l'impose.
Contrôles faits : GPX valide au schéma officiel 1.1, GeoJSON valide à la RFC 7946 (`check-geojson`), `.osm` lu par
`osm2geojson-lite` et `osmtogeojson`. Vérifié par les analyseurs JSON et XML de Python sur des fichiers
téléchargés du navigateur ; **ouverture dans JOSM non essayée** (pas de JOSM ici). **La mesure du profil s'exporte avec la même fenêtre** (`creerExportMesure(...).lier(idBouton, points)`, une fenêtre et plusieurs
boutons) : `PROFIL.pointsLocaux` donne les points sur l'axe décalé de l'écart du curseur jaune, l'altitude est celle lue au
graphique (jamais de sursol). Le profil lui-même (nuage de la coupe) n'a pas d'export.

## Rendu à la demande

La boucle 3D **ne tourne pas en continu** (1,9 → 56,9 images/s, pire latence
1 165 → 18 ms). **Toute méthode qui change l'affichage doit appeler
`invalider()`.** Seule exception : `_animerVers()` (260 ms), interrompue par tout
geste (`_arreterAnimation`).

Pendant un geste, une **part** du nuage est dessinée (`drawArrays(0, k)` sur le
nuage rangé en paquets de hachage) ; `k` suit le **retard** des images
(`partEnMouvement`), résolution plafonnée à 1 pixel physique ; 150 ms sans geste
→ image complète. `&debug` l'affiche dans le HUD 3D. Un seul conteneur défilant
dans le panneau (la liste de résultats avait le sien et piégeait la molette).

---

## Interface

### Accueil

Section plein écran d'`index.html` (pas un second fichier : `file://`). Un voile
sur la carte vivante. « Voir un exemple » (seul élément coloré) cadre le Bois des
Caures (Verdun) au zoom 16 ; « J'ai déjà des coordonnées » est un lien. Poids
inégaux délibérés. L'accueil dit ce que l'outil fait (calcule le relief, ne
repère rien à la place de l'utilisateur) sans faire croire à une IA. À ne pas
défaire :

- Un `location.hash` non vide **saute l'accueil**.
- Raccourcis clavier neutralisés tant que l'accueil est là.
- Le panneau est masqué par CSS (`#accueil:not([hidden]) ~ …`) et sa colonne
  est **refermée** (`grid-template-columns: 0 1fr`), sinon la carte est décalée.
- Fermer l'accueil → `carte.invalider()` avant de recentrer (redimensionnement
  CSS sans évènement `resize`).
- Piège de mesure : Chrome headless ne descend pas sous ~500 px de large ;
  vérifier une largeur de téléphone dans un **iframe**.

### Les trois modes de la carte

Un bouton à trois états sous le zoom (`MODE_CARTE`, `mode-carte.js`) : **carte scindée** par le rideau,
**une seule carte** (la gauche, une seule liste « Couche affichée », la droite ni calculée ni chargée),
**deux cartes synchronisées** (la gauche à gauche, la droite à droite ; empilées sous 600 px). La gestion des cartes est une **fabrique à dépendances explicites** (`creerVueCartes`, `vue-cartes.js`, testée avec des
cartes factices : ni DOM ni Leaflet), `app.js` ne fait que lui passer ce qui lui est étranger — c'est le modèle suivi par le reste de `app.js`
(`creerProfilUI`, `creerPanneauRelief`, `creerCalculRelief`, `creerNuage3D`, `creerPanneau3D`, `creerOutilsCarte`,
`creerOutilsPoint`, `creerPartage`, `creerRechercheLieu`, `creerChrono`, `creerPanneauMobile`, `creerAccueil` ;
modules purs testés : `creerCatalogueVue`, `STATUT_RELIEF`) : une fabrique par métier, ce qui naît plus tard dans le démarrage arrive par
un objet `liaisons` ou par des fonctions, jamais par une variable recopiée (TODO, « Dette de structure »). Les
gestes de la 3D sont dans `ControlesVue3D` (`controles-3d.js`). Chaque carte est un
**volet** (`VOLETS`, `volets.js`) : sa carte Leaflet, son `CalqueRelief`, ses côtés ; le calcul pose l'image de
chaque côté dans le volet qui le porte, avec **son propre écran** (`VOLETS.ecran`). La seconde carte est un
`L.map` simple créé au premier passage, photo en fond ; `SYNCHRO.lier` (`synchro.js`) copie le déplacement et le
zoom dans les deux sens **avec un verrou contre l'écho**, et pose un repère (DOM, pas canevas) sur l'autre carte
au survol. Pièges : un calque Leaflet n'est ajouté (`onAdd`) qu'**une fois la carte pourvue d'une vue** (`setView`
avant `addTo`) ; `.scene` est une `<section>` : un `</div>` en trop y était **ignoré en silence**, mais fermait
`#cartes` trop tôt. En deux cartes, sélection, mesure et profil sont **grisés** (liés à la carte principale) ; le lien
porte `cartes=2` (pas `rideau`).

### Soutenir

Section tout en bas du panneau (`CONFIG.soutien`, masquée si vide), bouton
Ko-fi + lien Liberapay, `.github/FUNDING.yml`. Rien sur l'accueil, ni fenêtre,
ni relance.

### Lien partageable

Format osm.org : `#map=zoom/lat/lon`, + `/orientation/inclinaison` en 3D si non
nuls (MapLibre). `OSM.parseHash` ignore le reste : un lien Scopus s'ouvre tel
quel dans osm.org/iD/JOSM (`test/lien.test.js` rejoue la lecture). Depuis le
plan 3, ouvrir un lien cadre la carte (un ancien `#d=x,y` cadre le centre de sa
dalle au zoom 16 et se réécrit) .

- Zoom Leaflet/osm.org (256 px au zoom 0), déduit de la résolution au sol
  (`LIEN.zoomDepuisResolution`), deux décimales.
- Le lien suit l'onglet affiché ; **`replaceState`, jamais `location.hash =`**,
  regroupé à 300 ms (`majLien`, Safari limite à 100 par 30 s). Rien d'écrit
  tant que l'accueil est ouvert.
- Conventions d'angle éprouvées contre le vrai `Vue3D._repere` : orientation 90
  = est, inclinaison 0 = verticale ; le 89° de la vue de dessus n'est pas écrit.
- **Anciens `#d=x,y`** : indices du coin **sud-ouest** (`#d=877,6904` =
  dalle `0877_6905`). Ne pas « corriger ».
- Bouton « Partager » : copier le lien ou ouvrir sur osm.org, **pas une action
  de plus**. Dans la barre des onglets, menu z-index sous 1500 (panneau) mais
  au-dessus des contrôles Leaflet (1000). Copie par
  `navigator.clipboard.writeText`, repli `prompt()`.
- `hashchange` suit un fragment modifié à la main ; nos `replaceState` ne le
  déclenchent pas.

### Le lien porte la bande et la vue

Après `map=`, des paramètres **nommés et lisibles** (clés en français), comme osm.org
y ajoute `&layers=` : `&profil=latA/lonA/latB/lonB/largeur` (6 décimales, ~10 cm),
`&sel=lat/lon` (le point sélectionné), `&regle=lat/lon/…` (la règle de la carte, au plus
40 points ; l'altitude se relit dans la vue), `&sol=2.6` (classes du sol du relief,
**seulement si elles diffèrent du défaut**, `LIEN.sansDefaut`), puis les réglages de la
vue (plus bas). Fonctions pures dans `lien.js` (`ecrirePartage`, `lirePartage`), testées
à froid.

- **La modale du profil n'est pas dans le lien.** Ni `coupe`, ni classes, ni mesure, ni
  référence : ouvrir un lien pose la bande et active le mode Profil (la fenêtre
  flottante prête à « Valider »), **jamais la modale** — un clic sur « Valider » pendant
  l'attente l'aurait ouverte deux fois, et on ne saurait pas sur quelle partie zoomer.
  Un ancien lien portant `coupe=1…` est lu sans ces paramètres (test dédié).
- **Pas de compression** : elle sert aux gros états (Mermaid, Excalidraw) et rend le
  lien opaque ; ici un lien lisible se répare à la main. Rien d'externe à charger.
- **Sûr dans le forum (Discourse)** : ni virgule (elle casse un lien nu), ni
  parenthèse, ni guillemet, ni `+` (`URLSearchParams` le lit comme une espace). Nombres
  séparés par `/`, codes par `.` ; un test vérifie le jeu de caractères.
- **Un paramètre abîmé est ignoré en bloc**, jamais à moitié (un profil à demi lu
  serait pire qu'un profil absent). Les nombres sont stricts (pas d'exposant, pas de « + »).
- **Rouvrir un lien** : la carte se cadre, puis `appliquerPartage` remet le sol, les
  réglages, la sélection, la règle (mode Mesure) et la bande (mode Profil). Pendant ce
  temps `etat.restaurationPartage` empêche d'écrire le fragment : il perdrait ce qu'il
  porte encore. Un lien reçu au démarrage attend dans `partageEnAttente` que le bloc du
  mode vue soit prêt.
- **Réglages de la vue** (`vue` dans `lirePartage`) : `gauche`/`droite` (clés de couche),
  `rideau` (0–100), `contraste`, `svf=directions/rayon`, `lisse=0`, `couleur`, `plafond`
  (millions de points), `edl=0` (ombrage de profondeur, case de l'onglet 3D), `cachees=`
  (classes masquées en 3D) ; **seul ce qui diffère du défaut** est écrit
  (`reglagesVue`), chacun se lit et tombe **seul**. Remis par `reglerVue`, qui passe par les
  vrais contrôles (leurs gestionnaires font le reste). **L'onglet 3D** s'écrit (`onglet=3d`) et se rouvre : voir « La 3D de la vue ». Les réglages de la 3D (plafond, couleur…) s'appliquent à l'ouverture. Le plafond est écrit, mais dépend de l'appareil : celui qui ouvre
  le change à sa guise. La position du rideau passe par `placerRideau` (enveloppé pour
  `majLien`).
- **Le lien suit tout changement** (bande, largeur, sélection, règle, sol, réglages) par
  `majLien`, déjà regroupé à 300 ms.
- **Le bouton « Partager »** copie `location.href` ; « Ouvrir dans OpenStreetMap » ne
  garde que la vue, ce qu'osm.org sait lire.
- Vérifié en navigateur sur un scénario de bout en bout (bande, anciens liens, règle,
  réglages) à 1400 px.

### Le panneau suit la vue

Une section porte `data-vue="carte"` ou `"3d"` ; `basculerVue()` écrit
`panneau.dataset.vue`, le CSS masque le reste. Sans `data-vue` : valable
partout. Les quinze curseurs de seuils sont repliés dans un `<details>`.

### Mobile

Sous 900 px, le panneau se pose sur la carte **sans la cacher** (un tiroir modal
a été essayé et rejeté). Sous 600 px : feuille tirée du bas, trois hauteurs
(`data-feuille` : `replie`, `mi`, `plein`), sous-titre et aide masqués. De 600 à
900 px : panneau latéral ≤ 340 px replié par une languette, **posé sous la barre des onglets et des
outils** (`--hauteur-barre`, un test le garde : il la recouvrait toute, jusqu'au bouton Profil). `pointer: coarse` :
aide tactile (`AIDE_TACTILE`), bande du rideau 44 px. Échap replie. Gestes au
vrai doigt non essayés.

### Messages d'erreur

`RESEAU.expliquer` traduit : **hors ligne prime sur tout** ; une panne inconnue
passe telle quelle ; **jamais d'URL**. Le voile d'alerte dure proportionnellement
à la longueur du message. États vides : clic hors de France
(`PROJ.dansEmpriseFrance` est un rectangle englobant) ; dalle < 2 % de cellules
valides ; mobile (`budgetOctetsMobile`, on avertit sans interdire).

**Sans WebGL2, seul l'onglet 3D tombe** : appels via `vue3d?.`, onglet
désactivé, avis persistant.

### Voile d'attente

Les traitements lourds sont synchrones : un indicateur ordinaire resterait figé.
Seule une animation `transform`/`opacity` est portée par le compositeur —
**n'animer rien d'autre dans le voile**. `ATTENTE.respirer()` laisse deux
images passer avant le calcul ; le libellé change par `await etape('…')`. Les
calculs rapides (ombrage, micro-relief) n'y passent pas.

---

## Lecture du relief (`relief.js`)

Une cellule = un pixel en Lambert-93, nord en haut. Algorithmes de la
littérature (Horn 1981, LRM de Hesse 2010, SVF de Zakšek et al. 2011,
ouverture de Yokoyama 1998), **vérifiés contre des surfaces à réponse connue**
(plan à 20° → ombrage sin(20°+45°) ; plan → micro-relief nul ; plan horizontal
→ SVF 1 ; plan à 20°, 4 directions → SVF 1 − sin(20°)/4).

- **Deux familles de couches** : classé 1/6, un tas de pierres est retiré du MNT
  et comblé (visible en « hauteur » seulement) ; classé 2, il *est* le terrain
  (visible au micro-relief).
- **Ombrage à 4 soleils** (`ombrageMulti`, 7 octobre 2026, retour « trop cramé ») : **quatre azimuts dans un même quadrant**
  (225°, 270°, 315°, 360° par défaut, soit `azimut + [-90, -45, 0, +45]`), comme GDAL et l'USGS. Avant : quatre soleils
  **opposés** (0°, 90°, 180°, 270°) qui s'annulaient exactement : il restait `sin(hauteur) × cos(pente)`, une carte de pente
  sans orientation (versants nord et sud identiques ; sur un plan de 30°, 0,61 partout contre 0,26 à 0,97 avec un soleil).
  Mesuré à Saint-Julien-en-Genevois (frontière suisse) : le détail revient à côté de l'ombrage simple. L'azimut agit désormais.
  Non fait : la pondération selon l'orientation de Mark 1992 (formule non vérifiée), la hauteur à 30° de GDAL.
- **Ombrage coloré** (`ombrageRGB`) : trois soleils à 120° (315°, 75°, 195°) sur
  RGB. **Hors de `RELIEF.COUCHES`** (ne suit pas le contrat de
  `RELIEF.calculer`) ; traité comme la photo (`OMBRAGE_RGB`, `{ type: 'photo', rgba }`).
- **L'eau est du terrain** (classe 9 versée dans `solZ`, aucun octet de plus).
- **Les classes du sol choisies décident seules de l'altitude.** La complétion de la
  surface par les non classés (`inclureSursol`, plafond 3 m) existe encore mais est
  **désactivée par défaut** : une petite plante ou un rebord de toit (cellule sans
  retour sol, retour non classé au-dessus) y faisait une tour de 0,6 à 3 m dans un
  sol lisse, et le balayage d'horizons une **étoile à huit branches** longue comme son
  rayon (mesuré à 43,6385 N / 1,1495 E ; coupée, plus une seule étoile, les murs d'une
  ruine restent lisibles). Qui veut les non classés les ajoute aux classes du sol.
  Deux « rabotages » de pointes ont été écrits puis retirés : ils soignaient la
  conséquence, modifiaient le terrain en silence, et un mur étroit de plus de 2 m en
  aurait pâti. `hauteur` reste mesurée contre le sol comblé ; `trou` garde son sens
  strict ; `analyse` ne prend pas la substitution.
- **Ouverture : le signal d'un mur est en ouverture négative** (couronne 58,6° ;
  intérieur en ouverture positive 72,1°), car un mur est de niveau le long de
  lui-même. L'ouverture efface la pente d'ensemble **exactement** (90° sur tout
  plan).
- **Pièges du balayage d'horizons** :
  - Une cellule sans donnée porte une altitude de repli qui fait une tour et
    donne une **étoile à huit branches** : la surface balayée porte **NaN** dans
    ces cellules (NaN rend toute comparaison fausse, zéro coût dans la boucle).
  - Le rayon doit tomber **exactement** sur sa direction (parcours sur l'axe
    dominant, interpolation sur l'autre) : l'arrondi donnait 88,6° au lieu de 90.
  - **Ne jamais chronométrer dans le harnais de test** (`vm.createContext` :
    7× plus lent).
## Calcul sur la carte graphique (`gpu-relief.js`, noyaux dans `shaders.js`)

Porte sur WebGL2 le balayage d'horizons, les ombrages, le micro-relief et le
terrain. Le SVF passe de 12,5 s à 1,1 s ; **le reste est du transfert**, donc
ombrage et micro-relief ne gagnent rien.

- `relief.js` et `raster.js` restent la **référence et le repli** (`moteur: 'cpu'`
  ou `CONFIG.relief.gpu = false`).
- **Autocontrôle au premier usage** (surface d'essai calculée des deux façons) ;
  au moindre écart, tout reste au processeur.
- **Un contexte WebGL à part**, jamais celui de la 3D.
- **Par bandes de 256 lignes** (réinitialisation Windows sur machine lente).
- **Pièges de simple précision** : cos(90°) = −4·10⁻⁸ (directions calculées en
  double côté JS, passées en uniforms) ; le pas en diagonale s'arrondit à 1 (pas
  de l'axe mineur en deux morceaux, plancher recomposé **depuis l'entier le plus
  proche**).
- Mesurer dans le **vrai Chrome de Windows** (le Chromium de WSL n'a que
  SwiftShader, bon juste pour vérifier des valeurs). Harnais : petit serveur HTTP
  WSL, page servie en `text/html`, verdict renvoyé par POST.

## Classes du sol

**Filtrage des classes en 3D** (quels points *se voient*) : alpha 0 dans la palette (`paletteClasses`), le
vertex shader **rejette** le point (un point transparent écrirait dans le tampon de profondeur). Les classes
du sol du relief sont un autre réglage (`CONFIG.raster.classesSolDefaut = [2, 9]`, lien `&sol=`).

---

## Détection retirée

Le parcours `?dalle` (choix et chargement d'une dalle, onglet 2D, détection de structures et de sentiers)
a été retiré le 05/10/2026 : jamais confronté à une structure réelle connue, il alourdissait `app.js`
(3 834 → 2 200 lignes). Le code et ses décisions (rectangularité, couverture angulaire, ouverture
négative, Frangi démenti par le banc…) sont récupérables au tag `archive-avant-retrait-dalle`.

## Pièges connus

- **`data.geopf.fr` renvoie des `400` fantômes** (même URL valide alterne 200 et
  « Layer … unknown »). Traité comme **transitoire** dans `reseau.js` ; tuiles
  Leaflet redemandées jusqu'à 3 fois sur `tileerror`. Ne pas corriger l'URL.
- **Tout passe par une seule connexion HTTP/2.** Leaflet ne passe pas par la
  file de `reseau.js` : trop de tuiles d'un coup = `REFUSED_STREAM`. D'où
  `updateWhenIdle`.
- **`fetch` n'a aucun délai maximal.** `reseau.js` pose un délai **par
  tentative** : 10 s jusqu'à la réponse (`delaiReponseMs`), 30 s en tout. Le
  délai arrive comme un abandon, comme l'annulation utilisateur : **le verdict se
  prend sur `signal.aborted`**, jamais sur le nom de l'erreur. `RESEAU.lenteRecente`
  affiche un avis « IGN lent ».
- **Le tas WASM détache ses vues quand il grandit** : `decodeur.js` compare
  l'identité du tampon à chaque point. Ne pas « optimiser » ce test.
- **Un gestionnaire `async` qui rejette dans un Worker est silencieux** : le
  worker renvoie explicitement `echecInit`.
- **BBOX du WFS 2.0 en CRS urn = (lat, lon)**. Inverser ne donne aucune erreur,
  juste zéro résultat.
- **WMTS** : `PLANIGNV2` en `image/png`, `ORTHOPHOTOS` en `image/jpeg` ; l'autre
  combinaison renvoie une erreur XML. `FORMAT` reste percent-encodé.
- **Leaflet mesure son conteneur à l'initialisation** : monté masqué, il faut
  `invalidateSize`.
- **Un 200 en réponse à un `Range` ne veut pas dire que la plage a été
  ignorée** : le verdict se prend sur la **taille reçue**.
- **`--virtual-time-budget` de Chrome headless ment sur les Workers** (minuteurs
  instantanés, worker en temps réel). `.tmp/run-browser.js` fait renvoyer son
  verdict par la page.
- **Deux fichiers locaux sont deux origines opaques** : la `SecurityError` survient
  à l'accès à `contentWindow`. Les vérifications s'exécutent dans le même document.
- **Altitude relative en grille, absolue en sortie** : `origine[2]` est retiré des
  Z au décodage ; la détection le remet dans `altitudeSol` (GPX, Google Earth,
  boîtes 3D).
- **Un canevas masqué mesure 0 × 0** : `_pointSousCurseur` rend `null`, sinon la
  cible de la caméra part en NaN définitivement.
- **Une règle `display` d'auteur annule `hidden`** : d'où `[hidden] { display: none
  !important; }` en tête de `styles.css`, à ne pas retirer.
- **`gl.uniform*(null, …)` est un no-op silencieux** (uniform non utilisé éliminé
  à la compilation).

---

## Validation

`npm test` : nuages synthétiques à vérité connue, projection contre les coins de
dalle publiés par le WFS (5 mm, aller-retour Lambert-93 ↔ WGS84 au micromètre),
plus des contrôles mécaniques nés de fautes réelles : syntaxe de chaque fichier de
`src/`, correspondance avec les balises d'`index.html` (scripts chargés et
**identifiants lus par `app.js`**), absence d'`import`, absence de backtick dans
les commentaires GLSL.

**Garde-fou de taille** (`test/taille-code.test.js`, mesureur sans dépendance dans `test/taille-code.js`,
validé contre acorn : 888 fonctions et classes, aucun écart) : une fonction tient en **100 lignes propres**
(sans compter ce qu'elle imbrique), une classe en **400**, un fichier en **1000**. Ce qui dépasse déjà est un
**cliquet** (`taille-code.limites.json`) : rien de neuf ne dépasse, rien d'ancien ne grossit, et chaque réduction
doit être inscrite (`node test/taille-code.js --ecrire`) — le test échoue si la limite est restée plus lâche que le
code. Le plan de découpage est dans `TODO.md`, « Dette de structure ».

**Durée de `npm test`** (7 octobre 2026, 8 cœurs, 592 tests) : **15 à 16 s** de bout en bout (54 s de processeur : les fichiers
tournent en parallèle). Le plus long, `vue-relief.test.js` (12,8 s seul), fixe à peu près la durée totale ; viennent ensuite
`flux`, `relief`, `relief-travailleur` et `vue-relief-gpu` (4 à 5 s chacun). Les autres tiennent sous la seconde.

**Test de fumée** (`npm run fumee`, `tools/fumee.js`, hors de `npm test`) : ouvre le vrai site dans Chromium et déroule accueil,
exemple, boutons, mesure (tableau, export, glisser d'un point), profil (coupe, curseur jaune, export GeoJSON) et erreurs de console ;
une dizaine de secondes, réseau IGN requis. Il accepte une adresse (`node tools/fumee.js https://julesrumeau.github.io/Scopus/`)
pour contrôler le site publié. Dépendance **hors du dépôt** : `npm i --no-save playwright-core` et un Chromium (`CHROME`).
Vérifié en cassant exprès un bouton (il échoue sur `#mode-profil`). À lancer avant chaque publication sur `main`.

`.tmp/` (non versionné) : harnais à reconstruire au besoin — `pipeline.mjs`
(pipeline hors navigateur sur données réelles), `selftest.html`, `run-browser.js`
(Chrome headless, verdict par POST), `app2d.html` (parcours complet dans un
iframe, seul à éprouver le câblage).

## État

| Jalon | État |
|---|---|
| Carte, dalles, LAZ, rendu, Lambert-93 → WGS84, liens, exports | ✅ |
| Relief piloté par la vue (carte + rideau, panneau « Relief », outils, 3D avec EDL) | ✅ |
| Lien partageable, accueil, DROM, états vides, borne de zoom | ✅ |
| Profil topographique (bande, coupe, mesure) | ✅ vue normale, vérifié en Chromium (bureau, tablette, téléphone, paysage) ; poignées A/B au doigt non essayées ; pincement et appui long vérifiés en tactile émulé seulement ; date d'acquisition dans « Point sélectionné » |
| Détection de structures / de sentiers | retirée (tag `archive-avant-retrait-dalle`) |
| 3D qui pilote le téléchargement | TODO #4 |

Reste à faire : `TODO.md`.
