# Relief piloté par la vue — plan 3 : l'affichage et l'interface

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire du relief piloté par la vue la vue normale de Scopus. Le relief doit être posé exactement sur la carte, arriver plus vite, et s'accompagner d'un panneau qui le règle, sans `?flux` ni dalle à choisir.

**Architecture:**
- Le worker du relief (`relief-travailleur.js`) ne rend plus des valeurs mais une **image déjà reprojetée** au pixel de la carte (Web Mercator). `VUE_IMAGE` fait cette reprojection par un maillage interpolé, comme la photo aérienne ; la carte la pose telle quelle, sans décalage.
- `VUE_RELIEF` range chaque bloc **une fois** dans la grille de la vue ; un déplacement ne range que la bande entrante ; une grille neuve ne prend que les blocs que la vue demande. La couche calculée est mémoïsée, et un changement de contraste ne la recalcule pas.
- L'ancienne interface par dalle reste derrière `?dalle`.

**Tech Stack:**
- Scripts classiques, Leaflet.
- Worker monté depuis une URL blob, dont le source est composé du texte des fonctions.
- `OffscreenCanvas.convertToBlob` quand il existe.
- Tests `node --test` (`test/charger.js`, contexte `vm` nu pour le worker).
- Parcours Playwright dans le Chromium de WSL.

**Spec:** `docs/superpowers/specs/2026-09-26-flux-vue-design.md`, section « 3. L'affichage et l'interface » **et sa révision après le plan 2**, qui prévaut.

## Global Constraints

- Ouverture en `file://` :
  - scripts classiques, **aucun `import`** ;
  - tout nouveau fichier de `src/` est chargé par `index.html` (`test/sources.test.js`) ;
  - tout identifiant lu par `app.js` existe dans `index.html`.
- **Worker** : son source est composé du texte des fonctions (`RELIEF_TRAVAILLEUR.source()`). Tout module qui y part s'écrit `function fabriqueX() {…}` puis `const X = fabriqueX();`, ou se liste fonction par fonction. `test/relief-travailleur.test.js` fait tourner ce source dans un contexte nu.
- **Relief au processeur par défaut.** La carte graphique employée par un worker fait geler la page : elle n'est réessayée que pour le SVF, derrière `&gpusvf`, et ne devient le défaut que si `&chrono` ne montre aucun gel.
- **La ligne 0 d'une grille est au sud** (`RASTER.centreCellule`). La ligne 0 d'une image est au nord. La reprojection se vérifie contre `PROJ` et `centreCellule`, jamais contre une convention recopiée dans le test.
- **Pas de MNT de l'IGN.** Au-delà de `CONFIG.flux.surfaceMaxPointsKm2`, le côté relief reste noir et un message dit de zoomer.
- Le SVF par défaut ; l'ombrage n'est pas proposé.
- Commentaires et messages en français, qui disent **pourquoi**.
- Mesurer avec `&chrono` : l'utilisateur lance, colle les tableaux. Pas de long harnais de mesure dans le Chrome de Windows.

## Review Focus

- **Carte déplacée pendant un calcul.** L'image rendue doit tomber à sa place géographique (bornes de la demande, pas de la vue du moment), et le calcul suivant partir avec la vue courante (tâche 6).
- **Déplacement d'une fraction de case, ou de plus d'une grille.** Le rangement incrémental doit rendre exactement la surface d'un rangement complet, ou reconstruire (tâche 3).
- **Bloc libéré par le budget alors qu'il était rangé dans la grille.** Il faut reconstruire, sinon ses points resteraient dans le minimum (tâche 3).
- **Lien ancien `#d=x,y`, lien `#map=`, bouton « Voir un exemple », clic sur la carte.** Plus aucune sélection de dalle ni aucun téléchargement de dalle entière dans la vue normale (tâche 7).
- **Écran étroit (380 px, tiroir).** Le rideau doit se tirer au doigt, sans déplacer la carte (tâche 8).

---

## Fichiers

- Créer `src/vue-image.js` : `VUE_IMAGE`, reprojection d'une couche en image Web Mercator (pur, envoyé au worker).
- Modifier `src/raster.js` : `accumulerCm` accepte un rectangle de cases à exclure.
- Modifier `src/vue-relief.js` :
  - rangement incrémental ;
  - blocs actifs ;
  - classes présentes ;
  - mémo de couche ;
  - option `couches: 'gpu'`.
- Modifier `src/relief-travailleur.js` : proj et vue-image dans le worker ; la demande `image`.
- Modifier `src/flux.js` : `voulues()`.
- Modifier `src/flux-calque.js` : `CalqueReliefControle` devient `CalqueRelief` (image aux bornes de la demande).
- Modifier `src/app.js` :
  - mode vue par défaut, `?dalle` pour l'ancien ;
  - panneau du relief ;
  - accueil, lien et clic ;
  - `&debug`, `&gpusvf`.
- Modifier `index.html` et `styles.css` : section du relief, masquage de l'ancien parcours en mode vue.
- Créer `test/vue-image.test.js` ; modifier `test/vue-relief.test.js`, `test/relief-travailleur.test.js`, `test/raster.test.js`, `test/flux.test.js`.
- Modifier `CLAUDE.md` et `TODO.md`.

---

### Task 1: La reprojection en image Web Mercator

**Files:**
- Create: `src/vue-image.js`, `test/vue-image.test.js`
- Modify: `index.html` (après `vue-grille.js`)

**Interfaces:**
- Produces:
  - `VUE_IMAGE.pixelVersLonLat(px, py, z) → { lon, lat }`, pixel global Web Mercator au zoom `z` (tuiles de 256 px).
  - `VUE_IMAGE.cases(geo, ecran, versLambert93, pasMaillage = 32) → { u: Float32Array, v: Float32Array }`. Donne la coordonnée continue de case (centres aux entiers) de chaque pixel de l'écran. Le pixel `(i, j)` est lu en son centre ; `j = 0` est en haut, donc au nord. `ecran = { x0, y0, W, H, z }`, où `x0, y0` est le pixel global du coin haut-gauche.
  - `VUE_IMAGE.peindre(valeurs, geo, uv, min, max, lut, lisser) → Uint8ClampedArray` RGBA, opaque. Sans valeur ou hors de la grille, le pixel est noir.

- [ ] **Step 1: Écrire les tests**

`test/vue-image.test.js` :

```js
// Reprojection d'une couche Lambert-93 en image Web Mercator au pixel de la
// carte. Vérifiée contre PROJ et la convention des grilles (ligne 0 au sud,
// RASTER.centreCellule) — jamais contre une formule recopiée : c'est ainsi que
// la photo aérienne est passée retournée nord-sud (CLAUDE.md).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { VUE_IMAGE, VUE_GRILLE, PROJ, RASTER } = chargerScripts(['config.js', 'proj.js', 'vue-grille.js', 'raster.js', 'vue-image.js']);

// Une vue d'environ 700 × 450 m à Verdun, au zoom 17 (≈ 0,8 m par pixel).
const z = 17;
function ecranAutour(lon, lat, W, H) {
  const n = 256 * 2 ** z;
  const px = ((lon + 180) / 360) * n;
  const py = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * n;
  return { x0: Math.floor(px - W / 2), y0: Math.floor(py - H / 2), W, H, z };
}
const ecran = ecranAutour(5.4359, 49.2066, 800, 500);
const so = VUE_IMAGE.pixelVersLonLat(ecran.x0, ecran.y0 + ecran.H, z);
const ne = VUE_IMAGE.pixelVersLonLat(ecran.x0 + ecran.W, ecran.y0, z);
const a = PROJ.versLambert93(so.lon, so.lat), b = PROJ.versLambert93(ne.lon, ne.lat);
const geo = VUE_GRILLE.definir({ xmin: Math.min(a.x, b.x), xmax: Math.max(a.x, b.x), ymin: Math.min(a.y, b.y), ymax: Math.max(a.y, b.y) }, 1, 40, 4096);

test('pixel ↔ lon/lat : l’inverse de la projection Web Mercator', () => {
  const { lon, lat } = VUE_IMAGE.pixelVersLonLat(ecran.x0 + 400, ecran.y0 + 250, z);
  assert.ok(Math.abs(lon - 5.4359) < 1e-4 && Math.abs(lat - 49.2066) < 1e-4, `${lon} ${lat}`);
});

test('chaque pixel tombe dans la case que donne PROJ, au dixième de case près', () => {
  const { u, v } = VUE_IMAGE.cases(geo, ecran, PROJ.versLambert93);
  let pire = 0;
  for (let j = 0; j < ecran.H; j += 7) {
    for (let i = 0; i < ecran.W; i += 7) {
      const ll = VUE_IMAGE.pixelVersLonLat(ecran.x0 + i + 0.5, ecran.y0 + j + 0.5, z);
      const L = PROJ.versLambert93(ll.lon, ll.lat);
      // Case continue attendue, centres aux entiers — la convention de RASTER.centreCellule.
      const c0 = RASTER.centreCellule({ emprise: geo.emprise, pas: geo.pas }, 0, 0);
      const ue = (L.x - c0.x) / geo.pas, ve = (L.y - c0.y) / geo.pas;
      const k = j * ecran.W + i;
      pire = Math.max(pire, Math.abs(u[k] - ue), Math.abs(v[k] - ve));
    }
  }
  assert.ok(pire < 0.1, `écart ${pire} case`);
});

test('le haut de l’image est au nord : v décroît quand on descend', () => {
  const { v } = VUE_IMAGE.cases(geo, ecran, PROJ.versLambert93);
  const haut = v[10 * ecran.W + 400], bas = v[(ecran.H - 10) * ecran.W + 400];
  assert.ok(haut > bas, `${haut} ≤ ${bas}`);
});

test('peindre : la valeur de la case, étirée sur la palette ; sans valeur, noir', () => {
  const W = geo.W, H = geo.H;
  const valeurs = new Float32Array(W * H).fill(1);
  const { u, v } = VUE_IMAGE.cases(geo, ecran, PROJ.versLambert93);
  const k = 250 * ecran.W + 400;
  const cx = Math.round(u[k]), cy = Math.round(v[k]);
  valeurs[cy * W + cx] = NaN;
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) lut.set([i, i, i], i * 3);
  const rgba = VUE_IMAGE.peindre(valeurs, geo, { u, v }, 0, 1, lut, false);
  assert.equal(rgba.length, ecran.W * ecran.H * 4);
  assert.deepEqual([...rgba.slice(k * 4, k * 4 + 4)], [0, 0, 0, 255]);            // case NaN : noir
  const loin = 20 * ecran.W + 20;
  assert.deepEqual([...rgba.slice(loin * 4, loin * 4 + 4)], [255, 255, 255, 255]); // valeur 1 = haut de palette
});

test('peindre : hors de la grille, noir', () => {
  const petite = VUE_GRILLE.definir({ xmin: geo.emprise.xmin, xmax: geo.emprise.xmin + 50, ymin: geo.emprise.ymin, ymax: geo.emprise.ymin + 50 }, 1, 0, 4096);
  const uv = VUE_IMAGE.cases(petite, ecran, PROJ.versLambert93);
  const lut = new Uint8Array(256 * 3).fill(200);
  const rgba = VUE_IMAGE.peindre(new Float32Array(petite.W * petite.H).fill(0.5), petite, uv, 0, 1, lut, false);
  const centre = 250 * ecran.W + 400;
  assert.deepEqual([...rgba.slice(centre * 4, centre * 4 + 4)], [0, 0, 0, 255]);
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `node --test test/vue-image.test.js`
Expected: FAIL (`vue-image.js` introuvable).

- [ ] **Step 3: Écrire le module**

`src/vue-image.js` :

```js
// Reprojection d'une couche de relief (grille Lambert-93) en image au pixel de
// la carte (Web Mercator). La carte pose ensuite l'image sur ses propres bornes,
// sans rien déformer : pas de glissement vers les bords, contrairement à une
// image Lambert posée sur un rectangle WGS84 (un carré Lambert-93 est tourné
// d'environ 1° en Mercator).
//
// Même technique que la photo aérienne (ortho.js), dans l'autre sens : un nœud
// de maillage tous les 32 pixels projeté exactement, l'intérieur interpolé. Les
// deux projections sont conformes, leur composition est localement une
// similitude : l'écart reste sous le dixième de case (test/vue-image.test.js).
//
// Écrit en fabrique : le worker du relief l'emporte (relief-travailleur.js).

function fabriqueVueImage() {
  const TUILE = 256;

  function pixelVersLonLat(px, py, z) {
    const n = TUILE * 2 ** z;
    return { lon: (px / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI };
  }

  /** Coordonnée continue de case (centres aux entiers) de chaque pixel. */
  function cases(geo, ecran, versLambert93, pasMaillage = 32) {
    const { W, H, x0, y0, z } = ecran;
    const nx = Math.ceil(W / pasMaillage) + 1, ny = Math.ceil(H / pasMaillage) + 1;
    const nu = new Float64Array(nx * ny), nv = new Float64Array(nx * ny);
    // Centre de la case (0, 0) : xmin + pas/2, ymin + pas/2 (RASTER.centreCellule).
    const cx0 = geo.emprise.xmin + geo.pas / 2, cy0 = geo.emprise.ymin + geo.pas / 2;
    for (let b = 0; b < ny; b++) {
      for (let a = 0; a < nx; a++) {
        // Nœuds à pas constant, le dernier au-delà du bord s'il le faut : un
        // dernier intervalle raccourci fausserait l'interpolation (piège déjà
        // payé par ortho.js, 13 px de décalage).
        const ll = pixelVersLonLat(x0 + a * pasMaillage + 0.5, y0 + b * pasMaillage + 0.5, z);
        const L = versLambert93(ll.lon, ll.lat);
        nu[b * nx + a] = (L.x - cx0) / geo.pas;
        nv[b * nx + a] = (L.y - cy0) / geo.pas;
      }
    }
    const u = new Float32Array(W * H), v = new Float32Array(W * H);
    for (let j = 0; j < H; j++) {
      const fb = j / pasMaillage, b = Math.min(ny - 2, Math.floor(fb)), tb = fb - b;
      for (let i = 0; i < W; i++) {
        const fa = i / pasMaillage, a = Math.min(nx - 2, Math.floor(fa)), ta = fa - a;
        const k00 = b * nx + a, k10 = k00 + 1, k01 = k00 + nx, k11 = k01 + 1;
        const k = j * W + i;
        u[k] = (nu[k00] * (1 - ta) + nu[k10] * ta) * (1 - tb) + (nu[k01] * (1 - ta) + nu[k11] * ta) * tb;
        v[k] = (nv[k00] * (1 - ta) + nv[k10] * ta) * (1 - tb) + (nv[k01] * (1 - ta) + nv[k11] * ta) * tb;
      }
    }
    return { u, v };
  }

  /**
   * L'image : chaque pixel prend la valeur de sa case, étirée sur la palette.
   * `lisser` interpole entre les centres des quatre cases voisines (quand une
   * case couvre plusieurs pixels), et retombe sur la plus proche si l'une est
   * sans valeur — comme le lissage de l'onglet 2D.
   */
  function peindre(valeurs, geo, uv, min, max, lut, lisser) {
    const { u, v } = uv;
    const n = u.length;
    const rgba = new Uint8ClampedArray(n * 4);
    const Wg = geo.W, Hg = geo.H;
    const echelle = 255 / (max - min || 1);
    for (let k = 0; k < n; k++) {
      const o = k * 4;
      rgba[o + 3] = 255;
      const uu = u[k], vv = v[k];
      const ix = Math.round(uu), iy = Math.round(vv);
      if (ix < 0 || iy < 0 || ix >= Wg || iy >= Hg) continue;
      let val = valeurs[iy * Wg + ix];
      if (lisser) {
        const x0 = Math.floor(uu), y0 = Math.floor(vv);
        if (x0 >= 0 && y0 >= 0 && x0 + 1 < Wg && y0 + 1 < Hg) {
          const fx = uu - x0, fy = vv - y0, i0 = y0 * Wg + x0;
          const bi = (valeurs[i0] * (1 - fx) + valeurs[i0 + 1] * fx) * (1 - fy)
            + (valeurs[i0 + Wg] * (1 - fx) + valeurs[i0 + Wg + 1] * fx) * fy;
          // Une voisine NaN rend la somme NaN : on garde alors la plus proche.
          if (bi === bi) val = bi;
        }
      }
      if (!(val === val)) continue;
      const i = Math.max(0, Math.min(255, Math.round((val - min) * echelle))) * 3;
      rgba[o] = lut[i]; rgba[o + 1] = lut[i + 1]; rgba[o + 2] = lut[i + 2];
    }
    return rgba;
  }

  return { pixelVersLonLat, cases, peindre };
}
const VUE_IMAGE = fabriqueVueImage();
```

Dans `index.html`, après `<script src="src/vue-grille.js"></script>` : `<script src="src/vue-image.js"></script>`.

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/vue-image.test.js test/sources.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vue-image.js test/vue-image.test.js index.html
git commit -m "Vue : reprojection du relief en image au pixel de la carte (Web Mercator)"
```

---

### Task 2: Ranger chaque bloc une fois

**Files:**
- Modify: `src/raster.js` (`accumulerCm`, `accumuler`)
- Modify: `src/vue-relief.js`
- Modify: `test/raster.test.js`, `test/vue-relief.test.js`

**Interfaces:**
- Produces:
  - `RASTER.accumuler(g, bloc, exclure?)`. `exclure = { x0, y0, x1, y1 }` est un rectangle de cases (bornes incluses-exclues) que ce rangement saute, en centimètres entiers seulement.
  - `moteurVue.surface(geo, actifs?: Set<string>)`. La grille d'une vue est gardée ; un nouveau bloc actif y est rangé seul.
    - **Même pas et même taille, grille décalée** : les cases communes sont recopiées ; tous les blocs rangés et actifs sont rangés **hors** de la partie commune.
    - **Reconstruction complète** : autre pas, autre taille, réglages changés, pas de recouvrement, ou bloc rangé puis retiré.
    - `actifs` absent : tous les blocs sont actifs. Un bloc non actif n'entre dans aucune grille neuve ni ajout, mais reste dans une grille où il est déjà rangé.
  - `moteurVue.statistiques() → { reconstructions, decalages, ajouts }`, remis à zéro par `statistiques(true)`.
  - `moteurVue.classes() → Array<[classe, nombre]>` : classes présentes dans les blocs gardés, triées.

- [ ] **Step 1: Écrire les tests**

Ajouter à `test/raster.test.js` :

```js
test('centimètres entiers : un rectangle de cases exclu n’est pas rangé', () => {
  const geo = VUE_GRILLE.definir({ xmin: 0, xmax: 2, ymin: 0, ymax: 1 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 0, [2]);
  RASTER.accumuler(g, {
    nbPoints: 4, origineCm: [0, 0, 0], xc: Int32Array.from([10, 60, 110, 160]), yc: Int32Array.from([10, 10, 10, 10]),
    zc: Int32Array.from([100, 100, 100, 100]), cls: Uint8Array.from([2, 2, 2, 2]),
  }, { x0: 1, y0: 0, x1: 3, y1: 2 });
  assert.deepEqual([g.solN[0], g.solN[1], g.solN[2], g.solN[3]], [1, 0, 0, 1]);
});
```

Ajouter à `test/vue-relief.test.js` :

```js
/** Même surface, champ par champ. */
function memeSurface(a, b) {
  assert.equal(a.N, b.N);
  for (const champ of ['mnt', 'valide', 'hauteur', 'trou']) {
    for (let i = 0; i < a.N; i++) {
      const x = a[champ][i], y = b[champ][i];
      assert.ok(x === y || (Number.isNaN(x) && Number.isNaN(y)), `${champ}[${i}] : ${x} ≠ ${y}`);
    }
  }
}

function reference(blocs, geo) {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  for (const b of blocs) m.ajouter(b);
  return m.surface(geo);
}

test('rangement incrémental : ajouter un bloc à une grille gardée, comme tout ranger', () => {
  const b1 = bloc('a', 1000, 2000, { cote: 30 }), b2 = bloc('b', 1030, 2000, { cote: 30 });
  const g = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 0.5, 0, 4096);
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(b1);
  m.surface(g);
  m.ajouter(b2);
  m.statistiques(true);
  const t = m.surface(g);
  assert.deepEqual({ ...m.statistiques() }, { reconstructions: 0, decalages: 0, ajouts: 1 });
  memeSurface(t, reference([b1, b2], g));
});

test('rangement incrémental : une vue décalée de quelques cases, comme tout ranger', () => {
  const b1 = bloc('a', 1000, 2000);
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(b1);
  m.surface(VUE_GRILLE.definir({ xmin: 1005, xmax: 1045, ymin: 2005, ymax: 2045 }, 0.5, 0, 4096));
  m.statistiques(true);
  const g2 = VUE_GRILLE.definir({ xmin: 1008.3, xmax: 1048.3, ymin: 2003.1, ymax: 2043.1 }, 0.5, 0, 4096);
  const t = m.surface(g2);
  assert.equal(m.statistiques().decalages, 1);
  assert.equal(m.statistiques().reconstructions, 0);
  memeSurface(t, reference([b1], g2));
});

test('un bloc rangé puis retiré : reconstruction, ses points ne restent pas dans le minimum', () => {
  const b1 = bloc('a', 1000, 2000, { cote: 30 }), b2 = bloc('b', 1030, 2000, { cote: 30 });
  const g = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 0.5, 0, 4096);
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(b1); m.ajouter(b2);
  m.surface(g);
  m.retirer('b');
  m.statistiques(true);
  const t = m.surface(g);
  assert.equal(m.statistiques().reconstructions, 1);
  memeSurface(t, reference([b1], g));
});

test('une grille neuve ne prend que les blocs actifs ; un bloc déjà rangé y reste', () => {
  const b1 = bloc('a', 1000, 2000, { cote: 30 }), b2 = bloc('b', 1030, 2000, { cote: 30 });
  const g = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 0.5, 0, 4096);
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(b1); m.ajouter(b2);
  memeSurface(m.surface(g, new Set(['a'])), reference([b1], g));
  const g1 = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 1, 0, 4096);   // autre pas : grille neuve
  memeSurface(m.surface(g1, new Set(['a'])), reference([b1], g1));
});

test('classes présentes dans les blocs gardés', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  const b = bloc('a', 1000, 2000, { cote: 10 });
  b.points.cls[0] = 6; b.points.cls[1] = 6; b.points.cls[2] = 1;
  m.ajouter(b);
  assert.deepEqual(m.classes().map(([c, n]) => [c, n]), [[1, 1], [2, b.points.nbPoints - 3], [6, 2]]);
  m.retirer('a');
  assert.deepEqual(m.classes(), []);
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `node --test test/raster.test.js test/vue-relief.test.js`
Expected: FAIL. Le rectangle exclu est encore rangé ; `statistiques` et `classes` n'existent pas.

- [ ] **Step 3: Implémenter**

`src/raster.js`, dans `accumuler` : `if (bloc.xc && g.geoCm) { accumulerCm(g, bloc, exclure); return; }` avec la signature `accumuler(g, bloc, exclure = null)`. Dans `accumulerCm(g, bloc, exclure = null)`, après le calcul de `cx, cy` :

```js
    if (exclure && cx >= exclure.x0 && cx < exclure.x1 && cy >= exclure.y0 && cy < exclure.y1) continue;
```

(commentaire : « un déplacement ne range que la bande entrante : la partie commune avec l'ancienne grille est déjà là, recopiée »).

`src/vue-relief.js`, dans `creer`, remplacer `surface` et `memo` par une grille gardée.

```js
    // La grille de la vue, gardée d'un calcul à l'autre : chaque bloc n'y est
    // rangé qu'une fois. Refaire tout le rangement à chaque arrivée de blocs
    // coûtait 3 à 5 s à 20 M de points (mesuré) — l'essentiel du recalcul.
    let grille = null;      // { geo, g, ranges: Set<cle>, versionReglages, t }
    let versionReglages = 0;
    let retiresRanges = false;   // un bloc rangé dans la grille a été retiré
    const stats = { reconstructions: 0, decalages: 0, ajouts: 0 };
    const classesPresentes = new Map();
```

- `ajouter` compte les classes du bloc dans `classesPresentes` (et les garde sur l'entrée : `compteClasses: Map`).
- `retirer` les décompte ; si `grille?.ranges.has(cle)`, il pose `retiresRanges = true`.
- `reglages` incrémente `versionReglages`.

Pour ce chemin (`!gpu`), `surface(geo, actifs)` s'écrit :

```js
    function surfaceCPUIncrementale(geo, actifs) {
      const r = { ...reglagesDefaut(geo.pas), ...reglagesCourants };
      const estActif = (cle) => !actifs || actifs.has(cle);
      const coupe = (b) => VUE_GRILLE.coupe(b.emprise, geo);
      const memeForme = grille && grille.geo.pasCm === geo.pasCm && grille.geo.W === geo.W && grille.geo.H === geo.H
        && grille.versionReglages === versionReglages && !retiresRanges;
      const dx = memeForme ? (geo.xminCm - grille.geo.xminCm) / geo.pasCm : 0;
      const dy = memeForme ? (geo.yminCm - grille.geo.yminCm) / geo.pasCm : 0;
      const recouvre = memeForme && Math.abs(dx) < geo.W && Math.abs(dy) < geo.H;

      // Altitude de référence : fixée à la création de la grille, gardée tant
      // qu'elle vit — les altitudes rangées y sont relatives. Un bloc plus bas
      // que la référence reste juste : `solZ` est un Float32Array, négatif permis.
      if (!recouvre) {
        const choisis = [...blocs].filter(([cle, b]) => estActif(cle) && coupe(b));
        if (!choisis.length) { grille = null; retiresRanges = false; return null; }
        const zRefCm = Math.min(...choisis.map(([, b]) => b.zminCm)) - 100;
        const g = RASTER.creerGrillesVue(geo, zRefCm, r.classesSol);
        for (const [, b] of choisis) RASTER.accumuler(g, { ...b.points, origineCm: b.origineCm });
        grille = { geo, g, ranges: new Set(choisis.map(([cle]) => cle)), versionReglages };
        retiresRanges = false;
        stats.reconstructions++;
      } else if (dx !== 0 || dy !== 0) {
        // Décalage d'un nombre entier de cases (grilles alignées sur le pas,
        // VUE_GRILLE) : la partie commune est recopiée, seuls les blocs qui
        // touchent la bande entrante y sont rangés, hors de la partie commune.
        const ancienne = grille.g;
        const g = RASTER.creerGrillesVue(geo, ancienne.geoCm.zRefCm, r.classesSol);
        for (const champ of ['solZ', 'solN', 'ncSomme', 'ncN', 'batSomme', 'batN', 'totalN', 'sommetZ', 'sommetCls']) {
          const src = ancienne[champ], dst = g[champ];
          for (let y = Math.max(0, -dy); y < Math.min(geo.H, geo.H - dy); y++) {
            const debut = Math.max(0, -dx), fin = Math.min(geo.W, geo.W - dx);
            dst.set(src.subarray((y + dy) * geo.W + debut + dx, (y + dy) * geo.W + fin + dx), y * geo.W + debut);
          }
        }
        const commune = { x0: Math.max(0, -dx), y0: Math.max(0, -dy), x1: Math.min(geo.W, geo.W - dx), y1: Math.min(geo.H, geo.H - dy) };
        const ranges = new Set();
        for (const [cle, b] of blocs) {
          if (!coupe(b)) continue;
          if (grille.ranges.has(cle)) { RASTER.accumuler(g, { ...b.points, origineCm: b.origineCm }, commune); ranges.add(cle); }
          else if (estActif(cle)) { RASTER.accumuler(g, { ...b.points, origineCm: b.origineCm }); ranges.add(cle); }
        }
        grille = { geo, g, ranges, versionReglages };
        stats.decalages++;
      }
      // Blocs actifs arrivés depuis : rangés seuls.
      for (const [cle, b] of blocs) {
        if (grille.ranges.has(cle) || !estActif(cle) || !coupe(b)) continue;
        RASTER.accumuler(grille.g, { ...b.points, origineCm: b.origineCm });
        grille.ranges.add(cle);
        stats.ajouts++;
      }
      // Terrain et surface sur une copie des tableaux de rangement : finaliser
      // ajoute mnt, solConnu, pente à la grille, qui doit rester intacte pour
      // les rangements suivants.
      const g = { ...grille.g };
      RASTER.finaliser(g, { moteur: 'cpu', passes: r.passes, rayonLissage: r.rayonLissage });
      return RELIEF.preparer(g, {
        moteur: 'cpu', pasM: geo.pas, garderRepli: true,
        inclureBati: r.inclureBati, inclureSursol: r.inclureSursol, hauteurSursolMaxM: r.hauteurSursolMaxM,
      });
    }
```

Pour `dx < 0`, la ligne d'origine est `y + dy` et la colonne `x + dx`, avec des indices dans `[0, W)` : `debut` et `fin` le garantissent. Vérifier dans le test de décalage que l'ancienne vue est décalée dans les deux sens (x et y de signes opposés : +3,3 m et −1,9 m).

`surface(geo, actifs)` garde son mémo (`cleMemo` + `actifs` absents de la clé). Le mémo est conservé tel quel quand rien n'a été rangé, réglé ou retiré. Le chemin `gpu` reste inchangé : rangement complet, sans `actifs`. Exposer `statistiques(remettre)` et `classes()` (entrées de `classesPresentes` dont le compte est positif, triées par classe).

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/raster.test.js test/vue-relief.test.js test/vue-relief-gpu.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/raster.js src/vue-relief.js test/raster.test.js test/vue-relief.test.js
git commit -m "Vue : chaque bloc rangé une fois, la bande entrante seule au déplacement"
```

---

### Task 3: La couche mémoïsée, le contraste sans recalcul

**Files:**
- Modify: `src/vue-relief.js` (`calculer`)
- Modify: `test/vue-relief.test.js`

**Interfaces:**
- Produces: `moteurVue.calculer(geo, cle, { contraste?, actifs? })`. La couche (`valeurs`, `base`, `ancrage`) est gardée tant que la surface et la clé ne changent pas. `min` et `max` sont réétirés par `RELIEF.etirer(base, ancrage, contraste)` à chaque appel. Le résultat porte `recalcul: bool`.

- [ ] **Step 1: Test**

```js
test('changer le contraste ne recalcule pas la couche', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const c1 = m.calculer(geo, 'svf', { contraste: 1 });
  const c2 = m.calculer(geo, 'svf', { contraste: 3 });
  assert.equal(c1.recalcul, true);
  assert.equal(c2.recalcul, false);
  assert.equal(c2.valeurs, c1.valeurs);
  assert.ok(c2.max - c2.min < c1.max - c1.min);
});
```

- [ ] **Step 2: Il échoue**

Run: `node --test test/vue-relief.test.js`
Expected: FAIL (`recalcul` indéfini).

- [ ] **Step 3: Implémenter**

```js
    let memoCouche = null;   // { t, cle, c }
    function calculer(geo, cle, options = {}) {
      const t0 = performance.now();
      const t = surface(geo, options.actifs);
      if (!t) return null;
      const dureeSurface = performance.now() - t0;
      const recalcul = !(memoCouche && memoCouche.t === t && memoCouche.cle === cle);
      if (recalcul) memoCouche = { t, cle, c: RELIEF.calculer(t, cle, calculCouches) };
      const c = memoCouche.c;
      const [min, max] = RELIEF.etirer(c.base, c.ancrage, options.contraste ?? 1);
      return { ...c, min, max, geo, t, recalcul, moteurSurface: gpu ? 'gpu' : 'cpu', dureeSurface, duree: performance.now() - t0 };
    }
```

`calculCouches` vaut `gpu || couchesGpu ? {} : { moteur: 'cpu' }` (voir la tâche 5 pour `couchesGpu`, à déclarer ici à `false`).

- [ ] **Step 4: Tests**

Run: `node --test test/vue-relief.test.js test/vue-relief-gpu.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/vue-relief.js test/vue-relief.test.js
git commit -m "Vue : la couche est gardée, le contraste se rejoue sans recalcul"
```

---

### Task 4: Le worker rend l'image

**Files:**
- Modify: `src/relief-travailleur.js`
- Modify: `test/relief-travailleur.test.js`

**Interfaces:**
- Consumes: `VUE_IMAGE`, et `PROJ.versLambert93` avec ses constantes et fonctions (`proj.js`).
- Produces: une nouvelle demande `{ type: 'image', id, geo, couche, ecran, lut, contraste, lisser, actifs: string[] }`.
  - Réponse : `{ type: 'image', id, blob? , rgba?, W, H, min, max, classes, recalcul, moteurSurface, dureeSurface, dureeCouche, dureeImage, duree }`.
  - Avec `OffscreenCanvas` : `blob` (PNG). Sinon : `rgba` (transféré).
  - Réponse vide : `{ type: 'image', id, vide: true, classes }`.
- `RELIEF_TRAVAILLEUR.creer(...)` et `surFilPrincipal(...)` exposent `image(geo, couche, ecran, lut, reglages) → Promise`.

- [ ] **Step 1: Tests**

Ajouter `proj.js` et `vue-image.js` à `FICHIERS` (avant `vue-grille.js` pour `proj.js`, après pour `vue-image.js`), puis :

```js
test('le worker rend l’image reprojetée, identique au calcul du fil principal', () => {
  const ctx = chargerScripts(FICHIERS);
  const w = travailleur(ctx.RELIEF_TRAVAILLEUR.source());
  w.envoyer({ type: 'demarrer' });
  const geo = ctx.VUE_GRILLE.definir({ xmin: 1000, xmax: 1040, ymin: 2000, ymax: 2040 }, 0.5, 0, 4096);
  // Un écran fictif qui couvre la grille : le calcul n'a pas besoin d'un lieu réel.
  const ecran = { x0: 0, y0: 0, W: 64, H: 48, z: 0 };
  const lut = new Uint8Array(768).map((_, i) => Math.floor(i / 3));
  w.envoyer({ type: 'ajouter', bloc: bloc('a', 1000, 2000) });
  w.envoyer({ type: 'image', id: 4, geo, couche: 'svf', ecran, lut, contraste: 1, lisser: true, actifs: ['a'] });
  const r = w.recus.at(-1);
  assert.equal(r.type, 'image', r.message);
  assert.equal(r.rgba.length, 64 * 48 * 4);
  assert.deepEqual(r.classes.map(([c]) => c), [1, 2]);

  const ref = ctx.VUE_RELIEF.creer({ moteur: 'cpu' });
  ref.ajouter(bloc('a', 1000, 2000));
  const c = ref.calculer(geo, 'svf', { contraste: 1 });
  const uv = ctx.VUE_IMAGE.cases(geo, ecran, ctx.PROJ.versLambert93);
  assert.deepEqual([...r.rgba], [...ctx.VUE_IMAGE.peindre(c.valeurs, geo, uv, c.min, c.max, lut, true)]);
});

test('proj part dans le worker : même Lambert-93 que le fil principal', () => {
  const ctx = chargerScripts(FICHIERS);
  const src = ctx.RELIEF_TRAVAILLEUR.source() + '\nself.__L = PROJ.versLambert93(5.4359, 49.2066);';
  const w = travailleur(src);
  const attendu = ctx.PROJ.versLambert93(5.4359, 49.2066);
  assert.deepEqual({ ...w.self.__L }, { ...attendu });
});
```

(`travailleur` doit renvoyer aussi `self`.)

- [ ] **Step 2: Ils échouent**

Run: `node --test test/relief-travailleur.test.js`
Expected: FAIL.

- [ ] **Step 3: Implémenter**

Dans `source()` : les constantes de `proj.js` en valeurs, `${m}`, `${t}`, `${versLambert93}`, `${versWGS84}`, `const PROJ = { versLambert93, versWGS84 };`, puis `${fabriqueVueImage}\nconst VUE_IMAGE = fabriqueVueImage();`. Les constantes s'écrivent `const A = ${A}, F = ${F}, E = ${E}, LON0 = ${LON0}, LAT0 = ${LAT0}, LAT1 = ${LAT1}, LAT2 = ${LAT2}, X0 = ${X0}, Y0 = ${Y0}, M1 = ${M1}, M2 = ${M2}, T0 = ${T0}, T1 = ${T1}, T2 = ${T2}, N = ${N}, BIGF = ${BIGF}, R0 = ${R0};`. `Number.prototype.toString` rend un double exact à l'aller-retour, ce que le test sur `PROJ` vérifie.

Dans `corpsTravailleurRelief`, le cas `image` :

```js
      } else if (m.type === 'image') {
        const t0 = performance.now();
        const r = moteur.calculer(m.geo, m.couche, { contraste: m.contraste, actifs: m.actifs ? new Set(m.actifs) : undefined });
        if (!r) { self.postMessage({ type: 'image', id: m.id, vide: true, classes: moteur.classes() }); return; }
        const t1 = performance.now();
        const uv = VUE_IMAGE.cases(m.geo, m.ecran, PROJ.versLambert93);
        const rgba = VUE_IMAGE.peindre(r.valeurs, m.geo, uv, r.min, r.max, m.lut, m.lisser);
        const infos = {
          type: 'image', id: m.id, W: m.ecran.W, H: m.ecran.H, min: r.min, max: r.max, classes: moteur.classes(),
          recalcul: r.recalcul, moteurSurface: r.moteurSurface, dureeSurface: r.dureeSurface,
          dureeCouche: t1 - t0 - r.dureeSurface, dureeImage: performance.now() - t1,
        };
        // Encodée ici quand le navigateur le permet : le fil principal n'a plus
        // qu'à poser l'image.
        if (typeof OffscreenCanvas !== 'undefined') {
          const toile = new OffscreenCanvas(m.ecran.W, m.ecran.H);
          toile.getContext('2d').putImageData(new ImageData(rgba, m.ecran.W, m.ecran.H), 0, 0);
          toile.convertToBlob({ type: 'image/png' }).then((blob) => {
            self.postMessage({ ...infos, blob, duree: performance.now() - t0 });
          }, (err) => self.postMessage({ type: 'erreur', id: m.id, message: String(err && err.message || err) }));
        } else {
          self.postMessage({ ...infos, rgba, duree: performance.now() - t0 }, [rgba.buffer]);
        }
      }
```

Côté fil principal, `image(geo, couche, ecran, lut, reglages)` poste la demande et résout sur la réponse `image` ou `erreur` de même `id`. `surFilPrincipal` fait le même calcul en direct.

- [ ] **Step 4: Tests**

Run: `node --test test/relief-travailleur.test.js test/sources.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/relief-travailleur.js test/relief-travailleur.test.js
git commit -m "Relief : le worker rend l'image reprojetée, encodée quand le navigateur le permet"
```

---

### Task 5: Le SVF sur la carte graphique, à l'essai

**Files:**
- Modify: `src/vue-relief.js`, `test/vue-relief-gpu.test.js`

**Interfaces:**
- Produces: `VUE_RELIEF.creer({ moteur: 'cpu', couches: 'gpu' })`. La surface est calculée au processeur, avec le rangement incrémental. Les couches passent par `RELIEF.calculer` **sans** `moteur: 'cpu'`, donc sur la carte graphique si elle est vérifiée. `resultat.moteurCouche` vaut `RELIEF.moteur()` après calcul.

- [ ] **Step 1: Test** (dans `test/vue-relief-gpu.test.js`, avec le faux module)

```js
test('couches sur la carte graphique, surface au processeur', () => {
  const { ctx } = monter(false);
  ctx.GPU_RELIEF.horizons = (t) => ({ svf: new Float32Array(t.N).fill(0.42), ouverturePositive: new Float32Array(t.N), ouvertureNegative: new Float32Array(t.N) });
  const m = ctx.VUE_RELIEF.creer({ moteur: 'cpu', couches: 'gpu' });
  assert.equal(m.moteur, 'cpu');
  m.ajouter(bloc('a'));
  const geo = ctx.VUE_GRILLE.definir({ xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, 0.5, 0, 4096);
  const c = m.calculer(geo, 'svf');
  assert.equal(c.moteurSurface, 'cpu');
  assert.equal(c.moteurCouche, 'gpu');
  assert.equal(c.valeurs[0], Math.fround(0.42));
});
```

- [ ] **Step 2: Il échoue** — Run: `node --test test/vue-relief-gpu.test.js` — Expected: FAIL (`moteurCouche` indéfini).

- [ ] **Step 3: Implémenter** : `const couchesGpu = options.couches === 'gpu';` dans `creer({ moteur = 'auto', couches } = {})`, puis `calculCouches` (tâche 3) et `moteurCouche: RELIEF.moteur()` dans le résultat.

- [ ] **Step 4: Tests** — Run: `node --test test/vue-relief-gpu.test.js test/vue-relief.test.js` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Vue : option des couches sur la carte graphique, surface au processeur"`

---

### Task 6: La carte pose l'image, et le flux dit ce qu'il veut

**Files:**
- Modify: `src/flux.js` (`voulues()`), `test/flux.test.js`
- Modify: `src/flux-calque.js` (`CalqueRelief`)
- Modify: `src/app.js`

**Interfaces:**
- Produces:
  - `flux.voulues() → Set<string>` : copie des clés que la vue demande.
  - `CalqueRelief`, dans `src/flux-calque.js`, reprend le rideau, le fond noir et la génération de `CalqueReliefControle`. Son `afficher({ blob|rgba, W, H }, bornes: L.LatLngBounds)` pose l'image exactement sur `bornes`.
  - Côté `app.js` : `calculerRelief` demande `relief.image(geo, couche, ecran, lut, { contraste, lisser, actifs })`. `ecran` et `bornes` sont pris sur la carte **au moment de la demande** : `map.getPixelBounds()`, `map.getZoom()`, `map.unproject(…)`.

- [ ] **Step 1: Test du flux**

Dans `test/flux.test.js`, après un `majVue` sur la grille 3 × 3 du banc (`monter()`), `flux.voulues()` contient les clés des blocs choisis. Muter la copie rendue ne change rien au flux.

```js
test('voulues() : les blocs que la vue demande, en copie', async () => {
  const { flux } = monter();
  await flux.majVue(vueCentre());
  await flux.attendreCalme();
  const v = flux.voulues();
  assert.ok(v.size > 0);
  v.clear();
  assert.ok(flux.voulues().size > 0);
});
```

(`vueCentre()` : reprendre la vue employée par les tests voisins du fichier.)

- [ ] **Step 2: Il échoue** — Run: `node --test test/flux.test.js` — Expected: FAIL (`voulues is not a function`).

- [ ] **Step 3: Implémenter**
  - `flux.js` : `voulues: () => new Set(voulues)` dans l'objet rendu.
  - `flux-calque.js` : renommer en `CalqueRelief`. `afficher(image, bornes)` fait :
    - si `image.blob` existe : `URL.createObjectURL(image.blob)` ;
    - sinon : canevas `W × H`, `putImageData`, puis `toBlob` ;
    - puis la pose sur `bornes`, avec la même garde de génération ;
    - l'ancien corps (LUT, boucle de pixels) disparaît : la peinture est dans le worker.
  - `app.js`, dans `calculerRelief`, en plus de la `geo` actuelle :

```js
    const z = carte.map.getZoom();
    const pb = carte.map.getPixelBounds();
    const ecran = { x0: pb.min.x, y0: pb.min.y, W: Math.round(pb.max.x - pb.min.x), H: Math.round(pb.max.y - pb.min.y), z };
    // Bornes de la demande, pas de la vue au retour : si la carte a bougé
    // entre-temps, l'image tombe quand même à sa place.
    const bornes = L.latLngBounds(carte.map.unproject(pb.getBottomLeft(), z), carte.map.unproject(pb.getTopRight(), z));
    const r = await relief.image(geo, coucheFlux, ecran, lutCouche(coucheFlux), { contraste, lisser: true, actifs: [...flux.voulues()] });
    if (r) reliefCalque.afficher(r, bornes);
```

  - `lutCouche(cle)` : `construireLUT(RELIEF.COUCHES.find((c) => c.cle === cle).palette)`, mémoïsée par clé.
  - `&gpusvf` : `RELIEF_TRAVAILLEUR.creer({ moteur: 'cpu', couches: 'gpu' })`. Ajouter `moteurCouche` au texte du relief.
  - Le chrono garde ses lignes ; ajouter `r.dureeImage` et `r.recalcul` au texte du statut.

- [ ] **Step 4: Tests** — Run: `npm test 2>&1 | tail -5` — Expected: `# fail 0`.

- [ ] **Step 5: Parcours**

Chromium de WSL, `index.html?flux#map=16/49.2066/5.4359`, 40 s. Faire un cliché, glisser la carte, faire un second cliché.
Expected : pas d'erreur de console nouvelle. Le chemin qui traverse le rideau reste continu de part et d'autre, y compris près des bords de l'écran (cliché).

- [ ] **Step 6: Commit** — `git commit -m "Flux : l'image du worker posée sur les bornes de la carte, blocs actifs seulement"`

---

### Task 7: Le relief devient la vue normale

**Files:**
- Modify: `src/app.js`, `src/carte.js`, `index.html`, `styles.css`

**Interfaces:**
- Produces:
  - `MODE_VUE = !params.has('dalle')`, en tête d'`app.js`. `document.body.dataset.mode = MODE_VUE ? 'vue' : 'dalle'`.
  - En mode vue :
    - le bloc qui était derrière `?flux` tourne toujours ;
    - `carte.selectionAuClic = false` : `_surClic` ne sélectionne plus rien ;
    - `ouvrirLien` et `suivreLien` ne font que cadrer la carte. Un ancien `#d=x,y` cadre au centre de la dalle, au zoom 16 ;
    - « Voir un exemple » cadre le Bois des Caures (`CONFIG.carte.dalleExemple`) au zoom 16, sans rien charger ;
    - l'aide de la barre dit « Zoomez sur une zone : le relief se calcule tout seul ».
  - Les contours des blocs ne s'affichent qu'avec `&debug`.
  - Nouvelle section `#section-vue` (`data-vue="carte"`) :
    - `#vue-couche` (sélecteur, sans ombrage, SVF par défaut) ;
    - `#vue-contraste` (0,4 à 5, pas 0,1) ;
    - `#vue-sursol` (case, cochée) ;
    - `#vue-classes-sol` (cases des classes présentes, sol et eau cochés) ;
    - `#vue-etat` (« affinage… » tant que des blocs sont attendus, sinon vide) ;
    - `#vue-aide` (aide de la couche, `RELIEF.COUCHES[].aide`).
  - Au-delà du seuil de surface : un avis centré sur la carte, `#avis-zoom` (« Zoomez pour voir le relief »), au lieu du seul statut.

- [ ] **Step 1: Test des identifiants**

`test/sources.test.js` vérifie déjà que les identifiants lus par `app.js` existent dans `index.html`. Écrire d'abord le code d'`app.js` qui les lit, puis lancer le test.

Run: `node --test test/sources.test.js`
Expected: FAIL. Le test liste les identifiants manquants : `vue-couche`, `vue-contraste`, `vue-sursol`, `vue-classes-sol`, `vue-etat`, `vue-aide`, `avis-zoom`.

- [ ] **Step 2: HTML et CSS**

Dans `index.html`, la section, juste après `</section>` de la section « Dalle » :

```html
    <!-- ─── Relief de la vue : la vue normale (sans « ?dalle ») ──────────── -->
    <section class="etape" data-vue="carte" id="section-vue">
      <h2>Relief</h2>
      <label class="champ"><span>Couche</span><select id="vue-couche"></select></label>
      <p class="note" id="vue-aide"></p>
      <label class="champ">
        <span>Contraste <b id="val-vue-contraste">×1.0</b></span>
        <input type="range" id="vue-contraste" min="0.4" max="5" step="0.1" value="1">
      </label>
      <label class="case">
        <input type="checkbox" id="vue-sursol" checked>
        <span>Compléter le sol par les retours non classés <small>(ruines et tas de pierres, sous 3 m)</small></span>
      </label>
      <div class="champ"><span>Classes du sol</span><div id="vue-classes-sol" class="classes-sol"></div></div>
      <p class="note" id="vue-etat"></p>
    </section>
```

et, dans `#vue-carte`, `<div id="avis-zoom" class="avis-zoom" hidden>Zoomez pour voir le relief</div>`.

Dans `styles.css` :

```css
/* Mode vue (par défaut) : l'ancien parcours par dalle se retire. « ?dalle »
   dans l'adresse le rend, le temps de la transition. */
body[data-mode="vue"] #bandeau-nuage,
body[data-mode="vue"] #info-dalle,
body[data-mode="vue"] #detail-dalle,
body[data-mode="vue"] #bloc-resolution,
body[data-mode="vue"] #onglet-2d,
body[data-mode="vue"] #onglet-3d,
body[data-mode="vue"] #section-analyse { display: none !important; }
body[data-mode="dalle"] #section-vue { display: none !important; }
.avis-zoom {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  z-index: 650; padding: 10px 16px; border-radius: 8px;
  background: rgba(11, 14, 19, 0.85); color: #dbe1ea; font-size: 14px; pointer-events: none;
}
```

Le titre de la section « Dalle » devient « Lieu » en mode vue (JavaScript), puisqu'il n'y reste que la recherche.

- [ ] **Step 3: app.js et carte.js**

- `carte.js` : `this.selectionAuClic = true;` dans le constructeur, et `_surClic` commence par `if (!this.selectionAuClic) return;`.
- `app.js` :
  - `MODE_VUE` en tête, à côté des autres paramètres ;
  - le bloc `?flux` devient `if (MODE_VUE) (async () => { … })();` ;
  - les contrôles Leaflet provisoires (le `<select>` sur la carte) sont remplacés par la section du panneau ;
  - `majStatut` écrit `#vue-etat` : « Affinage… N blocs attendus » tant que `e.attente`, sinon rien ; le détail chiffré reste dans le statut de la barre ;
  - `#avis-zoom` est affiché quand la surface dépasse le seuil ;
  - les classes du sol : à chaque image, `r.classes` alimente `#vue-classes-sol`, avec une case par classe présente (libellé `NOMS_CLASSES` d'`app.js`). Les cases cochées sont envoyées par `relief.reglages({ classesSol: new Set(…) })`, puis `planifierRelief(0)`. Aucun rechargement : les points sont dans le worker ;
  - `#vue-sursol` envoie `relief.reglages({ inclureSursol })` ;
  - `#vue-contraste` relance seulement l'image (couche mémoïsée) ;
  - dans `ouvrirLien`, `suivreLien` et le gestionnaire de `btn-exemple`, en mode vue, cadrer seulement :

```js
  if (MODE_VUE) {
    requestAnimationFrame(() => { carte.invalider(); carte.map.setView([lien.lat, lien.lon], lien.zoom); });
    return;
  }
```

    (pour `#d=x,y` : le centre de la dalle via `PROJ.versWGS84(x·1000 + 500, y·1000 + 500)`, zoom 16).
  - `&debug` : `new CalqueFlux()` seulement si `params.has('debug')`.

- [ ] **Step 4: Tests**

Run: `npm test 2>&1 | tail -5`
Expected: `# fail 0`.

- [ ] **Step 5: Parcours**

Chromium de WSL, `index.html` sans paramètre :
1. l'accueil s'affiche ; cliquer « Voir un exemple » ; attendre 40 s ; faire un cliché ;
2. vérifier : pas d'onglet 2D ni 3D, section « Relief » visible, relief à droite du rideau, aucune requête `LHD_…` en entier (pas de `Range` absent sur les `.copc.laz`) ;
3. puis `index.html#d=877,6904`, et `index.html?dalle` qui doit rendre l'ancienne interface.

Expected : les trois conformes, aucune erreur de console nouvelle.

- [ ] **Step 6: Commit** — `git commit -m "Le relief de la vue devient la vue normale ; l'ancienne interface par dalle derrière ?dalle"`

---

### Task 8: Le rideau, vérifié

**Files:**
- Modify: `src/flux-calque.js`, `styles.css` (selon ce que la vérification trouve)

- [ ] **Step 1: Vérifier**

Parcours Playwright dans le Chromium de WSL, vue normale à Verdun :
- (a) tirer le rideau à 25 % puis à 80 % : la carte ne bouge pas (`getCenter()` inchangé) et la découpe suit (`clip-path` du volet) ;
- (b) glisser la carte : la découpe reste à la même position à l'écran ;
- (c) zoomer d'un cran : l'image suit l'animation, puis la découpe se recale ;
- (d) dans un iframe de 380 px de large, avec le tiroir fermé, tirer au doigt (`page.touchscreen`, ou des évènements pointer de type `touch`) : le rideau bouge et la carte non ;
- (e) libellés : « Carte » à gauche, le nom de la couche à droite, mis à jour quand la couche change.

Expected : les cinq conformes. Chaque écart trouvé devient un correctif, avec un cliché avant et après, et une ligne `Ruling:` au registre si le correctif s'écarte du plan.

- [ ] **Step 2: Commit** — `git commit -m "Rideau de la vue : vérifié au glisser, au zoom et au doigt"` (seulement s'il y a eu des correctifs).

---

### Task 9: Documenter

**Files:**
- Modify: `CLAUDE.md`, `TODO.md`

- [ ] **Step 1: Écrire**

Dans `CLAUDE.md` :
- « Le calcul de la vue » : ajouter
  - l'image reprojetée dans le worker, et pourquoi (placement exact, fil principal libre) ;
  - le rangement incrémental et ses trois cas ;
  - le mémo de couche ;
  - l'essai `&gpusvf` et son verdict, à remplir d'après le retour de l'utilisateur.
- « La page d'accueil », « Le lien partageable », « Trois onglets » : décrire le mode vue (accueil qui cadre, lien qui cadre, plus de sélection de dalle, 2D et 3D masquées), et `?dalle`.
- Tableau « État » : une ligne « Relief de la vue, vue normale », mise à jour.

Dans `TODO.md`, rien de nouveau hors du plan, sauf ce que les tâches auraient révélé.

- [ ] **Step 2: Commit** — `git commit -m "CLAUDE.md : le relief de la vue, vue normale"`

---

## Hors de ce plan (déjà dans TODO.md)

- #3 Mesure et pointé sur le relief de la vue.
- #4 Le retour de la 3D.
- #5 Un relief de secours rapide, clairement signalé.
