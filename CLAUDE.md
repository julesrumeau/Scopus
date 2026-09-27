# CLAUDE.md — Scopus

Document de référence architectural. À destination de tout développeur (ou IA)
intervenant sur le projet.

---

## Présentation

Outil web personnel d'exploration du LiDAR HD de l'IGN, utilisable partout en
France — pas seulement en Ariège et dans les Pyrénées, où le projet est né. Il
calcule et affiche le relief caché sous la végétation — ombrage, micro-relief,
Sky-View Factor, ouverture — et le compare à la photo aérienne : cabanes,
ruines, sentiers, terrasses s'y lisent à l'œil, sans qu'aucune détection ne
soit nécessaire pour les voir.

Une détection automatique existe aussi, destinée à repérer des structures
absentes des cartes — ruines et cabanes en pierre sèche. Par **règles
géométriques explicites**, sans apprentissage : chaque rejet doit rester
explicable, sans quoi les seuils ne peuvent pas être réglés, seulement subis.
Elle est aujourd'hui **masquée dans l'interface** — voir « La détection
automatique est masquée » plus bas : elle existe et passe ses tests, mais n'a
jamais été confrontée à une structure réelle connue. La détection de
sentiers, chaîne distincte décrite plus loin, l'est aussi : brièvement
exposée pour recueillir des retours sur de vraies dalles, elle a corrigé un
bogue réel mais pas convaincu au-delà, et reste masquée en attendant un
chemin connu pour se calibrer.

---

## Contraintes structurantes

Quatre contraintes expliquent la quasi-totalité des choix techniques :

1. **Ouverture par double-clic, sans serveur ni commande.** Comme FlowField.
   C'est la contrainte la plus structurante — voir la section suivante.
2. **Rien côté serveur.** Aucun backend, aucune base, aucun compte. Publiable
   tel quel sur GitHub Pages : le dépôt *est* le site.
3. **Aucune étape de construction.** Un `git push` suffit à déployer. Seule
   exception : `vendor/lazperf/lazperf-embarque.js` est généré, une fois, par
   `tools/embarquer-lazperf.js`.
4. **Le volume de données est le problème central.** Une dalle fait ~190 Mo pour
   ~30 M de points. Toute l'architecture de chargement découle de là.

Une seule entorse volontaire à « rien n'est envoyé ailleurs » : un compteur de
visites [GoatCounter](https://www.goatcounter.com), une balise dans `<head>`,
sans cookie ni donnée personnelle. Ce n'est pas un backend du projet — aucune
donnée LiDAR ni résultat de détection ne quitte jamais l'onglet, c'est
toujours vrai — juste une visite anonyme comptée par un tiers. La ligne de
crédit dans l'app le dit.

## Vivre en `file://`

Une page ouverte depuis le disque a l'origine « null ». Relevé exact, mesuré sur
Chrome 151 (`.tmp/sonde.html`, à refaire en cas de doute plutôt qu'à croire) :

| Capacité | En `file://` | Conséquence |
|---|---|---|
| **`fetch` distant vers un service en CORS `*`** | **✅ marche** | Aucun proxy, aucun serveur : toutes les données IGN arrivent directement |
| **Requête de plage `206`** | **✅ marche** | C'est le point dont tout dépend — le lecteur COPC fonctionne tel quel |
| WebGL2 | ✅ marche | Rendu du nuage inchangé |
| Worker depuis une URL **blob** | ✅ marche | Décompression multi-cœurs conservée |
| `<script type="module">` **inline** | ✅ marche | — |
| `<script type="module" src="…">` + `import` | ❌ refusé | → scripts classiques exposant des globaux |
| `fetch` / `XHR` d'un **fichier local** | ❌ refusé | → laz-perf embarqué en chaînes, passé en `wasmBinary` |
| `new Worker("file://…")` | ❌ refusé (« origin null ») | → worker monté depuis une URL blob |

Le point à retenir, parce qu'il est contre-intuitif : **le réseau n'est pas le
problème**. `fetch` vers l'IGN marche parfaitement en statique, requêtes de
plage comprises. Seule la lecture du **disque local** est fermée — d'où les
seules contorsions du projet, toutes concentrées sur le chargement de laz-perf
et le montage du worker.

Nuance utile : un module ES *inline* s'exécute, seul l'`import` entre fichiers
est refusé. Tout regrouper dans un unique `<script type="module">` inline serait
donc possible — mais ferait perdre le découpage en fichiers pour aucun gain.

Conséquence sur la façon d'écrire le code : les scripts partagent
l'environnement lexical global, donc un `const` du premier niveau est visible
depuis les fichiers suivants — mais **n'est pas** une propriété de `window`.
Écrire `window.CONFIG` ne marche pas ; `CONFIG` marche.

## Ce qui a été repris de FlowField

| Élément | Origine | Statut |
|---|---|---|
| `compile`, `program` (avec pré-résolution des uniforms) | `src/gl.js` | Repris tel quel |
| `createTarget`, `perspective`, `lookAt`, `multiply`, `hexToRgb` | `src/gl.js` | Repris tel quel |
| Objet `CONFIG` unique comme source de vérité, commenté valeur par valeur | `src/config.js` | Repris comme principe |
| Scripts classiques exposant des globaux, chargés dans l'ordre | `index.html` | Repris, même motif : `file://` |

Non repris : `grid` et `fullscreenTriangle` (propres aux isolignes), le bruit de
Perlin, le bloom, tout le pipeline de post-traitement.

Le piège **« pas de backtick dans un commentaire GLSL »** documenté chez
FlowField s'est reproduit ici à l'identique, dans `shaders.js` : les shaders
vivent dans des template literals, un backtick dans un commentaire termine la
chaîne et l'erreur remonte très loin de sa cause (`Unexpected identifier`).

De même, la contrainte « aucun module ES, aucune dépendance CDN » de FlowField
s'applique mot pour mot ici. Ne pas convertir en modules : ça casse l'ouverture
en `file://`, qui est la raison d'être de l'architecture.

---

## Chargement : pourquoi COPC change tout

Les dalles LiDAR HD sont diffusées en **COPC** — un LAZ dont les points sont
rangés dans un octree, avec la table des nœuds écrite dans le fichier. Deux
propriétés du service `data.geopf.fr`, vérifiées et non supposées, rendent
l'exploitation directe possible depuis un navigateur :

- `access-control-allow-origin: *` sur le WFS **et** sur le téléchargement ;
- `accept-ranges: bytes`, avec un vrai `206` sur requête de plage.

D'où la séquence : en-tête (64 Ko) → hiérarchie (47 Ko) → seuls les nœuds qui
intersectent la zone. Sur la dalle de test, l'index complet coûte 48 Ko contre
187 Mo pour le fichier entier.

Deux points appris à l'usage :

- **La hiérarchie tient en une page** sur toutes les dalles IGN observées
  (1 470 nœuds, 47 Ko, aucun renvoi de sous-page). Le code suit quand même les
  renvois — la spec les autorise et une dalle plus dense en produirait.
- **La passerelle annonce `x-ratelimit-limit-second: 1`.** Elle encaisse en
  pratique des rafales bien plus larges, mais charger une zone demande des
  centaines de requêtes : `reseau.js` borne le parallélisme et réessaie les
  429/5xx. Un nuage tronqué par un refus silencieux ne se voit pas à l'œil.

`selectionner()` retient un niveau d'octree **en entier ou pas du tout**.
Accepter un niveau à moitié produirait un nuage dont une part est fine et
l'autre grossière, avec une frontière visible et une détection faussée le long
de cette frontière.

Chaque niveau divise l'espacement par deux — le compromis résolution/volume
qu'expose le curseur *Résolution*, pour une dalle entière (1 km²) :

| Niveau | Espacement | À télécharger |
|---|---|---|
| 1 | 3,4 m | 7 Mo |
| 2 | 1,7 m | 27 Mo |
| 3 | 85 cm | 70 Mo |
| 4 | 43 cm | 137 Mo |
| 5 | 21 cm | 185 Mo |

### Le worker : pour la fluidité, pas pour la vitesse

Mesuré en navigateur sur 261 000 points (26 blocs), avec et sans worker :

| | Gel le plus long de l'interface |
|---|---|
| avec workers (URL blob) | **54–64 ms** |
| repli fil principal | **188–193 ms** |

Reproduit sur deux manipulations indépendantes. C'est le seul écart robuste.

Sur les **durées totales**, la comparaison ne vaut rien et il ne faut pas s'y
fier : la même configuration de repli a été mesurée à 4,6 s puis à 14,2 s. Le
débit bridé de l'IGN domine tout, et sa variance dépasse largement l'effet
cherché. **Le facteur limitant du chargement est le réseau, pas le CPU.**

Deux hypothèses ont été formulées puis écartées par la mesure, à ne pas
reprendre :

- « le repli est plus rapide » — artefact : la seconde exécution profitait du
  cache HTTP rempli par la première ;
- « le démarrage de la grappe pèse sur le premier chargement, il faut le
  préchauffer » — faux : le démarrage complet coûte **22 ms**. Le préchauffage
  a été écrit puis retiré.

### Rastériser au vol, ne rien garder

L'unité d'analyse est la **dalle entière**, 1 km². Un sous-carré de 250 m était
trop petit pour y chercher quoi que ce soit.

Ce qui rend le kilomètre carré tenable : les points ne sont jamais conservés.
Chaque bloc décodé est versé dans les grilles (`RASTER.accumuler`) puis
abandonné ; seuls les niveaux d'octree grossiers sont retenus pour l'aperçu 3D.
La détection ne lit que les grilles, dont la taille ne dépend que de l'emprise.

Sans cela, 39 M de points demanderaient 745 Mo de tableaux et 708 Mo de VRAM.
Avec, le tas monte à 405 Mo sur une dalle complète à 25 cm — mesuré.

Les grilles ont été dégraissées en conséquence : `vegN` supprimée (jamais lue),
compteurs en octets plutôt qu'en mots de 16 bits, pente en degrés entiers. 21
octets par cellule au lieu de 30. Le comblement du MNT écrit **sur place** et ne
double que la validité, en octets.

Ne pas y réintroduire un tableau par cellule sans compter : à 16 M de cellules,
chaque `Float32Array` supplémentaire coûte 64 Mo.

### Groupement des requêtes

Le facteur limitant du chargement n'est pas le volume mais le **nombre de
requêtes**. Interroger les 1554 nœuds d'une dalle séparément se solde par un
`HTTP 429` — vérifié, le limiteur de l'IGN coupe avant la fin.

Les nœuds étant rangés bout à bout dans le fichier (0,00 Mo perdu sur 184,5 Mo),
`grouperPlages` les fusionne : **1554 requêtes → 24**. Le redécoupage à 8 Mo est
délibéré — une réponse unique de 185 Mo priverait de toute progression et
retarderait le décodage jusqu'au dernier octet.

### Octets compressés retenus

Née d'un constat pénible : le panneau « Classes du sol » (plus bas) rejoue un
chargement complet à chaque « Mettre à jour », et le pari initial — que le
cache HTTP du navigateur resservirait les mêmes plages sans repasser par le
réseau — s'est révélé faux à l'usage (« ça retélécharge à chaque fois, c'est
chelou »). Et derrière ce constat, une inquiétude plus large de l'utilisateur :
dépendre d'un service tiers dont la lenteur est hors de son contrôle, et qui
punit doublement quiconque a une mauvaise connexion.

`nuage.js` retient donc les octets **compressés** (pas décompressés) de chaque
plage groupée, pour une dalle à la fois — `cacheOctets = { url, plages: Map }`,
remplacé dès qu'une dalle différente se charge, vidé explicitement par
`fermerNuage()`. Un second `charger()` sur les mêmes plages (même dalle, même
résolution — exactement ce que fait « Mettre à jour ») saute le réseau et
repart directement de la décompression locale.

**Rien à transférer en plus pour l'obtenir.** Dans la boucle de `charger()`,
chaque nœud reçoit déjà une **copie** indépendante de son tronçon
(`octets.slice(...)`) avant de la céder au worker, qui lui prend possession du
tampon transféré — le tampon de la plage entière, `octets`, n'était jamais
transféré, seulement laissé au ramasse-miettes une fois la tâche finie. Le
garder est un changement de portée, pas une copie de plus : le coût mémoire
est borné à ce que le curseur *Résolution* annonce déjà avant de charger
(jusqu'à 185 Mo à pleine résolution) — pas un multiple caché, contrairement à
l'option « tout garder » (+745 Mo de points décompressés, 3,5× le tas actuel)
ou même l'option intermédiaire à une statistique par classe (+80 Mo par classe
suivie).

**Mesuré en conditions réelles, pas supposé** (`.tmp/test-cache-octets.html`,
`.tmp/run-edge.js` — non versionnés), sur la dalle de Beille, une zone de
100 × 100 m, niveau 2, 12 nœuds groupés en une seule plage de 12,65 Mo :

| | Durée | Octets resservis |
|---|---|---|
| 1er chargement | 5 262 ms | 0 |
| 2e chargement (même zone) | **841 ms** | **12 652 490 / 12 652 490** |

Soit 6,3× plus rapide, et **100 % des octets resservis** — aucune plage
manquante. C'est la réponse chiffrée à l'inquiétude qui a motivé cette
branche : le coût qui restait — le réseau IGN, hors de tout contrôle — devient
optionnel dès le second chargement d'une même dalle.

Branché : `chargerNuage()` affiche les octets resservis dans la progression et
le message de fin, et `fermerNuage()` appelle `NUAGE.viderCacheOctets()` pour
que « Fermer le nuage » libère aussi ce cache-là. Prototypé sur la branche
`experiment/octets-compresses`, adopté sur `main` après ces mesures.

### Répartition du travail

Le fil principal garde la main sur les requêtes HTTP (file bornée, réessais) et
n'envoie aux workers que des octets déjà en mémoire. Les workers ne font que
décompresser — quelques secondes de CPU pur sur une zone dense, qui figeraient
l'onglet si elles restaient sur le fil principal.

Les coordonnées sont ramenées à une origine locale **avant** conversion en
Float32 : en Lambert-93 les Y valent 6,2 millions, ce qu'un flottant 32 bits ne
résout qu'à ~0,5 m.

---

## Le chargement piloté par la vue

`flux.js` charge les points **de la vue**, sans dalle à choisir : les dalles du
rectangle affiché, ouvertes d'une requête chacune, puis les blocs plus fins que
le zoom demande. Il a remplacé « Charger la dalle » : c'est la vue par défaut
(l'ancien parcours reste derrière `?dalle`) ; `&debug` ajoute un calque
(`flux-calque.js`) qui dessine les contours des blocs chargés. Conception complète :
`docs/superpowers/specs/2026-09-26-flux-vue-design.md` ; ce qui suit est ce que
le code en a appris.

**Une requête par dalle : la fin du fichier.** L'IGN range ses COPC du plus fin
au plus grossier — `[en-tête][niveau 5 … niveau 1][niveau 0][index][~830 o]`,
identique sur 12 dalles de toute la France. `Range: bytes=-1000000` ramène donc
l'index **et** le niveau 0 (0,86 Mo au plus mesuré ; relecture à 4 Mo en
secours). Sans l'en-tête, l'index se retrouve en cherchant, depuis la fin,
l'EVLR `copc` / 1000 (`COPC.lireFin`). La longueur d'un point varie **par lot de
publication** (30 octets, 46 pour le lot d'avril 2026) : 256 octets d'en-tête
une fois par lot, lot lu dans l'adresse du fichier, demandé **dès la première
ouverture** — demandé après la première réponse, il passait derrière toutes les
fins de fichier de la file, et aucun bloc ne se décodait avant ~11 s.

**En navigateur, la taille du fichier est invisible.** L'IGN n'expose pas
`Content-Range` aux pages web (pas d'`Access-Control-Expose-Headers`) : le
navigateur le masque, et `RESEAU.recuperer({ fin })` rend `total: null` sur un
`206`. Or il faut savoir où tombe la fin reçue dans le fichier pour y lire le
niveau 0. L'ancre : juste après le dernier bloc de points, un LAZ range sa table
des blocs, qui commence par 4 octets nuls puis **le nombre de blocs** — égal au
nombre de nœuds de l'index sur 7 dalles sur 7. La fin absolue du dernier bloc se
lit dans l'index ; retrouver la signature dans les octets reçus donne leur
position. Le test simulé fournissait la taille, le navigateur non : c'est la
vérification sur données réelles qui l'a montré (niveau 0 redemandé au réseau,
premier bloc à 12–16 s).

**Le quota.** L'API de téléchargement est limitée à 10 requêtes/s par IP ;
mesuré ~4,5 dalles/s pour la fin de fichier. Au-delà d'une **surface affichée** de
60 km² (`CONFIG.flux.surfaceMaxPointsKm2`, environ 10 km de large sur un écran
16/10), rien n'est demandé : le niveau 0 est un plancher (~0,6 Mo, 25 000 à
80 000 points par dalle, un bloc LAZ ne se lit pas en partie) et le temps
croîtrait avec le nombre de dalles, plus avec l'écran. La surface et non le zoom
ni la largeur : c'est elle qui fixe le nombre de dalles, et une même largeur
couvre deux fois plus de terrain sur un écran deux fois plus haut. Elle
s'affiche avec `&debug`, pour régler le seuil à l'usage.

**Quels blocs, dans quel ordre.** Le pas suit le pixel au sol, jamais sous
`pasMinM` ; le niveau visé est le plus grossier dont la densité cumulée atteint
`pointsParCase` points par case. Ordre : **niveau croissant, puis distance au
centre** — tout l'écran atteint un niveau avant que le suivant ne commence
(l'ordre de Potree), et la liste est **tronquée au budget** de points : un bloc
au-delà n'est pas demandé, ce qui évite de le libérer puis de le redemander.
Au-dessus du budget, on libère d'abord les blocs non voulus les plus fins et les
plus loin.

**Un niveau entier avant le suivant.** L'ordre de la file ne suffisait pas :
elle ne connaît que les dalles déjà ouvertes, et le niveau 1 d'une dalle
partait pendant que ses voisines attendaient encore leur fin de fichier ; de
même, la fin d'un niveau laissait des places libres au suivant. Retour
d'usage, sur le calque `&debug` : du vert (niveau 1) avant la fin du bleu
(niveau 0), et ce détail perdu au moindre déplacement. `pomper` ne sert donc
que le **niveau en cours** — le plus grossier dont un bloc voulu n'est pas
arrivé, 0 tant qu'une dalle visible n'a pas livré sa fin de fichier. Prix
mesuré : rien au zoom 16 (22 à 25,6 s, bruit du réseau), ~1 s de plus au zoom
18 (~12 s contre 10,8), où les niveaux se succèdent plus souvent.

**Une file de priorité, pas une file d'arrivée.** Les blocs à télécharger
passent par une file unique, triée par ce rang et recalculée à chaque vue : au
plus `plagesEnVol` plages à la fois (3), toujours celle du bloc le plus
prioritaire, bornées à `plageMaxOctets` (2 Mo). Avant, les blocs partaient par
dalle entière (les quatre quarts en une plage de ~7 Mo), dans l'ordre où les
dalles s'ouvraient : l'arrivée paraissait aléatoire (retour d'usage). Mesuré
après : les quarts arrivent à 354 m du centre, puis 791, 1 061, 1 275 m. C'est
le débit, pas le quota de requêtes, qui fixe la durée : mesuré le 27 septembre
2026 depuis la machine de l'utilisateur, la ligne plafonne vers 3,4 Mo/s
(Cloudflare et OVH comme l'IGN) ; une requête IGN seule en tire ~2 Mo/s, 3 en
vol 2,4 Mo/s, 5 à 10 en vol la ligne pleine. D'où 5 en vol
(`plagesEnVol`, et la file de `reseau.js`). Le quota ne mord que les petites
requêtes : sous ~500 Ko, des dizaines de 429 ; au-dessus, aucun.

**Seules les couches lues.** Un bloc LAZ 1.4 est compressé en couches rangées
bout à bout — XY, Z, classe, drapeaux, intensité, angle, utilisateur, source,
temps GPS, octets supplémentaires —, et le relief ne lit que les quatre
premières : 49 à 66 % du bloc, 60 % en moyenne (4 lots, 530 blocs). Un bloc
d'au moins `coupeMinOctets` part donc seul, et seul son début est demandé
(`fractionCoupe`, 68 %) ; l'en-tête du bloc dit où couper, et le reste des
couches lues est redemandé dans les rares cas où il dépasse
(`COPC.tailleUtileBloc`). Le bloc est ensuite **réduit** (`COPC.reduireBloc`) :
les autres couches y sont déclarées vides, ce que laz-perf décode sans erreur
— XYZ et classes identiques au point près, vérifié sur les lots à 30 et à 46
octets par point. Le cache disque garde le bloc réduit. Les petits blocs
restent groupés entiers, pour le quota. Les points arrivent dans l'ordre du
vol (temps GPS croissant) : un début de bloc est une bande, pas un
échantillon — un aperçu par « x % d'un bloc » n'est pas possible.

Prix : l'intensité n'est plus téléchargée, et la couleur « Intensité » est
retirée de la 3D de la vue (elle reste derrière `?dalle`, qui télécharge les
blocs entiers). Gain mesuré dans Chromium, profil vierge, vue de Verdun au
zoom 16 : 118 Mo en 40 à 46 s avant, 83 Mo en 23,5 s après (coupe et 5 en
vol), soit 1,8 fois plus rapide ; aucun 429, y compris au zoom 18. Un bloc se décode **dès que ses octets sont là** — la fin de fichier
et le cache d'abord, chaque plage réseau à son arrivée : tout attendre faisait
patienter le niveau 0 du centre derrière les 7 Mo du niveau 1 de sa dalle.

**Centimètres entiers.** Les workers rendent les coordonnées en centimètres
entiers relatifs au coin de la dalle (`entiers`, `xc/yc/zc`) : échelle 0,01 et
décalage 0 chez l'IGN, la conversion est exacte, et l'affectation d'un point à
une case ne dépendra plus d'un arrondi de flottant (0,03 % des cases
différaient sinon entre processeur et carte graphique).

**L'emprise d'un bloc sans l'en-tête.** Le cube de l'octree est dans l'en-tête,
qu'on ne lit plus ; il coïncide avec la dalle (demi-côté 500 m, centré). Vérifié
en navigateur sur la vue de Verdun : 14,9 M de points décodés, **aucun** hors de
l'emprise calculée de son bloc. Si une dalle y dérogeait, ses blocs seraient
placés au mauvais endroit sans erreur : c'est le contrôle à refaire au moindre
doute.

**Le cache disque** (`cache-disque.js`, IndexedDB) garde les octets compressés
des blocs **et** les fins de fichier, sous `quotaDisqueOctets`, le moins
récemment lu effacé d'abord. Il ne fait jamais échouer un chargement :
navigation privée ou quota atteint, il se tait et le réseau sert.

Mesuré sur la vue de Verdun (~3 km de large, 15 dalles, 63 blocs, 14,9 M de
points), Chromium, depuis le chargement de la page : première visite, premier
bloc à 4,4 s et tout chargé en ~35 s ; seconde visite, premier bloc à 1,8 s,
aucune fin de fichier redemandée, 2 requêtes de plage au lieu de 27.

## Le calcul de la vue

`vue-relief.js` calcule le relief de ce qui est à l'écran à partir des blocs que
`flux.js` livre : grille de la vue, rangement des points, terrain, surface
affichée, puis la couche par `RELIEF.calculer`, inchangé. Le résultat se pose
sur la carte derrière un rideau (`CalqueRelief`), en image déjà reprojetée
par le worker (voir plus bas). Conception :
`docs/superpowers/specs/2026-09-26-flux-vue-design.md`, section « 2. Le calcul ».

**La grille est en centimètres entiers** (`VUE_GRILLE`) : son coin est un
multiple du pas, les points arrivent en centimètres entiers, et la case d'un
point est une division entière — la même au processeur (`RASTER.accumulerCm`)
et sur la carte graphique, au point près, y compris pile sur une limite. Le
pas suit le pixel au sol (jamais sous 50 cm), la grille couvre la vue plus la
plus grande portée des couches (`VUE_GRILLE.marge`, ~40 m) ; comblement et
lissage sont réglés **en mètres** (`comblementM`, `lissageM`) pour garder leur
sens à tous les pas.

**Deux chemins, une référence.** `VUE_RELIEF.surfaceCPU` enchaîne
`RASTER.creerGrillesVue`, `accumuler`, `finaliser` et `RELIEF.preparer` au pas
même de la grille (`garderRepli` : une case sans sol garde l'altitude que le
terrain lui a donnée, ce que la carte graphique produit sans rien calculer de
plus). `GPU_RELIEF.surfaceVue` fait la même chose sur la carte : six passes de
points sans `EXT_float_blend` (profondeur pour le sol minimal, le minimum et le
maximum de tous ; `RGBA8` additif pour les comptes ; `RGBA16F` additif pour les
hauteurs au-dessus du minimum), puis le terrain et la surface, et **un seul
rapatriement**, celui de la surface. À la taille d'un écran il coûte quelques
millisecondes, et il laisse les couches existantes intactes.

Rien ne sort de la carte sans **autocontrôle** (`VUE_RELIEF.controleGPU`) :
des points d'essai pile sur les limites, deux dalles à 600 m d'écart
d'altitude, un mur non classé sans sol dessous, un arbre au-dessus du plafond,
du bâti, de l'eau, un grand trou. Tolérances mesurées sur la carte AMD
intégrée : la profondeur rend l'altitude du sol au centième de millimètre,
quelle que soit l'étendue ; les cases complétées par le non classé passent par
des sommes sur 16 bits, à 2,4 mm au pire ; et une case dont la hauteur tombe
pile au plafond de 3 m peut basculer d'un côté ou de l'autre (12 cases sur
1,9 M) — tolérées si elles restent rares. Vérifié qu'il sait échouer : un
plafond faussé ou un pas décalé d'un centimètre le font refuser.

**La carte graphique n'est pas plus rapide pour ranger les points** — contre
ce que la conception supposait. L'essai du 26 septembre annonçait 15 M de
points en 0,23 s ; il était faux (maximum faux de 24,8 m, une erreur GL en
fin de passe : les passes de profondeur ne faisaient pas leur travail). Mesuré
depuis, dans le Chrome de Windows, carte AMD intégrée :

| | Carte graphique | Processeur |
|---|---|---|
| vrais points de Verdun, 5,7 M, grille 2158² | 2,2 s | 2,2 s |
| points synthétiques au hasard, 15 M | 5,3 à 6,8 s | 3,8 à 4,3 s |

Le coût est dans les passes avec test de profondeur (~250 ms chacune pour
5,7 M), et il dépend de l'**ordre** des points : triés spatialement, des points
synthétiques passent 15 fois plus vite ; au hasard, 15 fois plus lentement.
Les vrais points sont entre les deux, et un tri à l'arrivée ne leur fait rien
gagner (mesuré). Écrire l'altitude par `gl_Position.z` plutôt que
`gl_FragDepth`, une profondeur 24 bits ou un tampon de rendu : aucune
différence. Le chemin de la carte est gardé — juste, aussi rapide, et il
libère la mémoire JavaScript des points — mais la conception qui suppose des
grilles « sur la carte pour la vitesse » est à revoir au plan 3.

Dans l'application (même carte, Verdun) : un recalcul prend 0,5 s au
premier bloc, puis 3 à 5 s une fois le budget de 20 M de points atteint — à
97 % le rangement des points, **tous** refaits à chaque recalcul, y compris
des blocs fins gardés d'une vue précédente et inutiles au pas courant. C'est
la stratégie de recalcul, pas le moteur, qui est à reprendre.

Le budget de points n'est plus réduit sans carte graphique : le rangement
est incrémental et se fait dans le worker, au processeur, dans tous les cas.

**Le calcul tourne dans un worker, et au processeur** (`relief-travailleur.js`).
Sur le fil principal, chaque recalcul figeait la carte une à plusieurs
secondes. Dans un worker, ça ne suffisait pas tant que le calcul passait par
la carte graphique : la page gelait encore, de 0,5 à 1 s sur la carte AMD,
sans une ligne de script. La page et le worker partagent la carte (et le
processus graphique de Chrome), et l'affichage attend que le calcul du worker
soit passé. Mesuré avec `&chrono` (API « long animation frames ») : presque
tous les gels tombaient pendant un calcul du relief, jusqu'à 11 s sous
émulation. Au processeur, plus aucun gel au-delà de ~200 ms, et plus aucun
ralentissement ressenti à l'usage. `&gpu` reprend la carte graphique pour
comparer. La leçon : **un calcul sur la carte graphique n'est jamais « en
arrière-plan »**, même lancé depuis un worker.

En `file://`, un worker ne peut rien charger : son source est composé du
texte des fonctions (comme la décompression), d'où les modules écrits en
`function fabriqueX()` puis `const X = fabriqueX()` — `vue-grille.js`,
`relief.js`, `gpu-relief.js`, `vue-relief.js` — et `raster.js` repris
fonction par fonction. Une fonction ajoutée à `raster.js` sans être listée
dans `relief-travailleur.js` n'échouerait que dans le worker :
`test/relief-travailleur.test.js` compare les deux listes et fait tourner le
source composé dans un contexte nu.

Un seul calcul à la fois : une demande pendant un calcul est retenue, et
relancée à la fin avec la vue du moment. Les points sont cédés au worker, le
fil principal ne les garde pas.

**L'image arrive du worker déjà reprojetée** au pixel de la carte (Web
Mercator), et se pose sur les bornes de la carte **au moment de la demande** :
si la carte a bougé entre-temps, l'image tombe quand même à sa place.
`VUE_IMAGE` reprend la technique de la photo aérienne dans l'autre sens — un
nœud de maillage tous les 32 pixels projeté exactement, l'intérieur
interpolé, à moins d'un dixième de case de la projection exacte (vérifié
contre `PROJ` et `RASTER.centreCellule`). Une image Lambert-93 posée sur un
rectangle WGS84 glissait de plusieurs mètres vers les bords. Le worker
l'encode en PNG (`OffscreenCanvas.convertToBlob`) ; le fil principal ne fait
que la poser.

**Chaque bloc n'est rangé qu'une fois.** La grille de la vue est gardée dans
le worker : un bloc arrivé est rangé seul ; un déplacement recopie la partie
commune et ne range que la bande entrante (`RASTER.accumuler` et son
rectangle exclu) ; tout est rangé de nouveau seulement si le pas, la taille
ou les réglages changent, ou si un bloc déjà rangé est retiré — un minimum ne
se défait pas. Une grille neuve ne prend que les blocs que la vue demande
(`flux.voulues()`), pas les blocs fins gardés d'une vue précédente. Pour que
le décalage serve, **la taille d'une grille ne dépend que de celle de la
vue**, jamais de sa position : sans ça, un déplacement d'une fraction de case
changeait `W` et forçait tout à se refaire. Les tests comparent chaque cas à
un rangement complet, champ par champ — avec une nuance voulue : un bloc déjà
rangé reste dans une grille décalée même s'il n'est plus demandé par la vue ;
un rangement complet ne le prendrait pas. Le terrain et la surface sont
gardés avec la grille : un bloc arrivé hors de la vue, un changement de
contraste ou de « non classés » ne reprennent que ce qui en dépend (seules
les classes du sol obligent à tout ranger de nouveau).

**La couche est gardée** tant que la surface ne change pas : le contraste ne
réétire que l'intervalle, sans refaire le SVF. Mesuré à Verdun (WSL, 4,8 M de
points, grille de 1072 × 871) : premier calcul 2,6 s — surface 0,8 s, SVF
1,6 s, image 0,1 s ; un recalcul sans nouveauté ne coûte que l'image.

**Les couches (SVF, ouvertures, ombrages) passent par la carte graphique, la
surface par le processeur** — le réglage par défaut. Essayé d'abord derrière
`&gpusvf` : aucun ralentissement ressenti à l'usage, là où le rangement des
points sur la carte gelait la page. Un SVF est un calcul court et découpé en
bandes ; le rangement, plusieurs secondes d'affilée. Le SVF passe ainsi de
1,6 s à ~0,2 s. `&cpu` met tout au processeur, `&gpu` tout sur la carte.

**L'ombrage coloré** est proposé comme dans l'onglet 2D : il rend ses
couleurs directement (`RELIEF.ombrageRGB`), reprojetées par
`VUE_IMAGE.peindreRGBA`, sans palette ni contraste. L'ombrage gris ne l'est
pas : sur une grille au pixel, il sortait pâle et peu lisible.

**Deux côtés, comme en 2D.** Chaque côté du rideau porte soit « Photo
aérienne » (la carte Leaflet elle-même, dont le sélecteur de fond est retiré
en vue normale : les listes Gauche / Droite le rendaient redondant), soit
« Plan IGN » — une couche de tuiles posée dans le volet du côté
(`carte.nouveauFond`, mêmes réglages et réessais que les fonds de la carte),
pour avoir la photo d'un côté et le plan de l'autre alors que la carte n'a
qu'un fond à la fois —, soit une couche de relief ; par défaut la carte à gauche et le SVF à
droite. `CalqueRelief` a un volet par côté, découpé à la position du rideau
(le droit garde ce qui est à droite de la limite, le gauche le reste), avec
son fond noir ; un côté « Carte » a son volet masqué. Les deux couches se
calculent sur la même surface, rangée une fois : le worker garde plusieurs
couches par surface (clé et réglages), et un aller-retour du sélecteur ou
« Échanger » ne refait rien. L'info-bulle lit la couche du côté survolé.

**Les outils de la 2D sur la carte.** En vue normale, la barre de modes
(déplacement, sélection, mesure), « Point sélectionné » et la mesure en
chaîne marchent sur la carte, avec les mêmes sections et le même tableau
que l'onglet 2D. Le point se **lit** dans la dernière vue calculée par le
worker (`relief.lire`, `VUE_RELIEF.lire`) — altitude absolue, hauteur,
valeur de la couche —, jamais recalculé : c'est ce que l'écran montre, et
une question au worker par clic. L'info-bulle au curseur fait de même, une
lecture à la fois, en ne gardant que le dernier mouvement. Marqueurs et
traits vont dans un volet à part (au-dessus du relief, sous le rideau), en
**SVG** plutôt que dans le canevas de la carte (`preferCanvas`) : quelques
éléments, qu'on peut viser et vérifier. Un point cherché par coordonnées
avant que le relief n'y soit calculé reçoit son altitude avec l'image
suivante. Les réglages du balayage (directions, rayon) partent avec chaque
image ; le rayon agrandit aussi la marge de la grille. La case « Compléter
le sol par les non classés » est masquée (TODO #3).

**Sous le relief, la carte voilée ; rien que du COPC.** Un côté de relief
n'est plus noir tant que rien n'y est calculé : son volet porte un voile
(`.voile-relief`) à travers lequel la carte se voit, assombrie, et les
pixels sans valeur de l'image sont transparents (`VUE_IMAGE.peindre`). À
l'arrivée sur une zone, le relief recouvre donc le voile à mesure que les
blocs arrivent. Au-delà du seuil de surface, la **dernière image calculée
reste** et rétrécit avec la carte — tant qu'elle est bien celle de la
couche du côté —, le voile couvre le reste, et le libellé du rideau dit
« Zoomez pour calculer le relief » (un avis au milieu de la carte gênait,
et sa classe `.avis-zoom` détournait celle de l'avis de zoom maximal).
Choix de l'utilisateur : ne montrer que ce qui vient des points. L'ombrage
tout fait de l'IGN (`IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.SHADOW`,
WMTS, zooms 0 à 18, `PM_0_18`) aurait comblé les vues larges ; proposé,
écarté pour cette raison.

**Le MNT de l'IGN, écrit puis débranché** (`mnt-ign.js`). Au-delà du seuil, il donnait le relief de toute la vue ; retiré à l'usage le jour même, parce qu'on ne savait plus si ce qu'on voyait venait de lui ou du calcul sur les points. Le module a ensuite été retiré (il reste dans l'historique git, commit `90c7321`, avec ses tests). Ce qu'il faisait : une requête WMS
`IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93` en
`image/x-bil;bits=32` à la taille de la grille (au plus 5010 px de côté), puis
les mêmes couches. Vérifié sur une vraie réponse : flottants
**petit-boutistes**, ligne 0 au **nord** (ramenée au sud comme toutes les
grilles du projet), `-9999` hors couverture. Mesuré : 548 km² en 2,4 s, réseau
compris, sans aucune requête de points. `RESEAU.recuperer` rend un
`Uint8Array`, parfois vue d'un tampon plus grand : la lecture en tient compte.

## La 3D de la vue

L'onglet 3D de la vue normale montre en nuage de points **ce que la carte
affichait** au moment d'y passer, sans rien télécharger de plus : le worker
du relief garde déjà les points (`relief-travailleur.js`), il en tire le
nuage (`VUE_RELIEF.nuage3d`). Conception : `docs/superpowers/specs/2026-09-27-vue-3d-design.md`,
fondée sur une veille de Potree, Giro3D (successeur d'iTowns, avec une
démonstration sur 180 dalles LiDAR HD) et maplibre-gl-lidar.

- **Quels points** : ceux des blocs que la vue demande (`flux.voulues()`),
  tombant dans l'emprise de la carte — bord gauche et bas compris, droit et
  haut exclus, pour qu'aucun point ne soit compté deux fois entre deux
  emprises voisines.
- **Un plafond** (5 M, 2 M sur téléphone ; curseur de 1 à 20 M). Au-delà,
  chaque point est gardé avec la probabilité `plafond / total`, tirée d'un
  **hachage de ses centimètres** : même vue, mêmes points — un aller-retour
  ne fait pas scintiller le nuage — et une densité régulière partout (chaque
  quart d'emprise reçoit 20 à 30 % des points, vérifié).
- **Figé en 3D.** Revenir en 3D sans que la carte ait bougé garde le même
  nuage, sans voile ; sinon l'ancien est libéré avant que le nouveau soit
  bâti — jamais deux à la fois. Rien de chargé : « Zoomez sur la carte ».
- **Le relief de la carte est en pause pendant qu'on est en 3D**, repris au
  retour. Le calculer quand même faisait attendre le nuage derrière des
  images que personne ne voyait (plus de 15 s en émulation) : le worker
  traite ses demandes l'une après l'autre.
- **Couleurs** : la hauteur au-dessus du sol vient avec le nuage (lue dans
  la dernière surface calculée) ; le relief drapé est calculé par le worker
  (`drape3d`), avec l'étirement de la dernière image du même côté du
  rideau — les deux vues restent la même image. L'intensité n'est plus
  téléchargée (« Seules les couches lues ») : pas de couleur « Intensité ».
- **Sélection et mesure** visent le nuage (`pointDuNuage`) ; sans grille de
  dalle, il n'y a plus d'enveloppe de repli.

**L'ombrage de profondeur (EDL)**, activé par défaut comme chez Potree et
Giro3D (`CONFIG.rendu.edl`, force 1 et rayon 1,4 pixel, ceux de Potree) : le
nuage se rend dans une texture, puis une passe plein écran assombrit chaque
pixel selon ce que ses huit voisins ont de plus proche, en log2 de la
profondeur de vue (Boucheny, 2009). La profondeur est réécrite telle
quelle : sélection et mesure gardent leur test de profondeur. Sur un nuage
synthétique, un muret de 50 cm ressort en trait net ; aucune erreur GL, et
les textures suivent la taille du canevas.

Étape 2, non faite (TODO #4) : que la caméra 3D pilote elle-même le
téléchargement, blocs les plus gros à l'écran d'abord (taille projetée, à la
Potree), avec la « fourchette » de l'utilisateur en hystérésis.

## La carte

La grille des dalles n'est pas téléchargée, elle est **calculée**. Une dalle est
exactement le carré `[X·1000, (X+1)·1000] × [(Y−1)·1000, Y·1000]` en
Lambert-93 ; la déduire est exact, gratuit et instantané.

Ce n'est pas une optimisation mais une correction. Afficher les polygones du WFS
donnait une grille trouée : le service plafonne à **600 entités** et les renvoie
triées par colonne, si bien qu'une vue de 30 × 60 km en recevait 600 sur 1 717
et affichait des bandes verticales vides — sans qu'aucune erreur ne le signale.
Et il y a 505 294 dalles en France : aucun préchargement n'est envisageable.

Le WFS reste interrogé, mais **au point** lors du clic : une requête, une
entité, jamais de troncature possible.

Deux échelles, calquées sur cartes.gouv.fr et sur ce que la couche annonce
elle-même (`zoom_start` / `zoom_stop`) :

| Zoom | Affiché |
|---|---|
| tous | emprises de chantier — 210 polygones pour la France, jamais tronquées |
| ≥ 11 | quadrillage kilométrique local, découpé sur ces emprises |

Le découpage est légitime : mesuré sur cinq régions, **100 % des dalles tombent
dans un bloc**. Sans lui, un quadrillage s'afficherait là où il n'y a pas de
LiDAR.

Enfin, **un carré Lambert-93 n'est pas aligné sur les axes en WGS84** : il
apparaît légèrement tourné. Toute emprise doit donc être tracée en polygone de
côtés reprojetés, jamais en `L.rectangle` — c'est ce qui faisait paraître la
zone d'intérêt de travers dans sa dalle.

**La carte s'ouvre sur la France entière**, cadrée par `fitBounds` sur une
emprise et non par un centre plus un zoom fixe — le zoom qui va bien dépend de
la taille de la fenêtre, vérifié en 1400 × 900 comme en 1000 × 700. Un repli au
zoom 5 couvre le cas où le conteneur n'a pas encore de taille, `fitBounds` y
calculant n'importe quoi. La couche des chantiers tient l'échelle et c'est
mesuré : 208 entités pour la France entière, avec `numberMatched = 208` — le
service dit lui-même qu'il n'y a rien de plus, donc aucune troncature au
plafond de 300, contrairement au quadrillage kilométrique qui plafonne à 600 en
silence. Le prix, à connaître : 1,1 Mo de GeoJSON en 570 ms au démarrage.

**Le zoom de la carte est borné à 19**, et ce n'est pas une limite pyrénéenne :
mesuré sur les deux fonds en trois lieux (Ariège, Paris, Vanoise), le niveau 19
répond 200, les niveaux 20 et 21 répondent 404, le 22 un 400 — le plafond est
celui de la couche, partout en France. `maxNativeZoom: 19` fait agrandir la
dernière tuile plutôt que d'en demander qui n'existent pas, `maxZoom: 20` reste
sur la carte, et un avis en bas à gauche dit qu'on est au maximum plutôt que de
laisser la carte virer entièrement au gris. Le même chiffre borne le
rééchantillonnage de la photo aérienne (`ORTHO.zoomPour`) : c'est la même
donnée et la même limite. Vérifié en temps réel, pas sous
`--virtual-time-budget` : les clics de zoom s'y déclenchent instantanément,
l'animation de Leaflet ne se pose jamais et les contrôles rapportent des échecs
qui n'existent pas — même piège que pour les Workers.

---

## Navigation dans le nuage

Contrôles « à la Google Earth » : glisser déplace le terrain, la molette zoome
sous le curseur, Maj+glisser pivote. L'inverse — glisser pour orbiter, molette
vers le centre — est l'usage des visionneuses 3D et se révèle pénible ici : on
balaie un kilomètre carré, le geste dominant est le déplacement, et zoomer vers
le centre éloigne de ce qu'on vient de repérer sur le bord.

Trois pièces à ne pas défaire :

- **`_repere()` est la source unique** du repère caméra, pour le rendu comme
  pour les contrôles. Extraire les vecteurs de la matrice de vue d'un côté et
  les recalculer de l'autre finit toujours par diverger.
- **Le déplacement se mesure par intersection**, pas par un facteur d'échelle :
  on prend le point du plan sous le curseur avant et après, et on décale la
  cible de leur différence. Vérifié exact à 0,000 m. La version précédente
  mélangeait les axes et faisait dériver l'altitude visée.
- **Le zoom recentre** : `cible ← P + (cible − P)·k` avec `k` le rapport des
  distances. Le point visé reste alors immobile à l'écran (mesuré : 0,5 m de
  glissement sur 311 m de portée).

Le plan d'intersection est horizontal, à la hauteur de la cible. C'est une
approximation du relief, largement suffisante à l'échelle où l'on inspecte une
structure, et qui évite de relire le tampon de profondeur.

### Le pointé au clic vise n'importe quel point, pas seulement le signal de détection

Sélection et mesure en 3D marchent un rayon contre `mnt + hauteur`
(`TERRAIN.pointDuTerrain`) — l'enveloppe du terrain, sol comblé ou toit d'un
bâtiment. Mais `hauteur` (`RASTER.accumuler`, `RELIEF.preparer`) ne porte que
le signal de détection : non classé, et bâtiment si l'option le demande. Un
`switch` y jette silencieusement tout le reste — végétation, ponts, sursol
pérenne — parce que la détection n'en a pas l'usage. Conséquence pour le clic :
viser un arbre, un pont ou n'importe quel point qui n'est ni sol ni signal
retombait sur le sol en dessous, sans rapport avec ce que l'écran montrait
sous le curseur.

D'où `sommetZ` (`raster.js`), un Z maximal accumulé sur **tous** les points
sans filtre de classe — un `Float32Array` de plus, 64 Mo sur une dalle entière
à 25 cm, assumé parce que c'est le seul moyen de garder trace d'un point dont
la classe n'a par ailleurs aucun emploi. `RELIEF.preparer` l'agrège en
`sommet`, `TERRAIN.pointDuTerrain` en prend le maximum avec l'enveloppe
existante — pour la marche du rayon comme pour la hauteur renvoyée, sans quoi
la mesure aurait affiché la distance au sol sous l'arbre plutôt qu'à sa cime
visée. Absent d'une grille (les tests plus anciens n'en portent pas), il vaut
`-Infinity` et le comportement retombe exactement sur l'ancien : rien à
défaire côté détection, qui ne lit ni `sommetZ` ni `sommet`.

Premier essai réel, corrigé le jour même : décocher une classe (§ « Filtrage
des classes ») la retire du rendu, mais `sommet` continuait de pointer sur ce
point devenu invisible — décocher les arbres faisait flotter le point mesuré
à leur ancienne position, sur un point qu'on ne pouvait plus voir pour viser
juste. Un point rejeté au rendu doit l'être aussi au pointé. D'où
`sommetCls` (`raster.js`, un `Uint8Array` de 16 Mo), la classe qui détient
le maximum de `sommetZ` à chaque cellule ; `TERRAIN.pointDuTerrain` reçoit
désormais l'ensemble des classes décochées (`classesMasquees`, `app.js`) et
ignore `sommet` là où sa classe en fait partie, retombant sur `hauteur` seule.
Volontairement approximatif : un seul maximum est gardé par cellule, pas un
classement. Masquer sa classe fait retomber la cellule sur `hauteur` seule
— c'est-à-dire sur ce que `ncSomme` / `batSomme` y ont vu séparément, sol
et signal de détection restés à part — jamais sur un éventuel second point
plus bas d'une classe elle-même affichée : celui-là n'a jamais été gardé. Le
compromis assumé est un octet par cellule (`sommetCls`), pas un `Float32Array`
par classe présente.

### Le pointé vise le nuage réel ; l'enveloppe du terrain n'est plus qu'un repli

Retour utilisateur, malgré tout ce qui précède : « je clique sur un point et
soit ça fait rien soit ça prend à côté ». La cause n'était pas l'un des cas
déjà traités mais l'architecture même du pointé — `pointDuTerrain` vise une
grille **lissée** (`mnt`, la moyenne du sol par cellule de détection, elle-même
ré-agrégée dans une cellule d'affichage de 50 cm), alors que les points
affichés viennent d'un niveau d'octree délibérément **plus grossier**
(`NUAGE.niveauPourAffichage`, souvent 85 cm à 1,7 m d'espacement — le rendu n'a
besoin que de se repérer à l'œil, pas de la pleine résolution). Un point réel
peut donc s'écarter nettement de la moyenne de sa propre cellule : « à côté ».
Et sur un rayon oblique, une bosse isolée d'une seule cellule (le cas même que
`sommet` vient d'ajouter) peut être enjambée par le pas de marche grossier
avant bissection : « rien ».

Les deux symptômes venaient du même choix de fond : viser une **surface
dérivée**, jamais les points eux-mêmes. `TERRAIN.pointDuNuage` inverse ça —
il cherche, dans `etat.nuage` (déjà en mémoire pour le rendu, jamais
redemandé), le point le plus proche du rayon de clic, et le renvoie tel quel.
`app.js` l'essaie en premier (`viserPoint3D`) ; `pointDuTerrain` ne reste
qu'un **repli** pour un clic trop imprécis pour tomber dans le seuil d'aucun
point rendu — jamais « rien », plutôt une approximation.

Trois décisions :

- **Le seuil d'acceptation est en pixels à l'écran**, converti en unités du
  monde à la profondeur de chaque candidat (`2 · t · tan(fovY/2) / hauteurPx`).
  Un seuil fixe en mètres serait trop permissif de près (où même un point
  clairement à côté tomberait dedans) et raterait tout au loin (où l'écart en
  mètres d'un pixel grandit). `CONFIG.rendu.toleragePointagePx`, comme le reste
  des réglages.
- **Parmi les points dans le seuil, le plus proche de la caméra gagne** — pas
  le plus proche du rayon en distance 3D pure. C'est celui qui occulterait les
  autres à l'écran, donc celui que l'œil voit réellement au pixel visé.
- **Un balayage linéaire du nuage, pas une structure spatiale.** Appelé une
  fois par clic et non par image, le coût — quelques dizaines de ms sur
  plusieurs millions de points — ne s'amortit pas assez souvent pour justifier
  d'en construire une.

`FOV_Y_DEG` (`vue3d.js`), auparavant recopié à trois endroits (`52` en dur dans
le rendu, le rayon de clic, l'échelle écran↔monde du zoom), en devient une
constante unique : un rayon de clic qui suivrait un champ de vision différent
de celui du rendu viserait systématiquement à côté de ce que l'écran montre —
exactement la classe de bogue que ce chapitre corrige, il ne fallait pas la
réintroduire par un chiffre oublié.

Le point rendu par `pointDuNuage` n'a pas de séparation sol/hauteur — c'est
déjà, littéralement, le sommet visé — d'où `hauteur: 0` systématique ; seul le
repli `pointDuTerrain` continue de distinguer les deux, pour la raison qui l'a
motivé à l'origine (voir plus haut).

### La boussole

Le nuage n'offre aucun repère : ni horizon, ni bâtiment reconnaissable, et une
dalle est un carré. Après deux rotations, plus rien ne dit où est le nord —
alors que les détections se lisent ensuite sur une carte, qui elle est au nord.

`boussole.js` dessine donc une rose **projetée** — les cardinaux posés sur le
cercle d'horizon vu par la caméra du moment — et chaque poignée y ramène la vue.
Quatre décisions :

- **Le repère vient de `Vue3D._repere()`**, passé en argument. En recalculer un
  dans la boussole ferait exactement ce que la règle ci-dessus interdit.
- **En SVG, pas en WebGL** : il y a du texte. Six étiquettes nettes à toute
  densité de pixels coûteraient un atlas de glyphes et un programme de plus.
- **Cliquer « N » regarde vers le nord** — le nord finit donc en *haut* de
  l'écran. L'autre lecture (« se placer au nord », nord en bas) est celle des
  gizmos de modeleur ; ici le besoin est de retrouver l'orientation d'une carte.
  Les poignées haut/bas, elles, ne peuvent se lire que comme un déplacement.
- **L'inclinaison de dessin est bornée à [17°, 74°]**, l'azimut jamais. Au ras de
  l'horizon la rose s'aplatit en un trait où nord et sud se superposent au
  centre ; à la verticale c'est l'axe haut/bas qui s'écrase pareillement. Dans
  les deux cas les poignées deviennent illisibles et intouchables — précisément
  dans les vues d'où l'on veut se réorienter.

Les conventions de signe sont vérifiées à froid (`test/boussole.test.js`) :
elles ne cassent rien quand elles sont fausses, elles mettent juste le nord au
mauvais endroit, et ça ne se verrait qu'à l'export.

## Mesure en chaîne

Retour utilisateur, une fois le pointé 3D fiabilisé (voir plus haut) : « ça
serait bien que ce soit comme sur Maps, tu cliques A puis B puis C, et ça
affiche AB et BC ». Le modèle à deux points (A/B fixes, un troisième clic
recommençait à zéro) devient une **chaîne sans longueur limite** —
l'inspiration citée était Google Maps, la mécanique de bord (retirer le
dernier point, terminer sans geste dédié) vient de l'outil « Mesurer une
ligne » de QGIS, regardé sur demande avant d'écrire quoi que ce soit :
clic gauche pose un point, Retour arrière/Suppr retire le dernier, et rien ne
« termine » formellement une mesure — QGIS clôt avec un clic droit, geste déjà
pris ici par l'orbite de la caméra en 3D (`e.button === 2` dans
`_brancherControles`), donc écarté sans même l'essayer.

**`pointsMesure` (`app.js`) est un tableau, pas une paire.** `mesure.js` gagne deux
fonctions pures, dans le même esprit que `sommet`/`distances` déjà là :
`segments(points)` déplie la chaîne en paires consécutives (A→B, B→C…),
chacune avec ses trois distances ; `totaux(segs)` somme l'horizontale et la
3D sur l'ensemble. Le dénivelé, lui, **n'a pas de total** — volontaire, pas un
oubli : sommer des dénivelés signés ne donnerait que l'écart net entre le
premier et le dernier point (une montée de 50 m suivie d'une descente de 50 m
totaliserait zéro), qui se lirait à tort comme « le dénivelé de la sortie »
alors que le tableau, lui, montre bien les deux valeurs séparément par
segment.

**`totale3D` vaut `null` si un seul segment a une altitude inconnue à l'un de
ses bouts** — jamais une somme partielle qui se lirait comme complète tout en
sous-évaluant. `totaleHorizontale`, elle, ne dépend d'aucune altitude et se
somme donc toujours, même sur une chaîne qui traverse une zone sans sol connu.

**`Vue2D.definirMesure` et `Vue3D.definirMesure` prennent un tableau de
points**, plus la ligne brisée qui les relie : en 3D un seul tampon porte les
segments (`gl.LINES`, chaque paire consécutive redonne ses deux bouts — une
bande n'existe pas dans ce mode) puis les marqueurs (`gl.POINTS`), la même
disposition qu'avant, simplement générique en nombre de points désormais. En
2D chaque segment garde son étiquette de distance horizontale au milieu du
trait — c'est la seule des trois valeurs qui se lit directement sur un plan,
comme avant ; dénivelé et 3D restent réservés au tableau du panneau, où il y
a la place de les nommer.

Pas de lettres sur les marqueurs eux-mêmes (ni sur le canevas 2D, ni en
WebGL) : les points s'ajoutent dans l'ordre du clic, et le tableau les nomme
déjà A→B, B→C… — dessiner des étiquettes de texte flottantes sur des
marqueurs 3D aurait demandé un atlas de glyphes pour un gain marginal, le
genre de coût que la boussole a délibérément évité pour la même raison (voir
plus haut, « En SVG, pas en WebGL »).

## Rendu à la demande

La boucle 3D **ne tourne pas en continu**. `invalider()` planifie une image, et
seuls les changements visibles l'appellent : contrôles, chargement, réglages,
redimensionnement du canevas (`ResizeObserver`).

Ce n'est pas une économie de confort. Un nuage est statique ; le redessiner
soixante fois par seconde ne change rien à l'écran et sature la machine. Mesuré
sur l'aperçu d'une dalle, 4,45 M points :

| | Rendu continu | À la demande |
|---|---|---|
| Cadence disponible | 1,9 image/s | 56,9 image/s |
| Pire latence du fil principal | **1 165 ms** | **18 ms** |

Avec plus d'une seconde sans rendre la main, le navigateur ne pouvait plus
servir le défilement du panneau latéral : le symptôme rapporté était « on ne
peut pas faire défiler le menu en mode 3D ».

Conséquence à retenir : **toute nouvelle méthode qui change ce qui est affiché
doit appeler `invalider()`**, sans quoi son effet n'apparaîtra qu'au prochain
mouvement de souris.

Une seule exception, bornée : `_animerVers()` enchaîne des images pendant 260 ms
pour pivoter vers une orientation demandée (boussole, vue de dessus), puis
s'arrête. Un saut instantané d'un quart de tour désoriente — sans le mouvement,
rien ne dit de quel côté on a tourné, et il faut relire la scène entière. Tout
geste de l'utilisateur interrompt l'animation (`_arreterAnimation`).

**Pendant un geste, une part du nuage seulement.** Retour d'usage : la 3D
ramait sur la carte AMD du portable, à 5 M de points. Le nuage de la vue
arrive rangé par paquets de hachage (`VUE_RELIEF.nuage3d`) : n'importe quel
début en est un échantillon régulier, et `drawArrays(0, k)` dessine moins
sans rien téléverser. Pendant un geste (`_bouger` : glisser, pivoter,
molette, animation), `k` suit le **retard** des images — entre la demande
(`invalider`) et le rendu —, que la carte saturée allonge et qu'une pause
dans le geste ne touche pas (`partEnMouvement`) ; la résolution y est
plafonnée à un pixel physique. 150 ms sans geste : une image complète, à
pleine densité. L'intervalle entre deux images, essayé d'abord, prenait une
image de 250 ms pour une pause et ne baissait jamais : sous émulation, la
part tombe maintenant de 100 à 5 % en trois images. `&debug` affiche dans
le HUD 3D ce qu'a dessiné le dernier geste.

Corollaire côté interface : un seul conteneur défilant. La liste de résultats
avait le sien (`max-height` + `overflow`), ce qui piégeait la molette dès que le
curseur la survolait.

## La page d'accueil

> **Depuis le plan 3 du relief piloté par la vue**, « Voir un exemple » cadre
> le Bois des Caures au zoom 16, sans rien charger : le relief de la vue
> arrive seul. L'ancien comportement (sélection et chargement de la dalle)
> reste derrière `?dalle`.

Sans elle, qui ouvre Scopus tombe sur une carte de France et doit deviner où
cliquer — et tout le reste de l'outil est derrière ce clic. C'est une **section
plein écran d'`index.html`**, pas un second fichier : le double-clic et la
publication sur Pages doivent rester vrais tous les deux, et deux fichiers
`file://` sont de toute façon deux origines opaques.

Elle tient en un écran, sans défilement ni visite guidée, et pose une seule
question sous deux formes de **poids délibérément inégaux** : « Voir un exemple »
est le seul élément coloré de la page, « J'ai déjà des coordonnées » est un lien.
Des actions concurrentes de même poids créent une charge de décision et font
chuter le passage à l'acte ; la hiérarchie n'est donc pas cosmétique.

**Le bouton principal fait la vraie chose, pas une promesse.** Il menait
d'abord à un écran qui annonçait ce que l'exemple montrerait, faute de dalle
choisie — un bouton muet se lit comme une panne, un bouton qui annonce comme
un chantier. Il sélectionne et charge maintenant une vraie dalle tout seul, le
même mécanisme que le lien partageable (voir « Le lien partageable »). La
dalle est arrêtée : le Bois des Caures, à Verdun (`#d=877,6904`) — champ de
bataille de 1916, trous d'obus et tranchées intacts sous la forêt depuis plus
d'un siècle, sujet d'une étude LiDAR académique dédiée (De Matos-Machado et
al., 600 000 « polémoformes » et 400 km de tranchées recensés sur la forêt
domaniale de Verdun). La photo aérienne n'y montre qu'un bois ; le Sky-View
Factor y montre un fortin bastionné cerné de centaines d'impacts d'obus.

**Le fond est la carte elle-même, pas une image.** Un premier jet dessinait la
comparaison promise en SVG — photo aérienne d'un côté, Sky-View Factor de
l'autre. Remplacé : la carte Leaflet est déjà construite et déjà en train de
charger les 208 chantiers LiDAR de la France (voir « La carte ») au moment où l'accueil
s'affiche par-dessus elle, donc un dessin statique en refaisait moins bien une
donnée déjà là. `.accueil` n'est plus un aplat mais un voile — un dégradé sombre
posé sur `#vue-carte` —, et la carte de texte flotte dessus avec son propre fond
quasi opaque. Le reste de l'interface (en-tête, panneau, onglets) reste masqué
tant que l'accueil est ouvert, par une règle CSS sur `#accueil:not([hidden]) ~ …`
et non par du JavaScript, sur le même principe que `data-vue`. La comparaison
photo ↔ relief promise par la phrase d'accroche, elle, se montre déjà pour de
vrai dès qu'on clique « Voir un exemple » : c'est la dalle du Bois des Caures
qui la porte, et c'est aussi la capture qui ouvre désormais le README.

**La ligne sur ce que l'outil ne sait pas faire n'est pas de la modestie** : elle
détermine la qualité des retours. Qui comprend qu'il s'agit de règles
géométriques réglables propose des coordonnées ; qui croit à une IA répond « ça
ne marche pas ». Elle ne porte plus sur la détection automatique — masquée, la
question ne se pose plus pour un visiteur — mais sur ce que l'outil fait
réellement : calculer le relief, sans rien repérer à la place de qui regarde.

Trois points de mise en œuvre à ne pas défaire :

- **Un `location.hash` non vide saute l'accueil.** Il désigne une vue précise
  plutôt qu'une simple présence — voir « Le lien partageable ». Sans cela, un
  lien partagé ouvrirait une page de présentation au lieu de l'endroit qu'il
  désigne.
- **Les raccourcis clavier sont neutralisés tant que l'accueil est là.** Ils
  piloteraient sinon un outil que l'écran recouvre entièrement.
- **La colonne du panneau se réduit à zéro, elle ne devient pas seulement
  invisible.** `visibility: hidden` sur `.panneau` sans toucher la grille
  laisserait sa colonne de 380 px réservée, et la carte de fond se retrouverait
  décalée d'autant vers la droite — visible sur les trois quarts de l'écran
  seulement. `grid-template-columns: 0 1fr` sur `.grille` referme la colonne en
  plus de la vider.

Un piège de mesure, à ne pas reproduire : **la fenêtre de Chrome headless ne
descend pas sous ~500 px de large**, et son cliché rogné à la taille demandée
donne l'illusion parfaite d'une mise en page qui déborde. Vérifier une largeur de
téléphone demande un **iframe** — `position: fixed` s'y résout sur la taille du
cadre. Mesuré ainsi à 380 px, la page tient.

## Soutenir

Une section « Soutenir » **tout en bas du panneau**, dans tous les onglets :
une phrase et un bouton « ♥ Offrir un café » vers Ko-fi, avec en petit
« ou un soutien régulier sur Liberapay » (`CONFIG.soutien`, section masquée
si rien n'est configuré ; Liberapay seul prend le bouton), plus `.github/FUNDING.yml` (bouton « Sponsor » du
dépôt) et une ligne du README. Rien sur l'accueil (choix de l'utilisateur),
ni fenêtre, ni relance, ni rien de réservé aux donateurs : qui l'utilise
souvent ne la croise qu'en faisant défiler le panneau jusqu'au bout. Pas de
« masquer » non plus — placée là, elle ne gêne personne ; si des retours la
trouvaient envahissante, JabRef a choisi de la faire revenir tous les six
mois plutôt que de la masquer pour de bon. Ko-fi pour le bouton, parce que
l'utilisateur attend peu de dons et surtout ponctuels : Liberapay, choisi
d'abord (aucune commission, l'usage du libre et d'OSM), ne gère pas vraiment
le don unique (« One-time donations aren't properly supported yet », sa FAQ)
et demande un compte au donateur. Ko-fi : don ponctuel sans compte, 0 % de
commission sur les dons une fois le programme « Contributor » désactivé.

## Le lien partageable

> **Depuis le plan 3 du relief piloté par la vue**, ouvrir un lien ne fait
> que cadrer la carte — plus de dalle sélectionnée, rien d'attendu ; un ancien
> `#d=x,y` cadre le centre de sa dalle au zoom 16. Ce qui suit décrit le
> parcours par dalle, toujours actif derrière `?dalle`.

**Le lien porte la vue, au format que tout le monde lit** : `#map=zoom/lat/lon`,
celui d'osm.org, complété en 3D comme le fait MapLibre —
`#map=zoom/lat/lon/orientation/inclinaison`, les deux derniers champs n'étant
écrits que s'ils ne sont pas nuls. Premier jet (`#d=592,6183`) : la dalle seule,
deux indices kilométriques Lambert-93. Remplacé en septembre 2026 à la demande
de contributeurs OSM : un lien Scopus doit s'ouvrir tel quel dans osm.org, iD
ou JOSM, ou passer d'une carte à l'autre par un greffon du genre OSMSmartMenu —
repérer un endroit dans Scopus, et deux clics plus tard l'éditer.

Pourquoi ce format et pas un autre, vérifié dans les sources plutôt que
supposé : `OSM.parseHash` (openstreetmap-website) ne lit que les trois premiers
champs de `map=`, zoom par `parseInt`, et ignore tout le reste, `&` compris ;
`Hash.getHashString` (maplibre-gl-js) écrit orientation et inclinaison à la
suite, et seulement si elles sont non nulles. Un lien de carte ou de 2D reste
donc exactement un lien osm.org, et un lien 3D en est un aussi pour qui ne sait
pas lire la suite. `test/lien.test.js` rejoue la lecture d'osm.org sur ce que
Scopus écrit.

Quatre décisions :

- **Le zoom est celui de Leaflet et d'osm.org** (256 px au zoom 0), pas celui de
  MapLibre, décalé d'un cran. En 2D et en 3D, il se déduit de la résolution au
  sol (`LIEN.zoomDepuisResolution`) : l'échelle de la vue 2D, ou en 3D la
  distance de la caméra ramenée au pixel au point visé, par le même
  `FOV_Y_DEG` que le rendu. Deux décimales, parce que la 2D et la 3D zooment en
  continu ; osm.org les tronque sans broncher.
- **Le lien suit l'onglet affiché**, à chaque déplacement : la carte, la 2D ou
  la caméra 3D. `replaceState`, jamais `location.hash =` — le second empilerait
  une entrée d'historique par geste — et regroupé à 300 ms (`majLien`), parce
  que la 3D rend une image par trame pendant une animation et que Safari
  refuse plus de 100 `replaceState` par 30 secondes. Rien n'est écrit tant que
  l'accueil est ouvert : le cadrage initial de la carte ferait sinon sauter
  l'accueil au rechargement suivant.
- **Ouvrir un lien sélectionne la dalle sous le centre**, et rien de plus —
  choix de l'utilisateur, plutôt que d'ajouter la dalle au lien. La
  contrepartie est connue : un lien écrit après s'être éloigné de la dalle
  choisie ouvre la dalle voisine. Accepté, parce que la dalle est vouée à
  s'effacer de l'interface si le chargement devient instantané. Loin de tout
  (zoom < `zoomGrille`), le lien cadre la carte sans rien sélectionner. Le
  téléchargement, lui, n'est jamais lancé par un lien : jusqu'à 190 Mo,
  personne ne doit le subir en cliquant.
- **L'échelle fine et les angles attendent la dalle.** `etat.vueDuLien` garde la
  vue du lien jusqu'au chargement ; `appliquerVueDuLien` la reporte sur la 2D
  et, si le lien est incliné ou tourné, sur la caméra 3D, en y basculant.
  L'onglet 3D doit être affiché **avant** de placer la caméra : la distance se
  déduit de la hauteur du canevas, et masqué, le zoom repris dérivait d'un
  quart de cran (17 → 16,77, mesuré). Tant qu'elle attend, la vue du lien n'est
  pas réécrite par celle de la carte ; le moindre déplacement de la carte
  après le cadrage l'abandonne — `movestart`, pas des évènements de pointeur :
  la première version n'écoutait que les gestes, et une recherche de lieu, qui
  déplace la carte sans qu'on la touche, laissait le lien figé sur l'ancienne
  vue, copié tel quel par « Partager ». Un lien trop dézoomé pour sélectionner
  une dalle n'attend rien du tout.

Les conventions d'angle sont éprouvées contre le vrai `Vue3D._repere`, pas
contre une formule recopiée dans le test : orientation 90 regarde vers l'est,
inclinaison 0 regarde à la verticale. La vue de dessus de Scopus s'arrête à
89°, et ce degré-là n'est pas écrit — ce serait « /1 » au bout de chaque lien
de vue de dessus.

**Les anciens liens `#d=x,y` restent lisibles**, et sont réécrits au format
courant dès que la carte bouge. Attention à leur sens : `x, y` y sont les
indices du coin **sud-ouest** (`xmin/1000`, `ymin/1000`), si bien que `#d=877,6904`
désigne la dalle nommée `0877_6905` — le nom IGN porte le Y du bord nord. Ne pas
« corriger » : ce sont des liens déjà publiés.

Un fragment modifié à la main dans la barre d'adresse, ou par un greffon, est
suivi (`hashchange`) ; nos propres `replaceState` ne déclenchent pas cet
évènement et n'y repassent donc pas.

**Un bouton « Partager », deux actions, et pas une de plus** : copier le lien
de la vue, ou ouvrir la même vue sur osm.org. Pas un lien par outil — iD, JOSM,
Overpass… —, qui ferait une rangée intenable et une demande d'ajout tous les
six mois : osm.org est la porte d'entrée vers tout le reste, son bouton
« Modifier » mène à iD comme à JOSM avec la position (vérifié : il pointe sur
`/edit#map=…` à la même vue). Les extensions qui passent d'une carte à l'autre
(OSM Smart Menu, OpenSwitchMaps) ne remplacent pas ce bouton : elles
reconnaissent chaque site par son domaine, une règle écrite à la main par site,
et Scopus n'est dans aucune liste — OpenSwitchMaps annonce d'ailleurs ne plus
pouvoir être mis à jour.

Le bouton vit dans la barre des onglets, pas dans le panneau : c'est une action
sur la vue affichée, valable dans les trois onglets, alors que le panneau change
avec l'onglet et se replie sous 900 px. Le menu se pose au-dessus
des contrôles de Leaflet (z-index 1000) mais sous le panneau (1500) — à
1000 pile, le bouton des couches de la carte passait par-dessus, vu au cliché.

Le lien se copie par `navigator.clipboard.writeText`, avec repli sur
`prompt()` : l'API refuse parfois en silence — mesuré, `NotAllowedError`, y
compris hors `file://` — et l'échec ne doit pas priver du lien. `prompt()` ne
dépend d'aucune permission et présente le texte déjà sélectionné pour un
Ctrl+C manuel.

Au chargement sur un hash non vide, fermer l'accueil rend au panneau sa colonne
de 380 px — la carte, qui occupait l'écran entier derrière le voile
translucide de l'accueil, doit donc être réinvalidée (`carte.invalider()`)
avant d'être recentrée : un redimensionnement purement CSS, sans évènement
`resize`, que Leaflet ne détecte jamais tout seul. Même piège que le retour sur
l'onglet Carte.

Parcours vérifié en Chromium réel, en `file://` et en temps réel (harnais
Playwright hors dépôt) : sans fragment, l'accueil reste et rien n'est écrit ;
la carte glissée réécrit le fragment sans empiler d'historique ; un lien
`#map=` sélectionne la dalle sous le centre ; un ancien `#d=` retombe sur la
même dalle et se réécrit ; un lien 3D chargé arrive en 3D avec son zoom, son
centre et ses angles, puis suit la molette ; l'onglet 2D réécrit un lien sans
angles ; « Ouvrir dans OpenStreetMap » ouvre osm.org à la même vue, et
« Copier le lien » met la bonne adresse dans le presse-papiers, à 1400 comme à
380 px de large. Côté osm.org, testé sur le vrai site : un lien Scopus de carte,
de 3D (angles ignorés) ou à zoom décimal (tronqué) y ouvre la même position.

## Le panneau suit la vue

Une section porte `data-vue="carte"` ou `data-vue="3d"` pour déclarer l'onglet où
elle a un sens ; le panneau porte l'onglet courant, et la feuille de style masque
le reste. **Rien à câbler en JavaScript au-delà de l'attribut** — `basculerVue()`
écrit `panneau.dataset.vue`, c'est tout. Une section sans `data-vue` vaut pour
les deux, ce qui est le cas de l'analyse : on lance une détection depuis la carte
comme depuis la 3D, et la liste sert aux deux.

Ce qui a été corrigé : cinq sections numérotées empilées en permanence, dont deux
sans objet dans la vue affichée — choisir une dalle pendant qu'on inspecte un
nuage, régler la taille des points devant une carte. Et surtout, les deux chaînes
de détection étaient éclatées sur quatre sections, réglages en haut, résultats en
bas ; elles vivent maintenant dans une section unique à deux volets, où chacune
garde ses seuils, son bouton, ses statistiques et sa liste au même endroit.

### Sélectionnée n'est pas chargée

Deux dalles coexistent, et les confondre était une source de bugs silencieux :
`etat.dalle` est celle qu'on vient de désigner sur la carte, `etat.dalleChargee`
celle dont le nuage et les grilles sont en mémoire. Après un clic sur une dalle
voisine, elles diffèrent — et le rapprochement BD TOPO comme les noms de fichiers
exportés désignaient alors une emprise qu'on n'avait jamais analysée.

Le choix de comportement : **charger une dalle ne détruit rien tant qu'on ne l'a
pas demandé**. Un clic de curiosité sur la carte ne doit pas faire perdre une
détection qui a coûté trente secondes de téléchargement. En échange, chaque état
est nommé — carré vert pour la chargée, jaune pour la sélection, bandeau collant
en haut du panneau, et le bouton qui dit « Remplacer le nuage » au lieu de
« Charger le nuage ».

`fermerNuage()` rend l'état vide, qui n'existait pas autrement qu'en rechargeant
la page. Ce n'est pas qu'un confort : nuage d'affichage et grilles pèsent 400 à
520 Mo, retenus pendant tout le temps passé à explorer la carte ensuite.

Corollaire : **les grilles d'une dalle en cours de chargement restent locales
jusqu'au succès**. Publiées dans `etat` dès leur allocation, une annulation à
mi-parcours laissait une grille à moitié remplie de la nouvelle dalle pendant que
la 3D montrait toujours l'ancienne, et la détection lisait ce mélange sans que
rien ne le signale.

### Réglages repliés

Les quinze curseurs de seuils sont repliés dans un `<details>`. Dépliés en
permanence, ils noyaient les deux boutons qui font le travail. La numérotation
des étapes a disparu avec tout ça : elle ne pouvait plus être juste dès lors que
les sections apparaissent et disparaissent.

### Sous 900 px, le panneau se pose sur la carte, sans la cacher

Un premier essai empilait le panneau au-dessus de la scène (45 %/55 %) —
inutilisable à 380 px, la carte réduite à une bande. Le second en faisait un
tiroir modal : ☰ en haut à gauche, 85 % de l'écran, fond assombri. Retours
d'usage : pas pratique — pour voir l'effet d'un réglage, il fallait refermer
le tiroir à chaque fois. Veille faite (NN/G, Material Design, Google Maps,
Komoot, Géoportail) : les applis de carte gardent la carte **visible et
utilisable** à côté du panneau. Deux formes, selon la largeur (styles.css) :

- **Sous 600 px** (téléphone debout), une **feuille tirée du bas**, trois
  hauteurs (`data-feuille` : `replie`, `mi`, `plein`). Repliée (136 px,
  `--feuille-repliee`), elle montre la section principale de l'onglet — les
  listes Gauche / Droite sur la carte, les couleurs en 3D, remontées par
  `order` dans un panneau passé en colonne flex — : l'action la plus
  fréquente ne demande rien d'ouvrir. La poignée se tire (la feuille va à
  la hauteur la plus proche au lâcher) ou, d'un appui, passe à la suivante.
- **De 600 à 900 px** (tablette, téléphone couché), un **panneau latéral**
  de 340 px au plus, ouvert par défaut, replié par une languette ◀ / ▶
  collée à son bord droit et centrée en hauteur.

Pas de fond assombri, plus de ☰ : la carte reste active autour. Échap
replie les deux. Changer d'onglet ne touche plus au panneau — il n'y a plus
de tiroir à refermer.

**Sous 600 px**, le sous-titre de la barre de titre et l'aide de la barre des
onglets sont masqués : à 380 px, le premier passait sur deux lignes sous la
barre et la seconde en prenait quatre ou cinq, ~110 px de carte en moins —
et elle parlait de molette et de Maj à qui n'a qu'un doigt. `.partage` prend
alors le `margin-left: auto` que portait l'aide. Sur écran tactile
(`pointer: coarse`), l'aide de la 3D décrit les gestes du doigt
(`AIDE_TACTILE`), la bande du rideau passe de 22 à 44 px — le trait y est
centré et les libellés recalés, sans quoi ils se chevauchaient et le trait
tombait 11 px à côté de la limite.

Vérifié en émulation (Playwright, `isMobile`, `hasTouch`) à 380 × 800, 820 ×
1180 et 800 × 380 : aucun débordement horizontal, feuille repliée / appui /
glisser vers le haut et vers le bas, carte sous le doigt au-dessus de la
feuille, panneau latéral ouvert et replié. Les gestes au vrai doigt restent
à essayer sur un téléphone.

## Filtrage des classes

Par l'**alpha de la palette**, pas par les buffers : `paletteClasses` écrit 0
dans l'alpha des classes masquées, et le vertex shader rejette le point hors du
volume de vue. Une texture de 1 Ko réécrite suffit donc à refiltrer, là où
reconstruire les attributs coûterait des centaines de mégaoctets de transfert à
chaque case cochée.

Le point est **rejeté**, pas rendu transparent : un point transparent écrirait
quand même dans le tampon de profondeur et masquerait ce qui est derrière.

## Classes du sol

Autre chose que le filtrage ci-dessus : là, on choisissait quels points **se
voient** ; ici, on choisit quels points **sont** le sol. `RASTER.accumuler`
versait toujours les classes ASPRS 2 (sol) et 9 (eau) dans `solZ`, en dur —
retour utilisateur : « on fait que sol, il faut que ce soit choisissable,
genre ça affiche toutes les classes du LAS, avec case à cocher ». `g.classesSol`
(un `Set`, `CONFIG.raster.classesSolDefaut = [2, 9]` par défaut) remplace
maintenant ce codage en dur, et le panneau « Classes du sol » liste — une fois
la dalle chargée et ses classes connues, jamais avant — chaque classe
réellement présente avec une case, sur le même modèle que la légende de
filtrage (`etat.nuage.parClasse`, § ci-dessus).

**Une classe choisie comme sol cesse de nourrir le signal de détection**,
même s'il s'agit de « non classé » ou « bâtiment » — vérifié dans le code par
un `if`/`else if` où le sol est testé en premier, pas un `switch` où les deux
pourraient tomber indépendamment. Un même point comptant dans les deux
créerait une contradiction silencieuse entre le sol et ce qui est censé s'en
détacher.

**Pas de recalcul au clic sur une case : un bouton « Mettre à jour » explicite,
qui recharge la dalle.** La raison n'est pas ergonomique mais physique : les
points bruts ne sont jamais gardés (§ « Chargement : pourquoi COPC change
tout »), seulement les statistiques déjà accumulées avec l'**ancienne**
sélection. Il n'y a donc rien à recalculer sur place — seulement à retélécharger
et réaccumuler avec la nouvelle. `chargerNuage()`, déjà écrit pour le bouton
« Charger le nuage », est réutilisé tel quel : même dalle, même résolution,
seule `classesSol` change.

Chiffré avant de trancher, plutôt que supposé : garder une statistique
supplémentaire par classe (min Z + compte, pour se passer du rechargement)
coûterait environ 80 Mo par classe suivie en plus sur une dalle entière à
25 cm — vite plusieurs centaines de Mo pour une poignée de classes, à mettre
en regard des 405 Mo déjà en mémoire.

**Retélécharger, en revanche, n'est pas gratuit — contrairement à ce qui avait
d'abord été supposé ici.** Le pari initial : le cache HTTP resservirait les
mêmes plages d'octets sans repasser par le réseau, sur la foi d'un cas déjà
observé (§ pièges connus, « Un 200 en réponse à un `Range`… ») où une requête
retrouvait en cache une plage remplie **par un réessai dans la même série de
téléchargement**. Retour utilisateur, quelques minutes après coup : « Mettre à
jour » est systématiquement lent, à chaque clic — le cache ne joue pas comme
espéré une fois la série de téléchargement terminée, très probablement parce
que `data.geopf.fr` ne renvoie pas d'en-têtes qui autorisent le navigateur à
garder ces réponses `206` d'une visite à l'autre. Non vérifié en-têtes à
l'appui — aucun accès réseau depuis l'environnement où ce diagnostic a été
posé — mais l'observation directe d'un ralentissement systématique pèse plus
que la supposition qu'elle contredit. Le compromis reste préféré au coût
mémoire malgré tout : la dépense reste bornée dans le temps (un rechargement),
pas permanente comme le serait un tableau de plus par classe suivie.

**Le bouton « Mettre à jour » suit un instantané, pas la sélection en
cours.** `etat.classesSolChargees` retient la sélection qui a effectivement
servi à bâtir la grille en mémoire ; le bouton n'est actif que si la
sélection courante s'en écarte (`majBoutonClassesSol`), et jamais pendant
qu'un chargement tourne déjà (`btn-charger.disabled`, réutilisé plutôt que
dupliqué). Cette même fonction est rappelée aussi bien après un chargement
réussi qu'après un échec — l'oubli du second cas laisserait le bouton
bloqué à « désactivé » pour de bon après un rechargement raté.

---

## Détection de sentiers

Chaîne séparée (`sentiers.js`), sur le **relief seul** — jamais les classes.
Relief local → rugosité locale → Frangi multi-échelle → hystérésis →
amincissement Zhang-Suen → vectorisation → filtres.

Cinq décisions à ne pas défaire, chacune née d'une mesure :

- **Le seuil est en multiples de la rugosité locale**, jamais en mètres. Le
  relief local médian vaut 2 cm sur synthétique lisse et **79 cm sur le plateau
  de Beille** : une constante calibrée sur l'un fait déborder l'autre — la
  moitié de la dalle réelle passait le seuil.
- **Le lissage est une convolution normalisée**, poids et valeurs lissés
  séparément puis divisés. Les cellules sans sol connu portent une altitude de
  repli (la médiane de la dalle) : les inclure fabriquait des falaises de
  plusieurs dizaines de mètres, et le relief local atteignait **92 m** au 99ᵉ
  centile au lieu de quelques centimètres.
- **La marge de bord vaut trois rayons de lissage**, pas un. Trois flous de
  boîte enchaînés ont une portée cumulée de trois rayons ; une marge d'un seul
  laissait l'artefact de bord saturer la réponse sur un versant pourtant nu.
- **L'alignement à la pente est le critère décisif.** Une ravine et un chemin
  creux ont la même forme ; seul leur rapport à la pente les distingue. Le
  retirer fait remonter tous les ravins et fossés de drainage.
- **L'envergure d'un tracé se mesure bout à bout, jamais par sa boîte
  englobante.** `vectoriser` produit des boucles quand le squelette contient un
  cycle — sans extrémité franche, il en choisit une arbitrairement — et sur un
  terrain bruité, un vrai chemin comme une boucle sans queue ni tête peuvent
  tous deux occuper une boîte englobante de taille comparable. Retenu sur
  20 août 2026 après un retour utilisateur sur la dalle de Beille : deux amas
  de tracés qui s'entrecroisaient et rebouclaient sur eux-mêmes,
  visuellement des « pelotes ». Le filtre par boîte englobante n'en écartait
  que 6 sur 133 (2,2 à 2,9, à peine au-dessus du 1,2 d'un sentier sinueux) ; la
  distance à vol d'oiseau entre les deux bouts en écarte 107 — les amas
  disparaissent du rendu 2D. `CONFIG.sentiers.compaciteMax`.

**Pourquoi la hessienne (Frangi) et pas un ombrage**, le réflexe habituel : un
ombrage dépend d'une direction d'éclairage et rate les structures qui lui sont
parallèles. La littérature archéologique lui préfère des visualisations non
directionnelles ; la hessienne l'est tout autant, et détecte au lieu de
simplement montrer.

**Le point fragile est la densité du masque.** L'amincissement de Zhang-Suen
ronge le masque couronne par couronne : son coût croît avec la surface *et*
avec l'épaisseur des taches. Sur la dalle de Beille il couvre déjà **35 % de la
surface** pour 3,8 s de détection ; sur un terrain plus accidenté il saturerait,
et la squelettisation prendrait des minutes pour ne produire que le graphe du
bruit. Un garde-fou arrête donc la détection au-delà de 45 % avec un message
indiquant quoi régler, plutôt que de figer la page.

Répartition mesurée (dalle entière, nuage d'affichage chargé, tas à 522 Mo) :

| Étape | Durée |
|---|---|
| vesselness multi-échelle | 1,5 s |
| relief local | 0,8 s |
| seuillage + amincissement | 0,7 s |
| rugosité | 0,2 s |
| vectorisation + recollement | 0,2 s |
| qualification | 0,2 s |

**Validé** sur relief synthétique — sept tests à vérité connue : un sentier de
niveau est trouvé avec la bonne profondeur, une ravine de même profondeur mais
orientée dans la pente est écartée, et les deux sont séparés lorsqu'ils
coexistent sur le même versant.

**Mesuré sur la dalle du plateau de Beille**, 1 km² à pleine résolution, en
3,5 s :

| Sensibilité | Tracés retenus | Plus longs tracés |
|---|---|---|
| 0,35 *(défaut)* | 147 | 203 m / 40 cm · 259 m / 37 cm · 296 m / 56 cm |
| 0,60 | 63 | 112 m / 25 cm · 182 m / 39 cm · 137 m / 16 cm |

Les profondeurs tombent dans la fourchette attendue d'un sentier (10 à 56 cm)
et les longueurs se comptent en centaines de mètres — la version précédente,
qui triait sur l'amplitude, ne remontait que des tronçons de 25 à 30 m creusés
de 70 à 250 cm : des ravines. Le détail des rejets montre que les deux
nouveaux critères portent l'essentiel du tri : 506 tracés écartés sur la
tortuosité, 411 sur la profondeur.

**Non validé sur chemin réel connu** : rien ne dit que ces 147 tracés sont des
sentiers, seule leur signature est cohérente. Deux limites en plus : la
reconstitution reste partielle (73 m retrouvés sur 128 m exploitables pour un
tracé sinueux synthétique), et les **sentes de brebis** (terracettes) ne sont
pas traitées — c'est une texture périodique et non une ligne, qui relève d'une
analyse de Fourier plutôt que de ce pipeline.

**Depuis, un premier retour réel a été confronté** — la détection démasquée
(voir plus bas), essayée sur Beille par l'utilisateur : à l'œil, les tracés
ressemblaient à des points reliés au hasard plutôt qu'à des courbes
cohérentes. Confirmé en rejouant sur le canevas 2D : deux amas d'une centaine
de mètres où les tracés s'entrecroisaient et rebouclaient sur eux-mêmes, sans
qu'aucun ne corresponde aux deux lignes nettes et sinueuses pourtant visibles
dans le micro-relief au même endroit. Cause identifiée et corrigée par le
filtre de compacité ci-dessus (« L'envergure d'un tracé… ») : 133 tracés
retenus avant, 110 après, les deux amas disparus du rendu. **Le premier retour
utilisateur réel sur cette chaîne a donc trouvé un vrai bogue en une
observation, là où le banc synthétique et les mesures sur Beille n'avaient
rien vu venir** — aucun des sept tests à vérité connue ne produit de boucle,
et le compte de tracés seul (147 puis 133) ne dit rien de leur forme.

---

## Trois onglets : Carte, 2D, 3D

> **Depuis le plan 3 du relief piloté par la vue**, la vue normale n'a plus
> qu'un onglet, « Carte », qui porte le relief derrière un rideau ; la 2D et
> la 3D sont masquées et désactivées (TODO #3, #4). Un clic sur la carte ne
> sélectionne plus de dalle. Tout ce qui suit vaut pour `?dalle`.

Le nom dit le **mode d'affichage**, pas le contenu — la question « où je vois
quoi » doit avoir une réponse évidente. Carte pour explorer et choisir une dalle,
2D pour la lire, 3D pour le nuage.

Et **la 2D est la vue d'arrivée** : charger une dalle y bascule. Le nuage est le
résultat le plus spectaculaire, mais ce n'est pas celui qu'on vient chercher — un
objet de six mètres ne se voit pas dans un kilomètre carré de points, alors qu'il
saute aux yeux sur une couche d'ouverture. La valeur de l'outil est de *montrer*,
et c'est la 2D qui montre.

Une conséquence à ne pas manquer : la bascule a lieu **avant** le comblement du
MNT, pour que le voile d'attente se pose sur la vue qui recevra le résultat.
`preparer2D()` doit donc vérifier que la grille est finalisée — `etat.grille.mnt`
n'existe qu'après `RASTER.finaliser` — sans quoi le relief serait calculé sur une
surface pleine de trous, et rien ne le dirait.

### Deux couches, un rideau

Le cœur de la vue : une couche à gauche, une autre à droite, un rideau qu'on
glisse au milieu. C'est la démonstration la plus parlante de l'outil — une
structure invisible sur la photo apparaît dans le relief — et c'est ce que
vendent explorelidar.fr et daevorn-maps.org par abonnement.

Les deux côtés partagent **tout** : même caméra, même échelle, même grille. Rien
ne glisse quand on déplace la vue, et le rideau tombe au pixel. Ce n'est possible
que parce que la photo a été rééchantillonnée dans la grille Lambert-93 (voir
plus bas) : elle se lit sur les mêmes cellules que le relief.

Quatre décisions :

- **Le rideau se glisse, il ne se pose pas au clic.** La question s'était posée —
  poser la ligne au clic éviterait d'avoir à viser la poignée. Mais le clic est
  déjà pris (il sélectionne une détection), et une ligne de comparaison qui se
  téléporte au milieu d'un déplacement désoriente plus qu'elle n'aide. Le
  problème qu'on voulait résoudre est réglé autrement : **la bande sensible fait
  22 px de large sur toute la hauteur**, on ne vise jamais la poignée.
- **L'état du geste est un drapeau, pas `hasPointerCapture`.** La capture est une
  commodité — elle garde le geste quand il sort de la bande — mais elle échoue
  silencieusement si le pointeur n'est plus actif, et le rideau devient alors
  sourd au mouvement sans que rien ne le signale.
- **Les étiquettes se collent au rideau**, pas aux bords de l'écran : c'est là que
  se fait la comparaison et là que l'œil est. Sans elles, deux nuances de gris
  côte à côte ne disent pas laquelle est laquelle, dès qu'on a bougé un
  sélecteur une fois.
- **Deux listes déroulantes**, pas deux jeux de boutons : huit couches par côté
  feraient seize boutons pour un choix qui se fait une fois.

### Un cache de couches, parce qu'il y a deux côtés

Une seule couche était gardée jusqu'ici (`coucheCalculee`). Avec deux côtés, un
aller-retour du sélecteur recalculerait un Sky-View Factor à chaque mouvement —
cinq secondes la pièce. Les couches sont donc gardées dans une table, vidée avec
la grille et jamais avant : c'est elle qui définit la validité de ce qui est
dedans. La photo l'est aussi — on ne repaie pas cent requêtes parce qu'on a bougé
un sélecteur.

Et une couche qui échoue **retombe sur l'ombrage** plutôt que de laisser un côté
noir : l'ombrage ne dépend ni du réseau ni d'un calcul long.

### Lissage de l'affichage

Une case à cocher, « Lisser l'affichage », remplace le carré plein par cellule
par une interpolation bilinéaire entre les centres des quatre cellules
voisines (`Vue2D._rendreLisse`). Cochée par défaut, après essai sur de vraies
dalles.

Ce qu'elle fait et ne fait pas : elle retire l'effet d'escalier qui se voit dès
qu'une cellule de 50 cm couvre plusieurs pixels, **sans rien ajouter à la
donnée** — la finesse réelle reste bornée par la densité de points sol, de
l'ordre de 2 à 12 pts/m² selon les dalles (30 à 70 cm entre deux points). Le
gain de précision, s'il existe, viendra de la façon de construire la surface
(triangulation plutôt que minimum par cellule puis comblement), pas de
l'affichage.

Trois points à ne pas défaire :

- **L'interpolation se fait entre centres de cellules**, d'où le décalage d'une
  demi-cellule (`fx - 0.5`). Sans lui l'image lissée glisserait d'une
  demi-cellule par rapport au rendu direct, et tracés comme rideau cesseraient
  de tomber juste en cochant la case.
- **Une voisine sans valeur fait retomber le pixel sur la cellule la plus
  proche** : un trou reste un gris net, jamais une valeur mélangée à du vide.
  Le test coûte zéro ligne de plus — une seule voisine NaN rend la somme NaN.
- **Seulement agrandi** (`parCellule < 1`) : réduit, un pixel résume déjà
  plusieurs cellules, et quatre lectures par pixel n'apporteraient rien.

Mesuré en navigateur sur une dalle chargée : environ 19 ms par image lissée, la
navigation reste fluide.

### La photo aérienne déformée dans la grille

Le point technique qui décidait de tout : les tuiles arrivent en **Web
Mercator**, les grilles sont en **Lambert-93**, et un carré Lambert-93 est tourné
d'environ 1° en Mercator — une vingtaine de mètres en travers d'une dalle
(mesuré : 1,15° et 20,1 m sur une dalle ariégeoise, `test/ortho.test.js`).
Superposées naïvement, les deux couches glisseraient l'une sur l'autre.

Des deux issues possibles, c'est la seconde qui est retenue : **garder le canevas
Lambert-93 et y déformer la photo** (`ortho.js`). Le relief garde sa lecture au
pixel — une cellule, un pixel, aucun rééchantillonnage — et l'artefact tombe sur
la photo, qui n'est que du contexte. C'est le bon endroit pour perdre de la
précision. L'autre issue (une carte Leaflet avec le relief en surcouche) ferait
perdre au relief la netteté qui le rend lisible.

Mesuré sur une dalle réelle : **niveau 18, 100 tuiles** pour 1 km² à 50 cm. La
durée, elle, est celle du réseau et de rien d'autre — **6,5 s** sur une exécution,
**29,6 s** sur une autre, les mêmes tuiles depuis la même machine ; le
rééchantillonnage des 4 M de cellules est négligeable devant. C'est le même
constat que pour le chargement COPC : le débit bridé de l'IGN domine tout, et sa
variance dépasse largement ce qu'on chercherait à optimiser.

Le niveau est choisi comme le premier dont le pixel au sol est au plus égal au
pas de la grille — sur-échantillonner la photo ne lui donne aucun détail, et
chaque niveau de trop quadruple le nombre de tuiles. Le plafond à 19 n'est pas
décoratif : au-delà, la Géoplateforme répond 404 — mesuré en Ariège, à Paris et
en Vanoise, c'est le plafond de la couche et non une limite régionale (voir
« La carte »).

Les tuiles passent par `RESEAU.recuperer` — réessais, 400 fantôme traité comme
transitoire — mais dans **leur propre file**, `tuiles`, à 16 requêtes en vol
(`CONFIG.reseau.requetesParallelesTuiles`). Elles partageaient d'abord celle
des COPC, bornée à 3 pour l'API de téléchargement (10 requêtes/s par IP) :
une photo de dalle mettait 8,3 à 8,6 s, contre 1,5 à 2,1 s dans sa file —
mesuré dans Chrome sur quatre dalles distinctes, pour que le cache ne serve
rien. Le service des tuiles n'a pas la même limite : aucun refus mesuré
jusqu'à ~145 tuiles/s, rafales comprises (aucun chiffre publié). 16 reste
loin du nombre de flux qu'une connexion HTTP/2 accepte, tout l'hôte passant
par une seule — voir « Pièges connus ».

À garder pour plusieurs dalles : la photo coûte ~100 tuiles par km² au zoom
18, donc croît avec la surface. Le WMS de l'IGN (`HR.ORTHOIMAGERY.ORTHOPHOTOS`
sur `wms-r`) rend une image de la taille demandée — jusqu'à 5010 × 5010 px —
**directement en Lambert-93** : une dalle entière en ~4,3 s d'une seule
requête, sans maillage de redressement. Plus lent que les tuiles en parallèle
pour une dalle, mais c'est la bonne forme pour une photo à la taille de
l'écran. Une tuile qui manque après ses
réessais laisse un trou gris, elle ne fait pas échouer la photo entière : une
zone sans orthophoto est un cas normal, et le relief, lui, est là.

**La correspondance est un maillage interpolé, pas une projection par pixel.**
Lambert-93 et Mercator sont tous deux conformes, donc leur composition est
localement une similitude : un nœud toutes les 64 cellules suffit, et l'écart au
calcul exact reste sous le dixième de pixel — mesuré, pas supposé.

Trois pièges. Le premier est celui qui est passé, et il dit tout le reste :

- **La ligne 0 du raster est au sud.** Toutes les grilles du projet indexent
  ainsi — `RASTER.centreCellule` pose `y = ymin + (cy + 0,5)·pas` —, les images
  font l'inverse, et le rééchantillonnage a d'abord suivi la convention des
  images. Résultat : **la photo était retournée nord-sud**, livrée, et vue à
  l'écran par l'utilisateur.

  Ce qui compte est pourquoi les vérifications ne l'ont pas attrapée. Elles
  comparaient le maillage à une correspondance **recalculée dans le test avec la
  même convention que le code** — elles ne pouvaient que passer, y compris celle
  qui remontait jusqu'aux vraies tuiles de l'IGN. C'est le mode de panne déjà
  documenté pour `extraire` : un test qui rejoue l'hypothèse du code n'éprouve
  rien. Le contrôle qui l'attrape fait venir la position d'une cellule de
  `RASTER.centreCellule`, c'est-à-dire de la définition dont dépendent déjà
  `mnt`, `hauteur` et la lecture au curseur : la photo doit s'y plier, et non
  l'inverse. Vérifié en remettant le bogue : trois tests tombent.
- **Ramener le dernier nœud du maillage sur le bord de la grille rompt
  l'espacement.** L'interpolation divise par le pas ; un dernier intervalle plus
  court lui fait appliquer un poids faux, et toute la bande de bord se décale.
  Mesuré : **13 px, soit six mètres au sol**. Les nœuds restent donc à pas
  constant, quitte à ce que le dernier tombe hors de la grille — la projection
  est définie partout.
- **Une photo décalée reste une photo plausible.** Rien à l'écran ne distingue la
  bonne zone de celle d'à côté. D'où un contrôle croisé sur l'adressage des
  tuiles : les indices calculés par la voie des mètres de Mercator sont comparés
  à la formule usuelle « slippy map », qui exprime la même grille autrement. Une
  erreur d'origine ou de convention y saute aux yeux, là où elle serait
  invisible sur l'image.

## Lecture du relief

Un nuage de points est le mauvais instrument pour repérer un objet de six mètres
dans un kilomètre carré : on y voit l'ensemble et jamais le détail. C'est pour
cette raison que la prospection lit des rasters ombrés depuis toujours.
`relief.js` calcule ces images, `vue-2d.js` les affiche dans l'onglet 2D —
canevas, nord en haut, **une cellule pour un pixel en Lambert-93**,
donc aucune reprojection et aucun rééchantillonnage. Les détections et les
tracés s'y superposent gratuitement, eux aussi étant en Lambert-93.

**Rien n'est repris de `sentiers.js`**, pas même son flou. Cette chaîne ne
remonte aujourd'hui aucun tracé ; tant qu'on ignore pourquoi, aucune de ses
pièces ne peut servir de fondation — un lissage faux produirait un micro-relief
faux, d'apparence parfaitement plausible. Les algorithmes sont ceux de la
littérature : gradient de Horn (1981) pour l'ombrage, LRM de Hesse (2010),
Sky-View Factor de Zakšek, Oštir & Kokalj (2011).

Et ils sont **vérifiés contre des surfaces à réponse connue**, parce qu'une
erreur y est invisible à l'œil — un ombrage faux reste une jolie image de
terrain :

| Surface | Réponse attendue |
|---|---|
| plan à 20°, soleil à l'est à 45° | ombrage = sin(20° + 45°), à 10⁻⁵ près |
| plan quelconque | micro-relief **nul partout** — le test qui attrape un flou faux |
| plan horizontal | SVF = 1 exactement |
| plan à 20°, 4 directions | SVF = 1 − sin(20°)/4, à 10⁻⁵ près |

**Deux familles de couches, parce que le classificateur IGN décide du sort d'un
tas de pierres.** Classé 1 ou 6, il est retiré du MNT et le comblement met une
surface lisse à sa place : il disparaît du micro-relief et ne reste visible qu'en
« hauteur des structures ». Classé 2, il *est* le terrain : invisible en hauteur,
visible au micro-relief. Prises ensemble, les deux couvrent les deux cas.

C'est ce déséquilibre que corrige la section suivante — depuis, la surface
affichée montre les deux.

### Ombrage coloré

Retour utilisateur, sur une visualisation vue ailleurs : trois soleils à 120°
l'un de l'autre, chacun sur un canal RGB plutôt que moyennés en gris.
`ombrageMulti` (la couche « Ombrage » actuelle) réglait déjà la disparition
d'un muret parallèle au rayon — quatre directions moyennées, comme le fait
nativement MapLibre sous `hillshade-method=multidirectional` — mais la
moyenne efface au passage *quelle* direction éclairait le mieux. La garder
par canal fait ressortir en teinte l'orientation d'un talus ou d'un mur, là
où le gris l'aplatit. À vérifier : MapLibre lui-même ne fait **pas** de
version colorée nativement — leur `multidirectional` est la même moyenne
grise qu'`ombrageMulti`, quatre directions, pas trois, jamais en couleur. Le
rendu coloré est une technique distincte, apparentée, parfois appelée « RGB
hillshade » dans la littérature de visualisation LiDAR.

`ombrageRGB(t)` (`relief.js`) réutilise `ombrage()` trois fois — 315°, 75°,
195°, un seul calcul de gradients partagé, comme `ombrageMulti` — et écrit
directement un `Uint8ClampedArray` RGBA plutôt qu'un tableau de valeurs. Ce
choix a une conséquence sur toute la chaîne d'affichage : **cette couche ne
suit pas le contrat des autres**, qui passent par `RELIEF.calculer()`
(palette + étalement + chronométrage). Elle est donc tenue hors de
`RELIEF.COUCHES` — le test qui parcourt cette liste (`test/relief.test.js`,
« une couche se calcule par sa clé… ») vérifie justement que chaque entrée
suit ce contrat, et l'y ajouter l'aurait fait échouer pour de bonnes raisons.
`app.js` la déclare à part (`OMBRAGE_RGB`) et la traite exactement comme la
photo aérienne — un RGBA tout fait, `{ type: 'photo', rgba }` — ce qui lui
donne gratuitement le même comportement partout où « c'est une image, pas un
champ scalaire » compte déjà : `Vue2D` ne cherche pas de palette, le curseur
de contraste n'a pas de prise dessus, et le drapage sur le nuage 3D (mode
« Relief ») retombe sur l'autre côté du rideau — le même repli que pour la
photo, déjà en place.

### Ce que la surface affichée retient, et ce qu'elle refusait

Deux classes étaient jetées à la rastérisation (`default: break`) ou effacées par
le comblement. Les rendre au terrain change ce qu'on voit, et la mesure au banc
le dit sans ambiguïté.

**L'eau est du terrain.** Une surface d'eau ne renvoie aucun point « sol » :
ignorée, elle laissait un trou que le comblement refermait depuis les berges,
c'est-à-dire un dôme ou un plan incliné là où il y a un plan d'eau horizontal.
L'artefact est parfaitement lisible en ombrage et en Sky-View Factor, et il n'est
pas du terrain. La classe 9 est donc versée dans l'accumulateur du sol — ce qui
est aussi la convention des MNT, la surface de l'eau étant la surface du sol — et
**ne coûte pas un octet** : pas de tableau supplémentaire, à 16 M de cellules
chaque `Float32Array` en vaudrait 64 Mo.

**Une ruine est opaque au laser**, et c'est ce qui l'efface. Elle ne laisse aucun
retour sol sous elle ; le comblement met à sa place une surface lisse interpolée
depuis ses bords, et elle disparaît exactement de la couche où on la cherche. Les
points **non classés**, eux, sont là — ce sont ceux de la ruine. La surface
affichée les prend donc **là où il n'y a aucun retour sol**, jamais ailleurs :
substituer une mesure à une valeur inventée ne peut pas dégrader la surface.

Mesuré au banc, cible = la couronne du mur, structure classée « bâtiment » :

| Couche | d′ avant | d′ après |
|---|---|---|
| ouverture négative | 1,4 | **29,5** |
| micro-relief | 0,4 | **14,0** |
| Sky-View Factor | 1,9 | **10,8** |
| ouverture positive | 1,4 | **8,7** |

Les lignes « classé sol » du même banc sont **identiques au chiffre près**, ce qui
est le contrôle qui compte : on ne remplace jamais du sol mesuré.

Trois points à ne pas défaire :

- **Le plafond de hauteur n'est pas un raffinement.** La classe 1 recueille aussi
  tout ce que le classificateur n'a pas su ranger, végétation comprise. Sans lui,
  un retour de branche à vingt mètres deviendrait un pic de terrain. Une ruine, un
  muret, une charbonnière tiennent sous trois mètres ; un arbre non.
- **`hauteur` reste mesurée contre le sol comblé**, jamais contre la surface
  complétée — sinon toute structure aurait une hauteur nulle par construction. De
  même, `trou` garde son sens strict (aucun retour **sol**) : c'est l'indice le
  plus physique de la détection, et le compléter le viderait.
- **`analyse` ne prend pas la substitution.** `lignes.js` construit son enveloppe
  en ajoutant `hauteur` à cette surface : une structure qui serait déjà dans l'une
  et encore dans l'autre compterait double. Vérifié — le banc en configuration de
  production (50 cm) est **identique au caractère près** avant et après.

**L'ouverture de Yokoyama (1998), positive et négative**, sort du même balayage
d'horizons que le SVF : une passe, trois couches, et un mémo pour que passer de
l'une à l'autre ne repaie rien. Le coût mesuré sur une dalle à 50 cm, 8
directions sur 10 m, passe de 3,16 s à 4,83 s — le supplément vient des deux
`atan` et du suivi du minimum, pas de l'échantillonnage.

Pourquoi l'ajouter alors que le SVF est déjà là : l'ouverture **efface la pente
d'ensemble exactement**, et non approximativement. Sur n'importe quel plan
incliné elle vaut 90°, parce que ce qui est vu vers l'amont annule ce qui est vu
vers l'aval. Un seuil calé en plaine vaut encore à 30° — ce qu'aucune valeur en
mètres ne sait faire, et c'est la raison d'être des « seuils en multiples de la
rugosité locale » de `sentiers.js`.

Et **les rôles des deux signes ne sont pas ceux que l'intuition suggère** —
mesuré sur un anneau de pierre synthétique de 4 m de diamètre et 60 cm de haut :

| | Ouverture positive | Ouverture négative |
|---|---|---|
| couronne du mur | 90,0° — **invisible** | 58,6° — le signal |
| intérieur de l'enclos | 72,1° — le signal | 90,0° — invisible |
| sol nu, à plat comme à 20° | 90° | 90° |

La couronne ne ressort pas en ouverture positive parce qu'un mur est **de niveau
le long de lui-même** : l'horizon y reste à 90°. C'est en regardant vers le bas
qu'on le voit dominer. Chercher le mur dans la mauvaise couche ne rendrait donc
rien du tout — et la signature complète d'une cabane ruinée est bien une paire,
couronne en ouverture négative autour d'un enclos en ouverture positive.

Trois pièges, dont un vu à l'écran avant d'être compris :

- **Une cellule sans donnée doit être écartée du balayage, pas seulement de la
  lecture.** Elle porte une altitude de **repli** — la médiane de la dalle — qui
  n'a aucun rapport avec le terrain local : dans une combe, elle vaut plusieurs
  mètres de trop. Elle se comporte alors comme une tour, et toute cellule qui la
  voit voit son horizon monter. Comme il n'y a que huit directions, l'ombre ne
  s'étale pas : elle forme **une étoile à huit branches** autour de chaque trou.
  Signature reconnaissable, et signalée par l'utilisateur avant d'être comprise ;
  reproduite ensuite sur un plan horizontal percé d'un trou de 2 × 2 cellules —
  **12 % de SVF** d'ombre portée jusqu'à sept mètres du trou.

  La correction ne coûte rien, et c'est ce qui a demandé un deuxième essai. Un
  test de validité par échantillon marche, mais alourdit la boucle la plus chaude
  du projet de **36 %** (mesuré : 3,77 s → 5,13 s). La surface balayée porte donc
  **NaN** dans les cellules sans donnée : NaN rend fausses *toutes* les
  comparaisons, donc `tan > maxTan` et `tan < minTan` échouent ensemble et
  l'échantillon est ignoré sans qu'une seule ligne soit ajoutée à la boucle —
  3,70 s, soit le temps d'avant. Le prix assumé est une légère cécité au bord des
  trous : un échantillon dont l'interpolation touche un trou est rejeté en entier.
  Il éclaircit un peu, là où le défaut assombrissait en étoile.

  Et la cellule sans donnée rend **NaN** plutôt qu'un nombre : le canevas la peint
  en gris neutre, et les seuils des chaînes d'analyse rejettent toute comparaison
  avec NaN. Elle est ignorée, pas devinée.
- **Le rayon doit tomber exactement sur sa direction.** Avec des décalages
  entiers (`Math.round`) le rayon zigzague ; le maximum retient alors le pas le
  plus tourné vers l'amont et le minimum le moins tourné, si bien que les deux
  ne se compensent plus entre une direction et son opposée. Sur un plan à 20°,
  l'ouverture tombait à **88,6° au lieu de 90** avec 16 directions — un biais de
  1,4° dépendant de la pente locale, sur une couche dont le signal utile vaut
  quelques degrés. Avec 8 directions il ne se voyait pas : elles tombent sur les
  axes et les diagonales. D'où le parcours sur l'axe dominant avec interpolation
  sur l'autre — exact, et 18 % plus rapide que l'arrondi à travail égal.
- **Ne jamais chronométrer dans le harnais de test.** Les sources sont chargées
  dans un contexte `vm.createContext`, où ces boucles tournent **sept fois plus
  lentement** qu'en contexte natif : 36 s contre 4,8 s pour le même balayage.
  Un chronométrage pris là conduirait à jeter du code parfaitement sain.

### Le banc synthétique tranche trois choix

`npm run banc` (`tools/banc-lignes.js`) mesure, sur huit scènes à vérité connue,
ce qu'aucun raisonnement ne pouvait décider. L'échantillonnage y est réaliste —
points de Poisson à 10 /m², bruit vertical de 5 cm, cellules vides comblées comme
le fait `raster.js` — parce que c'est justement le bruit d'échantillonnage qui
est en jeu.

Le seuil est calibré sur l'orri de référence — celui qui retient 90 % des
cellules de sa couronne — puis appliqué tel quel aux autres scènes. Résultats à
50 cm, cible = la couronne du mur :

| Couche | d′ (classé sol) | d′ (classé bâti) | fond franchi sur une croupe | sur un chaos rocheux |
|---|---|---|---|---|
| **ouverture négative** | **11,4** | **12,1** | **0,1 %** | 4,3 % |
| micro-relief | 13,7 | 13,7 | **96 à 99,5 %** | 3,3 % |
| ouverture positive | 1,7 | 0,5 | — | — |
| Sky-View Factor | 1,1 | 0,4 | — | — |

**1. La couche, c'est l'ouverture négative — mais le micro-relief avait l'air de
faire jeu égal.** Sur un plan, les deux séparent aussi bien : le micro-relief
soustrait un plan exactement, l'ouverture l'annule par symétrie. La différence
n'apparaît que sur un terrain **courbe**, où la moyenne locale du micro-relief
laisse un résidu du relief général. Sur une croupe convexe de 40 m de rayon,
c'est **tout le versant** qui franchit le seuil réglé sur du plat — 96 à 99,5 %
des cellules — contre 0,1 % pour l'ouverture. Et le rayon de lissage employé
(6 m) est le cas **favorable** au micro-relief : le résidu croît avec le carré du
rayon, donc les 12 m du réglage courant feraient pire. Un banc composé
uniquement de plans aurait conclu que les deux couches se valent : c'est la
raison d'être des scènes « croupe » et « combe ».

**2. La surface d'entrée est le MNT relevé de la hauteur, jamais le MNT seul.**
Une structure classée bâtiment est retirée du MNT et comblée : sa crête n'y
existe plus du tout, et la mesure le confirme — d′ tombe à 0,4, c'est-à-dire
rien. Sur la surface enveloppe, elle se lit aussi bien que si elle avait été
classée sol : 12,1 contre 11,4.

**3. Le pas est 50 cm, et non 25.** À 25 cm, 54 % des cellules ne reçoivent aucun
point ; à 50 cm, 8 %. La dispersion du fond passe de 3,43° à 2,06° et le d′ de
7,3 à 11,4 — la finesse perdue sur le mur est plus que rendue par le bruit
évité, et le calcul est seize fois plus léger.

**Ce qu'il reste à battre : 4,3 % sur le chaos rocheux.** Le seuil seul ne
distingue pas un bloc d'un mur, et c'est exactement ce qu'annonçait la
littérature. Sur une dalle entière, ces 4,3 % font 170 000 cellules — mais
dispersées, alors qu'un mur forme une ligne fermée. Le tri ne peut donc pas
venir du seuil : il vient de la **forme** et de la **topologie**, qui sont l'objet
de l'étape suivante.

La grille d'affichage est à **50 cm**, sous-échantillonnée depuis celle de
détection. À 25 cm une cellule ne reçoit que 0,6 point et le MNT y est surtout du
bruit ; à 50 cm elle en reçoit deux ou trois, un mur de 50 cm occupe toujours une
cellule pleine, et le calcul est seize fois plus léger — ce qui décide de la
faisabilité du Sky-View Factor, seul calcul coûteux du lot et donc calculé à la
demande, avec sa durée affichée.

## Le calcul sur la carte graphique

Le relief et le terrain sont du calcul cellule par cellule : exactement ce que
fait une carte graphique, des milliers à la fois. `gpu-relief.js` porte sur
WebGL2 le balayage d'horizons (SVF, ouvertures), les ombrages, le micro-relief
et le terrain de `RASTER.finaliser` (comblement, repli, lissage, pente). Les
noyaux vivent dans `shaders.js`, section « Calcul du relief », pour rester
sous le garde-fou du backtick.

Mesuré sur une dalle entière, carte graphique **intégrée** d'ordinateur
portable (AMD Radeon, Direct3D 11), transferts compris :

| Étape | Processeur | Carte graphique |
|---|---|---|
| SVF | 12,5 s | 1,1 s |
| Ouvertures | 11 à 14 s | 0,8 à 1,2 s |
| Terrain, 16 M de cellules à 25 cm | 5,0 s | 2,5 s |
| Ombrage, ombrage coloré | 0,45 s | 0,3 à 0,4 s |
| Micro-relief | 0,97 s | 1,08 s |

L'attente visible après un téléchargement, SVF affiché, passe d'environ 18 s
à environ 4,5 s. Le SVF seul, calcul pur, coûte 0,31 s : **le reste est du
transfert** — envoyer la grille, rapatrier le résultat. C'est pourquoi ombrage
et micro-relief ne gagnent rien, et pourquoi l'agrégation à 50 cm
(`RELIEF.preparer`, 0,85 s, neuf grilles à envoyer) et l'accumulation des
points (déjà cachée derrière le téléchargement) sont restées sur le
processeur. Un affichage de plusieurs dalles sans attente demandera des
grilles qui **restent** sur la carte graphique, de l'accumulation à
l'affichage, sans aller-retour.

Quatre décisions :

- **`relief.js` et `raster.js` restent la référence et le repli.** Chaque noyau
  en est la traduction ligne à ligne ; `moteur: 'cpu'` ou `CONFIG.relief.gpu`
  à `false` forcent le processeur, et `RELIEF.calculer` dit dans `moteur` qui
  a calculé.
- **Rien n'est employé sans autocontrôle.** Au premier usage, une petite
  surface (pente, bosse, creux, trous petits et grands) est calculée des deux
  façons ; au moindre écart hors tolérance, tout reste sur le processeur, avec
  la raison dans la console. Le premier essai réel l'a prouvé utile : la carte
  graphique était refusée, et sans ce contrôle elle aurait affiché des bords
  faux.
- **Un contexte WebGL à part**, jamais celui de la vue 3D.
- **Par bandes de 256 lignes** : un seul appel de dessin sur une dalle entière
  peut dépasser le délai au-delà duquel Windows réinitialise la carte
  graphique sur une machine lente.

Deux pièges de simple précision, tous deux invisibles à l'intérieur de la
grille et vus aux bords et autour des trous, là où un échantillon qui change
de ligne sort de la grille ou tombe sur une cellule sans donnée :

- **cos(90°) vaut −4·10⁻⁸ en simple précision**, et le rayon plein nord lisait
  la colonne voisine. Les directions sont calculées en double côté JavaScript
  et passées en uniforms.
- **Le pas en diagonale vaut 0,9999999999999998 et s'arrondit à 1** : le
  plancher désignait la ligne suivante. Le pas de l'axe mineur arrive donc en
  deux morceaux (valeur simple précision + reste), et le plancher se recompose
  **depuis l'entier le plus proche** — partir de `floor(a)` échoue quand
  `a − floor(a)` s'arrondit à 1, ce qui a d'abord décalé les colonnes de bord.

Écarts résiduels, mesurés sur une vraie dalle : SVF 1,2·10⁻⁷, ouvertures
7·10⁻⁴ degré (précision de l'arctangente), altitude du terrain 2·10⁻⁵ m, pente
décalée d'un degré sur 0,06 % des cellules (l'arrondi à l'entier supérieur
bascule).

Les mesures se font **dans le vrai Chrome de Windows, sur la vraie carte
graphique** : le Chromium de WSL n'a qu'une carte émulée (SwiftShader), juste
pour vérifier des valeurs. Harnais jetable : un petit serveur HTTP dans WSL,
joignable depuis Windows par `localhost`, une page qui envoie son verdict par
POST — et qui doit être servie en `text/html`, sans quoi Chrome l'affiche
comme du texte sans rien exécuter.

## Extraction de lignes : la chaîne par la forme

`lignes.js` cherche des structures **sans lire le classement** : un tas de
pierres rangé en « sol » par l'IGN ne produit aucun signal pour `detection.js`,
puisqu'il *est* le terrain. Ici, seule la forme compte — un mur ruiné est une
crête, un chemin creux la même figure de signe opposé, d'où un module destiné aux
deux et non deux chaînes parallèles.

Ce qui sépare une cabane d'un sentier n'est pas le filtre mais la **topologie** :
une structure est une ligne qui se referme. La fermeture se mesure en
**couverture angulaire** autour d'un centre ajusté par cercle (Kåsa), et non par
un test de boucle : un mur ruiné a une entrée, l'anneau troué est le cas normal.

Résultat sur les vingt scènes du banc : **8 structures sur 8 retrouvées**, centre
à 0,33–0,39 m, **0 faux positif sur 12 scènes négatives** — dont un chaos de 240
blocs qui allume pourtant 3,2 % des cellules. Coût sur une dalle entière :
**4,8 s**, dont la totalité dans le balayage d'horizons, mémoïsé et partagé avec
l'onglet 2D.

### Ce que le banc a démenti

Quatre décisions du plan initial ont été retournées par la mesure. Elles sont
listées parce que chacune paraissait évidente, et qu'aucune ne l'était :

- **Frangi ne sert pas ici.** Le plan prévoyait une réponse de crête
  multi-échelle. Mesurée, elle trouve l'orri sur une fenêtre de réglage
  minuscule (`partHaute` = 0,003 ; à 0,01 elle ne trouve plus rien, à 0,05 elle
  invente 16 structures sur un versant nu) et **manque la cabane
  rectangulaire**. Le seuil direct sur l'ouverture trouve les huit, sans réglage
  délicat. La raison est compréhensible après coup : l'ouverture *est déjà* une
  réponse normalisée et sélective en forme ; y enchaîner un second filtre de
  forme amplifie surtout le bruit. Frangi garde son sens sur une altitude brute,
  pas sur une mesure de domination angulaire. `reponseCrete` reste dans le
  module, comparable au banc par `mode: 'frangi'`.
- **L'amincissement dégrade.** Zhang-Suen était au plan. Mesuré : la couverture
  d'un orri tombe de 0,94 à 0,72 et le centre se déplace de 0,34 à 0,45 m, parce
  qu'il ronge la couronne de façon dissymétrique. Il ne servait qu'à rendre
  lisible un critère de remplissage qui, lui, n'attrape rien. Désactivé par
  défaut, gardé pour la branche des lignes ouvertes.
- **Le seuil ne peut pas être un quantile de la réponse.** Premier essai : seuils
  hauts et bas en quantiles. Cas limite fatal — quand la réponse est creuse, moins
  de cellules sont non nulles que le quantile n'en demande, le seuil tombe à zéro
  et l'hystérésis **inonde la grille entière**. Le seuil est donc en **degrés sous
  90°**, ce que seule l'ouverture permet puisqu'elle vaut exactement 90° sur tout
  plan : une valeur absolue qui transfère d'une dalle à l'autre.
- **La géométrie seule ne distingue pas une cabane d'une plateforme.** Le rebord
  d'une plateforme à bords francs est un anneau parfait — couverture 0,92, taille
  plausible. Ce qui les sépare est **l'intérieur**, lu dans l'ouverture *positive*
  qui sort du même balayage : une cabane s'enferme de 18 à 26°, un rebord de
  plateforme de 9,9°. S'y ajoute un critère physique — le mur doit dépasser de son
  propre intérieur d'au moins 25 cm — qui écarte le **dôme fabriqué par le
  comblement du MNT** sous une structure classée bâtiment, lequel descend au lieu
  de monter.

**Le point fragile, à surveiller sur données réelles :** la marge entre une
structure (18° d'enfermement au pire) et un rebord de plateforme (9,9°) ne fait
que 2° de part et d'autre du seuil. C'est le seul critère de la chaîne dont la
marge soit étroite.

### Branchée, et ce que le branchement a révélé

Les deux voies versent dans **la même liste** : même fiche, même sélection, même
export, même rapprochement BD TOPO. Seul le champ `voie` dit d'où vient chaque
candidat — `classement`, `forme`, ou `les deux`. Sans cette trace on ne saurait
plus quel seuil régler. Une case du panneau active la voie par la forme, qui
coûte environ 5 s de plus.

Le score ne peut pas être celui de `DETECTION.noter` : celui-là pèse la part de
points non classés et la hauteur du signal, qui valent **zéro** pour une ruine
classée « sol ». La meilleure trouvaille de cette voie y marquerait donc le plus
mauvais score. `noterForme` note sur les trois preuves propres à la voie : la
ligne se referme, l'intérieur est fermé, le mur dépasse.

Le branchement a mis au jour trois choses que le banc, lui, ne pouvait pas voir :

- **Le banc était optimiste, parce qu'il ne passait pas par `raster.js`.** Il
  rastérisait directement à 50 cm en moyennant les points. Le vrai MNT retient le
  **Z minimum** des points sol — juste pour un modèle de terrain, mais cela érode
  un mur d'une cellule de chaque côté. Le banc rastérise maintenant un nuage
  complet et passe par `RASTER.rasteriser` puis `RELIEF.preparer`, comme
  l'application. **Un banc qui n'emprunte pas la chaîne de production calibre des
  seuils qui ne valent que pour lui.**
- **Et une fois fidèle, il a montré que la voie par la forme était aveugle au cas
  pour lequel elle existe.** Une cabane classée « sol » : masque à 0,0 %, rien.
  Cause : à 25 cm une cellule ne reçoit que 0,6 point, plus de la moitié du mur
  est comblée depuis le sol voisin, et l'agrégation à 50 cm **moyennait** ensuite
  murs et sol — la crête finissait divisée par deux, sous le seuil. D'où
  l'agrégation par le **maximum des cellules réellement mesurées**, sur `solZ`
  brut et non sur le MNT comblé. Le maximum ne fabrique rien : il choisit, parmi
  des altitudes de sol toutes réelles, la plus haute du bloc.

  **Mais il amplifie le bruit d'échantillonnage**, et l'avoir appliqué au MNT
  d'affichage s'est vu immédiatement à l'écran : le Sky-View Factor est devenu
  franchement plus granuleux. `RELIEF.preparer` rend donc **deux surfaces** —
  `mnt`, la moyenne, que lisent toutes les couches affichées, et `analyse`, le
  maximum, que `lignes.js` seul consomme. Conséquence à accepter : les deux
  surfaces étant différentes, le balayage d'horizons de la détection ne peut pas
  être partagé avec celui de l'affichage, et la voie par la forme coûte ses 5 s
  quoi qu'il arrive.
- **La voie par classement rejette structurellement les anneaux.** Mesuré sur une
  cabane classée « bâtiment » dont les murs tiennent : rectangularité **0,51**
  pour un seuil à 0,55, donc rejetée. Ce n'est pas un réglage malheureux — cette
  mesure est un taux de remplissage `surface / enveloppe convexe`, et un anneau
  est creux par définition. La voie par classement écarte donc une cabane
  **parce qu'**il lui manque son toit. Baisser le seuil n'est pas la réponse : il
  est déjà sous le plafond d'un disque (0,785) pour laisser passer les orris
  ronds.

### Le mode de panne à ne pas reproduire

La voie par la forme n'a **rien remonté du tout** lors du premier essai réel, en
silence. Cause : `extraire` ne fusionnait que `CONFIG.lignes` dans ses réglages,
alors que la portée du balayage — `svfRayonM` — vit dans `CONFIG.relief`. Elle
valait donc `undefined`, la marge de bord devenait `NaN`, toute comparaison avec
`NaN` rend faux, et le masque sortait vide sur la dalle entière. Aucune erreur,
aucune trace : juste « aucune structure trouvée », qui est un résultat plausible.

**Les tests ne l'ont pas vu parce qu'ils passaient tous la portée
explicitement.** C'est la leçon générale : un test qui surcharge un réglage
n'éprouve pas le chemin qu'emprunte l'application. Le banc et les tests s'en
remettent désormais aux réglages de production, et `extraire` lève si la marge
n'est pas finie — un réglage manquant ne doit jamais se traduire par un résultat
vide, le mode de panne le plus coûteux du projet étant celui qui ressemble à
« il n'y a rien à cet endroit ».

Les deux voies sont **complémentaires et non redondantes**, ce que vérifie
`test/voies.test.js` sur le même nuage : un bâti plein est vu par le classement
et pas par la forme — il n'a pas d'intérieur fermé au ciel — tandis qu'un anneau
est vu par la forme et pas par le classement. Un mur épais est vu par les deux, à
moins de deux mètres près, ce qui rend la fusion possible.

`sentiers.js` n'a pas été touché.

### Le relief dans le nuage

Un cinquième mode de coloration plaque la couche de relief courante sur les
points du nuage. Le point prend la valeur de la **cellule qu'il survole**, et non
la sienne : une couche d'ombrage ou d'ouverture décrit un voisinage, pas un
point.

Trois choix, tous pour la même raison — que les deux vues soient *la même image* :

- l'intervalle d'étalement est celui déjà calculé pour le canevas 2D, contraste
  compris, et il suit le curseur de contraste ;
- changer de couche dans l'onglet 2D met le nuage à jour, et charger une
  nouvelle dalle conserve le mode. La couche drapée est celle du **côté droit**
  du rideau, ou la gauche si la droite porte la photo — il faut bien en choisir
  une, et la droite est le côté du relief par convention ;
- la rampe est le même gris neutre. Y mettre des couleurs ferait croire à une
  échelle qui n'existe pas — une couche d'ombrage se lit par le modelé.

L'attribut de sommet est **partagé avec le mode « hauteur »** et réécrit au
changement de mode : un attribut de plus coûterait 18 Mo de mémoire graphique sur
une dalle, pour une donnée dont on n'a jamais besoin des deux à la fois.

## Ce que l'outil dit quand ça ne marche pas

Un message d'erreur juste et inutile est un défaut à part entière. « HTTP 429 sur
https://data.geopf.fr/… » est exact, et ne dit ni si c'est réparable, ni s'il
faut attendre, ni si c'est la faute de l'utilisateur. Or **chaque panne a une
conduite à tenir différente** — attendre pour un 429, relancer pour un délai
dépassé, vérifier son réseau pour un échec de connexion — et c'est cette conduite
qui manquait, pas le code.

`RESEAU.expliquer` traduit ; les appelants ne fournissent que le contexte de ce
qui a échoué. Trois règles :

- **L'état hors ligne prime sur tout le reste.** Sans réseau, les autres
  diagnostics envoient chercher un problème chez l'IGN.
- **Une panne inconnue passe telle quelle.** Mieux vaut une phrase technique
  qu'une phrase rassurante et fausse : celle-là, au moins, se cherche dans un
  moteur de recherche.
- **Jamais d'URL à la figure.** Vérifié mécaniquement.

Le voile d'alerte s'efface après une durée **proportionnelle à la longueur** du
message : une phrase qui dit quoi faire fait deux lignes, et sept secondes ne
suffisent pas à la lire.

### Les états vides, un par un

- **Clic hors de France.** Écarté avant même d'interroger le WFS, et surtout
  avant de projeter en Lambert-93, qui n'est défini que pour la France.
  `PROJ.dansEmpriseFrance` est un **rectangle englobant**, pas une frontière : il
  déborde sur la mer et les pays voisins, et c'est assumé — il ne sert qu'à
  choisir entre deux messages qui n'ont rien à voir, « le LiDAR HD ne couvre que
  la France » et « cette zone n'a pas encore été volée ».
- **Dalle sans sol connu.** Toutes les couches y valent NaN, ce qui est juste,
  mais un aplat gris sans un mot se lit comme une panne de l'outil et non comme
  une absence de donnée. En dessous de 2 % de cellules valides, l'outil le dit.
- **Cas mobile.** Une dalle pleine fait 190 Mo à télécharger et 400 à 520 Mo de
  grilles en mémoire — au-delà de ce qu'un navigateur mobile accorde à un onglet,
  qu'il ferme sans prévenir. Le niveau proposé par défaut y est donc plafonné
  (`budgetOctetsMobile`), et le coût annoncé porte un avertissement au-delà. Le
  curseur reste libre : on avertit, on n'interdit pas. La détection d'appareil
  portatif est une heuristique grossière — pointage tactile et écran étroit —
  parce qu'il n'y a rien de mieux : `userAgentData.mobile` n'existe pas partout
  et l'agent utilisateur ment. Se tromper ne coûte qu'une phrase de trop.

### Sans WebGL2, seul l'onglet 3D tombe

C'est le seul morceau de Scopus qui en dépende : la carte est en Leaflet, la vue
2D est un canevas ordinaire, les grilles et le relief sont du calcul pur. Perdre
le nuage de points ne doit donc pas perdre l'outil.

Ce n'était pas le cas. `ouvrirDalle` appelait `vue3d.definirNuage` sans
précaution : le chargement échouait au milieu, et l'utilisateur restait avec une
interface à moitié morte et un message parlant de contexte WebGL. Tous ces appels
passent désormais par `vue3d?.`, l'onglet est **désactivé** — `basculerVue` refuse
un onglet désactivé, y compris au clavier — et un avis persistant dit à la fois ce
qui manque et ce qui marche quand même.

## Voile d'attente : pourquoi la roue tourne

Les traitements lourds sont **synchrones**. Tant qu'ils tournent, le navigateur
ne répond plus — ni au défilement, ni aux clics. Sans rien à l'écran, l'onglet
paraît planté.

Le piège est qu'un indicateur d'attente ordinaire ne marcherait pas : rien n'est
peint tant que la pile JavaScript n'est pas vide, donc une roue lancée juste
avant le calcul resterait figée, ce qui est **pire que pas de roue du tout**.

Ce qui sauve la mise : une animation CSS qui ne touche que `transform` est
portée par le **compositeur**, un fil distinct de celui du JavaScript. Elle
continue de tourner pendant le blocage — à condition d'avoir démarré avant.
D'où `ATTENTE.respirer()`, deux images laissées passer pour que le voile soit
peint et l'animation lancée, et seulement ensuite le calcul.

**Ne jamais animer autre chose que `transform` ou `opacity` dans ce voile.**
Toute propriété qui demande un recalcul de style ou une mise en page repasserait
par le fil principal et figerait la roue.

Le libellé se met à jour entre deux tranches par `await etape('…')`, qui rend la
main au navigateur le temps de l'afficher. Changer le texte sans attendre ne
produirait rien.

Ce qui est enveloppé, relevé dans le code :

| Traitement | Pourquoi c'est long |
|---|---|
| `RASTER.finaliser` | 12 passes de comblement sur 16 M de cellules, puis la pente |
| `DETECTION.detecter` | morphologie et étiquetage sur 16 M de cellules |
| `SENTIERS.detecterSentiers` | 3,8 s mesurés sur une dalle |
| `RELIEF.svf`, `RELIEF.ouverture` | 8 directions × 20 pas sur 4 M de cellules, un seul balayage pour les trois |
| `LIGNES.extraire` | le même balayage, 4,8 s sur une dalle — le reste de la chaîne est négligeable |
| `RELIEF.preparer` | une passe sur 16 M de cellules |
| `ORTHO.charger` | 100 tuiles WMTS puis 4 M cellules rééchantillonnées |
| `Vue3D.definirNuage` | 4,4 M points entrelacés puis téléversés |

Les couches de relief rapides — ombrage, micro-relief — n'y passent **pas** : sur
un calcul de cent millisecondes, voir le voile apparaître et disparaître est plus
désagréable que l'attente.

## Pièges connus

- **`data.geopf.fr` renvoie des `400` fantômes.** Mesuré, pas supposé : la même
  URL de tuile, valide, alterne 200 et `400 InvalidParameterValue — Layer
  ORTHOIMAGERY.ORTHOPHOTOS unknown`. Sur vingt requêtes identiques, quatre
  refusées en parallèle, huit en série, et un 200 immédiat au réessai. La
  passerelle est répartie et certains nœuds ignorent la couche. Conséquence :
  **le 400 est traité comme transitoire** dans `reseau.js`, et les tuiles Leaflet
  — qui ne réessaient jamais et laissent un trou gris définitif — sont
  redemandées jusqu'à trois fois sur `tileerror`. Ne pas « corriger » l'URL en
  réponse à ce 400 : elle est juste.
- **Tout passe par le même hôte, donc par une seule connexion HTTP/2.** Tuiles
  WMTS, WFS des blocs, dalle au point, BD TOPO et les centaines de requêtes de
  plage du COPC vont toutes à `data.geopf.fr`. Leaflet **ne passe pas** par la
  file bornée de `reseau.js` et demande des dizaines de tuiles d'un coup à chaque
  déplacement : dépasser le nombre de flux acceptés vaut un `REFUSED_STREAM`, qui
  arrive côté `fetch` comme une panne réseau franche et consomme les réessais de
  requêtes qui, elles, comptent. D'où `updateWhenIdle` sur les couches de tuiles.
- **`fetch` n'a aucun délai maximal.** Une requête que la passerelle laisse
  pendre immobilise une place en vol pour toujours, et le chargement s'arrête
  sans message. Mesuré un jour de charge sur `data.geopf.fr` : `GetCapabilities`
  à 22 s, une requête de blocs à 48 s puis en échec, la même répondant en 0,2 s
  en temps normal. `reseau.js` pose donc un délai **par tentative**. Attention en
  le touchant : le délai arrive sous la forme d'un abandon, exactement comme
  l'annulation de l'utilisateur — les confondre rend un chargement définitivement
  perdu pour une seule requête trop lente. Le verdict se prend sur
  `signal.aborted`, jamais sur le nom de l'erreur.
- **Le tas WASM détache ses vues quand il grandit.** laz-perf alloue ses tampons
  internes en cours de décompression ; une croissance remplace l'ArrayBuffer
  sous-jacent et toute `DataView` mise en cache devient inutilisable
  (« Cannot perform DataView.prototype.getInt32 on a detached ArrayBuffer »).
  Le pointeur `dst`, lui, reste valide. `decodeur.js` compare l'identité
  du tampon à chaque point et reconstruit la vue au besoin. Ne pas « optimiser »
  ce test.
- **Un gestionnaire `async` qui rejette dans un Worker est silencieux.**
  `onerror` ne se déclenche pas, aucun message ne part, et le fil principal
  attend indéfiniment. L'initialisation du worker renvoie donc explicitement un
  message `echecInit`.
- **Le BBOX du WFS 2.0 en CRS urn attend (lat, lon).** L'ordre des axes suit la
  définition officielle d'EPSG:4326, pas l'habitude « lon, lat » du GeoJSON.
  Inverser les deux ne produit aucune erreur, juste zéro résultat.
- **Le format WMTS n'est pas interchangeable.** `PLANIGNV2` est en `image/png`,
  `ORTHOPHOTOS` en `image/jpeg` ; l'autre combinaison renvoie une erreur XML,
  pas une tuile. `FORMAT` reste percent-encodé dans l'URL, le service l'accepte.
- **Un carré Lambert-93 est tourné en WGS84.** `L.rectangle` produit un
  rectangle aligné sur l'écran ; superposé à une dalle, il paraît de travers.
  Toujours passer par un polygone de côtés reprojetés (`GRILLE.contourEmprise`).
- **Le WFS des dalles plafonne à 600 entités, en silence.** Une vue large reçoit
  un sous-ensemble trié par colonne, jamais une erreur. Ne jamais l'interroger
  par fenêtre pour de l'affichage.
- **Leaflet ne publie rien pendant l'animation de zoom.** Un canevas superposé
  resterait dessiné à l'échelle précédente, visiblement décalé : la couche
  `GrilleDalles` se masque sur `zoomstart` et se redessine sur `zoomend`.
- **Leaflet mesure son conteneur à l'initialisation.** Monté masqué, il l'a
  mesuré à zéro et n'affichera aucune tuile tant qu'on ne lui redit pas
  (`invalidateSize`). D'où l'appel au retour sur l'onglet carte.
- **Un 200 en réponse à un `Range` ne veut pas dire que la plage a été
  ignorée.** Le cache HTTP du navigateur a le droit de servir la plage lui-même
  et annonce alors 200 avec exactement les octets demandés — observé sur
  data.geopf.fr après un réessai. Le verdict doit se prendre sur la **taille
  reçue**, jamais sur le statut ; juger sur le statut faisait échouer des
  chargements dont les données étaient justes.
- **`--virtual-time-budget` de Chrome headless ment sur les Workers.** Les
  minuteurs de la page se déclenchent instantanément pendant que le worker
  tourne en temps réel : un test bâti dessus rapporte des blocages inexistants.
  `.tmp/run-browser.js` fait renvoyer son verdict par la page elle-même.
- **Deux fichiers locaux sont deux origines opaques.** Un `iframe` vers un autre
  `file://` est inaccessible depuis le parent, et la `SecurityError` survient à
  l'accès à `contentWindow` — donc hors de tout `try` placé plus loin. Les
  vérifications de page s'exécutent dans le même document.
- **Les grilles travaillent en altitude relative, les sorties en absolue.**
  `origine[2]` (le bas de la dalle) est retiré des Z au décodage, pour garder la
  précision en Float32. La détection le remet dans `altitudeSol`, une fois pour
  toutes : tout ce qui sort — élévation GPX, caméra Google Earth, boîtes du
  nuage 3D — veut une altitude vraie. L'oubli s'était vu à l'écran, les boîtes
  se dessinant 1 500 m sous les points.
- **Un canevas masqué mesure 0 × 0.** Tout calcul de rayon y produit un aspect
  `0/0`, et la cible de la caméra part en NaN — définitivement, plus rien ne la
  ramène. `_pointSousCurseur` rend `null` dans ce cas.
- **Une règle `display` d'auteur annule l'attribut `hidden`.** La feuille du
  navigateur pose `[hidden] { display: none }` ; une règle d'auteur de même
  spécificité — `.attente { display: grid }`, `.rangee { display: flex }` — passe
  après et l'emporte. L'attribut devient alors sans effet, **sans aucun
  avertissement** : l'élément reste visible et le JavaScript qui bascule
  `.hidden` ne fait plus rien. Le voile d'attente s'affichait au démarrage, le
  détail de dalle et les exports de sentiers ne se cachaient jamais. D'où
  `[hidden] { display: none !important; }` en tête de `styles.css` — à ne pas
  retirer, et à préférer au réflexe d'ajouter `.xxx[hidden]` au cas par cas.
- **`gl.uniform*(null, …)` est un no-op silencieux.** Un uniform non utilisé est
  éliminé à la compilation et `prog.u.u_xxx` vaut `null`. Un paramètre qui « ne
  fait rien » vient souvent de là.

---

## La détection automatique est masquée

`ANALYSE_MASQUEE = true` dans `app.js` retire de l'interface le volet
Structures et sa case de superposition dans l'onglet 2D. Tout le reste de ce
document décrit du code qui existe, passe ses 71 tests, et ne s'exécute plus
depuis l'interface.

**Les sentiers ont eu leur propre drapeau, `SENTIERS_MASQUES`, brièvement
ouvert le 20 août 2026** pour recueillir des retours sur de vraies dalles —
ce qu'aucun banc synthétique ne peut remplacer. Le retour est arrivé vite : un
vrai bogue trouvé et corrigé (les tracés en pelote, voir plus haut), puis un
constat que ce correctif ne réglait pas — ce qui restait ne convainquait
toujours pas à l'œil sur plusieurs dalles, sans doute encore beaucoup de
ravinement naturel sous une signature indiscernable d'un chemin. Remasqué le
même jour. `montrerVolet()` refuse d'ouvrir le volet Structures tant
qu'`ANALYSE_MASQUEE` tient, quel que soit l'appelant — un garde unique plutôt
qu'à vérifier à chaque site d'appel — et le commutateur Structures/Sentiers se
masque avec `ANALYSE_MASQUEE` : un choix à deux options qui n'en a plus
qu'une n'est plus un choix. La section entière ne se rouvre que si les deux
drapeaux tombent ensemble.

**Pourquoi**, et l'argument n'est pas technique : sur une couche d'ouverture ou
de Sky-View Factor, un mur ruiné, une terrasse ou un chemin creux **se voient à
l'œil en une seconde**. C'est ainsi que la prospection LiDAR travaille depuis
toujours — on lit des images ombrées. Les deux chaînes automatiques demandent
des seuils justes pour rendre le même service en moins bien, et **aucune n'a
jamais été confrontée à une structure réelle connue**.

Confirmé depuis, sur un cas réel : une ruine connue de l'utilisateur, peu
visible sur le terrain, se lit sans ambiguïté dans le relief calculé par
l'outil. L'argument ci-dessus n'était pas que théorique.

Ce qui a emporté la décision : une fonction livrée qui promet et rend zéro fait
conclure que l'*outil* est cassé, pas cette fonction-là. La voie par la forme
venait précisément de rendre zéro en silence sur une dalle réelle, faute d'un
réglage lu au mauvais endroit ; et le premier essai de sa surface d'analyse avait
dégradé le Sky-View Factor à l'écran. Deux régressions visibles en un essai, sur
une chaîne qu'aucune vérité terrain ne permet de régler.

**Ce qui manque pour la rallumer n'est pas du code** : c'est un contrôle positif
pour l'algorithme lui-même — une ruine dont on connaisse les coordonnées,
passée dans le pipeline de détection pour vérifier qu'il la retrouve avec un
score juste. La lecture à l'œil, elle, vient d'être confirmée ; ce n'est pas la
même chose que faire tourner l'algorithme et en vérifier le score. Le drapeau
se remet à `false` en une ligne.

Conséquence sur le reste du document : les sections qui suivent restent la
référence du code, pas de l'interface.

## Détection : ce que chaque étape fait vraiment

### Le signal n'est pas seulement « non classé »

La spec de départ retenait la classe 1. Mesure sur une cabane d'estive isolée du
plateau de Beille (1.68416 / 42.74010) : la structure est **intégralement classée
6 (bâtiment)** par le classement automatique IGN, et le signal « non classé »
seul ne la voit pas du tout.

Lecture : une ruine effondrée tombe en « non classé » comme observé, mais une
cabane encore debout tombe en « bâtiment ». Comme une structure classée bâtiment
absente de la BD TOPO est exactement la cible, et que le rapprochement écarte
ensuite le bâti cartographié, la classe 6 est incluse par défaut. Décochable.

### Le MNT comblé est indispensable, pas cosmétique

Une ruine crée un trou dans la classe sol **exactement là** où on veut mesurer sa
hauteur. Sans reconstruction de la surface sous la structure, la hauteur serait
incalculable au seul endroit qui compte. Le comblement propage les bords du trou
vers l'intérieur, une couronne par passe — ce qui donne bien l'altitude qu'aurait
le terrain sans la structure.

### L'ordre fermeture → ouverture n'est pas négociable

Contre-intuitif : l'usage courant ouvre d'abord pour retirer le bruit.

Le LiDAR HD porte ~10 points/m². À 25 cm de pas — la résolution qu'exige la
lecture d'un mur de 50 cm — une cellule reçoit **0,6 point en moyenne**. Le
masque d'une structure bien réelle est donc un semis troué, pas une tache
pleine. Une ouverture appliquée d'abord l'érode jusqu'à le faire disparaître :
vérifié sur cas synthétique, structure de 6 × 4 m totalement perdue, zéro
détection.

La fermeture rebouche d'abord les trous d'échantillonnage ; l'ouverture retire
ensuite le bruit, resté isolé — une cellule seule survit à la fermeture sans
grossir. Le correctif a aussi amélioré le cas réel : 13 → 16 m² mesurés pour
19 m² au cadastre, score 0,76 → 0,84.

### La rectangularité ne fait pas ce que son nom suggère

C'est un filtre de régularité, **pas** un test « rectangle ou non ». Un disque la
sature à π/4 ≈ 0,785 par construction, à peine sous un rectangle parfait :

| Forme | Rectangularité |
|---|---|
| rectangle 6 × 4 m | 0,98 |
| disque r = 2,6 m | 0,78 |
| forme en L | 0,60 |
| cabane réelle (Beille) | 0,77 |

Le seuil est à 0,55, sous le plafond du disque, **délibérément** : les orris
ariégeois sont fréquemment ronds ou ovales. Ne pas le remonter au-dessus de
0,785 « pour ne garder que les rectangles » — ça les éliminerait tous.

Le classement se joue donc surtout sur l'opacité au laser (`partTrouSol`, le
plus physique des indices : la pierre ne laisse aucun retour sol sous elle, le
couvert végétal en laisse toujours passer) et la cohérence de hauteur.

### Le cas falaise

Une rupture de falaise produit la même signature « non classé sur fond de sol ».
Deux garde-fous : pente moyenne sur l'emprise ≤ 22°, et pente locale maximale
≤ 55° — une falaise franchit la seconde même quand la première reste modérée.
Sur cas synthétique à 35°, le filtre de pente vide le masque et le fragment
restant tombe sous la surface minimale.

### Écarter ce qui est déjà cartographié

L'outil cherche des structures **hors carte** ; sans recoupement, il
signalerait surtout des granges, bergeries et maisons parfaitement connues,
bien plus nombreuses que les ruines. Chaque détection est donc comparée au
**bâti de la BD TOPO**, interrogé en direct par le même service web que les
dalles — rien n'est stocké ni téléchargé à l'avance.

Une détection à moins de 25 m d'un bâtiment connu est marquée, et masquable
d'une case, jamais supprimée : la BD TOPO et le cadastre manquent
régulièrement les cabanes d'estive, et une trouvaille écartée à tort ne se
rattrape pas. La distance se mesure au **contour** du bâtiment, pas à son
centre — une grange de 60 m a son centre à 30 m de son propre pignon, ce qui
la ferait passer pour hors carte à moins de mesurer au bon endroit.

---

## Validation

`npm test` — nuages synthétiques à vérité connue (dimensions, filtres de
surface / forme / élongation / hauteur / pente, comblement du MNT, altitude
absolue, absence de valeur non finie) et projection contre les coins de dalle
publiés par le WFS de l'IGN, référence externe et non aller-retour avec soi-même.

La projection est vérifiée à **5 mm près** contre les coins de dalle publiés
par le WFS, et l'aller-retour Lambert-93 ↔ WGS84 est exact au micromètre sur
toute la France métropolitaine.

S'y ajoutent des contrôles mécaniques sur les sources, nés de fautes réellement
commises : syntaxe de chaque fichier de `src/`, correspondance avec les balises
de `index.html` — scripts chargés, et **identifiants lus par `app.js`**, dont
l'absence ne se voit qu'au clic sous la forme d'un « null » sans rapport —,
absence d'`import`, et surtout **absence de backtick dans les
commentaires GLSL** — le piège documenté plus haut s'est reproduit deux fois, et
se manifeste par un « SHADERS is not defined » à l'autre bout de l'application.

`.tmp/` (non versionné) a servi à plusieurs harnais à reconstruire au besoin :

- `pipeline.mjs` — pipeline complet hors navigateur sur données IGN réelles ;
- `selftest.html` — chaîne réelle en navigateur (modules, Worker, WASM, WebGL2,
  fetch IGN) ;
- `run-browser.js` — pilote Chrome headless, la page renvoie son verdict par POST ;
- `app2d.html` — **le parcours complet dans un iframe** : clic sur la carte,
  choix d'une dalle, chargement au niveau le plus grossier, arrivée en 2D, photo,
  rideau, changement de couche, aller-retour d'onglet. C'est le seul harnais qui
  éprouve le câblage plutôt que les algorithmes, et il tourne sur données réelles.
  Il renvoie aussi un **cliché du canevas 2D** par POST, `--screenshot` ne
  survivant pas à un chargement de dalle (le temps virtuel s'épuise avant).

L'assemblage de la photo se vérifie de son côté par comparaison **à la tuile
d'origine** : la couleur d'une cellule du raster doit être celle du pixel de la
tuile qui la couvre, la tuile étant redemandée séparément. Mesuré sur cinq
cellules d'une dalle ariégeoise, écart moyen **3,5 / 255** — l'écart entre
échantillonnage bilinéaire et plus proche voisin.

Ce contrôle-là couvre l'assemblage de la mosaïque et l'adressage des tuiles ; il
**n'a pas vu la photo retournée**, parce qu'il partageait la convention de lignes
du code qu'il éprouvait. La convention, elle, se vérifie contre
`RASTER.centreCellule` — voir le piège en tête de « La photo aérienne déformée
dans la grille ».

Résultats sur le plateau de Beille (dalle `LHD_FXX_0592_6184`), à trois échelles
— la détection retombe sur la même cabane à chaque fois :

| Emprise analysée | Points traversés | Détections | Faux positifs |
|---|---|---|---|
| 160 m | 0,87 M | 1 | 0 |
| 500 m (25 ha) | 5,6 M | 1 | 0 |
| dalle entière (1 km²) | 39,1 M | 1 | 0 |

La correspondance avec la BD TOPO : moins de 1,5 m d'écart, 16 m² mesurés pour
19 m² au cadastre, hauteur 2,0 m, score 0,84, rang 1. La couverture nationale a
été vérifiée séparément en Bretagne, dans les Alpes, les Vosges, en Corse et en
Île-de-France.

**Non validé pour l'algorithme :** aucune ruine effondrée connue n'a servi de
contrôle positif à la détection automatique elle-même — masquée, elle ne
tourne d'ailleurs plus. Le chemin « non classé » — celui de la spec, celui des
ruines — n'a été vérifié que sur cas synthétique, avec une cabane debout
(classée « bâtiment ») comme seul contrôle disponible. C'est le premier test à
faire dès qu'une ruine géolocalisée est disponible **pour l'algorithme**. La
lecture à l'œil du relief, elle, vient d'être confirmée sur une ruine réelle
peu visible, connue de l'utilisateur — voir « La détection automatique est
masquée ».

---

## État

| Jalon | État |
|---|---|
| 0. Squelette, GitHub Pages | ✅ |
| 1. Carte, grille de dalles, sélection, URL IGN | ✅ |
| 2. Parsing LAZ, rendu par points, colorisation | ✅ |
| 3. Pipeline de détection, cas falaise | ✅ — seuils à affiner sur cas réels |
| 4. Lambert-93 → WGS84, liens, dédup BD TOPO, exports | ✅ |
| Détection de sentiers | 🚧 chaîne complète, non validée sur chemin réel ; un essai réel a corrigé un bogue (pelotes) sans convaincre au-delà |
| Contrôle positif sur ruine effondrée | ❌ en attente de coordonnées |
| **Détection de structures dans l'interface** | 🙈 **masquée** — `ANALYSE_MASQUEE` dans `app.js` |
| **Détection de sentiers dans l'interface** | 🙈 **masquée** — `SENTIERS_MASQUES` dans `app.js`, réessayé et refermé le 20 août 2026 |
| Page d'accueil | ✅ — voile sur la carte vivante ; « Voir un exemple » sélectionne et charge le Bois des Caures (Verdun) |
| Onglets Carte / 2D / 3D, rideau de comparaison | ✅ |
| États vides et messages utiles | ✅ |
| Borne de zoom de la carte | ✅ |
| Vue d'ouverture sur la France entière | ✅ |
| Lien partageable | ✅ — la vue, au format osm.org (`#map=zoom/lat/lon`, + angles en 3D) ; voir « Le lien partageable » |
| Relief piloté par la vue | ✅ vue normale (plans 1 à 3) : relief de ce qui est à l'écran, rideau carte / relief, panneau « Relief » ; ancienne interface derrière `?dalle` ; sélection, mesure, info-bulle et réglages du SVF sur la carte ; 3D du nuage de la vue, avec EDL ; carte voilée sous le relief ; 3D qui télécharge dans TODO (#4) |

## Jalon de publication

Publier **n'est pas la récompense d'un outil fini** : c'est la prochaine étape de
validation. Le manque qui reste — la détection automatique, masquée, n'a jamais
tourné sur une ruine réelle connue — ne se comble pas en développant : il se
comble quand quelqu'un répond « j'ai un orri à telle coordonnée, essaie ». Ce
n'est plus le seul manque du projet, cela dit : la lecture à l'œil du relief,
c'est-à-dire l'outil tel qu'il se présente aujourd'hui, vient d'être confirmée
sur une ruine réelle. Ce qui reste à calibrer est optionnel et éteint, pas ce
que montre l'accueil. Tant que l'application n'est pas en ligne, le message
« j'ai un orri à telle coordonnée » ne peut de toute façon pas arriver, et les
seuils de détection resteraient réglés sur du synthétique.

Trois choses, et rien d'autre, étaient posées comme condition avant de poster
— **les trois sont faites** :

| Condition | Pourquoi elle était bloquante |
|---|---|
| **Ouvrir sur un exemple** ✅ | Sans elle, un visiteur voit une carte de France et ne sait pas où cliquer. « Voir un exemple » sélectionne et charge maintenant le Bois des Caures (Verdun) tout seul. |
| **Dire ce que l'outil ne sait pas faire** ✅ | Détermine la *qualité* des retours. L'accueil dit qu'aucune détection automatique ne tourne, sans faire croire à une IA. |
| **Passage de robustesse + captures dans le README** ✅ | Vérifié en navigateur réel : Annuler en plein téléchargement, rafale de 429 simulée, clic hors de France, changement de dalle et double-clic en cours de route — tout retombe sur ses pieds. GitHub Pages sert la dernière version. Les deux captures sont dans `docs/`. |

**Reste l'annonce elle-même**, un geste hors du dépôt : Géorezo, forum OSM
France, SIG francophone sur Mastodon, forums d'archéologie et de patrimoine
(pierre sèche), r/geomatique. Wikipedra et le PNR des Pyrénées ariégeoises
sont les interlocuteurs naturels — eux peuvent fournir des coordonnées de
ruines connues, c'est-à-dire le contrôle positif qui manque à l'algorithme.

Tout le reste — relief affiché, SVF, vignettes, export PNG, rideau ortho, carnet
de prospection, noms de villes et lieux-dits sur la photo aérienne (à réfléchir :
l'ortho n'affiche aucun toponyme) — vient **après**, et dans l'ordre que les
retours dicteront. La liste des envies est infinie ; celle des conditions de
publication ne doit pas l'être. Si une idée paraît indispensable avant la mise en
ligne, la question à se poser est : *est-ce qu'elle empêche quelqu'un de
comprendre ce que fait l'outil ?* Si non, elle attend.

---

## Reste à faire

Voir `TODO.md`.
