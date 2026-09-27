# Relief piloté par la vue — conception

Date : 26 septembre 2026 · Branche : `feat/flux-vue` (depuis `dev`)

## Objectif

Voir le relief calculé depuis les points LiDAR **là où l'on regarde, sans
choisir ni charger de dalle**. On navigue sur la carte ; le relief apparaît
en quelques secondes, grossier d'abord, puis s'affine avec le zoom. La
finesse suit la surface affichée : on ne calcule jamais plus de cases qu'il
n'y a de pixels à l'écran, et jamais plus fin qu'un plancher.

Aujourd'hui : on choisit une dalle, on télécharge son nuage (7 à 185 Mo,
~1 min), on attend le calcul, et une seule dalle tient en mémoire. Cette
conception remplace ce parcours.

## Ce qui a été mesuré avant de concevoir

Toutes les mesures sont dans les harnais jetables de la session (hors
dépôt) ; les chiffres qui comptent :

- **Rangement des fichiers COPC de l'IGN**, identique sur 12 dalles de toute
  la France : `[en-tête 1,4 Ko][niveau 5 … niveau 1][niveau 0 ~0,4–0,8 Mo]
  [index 11–70 Ko][~830 o]`. Les derniers ~1 Mo contiennent l'index et le
  niveau le plus grossier. Échelle 0,01 et décalage 0 partout.
- **Une requête par dalle suffit** : `Range: bytes=-1000000` ; l'index se
  retrouve en cherchant, depuis la fin, l'en-tête d'EVLR `copc` / 1000. 12
  dalles sur 12 décodées juste. La longueur d'un point dépend du **lot de
  publication** (30 octets, 46 pour le lot d'avril 2026) : un en-tête de
  256 octets **par lot**, pas par dalle.
- **Quota IGN** : l'API de téléchargement est limitée à 10 requêtes/s par IP
  (documentation data.gouv.fr). Débit réel mesuré : ~4,5 dalles/s pour la
  fin de fichier, quel que soit le parallélisme de 3 à 8. Une dalle au niveau
  0 ≈ 4 km²/s.
- **Niveau 0 = plancher** : 25 000 à 80 000 points par dalle (~0,06 pt/m²).
  Un bloc LAZ ne se lit pas en partie : on ne peut pas descendre en dessous.
- **Seuil de la vue** : jusqu'à ~10 km de large (~60 dalles, ~13 s pour tout
  l'écran, centre en premier), les points suivent. Au-delà, le temps croît
  avec le nombre de dalles et non plus avec l'écran.
- **Calcul sur la carte graphique** (dalle entière, carte intégrée AMD) :
  SVF 12,5 s → 1,1 s, terrain 5,0 s → 2,5 s, dont l'essentiel en transferts.
  SVF d'un écran 1400 × 900 : ~0,1 s.
- **Rangement des points dans la grille sur la carte graphique, sans
  `EXT_float_blend`** (absente sur ~51 % des iPhone) : tampon de profondeur
  pour les minimum et maximum, comptes additifs sur 8 bits, sommes additives
  sur 16 bits en hauteur relative. 15 M de points : 0,23 s (+ 0,13 s
  d'envoi) contre 3,9 s au processeur — **mesure fausse**, corrigée au
  plan 2 : la carte range les vrais points à la vitesse du processeur
  (voir CLAUDE.md, « Le calcul de la vue ») ; moyennes justes à 2 mm. Les appels
  de dessin **doivent** être découpés (~1 M de points) : un appel de 15 M a
  fait réinitialiser la carte par Windows, tout relisant zéro sans erreur.
  Écart résiduel : 0,03 % des cases, points pile sur une limite de case
  (arrondi des flottants) → coordonnées entières en centimètres.
- **MNT LiDAR HD en WMS** (`IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93`,
  `image/x-bil;bits=32`) : altitudes en float32, natif à 50 cm, CORS ouvert,
  1 km² en ~6 s, une sous-zone de 500 m en < 1 s.

## Décisions

1. **La vue pilote le chargement ; plus de sélection de dalle.** Sélection ou
   non, le problème était le même (tenir ~10× plus de dalles, que l'IGN sert
   une à une) ; sans elle, l'outil se parcourt comme une carte.
2. **Les points restent sur la carte graphique**, la grille y naît et y reste,
   de l'accumulation à l'affichage. Aucun aller-retour de grille.
3. **Une seule source par zoom, dite clairement.** Sous le seuil, les points ;
   le MNT de l'IGN n'y sert que de bouche-trou **flouté** là où les points ne
   sont pas encore arrivés, remplacé en fondu. Au-delà du seuil, le MNT seul,
   **net** — c'est la version définitive à cette échelle.
4. **La carte et la 2D fusionnent** : un onglet « Carte », fond Leaflet, relief
   par-dessus.
5. **La 3D vient dans un second temps**, mais les points vivent dans **un seul
   contexte graphique** qu'elle partagera.

## 1. Le chargement

Nouveau module `src/flux.js`, script classique exposant `FLUX`.

**Déclenchement.** À chaque vue stable (fin de déplacement ou de zoom, avec un
court délai de regroupement) : si la **surface affichée** dépasse
`CONFIG.flux.surfaceMaxPointsKm2` (60 km², environ 10 km de large en 16/10),
rien n'est demandé en points. La surface plutôt que le zoom ou la largeur :
c'est elle qui fixe le nombre de dalles.

**Découverte des dalles.** Une requête WFS (`IGN.dalles`) pour le rectangle
visible plus une marge d'une dalle ; les dalles déjà connues ne sont pas
redemandées. Le WFS plafonne à 600 entités : sous le seuil de 10 km, une vue
en contient au plus ~150, marge comprise.

**Ouverture d'une dalle** (une par dalle nouvellement visible) :

1. Requête `Range: bytes=-1000000` sur l'URL du fichier.
2. Recherche, depuis la fin, de l'en-tête d'EVLR `copc` / 1000 ; lecture des
   entrées de hiérarchie (32 octets chacune). Si des sous-pages existent
   (`nbPoints = -1`), elles sont suivies par requêtes ciblées.
3. Si le bloc racine n'est pas entièrement dans le morceau reçu, une requête
   ciblée le complète.
4. La longueur de point vient d'un en-tête de 256 octets lu **une fois par
   lot** (segment de l'URL `…/NUALHD_…_<lot>/…`), mis en cache.

L'index de chaque dalle ouverte reste en mémoire (quelques dizaines de Ko).

**Choix des blocs.** Pour la vue courante :

- pas de grille `pas = max(taillePixelAuSol, CONFIG.flux.pasMinM)` ;
- niveau visé : le plus petit `n` tel que la densité cumulée des niveaux
  `0..n` de la dalle (points de l'index / surface de la dalle) atteigne
  `CONFIG.flux.pointsParCase` points par case (4 par défaut : environ un
  point sol par case sur un sol à 25 %) ;
- blocs retenus : ceux des niveaux `≤ n` qui intersectent la vue ;
- ordre : niveau croissant, puis distance au centre de la vue — tout l'écran
  atteint un niveau avant que le suivant ne commence, en partant du centre
  (l'ordre de Potree : jamais un centre net entouré de bords vides) ;
- sous le budget de points : les blocs au-delà du budget, dans cet ordre, ne
  sont pas demandés, ce qui empêche de libérer puis redemander le même bloc.

**Emprise d'un bloc sans l'en-tête.** Le cube de l'octree est dans l'en-tête,
qu'on ne lit plus. Sur les 7 dalles mesurées il coïncide avec la dalle
(demi-côté 500 m, centré) : l'emprise d'un bloc `n-x-y` est donc
`[xmin + x·c, xmin + (x+1)·c] × [ymin + y·c, ymin + (y+1)·c]`, `c = 1000 / 2ⁿ`.
Hypothèse vérifiée en navigateur sur données réelles (points décodés contre
emprise calculée) avant d'être considérée acquise.

**Téléchargement.** Par la file `defaut` de `RESEAU` (sous le quota de
10 requêtes/s), les blocs contigus d'un même fichier fusionnés en une plage
(`NUAGE.grouperPlages`). Chaque bloc a son `AbortController` : un bloc sorti
de la vue avant d'être servi est abandonné.

**Décompression.** Les workers existants (`decodeur.js`), avec une sortie
changée : coordonnées en **centimètres entiers**, relatives au coin sud-ouest
de la dalle, en `Int32Array` ; classe en `Uint8Array`. Les centimètres
entiers rendent l'affectation d'un point à une case exacte, sur la carte
graphique comme sur le processeur.

**Ce qui est gardé.**

- Points décompressés : **sur la carte graphique**, un tampon de sommets par
  bloc, sous `CONFIG.flux.budgetPoints` (20 M sur ordinateur, 5 M sur
  appareil portatif selon l'heuristique existante). Au-delà, on libère
  d'abord les blocs les plus fins et les plus éloignés de la vue.
- Octets compressés : **sur le disque** (IndexedDB), clé `url + offset`, sous
  `CONFIG.flux.quotaDisqueOctets` (1,5 Go), les moins récemment utilisés
  effacés d'abord. Un bloc présent sur disque ne passe pas par le réseau.
- Index des dalles : en mémoire pour la session, et sur disque avec les
  octets.

## 2. Le calcul

Tout sur la carte graphique, dans le contexte partagé (voir 3), à partir des
noyaux de `gpu-relief.js`, adaptés pour lire et écrire des **textures** au
lieu de tableaux JavaScript.

**Grille de la vue.** Rectangle Lambert-93 aligné sur les axes, couvrant la
vue plus une marge de `svfRayonM` + `rayonLissage` + comblement, au pas
`pas`. Taille bornée par `MAX_TEXTURE_SIZE`.

**Accumulation** (méthode validée) — les points de chaque bloc visible sont
dessinés comme des points d'un pixel, par lots de ~1 M :

| Champ | Méthode |
|---|---|
| sol minimal | profondeur 32 bits, test `LESS`, points des classes du sol |
| sommet (max de tous) | profondeur 32 bits, test `GREATER` |
| classe du sommet | passe `EQUAL` sur la profondeur du sommet |
| minimum de tous (référence) | profondeur 32 bits, test `LESS` |
| comptes sol / non classé / bâtiment / total | `RGBA8` additif, plafonne à 255 |
| sommes non classé / bâtiment | `RGBA16F` additif, hauteur au-dessus du minimum de tous |

Les classes du sol viennent de `g.classesSol` (réglable) ; une classe choisie
comme sol ne nourrit pas les sommes, comme dans `RASTER.accumuler`.

**Terrain et surface** : comblement (nombre de passes exprimé **en mètres**,
converti selon `pas`), repli, lissage, pente ; puis la surface affichée, qui
reprend `RELIEF.preparer` au pas de la grille : sol, complété par le non classé
(et le bâti si coché) sous `hauteurSursolMaxM` là où aucun retour sol, hauteur
des structures.

**Couches** : SVF, ouvertures, ombrage, ombrage coloré, micro-relief, hauteur,
sur cette surface, sans rapatriement. Un rayon exprimé en mètres garde son
sens quel que soit `pas` ; sous un pas grossier, le SVF devient une lecture à
grande échelle — c'est voulu.

**Recalcul.**

- Déplacement : seule la bande entrante (plus la marge) est recalculée ; la
  grille est décalée.
- Zoom : nouvelle grille au nouveau pas.
- Arrivée de points : la zone des blocs arrivés, plus la marge.
- Changement de réglage (classes du sol, couche, rayon) : recalcul de la vue,
  **sans réseau**.

**Bouche-trou et vue large.** Une requête WMS du MNT IGN en EPSG:2154 pour le
rectangle de la grille, à `max(pas, 0,5 m)`, au plus 5010 px de côté, devient
une texture d'altitude passée dans les mêmes noyaux. Une texture de couverture
dit, case par case, si les points de sa dalle sont arrivés : là où non, la
couche du MNT s'affiche floutée ; en arrivant, les points la remplacent en
fondu (~300 ms). Au-delà du seuil, seule la couche du MNT, nette.

**Référence et secours.** `relief.js` et `raster.js` restent la référence :
`RASTER.accumuler` passe aux centimètres entiers pour donner exactement la
même grille. L'autocontrôle de `gpu-relief.js` s'étend à l'accumulation. Sans
carte graphique vérifiée, le calcul de la vue se fait sur le processeur, avec
un budget de points réduit (`CONFIG.flux.budgetPointsProcesseur`) et un
message qui le dit.

## 3. L'affichage et l'interface

**Un onglet « Carte ».** Leaflet garde les fonds (photo aérienne, plan IGN)
et leurs tuiles. Le relief est dessiné par un calque Leaflet à canevas WebGL
(`L.Layer`), redessiné à chaque image pendant les déplacements et zooms.

**Du Lambert-93 à l'écran.** La grille reste en Lambert-93 (le SVF mesure de
vrais mètres). Son affichage passe par un maillage Lambert-93 → pixels de la
carte, recalculé à chaque vue, interpolé comme `ORTHO.maillage` (nœuds tous
les 64 px, écart sous le dixième de pixel, déjà vérifié).

**Contexte graphique unique.** Le calque de relief possède le contexte
WebGL2 qui porte les points, la grille et les couches. Ce contexte remplace
celui, séparé, de `gpu-relief.js`.

**Contrôles.**

- Sélecteur de couche de relief, curseur de contraste, lissage (acquis).
- **Rideau** : fond de carte à gauche, relief à droite, même geste
  qu'aujourd'hui (bande sensible de 22 px, étiquettes collées au rideau).
- Indicateur « affinage… » tant que des blocs sont attendus pour la vue.
- Panneau « Classes du sol » : les cases s'appliquent tout de suite.
- Sélection d'un point et mesure : altitude lue dans la grille de la vue
  (lecture d'un pixel).
- « Partager » et le lien `#map=` : inchangés ; ouvrir un lien pose la vue.

**Retiré de l'interface** : l'onglet 2D, le bouton « Charger », le curseur de
résolution et son estimation, le bandeau « dalle chargée / sélectionnée »,
« Fermer le nuage », la photo rééchantillonnée dans la grille (`ORTHO.charger`
n'est plus appelé).

**La 3D pendant ce chantier** : l'onglet est masqué ; il revient dans le
chantier suivant, sur les points du contexte partagé, avant toute fusion
dans `main`.

**Hors champ** : la détection automatique, toujours masquée. Son chemin
(grilles de 25 cm par dalle, `chargerNuage`) reste dans le code, inutilisé.

### Révision après le plan 2 (26 septembre 2026)

Le plan 2 a démenti deux hypothèses de cette section, et l'usage en a
tranché d'autres. Ce qui suit remplace ce qui précède là où ils diffèrent.

- **Pas de contexte WebGL partagé pour l'affichage.** Le calcul tourne dans
  un worker, au processeur : sur la carte graphique, même depuis un worker,
  la page gelait pendant chaque calcul (voir CLAUDE.md, « Le calcul de la
  vue »). Le worker rend une **image déjà reprojetée** dans le repère de la
  carte (Web Mercator, au pixel de l'écran), que la carte pose telle quelle ;
  le fil principal ne fait que l'afficher. La carte graphique n'est
  réessayée que pour le SVF seul, découpé en bandes, et gardée seulement si
  `&chrono` ne montre aucun gel.
- **Le rideau existe déjà** (carte Leaflet à gauche, relief à droite, noir
  tant que rien n'est calculé) ; il est à vérifier et compléter, pas à
  refaire.
- **Le relief arrive plus vite par un rangement incrémental** : chaque bloc
  n'est rangé qu'une fois dans la grille de la vue ; un déplacement ne range
  que la bande entrante ; seuls les blocs que la vue demande (niveau visé)
  entrent dans une grille neuve.
- **Pas de MNT de l'IGN** : ni bouche-trou ni vue large pour l'instant — on
  ne savait plus quelle source on regardait. Au-delà du seuil, le côté
  relief reste noir et un message dit de zoomer (TODO #5).
- **Le SVF par défaut, sans ombrage** : sur une grille au pixel, l'ombrage
  sortait pâle et peu lisible.
- **L'ancienne interface par dalle reste accessible** par `?dalle` dans
  l'adresse, le temps de la transition ; la vue par défaut est le relief
  piloté par la vue, sans `?flux`.
- **Hors de ce chantier, dans TODO.md** : mesure et pointé (#3), retour de la
  3D (#4), relief de secours signalé (#5).

## Erreurs

- Refus ou lenteur de l'IGN : réessais de `RESEAU` ; un bloc qui échoue
  laisse le bouche-trou en place et reste à redemander, sans bloquer les
  autres.
- Dalle sans LiDAR : le WFS ne la renvoie pas ; rien n'est demandé, le MNT
  (s'il existe) ou la carte seule s'affichent.
- WMS du MNT en échec : zone neutre, sans flou ni fausse valeur.
- Hors de France : ni WFS ni WMS (`PROJ.dansEmpriseFrance`).
- Perte du contexte graphique : tout est relâché, recréé au retour, les blocs
  relus depuis le disque.
- Quota disque dépassé ou IndexedDB indisponible (navigation privée) : le
  cache disque est ignoré, le réseau sert tout.

## Tests

- **Node (`npm test`)**, parties pures : lecture de la fin de fichier et
  recherche de l'EVLR (octets réels d'une dalle enregistrés en fixture) ;
  choix du niveau et des blocs, ordre de priorité ; affectation d'une case en
  centimètres entiers (cas pile sur une limite) ; politique d'éviction du
  budget de points et du cache disque ; conversion des passes de comblement
  selon le pas.
- **Autocontrôle au premier usage** étendu à l'accumulation : grille d'essai
  (points sur des limites de case, classes mêlées) comparée à
  `RASTER.accumuler`, tolérances de l'essai (comptes identiques, altitudes au
  millimètre, moyennes à 2 mm).
- **Navigateur réel, vraie carte graphique** (Chrome de Windows, harnais
  jetable qui renvoie son verdict par POST) : parité complète contre le
  processeur sur une vraie dalle ; temps du premier relief et de l'écran
  plein à 2, 5 et 10 km de large ; recalcul au zoom et au déplacement.
- **Parcours** (Playwright, Chromium de WSL) : ouvrir un lien, voir l'écran se
  remplir du centre vers les bords, zoomer, déplacer, changer de couche et de
  classes du sol, rideau, mesure, sans erreur de console.

## Points ouverts, à trancher par la mesure

- Plancher à 25 cm pour les zooms très proches (`pasMinM`) : garder 50 cm tant
  que la densité réelle de points sol ne montre pas un gain.
- Valeur de `pointsParCase` (4) : à régler à l'œil sur quelques dalles.
- Budget de points et quota disque sur téléphone : à mesurer sur un appareil
  réel, une fois la page d'essai en ligne.
