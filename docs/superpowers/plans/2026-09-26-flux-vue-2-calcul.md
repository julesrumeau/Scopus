# Relief piloté par la vue — plan 2 : le calcul

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculer le relief de la vue affichée à partir des points que le plan 1 livre — grille de la vue, rangement des points, terrain, surface affichée, couches — sur la carte graphique quand elle est vérifiée, sur le processeur sinon ; et, au-delà du seuil de surface, depuis le MNT de l'IGN en WMS. Le livrable visible : derrière `?flux`, un calque de contrôle qui dessine la couche choisie sur la carte.

**Architecture:** `VUE_GRILLE` (pur) fixe la grille de la vue en centimètres entiers, alignée sur un multiple du pas. `RASTER` apprend à ranger des points en centimètres entiers dans cette grille (la référence exacte). `VUE_RELIEF` garde les blocs reçus, construit la surface de la vue — par `GPU_RELIEF.surfaceVue` (accumulation par tampon de profondeur, terrain et surface sur la carte, un seul rapatriement) ou par le processeur — puis passe la surface à `RELIEF.calculer`, inchangé. Un autocontrôle compare les deux chemins sur des points d'essai avant d'employer la carte graphique. `MNT_IGN` lit le MNT en WMS pour les vues trop larges.

**Tech Stack:** JavaScript en scripts classiques, WebGL2 (textures de profondeur `DEPTH_COMPONENT32F`, `RGBA8` et `RGBA16F` additifs, attributs entiers), Leaflet, tests `node --test` (`test/charger.js`), vérification sur vraie carte graphique dans le Chrome de Windows.

**Spec:** `docs/superpowers/specs/2026-09-26-flux-vue-design.md` (section « 2. Le calcul »).

## Global Constraints

- Ouverture en `file://` : scripts classiques exposant un global, **aucun `import`**, aucun CDN, aucune étape de construction ; tout nouveau fichier de `src/` est chargé par `index.html` (`test/sources.test.js`).
- **Pas de backtick dans un commentaire GLSL** (`shaders.js`) : il termine la chaîne ; `test/sources.test.js` le vérifie.
- `relief.js` et `raster.js` restent la **référence** ; rien ne sort de la carte graphique sans autocontrôle préalable contre eux.
- Appels de dessin découpés (≤ 1 M de points, bandes de 256 lignes) : un appel trop long fait réinitialiser la carte par Windows, tout relisant zéro sans erreur.
- Aucune dépendance à `EXT_float_blend` (absente sur ~51 % des iPhone) : minimum et maximum par tampon de profondeur, comptes en `RGBA8` additif, sommes en `RGBA16F` additif sur des hauteurs relatives.
- Coordonnées des blocs : `xc`, `yc` en centimètres entiers relatifs au coin sud-ouest de la dalle (`origineCm[0..1]`), `zc` en centimètres absolus (`origineCm[2] = 0`), `cls` classe ASPRS.
- Réglages en mètres, convertis selon le pas : `comblementM: 3` (= 12 passes à 25 cm), `lissageM: 0.5` (= 2 cellules à 25 cm).
- Commentaires et messages en français, qui expliquent **pourquoi**, mesures à l'appui.
- Ne jamais chronométrer dans le harnais `vm` des tests (7× plus lent) ; mesurer dans le vrai Chrome de Windows, sur la vraie carte graphique, avec un profil dédié tué **par son profil** seulement.

## Review Focus

- **Point pile sur une limite de case** : il doit tomber dans la même case sur la carte graphique et au processeur (centimètres entiers, division entière) — tests tâches 1 et 2, autocontrôle tâche 5.
- **Blocs de dalles différentes, altitudes très différentes** (vue à cheval sur une vallée de 1 000 m) : la normalisation de profondeur doit couvrir toute l'étendue, sans écrêter — autocontrôle tâche 5 (deux dalles à 600 m d'écart).
- **Cellule sans point sol mais avec non classé** : la surface prend le non classé sous `hauteurSursolMaxM`, jamais au-dessus — test tâche 3 et autocontrôle tâche 5.
- **Vue sans aucun bloc** (arrivée, ou zone sans LiDAR) : pas de calcul, pas d'erreur, calque vidé — test tâche 4.
- **Carte graphique refusée ou perdue** : le processeur calcule, avec un budget de points réduit et un message qui le dit — tâche 6.

---

## Fichiers

- Modifier `src/config.js` — `CONFIG.flux` : `comblementM`, `lissageM`, `coteMaxGrille`, `budgetPointsProcesseur`, `pixelsMaxMnt`.
- Créer `src/vue-grille.js` — `VUE_GRILLE`, géométrie de la grille de la vue (pur).
- Modifier `src/raster.js` — `creerGrillesVue`, rangement en centimètres entiers, `finaliser` réglable en passes et rayon.
- Modifier `src/relief.js` — `preparer` avec `garderRepli`.
- Créer `src/vue-relief.js` — `VUE_RELIEF`, blocs et surface de la vue, choix du moteur, autocontrôle.
- Modifier `src/shaders.js` — `accuVS`, `accuFS`, `solPrepFS`, `surfaceFS`.
- Modifier `src/gpu-relief.js` — blocs sur la carte, `surfaceVue`, `terrainTex`.
- Créer `src/mnt-ign.js` — `MNT_IGN`, MNT en WMS.
- Modifier `src/flux-calque.js` — `CalqueReliefControle`.
- Modifier `src/app.js` — branchement derrière `?flux`.
- Modifier `index.html` — `vue-grille.js`, `vue-relief.js`, `mnt-ign.js`.
- Créer `test/vue-grille.test.js`, `test/preparer-vue.test.js`, `test/vue-relief.test.js`, `test/vue-relief-gpu.test.js`, `test/mnt-ign.test.js` ; modifier `test/raster.test.js`.
- Modifier `CLAUDE.md` — section « Le calcul de la vue ».

---

### Task 1: La grille de la vue

**Files:**
- Modify: `src/config.js` (section `flux`)
- Create: `src/vue-grille.js`, `test/vue-grille.test.js`
- Modify: `index.html` (après `flux-choix.js`)

**Interfaces:**
- Produces:
  - `VUE_GRILLE.definir(vue:{xmin,xmax,ymin,ymax}, pasM:number, margeM:number, coteMax:number) → geo` avec `geo = { xminCm, yminCm, pasCm, W, H, pas, emprise:{xmin,xmax,ymin,ymax} }` ; `xminCm`, `yminCm` multiples de `pasCm` ; `W, H ≤ coteMax` (le pas est relevé sinon).
  - `VUE_GRILLE.passes(metres, pasM) → entier ≥ 1` ; `VUE_GRILLE.rayon(metres, pasM) → entier ≥ 0`.
  - `VUE_GRILLE.marge(p) → mètres` = `max(p.svfRayonM, 3·p.rayonMicroReliefM) + p.comblementM + p.lissageM`.
  - `VUE_GRILLE.coupe(emprise, geo) → bool`.
  - `CONFIG.flux.comblementM = 3`, `lissageM = 0.5`, `coteMaxGrille = 4096`, `budgetPointsProcesseur = 5_000_000`, `pixelsMaxMnt = 5010`.

- [ ] **Step 1: Écrire le test**

`test/vue-grille.test.js` :

```js
// Géométrie de la grille de la vue : alignement, marge, plafond, conversions
// des réglages en mètres. Fonctions pures.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { VUE_GRILLE, CONFIG } = chargerScripts(['config.js', 'vue-grille.js']);

test('la grille couvre la vue plus la marge, alignée sur le pas', () => {
  const g = VUE_GRILLE.definir({ xmin: 877123.4, xmax: 877623.4, ymin: 6903010, ymax: 6903310 }, 0.5, 40, 4096);
  assert.equal(g.pasCm, 50);
  assert.equal(g.xminCm % 50, 0);
  assert.equal(g.yminCm % 50, 0);
  assert.ok(g.emprise.xmin <= 877123.4 - 40 && g.emprise.xmin > 877123.4 - 40 - 0.5);
  assert.ok(g.emprise.xmax >= 877623.4 + 40 && g.emprise.xmax < 877623.4 + 40 + 0.5);
  assert.equal(g.emprise.xmax, (g.xminCm + g.W * g.pasCm) / 100);
  assert.equal(g.pas, 0.5);
});

test('au-delà du plafond, le pas est relevé', () => {
  const g = VUE_GRILLE.definir({ xmin: 0, xmax: 10000, ymin: 0, ymax: 5000 }, 0.5, 0, 4096);
  assert.ok(g.W <= 4096 && g.H <= 4096);
  assert.ok(g.pasCm > 50);
  assert.ok(g.emprise.xmax >= 10000);
});

test('un pas en centimètres entiers, jamais nul', () => {
  assert.equal(VUE_GRILLE.definir({ xmin: 0, xmax: 1, ymin: 0, ymax: 1 }, 0.004, 0, 4096).pasCm, 1);
  assert.equal(VUE_GRILLE.definir({ xmin: 0, xmax: 100, ymin: 0, ymax: 100 }, 1.234, 0, 4096).pasCm, 123);
});

test('réglages en mètres convertis selon le pas', () => {
  assert.equal(VUE_GRILLE.passes(3, 0.25), 12);
  assert.equal(VUE_GRILLE.passes(3, 0.5), 6);
  assert.equal(VUE_GRILLE.passes(3, 20), 1);
  assert.equal(VUE_GRILLE.rayon(0.5, 0.25), 2);
  assert.equal(VUE_GRILLE.rayon(0.5, 5), 0);
});

test('la marge couvre la plus grande portée des couches et du terrain', () => {
  const p = { ...CONFIG.relief, ...CONFIG.flux };
  assert.equal(VUE_GRILLE.marge(p), Math.max(p.svfRayonM, 3 * p.rayonMicroReliefM) + p.comblementM + p.lissageM);
});

test('coupe : une emprise touche-t-elle la grille', () => {
  const g = VUE_GRILLE.definir({ xmin: 1000, xmax: 2000, ymin: 1000, ymax: 2000 }, 1, 0, 4096);
  assert.equal(VUE_GRILLE.coupe({ xmin: 1500, xmax: 2500, ymin: 0, ymax: 1200 }, g), true);
  assert.equal(VUE_GRILLE.coupe({ xmin: 2000, xmax: 3000, ymin: 0, ymax: 1200 }, g), false);
});
```

- [ ] **Step 2: Le lancer, il échoue**

Run: `node --test test/vue-grille.test.js`
Expected: FAIL — `VUE_GRILLE` indéfini (le fichier n'existe pas).

- [ ] **Step 3: Configuration**

Dans `src/config.js`, section `flux`, après `pointsParCase` :

```js
    // Réglages du terrain exprimés en mètres, pour garder leur sens quel que
    // soit le pas de la grille de la vue : 3 m de comblement et 50 cm de
    // lissage valent les 12 passes et 2 cellules de la grille de 25 cm.
    comblementM: 3,
    lissageM: 0.5,
    // Côté maximal de la grille de la vue, en cases. Au-delà, le pas est
    // relevé : 4096 tient dans toute carte graphique WebGL2 et reste sous le
    // plafond de cellules du processeur.
    coteMaxGrille: 4096,
    // Points gardés quand la carte graphique est refusée : le calcul de la vue
    // se fait alors au processeur à chaque recalcul, 3,9 s pour 15 M mesurés.
    budgetPointsProcesseur: 5_000_000,
    // Côté maximal d'une image du MNT demandée au WMS de l'IGN.
    pixelsMaxMnt: 5010,
```

- [ ] **Step 4: Écrire le module**

`src/vue-grille.js` :

```js
// Géométrie de la grille de la vue.
//
// Le relief de la vue se calcule dans une grille Lambert-93 alignée sur les
// axes, qui couvre la vue plus une marge : le Sky-View Factor d'une case du
// bord regarde à `svfRayonM` autour d'elle, le micro-relief à trois rayons.
//
// Tout est en **centimètres entiers** : le coin de la grille est un multiple
// du pas, et les points arrivent en centimètres entiers (decodeur.js). La case
// d'un point est alors une division entière, identique au processeur et sur la
// carte graphique — en flottants, 0,03 % des cases différaient (mesuré), les
// points pile sur une limite tombant d'un côté ou de l'autre selon l'arrondi.
// L'alignement sur un multiple du pas garde aussi les mêmes cases d'une vue à
// l'autre au même zoom : un déplacement décale la grille d'un nombre entier de
// cases.

const VUE_GRILLE = (() => {
  function definir(vue, pasM, margeM, coteMax) {
    let pasCm = Math.max(1, Math.round(pasM * 100));
    for (;;) {
      const xminCm = Math.floor(((vue.xmin - margeM) * 100) / pasCm) * pasCm;
      const yminCm = Math.floor(((vue.ymin - margeM) * 100) / pasCm) * pasCm;
      const W = Math.max(1, Math.ceil(((vue.xmax + margeM) * 100 - xminCm) / pasCm));
      const H = Math.max(1, Math.ceil(((vue.ymax + margeM) * 100 - yminCm) / pasCm));
      if (W <= coteMax && H <= coteMax) {
        return {
          xminCm, yminCm, pasCm, W, H, pas: pasCm / 100,
          emprise: { xmin: xminCm / 100, ymin: yminCm / 100, xmax: (xminCm + W * pasCm) / 100, ymax: (yminCm + H * pasCm) / 100 },
        };
      }
      pasCm = Math.ceil((pasCm * Math.max(W, H)) / coteMax);
    }
  }

  /** Passes de comblement pour une distance en mètres : au moins une. */
  function passes(metres, pasM) {
    return Math.max(1, Math.round(metres / pasM));
  }

  /** Rayon en cases d'une distance en mètres : zéro sous un demi-pas. */
  function rayon(metres, pasM) {
    return Math.max(0, Math.round(metres / pasM));
  }

  /**
   * Marge autour de la vue, en mètres : la plus grande portée des couches
   * (SVF, micro-relief à trois rayons), plus celles du comblement et du
   * lissage du terrain, qui les précèdent.
   */
  function marge(p) {
    return Math.max(p.svfRayonM, 3 * p.rayonMicroReliefM) + p.comblementM + p.lissageM;
  }

  function coupe(e, geo) {
    const g = geo.emprise;
    return e.xmin < g.xmax && e.xmax > g.xmin && e.ymin < g.ymax && e.ymax > g.ymin;
  }

  return { definir, passes, rayon, marge, coupe };
})();
```

Dans `index.html`, après `<script src="src/flux-choix.js"></script>` :

```html
<script src="src/vue-grille.js"></script>
```

- [ ] **Step 5: Lancer les tests**

Run: `node --test test/vue-grille.test.js test/sources.test.js`
Expected: PASS, tous.

- [ ] **Step 6: Commit**

```bash
git add src/config.js src/vue-grille.js test/vue-grille.test.js index.html
git commit -m "Vue : géométrie de la grille en centimètres entiers, réglages en mètres"
```

---

### Task 2: Ranger des points en centimètres entiers dans RASTER

**Files:**
- Modify: `src/raster.js`
- Modify: `test/raster.test.js`

**Interfaces:**
- Consumes: `geo` de `VUE_GRILLE.definir`.
- Produces:
  - `RASTER.creerGrillesVue(geo, zRefCm:int, classesSol?:Set|number[]) → g` : mêmes tableaux que `creerGrilles`, plus `g.geoCm = { xminCm, yminCm, pasCm, zRefCm }`, `origine = [geo.emprise.xmin, geo.emprise.ymin, zRefCm / 100]`.
  - `RASTER.accumuler(g, bloc)` : si `bloc.xc` et `g.geoCm`, rangement exact en centimètres : case `floor((xc + origineCm[0] − xminCm) / pasCm)`, altitude `(zc + origineCm[2] − zRefCm) / 100` m ; sinon inchangé.
  - `RASTER.finaliser(g, { passes?, rayonLissage?, moteur? })` : passes de comblement et rayon de lissage réglables (défaut `CONFIG.raster.rayonComblementSol`, `rayonLissageSol`).

- [ ] **Step 1: Écrire les tests**

Dans `test/raster.test.js`, remplacer la ligne 15 par `const { RASTER, VUE_GRILLE } = chargerScripts(['config.js', 'vue-grille.js', 'raster.js']);`, puis ajouter à la fin :

```js
test('centimètres entiers : un point pile sur une limite de case tombe dans la case suivante', () => {
  const geo = VUE_GRILLE.definir({ xmin: 1000, xmax: 1002, ymin: 2000, ymax: 2002 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 10000, [2]);
  // Dalle au coin (1000 m, 2000 m) ; points à 50 cm, 99 cm, 100 cm du coin.
  RASTER.accumuler(g, {
    nbPoints: 3, origineCm: [100000, 200000, 0],
    xc: Int32Array.from([50, 99, 100]), yc: Int32Array.from([0, 0, 0]),
    zc: Int32Array.from([10123, 10200, 10300]), cls: Uint8Array.from([2, 2, 2]),
  });
  assert.equal(g.solN[1], 2);   // 50 et 99 cm : case 1
  assert.equal(g.solN[2], 1);   // 100 cm : case 2
  assert.ok(Math.abs(g.solZ[1] - 1.23) < 1e-6);   // minimum, relatif à 100 m
  assert.deepEqual([g.geoCm.xminCm, g.geoCm.pasCm, g.geoCm.zRefCm], [100000, 50, 10000]);
});

test('centimètres entiers : hors de la grille, ignoré', () => {
  const geo = VUE_GRILLE.definir({ xmin: 1000, xmax: 1001, ymin: 2000, ymax: 2001 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 0, [2]);
  RASTER.accumuler(g, {
    nbPoints: 2, origineCm: [99900, 200000, 0],
    xc: Int32Array.from([50, 250]), yc: Int32Array.from([10, 10]), zc: Int32Array.from([100, 100]), cls: Uint8Array.from([2, 2]),
  });
  assert.equal(g.solN.reduce((s, v) => s + v, 0), 0);   // 99950 cm et 100150 cm : hors de [100000, 100100[
});

test('centimètres entiers : mêmes classes que le chemin flottant', () => {
  const geo = VUE_GRILLE.definir({ xmin: 0, xmax: 4, ymin: 0, ymax: 4 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 0, [2, 9]);
  RASTER.accumuler(g, {
    nbPoints: 4, origineCm: [0, 0, 0],
    xc: Int32Array.from([10, 10, 10, 10]), yc: Int32Array.from([10, 10, 10, 10]),
    zc: Int32Array.from([100, 150, 300, 500]), cls: Uint8Array.from([9, 1, 6, 5]),
  });
  assert.equal(g.solN[0], 1);
  assert.equal(g.ncN[0], 1);
  assert.equal(g.batN[0], 1);
  assert.equal(g.totalN[0], 4);
  assert.ok(Math.abs(g.sommetZ[0] - 5) < 1e-6);
  assert.equal(g.sommetCls[0], 5);
});

test('finaliser : passes et rayon réglables', () => {
  const geo = VUE_GRILLE.definir({ xmin: 0, xmax: 10, ymin: 0, ymax: 1 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 0, [2]);
  RASTER.accumuler(g, { nbPoints: 1, origineCm: [0, 0, 0], xc: Int32Array.from([10]), yc: Int32Array.from([10]), zc: Int32Array.from([100]), cls: Uint8Array.from([2]) });
  RASTER.finaliser(g, { moteur: 'cpu', passes: 3, rayonLissage: 0 });
  // Une passe gagne une case : trois passes atteignent la case 3, pas la 4.
  assert.equal(g.solConnu[3], 1);
  assert.equal(g.solConnu[4], 0);
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `node --test test/raster.test.js`
Expected: FAIL — `RASTER.creerGrillesVue is not a function`.

- [ ] **Step 3: Implémenter**

Dans `src/raster.js` :

1. Extraire l'allocation des tableaux de `creerGrilles` dans une fonction `tableaux(N)` qui rend `{ solZ, solN, ncSomme, ncN, batSomme, batN, totalN, sommetZ, sommetCls }` (mêmes types et remplissages qu'aujourd'hui, commentaires déplacés avec eux), et la réutiliser :

```js
  return {
    W, H, pas, emprise, origine,
    classesSol: classesSol instanceof Set ? classesSol : new Set(classesSol),
    ...tableaux(N),
  };
```

2. Ajouter après `creerGrilles` :

```js
/**
 * Grilles de la vue (flux.js, vue-relief.js) : même contenu, géométrie en
 * centimètres entiers donnée par VUE_GRILLE. Les altitudes sont relatives à
 * `zRefCm`, pour rester fines en Float32.
 */
function creerGrillesVue(geo, zRefCm, classesSol = CONFIG.raster.classesSolDefaut) {
  return {
    W: geo.W, H: geo.H, pas: geo.pas, emprise: geo.emprise,
    origine: [geo.emprise.xmin, geo.emprise.ymin, zRefCm / 100],
    geoCm: { xminCm: geo.xminCm, yminCm: geo.yminCm, pasCm: geo.pasCm, zRefCm },
    classesSol: classesSol instanceof Set ? classesSol : new Set(classesSol),
    ...tableaux(geo.W * geo.H),
  };
}
```

3. Extraire le corps de la boucle d'`accumuler` (depuis `if (g.totalN[c] < 255)` jusqu'à la fin du `else if` bâtiment, commentaires compris) dans :

```js
/** Verse un point dans la case `c`. */
function verser(g, c, z, cls) {
  if (g.totalN[c] < 255) g.totalN[c]++;
  if (z > g.sommetZ[c]) { g.sommetZ[c] = z; g.sommetCls[c] = cls; }
  // … (le reste du corps actuel, inchangé, avec `cls` au lieu de `bloc.cls[i]`)
}
```

et réécrire `accumuler` :

```js
function accumuler(g, bloc) {
  if (bloc.xc && g.geoCm) { accumulerCm(g, bloc); return; }
  const { W, H } = g;
  const dx = (bloc.origine ? bloc.origine[0] : g.origine[0]) - g.origine[0];
  const dy = (bloc.origine ? bloc.origine[1] : g.origine[1]) - g.origine[1];
  const x0 = g.emprise.xmin - g.origine[0];
  const y0 = g.emprise.ymin - g.origine[1];
  const inv = 1 / g.pas;

  for (let i = 0; i < bloc.nbPoints; i++) {
    const cx = ((bloc.x[i] + dx - x0) * inv) | 0;
    const cy = ((bloc.y[i] + dy - y0) * inv) | 0;
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
    verser(g, cy * W + cx, bloc.z[i], bloc.cls[i]);
  }
}

/**
 * Rangement exact en centimètres entiers : la case est une division entière,
 * celle que fait la carte graphique (gpu-relief.js). Un point pile sur une
 * limite tombe dans la case suivante, des deux côtés.
 */
function accumulerCm(g, bloc) {
  const { W, H } = g;
  const { xminCm, yminCm, pasCm, zRefCm } = g.geoCm;
  const ox = bloc.origineCm[0] - xminCm, oy = bloc.origineCm[1] - yminCm, oz = bloc.origineCm[2] - zRefCm;
  for (let i = 0; i < bloc.nbPoints; i++) {
    const x = bloc.xc[i] + ox, y = bloc.yc[i] + oy;
    if (x < 0 || y < 0) continue;
    const cx = Math.floor(x / pasCm), cy = Math.floor(y / pasCm);
    if (cx >= W || cy >= H) continue;
    verser(g, cy * W + cx, (bloc.zc[i] + oz) / 100, bloc.cls[i]);
  }
}
```

4. `finaliser` et `modeleTerrain` prennent les passes et le rayon :

```js
function finaliser(g, options = {}) {
  const p = { ...CONFIG.relief, ...options };
  const passes = options.passes ?? CONFIG.raster.rayonComblementSol;
  const rayon = options.rayonLissage ?? CONFIG.raster.rayonLissageSol;
  if (p.moteur !== 'cpu' && p.gpu !== false && typeof GPU_RELIEF !== 'undefined') {
    const r = GPU_RELIEF.terrain(g, passes, rayon);
    if (r) { g.mnt = r.mnt; g.solConnu = r.solConnu; g.pente = r.pente; return g; }
  }
  g.mnt = modeleTerrain(g, passes, rayon);
  g.pente = pente(g.mnt, g.W, g.H, g.pas);
  return g;
}
```

(commentaire d'en-tête de `finaliser` conservé), et dans `modeleTerrain(g, passes = CONFIG.raster.rayonComblementSol, rayon = CONFIG.raster.rayonLissageSol)`, remplacer `CONFIG.raster.rayonComblementSol` par `passes` dans la boucle et `CONFIG.raster.rayonLissageSol` par `rayon` dans l'appel à `flouBoite`.

5. Exporter : `const RASTER = { CLASSE, creerGrilles, creerGrillesVue, accumuler, finaliser, rasteriser, signal, hauteurParPoint, centreCellule };`

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/raster.test.js > /tmp/claude-1000/-home-linux-workspace-Scopus/5fd3bcff-ca02-49ce-8186-c077503b119d/scratchpad/t2.log 2>&1; tail -5 $_`
Expected: PASS, tous (les tests existants inchangés).

- [ ] **Step 5: Suite complète**

Run: `npm test 2>&1 | tail -5`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/raster.js test/raster.test.js
git commit -m "Raster : rangement en centimètres entiers dans la grille de la vue, terrain réglable"
```

---

### Task 3: La surface au pas de la grille garde le repli du terrain

**Files:**
- Modify: `src/relief.js` (`preparer`)
- Create: `test/preparer-vue.test.js` (`test/relief.test.js` a son propre chargeur `vm` ; celui-ci passe par `test/charger.js`)

**Interfaces:**
- Produces: `RELIEF.preparer(g, { garderRepli: true, pasM: g.pas })` — les cellules sans sol connu gardent l'altitude du terrain (`g.mnt`, repli médian lissé) au lieu de la moyenne des cellules valides. C'est ce que la carte graphique produit naturellement (tâche 5) ; la parité l'exige.

- [ ] **Step 1: Écrire le test**

`test/preparer-vue.test.js` :

```js
// RELIEF.preparer au pas même de la grille de la vue : la surface doit être
// celle que rend la carte graphique (vue-relief.js), repli compris.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { RELIEF, RASTER, VUE_GRILLE } = chargerScripts(['config.js', 'vue-grille.js', 'raster.js', 'relief.js']);

test('preparer, garderRepli : une cellule sans sol garde l’altitude du terrain', () => {
  const geo = VUE_GRILLE.definir({ xmin: 0, xmax: 20, ymin: 0, ymax: 1 }, 0.5, 0, 4096);
  const g = RASTER.creerGrillesVue(geo, 0, [2]);
  for (let x = 0; x < 10; x++) {
    RASTER.accumuler(g, { nbPoints: 1, origineCm: [0, 0, 0], xc: Int32Array.from([x * 50 + 10]), yc: Int32Array.from([10]), zc: Int32Array.from([100 + x * 10]), cls: Uint8Array.from([2]) });
  }
  RASTER.finaliser(g, { moteur: 'cpu', passes: 1, rayonLissage: 0 });
  const i = 30;   // loin de tout point sol : jamais atteinte par une passe
  assert.equal(g.solConnu[i], 0);
  const t = RELIEF.preparer(g, { moteur: 'cpu', pasM: g.pas, garderRepli: true });
  assert.equal(t.valide[i], 0);
  assert.equal(t.mnt[i], g.mnt[i]);
  const sans = RELIEF.preparer(g, { moteur: 'cpu', pasM: g.pas });
  assert.notEqual(sans.mnt[i], g.mnt[i]);   // la moyenne des valides, comme avant
});
```

- [ ] **Step 2: Le lancer, il échoue**

Run: `node --test test/preparer-vue.test.js`
Expected: FAIL sur `assert.equal(t.mnt[i], g.mnt[i])`.

- [ ] **Step 3: Implémenter**

Dans `preparer`, remplacer la boucle de repli finale :

```js
  // Les cellules sans sol connu reçoivent la médiane approchée du reste : les
  // gradients et les flous ont besoin d'un nombre, la carte de validité dira
  // qu'il ne faut pas y croire.
  //
  // `garderRepli`, au pas même de la grille (f = 1) : elles gardent l'altitude
  // que le terrain leur a déjà donnée — la médiane de repli, lissée. C'est ce
  // que la carte graphique produit sans rien calculer de plus (vue-relief.js),
  // et les deux chemins doivent rendre la même surface.
  if (p.garderRepli && f === 1) {
    for (let i = 0; i < N; i++) if (!valide[i]) { mnt[i] = g.mnt[i]; analyse[i] = g.mnt[i]; }
  } else {
    let somme = 0, nb = 0;
    for (let i = 0; i < N; i++) if (valide[i]) { somme += mnt[i]; nb++; }
    const repli = nb ? somme / nb : 0;
    for (let i = 0; i < N; i++) if (!valide[i]) { mnt[i] = repli; analyse[i] = repli; }
  }
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/preparer-vue.test.js test/relief.test.js 2>&1 | tail -5`
Expected: PASS, tous.

- [ ] **Step 5: Commit**

```bash
git add src/relief.js test/preparer-vue.test.js
git commit -m "Relief : preparer garde le repli du terrain au pas de la grille (garderRepli)"
```

---

### Task 4: VUE_RELIEF sur le processeur

**Files:**
- Create: `src/vue-relief.js`, `test/vue-relief.test.js`
- Modify: `index.html` (après `gpu-relief.js`)

**Interfaces:**
- Consumes: `VUE_GRILLE`, `RASTER.creerGrillesVue`, `RASTER.accumuler`, `RASTER.finaliser`, `RELIEF.preparer`, `RELIEF.calculer` ; blocs de `FLUX` : `{ cle, emprise, origineCm, points:{ nbPoints, xc, yc, zc, cls } }`.
- Produces:
  - `VUE_RELIEF.creer({ moteur?: 'auto'|'cpu' }) → moteurVue` avec :
    - `ajouter(bloc)`, `retirer(cle)`, `taille() → nombre de blocs` ;
    - `reglages(r)` — fusionne `{ classesSol, inclureBati, inclureSursol, hauteurSursolMaxM }` ;
    - `surface(geo) → ?t` — `{ W, H, N, pas, mnt, valide, hauteur, trou, emprise, origine }`, `null` sans bloc ; mémoïsée tant que ni `geo`, ni les blocs, ni les réglages ne changent ;
    - `calculer(geo, cle) → ?{ cle, valeurs, min, max, palette, geo, t, moteurSurface: 'gpu'|'cpu', dureeSurface, duree }` ;
    - `moteur: 'gpu'|'cpu'`, `coteMax: number`.
  - `VUE_RELIEF.surfaceCPU(geo, blocs: Array<{origineCm, nbPoints, xc, yc, zc, cls}>, zRefCm, r) → t` — la référence.
  - `VUE_RELIEF.reglagesDefaut(pasM) → r` = `{ classesSol, inclureBati, inclureSursol, hauteurSursolMaxM, passes, rayonLissage }`.

- [ ] **Step 1: Écrire les tests**

`test/vue-relief.test.js` :

```js
// Relief de la vue au processeur : blocs reçus → grille → terrain → surface →
// couche. Le chemin de la carte graphique (gpu-relief.js) est comparé à
// celui-ci par l'autocontrôle, dans le navigateur.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { VUE_RELIEF, VUE_GRILLE, RASTER, RELIEF, CONFIG } = chargerScripts(
  ['config.js', 'vue-grille.js', 'raster.js', 'relief.js', 'vue-relief.js']);

/** Bloc d'une dalle au coin (x0, y0) en mètres : un plan à 300 m, une bosse, des points tous les 25 cm. */
function bloc(cle, x0, y0, { cote = 60, pasCm = 25, zBase = 30000 } = {}) {
  const n = (cote * 100 / pasCm) ** 2;
  const xc = new Int32Array(n), yc = new Int32Array(n), zc = new Int32Array(n), cls = new Uint8Array(n);
  let k = 0;
  for (let y = 0; y < cote * 100; y += pasCm) {
    for (let x = 0; x < cote * 100; x += pasCm) {
      const bosse = 80 * Math.exp(-(((x - 3000) ** 2 + (y - 3000) ** 2) / 2e5));
      xc[k] = x; yc[k] = y; zc[k] = zBase + Math.round(x * 0.05 + bosse); cls[k] = 2; k++;
    }
  }
  return { cle, emprise: { xmin: x0, ymin: y0, xmax: x0 + cote, ymax: y0 + cote }, origineCm: [x0 * 100, y0 * 100, 0], points: { nbPoints: n, xc, yc, zc, cls } };
}

const vue = { xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2060 };
const geo = VUE_GRILLE.definir(vue, 0.5, 0, 4096);

test('sans bloc, rien à calculer', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  assert.equal(m.surface(geo), null);
  assert.equal(m.calculer(geo, 'ombrage'), null);
});

test('la surface de la vue est celle de la chaîne de référence', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  const b = bloc('a', 1000, 2000);
  m.ajouter(b);
  const t = m.surface(geo);
  assert.equal(t.W, geo.W);
  assert.equal(t.H, geo.H);

  const r = VUE_RELIEF.reglagesDefaut(geo.pas);
  const g = RASTER.creerGrillesVue(geo, 30000 - 100, r.classesSol);
  RASTER.accumuler(g, { ...b.points, origineCm: b.origineCm });
  RASTER.finaliser(g, { moteur: 'cpu', passes: r.passes, rayonLissage: r.rayonLissage });
  const ref = RELIEF.preparer(g, { moteur: 'cpu', pasM: geo.pas, garderRepli: true });
  let ecart = 0;
  for (let i = 0; i < t.N; i++) ecart = Math.max(ecart, Math.abs(t.mnt[i] - ref.mnt[i]));
  assert.ok(ecart < 1e-6, `écart ${ecart}`);
});

test('une couche se calcule et porte sa géométrie', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const c = m.calculer(geo, 'ombrage');
  assert.equal(c.valeurs.length, geo.W * geo.H);
  assert.equal(c.moteurSurface, 'cpu');
  assert.ok(Number.isFinite(c.min) && Number.isFinite(c.max));
  assert.equal(c.geo, geo);
});

test('un bloc hors de la grille n’est pas rangé', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('loin', 5000, 5000));
  assert.equal(m.surface(geo), null);
});

test('retirer un bloc change la surface', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const avant = m.surface(geo);
  m.retirer('a');
  assert.equal(m.taille(), 0);
  assert.equal(m.surface(geo), null);
  assert.ok(avant);
});

test('la surface est mémoïsée, et recalculée quand les réglages changent', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('a', 1000, 2000));
  const t1 = m.surface(geo);
  assert.equal(m.surface(geo), t1);
  m.reglages({ classesSol: new Set([9]) });   // plus aucun sol
  const t2 = m.surface(geo);
  assert.notEqual(t2, t1);
  assert.equal(t2.valide.reduce((s, v) => s + v, 0), 0);
});

test('deux dalles d’altitudes très différentes tiennent dans la même grille', () => {
  const m = VUE_RELIEF.creer({ moteur: 'cpu' });
  m.ajouter(bloc('bas', 1000, 2000, { cote: 30, zBase: 20000 }));
  m.ajouter(bloc('haut', 1030, 2000, { cote: 30, zBase: 80000 }));
  const t = m.surface(VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2030 }, 0.5, 0, 4096));
  const i = 10 * t.W + 5, j = 10 * t.W + 100;
  assert.ok(t.mnt[j] - t.mnt[i] > 590, `${t.mnt[i]} → ${t.mnt[j]}`);
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `node --test test/vue-relief.test.js`
Expected: FAIL — `vue-relief.js` introuvable.

- [ ] **Step 3: Écrire le module (processeur seul)**

`src/vue-relief.js` :

```js
// Le relief de la vue, depuis les blocs de points que flux.js livre.
//
// Les blocs arrivent décodés en centimètres entiers ; ils sont gardés ici — sur
// la carte graphique quand elle est vérifiée, en mémoire sinon — et la surface
// de la vue se reconstruit à la demande : rangement des points dans la grille,
// terrain (comblement, repli, lissage), surface affichée (le sol, complété par
// le non classé là où aucun retour sol). La couche elle-même passe ensuite par
// RELIEF.calculer, inchangé : à la taille d'un écran, renvoyer la surface à la
// carte graphique ne coûte que quelques millisecondes.
//
// Deux chemins, une seule référence. `surfaceCPU` enchaîne RASTER et RELIEF
// tels quels ; le chemin de la carte graphique (GPU_RELIEF.surfaceVue) n'est
// employé qu'après avoir rendu la même surface sur des points d'essai.

const VUE_RELIEF = (() => {
  /** Réglages de la surface pour un pas donné, depuis la configuration. */
  function reglagesDefaut(pasM) {
    return {
      classesSol: new Set(CONFIG.raster.classesSolDefaut),
      inclureBati: CONFIG.relief.inclureBati,
      inclureSursol: CONFIG.relief.inclureSursol,
      hauteurSursolMaxM: CONFIG.relief.hauteurSursolMaxM,
      passes: VUE_GRILLE.passes(CONFIG.flux.comblementM, pasM),
      rayonLissage: VUE_GRILLE.rayon(CONFIG.flux.lissageM, pasM),
    };
  }

  /** La référence : RASTER puis RELIEF.preparer au pas de la grille. */
  function surfaceCPU(geo, blocs, zRefCm, r) {
    const g = RASTER.creerGrillesVue(geo, zRefCm, r.classesSol);
    for (const b of blocs) RASTER.accumuler(g, b);
    RASTER.finaliser(g, { moteur: 'cpu', passes: r.passes, rayonLissage: r.rayonLissage });
    return RELIEF.preparer(g, {
      moteur: 'cpu', pasM: geo.pas, garderRepli: true,
      inclureBati: r.inclureBati, inclureSursol: r.inclureSursol, hauteurSursolMaxM: r.hauteurSursolMaxM,
    });
  }

  function creer({ moteur = 'auto' } = {}) {
    const gpu = moteur !== 'cpu' && gpuVerifie();
    const blocs = new Map();   // cle → { emprise, origineCm, nbPoints, zminCm, zmaxCm, points }
    let reglagesCourants = {};
    let version = 0;
    let memo = null;           // { cle, t }

    function ajouter(b) {
      const p = b.points;
      const n = p.nbPoints;
      let zmin = Infinity, zmax = -Infinity;
      for (let i = 0; i < n; i++) { const z = p.zc[i]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
      if (gpu && !GPU_RELIEF.ajouterBloc(b.cle, p)) return;
      blocs.set(b.cle, {
        emprise: b.emprise, origineCm: b.origineCm, nbPoints: n,
        zminCm: zmin + b.origineCm[2], zmaxCm: zmax + b.origineCm[2],
        // Sur la carte graphique, les points n'ont plus à rester en mémoire.
        points: gpu ? null : p,
      });
      version++;
    }

    function retirer(cle) {
      if (!blocs.delete(cle)) return;
      if (gpu) GPU_RELIEF.retirerBloc(cle);
      version++;
    }

    function reglages(r) {
      reglagesCourants = { ...reglagesCourants, ...r };
      version++;
    }

    function surface(geo) {
      const cleMemo = `${version}|${geo.xminCm}|${geo.yminCm}|${geo.pasCm}|${geo.W}|${geo.H}`;
      if (memo && memo.cle === cleMemo) return memo.t;
      const choisis = [...blocs].filter(([, b]) => VUE_GRILLE.coupe(b.emprise, geo));
      let t = null;
      if (choisis.length) {
        let zmin = Infinity, zmax = -Infinity;
        for (const [, b] of choisis) { zmin = Math.min(zmin, b.zminCm); zmax = Math.max(zmax, b.zmaxCm); }
        // Un mètre de marge de part et d'autre : la profondeur de la carte
        // graphique est bornée à [0, 1], un point à la limite serait écrêté.
        const zRefCm = zmin - 100, spanCm = zmax - zRefCm + 100;
        const r = { ...reglagesDefaut(geo.pas), ...reglagesCourants };
        t = gpu
          ? GPU_RELIEF.surfaceVue(geo, choisis.map(([cle, b]) => ({ cle, origineCm: b.origineCm })), zRefCm, spanCm, r)
          : surfaceCPU(geo, choisis.map(([, b]) => ({ ...b.points, origineCm: b.origineCm })), zRefCm, r);
      }
      memo = { cle: cleMemo, t };
      return t;
    }

    function calculer(geo, cle) {
      const t0 = performance.now();
      const t = surface(geo);
      if (!t) return null;
      const dureeSurface = performance.now() - t0;
      const c = RELIEF.calculer(t, cle, gpu ? {} : { moteur: 'cpu' });
      return { ...c, geo, t, moteurSurface: gpu ? 'gpu' : 'cpu', dureeSurface, duree: performance.now() - t0 };
    }

    return {
      ajouter, retirer, reglages, surface, calculer,
      taille: () => blocs.size,
      moteur: gpu ? 'gpu' : 'cpu',
      coteMax: gpu ? Math.min(CONFIG.flux.coteMaxGrille, GPU_RELIEF.coteMax()) : CONFIG.flux.coteMaxGrille,
    };
  }

  // Remplacé à la tâche 5 par l'autocontrôle de la carte graphique.
  function gpuVerifie() { return false; }

  return { creer, surfaceCPU, reglagesDefaut };
})();
```

Dans `index.html`, après `<script src="src/gpu-relief.js"></script>` :

```html
<script src="src/vue-relief.js"></script>
```

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/vue-relief.test.js test/sources.test.js 2>&1 | tail -5`
Expected: PASS, tous.

- [ ] **Step 5: Commit**

```bash
git add src/vue-relief.js test/vue-relief.test.js index.html
git commit -m "Vue : relief de la vue au processeur, depuis les blocs reçus"
```

---

### Task 5: La surface de la vue sur la carte graphique

Aucun test Node ne peut exécuter WebGL : la preuve de cette tâche est l'**autocontrôle** (parité contre `VUE_RELIEF.surfaceCPU` sur des points d'essai) et sa mesure dans le vrai Chrome de Windows. Il est écrit **avant** le code de la carte graphique, et on le voit échouer (step 2) avant d'écrire les noyaux.

**Files:**
- Modify: `src/shaders.js` (section « Calcul du relief »)
- Modify: `src/gpu-relief.js`
- Modify: `src/vue-relief.js` (`gpuVerifie`, `controleGPU`)

**Interfaces:**
- Consumes: `VUE_RELIEF.surfaceCPU`, `VUE_RELIEF.reglagesDefaut`, `VUE_GRILLE.definir`.
- Produces:
  - `GPU_RELIEF.ajouterBloc(cle, { nbPoints, xc, yc, zc, cls }) → bool`, `GPU_RELIEF.retirerBloc(cle)`, `GPU_RELIEF.coteMax() → int`.
  - `GPU_RELIEF.surfaceVue(geo, blocs: Array<{cle, origineCm}>, zRefCm, spanCm, r) → ?t` — mêmes champs que `surfaceCPU` pour `mnt`, `valide`, `hauteur`, `trou` ; `null` si la carte est indisponible ou la grille trop grande.
  - `VUE_RELIEF.controleGPU() → '' | raison`.

- [ ] **Step 1: Écrire l'autocontrôle**

Dans `src/vue-relief.js`, remplacer `gpuVerifie` par :

```js
  // Verdict de l'autocontrôle : null = pas encore fait, '' = accepté.
  let verdict = null;

  function gpuVerifie() {
    if (verdict === null) {
      try {
        verdict = typeof GPU_RELIEF === 'undefined' ? 'module absent'
          : !GPU_RELIEF.disponible() ? (GPU_RELIEF.raison() || 'carte graphique indisponible')
            : controleGPU();
      } catch (e) {
        verdict = e.message || String(e);
      }
      if (verdict) console.warn(`Relief de la vue calculé sur le processeur : ${verdict}`);
    }
    return verdict === '';
  }

  /**
   * Rend la même surface sur la carte graphique et au processeur, sur des
   * points d'essai qui mêlent ce qui a déjà piégé ce genre de code : des
   * points pile sur les limites de case, deux dalles à 600 m d'écart
   * d'altitude (la profondeur est normalisée sur l'étendue de la vue), un mur
   * non classé sans sol dessous (la surface doit le prendre), un arbre au-dessus
   * du plafond (elle ne doit pas), du bâti, de l'eau, un grand trou.
   * Rend '' si tout concorde, sinon la raison.
   */
  function controleGPU() {
    const geo = VUE_GRILLE.definir({ xmin: 1000, xmax: 1060, ymin: 2000, ymax: 2040 }, 0.5, 0, 4096);
    let graine = 11;
    const alea = () => ((graine = (graine * 1664525 + 1013904223) >>> 0) / 4294967296);
    const blocs = [];
    for (const [k, zBase] of [[0, 30000], [1, 90000]]) {
      const x0 = 1000 + k * 30, n = 12000;
      const xc = new Int32Array(n), yc = new Int32Array(n), zc = new Int32Array(n), cls = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        // Un point sur cinq pile sur une limite de case de 50 cm.
        const x = i % 5 === 0 ? Math.floor(alea() * 60) * 50 : Math.floor(alea() * 3000);
        const y = i % 5 === 1 ? Math.floor(alea() * 80) * 50 : Math.floor(alea() * 4000);
        const sol = zBase + Math.round(x * 0.04 + 30 * Math.exp(-((x - 1500) ** 2 + (y - 2000) ** 2) / 3e5));
        const u = alea();
        const dansTrou = (x - 2200) ** 2 + (y - 1000) ** 2 < 500 ** 2;
        const surMur = Math.abs(x - 800) < 60 && y > 1000 && y < 3000;
        xc[i] = x; yc[i] = y;
        if (surMur) { cls[i] = 1; zc[i] = sol + 60 + Math.round(alea() * 20); }
        else if (u < 0.45 && !dansTrou) { cls[i] = alea() < 0.1 ? 9 : 2; zc[i] = sol; }
        else if (u < 0.55) { cls[i] = 6; zc[i] = sol + Math.round(alea() * 250); }
        else if (u < 0.65) { cls[i] = 1; zc[i] = sol + Math.round(alea() * 500); }
        else { cls[i] = 5; zc[i] = sol + Math.round(alea() * 2000); }
      }
      blocs.push({ cle: `__controle_${k}`, origineCm: [x0 * 100, 200000, 0], nbPoints: n, xc, yc, zc, cls });
    }
    let zmin = Infinity, zmax = -Infinity;
    for (const b of blocs) for (let i = 0; i < b.nbPoints; i++) { zmin = Math.min(zmin, b.zc[i]); zmax = Math.max(zmax, b.zc[i]); }
    const zRefCm = zmin - 100, spanCm = zmax - zRefCm + 100;
    const r = reglagesDefaut(geo.pas);

    const ref = surfaceCPU(geo, blocs, zRefCm, r);
    for (const b of blocs) if (!GPU_RELIEF.ajouterBloc(b.cle, b)) return 'blocs refusés par la carte graphique';
    let t;
    try {
      t = GPU_RELIEF.surfaceVue(geo, blocs.map((b) => ({ cle: b.cle, origineCm: b.origineCm })), zRefCm, spanCm, r);
    } finally {
      for (const b of blocs) GPU_RELIEF.retirerBloc(b.cle);
    }
    if (!t) return 'surface refusée par la carte graphique';

    // Tolérances : l'altitude passe par une profondeur flottante (≈ 0,1 mm sur
    // 600 m) ; les hauteurs par des sommes sur 16 bits (≈ 2 mm mesurés).
    let dMnt = 0, dH = 0, dValide = 0, dTrou = 0;
    for (let i = 0; i < ref.N; i++) {
      if (t.valide[i] !== ref.valide[i]) dValide++;
      if (t.trou[i] !== ref.trou[i]) dTrou++;
      if (ref.valide[i]) dMnt = Math.max(dMnt, Math.abs(t.mnt[i] - ref.mnt[i]));
      dH = Math.max(dH, Math.abs(t.hauteur[i] - ref.hauteur[i]));
    }
    if (dValide || dTrou || dMnt > 2e-3 || dH > 1e-2) {
      return `surface de la vue : ${dValide} validités et ${dTrou} trous différents, altitude à ${dMnt.toExponential(1)} m, hauteur à ${dH.toExponential(1)} m`;
    }
    return '';
  }
```

et exporter `controleGPU` : `return { creer, surfaceCPU, reglagesDefaut, controleGPU };`

- [ ] **Step 1b: Le câblage, testé sous Node avec un faux module**

Comme `test/gpu-relief.test.js` : un faux `GPU_RELIEF` dont `surfaceVue` délègue à la référence (donc l'autocontrôle passe) ou rend une surface fausse (donc il échoue). `test/vue-relief-gpu.test.js` :

```js
// Aiguillage de VUE_RELIEF entre carte graphique et processeur. Node n'a pas
// de WebGL : un faux GPU_RELIEF tient lieu de carte, et ce qui se vérifie ici
// est le câblage — l'autocontrôle décide, et un refus retombe sur le
// processeur sans perdre les blocs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

function monter(fausser) {
  const ctx = chargerScripts(['config.js', 'vue-grille.js', 'raster.js', 'relief.js', 'vue-relief.js']);
  const gardes = new Map();
  const appels = [];
  ctx.GPU_RELIEF = {
    disponible: () => true,
    raison: () => '',
    coteMax: () => 8192,
    // Les couches passent ensuite par RELIEF.calculer, qui interroge aussi la
    // carte : `null` le renvoie au processeur, comme une carte qui refuse.
    horizons: () => null,
    ombrages: () => null,
    microRelief: () => null,
    ajouterBloc: (cle, p) => { gardes.set(cle, p); return true; },
    retirerBloc: (cle) => { gardes.delete(cle); },
    surfaceVue: (geo, blocs, zRefCm, spanCm, r) => {
      appels.push(blocs.length);
      const t = ctx.VUE_RELIEF.surfaceCPU(geo, blocs.map((b) => ({ ...gardes.get(b.cle), origineCm: b.origineCm })), zRefCm, r);
      if (fausser) for (let i = 0; i < t.N; i++) t.mnt[i] += 1;
      return t;
    },
  };
  return { ctx, gardes, appels };
}

function bloc(cle) {
  const n = 400;
  const xc = new Int32Array(n), yc = new Int32Array(n), zc = new Int32Array(n), cls = new Uint8Array(n).fill(2);
  for (let i = 0; i < n; i++) { xc[i] = (i % 20) * 50 + 10; yc[i] = Math.floor(i / 20) * 50 + 10; zc[i] = 30000 + i; }
  return { cle, emprise: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 }, origineCm: [0, 0, 0], points: { nbPoints: n, xc, yc, zc, cls } };
}

test('autocontrôle accepté : la surface vient de la carte graphique', () => {
  const { ctx, gardes, appels } = monter(false);
  assert.equal(ctx.VUE_RELIEF.controleGPU(), '');
  const m = ctx.VUE_RELIEF.creer();
  assert.equal(m.moteur, 'gpu');
  m.ajouter(bloc('a'));
  assert.ok(gardes.has('a'));
  const geo = ctx.VUE_GRILLE.definir({ xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, 0.5, 0, 4096);
  const c = m.calculer(geo, 'ombrage');
  assert.equal(c.moteurSurface, 'gpu');
  assert.equal(appels.at(-1), 1);
  m.retirer('a');
  assert.equal(gardes.has('a'), false);
});

test('autocontrôle refusé : le processeur calcule', () => {
  const { ctx, gardes } = monter(true);
  assert.match(ctx.VUE_RELIEF.controleGPU(), /altitude/);
  const m = ctx.VUE_RELIEF.creer();
  assert.equal(m.moteur, 'cpu');
  m.ajouter(bloc('a'));
  assert.equal(gardes.has('a'), false);
  const geo = ctx.VUE_GRILLE.definir({ xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, 0.5, 0, 4096);
  assert.equal(m.calculer(geo, 'ombrage').moteurSurface, 'cpu');
});
```

`ctx.GPU_RELIEF = …` posé après chargement suffit : c'est ce que fait déjà `test/gpu-relief.test.js`, `vue-relief.js` ne lisant le global qu'à l'exécution.

Run: `node --test test/vue-relief-gpu.test.js`
Expected: FAIL — `controleGPU` absent (step 1 pas encore écrit) ou câblage manquant ; après le step 1, le premier test passe, le second aussi.

- [ ] **Step 2: Le voir échouer**

Préparer le harnais (hors dépôt, dans le scratchpad) : un serveur HTTP qui sert **le dépôt** en lecture (racine `/home/linux/workspace/Scopus`, `text/html` pour `.html`, `text/javascript` pour `.js`) et une page `essai-vue.html` écrite dans le scratchpad, servie sous `/__essai/essai-vue.html`, qui charge `config.js`, `vue-grille.js`, `raster.js`, `relief.js`, `gl.js`, `shaders.js`, `gpu-relief.js`, `vue-relief.js` depuis `/src/`, puis envoie par POST `/resultat` :

```js
({ verdict: VUE_RELIEF.controleGPU(), carte: GPU_RELIEF.disponible(), raison: GPU_RELIEF.raison() })
```

Lancer par le Chromium de WSL (SwiftShader : pour les valeurs, pas les temps).

Expected: la page lève `GPU_RELIEF.ajouterBloc is not a function` — rapportée dans le POST.

- [ ] **Step 3: Les noyaux**

Dans `src/shaders.js`, à la fin de la section « Calcul du relief » (avant la fermeture de l'objet), sans aucun backtick dans les commentaires GLSL :

```js
  // Rangement des points dans la grille de la vue, sans EXT_float_blend. Un
  // point = un fragment d'un pixel, dans la case que donne la division entière
  // de ses centimètres : la même que RASTER.accumuler, au point près.
  // Six modes, un par passe :
  //   0 sol minimal (profondeur, test LESS, classes du sol seules)
  //   1 minimum de tous (LESS) : la référence des sommes
  //   2 maximum de tous (GREATER)
  //   3 classe du maximum (EQUAL sur la profondeur du maximum)
  //   4 comptes : sol, non classé, bâti, total, additifs sur 8 bits
  //   5 sommes des hauteurs au-dessus du minimum de tous, additives sur 16 bits
  // La profondeur porte l'altitude relative à zRef, divisée par l'étendue.
  accuVS: `#version 300 es
precision highp float; precision highp int;
in int a_x; in int a_y; in int a_z; in uint a_cls;
uniform ivec2 u_decal;
uniform int u_zDecal;
uniform int u_pasCm; uniform int u_W; uniform int u_H;
uniform float u_span;
uniform int u_mode;
uniform uint u_sol[8];
uniform highp sampler2D u_minTous;
out float v_prof;
flat out uint v_cls;
out vec4 v_val;
void main() {
  int x = a_x + u_decal.x;
  int y = a_y + u_decal.y;
  int cx = x >= 0 ? x / u_pasCm : -1;
  int cy = y >= 0 ? y / u_pasCm : -1;
  bool sol = ((u_sol[a_cls >> 5u] >> (a_cls & 31u)) & 1u) == 1u;
  bool garder = cx >= 0 && cy >= 0 && cx < u_W && cy < u_H && (u_mode != 0 || sol);
  gl_Position = garder
    ? vec4((float(cx) + 0.5) / float(u_W) * 2.0 - 1.0, (float(cy) + 0.5) / float(u_H) * 2.0 - 1.0, 0.0, 1.0)
    : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 1.0;
  float zrel = float(a_z + u_zDecal);
  v_prof = zrel / u_span;
  v_cls = a_cls;
  bool nc = !sol && a_cls == 1u;
  bool bat = !sol && a_cls == 6u;
  if (u_mode == 4) {
    v_val = vec4(sol ? 1.0 : 0.0, nc ? 1.0 : 0.0, bat ? 1.0 : 0.0, 1.0) / 255.0;
  } else if (u_mode == 5 && garder) {
    float ref = texelFetch(u_minTous, ivec2(cx, cy), 0).r * u_span;
    float h = (zrel - ref) / 100.0;
    v_val = vec4(nc ? h : 0.0, bat ? h : 0.0, 0.0, 0.0);
  } else {
    v_val = vec4(0.0);
  }
}`,

  accuFS: `#version 300 es
precision highp float; precision highp int;
in float v_prof;
flat in uint v_cls;
in vec4 v_val;
uniform int u_mode;
out vec4 o;
void main() {
  gl_FragDepth = v_prof;
  o = u_mode == 3 ? vec4(float(v_cls) / 255.0, 0.0, 0.0, 1.0) : v_val;
}`,

  // Sol minimal (profondeur) et comptes vers l'entrée du terrain : RG =
  // (altitude en mètres au-dessus de zRef, sol connu).
  solPrepFS: `#version 300 es
precision highp float;
uniform highp sampler2D u_prof;
uniform highp sampler2D u_comptes;
uniform float u_span;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  bool connu = texelFetch(u_comptes, p, 0).r > 0.0;
  o = vec4(connu ? texelFetch(u_prof, p, 0).r * u_span / 100.0 : 0.0, connu ? 1.0 : 0.0, 0.0, 1.0);
}`,

  // Surface affichée au pas de la grille, comme RELIEF.preparer avec un
  // facteur 1 et garderRepli : le sol comblé, complété par le non classé (et
  // le bâti si demandé) là où aucun retour sol, sous le plafond de hauteur.
  // Sortie : altitude, valide, hauteur des structures, trou.
  surfaceFS: `#version 300 es
precision highp float;
uniform highp sampler2D u_terrain;
uniform highp sampler2D u_comptes;
uniform highp sampler2D u_sommes;
uniform highp sampler2D u_minTous;
uniform float u_span;
uniform int u_bati; uniform int u_sursol; uniform float u_hMax;
out vec4 o;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 t = texelFetch(u_terrain, p, 0).rg;
  vec4 c = floor(texelFetch(u_comptes, p, 0) * 255.0 + 0.5);
  vec2 s = texelFetch(u_sommes, p, 0).rg;
  float ref = texelFetch(u_minTous, p, 0).r * u_span / 100.0;
  bool connue = t.g > 0.5;
  float n = c.g + (u_bati == 1 ? c.b : 0.0);
  float zSursol = n > 0.0 ? (s.r + (u_bati == 1 ? s.g : 0.0)) / n + ref : 0.0;
  float hauteur = (n > 0.0 && connue) ? max(0.0, zSursol - t.r) : 0.0;
  float z = t.r;
  if (connue && u_sursol == 1 && c.r == 0.0 && n > 0.0) {
    float h = zSursol - t.r;
    if (h > 0.0 && h <= u_hMax) z = zSursol;
  }
  o = vec4(z, connue ? 1.0 : 0.0, hauteur, c.r == 0.0 ? 1.0 : 0.0);
}`,
```

- [ ] **Step 4: Le code de la carte graphique**

Dans `src/gpu-relief.js` :

1. `creer()` : ajouter aux programmes `['solPrep', SHADERS.solPrepFS], ['surface', SHADERS.surfaceFS]` dans la boucle existante, puis, après elle, `programmes.accu = GL.program(gl, SHADERS.accuVS, SHADERS.accuFS);`. Dans l'écouteur `webglcontextlost`, ajouter `blocsGPU.clear();`.

2. `texture(gl, W, H, interne, format, donnees, type = gl.FLOAT)` : passer `type` à `texImage2D` au lieu de `gl.FLOAT`.

3. `passe()` : première ligne après la déstructuration, `gl.bindVertexArray(null);` — les blocs de points ont leurs propres VAO, et le triangle plein écran vit sur l'état par défaut.

4. Extraire de `terrain()` le comblement, le repli et le lissage dans :

```js
  /**
   * Comblement, repli et lissage depuis une texture RG (altitude, sol connu)
   * déjà sur la carte. Rend la cible RG finale (`comble`), l'autre cible
   * (`libre`) et la valeur de repli ; l'appelant libère les deux cibles.
   * `passes` ≥ 1 : la première passe écrit dans une cible, jamais dans
   * l'entrée.
   */
  function terrainTex(e, entree, W, H, passes, rayonLissage) {
    const { gl } = e;
    const P = e.programmes;
    let a = cible(gl, W, H, gl.RG32F, gl.RG), b = cible(gl, W, H, gl.RG32F, gl.RG);
    let ech = null;
    try {
      // … corps actuel de terrain() depuis « Comblement » jusqu'au lissage
      //   vertical inclus, inchangé, avec `Math.max(1, passes)` passes …
      return { comble, libre: lisse, repli };
    } catch (err) {
      liberer(gl, a, b);
      throw err;
    } finally {
      liberer(gl, ech);
    }
  }
```

et réécrire `terrain()` pour l'appeler (`entree` = sa texture RG actuelle), puis faire la passe de pente et le rapatriement comme aujourd'hui, en libérant `entree`, `comble`, `libre`, `fin`.

5. Les blocs et la surface de la vue, après `terrain()` :

```js
  // ── Grille de la vue ──────────────────────────────────────────────────────

  // Points par appel de dessin : au-delà d'un million, un appel peut dépasser
  // le délai de Windows (mesuré : 15 M d'un coup, carte réinitialisée).
  const POINTS_PAR_APPEL = 1_000_000;

  // Blocs de points gardés sur la carte : cle → { vao, tampons, nb }.
  const blocsGPU = new Map();

  function tamponEntier(gl, prog, nom, donnees, entier) {
    const t = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, t);
    gl.bufferData(gl.ARRAY_BUFFER, donnees, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, nom);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribIPointer(loc, 1, entier, 0, 0);
    return t;
  }

  /** Envoie un bloc à la carte, une fois : il y reste jusqu'à `retirerBloc`. */
  function ajouterBloc(cle, b) {
    const e = contexte();
    if (!e) return false;
    retirerBloc(cle);
    const { gl } = e;
    const prog = e.programmes.accu;
    const n = b.nbPoints;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const tampons = [
      tamponEntier(gl, prog, 'a_x', b.xc.subarray(0, n), gl.INT),
      tamponEntier(gl, prog, 'a_y', b.yc.subarray(0, n), gl.INT),
      tamponEntier(gl, prog, 'a_z', b.zc.subarray(0, n), gl.INT),
      tamponEntier(gl, prog, 'a_cls', b.cls.subarray(0, n), gl.UNSIGNED_BYTE),
    ];
    gl.bindVertexArray(null);
    blocsGPU.set(cle, { vao, tampons, nb: n });
    return true;
  }

  function retirerBloc(cle) {
    const s = blocsGPU.get(cle);
    if (!s) return;
    blocsGPU.delete(cle);
    const e = etat;
    if (!e) return;
    e.gl.deleteVertexArray(s.vao);
    for (const t of s.tampons) e.gl.deleteBuffer(t);
  }

  function textureProfondeur(gl, W, H) {
    return texture(gl, W, H, gl.DEPTH_COMPONENT32F, gl.DEPTH_COMPONENT, null);
  }

  /**
   * Surface de la vue, entièrement sur la carte : rangement des points (six
   * passes), terrain, surface affichée ; un seul rapatriement, celui de la
   * surface (quatre flottants par case). Mêmes sorties que
   * VUE_RELIEF.surfaceCPU pour `mnt`, `valide`, `hauteur`, `trou`.
   */
  function surfaceVue(geo, blocs, zRefCm, spanCm, r, e = contexte()) {
    if (!e || geo.W > e.max || geo.H > e.max) return null;
    const { gl } = e;
    const P = e.programmes;
    const { W, H } = geo;
    const N = W * H;

    const profSol = textureProfondeur(gl, W, H);
    const profMin = textureProfondeur(gl, W, H);
    const profMax = textureProfondeur(gl, W, H);
    const classe = texture(gl, W, H, gl.RGBA8, gl.RGBA, null, gl.UNSIGNED_BYTE);
    const comptes = texture(gl, W, H, gl.RGBA8, gl.RGBA, null, gl.UNSIGNED_BYTE);
    const sommes = texture(gl, W, H, gl.RGBA16F, gl.RGBA, null);
    const fb = gl.createFramebuffer();
    const solRG = cible(gl, W, H, gl.RG32F, gl.RG);
    const dest = cible(gl, W, H);
    let terrainR = null;
    try {
      const cibler = (couleur, prof) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, couleur, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, prof, 0);
      };
      const prog = P.accu;
      gl.useProgram(prog);
      gl.uniform1i(prog.u.u_pasCm, geo.pasCm);
      gl.uniform1i(prog.u.u_W, W);
      gl.uniform1i(prog.u.u_H, H);
      gl.uniform1f(prog.u.u_span, spanCm);
      gl.uniform1i(prog.u.u_zDecal, -zRefCm);
      const bits = new Uint32Array(8);
      for (const c of r.classesSol) bits[c >> 5] |= 1 << (c & 31);
      gl.uniform1uiv(gl.getUniformLocation(prog, 'u_sol[0]'), bits);
      gl.uniform1i(prog.u.u_minTous, 0);
      // Aucune texture sur l'unité 0 tant que le minimum n'est pas écrit : le
      // sampler existe dans le programme, et y laisser une profondeur attachée
      // serait une boucle de rétroaction refusée.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.viewport(0, 0, W, H);

      const dessiner = (mode) => {
        gl.uniform1i(prog.u.u_mode, mode);
        for (const b of blocs) {
          const s = blocsGPU.get(b.cle);
          if (!s) continue;
          gl.uniform2i(prog.u.u_decal, b.origineCm[0] - geo.xminCm, b.origineCm[1] - geo.yminCm);
          gl.bindVertexArray(s.vao);
          for (let d = 0; d < s.nb; d += POINTS_PAR_APPEL) {
            gl.drawArrays(gl.POINTS, d, Math.min(POINTS_PAR_APPEL, s.nb - d));
            gl.flush();
          }
        }
        gl.bindVertexArray(null);
      };

      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.colorMask(false, false, false, false);
      for (const [mode, prof, clair, fonction] of [[0, profSol, 1, gl.LESS], [1, profMin, 1, gl.LESS], [2, profMax, 0, gl.GREATER]]) {
        cibler(classe, prof);
        gl.clearDepth(clair);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.depthFunc(fonction);
        dessiner(mode);
      }
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);

      // Classe du maximum : seuls les points à la profondeur du maximum passent.
      cibler(classe, profMax);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.depthMask(false);
      gl.depthFunc(gl.EQUAL);
      dessiner(3);
      gl.depthMask(true);
      gl.disable(gl.DEPTH_TEST);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      cibler(comptes, null);
      gl.clear(gl.COLOR_BUFFER_BIT);
      dessiner(4);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, profMin);
      cibler(sommes, null);
      gl.clear(gl.COLOR_BUFFER_BIT);
      dessiner(5);
      gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      gl.useProgram(P.solPrep);
      gl.uniform1f(P.solPrep.u.u_span, spanCm);
      passe(e, P.solPrep, solRG, W, H, { u_prof: profSol, u_comptes: comptes });
      terrainR = terrainTex(e, solRG, W, H, r.passes, r.rayonLissage);

      gl.useProgram(P.surface);
      gl.uniform1f(P.surface.u.u_span, spanCm);
      gl.uniform1i(P.surface.u.u_bati, r.inclureBati ? 1 : 0);
      gl.uniform1i(P.surface.u.u_sursol, r.inclureSursol ? 1 : 0);
      gl.uniform1f(P.surface.u.u_hMax, r.hauteurSursolMaxM);
      passe(e, P.surface, dest, W, H, { u_terrain: terrainR.comble.tex, u_comptes: comptes, u_sommes: sommes, u_minTous: profMin });
      const px = lire(gl, dest, W, H);

      const mnt = new Float32Array(N), valide = new Uint8Array(N), hauteur = new Float32Array(N), trou = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const k = i * 4;
        mnt[i] = px[k];
        valide[i] = px[k + 1] > 0.5 ? 1 : 0;
        hauteur[i] = px[k + 2];
        trou[i] = px[k + 3];
      }
      return {
        W, H, N, pas: geo.pas, mnt, valide, hauteur, trou,
        emprise: geo.emprise, origine: [geo.emprise.xmin, geo.emprise.ymin, zRefCm / 100],
      };
    } finally {
      gl.deleteFramebuffer(fb);
      liberer(gl, profSol, profMin, profMax, classe, comptes, sommes, solRG, dest,
        terrainR && terrainR.comble, terrainR && terrainR.libre);
    }
  }
```

6. Exporter, dans l'objet rendu :

```js
    ajouterBloc,
    retirerBloc,
    surfaceVue: (geo, blocs, zRefCm, spanCm, r) => surfaceVue(geo, blocs, zRefCm, spanCm, r),
    /** Côté maximal d'une texture, 0 sans carte graphique. */
    coteMax: () => { const e = contexte(); return e ? e.max : 0; },
```

- [ ] **Step 5: Tests Node (syntaxe, backticks, balises)**

Run: `npm test 2>&1 | tail -5`
Expected: `# fail 0`.

- [ ] **Step 6: Autocontrôle dans le navigateur (SwiftShader, valeurs)**

Relancer le harnais du step 2 par le Chromium de WSL.
Expected: `{ verdict: '', carte: true }`. Tout autre verdict se diagnostique ici (lire la raison), sans relâcher les tolérances.

- [ ] **Step 7: Mesure sur la vraie carte graphique**

Étendre la page d'essai : 4 dalles synthétiques de 1 km² (générateur de `controleGPU`, 15 M points au total), grille d'écran `VUE_GRILLE.definir` sur 3 km à `pas = 1,5 m` puis sur 1 km à `0,5 m` ; mesurer `surfaceVue` (deux appels, le second chaud) et `surfaceCPU`, et comparer les surfaces avec les tolérances de `controleGPU`. Lancer dans le Chrome de Windows (profil dédié, tué par son profil). Rapporter : carte, verdict, temps GPU/CPU, écarts.
Expected: verdict `''`, écarts sous les tolérances ; noter les temps pour CLAUDE.md.

- [ ] **Step 8: Commit**

```bash
git add src/shaders.js src/gpu-relief.js src/vue-relief.js test/vue-relief-gpu.test.js
git commit -m "Vue : surface de la vue sur la carte graphique, vérifiée contre le processeur"
```

---

### Task 6: Le relief sur la carte, derrière ?flux

**Files:**
- Modify: `src/flux-calque.js` (`CalqueReliefControle`)
- Modify: `src/app.js` (bloc `?flux`)

**Interfaces:**
- Consumes: `VUE_RELIEF.creer`, `VUE_GRILLE.definir/marge`, `FLUX_CHOIX.pasPourVue/surfaceKm2`, `RELIEF.COUCHES`, `construireLUT` (global de `vue-2d.js`), `PROJ.versWGS84`.
- Produces: `CalqueReliefControle` (`L.Layer`) avec `afficher(resultat)` et `vider()` ; `window.reliefDeControle` (le moteur de la vue, pour les harnais).

- [ ] **Step 1: Le calque de contrôle**

À la fin de `src/flux-calque.js` :

```js
// Relief de la vue, provisoire : la couche calculée, étirée sur sa palette,
// posée en image sur la carte. Le plan 3 le remplace par un calque WebGL
// redessiné à chaque image ; celui-ci ne sert qu'à voir le calcul.
//
// L'image est posée sur le rectangle WGS84 des coins sud-ouest et nord-est de
// la grille : un carré Lambert-93 étant tourné d'environ 1° en Mercator, elle
// glisse de quelques mètres vers les bords d'une grande vue. Acceptable pour
// un contrôle, pas pour l'affichage final.
const CalqueReliefControle = L.Layer.extend({
  onAdd(map) { this._carte = map; },
  onRemove() { this.vider(); },
  vider() {
    if (this._image) { this._carte.removeLayer(this._image); this._image = null; }
    if (this._url) { URL.revokeObjectURL(this._url); this._url = null; }
  },
  afficher(r) {
    const { W, H } = r.geo;
    const lut = construireLUT(r.palette);
    const toile = document.createElement('canvas');
    toile.width = W;
    toile.height = H;
    const ctx = toile.getContext('2d');
    const img = ctx.createImageData(W, H);
    const etendue = r.max - r.min || 1;
    // Ligne 0 de la grille au sud, ligne 0 de l'image au nord.
    for (let y = 0; y < H; y++) {
      const source = (H - 1 - y) * W;
      for (let x = 0; x < W; x++) {
        const v = r.valeurs[source + x];
        if (!Number.isFinite(v)) continue;
        const i = Math.max(0, Math.min(255, Math.round(((v - r.min) / etendue) * 255))) * 3;
        const k = (y * W + x) * 4;
        img.data[k] = lut[i]; img.data[k + 1] = lut[i + 1]; img.data[k + 2] = lut[i + 2]; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const e = r.geo.emprise;
    const so = PROJ.versWGS84(e.xmin, e.ymin), ne = PROJ.versWGS84(e.xmax, e.ymax);
    const bornes = L.latLngBounds([so.lat, so.lon], [ne.lat, ne.lon]);
    toile.toBlob((blob) => {
      if (!this._carte) return;
      const ancien = this._url;
      this._url = URL.createObjectURL(blob);
      if (this._image) { this._image.setUrl(this._url); this._image.setBounds(bornes); }
      else this._image = L.imageOverlay(this._url, bornes, { opacity: 0.9, interactive: false }).addTo(this._carte);
      if (ancien) URL.revokeObjectURL(ancien);
    });
  },
});
```

- [ ] **Step 2: Le branchement**

Dans `src/app.js`, bloc `?flux` : créer le moteur **avant** le flux, régler le budget sur le moteur, recalculer à la vue et à l'arrivée des blocs.

```js
if (new URLSearchParams(location.search).has('flux')) {
  const calque = new CalqueFlux().addTo(carte.map);
  const reliefCalque = new CalqueReliefControle().addTo(carte.map);
  const relief = VUE_RELIEF.creer();
  const surAppareilPortatif = surMobile();
  let budget = surAppareilPortatif ? CONFIG.flux.budgetPointsMobile : CONFIG.flux.budgetPoints;
  // Sans carte graphique vérifiée, chaque recalcul range tous les points au
  // processeur (3,9 s pour 15 M, mesuré) : on en garde moins.
  if (relief.moteur === 'cpu') budget = Math.min(budget, CONFIG.flux.budgetPointsProcesseur);

  let dernierEtat = null, texteRelief = '', vueCourante = null, coucheFlux = 'ombrage', minuteur = null;
  const majStatut = () => {
    const e = dernierEtat;
    if (!e) return;
    statut((e.tropLarge
      ? `Flux : ${e.surfaceKm2.toFixed(0)} km² affichés, trop pour les points (seuil ${CONFIG.flux.surfaceMaxPointsKm2} km²) — zoomez`
      : `Flux : ${e.surfaceKm2.toFixed(1)} km² · ${e.dallesOuvertes} dalles · ${e.charges} blocs · ${milliers(e.points)} points`
        + (e.attente ? ` · ${e.attente} en attente` : '')
        + (e.echecs ? ` · ${e.echecs} dalle${e.echecs > 1 ? 's' : ''} en échec, réessai en cours — ${e.erreur}` : ''))
      + (texteRelief ? ` · ${texteRelief}` : ''),
    e.echecs ? 'erreur' : e.attente ? 'travail' : undefined);
  };

  const calculerRelief = () => {
    if (!vueCourante || FLUX_CHOIX.surfaceKm2(vueCourante) > CONFIG.flux.surfaceMaxPointsKm2) {
      reliefCalque.vider();
      texteRelief = '';
      majStatut();
      return;
    }
    const pas = FLUX_CHOIX.pasPourVue(vueCourante.xmax - vueCourante.xmin, vueCourante.largeurPx, CONFIG.flux.pasMinM);
    const geo = VUE_GRILLE.definir(vueCourante, pas, VUE_GRILLE.marge({ ...CONFIG.relief, ...CONFIG.flux }), relief.coteMax);
    let r;
    try {
      r = relief.calculer(geo, coucheFlux);
    } catch (err) {
      console.error(err);
      texteRelief = `relief en échec : ${err.message}`;
      majStatut();
      return;
    }
    if (!r) { reliefCalque.vider(); texteRelief = ''; majStatut(); return; }
    reliefCalque.afficher(r);
    texteRelief = `relief ${(r.duree / 1000).toFixed(2)} s (${r.moteurSurface}, surface ${(r.dureeSurface / 1000).toFixed(2)} s) · ${geo.W}×${geo.H} cases de ${geo.pas.toFixed(2)} m`;
    majStatut();
  };
  // Pendant l'arrivée des blocs, un recalcul au plus toutes les 600 ms ; au
  // déplacement, tout de suite — la vue d'avant n'a plus de sens.
  const planifierRelief = (delai) => {
    if (delai === 0 && minuteur) { clearTimeout(minuteur); minuteur = null; }
    if (minuteur) return;
    minuteur = setTimeout(() => { minuteur = null; calculerRelief(); }, delai);
  };

  const flux = FLUX.creer({
    chercherDalles: (z) => {
      const so = PROJ.versWGS84(z.xmin, z.ymin), ne = PROJ.versWGS84(z.xmax, z.ymax);
      return IGN.dalles(so.lat, so.lon, ne.lat, ne.lon);
    },
    recuperer: RESEAU.recuperer,
    expliquer: RESEAU.expliquer,
    decoder: NUAGE.decoder,
    cache: CACHE_DISQUE.creer(CACHE_DISQUE.stockageIndexedDB(), CONFIG.flux.quotaDisqueOctets),
    config: { ...CONFIG.flux, budgetPoints: budget },
    surBloc: (b) => { calque.ajouter(b); relief.ajouter(b); planifierRelief(600); },
    surLibere: (cle) => { calque.retirer(cle); relief.retirer(cle); },
    surEtat: (e) => { dernierEtat = e; majStatut(); },
  });

  const majVueFlux = () => {
    const b = carte.map.getBounds();
    const so = PROJ.versLambert93(b.getWest(), b.getSouth());
    const ne = PROJ.versLambert93(b.getEast(), b.getNorth());
    const no = PROJ.versLambert93(b.getWest(), b.getNorth());
    const se = PROJ.versLambert93(b.getEast(), b.getSouth());
    vueCourante = {
      xmin: Math.min(so.x, no.x), xmax: Math.max(ne.x, se.x),
      ymin: Math.min(so.y, se.y), ymax: Math.max(ne.y, no.y),
      largeurPx: carte.map.getSize().x,
    };
    flux.majVue(vueCourante);
    planifierRelief(0);
  };

  // Choix de la couche, provisoire comme le calque.
  const choix = L.control({ position: 'topright' });
  choix.onAdd = () => {
    const s = L.DomUtil.create('select');
    for (const c of RELIEF.COUCHES) s.add(new Option(c.libelle, c.cle, c.cle === coucheFlux, c.cle === coucheFlux));
    L.DomEvent.disableClickPropagation(s);
    s.addEventListener('change', () => { coucheFlux = s.value; planifierRelief(0); });
    return s;
  };
  choix.addTo(carte.map);

  carte.map.on('moveend', majVueFlux);
  majVueFlux();
  window.fluxDeControle = flux;     // pour la console et les harnais
  window.reliefDeControle = relief;
}
```

Mettre à jour le commentaire d'en-tête du bloc : « Plans 1 et 2 de la spec : les blocs de la vue se chargent, se dessinent en contours, et le relief de la vue se calcule et se pose en image de contrôle. »

- [ ] **Step 3: Tests**

Run: `npm test 2>&1 | tail -5`
Expected: `# fail 0` (`test/sources.test.js` vérifie la syntaxe et les scripts).

- [ ] **Step 4: Parcours réel (Chromium de WSL)**

Harnais Playwright (profil dédié, comme `flux-reel.mjs`) : ouvrir `index.html?flux#map=16/49.2066/5.4359` en `file://`, attendre ~40 s, relever `window.reliefDeControle.moteur`, le texte du statut, les erreurs de console, et un cliché ; puis zoomer d'un cran, attendre, second cliché ; puis choisir « Sky-View Factor » dans le sélecteur, troisième cliché.
Expected: aucune erreur de console ; le statut porte « relief … s » ; les clichés montrent le relief (le Bois des Caures : trous d'obus au SVF) posé sur la carte, plus fin au zoom.

- [ ] **Step 5: Temps sur la vraie carte graphique**

Même parcours dans le Chrome de Windows (servi en `http://localhost`, profil dédié), à 2, 5 et 10 km de large : relever `r.duree` et `r.dureeSurface` au dernier recalcul (le statut les affiche), et le moteur.
Expected: moteur `gpu` ; noter les temps pour CLAUDE.md.

- [ ] **Step 6: Commit**

```bash
git add src/flux-calque.js src/app.js
git commit -m "Flux : le relief de la vue calculé et posé sur la carte, derrière ?flux"
```

---

### Task 7: Au-delà du seuil, le MNT de l'IGN

Mesuré avant d'écrire (26 septembre 2026) : le WMS `IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93` rend en `image/x-bil;bits=32` des flottants **petit-boutistes**, ligne 0 au **nord**, `-9999` hors couverture ; CORS ouvert.

**Files:**
- Create: `src/mnt-ign.js`, `test/mnt-ign.test.js`
- Modify: `index.html` (après `ign.js`), `src/app.js` (bloc `?flux`)

**Interfaces:**
- Consumes: `VUE_GRILLE.definir`, `RESEAU.recuperer(url, { signal, file: 'tuiles' }) → ArrayBuffer`.
- Produces:
  - `MNT_IGN.url(geo) → string` — GetMap WMS 1.3.0, `CRS=EPSG:2154`, `BBOX=xmin,ymin,xmax,ymax`, `WIDTH=W`, `HEIGHT=H`.
  - `MNT_IGN.lire(octets:ArrayBuffer, geo) → t` — `{ W, H, N, pas, mnt, valide, hauteur, trou, emprise, origine }`, lignes ramenées au sud d'abord, sans donnée = invalide (altitude de repli : moyenne des valides), `hauteur` à 0, `trou` à 0.
  - `MNT_IGN.charger(geo, recuperer, signal) → Promise<t>`.

- [ ] **Step 1: Écrire les tests**

`test/mnt-ign.test.js` :

```js
// MNT de l'IGN en WMS : adresse de la requête et lecture de l'image BIL.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { MNT_IGN, VUE_GRILLE } = chargerScripts(['config.js', 'vue-grille.js', 'mnt-ign.js']);

const geo = VUE_GRILLE.definir({ xmin: 877000, xmax: 877002, ymin: 6904000, ymax: 6904001.5 }, 0.5, 0, 5010);

test('adresse : Lambert-93, emprise et taille de la grille', () => {
  const u = new URL(MNT_IGN.url(geo));
  assert.equal(u.searchParams.get('CRS'), 'EPSG:2154');
  assert.equal(u.searchParams.get('BBOX'), `${geo.emprise.xmin},${geo.emprise.ymin},${geo.emprise.xmax},${geo.emprise.ymax}`);
  assert.equal(u.searchParams.get('WIDTH'), String(geo.W));
  assert.equal(u.searchParams.get('HEIGHT'), String(geo.H));
  assert.equal(u.searchParams.get('FORMAT'), 'image/x-bil;bits=32');
});

test('lecture : petit-boutiste, ligne 0 au nord ramenée au sud, -9999 invalide', () => {
  const { W, H } = geo;   // 4 × 3
  const dv = new DataView(new ArrayBuffer(W * H * 4));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dv.setFloat32((y * W + x) * 4, 300 + y * 10 + x, true);
  dv.setFloat32(0, -9999, true);   // coin nord-ouest sans donnée
  const t = MNT_IGN.lire(dv.buffer, geo);
  assert.equal(t.W, W);
  assert.equal(t.mnt[0], 300 + (H - 1) * 10);   // ligne sud = dernière ligne de l'image
  const no = (H - 1) * W;                      // coin nord-ouest de la grille
  assert.equal(t.valide[no], 0);
  assert.ok(Number.isFinite(t.mnt[no]));
  assert.equal(t.valide[no + 1], 1);
  assert.equal(t.mnt[no + 1], 301);
  assert.equal(t.hauteur.length, W * H);
});

test('lecture : taille inattendue, erreur explicite', () => {
  assert.throws(() => MNT_IGN.lire(new ArrayBuffer(8), geo), /MNT/);
});
```

- [ ] **Step 2: Les lancer, ils échouent**

Run: `node --test test/mnt-ign.test.js`
Expected: FAIL — `mnt-ign.js` introuvable.

- [ ] **Step 3: Écrire le module**

`src/mnt-ign.js` :

```js
// Le MNT LiDAR HD de l'IGN, en WMS, pour les vues trop larges pour les points.
//
// Au-delà de CONFIG.flux.surfaceMaxPointsKm2, les points coûteraient une
// requête par dalle pour un niveau 0 trop grossier : le MNT de l'IGN, calculé
// par eux depuis les mêmes points, natif à 50 cm, arrive en une image à la
// taille demandée. Mesuré : 1 km² en ~6 s, une sous-zone de 500 m en moins
// d'une seconde, CORS ouvert. Flottants petit-boutistes, ligne 0 au nord,
// -9999 hors couverture — vérifié sur une vraie réponse.

const MNT_IGN = (() => {
  const COUCHE = 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93';
  const SANS_DONNEE = -9000;   // tout ce qui est en dessous

  function url(geo) {
    const e = geo.emprise;
    const p = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', LAYERS: COUCHE, STYLES: '',
      CRS: 'EPSG:2154', FORMAT: 'image/x-bil;bits=32',
      WIDTH: String(geo.W), HEIGHT: String(geo.H),
      BBOX: `${e.xmin},${e.ymin},${e.xmax},${e.ymax}`,
    });
    return `https://data.geopf.fr/wms-r/wms?${p}`;
  }

  function lire(octets, geo) {
    const { W, H } = geo;
    const N = W * H;
    if (octets.byteLength !== N * 4) {
      throw new Error(`MNT de l'IGN : ${octets.byteLength} octets reçus, ${N * 4} attendus`);
    }
    const dv = new DataView(octets);
    const mnt = new Float32Array(N), valide = new Uint8Array(N);
    let somme = 0, nb = 0;
    for (let y = 0; y < H; y++) {
      const ligne = (H - 1 - y) * W;   // l'image commence au nord
      for (let x = 0; x < W; x++) {
        const v = dv.getFloat32((ligne + x) * 4, true);
        const i = y * W + x;
        if (v > SANS_DONNEE) { mnt[i] = v; valide[i] = 1; somme += v; nb++; }
      }
    }
    // Même convention que RELIEF.preparer : une altitude de repli là où rien
    // n'est connu, la validité disant qu'il ne faut pas y croire.
    const repli = nb ? somme / nb : 0;
    for (let i = 0; i < N; i++) if (!valide[i]) mnt[i] = repli;
    return {
      W, H, N, pas: geo.pas, mnt, valide, hauteur: new Float32Array(N), trou: new Float32Array(N),
      emprise: geo.emprise, origine: [geo.emprise.xmin, geo.emprise.ymin, 0],
    };
  }

  async function charger(geo, recuperer, signal) {
    return lire(await recuperer(url(geo), { signal, file: 'tuiles' }), geo);
  }

  return { url, lire, charger };
})();
```

Dans `index.html`, après `<script src="src/ign.js"></script>` : `<script src="src/mnt-ign.js"></script>`.

- [ ] **Step 4: Lancer les tests**

Run: `node --test test/mnt-ign.test.js test/sources.test.js 2>&1 | tail -5`
Expected: PASS, tous.

- [ ] **Step 5: Le brancher au-delà du seuil**

Dans le bloc `?flux` de `src/app.js`, remplacer la première branche de `calculerRelief` (vue trop large) par un calcul sur le MNT, abandonné si la vue change :

```js
  let ctrlMnt = null;
  const reliefDuMnt = async () => {
    ctrlMnt?.abort();
    const ctrl = ctrlMnt = new AbortController();
    const pas = Math.max(0.5, FLUX_CHOIX.pasPourVue(vueCourante.xmax - vueCourante.xmin, vueCourante.largeurPx, 0.5));
    const geo = VUE_GRILLE.definir(vueCourante, pas, 0, CONFIG.flux.pixelsMaxMnt);
    texteRelief = 'MNT de l’IGN…';
    majStatut();
    try {
      const t0 = performance.now();
      const t = await MNT_IGN.charger(geo, RESEAU.recuperer, ctrl.signal);
      if (ctrl.signal.aborted) return;
      const c = RELIEF.calculer(t, coucheFlux);
      reliefCalque.afficher({ ...c, geo });
      texteRelief = `relief du MNT de l’IGN, ${((performance.now() - t0) / 1000).toFixed(1)} s · ${geo.W}×${geo.H} cases de ${geo.pas.toFixed(1)} m`;
    } catch (err) {
      if (ctrl.signal.aborted) return;
      reliefCalque.vider();
      texteRelief = `MNT de l’IGN : ${RESEAU.expliquer(err)}`;
    }
    majStatut();
  };
```

et dans `calculerRelief` :

```js
    if (!vueCourante) return;
    if (FLUX_CHOIX.surfaceKm2(vueCourante) > CONFIG.flux.surfaceMaxPointsKm2) { reliefDuMnt(); return; }
    ctrlMnt?.abort();
```


- [ ] **Step 6: Parcours réel**

Harnais de la tâche 6 à `#map=12/49.2066/5.4359` (vue d'environ 40 km) : attendre, cliché, erreurs de console.
Expected: le statut dit « relief du MNT de l’IGN » avec sa durée ; le cliché montre le relief de toute la vue ; aucune requête de points (`fluxDeControle` : 0 dalle ouverte).

- [ ] **Step 7: Suite et commit**

Run: `npm test 2>&1 | tail -5`
Expected: `# fail 0`.

```bash
git add src/mnt-ign.js test/mnt-ign.test.js index.html src/app.js
git commit -m "Flux : au-delà du seuil, le relief du MNT de l'IGN en WMS"
```

---

### Task 8: Documenter

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Écrire la section**

Après « Le chargement piloté par la vue », une section « Le calcul de la vue » : la grille en centimètres entiers et pourquoi (division entière identique des deux côtés, alignement sur le pas) ; l'accumulation par tampon de profondeur sans `EXT_float_blend` (six passes, `RGBA8` et `RGBA16F`, hauteurs relatives au minimum) ; la surface rapatriée une fois puis `RELIEF.calculer` inchangé, et pourquoi (quelques millisecondes à la taille d'un écran ; le plan 3 dira s'il faut s'en passer) ; l'autocontrôle et ce qu'il mêle ; `garderRepli` ; le repli processeur et son budget ; le MNT de l'IGN au-delà du seuil, avec les faits mesurés du format ; les temps mesurés aux tâches 5, 6 et 7. Mettre à jour le tableau « État ».

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md : le calcul de la vue"
```

---

## Hors de ce plan (plan 3)

- Calque WebGL redessiné à chaque image, maillage Lambert-93 → écran, contexte unique partagé avec le calque ; plus de rapatriement de la surface si la mesure le justifie.
- Bouche-trou flouté et fondu à l'arrivée des points (texture de couverture) ; décalage de la grille au déplacement plutôt que recalcul complet.
- Perte du contexte graphique : blocs relus depuis le disque.
- Fusion Carte + 2D, rideau, classes du sol dans le panneau, mesure, 3D masquée.
