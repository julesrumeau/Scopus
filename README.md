# Scopus

Explorer le **LiDAR HD de l'IGN** dans le navigateur, sans rien installer :
cabanes, ruines, sentiers, terrasses — tout ce que la végétation cache. Né pour
l'Ariège et les Pyrénées, utilisable **partout où l'IGN a volé** — soit la
quasi-totalité de la France.

**Ouvrir `index.html` — c'est tout.** Pas de serveur, pas d'installation, pas de
commande, pas de base, pas de compte. Les données ne quittent jamais l'onglet.

> **La détection automatique est masquée dans l'interface** : les deux chaînes
> (structures, sentiers) existent et sont testées, mais aucune n'a encore été
> confrontée à une structure réelle connue. L'outil sert aujourd'hui à *lire*
> le relief à l'œil — voir `CLAUDE.md`, « La détection automatique est
> masquée ».

---

## Utilisation

1. **Choisir une dalle** — cliquer une zone bleue sur la carte, ou chercher une
   commune ou des coordonnées (`42.74, 1.68`).
2. **Choisir la résolution, puis charger** — la dalle entière (1 km²), coût en
   Mo affiché avant tout téléchargement. Une trentaine de secondes en pleine
   résolution.
3. **Lire en 2D** — deux couches (photo aérienne, ombrage, micro-relief,
   Sky-View Factor, ouverture) de part et d'autre d'un rideau qu'on glisse.

### Se déplacer dans le nuage 3D

Comme sur une carte, pas comme dans un logiciel 3D :

| Geste | Effet |
|---|---|
| Glisser | Déplace le terrain |
| Molette | Zoome sous le curseur |
| Maj + glisser, clic droit, bouton du milieu | Pivote autour du point visé |
| Double-clic | Se rend à cet endroit |
| Boussole, en haut à droite | Remet un cardinal en haut de l'écran |

Raccourcis : `c` carte · `r` vue 2D · `v` nuage 3D · `t` vue de dessus ·
`f` tout cadrer. Les chiffres `1`, `2`, `3` font la même chose que `c`, `r`, `v`.

La légende de classification **est** le filtre : cliquer une entrée masque ou
rétablit sa classe.

## Lancer l'outil

- **Double-cliquer sur `index.html`** — rien à installer.
- **En ligne** — <https://julesrumeau.github.io/Scopus/>

Un navigateur récent suffit. WebGL2 n'est requis que pour l'onglet 3D : sans
lui, cet onglet est neutralisé et le reste (carte, 2D, relief, photo) fonctionne
normalement. Sur téléphone, prudence : une dalle pleine pèse jusqu'à 520 Mo en
mémoire, la résolution proposée par défaut y est donc plus prudente.

### Tests

```sh
npm test                  # tests unitaires et de sources
npm run embarquer-lazperf # après une mise à jour de laz-perf, uniquement
```

Aucune dépendance à installer dans les deux cas.

### Publier sur GitHub Pages

Le dépôt **est** le site : aucune construction, aucun workflow.

1. **Settings** → **Pages**
2. *Build and deployment* → **Source** : `Deploy from a branch`
3. **Branch** : `main`, dossier **`/ (root)`** → **Save**

L'adresse apparaît alors dans la même page : `https://<compte>.github.io/Scopus/`.
Ensuite, chaque `git push` sur `main` redéploie automatiquement (30 s à 1 min,
suivre dans l'onglet **Actions**).

- Le dépôt doit être **public** — Pages n'est pas disponible sur un dépôt privé
  avec un compte gratuit.
- `.nojekyll` est indispensable et déjà présent, sans quoi Jekyll écarte les
  fichiers commençant par `_`.
- Aucun chemin absolu dans `index.html` — nécessaire pour que le site fonctionne
  depuis `/Scopus/` comme en `file://`.

Si une mise à jour ne se voit pas, c'est le cache de Pages (10 min) :
`Ctrl+Maj+R`.

---

## Validation

`npm test` — nuages synthétiques à vérité connue, projection vérifiée contre le
WFS de l'IGN, contrôles mécaniques sur les sources. Sur données réelles
(plateau de Beille), la cabane connue est retrouvée à 1,3 m, sans faux positif,
à trois échelles d'emprise. Détail complet et chiffres dans `CLAUDE.md`.

**Non validé pour la détection automatique** (masquée, structures comme
sentiers) : aucune ruine ni chemin réels n'ont servi de contrôle positif à
l'algorithme. La lecture du relief à l'œil, elle, vient d'être confirmée sur
une ruine réelle connue de l'auteur.

---

## Structure

```
index.html · styles.css        interface ; l'ordre des <script> compte
src/config.js                  seuils et paramètres, source de vérité
src/attente.js                 voile d'attente (roue CSS pendant un calcul bloquant)
src/proj.js                    Lambert-93 ↔ WGS84
src/reseau.js                  file HTTP à parallélisme borné, réessais
src/ign.js                     appels WFS/WMTS : dalles, blocs, BD TOPO, géocodage
src/copc.js                    lecteur COPC par requêtes de plage
src/decodeur.js                décompression LAZ ; source du worker blob
src/nuage.js                   orchestration du chargement, grappe de workers
src/raster.js                  grilles, MNT, pente
src/detection.js               masque, morphologie, composantes, filtres, score
src/lignes.js                  extraction de structures par la forme du relief
src/sentiers.js                relief local, Frangi, squelette, vectorisation
src/sortie.js                  rapprochement BD TOPO, liens, exports
src/gl.js · shaders.js         WebGL2 (repris de FlowField)
src/vue3d.js                   caméra orbitale, rendu par points
src/boussole.js                rose des vents projetée sur le repère caméra
src/relief.js                  ombrage, micro-relief, SVF, ouverture
src/ortho.js                   photo aérienne redressée dans la grille Lambert-93
src/vue-2d.js                  vue 2D, deux couches et rideau de comparaison
src/carte.js                   Leaflet, couverture LiDAR, sélection de dalle
src/grille.js                  grille kilométrique locale, tracée au canevas
src/app.js                     assemble tout ; seul fichier qui lit index.html
vendor/lazperf/                laz-perf ; `lazperf-embarque.js` est le fichier
                               réellement chargé (généré, JS + WASM en chaînes)
tools/banc-lignes.js           banc de calibration à vérité connue (npm run banc)
tools/embarquer-lazperf.js     régénère l'embarqué après mise à jour de laz-perf
test/*.test.js                 tests : projection, détection, shaders, sources
test/charger.js, nuages.js     harnais partagés par les tests
```

Architecture, décisions et pièges connus : voir `CLAUDE.md`. Tâches restantes :
voir `TODO.md`.

---

## Licences

Données **LiDAR HD © IGN**, licence ouverte Etalab — réutilisation libre, y
compris commerciale, sous réserve de mentionner la source.

Deux bibliothèques sont redistribuées dans `vendor/` plutôt que chargées depuis
un CDN, condition de l'ouverture par double-clic :

| Composant | Licence |
|---|---|
| [Leaflet 1.9.4](https://leafletjs.com) | BSD 2-Clause |
| [laz-perf 0.0.7](https://github.com/hobuinc/laz-perf) | Apache-2.0 |

Textes complets dans [`vendor/LICENCES.md`](vendor/LICENCES.md).

---

Un retour sur l'outil, un bug ? <jules.rumeau1@gmail.com>
