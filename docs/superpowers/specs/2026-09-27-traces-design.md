# Détection des tracés — conception

Date : 27 septembre 2026 · Branche : `feat/traces` (depuis `dev`)

## Objectif

Trouver sur le relief **tout ce qui dessine une ligne comme un chemin** :
sentiers, chemins, pistes, routes, ruisseaux, sentes d'animaux. On ne
cherche pas à les distinguer — l'utilisateur ne le peut pas non plus à l'œil,
et on l'assume. Le libellé dans l'appli le dit : « Détecter les tracés ».

Le détecteur **ne lit que le relief** (le Sky-View Factor calculé par
Scopus). L'IGN ne sert qu'à le **noter**, comme un corrigé, jamais à le
guider.

Règles fixées avec l'utilisateur :

- **Pas de réseau de neurones**, ni d'apprentissage : des méthodes classiques
  de traitement d'image, dont chaque étape s'explique.
- **`sentiers.js` est abandonné** : il ne convainquait pas et ses réglages
  étaient pénibles. On repart de zéro, sur l'image SVF — c'est sur elle que
  l'utilisateur voit les chemins. Deux leçons en sont gardées : un tracé qui
  reboucle sur lui-même n'est pas un chemin (filtre de compacité), et les
  seuils se règlent en mètres ou en valeurs normalisées, jamais sur une
  image réduite.
- **On avance comme en TDD** : la mesure d'abord (elle donne 0 % sans
  détecteur), puis le détecteur itéré jusqu'à la cible, avec des images à
  chaque palier pour l'œil de l'utilisateur.

## La vérité terrain : l'IGN

Tout le linéaire de la BD TOPO, par le même WFS que le bâti
(`data.geopf.fr/wfs/ows`) :

- `BDTOPO_V3:troncon_de_route`, **toutes natures** (routes, routes
  empierrées, chemins, sentiers…) ;
- `BDTOPO_V3:troncon_hydrographique` (ruisseaux, écoulements naturels).

Les tronçons arrivent **entiers** dès qu'ils touchent la zone demandée : ils
sont **découpés sur l'emprise** avant toute mesure (sans ça, la première
dalle annonçait 1 638 m de ruisseau pour 482 m réels).

Limites connues, mesurées le 27 septembre sur les deux dalles : les chemins
et routes tombent à quelques mètres des traits du relief ; certains
ruisseaux passent là où le relief ne montre rien (une clairière plate), ou à
côté du fond du vallon. Le score ne peut donc pas atteindre 100 %, et des
tracés absents de l'IGN sont visibles — l'image reste toujours montrée avec
le chiffre.

## La mesure

Deux chiffres, à une tolérance `T` :

- **Rappel** : la part de la longueur IGN (découpée) qui a un tracé détecté
  à moins de `T` mètres. Cible : **≥ 70 %**.
- **Précision** : la part de la longueur détectée qui a un tracé IGN à moins
  de `T` mètres. Cible de départ : **≥ 50 %**. Les tracés « en plus » sont
  souvent de vrais chemins absents de l'IGN : ce chiffre repère le bruit,
  l'œil de l'utilisateur tranche.

`T = 10 m` (écart observé entre l'IGN et les chemins visibles) ; `20 m` est
aussi rapporté. Calcul sur une grille : on rastérise les deux jeux de lignes,
une transformée de distance donne pour chaque cellule la distance à l'autre
jeu, et on somme les longueurs.

## Les données de travail

- **Dalle de référence** : `LHD_FXX_0536_6214` (lot `IR_2025-03-20`), point
  `#map=15/43.00284/1.0007`. Forêt de pente, 43 M de points, 6,2 km de
  tracés IGN (5 122 m de chemins, 602 m de route empierrée, 482 m de
  ruisseau). Les chemins y sont nets.
- **Dalle de contrôle, plus dure** : `LHD_FXX_0535_6214`, sa voisine à
  l'ouest. Forêt très dense (8 % de points sol), trous sans sol, un sentier
  et des ruisseaux. Sert à vérifier qu'on n'a pas réglé pour une seule
  dalle.

Les blocs COPC sont téléchargés une fois et gardés dans `.tmp/` (non
versionné) : une itération du banc ne repasse pas par le réseau.

## L'entrée : le SVF de Scopus

Calculé exactement comme dans l'appli : `VUE_RELIEF` (rangement, terrain,
surface) puis `RELIEF.calculer('svf')`, réglages par défaut. Grille de
**50 cm** ; **1 m** sera essayé aussi (moins de trous et de bruit sous forêt
dense, pour des chemins de 1 à 3 m de large).

**Défaut à régler d'abord** : autour des trous sans point de sol, le SVF
dessine des **étoiles sombres à huit branches** — autant de faux petits
traits pour un détecteur de lignes. Le code est censé les éviter (cases
sans donnée en NaN dans le balayage, CLAUDE.md « Lecture du relief ») ; elles
réapparaissent sur la surface de la vue (`garderRepli`). À comprendre, puis
corriger ou masquer — et vérifier au passage si l'appli les montre aussi.
Les cases sans donnée sont exclues de la détection.

## La détection

Trois approches classiques, comparées sur le banc avant d'en retenir une.
Toutes cherchent des **traits fins, sombres, longs et éventuellement
courbes** dans le SVF :

1. **Filtre de lignes** : la courbure de l'image (hessienne) à plusieurs
   largeurs (1 à 4 m), qui répond fort sur un trait sombre allongé quelle
   que soit sa direction ; puis seuillage à deux niveaux (hystérésis).
2. **Ouvertures par chemins** (*path openings*, Talbot & Appleton 2007 ; en
   version robuste, Cokelaer et al. 2012) : une opération de morphologie
   mathématique qui ne garde que les structures assez **longues**, même
   courbes, et efface les taches — faite pour les lignes fines dans une
   image bruitée.
3. **Segments puis raccordement** : un détecteur de segments rectilignes
   (type LSD), dont les morceaux sont ensuite reliés bout à bout.

Puis, en commun : amincissement en squelette, conversion en polylignes,
**raccordement des trous** (un chemin sous un arbre tombé ou un trou sans
sol reste un seul tracé si les deux bouts s'alignent), et filtres —
longueur minimale, compacité (pas de pelote).

Tous les réglages sont en **mètres** ou en **valeurs normalisées** du SVF,
pour tenir à tous les pas de grille.

## Le banc

`tools/banc-traces.js`, lancé par `npm run banc-traces` : pour chaque dalle,
les blocs (cache disque), le SVF, la détection, les tracés IGN découpés, la
mesure. Il écrit les deux chiffres par dalle et une page d'images : SVF avec
la détection et l'IGN superposés (couleurs distinctes), à pleine
résolution par quarts. Les sources de Scopus y sont chargées dans le
contexte principal de Node (pas le contexte `vm` des tests, sept fois plus
lent).

Tests (`npm test`) :

- la mesure, sur des lignes connues : deux lignes identiques → 100 % / 100 % ;
  décalées de 5 m → 100 % à 10 m, 0 % à 2 m ; une ligne de trop → la
  précision baisse d'autant ; découpe sur l'emprise ;
- le détecteur, sur un SVF synthétique : un trait sombre courbe dans du
  bruit est retrouvé ; une tache ronde ne l'est pas ; un trait coupé par un
  trou est raccordé ; aucun tracé sur du bruit seul ;
- le source composé du worker reste autonome (test existant), si la
  détection y tourne.

## Dans l'appli

- Un bouton **« Détecter les tracés »** dans la section Relief du panneau,
  avec une ligne d'aide (« chemins, sentiers, ruisseaux, sentes : tout ce qui
  dessine une ligne dans le relief »). Actif quand un relief est calculé à
  l'écran.
- La détection tourne **dans le worker du relief**, sur la surface déjà
  calculée pour la vue — rien à retélécharger. Réglages en mètres : elle
  vaut au pas de la vue (jamais sous 50 cm). Au-delà d'un pas maximal (vue
  trop large, cases trop grosses pour des chemins), le bouton dit de zoomer.
- Les tracés s'affichent sur la carte, dans le volet des outils (SVG), au
  dessus du relief, d'une couleur qui se lit sur le SVF comme sur la photo.
  Un second clic les efface ; ils sont effacés aussi quand la vue change
  trop.
- `sentiers.js`, ses tests, `SENTIERS_MASQUES` et le volet Sentiers de
  l'ancienne interface (`?dalle`) sont retirés.

## Critères d'arrêt

- Sur la dalle de référence : **rappel ≥ 70 % et précision ≥ 50 %** à 10 m,
  et l'œil de l'utilisateur valide les images.
- Sur la dalle de contrôle : les chiffres ne s'effondrent pas (le niveau
  attendu y sera plus bas, forêt dense).
- Si les trois approches plafonnent sous 70 %, on s'arrête pour décider
  avec l'utilisateur plutôt que de régler à l'aveugle.

## Hors de cette conception

- Les ruines et les structures (même démarche, plus tard, sur des ruines
  connues).
- Distinguer un chemin d'un ruisseau ou d'une sente.
- L'export des tracés (GPX, GeoJSON), à décider après usage.
