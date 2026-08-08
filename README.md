# Scopus

Exploration du **LiDAR HD de l'IGN** et détection de structures hors carte :
ruines, cabanes en pierre sèche et orris non répertoriés. Conçu pour l'Ariège et
les Pyrénées, utilisable **partout où l'IGN a volé** — soit la quasi-totalité de
la France.

**Ouvrir `index.html` — c'est tout.** Pas de serveur, pas d'installation, pas de
commande, pas de base, pas de compte. Les données ne quittent jamais l'onglet.

---

## Utilisation

1. **Choisir une dalle.** Les zones bleues sont les chantiers LiDAR HD, visibles
   à toutes les échelles sur la France entière ; en zoomant, le quadrillage
   kilométrique des dalles apparaît. Cliquer dedans. Un champ de recherche
   accepte un nom de commune ou des coordonnées (`42.74, 1.68` ou Lambert-93).
2. **Ouvrir la dalle.** Deux requêtes suffisent à lire l'index de l'octree —
   environ 50 Ko pour un fichier de 190 Mo.
3. **Choisir la résolution.** La dalle est analysée **en entier**, 1 km². Le
   coût exact en points et en mégaoctets est affiché avant tout téléchargement.
4. **Charger.** Comptez une trentaine de secondes pour un kilomètre carré à
   pleine résolution.
5. **Détecter.** Les candidats apparaissent sur la carte, dans le nuage 3D et
   dans une liste triée par score, avec liens Google Earth / Maps / Géoportail
   et export GPX, GeoJSON ou CSV.

### Se déplacer dans le nuage

Comme sur une carte, pas comme dans un logiciel 3D :

| Geste | Effet |
|---|---|
| Glisser | Déplace le terrain — la surface reste collée au curseur |
| Molette | Zoome **sous le curseur**, pas vers le centre |
| Maj + glisser, clic droit, bouton du milieu | Pivote autour du point visé |
| Double-clic | Se rend à cet endroit |

Le geste dominant, quand on balaie un kilomètre carré, est le déplacement — pas
la rotation. Et zoomer vers le centre de l'écran éloigne de ce qu'on vient de
repérer sur le bord : c'est ce qui rendait la navigation pénible.

Raccourcis : `c` carte · `v` nuage 3D · `t` vue de dessus · `f` tout cadrer.

Le rendu se fait **à la demande** : la vue n'est redessinée que lorsque quelque
chose change. Redessiner en continu un nuage immobile saturait le navigateur —
1,9 image/s et jusqu'à 1,2 s sans rendre la main, au point que le panneau
latéral ne défilait plus. C'est désormais 18 ms au pire.

### Filtrer les classes

La légende **est** le filtre : chaque entrée se clique pour masquer ou rétablir
sa classe. Masquer la végétation haute suffit le plus souvent à faire apparaître
le sol et ce qui s'y trouve. Le filtrage passe par l'alpha de la palette — une
texture d'un kilo-octet réécrite, sans toucher aux buffers de sommets.

## Comment le lancer

Deux voies, strictement équivalentes :

- **Double-cliquer sur `index.html`** — rien à installer.
- **Ouvrir l'adresse en ligne** — <https://julesrumeau.github.io/Scopus/>
  (une fois Pages activé, voir plus bas)

Un navigateur récent suffit (WebGL2 requis).

Rien n'est chargé depuis le disque au moment de l'exécution — ce qui serait
impossible en `file://` — et rien n'a besoin d'être installé : Leaflet et
laz-perf, y compris son binaire WebAssembly, sont déjà dans le dépôt.

Le seul réseau utilisé est celui de l'IGN, pour les fonds de carte et les
données LiDAR.

### Tests

Node ne sert qu'à deux choses, toutes deux facultatives :

```sh
npm test                  # 23 tests : projection, détection, shaders, sources
npm run embarquer-lazperf # après une mise à jour de laz-perf uniquement
```

Aucune dépendance à installer dans les deux cas.

### Publier sur GitHub Pages

Le dépôt **est** le site : aucune construction, aucun workflow, aucun outil.

1. **Settings** → **Pages** (menu de gauche)
2. *Build and deployment* → **Source** : `Deploy from a branch`
3. **Branch** : `main`, dossier **`/ (root)`** → **Save**
4. Attendre 1 à 2 minutes

L'adresse apparaît alors dans la même page :
`https://<compte>.github.io/Scopus/`

Ensuite, **chaque `git push` sur `main` redéploie tout seul**, en 30 s à 1 min.
L'avancement se suit dans l'onglet **Actions** du dépôt.

Trois points à connaître :

- **Le dépôt doit être public** — Pages n'est pas disponible sur un dépôt privé
  avec un compte gratuit.
- **`.nojekyll` est indispensable** et déjà présent : sans lui, Jekyll écarte
  silencieusement les fichiers et dossiers commençant par `_`.
- **Aucun chemin absolu** dans `index.html`, ce qui est nécessaire pour que le
  site fonctionne depuis un sous-répertoire (`/Scopus/`) aussi bien qu'en
  `file://`. À préserver si vous ajoutez des ressources.

Si une mise à jour ne se voit pas, c'est le cache de Pages (10 minutes) :
rechargement forcé par `Ctrl+Maj+R`.

---

## Comment ça marche

### Tenir en `file://`

**Le réseau ne pose aucun problème** : `fetch` vers l'IGN marche parfaitement
depuis une page ouverte en `file://`, **requêtes de plage comprises**. C'est ce
qui permet de se passer entièrement de serveur.

Ce qui est fermé, c'est uniquement la lecture du **disque local**. Relevé mesuré
sur Chrome 151 :

| Capacité | `file://` |
|---|---|
| `fetch` distant vers un service en CORS `*` | ✅ |
| Requête de plage (`206`) | ✅ |
| WebGL2 | ✅ |
| Worker depuis une URL blob | ✅ |
| `<script type="module">` inline | ✅ |
| `<script type="module" src>` + `import` | ❌ |
| `fetch` / `XHR` d'un fichier local | ❌ |
| `new Worker("fichier.js")` | ❌ |

D'où trois choix, et trois seulement :

- **Scripts classiques** exposant des globaux (`CONFIG`, `COPC`, `RASTER`…),
  chargés dans l'ordre par `index.html`, puisque l'`import` entre fichiers est
  refusé.
- **laz-perf embarqué** — son JavaScript et son binaire WASM sont des chaînes
  dans `vendor/lazperf/lazperf-embarque.js`, passées en `wasmBinary`, si bien
  que l'initialisation ne lit aucun fichier.
- **Worker monté depuis une URL blob**, son source composé à l'exécution ; en
  cas de refus, repli sur le fil principal.

Le worker sert la **fluidité**, pas la vitesse : mesuré sur 261 000 points, le
gel le plus long de l'interface passe de 188 ms à 60 ms. Sur les durées totales
il n'apporte rien de mesurable — le facteur limitant est le débit bridé de
l'IGN, dont la variance (4,6 s à 14,2 s pour une configuration identique)
dépasse l'effet recherché.

### La carte : grille locale plutôt que grille téléchargée

Trois défauts constatés à l'usage, une seule cause commune.

**Le service WFS plafonne à 600 entités.** Sur une vue de 30 × 60 km, 1 717
dalles correspondent et 600 reviennent — triées par colonne, ce qui produit des
bandes verticales trouées, sans qu'aucune erreur ne le signale. Il y a par
ailleurs 505 294 dalles en France : les précharger est exclu.

Or la grille se **déduit** : une dalle est exactement le carré
`[X·1000, (X+1)·1000] × [(Y−1)·1000, Y·1000]` en Lambert-93. Elle est donc
générée localement — exacte par construction, instantanée, jamais tronquée — et
tracée sur un canevas unique plutôt qu'en milliers d'objets Leaflet. Vérifié :
les coins reconstruits coïncident avec les polygones publiés par l'IGN à
**0,000 m** près. Le WFS n'est plus interrogé que sur clic, pour **un point**,
ce qui ne peut désigner qu'une dalle et échappe au plafond.

**Deux échelles, comme sur cartes.gouv.fr.** La couche « bloc » (emprises de
chantier, 210 polygones pour toute la France, jamais tronquée) s'affiche à tous
les zooms et montre d'un coup d'œil où il y a du LiDAR ; le quadrillage
kilométrique n'apparaît qu'à partir du zoom 11, découpé sur ces emprises pour ne
pas laisser croire à des données là où il n'y en a pas. Vérifié : dans toutes
les régions testées, **100 % des dalles tombent dans un bloc**.

**L'orientation compte.** Un carré Lambert-93 n'est pas aligné sur les axes une
fois projeté en WGS84 : il apparaît légèrement tourné. Toute emprise doit donc
être tracée en polygone de côtés reprojetés, jamais en `L.rectangle` — sans
quoi elle paraît de travers par rapport à la grille qui l'entoure.

**L'outil n'a jamais été limité à l'Ariège** — seule la vue d'ouverture y est
centrée. La couverture a été vérifiée en Bretagne, dans les Alpes, les Vosges,
en Corse et en Île-de-France, et une recherche de lieu permet d'aller n'importe
où (nom de commune, ou coordonnées saisies en WGS84 comme en Lambert-93).

### Récupérer les données sans backend

Les dalles LiDAR HD sont diffusées en **COPC** (Cloud Optimized Point Cloud) :
un LAZ dont les points sont rangés dans un octree, avec la table des nœuds
publiée dans le fichier. Deux propriétés le rendent exploitable directement
depuis un navigateur, l'une et l'autre vérifiées sur `data.geopf.fr` :

- `access-control-allow-origin: *` — pas de proxy nécessaire ;
- `accept-ranges: bytes` — les requêtes de plage renvoient bien `206`.

D'où la démarche : lire l'en-tête et la hiérarchie (48 Ko), puis ne télécharger
que les nœuds utiles. L'index complet d'un fichier de 185 Mo coûte ainsi moins
de 50 Ko.

L'octree donne en prime le compromis résolution/volume, chaque niveau divisant
l'espacement par deux. Pour une dalle entière (1 km²) :

| Niveau | Espacement | À télécharger |
|---|---|---|
| 1 | 3,4 m | 7 Mo |
| 2 | 1,7 m | 27 Mo |
| 3 | 85 cm | 70 Mo |
| 4 | 43 cm | 137 Mo |
| 5 | **21 cm** | 185 Mo |

C'est le curseur *Résolution* de l'étape 2. Le niveau 5 donne la pleine finesse
en une trentaine de secondes ; les niveaux intermédiaires servent à dégrossir un
secteur sans attendre.

### Le signal

Une structure en pierre se manifeste par des points **non classés** (classe 1)
posés sur un fond de sol par ailleurs plat, et par un **trou dans la classe
sol** : la pierre est opaque au laser, aucun retour ne vient de dessous. C'est
ce second point qui distingue une masse construite d'un couvert végétal, lequel
laisse toujours passer quelques retours au sol.

Mesure faite sur une cabane d'estive isolée du plateau de Beille : le classement
automatique de l'IGN l'étiquette intégralement en **classe 6 (bâtiment)**, et le
signal « non classé » seul ne la voit pas. Une ruine effondrée tombe bien en
« non classé », mais une cabane encore debout tombe en « bâtiment ». Les deux
classes sont donc prises par défaut, le rapprochement avec la BD TOPO écartant
ensuite ce qui est déjà cartographié — une structure classée bâtiment mais
absente de la BD TOPO est précisément ce qu'on cherche. Décochable dans
l'interface.

### Analyser un kilomètre carré sans le tenir en mémoire

Une dalle entière à 21 cm, c'est 39 M de points : 745 Mo de tableaux et 708 Mo
de VRAM. Intenable. Mais **la détection ne lit jamais les points** — seulement
des grilles dont la taille ne dépend que de l'emprise et du pas.

Chaque bloc est donc versé dans les grilles dès qu'il est décodé, puis
abandonné. La mémoire cesse de dépendre du nombre de points. Le rendu 3D, lui,
ne conserve que les niveaux grossiers de l'octree — une pyramide de détail déjà
toute faite, qui couvre la dalle uniformément.

Mesuré sur une dalle complète au niveau le plus fin :

| | |
|---|---|
| Grille | 4000 × 4000 à **25 cm** |
| Points traversés | 39,1 M |
| Points conservés pour l'aperçu | 4,45 M |
| Tas JavaScript | 247 → **405 Mo** (limite 4192) |
| Chargement + rastérisation | 21,7 s |
| Terrain + pente | 3,6 s |
| Détection | 2,2 s |

**Le nombre de requêtes comptait plus que le volume.** Interroger les 1554 nœuds
séparément se soldait par un `HTTP 429` : le limiteur de l'IGN coupait avant la
fin. Or les nœuds sont rangés bout à bout dans le fichier — 0,00 Mo d'espace
perdu sur 184,5 Mo — donc les plages se regroupent. **1554 requêtes deviennent
24**, redécoupées à 8 Mo pour garder une progression lisible.

### Le pipeline

```
nuage → grilles 25 cm ─┬─ sol : Z minimal des points classe 2
                       ├─ signal : classes 1 (+6), hauteur au-dessus du terrain
                       └─ total : densité de points
                              │
                     MNT (trous comblés) ──→ pente
                              │
                    masque : signal présent
                           ∧ hauteur ∈ [0,35 ; 6] m
                           ∧ pente ≤ 22°
                              │
                  fermeture (2) puis ouverture (1)
                              │
                    composantes connexes 8-voisins
                              │
        filtres : surface 4–100 m² · pente locale · composition
                  rectangularité · élongation · cohérence de hauteur
                              │
                  score → Lambert-93 → WGS84 → liste
```

Deux points méritent d'être connus avant de toucher aux seuils.

**Le comblement du MNT n'est pas cosmétique.** Une ruine crée un trou dans la
classe sol exactement là où on veut mesurer sa hauteur. Sans reconstruction de
la surface sous la structure, cette hauteur serait incalculable. Le comblement
propage les bords du trou vers l'intérieur, une couronne par passe.

**L'ordre fermeture → ouverture est contre-intuitif mais obligatoire.** Le LiDAR
HD porte ~10 points/m² ; à 25 cm de pas une cellule reçoit 0,6 point, donc le
masque d'une structure réelle est un semis troué. Une ouverture appliquée
d'abord l'efface entièrement — vérifié sur cas synthétique, structure de 6 × 4 m
totalement perdue. La fermeture rebouche d'abord les trous d'échantillonnage,
l'ouverture retire ensuite le bruit resté isolé.

### Détecter des sentiers — chaîne distincte

Une ruine est une **tache** qu'on isole par morphologie ; un sentier est une
**ligne** longue de dizaines de mètres et large de moins d'un. Aucun filtre de
forme ne trouvera la seconde. Le signal est en outre purement topographique — le
passage a creusé le sol — donc on travaille sur le modèle de terrain, jamais sur
les classifications.

```
MNT → relief local (MNT − MNT lissé, convolution normalisée)
        │
        ├─ rugosité locale ─── échelle de référence
        │
   réponse de Frangi multi-échelle (1, 2, 4 m)
   valeurs propres de la hessienne : forte courbure en travers,
   nulle le long ⇒ c'est une ligne, et non une tache ni une pente
        │
   hystérésis (deux seuils) → amincissement Zhang-Suen → vectorisation
        │
   filtres : longueur · profondeur · pente du tracé · **alignement à la pente**
        │
   score → polylignes → GPX (traces) / GeoJSON (LineString)
```

**Le critère décisif sépare un sentier d'une ravine.** Les deux sont des creux
linéaires, indiscernables sur la seule forme. Ce qui les distingue est physique :
une ravine suit la **ligne de plus grande pente**, un sentier la traverse en
biais pour rester praticable. On compare donc en chaque point la direction du
tracé au gradient du terrain. Sans ce filtre, tout ravin, toute rigole et tout
fossé de drainage ressortent.

**Pourquoi pas un ombrage**, le réflexe habituel : il dépend d'une direction
d'éclairage et rate les structures qui lui sont parallèles. La littérature
archéologique lui préfère des visualisations non directionnelles ; la hessienne
l'est tout autant, et détecte au lieu de simplement montrer.

Les tracés s'affichent **sur la carte et dans le nuage 3D**, où ils sont posés
sur le terrain. Les polylignes y sont rééchantillonnées tous les 2 m avant
d'être dessinées : la simplification laisse parfois des dizaines de mètres entre
deux sommets, et un segment droit sur cette distance traverserait le relief au
lieu de l'épouser. Cliquer un tracé le surligne dans les deux vues et y amène la
caméra 3D — `v` suffit ensuite à basculer.

**Le seuil est exprimé en multiples de la rugosité locale**, pas en mètres. Ce
n'est pas un raffinement : mesuré, le relief local médian vaut 2 cm sur terrain
synthétique lisse et **79 cm sur le plateau de Beille**. Aucune constante ne
pouvait servir les deux — calibrée sur le lisse, elle faisait déborder la moitié
de la dalle réelle.

**Mais l'amplitude n'est plus le critère principal.** Un sentier creuse peu :
50 cm au grand maximum, souvent 20, parfois 10. Sur un versant dont la rugosité
naturelle atteint 79 cm, un tel creux est indétectable par sa seule force. Le
tri se fait donc sur la **forme** :

| Critère | Sentier | Bruit / ravine |
|---|---|---|
| Profondeur | ≤ 50 cm | ravine : bien plus |
| Continuité | longue, après recollement des tronçons | courte, hachée |
| Tortuosité | serpente en courbes amples — **peu** de sommets après simplification | change de cap à chaque pas |
| Rapport à la pente | la traverse en biais | ravine : la suit |

Un sentier est **faible mais organisé** ; le bruit est fort mais désordonné.
C'est cette différence qu'on exploite, et non l'amplitude. La courbure n'est
jamais pénalisée : un sentier de montagne n'est jamais droit, il épouse le
relief et lace.

### Ce que la rectangularité mesure — et ne mesure pas

La rectangularité (surface / rectangle englobant orienté d'aire minimale) est un
filtre de régularité, **pas** un test « rectangle ou non ». Un disque la sature à
π/4 ≈ 0,785 par construction :

| Forme | Rectangularité |
|---|---|
| rectangle 6 × 4 m | 0,98 |
| disque r = 2,6 m | 0,78 |
| forme en L | 0,60 |
| cabane réelle (Beille) | 0,77 |

Le seuil est à 0,55, délibérément sous le plafond du disque : les **orris**
ariégeois, cabanes d'estive en pierre sèche, sont fréquemment ronds ou ovales.
Un seuil « pour ne garder que les rectangles » les éliminerait tous.

### Écarter ce qui est déjà cartographié

L'outil cherche des structures **hors carte**. Sans recoupement, il signalerait
surtout des granges, bergeries et maisons parfaitement connues, bien plus
nombreuses que les ruines.

Chaque détection est donc comparée au **bâti de la BD TOPO**, la carte de
référence de l'IGN — interrogée en direct, par le même service web que les
dalles. Rien n'est stocké ni téléchargé à l'avance : c'est encore un simple
appel réseau depuis le navigateur.

Une détection à moins de 25 m d'un bâtiment connu est marquée, et masquable d'une
case. Elle n'est jamais supprimée : la BD TOPO et le cadastre manquent
régulièrement les cabanes d'estive, et une trouvaille écartée à tort ne se
rattrape pas. La distance se mesure au **contour** du bâtiment, pas à son
centre — une grange de 60 m a son centre à 30 m de son propre pignon.

### Le cas falaise

Une rupture de falaise produit la même signature « non classé sur fond de sol »
qu'une structure. Deux garde-fous la séparent : la pente moyenne du terrain sur
l'emprise (≤ 22°) et la pente locale maximale (≤ 55°), une falaise franchissant
la seconde même quand la première reste modérée.

---

## Validation

**23 tests** (`npm test`), sans rien à installer.

Sur nuages synthétiques à vérité connue : dimensions retrouvées, altitude
absolue, filtres de surface, de forme, d'élongation, de hauteur et de pente,
comblement du MNT, absence de valeur non finie. La projection est vérifiée
contre les coins de dalle publiés par le WFS de l'IGN — référence externe, pas
un aller-retour avec soi-même — à 5 mm près, avec aller-retour exact au
micromètre sur toute la France métropolitaine.

S'y ajoutent des contrôles mécaniques nés de fautes réellement commises :
syntaxe de chaque fichier de `src/`, correspondance avec les balises de
`index.html`, absence d'`import`, et absence de backtick dans les commentaires
GLSL — lequel casse le littéral de gabarit et se manifeste par un
« SHADERS is not defined » à l'autre bout de l'application.

L'application complète a par ailleurs été exécutée en conditions réelles dans
Chrome, **en `file://` comme en HTTP** : chaîne entière du clic jusqu'à
l'export, décompression par les workers blob (pas le repli), cabane connue
retrouvée à 1,3 m.

Sur données réelles, plateau de Beille (dalle `LHD_FXX_0592_6184`) :

| Emprise analysée | Points traversés | Détections | Faux positifs |
|---|---|---|---|
| 160 m | 0,87 M | 1 | 0 |
| 500 m (25 ha) | 5,6 M | 1 | 0 |
| **dalle entière (1 km²)** | **39,1 M** | **1** | **0** |

Dans les trois cas, la détection retombe sur la même cabane de la BD TOPO à
moins de 1,5 m — 16 m² mesurés pour 19 m² au cadastre, hauteur 2,0 m, score
0,84, rang 1.

La couverture nationale a été vérifiée séparément en Bretagne, dans les Alpes,
les Vosges, en Corse et en Île-de-France.

**Ce qui n'est pas validé :** aucune ruine effondrée connue n'a servi de contrôle
positif. Le contrôle disponible était une cabane debout, donc classée
« bâtiment ». Le chemin « non classé » — celui de la spec, celui des ruines —
fonctionne mécaniquement (tests synthétiques) mais n'a pas encore été confronté
à une vraie ruine géolocalisée. C'est le premier test à faire.

---

## État de la détection de sentiers

Première version, à confronter au terrain.

**Validé** — sept tests sur relief synthétique à vérité connue : un sentier de
niveau est trouvé avec la bonne profondeur, une ravine de même profondeur mais
orientée dans la pente est écartée, et les deux sont correctement séparés
lorsqu'ils coexistent sur le même versant.

**Mesuré sur la dalle du plateau de Beille**, 1 km² à pleine résolution, en
**3,5 s** :

| Sensibilité | Tracés retenus | Plus longs tracés |
|---|---|---|
| **0,35** *(défaut)* | 147 | 203 m / 40 cm · 259 m / 37 cm · 296 m / 56 cm |
| 0,60 | 63 | 112 m / 25 cm · 182 m / 39 cm · 137 m / 16 cm |

Les profondeurs tombent désormais dans la fourchette attendue d'un sentier —
10 à 56 cm — et les longueurs se comptent en centaines de mètres. La version
précédente, qui triait sur l'amplitude, ne remontait que des tronçons de 25 à
30 m creusés de 70 à 250 cm : des ravines.

Le détail des rejets montre que les deux nouveaux critères portent l'essentiel
du tri : 506 tracés écartés sur la tortuosité, 411 sur la profondeur.

**Non validé** — aucun chemin connu n'a encore servi de contrôle positif. Rien
ne dit que ces 147 tracés sont des sentiers ; seule leur signature est
cohérente. Deux limites subsistent :

- la reconstitution reste **partielle** — 73 m retrouvés sur 128 m exploitables
  pour un tracé sinueux synthétique ;
- les **sentes de brebis** (terracettes) ne sont pas traitées : c'est une texture
  périodique et non une ligne, qui relève d'une analyse de Fourier.

## Hors périmètre

Les terracettes, donc — et toute détection reposant sur un apprentissage.

---

## Structure

```
index.html · styles.css        interface ; l'ordre des <script> compte
src/config.js                  seuils et paramètres, source de vérité
src/proj.js                    Lambert-93 ↔ WGS84
src/reseau.js                  file HTTP à parallélisme borné, réessais
src/copc.js                    lecteur COPC par requêtes de plage
src/decodeur.js                décompression LAZ ; source du worker blob
src/nuage.js                   orchestration du chargement, grappe de workers
src/raster.js                  grilles, MNT, pente
src/detection.js               masque, morphologie, composantes, filtres, score
src/sentiers.js                relief local, Frangi, squelette, vectorisation
src/sortie.js                  rapprochement BD TOPO, liens, exports
src/gl.js · shaders.js         WebGL2 (repris de FlowField)
src/vue3d.js                   caméra orbitale, rendu par points
src/carte.js                   Leaflet, couverture LiDAR, sélection de dalle
src/grille.js                  grille kilométrique locale, tracée au canevas
vendor/lazperf/                laz-perf ; `lazperf-embarque.js` est le fichier
                               réellement chargé (généré, JS + WASM en chaînes)
tools/embarquer-lazperf.js     régénère cet embarqué après mise à jour
tools/charger.js               charge les scripts classiques pour les tests
tools/*.test.js                tests : projection, détection, shaders, sources
```

---

## Licences

Données **LiDAR HD © IGN**, licence ouverte Etalab — réutilisation libre, y
compris commerciale, sous réserve de mentionner la source.

Deux bibliothèques sont redistribuées dans `vendor/` plutôt que chargées depuis
un CDN, ce qui est la condition de l'ouverture par double-clic :

| Composant | Licence |
|---|---|
| [Leaflet 1.9.4](https://leafletjs.com) | BSD 2-Clause |
| [laz-perf 0.0.7](https://github.com/hobuinc/laz-perf) | Apache-2.0 |

Textes complets dans [`vendor/LICENCES.md`](vendor/LICENCES.md).
