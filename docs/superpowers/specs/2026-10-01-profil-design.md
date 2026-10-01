# Profil topographique — conception

Branche `feat/profil`, depuis `dev`. Vue normale uniquement (pas `?dalle`).

## Besoin

Demande OSM (forum OSM-FR, « Hauteur depuis LidarHD IGN » ; flux actuel : QGIS
+ plugin T Vertical Sessions, GPLv2, plus maintenu) : tracer un segment sur la
carte avec une **largeur de bande**, voir la **coupe verticale** des points
LiDAR de cette bande, et **mesurer dessus**. Usage visé : hauteur d'arbres
remarquables et faîtage de bâtiments, au décimètre, pour le tag OSM `height`.

Ce qui compte, d'après le fil :

- La **largeur de bande** est essentielle : le point culminant d'un arbre n'est
  pas localisable, la bande en donne le maximum réel.
- **Le sol est le point difficile** : il faut le voir distinctement sous le
  houppier (classes affichées au choix).
- Précision décimétrique ; **valeurs de mesure bien lisibles** (le texte orange
  du plugin était illisible).
- Ce n'est pas un calcul automatique de hauteur : on affiche le profil et on
  met l'outil de mesure à disposition. Un bouton « hauteur max dans la bande »
  pourra venir si on le demande.

Hors v1 : la **date d'acquisition** (`source:height:date`), voir `TODO.md` #7 ;
le profil dans l'onglet 3D ; l'export du profil ; un calcul automatique.

## Parcours

Deux temps, jamais affichés ensemble.

### 1. Choisir la bande, sur la carte

- Une icône **Profil** dans `#barre-mode`, à côté de Mesure, info-bulle
  « Profil ». Mode `profil` de `definirModeInteraction`.
- En mode Profil, deux clics posent A puis B ; un troisième clic est ignoré.
  Les deux points se **déplacent en les glissant** (le profil n'est pas
  recalculé tant qu'on n'a pas validé).
- La bande est dessinée dans le volet SVG `outilsVue` : un quadrilatère
  (4 coins projetés exactement, **jamais** un rectangle aligné sur l'écran —
  voir « La carte ») et l'axe A→B.
- Une **petite fenêtre flottante** sur la carte (en bas au centre ; en haut au
  centre sous 600 px, pour ne pas passer sous la feuille du panneau) :
  largeur (curseur + champ, 0,5 à 30 m, 3 m par défaut), **Effacer**,
  **Valider** (inactif tant qu'il n'y a pas deux points). Elle n'existe que
  dans le mode Profil ; quitter le mode la masque, la bande reste, revenir la
  rouvre.
- Pas de calcul dynamique.

### 2. Lire le profil, dans une modale

**Valider** ouvre `#dlg-profil`, une grande modale (presque plein écran,
croix pour fermer, Échap), sur le modèle de `#dlg-export`. La fermer ramène à
la carte, bande intacte.

Contenu :

- **Largeur** (champ + curseur), aussi dans la modale : un changement de valeur
  (évènement `change`, pas `input`) **recalcule le profil sur place**. Même
  largeur que sur la carte, qui la suit à la fermeture.
- **Graphique** : abscisse = distance le long de l'axe (m), ordonnée =
  altitude absolue (m), un point par retour LiDAR, **couleur par classe**
  (palette de la 3D). Points assez gros et contrastés pour se lire.
- **Classes** : cases à cocher, dans la modale, une par classe présente dans
  la bande. Initialisées avec les classes cochées de la légende 3D ; les
  changer dans la modale **ne touche pas** la légende (un état local,
  sans effet de bord).
- **Double curseur** sous le graphique : deux poignées sur l'axe de la bande.
  Aux deux extrémités = toute la bande ; rapprochées = on ne garde que ce
  tronçon (le graphique se recadre, la mesure ne porte que dessus). Il ne
  change **pas** la bande ni son calcul : seulement ce qu'on regarde.
- **Mesure** : deux clics sur le graphique posent deux repères ; affichés :
  distance horizontale, dénivelé (signé), distance 3D, pente. Les valeurs sont
  écrites en gros, à fort contraste. Un troisième clic recommence.
- Compteur de points de la bande, et un avis si la bande est longue (> 500 m)
  ou si la densité est faible (niveau d'octree grossier).

## Données

Un message `profil` au worker (`relief-travailleur.js`), sur le modèle de
`nuage3d` : `moteur.profil(A, B, largeur, actifs)` dans `vue-relief.js`.

- Entrée : A, B en coordonnées locales de la vue (`projVue().versLocal`),
  largeur en m, `actifs` = blocs que `flux.voulues()` demande (comme la 3D).
- Pour chaque bloc qui coupe la boîte englobante de la bande, balayage
  linéaire de ses points (centimètres entiers, `p.xc + ox`…). Pour un point :
  `s = (P − A)·u` (distance le long de l'axe), `d = (P − A)·n` (écart latéral),
  gardé si `0 ≤ s ≤ |AB|` et `|d| ≤ largeur/2`.
- Sortie : `s` (Float32, m), `z` (Float32, altitude absolue en m), `cls`
  (Uint8), `n`, longueur de l'axe, histogramme par classe. Tout est rendu : le
  filtrage par classe se fait côté modale (cocher ne redemande rien).
- Plafond de 1 M de points avec le même tirage par hachage que `nuage3d`
  (`hacher`) : mêmes points à chaque calcul ; l'avis le dit s'il a joué.
- Le calcul coûte quelques dizaines de ms pour une bande de 100 m ; il passe
  par la file du worker (un calcul à la fois, comme `calculer`).
- Densité : la bande ne contient que ce que le flux a chargé. À 100 m le zoom
  demandé est fin ; à large échelle le profil est pauvre, d'où l'avis.
- **Altitude vraie, vérifié** : les blocs du flux portent `origineCm[2] = 0`
  (`flux.js:200`, échelle 0,01 et décalage 0 chez l'IGN) : `zc` est déjà l'altitude
  absolue en centimètres, `z = zc / 100`.

## Composants

| Fichier | Rôle |
|---|---|
| `src/profil.js` (nouveau) | Pur, sans DOM : géométrie de la bande (`bande(A, B, largeur)` → coins, axe, `|AB|`), projection d'un point (`s`, `d`), `mesurer(p1, p2)` (distance, dénivelé, 3D, pente), recadrage par le double curseur. Testé sans navigateur. |
| `src/vue-relief.js` | `profil(...)` dans le worker, à côté de `nuage3d`. |
| `src/relief-travailleur.js` | Message `profil`, dans les deux implémentations (worker et repli). |
| `src/profil-graphique.js` (nouveau) | Canevas 2D du graphique : axes, points colorés, repères de mesure, double curseur. |
| `src/app.js` | Mode `profil`, fenêtre flottante, bande SVG dans `carteOutils` (`profil(...)`), ouverture de la modale. |
| `index.html`, `src/styles.css` | Bouton de mode, fenêtre flottante, `#dlg-profil`. |

`src/profil.js` et `src/vue-relief.js` suivent la contrainte `file://` : le
second est déjà du type `function fabriqueX()`, le premier doit l'être aussi
s'il est appelé depuis le worker, et rester listé dans le source composé
(`test/relief-travailleur.test.js`).

## Erreurs et cas limites

- Aucun point dans la bande : la modale le dit (« Aucun point ici — zoomez, ou
  élargissez la bande »), pas de graphique vide muet.
- Bande trop longue (> 2 km) : refusée avec un message, sans calcul.
- Les deux points confondus (|AB| < 1 m) : **Valider** reste inactif.
- Relief sans carte graphique ou avec `&gpu` : `nuage3d` est indisponible dans
  ce cas ; le profil l'est aussi, avec le même message, plutôt que de rendre
  un résultat faux.
- Changer de territoire (DROM) ou de vue avant de valider : A et B restent en
  coordonnées locales du territoire où ils ont été posés ; ils sont effacés si
  le territoire change.

## Tests

- `test/profil.test.js` : géométrie sur cas à réponse connue (bande alignée
  sur X, sur Y, oblique à 45°, points juste dedans / juste dehors de la
  largeur et des extrémités), `mesurer` (dénivelé signé, pente, 3D), recadrage.
- `test/vue-relief.test.js` : `profil` sur un nuage synthétique (un « arbre »
  de hauteur connue sur un sol plat) : le maximum de la bande est la cime,
  la classe 2 donne le sol ; points hors bande exclus ; plafond et hachage
  stables d'un appel à l'autre.
- `test/relief-travailleur.test.js` : le message `profil` passe dans le source
  composé du worker, contexte nu.
- Contrôle mécanique existant (`test/sources.test.js`) : identifiants lus par
  `app.js` présents dans `index.html`.

## Décisions à ne pas défaire

- **Profil et mesure sont deux outils.** Le profil choisit la bande ; la
  mesure s'applique ensuite sur le graphique. La mesure en chaîne de la carte
  n'est pas touchée.
- **Pas de calcul dynamique à la pose des points** : on valide. En revanche
  la largeur, dans la modale, recalcule au `change`, parce que l'essai le plus
  fréquent sur un arbre est « un peu plus large ».
- **Les classes sont locales à la modale**, initialisées depuis la 3D.
- **Le double curseur recadre, il ne recalcule pas.**
