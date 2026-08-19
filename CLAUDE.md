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
automatique est masquée » plus bas : les deux chaînes existent et sont
testées, mais n'ont jamais été confrontées à une structure réelle connue.

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

### Répartition du travail

Le fil principal garde la main sur les requêtes HTTP (file bornée, réessais) et
n'envoie aux workers que des octets déjà en mémoire. Les workers ne font que
décompresser — quelques secondes de CPU pur sur une zone dense, qui figeraient
l'onglet si elles restaient sur le fil principal.

Les coordonnées sont ramenées à une origine locale **avant** conversion en
Float32 : en Lambert-93 les Y valent 6,2 millions, ce qu'un flottant 32 bits ne
résout qu'à ~0,5 m.

---

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

Corollaire côté interface : un seul conteneur défilant. La liste de résultats
avait le sien (`max-height` + `overflow`), ce qui piégeait la molette dès que le
curseur la survolait.

## La page d'accueil

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

**Le bouton principal annonce au lieu de ne rien faire.** La dalle d'exemple
n'est pas encore arrêtée (#5) : « Voir un exemple » mène à un écran qui dit ce
que l'exemple montrera et selon quels critères la dalle sera choisie. Un bouton
muet se lit comme une panne ; un bouton qui annonce se lit comme un chantier.

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
photo ↔ relief promise par la phrase d'accroche, elle, reste à montrer pour de
vrai : c'est la dalle d'exemple (#5), qui remplacera aussi la capture attendue
par le README (#6).

**La ligne sur ce que l'outil ne sait pas faire n'est pas de la modestie** : elle
détermine la qualité des retours. Qui comprend qu'il s'agit de règles
géométriques réglables propose des coordonnées ; qui croit à une IA répond « ça
ne marche pas ». Elle doit continuer à dire qu'aucune ruine réelle connue n'a
servi à régler les seuils, aussi longtemps que c'est vrai.

Trois points de mise en œuvre à ne pas défaire :

- **Un `location.hash` non vide saute l'accueil.** Il désigne maintenant une
  dalle précise plutôt qu'une simple présence — voir « Le lien partageable ».
  Sans cela, un lien partagé ouvrirait une page de présentation au lieu de la
  dalle qu'il désigne.
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

## Le lien partageable

Comprimis retenu avec l'utilisateur, plus étroit que ce que #3 envisageait au
départ : le hash ne porte que la **dalle**, deux indices kilométriques
Lambert-93 (`#d=592,6183`) — pas la résolution, pas l'onglet, pas les seuils.
Ouvrir un lien **sélectionne** la dalle, exactement l'état obtenu par un clic
sur la carte, et laisse le choix de charger le nuage à qui l'ouvre : le
téléchargement engage jusqu'à 190 Mo, personne ne doit le subir en ouvrant un
lien.

`Carte.selectionnerAuPoint(lon, lat)` est le point de convergence : un clic sur
la carte (`_surClic`) et un lien partagé y passent tous les deux, jusqu'à la
requête WFS qui donne l'URL du COPC — aucune divergence possible sur ce qui
compte. Au clic, le hash est réécrit par `history.replaceState`, jamais
`location.hash =` : la seconde empile une entrée d'historique à chaque dalle
désignée, et le bouton Retour du navigateur deviendrait inutilisable après
quelques clics d'exploration — vérifié en navigateur, deux sélections
successives ne laissent qu'une entrée.

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

Parcours vérifié de bout en bout en navigateur réel (`.tmp/lien-dalle.html`,
non versionné) : sélection sur la carte → hash écrit → rechargement à froid sur
ce hash → même dalle resélectionnée sans le moindre clic, aucune entrée
d'historique en trop.

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

## Filtrage des classes

Par l'**alpha de la palette**, pas par les buffers : `paletteClasses` écrit 0
dans l'alpha des classes masquées, et le vertex shader rejette le point hors du
volume de vue. Une texture de 1 Ko réécrite suffit donc à refiltrer, là où
reconstruire les attributs coûterait des centaines de mégaoctets de transfert à
chaque case cochée.

Le point est **rejeté**, pas rendu transparent : un point transparent écrirait
quand même dans le tampon de profondeur et masquerait ce qui est derrière.

---

## Détection de sentiers

Chaîne séparée (`sentiers.js`), sur le **relief seul** — jamais les classes.
Relief local → rugosité locale → Frangi multi-échelle → hystérésis →
amincissement Zhang-Suen → vectorisation → filtres.

Quatre décisions à ne pas défaire, chacune née d'une mesure :

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

---

## Trois onglets : Carte, 2D, 3D

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

Les tuiles passent par `RESEAU.recuperer` comme tout le reste — file bornée,
réessais, 400 fantôme traité comme transitoire. Une tuile qui manque après ses
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

`ANALYSE_MASQUEE = true` dans `app.js` retire de l'interface le volet Analyse
entier — structures **et** sentiers — ainsi que les deux cases de superposition
de l'onglet 2D. Tout le reste de ce document décrit du code qui existe,
passe ses 71 tests, et ne s'exécute plus.

**Pourquoi**, et l'argument n'est pas technique : sur une couche d'ouverture ou
de Sky-View Factor, un mur ruiné, une terrasse ou un chemin creux **se voient à
l'œil en une seconde**. C'est ainsi que la prospection LiDAR travaille depuis
toujours — on lit des images ombrées. Les deux chaînes automatiques demandent
des seuils justes pour rendre le même service en moins bien, et **aucune n'a
jamais été confrontée à une structure réelle connue**.

Ce qui a emporté la décision : une fonction livrée qui promet et rend zéro fait
conclure que l'*outil* est cassé, pas cette fonction-là. La voie par la forme
venait précisément de rendre zéro en silence sur une dalle réelle, faute d'un
réglage lu au mauvais endroit ; et le premier essai de sa surface d'analyse avait
dégradé le Sky-View Factor à l'écran. Deux régressions visibles en un essai, sur
une chaîne qu'aucune vérité terrain ne permet de régler.

**Ce qui manque pour la rallumer n'est pas du code** : c'est un contrôle positif,
une ruine dont on connaisse les coordonnées. Le drapeau se remet à `false` en une
ligne.

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

**Non validé :** aucune ruine effondrée connue n'a servi de contrôle positif. Le
chemin « non classé » — celui de la spec, celui des ruines — n'a été vérifié que
sur cas synthétique, avec une cabane debout (classée « bâtiment ») comme seul
contrôle disponible. C'est le premier test à faire dès qu'une ruine géolocalisée
est disponible.

---

## État

| Jalon | État |
|---|---|
| 0. Squelette, GitHub Pages | ✅ |
| 1. Carte, grille de dalles, sélection, URL IGN | ✅ |
| 2. Parsing LAZ, rendu par points, colorisation | ✅ |
| 3. Pipeline de détection, cas falaise | ✅ — seuils à affiner sur cas réels |
| 4. Lambert-93 → WGS84, liens, dédup BD TOPO, exports | ✅ |
| Détection de sentiers | 🚧 chaîne complète, non validée sur chemin réel |
| Contrôle positif sur ruine effondrée | ❌ en attente de coordonnées |
| **Détection automatique dans l'interface** | 🙈 **masquée** — `ANALYSE_MASQUEE` dans `app.js` |
| Page d'accueil | ✅ — voile sur la carte vivante ; l'exemple mène à un écran d'annonce, faute de dalle d'exemple (#5) |
| Onglets Carte / 2D / 3D, rideau de comparaison | ✅ |
| États vides et messages utiles | ✅ |
| Borne de zoom de la carte | ✅ |
| Vue d'ouverture sur la France entière | ✅ |
| Lien partageable | ✅ — la dalle seule ; voir « Le lien partageable » |

## Jalon de publication

Publier **n'est pas la récompense d'un outil fini** : c'est la prochaine étape de
validation. Le seul manque sérieux du projet — aucune ruine effondrée connue n'a
servi de contrôle positif — ne se comble pas en développant. Il se comble quand
quelqu'un répond « j'ai un orri à telle coordonnée, essaie ». Tant que
l'application n'est pas en ligne, ce message ne peut pas arriver, et les seuils
restent réglés sur du synthétique.

Trois choses, et rien d'autre, avant de poster :

| Condition | Pourquoi elle est bloquante |
|---|---|
| **Ouvrir sur un exemple** | Sans elle, un visiteur voit une carte de France et ne sait pas où cliquer. Tout le reste de l'outil devient inatteignable. Le lien partageable, lui, est fait ; ne manque que la dalle vers laquelle il pointerait par défaut. |
| **Dire ce que l'outil ne sait pas faire** | Détermine la *qualité* des retours. Qui comprend que ce sont des règles réglables, et que le cas « ruine » n'est pas validé, propose des coordonnées. Qui croit à une IA répond « ça marche pas ». |
| **Passage de robustesse + captures dans le README** | Un inconnu emprunte les chemins qu'on n'emprunte jamais : réseau qui lâche, 429 en rafale, zone sans LiDAR, téléphone. |

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
