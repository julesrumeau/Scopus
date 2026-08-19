# Scopus — Reste à faire

Liste renumérotée le 19 août 2026 : les tâches achevées depuis la version
précédente ont été retirées d'ici et, quand elles laissaient un fait mesuré
sans autre trace écrite, repliées dans la section du document qui décrit
l'endroit du code concerné (la carte pour #17 et #12 ; les autres n'avaient
rien à replier, leur détail vivait déjà plus haut). Les numéros ne
correspondent donc plus à ceux des versions antérieures de ce fichier — les
renvois `(#N)` ailleurs dans le document ont été mis à jour en conséquence.
L'ordre reste celui d'origine ; seuls les *(prioritaire)* sont un jugement de
priorité explicite, le reste est classé par ancienneté et non par urgence.

**8 tâches restent.** Les deux marquées *(prioritaire)* sont les seules dont
l'issue est incertaine — tout le reste est du travail dont la forme est déjà
connue. #5 (dalle d'exemple) mérite un statut à part : elle ne demande aucun
code, elle débloque à elle seule #6 et la publication, et les critères de choix
sont déjà arrêtés — c'est le gain le plus rapide de la liste.

### #1 — Rallumer la détection, ou renoncer *(prioritaire)*

Masquée le 18 août 2026 (`ANALYSE_MASQUEE`), les deux chaînes avec. La question
à trancher n'est pas « comment la réparer » mais **à quoi elle sert**, puisque
l'ouverture et le SVF montrent les mêmes formes à l'œil et sans seuil.

Trois issues possibles, à départager par l'usage réel de l'outil, pas par le
raisonnement :

1. **Rallumer telle quelle** dès qu'un contrôle positif existe — une ruine
   géolocalisée règle les seuils en une après-midi, et les deux voies ont chacune
   leur cas propre (`test/voies.test.js`).
2. **La réduire à une aide à la lecture** : ne plus prétendre décider, seulement
   pointer les endroits où regarder, en assumant les faux positifs.
3. **Y renoncer** et faire de Scopus un lecteur de relief, ce qu'il est déjà et
   fait bien.

Ne rien décider tant que la lecture visuelle n'a pas été pratiquée sur plusieurs
dalles : c'est elle qui dira si un détecteur manque vraiment.

### #2 — Débloquer la détection de sentiers *(prioritaire)*

Rédigé quand la chaîne rendait **zéro tracé**. Depuis, elle en remonte 147 sur
Beille ; ce qui reste entier, c'est qu'**aucun chemin connu n'a servi de contrôle
positif** — rien ne dit que ces 147 sont des sentiers.

Ce qui rend le diagnostic possible : des sentiers connus sont **nets** dans le
relief, micro-relief comme SVF. La donnée porte donc le signal, et toute panne
restante est en aval — c'est un bug localisable, plus une impasse.

Méthode, en descendant la chaîne avec le relief pour référence : prendre un
chemin visible à l'œil dans l'onglet 2D et noter ses coordonnées, puis, à cet
endroit, comparer le `relief` de `sentiers.js` à la couche Micro-relief de
`relief.js` — celle-ci est vérifiée contre des surfaces à réponse connue, une
divergence désigne le lissage ou la marge de bord. Ensuite `rugosite` (surestimée,
elle rend le seuil inatteignable partout), `vesselness` (réponse non nulle sur le
tracé ? échelles 1/2/4 m contre la largeur réelle ?), `hysteresis`, le squelette
avant vectorisation, enfin les filtres — `stats.rejets` dit déjà lequel coupe.
Les durées et les compteurs par étape sont affichés : s'en servir plutôt que
deviner. Une couche de diagnostic dans l'onglet 2D — vesselness brute, masque
après hystérésis — serait le moyen le plus rapide de voir où ça casse.

**Repli acceptable avant publication :** marquer le volet Sentiers
« expérimental », ou le retirer. Livrer une fonction qui promet et rend zéro est
le pire des trois choix — l'utilisateur conclura que c'est *l'outil* qui est
cassé.

### #3 — Draper le relief sur un maillage 3D, si la coloration ne suffit pas

La voie 1 — colorer les points du nuage par la couche de relief courante — est
faite ; voir « Le relief dans le nuage ». Reste la voie 2, un vrai chantier : un
maillage de terrain de 4 M de sommets, niveau de détail, zones sans sol connu,
plusieurs sessions de travail. À ne lancer que si la coloration des points se
révèle insuffisante à l'usage réel — pas avant, et pas par principe.

### #4 — Vignettes par détection et export du relief

La **vignette** est le plus utile : un carré de relief d'environ 60 × 60 m
centré sur le candidat, dans la liste des résultats à côté du score et joint à
l'export. Elle répond à la seule question qui compte devant douze candidats —
lequel vaut deux heures de marche — là où il faut aujourd'hui basculer en 3D et
viser, un par un. Question à trancher en regardant : sur une cabane, la
vignette tirée du MNT comblé sera lisse ; c'est peut-être l'information
(« l'algorithme voit un trou dans le sol ici »), sinon la calculer sur un MNS ou
afficher les deux.

Puis l'**image de dalle** : PNG + world file `.pgw` + `.prj` en EPSG:2154,
~20 lignes, aucune dépendance — la grille *est* en Lambert-93, donc ça s'ouvre
calé au pixel dans QGIS.

Deux choses **écartées après discussion**, à ne pas rouvrir sans raison neuve :

- **pas de polygone d'emprise** — à ~4 points sol/m², la couronne de murs d'une
  cabane de 6 × 4 m ne donne qu'une quarantaine de points : ça établit une
  présence, pas un contour. Le GeoJSON porte déjà surface, longueur, largeur et
  azimut avec leur imprécision assumée ; un polygone n'ajouterait qu'une autorité
  que la donnée n'a pas. L'outil sort des **pistes**, le format doit le dire.
- **pas de MBTiles** — il faudrait embarquer sql.js (~1 Mo de WASM, le traitement
  réservé à laz-perf) pour un fichier que peu d'applications lisent.

En réserve, seulement si l'image se révèle utile sur le terrain : KMZ. Piège à ne
pas manquer alors — `<gx:LatLonQuad>` et non `<LatLonBox>` : un carré Lambert-93
est tourné d'environ 1° en WGS84 dans les Pyrénées, soit une vingtaine de mètres
de décalage en travers d'une dalle. Même piège que `L.rectangle`.

### #5 — Choisir la dalle d'exemple *(gain rapide — débloque #6 et la publication)*

**Le mécanisme est fait**, testé de bout en bout en navigateur réel : « Voir un
exemple » sélectionne et charge tout seul la dalle de
`CONFIG.carte.dalleExemple` (deux nombres — les mêmes indices que le lien
partageable `#d=x,y`) et atterrit en 2D sans écran intermédiaire ni clic
supplémentaire. Changer d'exemple ne touche qu'à ces deux nombres, rien
d'autre. L'ancien écran d'annonce (`accueil-exemple`) a été retiré, devenu
sans objet.

Un candidat forêt (553, 6280) a été essayé et vérifié en conditions réelles :
réseau de sentiers net et dense sous une photo qui ne montre que des arbres,
aucune habitation — le critère « vérifiable » et « sous couvert forestier »
tiennent bien. Mais un coin de la dalle (conifères plus denses, donc moins de
retours sol) produit un amas d'étoiles à huit branches — l'artefact documenté
des cellules sans donnée (« Une cellule sans donnée doit être écartée du
balayage »), pas un bug, mais visible dans la vue par défaut qui cadre toute
l'emprise. Pas disqualifiant en soi, mais à trancher avant de figer le choix :
soit une zone plus homogène, soit recadrer la vue par défaut sur la partie
nette plutôt que sur l'emprise entière. Reste donc à choisir la dalle
définitive — cette forêt, une autre, ou les cabanes de montagne écartées en
discussion (structures moins alignées avec la nouvelle accroche « explorer »,
mais plus immédiatement lisibles).

Critères déjà arrêtés — à ne pas confondre avec le contrôle positif, qui relève
de la vérité terrain et peut rester privé :

- **aucune habitation.** Règle, pas préférence : un outil qui cherche du bâti
  hors carte ne pointe pas par défaut sur le domicile de quelqu'un ;
- de préférence **sous couvert forestier** — l'orthophoto ne montre que des
  arbres et le SVF montre terrasses, chemins creux, charbonnières : la
  démonstration s'administre toute seule ;
- **vérifiable** vaut mieux qu'inédit : les liens Google Earth, Maps et
  Géoportail sont déjà générés depuis l'outil ;
- micro-relief anthropique **dense** plutôt qu'une belle pièce isolée ; les
  charbonnières sont particulièrement rentables ;
- la détection doit y rendre une poignée de candidats, pas deux cents ;
- **ne rien revendiquer comme validé** : `CLAUDE.md` dit qu'aucun contrôle
  positif n'existe et doit continuer à le dire.

### #6 — Passage de robustesse et captures du README

Robustesse sur les chemins qu'un inconnu emprunte : connexion coupée en plein
chargement (vérifier qu'Annuler retombe sur ses pieds), rafale de 429, zone
sans LiDAR, double chargement et changement de dalle en cours de
téléchargement. Vérifier que Pages sert bien la version publiée **et** que le
double-clic sur `index.html` marche toujours. `npm test` au vert.

Deux ou trois captures dans le README — la carte, le nuage colorisé, une
détection avec sa fiche — **dépendent de #5** : c'est la dalle d'exemple, en
2D, qui doit être photographiée.

Où poster ensuite : Géorezo, forum OSM France, SIG francophone sur Mastodon,
forums d'archéologie et de patrimoine (pierre sèche), r/geomatique. Wikipedra et
le PNR des Pyrénées ariégeoises sont les interlocuteurs naturels — eux peuvent
fournir des coordonnées de ruines connues, c'est-à-dire le contrôle positif qui
manque.

### #7 — La photo aérienne coûte cent tuiles, peut-être pour rien

Passer sur l'onglet 2D redemande **cent tuiles** au WMTS pour rendre la photo
dans la grille — mesuré de 5 s à 65 s selon l'humeur de la passerelle, sur la
même machine et les mêmes tuiles. Or la carte vient d'en afficher, de la même
couche et du même service. L'impression que ça charge beaucoup pour peu est
fondée ; reste à savoir laquelle des trois pistes rend le plus.

- **Réutiliser les tuiles que Leaflet a déjà.** Elles sont dans le DOM, en
  `<img>`. Piège à connaître avant de commencer : une image dessinée dans un
  canevas **souille** celui-ci et `getImageData` lève ensuite une
  `SecurityError` — sauf si la couche a été créée avec `crossOrigin`, ce qui
  n'est pas le cas aujourd'hui. Et la limite est ailleurs : la carte affiche la
  zone au zoom 14 ou 15 quand on choisit une dalle, la grille en demande 18. Les
  tuiles utiles ne sont là que si l'on a zoomé à fond sur la dalle avant de la
  charger, ce qui n'est pas le geste courant.
- **Se demander si le zoom 18 est nécessaire.** Il est choisi comme le premier
  niveau dont le pixel au sol tient dans le pas de la grille (0,44 m pour 0,50 m).
  Le 17 coûterait **quatre fois moins** — 25 tuiles — pour 0,88 m au sol. La
  photo n'est que du contexte ; la question est de savoir si elle reste lisible
  quand on zoome sur une cabane, et ça se tranche en regardant.
- **Charger en deux temps**, ce qui est sans doute la vraie réponse : une passe
  grossière (zoom 15, quatre tuiles) posée tout de suite, puis le zoom 18 par
  dessus quand il arrive. L'attente ne serait pas raccourcie, elle
  disparaîtrait — c'est exactement ce que fait n'importe quelle carte glissante,
  et ça se marie avec #8.

Ce qui ne change pas quelle que soit la piste : les tuiles restent en Web
Mercator et doivent être rééchantillonnées dans la grille Lambert-93. On
n'économise que le réseau, jamais la géométrie.

### #8 — Un chargement qu'on voit

Le téléchargement d'une dalle est **le moment le plus long de l'outil** — une
trentaine de secondes à pleine résolution — et c'est celui qui montre le moins.
Aujourd'hui il n'existe que par deux choses : une barre de progression fine dans
le panneau de gauche (`#barre-progression`), et un compteur qui défile dans le
coin haut droit (`statut()`, « Téléchargement 12/24 — 3 210 000 points »). Qui ne
regarde ni l'un ni l'autre ne voit pas que ça travaille.

C'est le même raisonnement que le voile d'attente (fait, voir « Voile
d'attente ») : **une page qui ne montre rien se lit comme une page figée**, et
l'utilisateur relance ou ferme. Sauf que le cas n'est pas le même, et c'est ce
qui rend la solution différente :

- le voile couvre un calcul **synchrone**, il est modal, et il ne peut animer que
  `transform` ou `opacity` sous peine de se figer avec le reste ;
- le téléchargement, lui, est **asynchrone** : le fil principal reste libre, on
  peut donc animer ce qu'on veut, et surtout il doit **rester annulable** — le
  bouton « Annuler » existe déjà et doit continuer d'être atteignable.

Ce qu'on peut afficher est déjà mesuré et remonté par `surAvancement` : blocs
faits sur blocs attendus, points décodés. Le coût total en mégaoctets est connu
avant de commencer, il est même affiché sous le curseur de résolution.

À trancher en regardant, pas en raisonnant : barre large et lisible plutôt que
filet, pourcentage, volume en mégaoctets, et **où** — la vue d'arrivée est
désormais la 2D, c'est peut-être là que le chargement doit se voir plutôt que
dans le panneau.

Un piège à ne pas ignorer si l'idée d'un temps restant vient : **le débit de
l'IGN varie d'un facteur cinq**. Mesuré sur les cent tuiles d'une même photo
aérienne, depuis la même machine : 6,5 s une fois, 29,6 s une autre. Une
estimation qui saute de « 8 s » à « 2 min » est pire que pas d'estimation.
