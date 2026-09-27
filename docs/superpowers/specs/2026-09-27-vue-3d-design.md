# La 3D de la vue — conception

Date : 27 septembre 2026 · Branche : `feat/flux-vue-3d` (depuis
`feat/flux-vue-affichage`)

## Objectif

Rendre l'onglet 3D en vue normale : en y passant, voir en nuage de points ce
que la carte montre, sans dalle à choisir et sans rien télécharger de plus.
L'ancienne 3D (une dalle chargée, derrière `?dalle`) reste telle quelle.

Étape 1 de deux : ici, le nuage est **figé** sur la zone vue en 2D. L'étape 2
(plus tard) fera télécharger du détail par la caméra 3D elle-même.

## Ce que font les outils existants

Potree, Giro3D (successeur d'iTowns, IGN et laboratoire MATIS) et
maplibre-gl-lidar lisent tous du COPC dans le navigateur ; Giro3D en fait la
démonstration sur 180 dalles LiDAR HD de l'IGN (3 milliards de points). Ce
qu'ils ont en commun, et ce qu'on en reprend :

- **Un plafond de points** (`pointBudget` chez Potree et Giro3D ;
  maplibre-gl-lidar : 1 M affichés, 5 M en mémoire). Repris : un seul plafond,
  réglable.
- **La priorité aux blocs les plus gros à l'écran** : Potree parcourt
  l'octree par taille projetée décroissante, d'où du fin près de la caméra et
  du grossier au loin. Pour l'étape 2 ; l'étape 1 prend les points déjà là.
- **L'ombrage de profondeur (« eye-dome lighting », EDL)**, activé par défaut
  chez Potree et Giro3D : sans lui, un nuage vu de près est une bouillie de
  points ; avec, murets et talus ressortent. Repris.
- **Plusieurs dalles traitées comme un seul nuage**
  (`AggregatePointCloudSource` chez Giro3D) : c'est déjà ce que fait
  `flux.js`.
- **La couleur prise d'une couche 2D** (l'orthophoto chez Giro3D) : on a le
  relief drapé, déjà dans `vue3d.js`, recâblé sur la vue.

Sources : [Potree](https://www.researchgate.net/publication/309358171_Potree_Rendering_Large_Point_Clouds_in_Web_Browsers),
[Giro3D — LiDAR HD](https://giro3d.org/latest/examples/lidar-hd),
[Giro3D — nuage massif](https://giro3d.org/latest/examples/massive-point-cloud),
[maplibre-gl-lidar](https://github.com/opengeos/maplibre-gl-lidar).

## Décisions (avec l'utilisateur, 27 septembre)

1. **La zone est celle visible sur la carte au moment de passer en 3D**, et
   les points sont ceux déjà téléchargés pour le relief. Rien n'est demandé au
   réseau pour la 3D.
2. **Rien de chargé** (vue au-delà du seuil de surface, ou aucun bloc encore
   arrivé) : l'onglet 3D dit « Zoomez sur la carte pour afficher le nuage en
   3D », sans nuage.
3. **Le nuage ne bouge pas tant qu'on reste en 3D.** Revenu sur la carte, s'il
   s'est déplacé, le prochain passage en 3D efface l'ancien nuage et en bâtit
   un nouveau ; sinon, le même est gardé tel quel.
4. **Un plafond de points**, réglable. Au-delà, un point sur N est gardé, tiré
   au hasard de façon **déterministe** (même vue, mêmes points) : densité
   régulière partout, et un aller-retour 2D/3D sans rien changer ne fait pas
   scintiller le nuage.
5. **On réutilise la vue 3D existante** : gestes, boussole, couleurs (classes,
   hauteur, intensité, altitude, relief drapé), filtre des classes, sélection
   et mesure, lien `#map=` avec les angles.
6. **Plus tard (étape 2, hors de cette conception)** : zoomer en 3D fait
   télécharger du détail ; la « fourchette » de l'utilisateur y servira de
   seuil d'hystérésis pour ne pas retélécharger au moindre mouvement.

## Architecture

### Le worker garde de quoi faire un nuage

Les points vivent dans le worker du relief (`relief-travailleur.js`) ; le fil
principal ne les garde pas. Aujourd'hui il n'y reçoit que `xc, yc, zc, cls`.
Il reçoit aussi **l'intensité** (`Uint16Array`, 2 octets par point) — la vue
3D la colore.

Nouvelle demande au worker, `nuage3d` :

```
{ type: 'nuage3d', id, emprise: {xmin,xmax,ymin,ymax}, budget }
→ { type: 'nuage3d', id, n, x, y, z (Float32Array, relatifs à origine),
    cls (Uint8Array), intensite (Uint16Array), hauteur (Float32Array),
    origine: [xmin, ymin, zRef], emprise, zmin, zmax, parClasse: [[cls, n]…] }
  ou { type: 'nuage3d', id, vide: true }
```

- **Quels points** : ceux des blocs gardés qui coupent l'emprise, et parmi eux
  ceux qui tombent dans l'emprise. Tous niveaux confondus : les blocs d'octree
  se complètent (un point n'est que dans un bloc), leur union est le nuage.
  Mais seulement les blocs que la vue demande (`flux.voulues()`) — pas les
  blocs fins gardés d'une vue précédente, qui densifieraient une partie de la
  zone seulement.
- **Plafond** : si plus de `budget` points, chacun est gardé avec la
  probabilité `budget / total`, tirée d'un hachage de ses coordonnées en
  centimètres entiers — déterministe, sans état, uniforme.
- **Coordonnées** : relatives à `origine` (coin sud-ouest de l'emprise,
  altitude minimale) avant la conversion en `Float32` — même règle que
  partout (6,2 millions en Y ne se résolvent qu'à ~0,5 m en simple précision).
- **Hauteur au-dessus du sol** (couleur « hauteur ») : lue dans la dernière
  surface calculée, `z − (mnt + origine)` à la case du point ; 0 hors de la
  surface.
- **Transfert** : tous les tableaux cédés au fil principal.

Et `drape3d { couche, reglagesCouche }` → un `Float32Array` d'une valeur par
point du dernier nuage : la valeur de la couche à la case du point (comme
`RELIEF.valeurParPoint`), NaN hors de la surface. La couche est prise dans le
mémo du worker, calculée au besoin sur la même surface. L'étirement
(min, max) est celui déjà calculé pour l'image du même côté du rideau : les
deux vues restent la même image.

### Côté fil principal

- `onglet-3d` redevient actif en vue normale, si WebGL2 est là.
- **En passant en 3D** : si l'emprise de la carte n'a pas changé depuis le
  dernier nuage, rien n'est refait. Sinon, sous le voile d'attente :
  `relief.nuage3d(emprise, budget)` puis `vue3d.definirNuage(nuage, hauteur)`,
  les classes masquées, et la couleur courante (le drapé se redemande si la
  couleur est « relief »). L'ancien nuage est libéré d'abord (`vue3d.vider`),
  jamais deux à la fois.
- **Réponse vide** : la vue 3D affiche un avis centré, « Zoomez sur la carte
  pour afficher le nuage en 3D », et garde son canevas vide.
- **Rien ne suit la carte pendant qu'on est en 3D** : la carte est masquée,
  elle ne bouge pas ; le flux n'a rien de nouveau à demander.
- **Plafond** : `CONFIG.rendu.budget3D` — 5 M sur ordinateur, 2 M sur
  appareil portatif (même heuristique que le budget du flux). Un curseur dans
  la section 3D du panneau, de 1 à 20 M ; le changer reconstruit le nuage.
- **Sélection et mesure** : `vue3d.pointDuNuage` sur le nuage affiché, comme
  aujourd'hui. Le repli sur l'enveloppe du terrain lisait la grille d'une
  dalle ; en vue normale, sans elle, un clic qui ne touche aucun point dit
  « visez le nuage », comme aujourd'hui quand rien n'est trouvé.
- **Lien** : `#map=zoom/lat/lon/orientation/inclinaison` depuis la caméra 3D,
  comme déjà écrit ; ouvrir un tel lien en vue normale cadre la carte, puis
  passe en 3D une fois des blocs arrivés.

### L'ombrage de profondeur (EDL)

Une passe d'après-rendu dans `vue3d.js` : le nuage est rendu dans une texture
couleur et une texture de profondeur (`log2` de la profondeur de vue), puis
un triangle plein écran assombrit chaque pixel selon l'écart de profondeur
avec ses huit voisins à un rayon donné (Boucheny, 2009 — la formule de
Potree : `exp(−force · Σ max(0, log2(z) − log2(zᵢ)) / 8)`). Réglages : force et
rayon, `CONFIG.rendu.edl`. Une case « Ombrage de profondeur » dans la section
3D, cochée par défaut. Le shader vit dans `shaders.js`, sous le garde-fou du
backtick.

**Rendu à la demande conservé** : l'EDL ne fait qu'une passe de plus par
image, et l'image n'est redessinée que sur `invalider()`.

## Erreurs

- WebGL2 absent : l'onglet 3D reste désactivé, comme aujourd'hui.
- Worker du relief indisponible (repli sur le fil principal) : même demande,
  même réponse, calculée sur place.
- Échec de construction (mémoire) : message d'erreur dans le statut, l'onglet
  3D garde son avis « Zoomez… ».
- Contexte WebGL perdu : comme aujourd'hui dans `vue3d.js` (hors de cette
  conception).

## Tests

- **Node** :
  - `nuage3d` rend au plus `budget` points, tous dans l'emprise, et les mêmes
    pour la même vue ; tous les points quand le budget suffit ; `vide` sans bloc ;
  - les coordonnées se retrouvent en Lambert-93 absolu à 1 cm près
    (`origine` + x) ;
  - la hauteur vaut `z − sol` sur une surface connue ;
  - `drape3d` rend la valeur de la couche à la case de chaque point ;
  - le tirage est uniforme (écart de densité borné entre quarts d'emprise) ;
  - l'intensité arrive jusqu'au nuage ;
  - le source du worker reste autonome (test existant).
- **Sources** : identifiants lus par `app.js`, backticks GLSL (EDL).
- **Navigateur (Chromium de WSL)** :
  - vue large → avis « Zoomez » en 3D ;
  - vue à Verdun → nuage de ≤ budget points ;
  - retour à la carte sans bouger puis 3D → même nuage, pas de voile ;
  - déplacement puis 3D → nouveau nuage ;
  - sélection d'un point et mesure en 3D ;
  - case EDL (image différente, pas d'erreur) ;
  - lien 3D avec angles.
- **À l'œil, par l'utilisateur** : lisibilité avec l'EDL, fluidité à 5 M
  points sur la carte AMD.

## Points ouverts, à trancher à l'usage

- Plafonds par défaut (5 M / 2 M) et bornes du curseur.
- Force et rayon de l'EDL.
- Faut-il garder aussi les blocs fins gardés d'une vue précédente quand ils
  tombent dans l'emprise (plus de détail sur une partie de la zone) ? Non
  pour l'étape 1 : densité régulière d'abord.
