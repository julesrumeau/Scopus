# Scopus

![Bois des Caures (Verdun) : à gauche la photo aérienne ne montre qu'une forêt ; à droite, derrière le rideau, le Sky-View Factor révèle un fortin bastionné et des centaines de trous d'obus](docs/capture-verdun.png)

Explorer le **LiDAR HD de l'IGN** dans le navigateur, sans rien installer :
cabanes, ruines, sentiers, terrasses : tout ce que la végétation cache, en
métropole comme à la Réunion et en Guadeloupe.

**Ouvrir `index.html`, c'est tout.** Ou essayer directement en ligne :
**[julesrumeau.github.io/Scopus](https://julesrumeau.github.io/Scopus/)**

> Aucune détection automatique : l'outil calcule le relief, à vous de repérer
> ce qui vous intéresse, comme le fait la prospection LiDAR depuis toujours.

## Ce que fait Scopus

- **Voir sous les arbres.** Le relief de ce qui est à l'écran se calcule dans
  votre navigateur : ombrage, ombrage à 4 soleils, micro-relief, Sky-View
  Factor, ouvertures. Un **rideau** compare la photo aérienne, le plan IGN et
  chaque couche ; un mode **deux cartes synchronisées** les met côte à côte.
- **Mesurer.** Une mesure en chaîne donne distances, dénivelés et pentes ; Maj
  + clic pose un point à angle droit. Les points se déplacent au glisser.
- **Couper le terrain.** Le **profil** trace une bande entre deux points et
  montre la coupe verticale du nuage : hauteur d'un arbre, d'un mur, d'une
  marche, avec une mesure sur le graphique.
- **Passer en 3D.** Le nuage de points de la vue, avec ses classes (sol,
  végétation, bâtiment, eau…), exportable en LAS ou PLY.
- **Exporter.** La mesure de la carte et celle du profil s'enregistrent en
  **GeoJSON, GPX ou OSM XML**, avec l'altitude du sol en option.
- **Connaître la date du vol.** « Point sélectionné » donne la plage
  d'acquisition de la dalle, telle que l'IGN la publie.
- **Partager.** Le lien porte la vue, la mesure, le profil et les réglages, au
  format d'OpenStreetMap (`#map=zoom/lat/lon`) : il s'ouvre tel quel dans
  osm.org, iD ou JOSM.

## Utilisation

1. **Aller quelque part** : déplacer la carte, chercher une commune ou des
   coordonnées (`42.74, 1.68`), utiliser « Ma position », ou ouvrir un lien
   partagé.
2. **Zoomer** : le relief se calcule tout seul, sans dalle à choisir ni rien à
   lancer. Les points arrivent du plus grossier au plus fin, et l'image
   s'affine à mesure.
3. **Comparer** : glisser le rideau pour voir ce que la photo ne montre pas.

Sur téléphone, le panneau devient une feuille tirée du bas, et la carte reste
utilisable au-dessus.

![Intérieur montagneux de la Réunion : photo aérienne à gauche, Sky-View Factor à droite](docs/capture-reunion.png)

## Pourquoi entièrement statique

Aucun serveur, aucune base de données, aucun compte : le dépôt **est** le
site. `index.html` s'ouvre en double-cliquant depuis le disque exactement
comme il se publie sur GitHub Pages : le même fichier, sans rien changer.

Les points sont lus directement sur les serveurs de l'IGN par requêtes HTTP
de plage (seuls les blocs de la vue, et seulement les parties utiles de
chacun), sans jamais passer par un serveur intermédiaire, puis gardés dans
le cache du navigateur pour la visite suivante. Tout le reste (décompression,
calcul du relief) se fait dans l'onglet, sur la machine de qui regarde.

## Lancer, tester, publier

```sh
npm test                  # tests unitaires et de sources, aucune dépendance
```

```sh
npm run fumee             # test de fumée : ouvre le vrai site dans Chromium
```

Le test de fumée demande un Chromium et `playwright-core` hors du dépôt (voir
`CLAUDE.md`). Publié sur GitHub Pages : chaque `git push` sur `main` redéploie
tout seul.

## En savoir plus

- **`CLAUDE.md`** : architecture complète, décisions techniques, pièges
  rencontrés, mesures.
- **`TODO.md`** : ce qu'il reste à faire.

## Soutenir

Scopus est gratuit, sans pub ni compte, et le restera. S'il vous sert, un don
aide à le faire vivre : **[offrir un café sur Ko-fi](https://ko-fi.com/julesrumeau)**,
ou un soutien régulier sur [Liberapay](https://liberapay.com/julesrumeau/donate).
Rien n'est réservé aux donateurs.

## Licences

Ce dépôt est sous licence **[MIT](LICENSE)**. Données **LiDAR HD © IGN**,
licence ouverte Etalab. Leaflet et laz-perf, redistribués dans `vendor/`,
gardent leurs licences respectives : détail dans
[`vendor/LICENCES.md`](vendor/LICENCES.md).

Le fond de carte **« OpenStreetMap (standard) »**, proposé dans les listes du rideau, est servi
par la Fondation OpenStreetMap : données **© les contributeurs d'OpenStreetMap, licence
[ODbL](https://www.openstreetmap.org/copyright)**. Scopus respecte la
[politique d'usage des tuiles](https://operations.osmfoundation.org/policies/tiles/) : le site envoie
son Referer, la mention et le lien de copyright restent affichés sur la carte, pas de téléchargement
en masse. Cette licence ne s'applique pas au code du dépôt, seulement à ces tuiles.

---

Un retour sur l'outil, un bug ? <jules.rumeau1@gmail.com>
