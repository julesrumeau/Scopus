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

**6 tâches restent.** Les deux marquées *(prioritaire)* sont les seules dont
l'issue est incertaine — tout le reste est du travail dont la forme est déjà
connue.

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

Premier point en faveur de l'option 3 : une ruine réelle connue de l'utilisateur,
peu visible sur le terrain, se lit sans ambiguïté dans le relief calculé — sans
détecteur. Un seul cas ne tranche pas encore ; ne rien décider tant que la
lecture visuelle n'a pas été pratiquée sur plusieurs dalles, c'est elle qui dira
si un détecteur manque vraiment.

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

### #3 — Vignettes par détection et export du relief

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

### #4 — Passage de robustesse et captures du README

Robustesse sur les chemins qu'un inconnu emprunte : connexion coupée en plein
chargement (vérifier qu'Annuler retombe sur ses pieds), rafale de 429, zone
sans LiDAR, double chargement et changement de dalle en cours de
téléchargement. Vérifier que Pages sert bien la version publiée **et** que le
double-clic sur `index.html` marche toujours. `npm test` au vert.

Deux ou trois captures dans le README — la carte, le nuage colorisé, une
détection avec sa fiche : la dalle d'exemple est maintenant fixée (Bois des
Caures, Verdun, `#d=877,6904`), il ne reste qu'à la photographier en 2D.

Où poster ensuite : Géorezo, forum OSM France, SIG francophone sur Mastodon,
forums d'archéologie et de patrimoine (pierre sèche), r/geomatique. Wikipedra et
le PNR des Pyrénées ariégeoises sont les interlocuteurs naturels — eux peuvent
fournir des coordonnées de ruines connues, c'est-à-dire le contrôle positif qui
manque.

### #5 — La photo aérienne coûte cent tuiles, peut-être pour rien

**Essayé et revenu en arrière.** Le zoom avait été abaissé à 17 pour la photo
seule (132 tuiles → 36) : comparé côte à côte sur un recadrage de 250 m, la
différence semblait mineure, mais à l'usage réel la perte de qualité s'est
révélée trop marquée — l'auteur a demandé de revenir au zoom 18. La leçon à
garder : un recadrage isolé ne suffit pas à juger, il faut l'avis sur l'usage
réel avant de trancher un compromis qualité/vitesse. Ne pas réessayer le zoom
17 sans nouvelle raison.

Les deux autres pistes, écartées ou repoussées :

- **Réutiliser les tuiles que Leaflet a déjà** — écartée. Une image dessinée
  dans un canevas **souille** celui-ci (`getImageData` lèverait une
  `SecurityError` sans `crossOrigin`, absent aujourd'hui), et surtout la carte
  affiche la zone au zoom 14-15 quand on choisit une dalle, la grille en
  demande 17-18 : les tuiles utiles ne sont là que si l'on a zoomé à fond avant
  de charger, ce qui n'est pas le geste courant.
- **Charger en deux temps** (une passe grossière posée tout de suite, la fine
  par-dessus quand elle arrive) reste la vraie réponse : elle ne sacrifie
  aucune qualité, contrairement au zoom abaissé — l'attente ne serait pas
  raccourcie, elle disparaîtrait. C'est un chantier réel (voir la description
  plus haut, restructurer `sourcePhoto`/`appliquerCote` pour deux passes avec
  garde anti-course aux deux étapes), mais c'est la piste qui n'a pas encore
  été essayée pour de vrai.

Ce qui ne change pas : les tuiles restent en Web Mercator et doivent être
rééchantillonnées dans la grille Lambert-93. On n'économise que le réseau,
jamais la géométrie.

### #6 — Rendre l'outil vraiment responsive

Un seul point de rupture existe aujourd'hui (`@media (max-width: 900px)`) : le
panneau passe au-dessus de la scène au lieu d'à côté. Jamais vérifié à une
vraie largeur de téléphone, contrairement à l'accueil — testé, lui, à 380 px
via iframe (la fenêtre de Chrome headless ne descend pas plus bas). Les
curseurs de seuils, les boutons d'export, la carte et le rideau de
comparaison n'ont aucune garantie de rester utilisables en dessous de 900 px.

Ce qui existe déjà et compte pour beaucoup : le garde-fou mobile
(`budgetOctetsMobile`) plafonne la résolution par défaut et avertit au-delà —
le cas le plus coûteux, charger 190 Mo sur un forfait limité, est déjà traité.
Ce qui reste, c'est la mise en page elle-même : tient-elle à l'écran, les
zones tactiles sont-elles assez grandes, le rideau se glisse-t-il au doigt
comme à la souris.

À vérifier avant de corriger quoi que ce soit — même piège que pour l'accueil :
tester en iframe, pas en rétrécissant la fenêtre du navigateur.
