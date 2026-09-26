# Relief piloté par la vue — plan 1 : le chargement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charger, pour la vue affichée sur la carte, les points LiDAR des dalles visibles — une requête « fin de fichier » par dalle (index + niveau 0), puis les blocs plus fins que le zoom demande — et les livrer décompressés en centimètres entiers, sous un budget de points, avec un cache disque.

**Architecture:** Quatre modules à responsabilité unique, scripts classiques exposant un global : `COPC` gagne la lecture de l'index par la fin du fichier ; `FLUX_CHOIX` (pur) décide quels blocs la vue demande et lesquels libérer ; `CACHE_DISQUE` garde les octets compressés sous quota (IndexedDB) ; `FLUX` orchestre (WFS, ouverture des dalles, téléchargement groupé, décompression, budget) et émet des blocs décodés. Un calque de contrôle provisoire, activé par `?flux`, dessine sur la carte les blocs chargés : c'est le livrable visible de ce plan. Le calcul du relief (plan 2) et l'interface (plan 3) consommeront les blocs émis.

**Tech Stack:** JavaScript en scripts classiques (aucun module ES, aucune étape de construction), Leaflet, laz-perf en WebAssembly dans des Workers, IndexedDB, tests `node --test` avec les sources chargées dans un contexte `vm` (`test/charger.js`).

**Spec:** `docs/superpowers/specs/2026-09-26-flux-vue-design.md` (section « 1. Le chargement »).

## Global Constraints

- Ouverture par double-clic en `file://` : scripts classiques exposant un global, **aucun `import`**, aucun CDN, aucune étape de construction. Un `const` de premier niveau est visible des scripts suivants mais n'est pas une propriété de `window`.
- Tout nouveau fichier de `src/` est chargé par `index.html` (le test `test/sources.test.js` l'exige), `config.js` en premier, `app.js` en dernier.
- Commentaires et messages en français, dans le style du dépôt : on explique **pourquoi**, mesures à l'appui.
- API de téléchargement de l'IGN : 10 requêtes/s par IP ; tout passe par `RESEAU.recuperer` (file `defaut`, 3 en vol, réessais).
- `CONFIG.flux` : `largeurMaxPointsM: 10000`, `pasMinM: 0.5`, `pointsParCase: 4`, `budgetPoints: 20_000_000`, `budgetPointsMobile: 5_000_000`, `quotaDisqueOctets: 1_500_000_000`, `octetsFin: 1_000_000`, `octetsFinSecours: 4_000_000`.
- Échelle des fichiers IGN 0,01, décalage 0 : les centimètres entiers se déduisent sans perte. Longueur de point **par lot** (30 octets, 46 pour le lot d'avril 2026).
- Emprise d'un bloc `n-x-y` : `c = 1000 / 2ⁿ`, `[xmin + x·c, xmin + (x+1)·c] × [ymin + y·c, ymin + (y+1)·c]`, `xmin`/`ymin` de la dalle.
- Ordre des blocs : niveau croissant, puis distance au centre de la vue ; tronqué au budget de points.

## Review Focus

- **Vue qui bouge pendant un chargement** : les requêtes des dalles et blocs sortis de la vue doivent être abandonnées (signal `aborted`), sans erreur affichée ni bloc émis après coup — test dans la tâche 6.
- **Index plus gros que le dernier Mo** (dalle très dense, index > 1 Mo, ou sous-pages) : relecture avec `octetsFinSecours`, puis sous-pages suivies ; jamais une dalle silencieusement vide — tests dans les tâches 1 et 6.
- **Navigation privée / IndexedDB refusé** : le cache doit se taire et laisser le réseau servir, sans exception — test dans la tâche 5.
- **Budget atteint** : aucun va-et-vient libérer/redemander du même bloc ; les blocs au-delà du budget ne sont pas demandés — tests dans les tâches 4 et 6.
- **Hypothèse du cube = la dalle** : si elle est fausse, les blocs seraient placés au mauvais endroit sans erreur — vérifiée sur données réelles dans la tâche 7.

---

## Fichiers

- Modifier `src/config.js` — section `flux`.
- Modifier `src/copc.js` — `lireEntrees`, `lireFin`, `lireEnteteLot`, `lotDepuisUrl`, `grouperPlages` (déplacé depuis `nuage.js`).
- Modifier `src/nuage.js` — utilise `COPC.grouperPlages` ; expose `NUAGE.decoder`.
- Modifier `src/reseau.js` — option `fin` (plage de fin de fichier) avec la taille totale.
- Modifier `src/decodeur.js` — sortie en centimètres entiers (`entiers`), transfert de tous les tableaux.
- Créer `src/flux-choix.js` — `FLUX_CHOIX`, décisions pures.
- Créer `src/cache-disque.js` — `CACHE_DISQUE`, LRU sous quota, stockages mémoire et IndexedDB.
- Créer `src/flux.js` — `FLUX`, l'orchestrateur.
- Créer `src/flux-calque.js` — `CalqueFlux`, calque Leaflet de contrôle.
- Modifier `src/app.js` — branche le flux et le calque derrière `?flux`.
- Modifier `index.html` — charge les quatre nouveaux scripts.
- Créer `test/copc-fin.js` (utilitaire de test), `test/copc.test.js`, `test/decodeur.test.js`, `test/flux-choix.test.js`, `test/cache-disque.test.js`, `test/flux.test.js` ; modifier `test/reseau.test.js`, `test/nuage.test.js` si besoin.
- Modifier `CLAUDE.md` — section « Le chargement piloté par la vue ».

---

### Task 1: Lire l'index par la fin du fichier

**Files:**
- Modify: `src/config.js` (section `flux` après `nuage`)
- Modify: `src/copc.js` (`lireHierarchie`, fin du fichier)
- Modify: `src/nuage.js` (`grouperPlages` déplacé)
- Create: `test/copc-fin.js`, `test/copc.test.js`

**Interfaces:**
- Produces:
  - `COPC.lireEntrees(octets: Uint8Array) → { noeuds: Map<string, {cle:{n,x,y,z}, offset:number, taille:number, nbPoints:number}>, sousPages: Array<[offset:number, taille:number]> }` — clés `"n-x-y-z"`, nœuds vides ignorés.
  - `COPC.lireFin(octets: Uint8Array, debutMorceau: number) → null | { noeuds, sousPages }` — `debutMorceau` = position de `octets[0]` dans le fichier (non utilisé pour le calcul des offsets, qui sont absolus dans l'index, mais gardé pour l'appelant).
  - `COPC.lireEnteteLot(octets: Uint8Array) → { formatPoint:number, longueurPoint:number, echelle:[number,number,number], decalage:[number,number,number] }` — lève si pas `LASF`.
  - `COPC.lotDepuisUrl(url: string) → string` — segment parent du fichier.
  - `COPC.grouperPlages(noeuds, tolerance = 1 << 20, tailleMax = 8 << 20) → Array<{debut, fin, noeuds}>` — même comportement qu'avant dans `nuage.js`.
  - `CONFIG.flux` (voir Global Constraints).
  - Test helper `fabriquerFin({ entrees, avant = 64, apres = 830, leurre = false }) → Uint8Array` et `fabriquerEntete({ longueurPoint = 30 }) → Uint8Array` dans `test/copc-fin.js`.

- [ ] **Step 1: Ajouter la configuration**

Dans `src/config.js`, juste après la fermeture de la section `nuage: { … },` :

```js
  // ── Chargement piloté par la vue (flux.js) ────────────────────────────────
  //
  // Voir « Le chargement piloté par la vue » dans CLAUDE.md et la spec
  // docs/superpowers/specs/2026-09-26-flux-vue-design.md.
  flux: {
    // Au-delà de cette largeur de vue, aucun point n'est demandé : le niveau 0
    // de chaque dalle est un plancher (~0,6 Mo, une requête), et le temps croît
    // alors avec le nombre de dalles, plus avec l'écran. Mesuré : ~60 dalles
    // pour 10 km, ~13 s au quota de l'IGN.
    largeurMaxPointsM: 10000,
    // Plancher du pas de la grille, en mètres : jamais plus fin, quel que soit
    // le zoom. La densité de points sol (2 à 12 par m²) ne justifie pas mieux
    // tant qu'une mesure ne l'a pas montré.
    pasMinM: 0.5,
    // Points (toutes classes) visés par case de grille pour choisir le niveau :
    // environ un point sol par case sur un sol à 25 %.
    pointsParCase: 4,
    // Points décompressés gardés à la fois. Sur appareil portatif, le navigateur
    // ferme un onglet trop gourmand sans prévenir.
    budgetPoints: 20_000_000,
    budgetPointsMobile: 5_000_000,
    // Octets compressés gardés sur le disque (IndexedDB), les moins récemment
    // lus effacés d'abord.
    quotaDisqueOctets: 1_500_000_000,
    // Fin de fichier lue d'une requête : l'index et le niveau 0 y tiennent
    // (0,86 Mo au plus sur 12 dalles mesurées). Le secours couvre un index
    // exceptionnellement gros.
    octetsFin: 1_000_000,
    octetsFinSecours: 4_000_000,
  },
```

- [ ] **Step 2: Écrire l'utilitaire de test qui fabrique une fin de fichier**

Créer `test/copc-fin.js` :

```js
// Fabrique les derniers octets d'un fichier COPC tel que l'IGN les range :
// des données, l'en-tête d'EVLR « copc » / 1000 (60 octets), les entrées de
// hiérarchie (32 octets chacune), puis un dernier EVLR (~830 octets, la
// projection). Sert aux tests de lecture sans en-tête ; aucun fichier binaire
// n'est versionné.

export function fabriquerFin({ entrees, avant = 64, apres = 830, leurre = false }) {
  const tailleIndex = entrees.length * 32;
  const o = new Uint8Array(avant + 60 + tailleIndex + apres);
  const dv = new DataView(o.buffer);
  if (leurre) {
    // « copc » dans les données, avec un autre identifiant d'enregistrement :
    // ne doit pas être pris pour l'index.
    o.set([0x63, 0x6f, 0x70, 0x63, 0], 2);
    dv.setUint16(18, 1, true);
  }
  let p = avant;
  o.set([0x63, 0x6f, 0x70, 0x63], p + 2);
  dv.setUint16(p + 18, 1000, true);
  dv.setBigUint64(p + 20, BigInt(tailleIndex), true);
  p += 60;
  for (const e of entrees) {
    dv.setInt32(p, e.n, true);
    dv.setInt32(p + 4, e.x ?? 0, true);
    dv.setInt32(p + 8, e.y ?? 0, true);
    dv.setInt32(p + 12, e.z ?? 0, true);
    dv.setBigUint64(p + 16, BigInt(e.offset), true);
    dv.setInt32(p + 24, e.taille, true);
    dv.setInt32(p + 28, e.nbPoints, true);
    p += 32;
  }
  return o;
}

/** Premiers 256 octets d'un fichier LAS 1.4, format 6. */
export function fabriquerEntete({ longueurPoint = 30 } = {}) {
  const o = new Uint8Array(256);
  const dv = new DataView(o.buffer);
  o.set([0x4c, 0x41, 0x53, 0x46], 0);            // « LASF »
  dv.setUint8(24, 1); dv.setUint8(25, 4);        // LAS 1.4
  dv.setUint8(104, 6 | 0x80);                    // format 6, compressé
  dv.setUint16(105, longueurPoint, true);
  for (let k = 0; k < 3; k++) dv.setFloat64(131 + 8 * k, 0.01, true);
  for (let k = 0; k < 3; k++) dv.setFloat64(155 + 8 * k, 0, true);
  return o;
}
```

- [ ] **Step 3: Écrire les tests qui échouent**

Créer `test/copc.test.js` :

```js
// Lecture d'un COPC par la fin, sans l'en-tête — la requête unique par dalle
// du chargement piloté par la vue. Mesuré sur 12 dalles de toute la France :
// l'index et le niveau 0 tiennent dans le dernier Mo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';
import { fabriquerFin, fabriquerEntete } from './copc-fin.js';

const { COPC } = chargerScripts(['config.js', 'copc.js']);

test('lireFin retrouve l’index et ses nœuds, offsets absolus', () => {
  const octets = fabriquerFin({ entrees: [
    { n: 0, offset: 212_310_000, taille: 608_510, nbPoints: 58_881 },
    { n: 1, x: 1, y: 0, offset: 205_500_000, taille: 1_300_000, nbPoints: 216_000 },
  ] });
  const r = COPC.lireFin(octets, 212_000_000);
  assert.ok(r);
  assert.equal(r.noeuds.size, 2);
  assert.deepEqual({ ...r.noeuds.get('0-0-0-0') }, { cle: r.noeuds.get('0-0-0-0').cle, offset: 212_310_000, taille: 608_510, nbPoints: 58_881 });
  assert.equal(r.noeuds.get('1-1-0-0').cle.x, 1);
  assert.equal(r.sousPages.length, 0);
});

test('lireFin ignore un « copc » qui n’est pas l’index', () => {
  const octets = fabriquerFin({ entrees: [{ n: 0, offset: 10, taille: 5, nbPoints: 3 }], avant: 200, leurre: true });
  const r = COPC.lireFin(octets, 0);
  assert.equal(r.noeuds.size, 1);
});

test('lireFin signale les sous-pages et saute les nœuds vides', () => {
  const octets = fabriquerFin({ entrees: [
    { n: 0, offset: 100, taille: 50, nbPoints: 10 },
    { n: 1, offset: 900_000, taille: 4096, nbPoints: -1 },
    { n: 1, x: 1, offset: 150, taille: 0, nbPoints: 0 },
  ] });
  const r = COPC.lireFin(octets, 0);
  assert.equal(r.noeuds.size, 1);
  assert.deepEqual(Array.from(r.sousPages, (p) => [...p]), [[900_000, 4096]]);
});

test('lireFin rend null sans index, ou si l’index est tronqué', () => {
  assert.equal(COPC.lireFin(new Uint8Array(5000), 0), null);
  const complet = fabriquerFin({ entrees: [{ n: 0, offset: 1, taille: 1, nbPoints: 1 }, { n: 1, offset: 2, taille: 1, nbPoints: 1 }], apres: 0 });
  assert.equal(COPC.lireFin(complet.subarray(0, complet.length - 10), 0), null);
});

test('lireEnteteLot lit format, longueur, échelle et décalage', () => {
  const e = COPC.lireEnteteLot(fabriquerEntete({ longueurPoint: 46 }));
  assert.equal(e.formatPoint, 6);
  assert.equal(e.longueurPoint, 46);
  assert.deepEqual([...e.echelle], [0.01, 0.01, 0.01]);
  assert.deepEqual([...e.decalage], [0, 0, 0]);
  assert.throws(() => COPC.lireEnteteLot(new Uint8Array(256)), /LAS/);
});

test('lotDepuisUrl rend le dossier de publication', () => {
  assert.equal(COPC.lotDepuisUrl('https://data.geopf.fr/telechargement/download/LiDARHD-NUALID/NUALHD_1-0__LAZ_LAMB93_OD_2026-04-29/LHD_FXX_0877_6904_PTS_LAMB93_IGN69.copc.laz'),
    'NUALHD_1-0__LAZ_LAMB93_OD_2026-04-29');
});

test('grouperPlages fusionne les nœuds contigus et coupe à tailleMax', () => {
  const noeuds = [{ offset: 0, taille: 10 }, { offset: 10, taille: 10 }, { offset: 5_000_000, taille: 10 }];
  const p = COPC.grouperPlages(noeuds, 0, 1 << 20);
  assert.equal(p.length, 2);
  assert.deepEqual([p[0].debut, p[0].fin, p[0].noeuds.length], [0, 20, 2]);
});
```

- [ ] **Step 4: Lancer les tests, constater l'échec**

Run: `node --test test/copc.test.js`
Expected: FAIL — `COPC.lireFin is not a function`.

- [ ] **Step 5: Implémenter dans `src/copc.js`**

En tête du fichier, sous `const TAILLE_ENTREE_HIER = 32;`, ajouter :

```js
const TAILLE_ENTETE_EVLR = 60;
```

Remplacer, dans `lireHierarchie`, la boucle sur les entrées :

```js
    for (let p = 0; p + TAILLE_ENTREE_HIER <= buf.length; p += TAILLE_ENTREE_HIER) {
      …
      noeuds.set(`${cle.n}-${cle.x}-${cle.y}-${cle.z}`, { cle, offset: dOffset, taille: dTaille, nbPoints });
    }
```

par :

```js
    const lu = lireEntrees(buf);
    for (const [k, v] of lu.noeuds) noeuds.set(k, v);
    aVisiter.push(...lu.sousPages);
```

(et supprimer la ligne `const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);` devenue inutile dans cette boucle).

Puis, avant `const COPC = …`, ajouter :

```js
/**
 * Entrées de hiérarchie (32 octets chacune) : les nœuds, et les renvois vers
 * d'autres pages (`nbPoints = -1`). Un nœud vide est présent dans l'index
 * sans données : ignoré.
 */
function lireEntrees(octets) {
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  const noeuds = new Map();
  const sousPages = [];
  for (let p = 0; p + TAILLE_ENTREE_HIER <= octets.length; p += TAILLE_ENTREE_HIER) {
    const cle = {
      n: dv.getInt32(p, true),
      x: dv.getInt32(p + 4, true),
      y: dv.getInt32(p + 8, true),
      z: dv.getInt32(p + 12, true),
    };
    const offset = Number(dv.getBigUint64(p + 16, true));
    const taille = dv.getInt32(p + 24, true);
    const nbPoints = dv.getInt32(p + 28, true);
    if (nbPoints < 0) { sousPages.push([offset, taille]); continue; }
    if (nbPoints === 0) continue;
    noeuds.set(`${cle.n}-${cle.x}-${cle.y}-${cle.z}`, { cle, offset, taille, nbPoints });
  }
  return { noeuds, sousPages };
}

/**
 * L'index d'un COPC lu dans ses derniers octets, sans l'en-tête.
 *
 * L'IGN range ses fichiers du plus fin au plus grossier : le niveau 0, puis
 * l'index (un EVLR « copc » / 1000), puis ~830 octets de projection. Une
 * requête `Range: bytes=-1000000` ramène donc l'index **et** le niveau 0 —
 * mesuré sur 12 dalles de toute la France. Sans l'en-tête, on ne sait pas où
 * commence l'EVLR : on cherche son en-tête de 60 octets en remontant depuis la
 * fin. Le nom « copc » peut apparaître dans les données compressées ; seul un
 * enregistrement 1000 dont la longueur tient dans le morceau est retenu.
 *
 * @param {Uint8Array} octets fin du fichier
 * @param {number} debutMorceau position de `octets[0]` dans le fichier
 * @returns {?{noeuds: Map, sousPages: Array<[number, number]>}} `null` si
 *   l'index n'est pas entièrement dans le morceau
 */
function lireFin(octets, debutMorceau) {
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  for (let p = octets.length - TAILLE_ENTETE_EVLR; p >= 0; p--) {
    if (octets[p + 2] !== 0x63 || octets[p + 3] !== 0x6f || octets[p + 4] !== 0x70
        || octets[p + 5] !== 0x63 || octets[p + 6] !== 0) continue;
    if (dv.getUint16(p + 18, true) !== 1000) continue;
    const longueur = Number(dv.getBigUint64(p + 20, true));
    const debut = p + TAILLE_ENTETE_EVLR;
    if (debut + longueur > octets.length) return null;
    return lireEntrees(octets.subarray(debut, debut + longueur));
  }
  return null;
}

/**
 * Ce qu'il faut de l'en-tête pour décompresser : format et longueur de point,
 * échelle et décalage. La longueur varie **par lot de publication** de l'IGN
 * (30 octets, 46 pour le lot d'avril 2026, qui ajoute des champs) : on lit
 * 256 octets une fois par lot, pas par dalle.
 */
function lireEnteteLot(octets) {
  if (String.fromCharCode(octets[0], octets[1], octets[2], octets[3]) !== 'LASF') {
    throw new Error("En-tête LAS absent — le fichier n'est pas un LAS/LAZ");
  }
  const dv = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
  return {
    formatPoint: dv.getUint8(104) & 0x7f,
    longueurPoint: dv.getUint16(105, true),
    echelle: [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)],
    decalage: [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)],
  };
}

/** Lot de publication : le dossier qui contient le fichier. */
function lotDepuisUrl(url) {
  const parties = url.split('?')[0].split('/');
  return parties[parties.length - 2] || '';
}
```

Déplacer la fonction `grouperPlages` (avec son commentaire) de `src/nuage.js` vers `src/copc.js`, juste avant `const COPC = …`, sans en changer le corps. Dans `src/nuage.js`, remplacer l'appel `const plages = grouperPlages(noeuds);` par `const plages = COPC.grouperPlages(noeuds);`.

Remplacer la ligne d'export :

```js
const COPC = {
  lireEntete, lireHierarchie, lireEntrees, lireFin, lireEnteteLot, lotDepuisUrl,
  empriseNoeud, espacementNiveau, selectionner, coutParNiveau, grouperPlages,
};
```

- [ ] **Step 6: Lancer tous les tests**

Run: `npm test`
Expected: `test/copc.test.js` passe, mais `test/nuage.test.js` échoue : son faux `COPC` n'a pas `grouperPlages`, que `nuage.js` appelle désormais.

- [ ] **Step 7: Donner la vraie `grouperPlages` au faux `COPC` de `test/nuage.test.js`**

En tête de `test/nuage.test.js`, après les `import`, ajouter :

```js
import { chargerScripts } from './charger.js';

// `grouperPlages` a quitté nuage.js pour copc.js : le faux COPC ci-dessous
// reçoit la vraie, le regroupement des plages faisant partie de ce qu'on
// éprouve (la clé du cache d'octets en dépend).
const { COPC: VRAI_COPC } = chargerScripts(['config.js', 'copc.js']);
```

Puis, dans la fonction `charger()`, juste après le `vm.runInContext` qui définit `var COPC = { empriseNoeud: … };`, ajouter :

```js
  contexte.COPC.grouperPlages = VRAI_COPC.grouperPlages;
```

Run: `npm test`
Expected: PASS, dont les 7 nouveaux de `test/copc.test.js`.

- [ ] **Step 8: Commit**

```bash
git add src/config.js src/copc.js src/nuage.js test/copc-fin.js test/copc.test.js test/nuage.test.js
git commit -m "COPC : lire l'index par la fin du fichier, en-tête lu une fois par lot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Requête « fin de fichier » dans RESEAU

**Files:**
- Modify: `src/reseau.js` (`recuperer`)
- Test: `test/reseau.test.js`

**Interfaces:**
- Produces: `RESEAU.recuperer(url, { fin: n, signal, file })` → `Promise<{ octets: Uint8Array, total: number }>` : envoie `Range: bytes=-n` ; `total` = taille du fichier lue dans `Content-Range` (`bytes a-b/total`) ; si le serveur ignore la plage (pas de `Content-Range`), rend les `n` derniers octets et `total = longueur reçue`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `test/reseau.test.js` :

```js
test('fin de fichier : Range « bytes=-n » et taille totale du fichier', async () => {
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  const vus = [];
  ctx.fetch = async (url, init) => {
    vus.push(init.headers?.Range);
    return {
      ok: true, status: 206,
      headers: new Map([['content-range', 'bytes 212000000-212999999/213000000']]),
      arrayBuffer: async () => new Uint8Array(1_000_000).buffer,
    };
  };
  const r = await ctx.RESEAU.recuperer('https://x/f.copc.laz', { fin: 1_000_000 });
  assert.equal(vus[0], 'bytes=-1000000');
  assert.equal(r.total, 213_000_000);
  assert.equal(r.octets.length, 1_000_000);
});

test('fin de fichier : un serveur qui ignore la plage rend quand même la fin', async () => {
  const ctx = chargerScripts(['config.js', 'reseau.js']);
  const tout = new Uint8Array(5000).map((_, i) => i % 251);
  ctx.fetch = async () => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => tout.buffer });
  const r = await ctx.RESEAU.recuperer('https://x/f', { fin: 1000 });
  assert.equal(r.total, 5000);
  assert.equal(r.octets.length, 1000);
  assert.equal(r.octets[0], tout[4000]);
});
```

- [ ] **Step 2: Constater l'échec**

Run: `node --test test/reseau.test.js`
Expected: FAIL — `vus[0]` vaut `undefined`.

- [ ] **Step 3: Implémenter**

Dans `src/reseau.js`, fonction `recuperer` : compléter la déstructuration et le JSDoc :

```js
 * @param {{plage?:[number,number], fin?:number, signal?:AbortSignal, type?:'buffer'|'json'|'texte', file?:'defaut'|'tuiles'}} opts
 *   `fin` : les `fin` derniers octets du fichier ; la promesse rend alors
 *   `{ octets, total }`, `total` étant la taille du fichier.
 */
function recuperer(url, opts = {}) {
  const { plage, fin, signal, type = 'buffer', file = 'defaut' } = opts;
```

Remplacer la ligne qui construit les en-têtes :

```js
        const entetes = plage ? { Range: `bytes=${plage[0]}-${plage[1]}` }
          : fin ? { Range: `bytes=-${fin}` } : undefined;
```

Juste après `const buf = new Uint8Array(await rep.arrayBuffer());`, avant `if (!plage) return buf;`, insérer :

```js
        // Fin de fichier : la taille totale est dans « Content-Range » (bytes
        // a-b/total). Sans lui, le serveur a ignoré la plage et le fichier
        // entier est là : on n'en garde que la fin demandée.
        if (fin) {
          const m = /\/(\d+)\s*$/.exec(rep.headers.get('content-range') || '');
          if (m) return { octets: buf, total: Number(m[1]) };
          return { octets: buf.length > fin ? buf.subarray(buf.length - fin) : buf, total: buf.length };
        }
```

- [ ] **Step 4: Tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/reseau.js test/reseau.test.js
git commit -m "Réseau : requête de fin de fichier, avec la taille totale

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Décompresser en centimètres entiers

**Files:**
- Modify: `src/decodeur.js` (`decoderBloc`, `corpsDecodeur`)
- Modify: `src/nuage.js` (export `decoder`)
- Create: `test/decodeur.test.js`

**Interfaces:**
- Consumes: la charge `{ type:'decoder', octets:ArrayBuffer, nbPoints, formatPoint, longueurPoint, echelle, decalage, origine }` existante.
- Produces:
  - Champ optionnel de charge `entiers: [ocx, ocy, ocz]` (centimètres entiers). Quand présent, le résultat porte en plus `xc, yc, zc: Int32Array` avec `xc[i] = Math.round((X·sx + ox)·100) − ocx` (idem y, z).
  - `NUAGE.decoder(charge) → Promise<résultat>` : démarre la grappe au besoin, décompresse dans un worker.

- [ ] **Step 1: Test qui échoue**

Créer `test/decodeur.test.js` :

```js
// Décompression d'un bloc : la sortie en centimètres entiers, qui rend
// l'affectation d'un point à une case exacte (sur la carte graphique comme sur
// le processeur). laz-perf est remplacé par un décodeur qui recopie des points
// connus : ce qui s'éprouve ici, c'est la conversion, pas la décompression.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { DECODEUR } = chargerScripts(['decodeur.js']);

function fauxLazPerf(points, longueur = 30) {
  const HEAPU8 = new Uint8Array(1 << 16);
  let libre = 8;
  let k = 0;
  return {
    HEAPU8,
    _malloc(n) { const p = libre; libre += n; return p; },
    _free() {},
    ChunkDecoder: class {
      open() {}
      getPoint(dst) {
        const [X, Y, Z, cls] = points[k++];
        const dv = new DataView(HEAPU8.buffer, dst, longueur);
        dv.setInt32(0, X, true); dv.setInt32(4, Y, true); dv.setInt32(8, Z, true);
        dv.setUint16(12, 100, true); dv.setUint8(14, 0x11); dv.setUint8(16, cls);
      }
      delete() {}
    },
  };
}

const charge = (entiers) => ({
  nbPoints: 3, formatPoint: 6, longueurPoint: 30,
  echelle: [0.01, 0.01, 0.01], decalage: [0, 0, 0], origine: [877500, 6903500, 250], entiers,
});

// Coordonnées brutes (centimètres, échelle 0,01) de trois points de la dalle
// 877_6904, dont un pile sur une limite de case de 25 cm.
const POINTS = [[87_700_025, 690_300_050, 30_012, 2], [87_799_999, 690_399_999, 29_000, 5], [87_750_000, 690_350_000, 31_000, 1]];

test('entiers : centimètres exacts, relatifs à l’origine donnée', () => {
  const r = DECODEUR.decoderBloc(fauxLazPerf(POINTS), new Uint8Array(10), charge([87_700_000, 690_300_000, 0]));
  assert.deepEqual([...r.xc], [25, 99_999, 50_000]);
  assert.deepEqual([...r.yc], [50, 99_999, 50_000]);
  assert.deepEqual([...r.zc], [30_012, 29_000, 31_000]);
  assert.deepEqual([...r.cls], [2, 5, 1]);
});

test('sans entiers : la sortie d’avant, en mètres relatifs à l’origine', () => {
  const r = DECODEUR.decoderBloc(fauxLazPerf(POINTS), new Uint8Array(10), charge(undefined));
  assert.equal(r.xc, undefined);
  assert.ok(Math.abs(r.x[0] - (877000.25 - 877500)) < 1e-3);
});
```

- [ ] **Step 2: Constater l'échec**

Run: `node --test test/decodeur.test.js`
Expected: FAIL — `r.xc` indéfini.

- [ ] **Step 3: Implémenter**

Dans `src/decodeur.js`, `decoderBloc` :

- déstructurer aussi `entiers` : `const { nbPoints, formatPoint, longueurPoint, echelle, decalage, origine, entiers } = p;`
- après la création de `retour`, ajouter :

```js
  // Centimètres entiers, relatifs à `entiers` (en centimètres) : l'échelle de
  // l'IGN est 0,01 et le décalage 0, la conversion est donc exacte, et
  // l'affectation d'un point à une case de grille ne dépend plus d'un arrondi
  // de flottant (0,03 % des cases différaient sinon entre processeur et carte
  // graphique, mesuré).
  const xc = entiers ? new Int32Array(nbPoints) : undefined;
  const yc = entiers ? new Int32Array(nbPoints) : undefined;
  const zc = entiers ? new Int32Array(nbPoints) : undefined;
```

- dans la boucle, après le calcul de `z[i]`, ajouter :

```js
    if (entiers) {
      xc[i] = Math.round((vue.getInt32(0, true) * sx + ox) * 100) - entiers[0];
      yc[i] = Math.round((vue.getInt32(4, true) * sy + oy) * 100) - entiers[1];
      zc[i] = Math.round((vue.getInt32(8, true) * sz + oz) * 100) - entiers[2];
    }
```

- changer le retour : `return { nbPoints, x, y, z, cls, intensite, retour, xc, yc, zc };`

Dans `corpsDecodeur`, remplacer l'envoi du résultat par un transfert de tous les tableaux présents :

```js
      const r = decoderBloc(lazPerf, new Uint8Array(msg.octets), msg);
      const tampons = Object.values(r).filter((v) => ArrayBuffer.isView(v)).map((v) => v.buffer);
      self.postMessage({ type: 'decode', id: msg.id, ...r }, tampons);
```

Dans `src/nuage.js`, avant `const NUAGE = {`, ajouter :

```js
/** Décompresse un bloc dans un worker de la grappe, démarrée au besoin. */
async function decoder(charge) {
  await grappe.demarrer();
  return grappe.decoder(charge);
}
```

et ajouter `decoder,` dans l'objet `NUAGE`.

- [ ] **Step 4: Tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/decodeur.js src/nuage.js test/decodeur.test.js
git commit -m "Décodeur : sortie en centimètres entiers, pour une affectation exacte aux cases

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Choisir les blocs de la vue, et quoi libérer

**Files:**
- Create: `src/flux-choix.js`
- Create: `test/flux-choix.test.js`
- Modify: `index.html` (charger `flux-choix.js` après `copc.js`)

**Interfaces:**
- Consumes: une dalle ouverte `{ url, emprise:{xmin,xmax,ymin,ymax}, index: Map<string, {cle, offset, taille, nbPoints}> }`.
- Produces (`FLUX_CHOIX`, fonctions pures) :
  - `pasPourVue(largeurM, largeurPx, pasMinM) → number`
  - `empriseBloc(empriseDalle, cle) → {xmin,xmax,ymin,ymax}`
  - `niveauVise(dalle, pasM, pointsParCase) → number`
  - `blocsPourVue(dalles, vue, pasM, pointsParCase, budgetPoints) → Array<{ cle:string, url:string, noeud, niveau:number, emprise, distance:number }>` — `cle = url + '#' + clé du nœud`, ordonnés niveau croissant puis distance, tronqués au budget.
  - `aLiberer(charges, voulues:Set<string>, budgetPoints, vue) → string[]` — `charges : Array<{cle, niveau, nbPoints, emprise}>` ; rend les clés à libérer, hors `voulues`, niveau le plus fin puis le plus loin d'abord, jusqu'à repasser sous le budget.

- [ ] **Step 1: Tests qui échouent**

Créer `test/flux-choix.test.js` :

```js
// Décisions du chargement piloté par la vue : quel pas, quel niveau, quels
// blocs, dans quel ordre, et quoi libérer. Fonctions pures.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { FLUX_CHOIX } = chargerScripts(['config.js', 'flux-choix.js']);

/** Dalle d'1 km² : niveau 0 (60 000 points), niveau 1 en 4 blocs, niveau 2 en 16. */
function dalle(xkm, ykm) {
  const index = new Map();
  index.set('0-0-0-0', { cle: { n: 0, x: 0, y: 0, z: 0 }, offset: 900, taille: 9, nbPoints: 60_000 });
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) index.set(`1-${x}-${y}-0`, { cle: { n: 1, x, y, z: 0 }, offset: 500 + x * 2 + y, taille: 1, nbPoints: 225_000 });
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) index.set(`2-${x}-${y}-0`, { cle: { n: 2, x, y, z: 0 }, offset: 100 + x * 4 + y, taille: 1, nbPoints: 230_000 });
  return { url: `u${xkm}_${ykm}`, emprise: { xmin: xkm * 1000, xmax: xkm * 1000 + 1000, ymin: ykm * 1000, ymax: ykm * 1000 + 1000 }, index };
}

test('le pas suit le pixel, jamais sous le plancher', () => {
  assert.equal(FLUX_CHOIX.pasPourVue(1400, 1400, 0.5), 1);
  assert.equal(FLUX_CHOIX.pasPourVue(100, 1400, 0.5), 0.5);
});

test('emprise d’un bloc : la dalle découpée en 2ⁿ', () => {
  const e = FLUX_CHOIX.empriseBloc({ xmin: 877000, ymin: 6903000 }, { n: 2, x: 3, y: 1 });
  assert.deepEqual({ ...e }, { xmin: 877750, xmax: 878000, ymin: 6903250, ymax: 6903500 });
});

test('niveau visé : le plus grossier qui atteint la densité voulue', () => {
  const d = { ...dalle(0, 0), surfaceM2: 1e6 };
  // 4 points par case de 4 m → 0,25 pt/m² : niveau 1 (0,96 pt/m² cumulés) suffit, pas le 0 (0,06).
  assert.equal(FLUX_CHOIX.niveauVise(d, 4, 4), 1);
  // Case de 1 m : 4 pts/m² demandés, le niveau 2 cumule 4,64 → 2.
  assert.equal(FLUX_CHOIX.niveauVise(d, 1, 4), 2);
  // Case de 0,5 m : jamais atteint, on prend le plus fin disponible.
  assert.equal(FLUX_CHOIX.niveauVise(d, 0.5, 4), 2);
});

test('blocs de la vue : niveau croissant, puis du centre vers les bords', () => {
  const dalles = [dalle(0, 0), dalle(1, 0)];
  const vue = { xmin: 500, xmax: 1500, ymin: 0, ymax: 1000 };
  const b = FLUX_CHOIX.blocsPourVue(dalles, vue, 4, 4, Infinity);
  const niveaux = b.map((x) => x.niveau);
  assert.deepEqual(niveaux, [...niveaux].sort((p, q) => p - q), 'niveaux croissants');
  // Aucun bloc hors de la vue (les blocs x=0 de la dalle 0, à gauche de 500 m).
  assert.ok(b.every((x) => x.emprise.xmax > vue.xmin && x.emprise.xmin < vue.xmax));
  // Au sein du niveau 1, le premier est le plus proche du centre (1000, 500).
  const n1 = b.filter((x) => x.niveau === 1);
  assert.ok(n1[0].distance <= n1[n1.length - 1].distance);
  assert.ok(b.every((x) => x.cle.startsWith(x.url + '#')));
});

test('blocs de la vue : tronqués au budget de points', () => {
  // 200 000 points : le niveau 0 (60 000) passe, le premier bloc de niveau 1 (225 000 de plus) non.
  const b = FLUX_CHOIX.blocsPourVue([dalle(0, 0)], { xmin: 0, xmax: 1000, ymin: 0, ymax: 1000 }, 4, 4, 200_000);
  assert.deepEqual(b.map((x) => x.niveau), [0]);
});

test('libérer : hors des blocs voulus seulement, le plus fin et le plus loin d’abord', () => {
  const vue = { xmin: 0, xmax: 1000, ymin: 0, ymax: 1000 };
  const e = (x) => ({ xmin: x, xmax: x + 250, ymin: 0, ymax: 250 });
  const charges = [
    { cle: 'a', niveau: 0, nbPoints: 100, emprise: e(0) },
    { cle: 'b', niveau: 2, nbPoints: 100, emprise: e(5000) },
    { cle: 'c', niveau: 2, nbPoints: 100, emprise: e(2000) },
    { cle: 'd', niveau: 1, nbPoints: 100, emprise: e(9000) },
  ];
  assert.deepEqual(FLUX_CHOIX.aLiberer(charges, new Set(['a']), 250, vue), ['b', 'c']);
  assert.deepEqual(FLUX_CHOIX.aLiberer(charges, new Set(['a']), 1000, vue), []);
  assert.deepEqual(FLUX_CHOIX.aLiberer(charges, new Set(['a', 'b', 'c', 'd']), 0, vue), []);
});
```

- [ ] **Step 2: Constater l'échec**

Run: `node --test test/flux-choix.test.js`
Expected: FAIL — fichier `flux-choix.js` absent.

- [ ] **Step 3: Implémenter**

Créer `src/flux-choix.js` :

```js
// Décisions du chargement piloté par la vue : quel pas de grille, quel niveau
// d'octree, quels blocs et dans quel ordre, quoi libérer sous le budget.
//
// Fonctions pures, sans réseau ni DOM : c'est ici que se tranchent les
// questions qui se testent, et `flux.js` n'a plus qu'à exécuter.

const FLUX_CHOIX = (() => {
  /** Pas de grille : un pixel au sol, jamais plus fin que le plancher. */
  function pasPourVue(largeurM, largeurPx, pasMinM) {
    return Math.max(pasMinM, largeurM / Math.max(1, largeurPx));
  }

  /**
   * Emprise d'un bloc, sans l'en-tête du fichier.
   *
   * Le cube de l'octree est dans l'en-tête, qu'on ne lit plus. Sur les 7
   * dalles mesurées, il coïncide avec la dalle (demi-côté 500 m, centré) :
   * au niveau n, la dalle est découpée en 2ⁿ × 2ⁿ carrés de 1000 / 2ⁿ m.
   * Hypothèse vérifiée en navigateur sur données réelles (points décodés
   * contre emprise calculée, voir CLAUDE.md).
   */
  function empriseBloc(empriseDalle, cle) {
    const c = 1000 / 2 ** cle.n;
    const xmin = empriseDalle.xmin + cle.x * c;
    const ymin = empriseDalle.ymin + cle.y * c;
    return { xmin, xmax: xmin + c, ymin, ymax: ymin + c };
  }

  /**
   * Le niveau le plus grossier dont la densité cumulée (points de l'index,
   * toutes classes, rapportés à la surface de la dalle) atteint
   * `pointsParCase` par case de `pasM`. Faute de mieux, le plus fin.
   */
  function niveauVise(dalle, pasM, pointsParCase) {
    const surface = dalle.surfaceM2 ?? 1e6;
    const parNiveau = [];
    for (const n of dalle.index.values()) parNiveau[n.cle.n] = (parNiveau[n.cle.n] || 0) + n.nbPoints;
    const cible = pointsParCase / (pasM * pasM);
    let cumul = 0;
    let plusFin = 0;
    for (let k = 0; k < parNiveau.length; k++) {
      if (!parNiveau[k]) continue;
      cumul += parNiveau[k];
      plusFin = k;
      if (cumul / surface >= cible) return k;
    }
    return plusFin;
  }

  const coupe = (e, v) => e.xmax > v.xmin && e.xmin < v.xmax && e.ymax > v.ymin && e.ymin < v.ymax;

  const distanceAuCentre = (e, v) => Math.hypot(
    (e.xmin + e.xmax) / 2 - (v.xmin + v.xmax) / 2,
    (e.ymin + e.ymax) / 2 - (v.ymin + v.ymax) / 2,
  );

  /**
   * Les blocs qu'appelle la vue : pour chaque dalle, ceux des niveaux jusqu'au
   * niveau visé qui coupent la vue. Ordre : niveau croissant, puis distance au
   * centre — tout l'écran atteint un niveau avant que le suivant ne commence,
   * en partant du centre (l'ordre de Potree : jamais un centre net entouré de
   * bords vides). Tronqués au budget : un bloc au-delà n'est pas demandé, ce
   * qui évite de le libérer puis de le redemander aussitôt.
   */
  function blocsPourVue(dalles, vue, pasM, pointsParCase, budgetPoints) {
    const tous = [];
    for (const d of dalles) {
      const n = niveauVise(d, pasM, pointsParCase);
      for (const [k, noeud] of d.index) {
        if (noeud.cle.n > n) continue;
        const emprise = empriseBloc(d.emprise, noeud.cle);
        if (!coupe(emprise, vue)) continue;
        tous.push({ cle: `${d.url}#${k}`, url: d.url, noeud, niveau: noeud.cle.n, emprise, distance: distanceAuCentre(emprise, vue) });
      }
    }
    tous.sort((a, b) => a.niveau - b.niveau || a.distance - b.distance);
    const retenus = [];
    let points = 0;
    for (const b of tous) {
      if (points + b.noeud.nbPoints > budgetPoints) break;
      points += b.noeud.nbPoints;
      retenus.push(b);
    }
    return retenus;
  }

  /**
   * Ce qu'il faut libérer pour repasser sous le budget : jamais un bloc
   * voulu par la vue ; parmi les autres, le plus fin puis le plus loin
   * d'abord — le grossier coûte peu et resservira au moindre dézoom.
   */
  function aLiberer(charges, voulues, budgetPoints, vue) {
    let total = charges.reduce((s, c) => s + c.nbPoints, 0);
    if (total <= budgetPoints) return [];
    const candidats = charges.filter((c) => !voulues.has(c.cle))
      .sort((a, b) => b.niveau - a.niveau || distanceAuCentre(b.emprise, vue) - distanceAuCentre(a.emprise, vue));
    const out = [];
    for (const c of candidats) {
      if (total <= budgetPoints) break;
      out.push(c.cle);
      total -= c.nbPoints;
    }
    return out;
  }

  return { pasPourVue, empriseBloc, niveauVise, blocsPourVue, aLiberer };
})();
```

Dans `index.html`, ajouter `<script src="src/flux-choix.js"></script>` juste après `<script src="src/copc.js"></script>`.

- [ ] **Step 4: Tests**

Run: `npm test`
Expected: PASS (y compris `test/sources.test.js`, qui vérifie que le nouveau fichier est chargé).

- [ ] **Step 5: Commit**

```bash
git add src/flux-choix.js test/flux-choix.test.js index.html
git commit -m "Flux : choix des blocs de la vue et de ce qu'on libère sous le budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cache disque des octets compressés

**Files:**
- Create: `src/cache-disque.js`
- Create: `test/cache-disque.test.js`
- Modify: `index.html` (après `reseau.js`)

**Interfaces:**
- Produces (`CACHE_DISQUE`) :
  - `creer(stockage, quotaOctets, maintenant = Date.now) → { lire(cle): Promise<?Uint8Array>, ecrire(cle, octets: Uint8Array): Promise<void>, total(): number }` — ne rejette jamais : toute erreur de stockage rend `null` / ne fait rien.
  - `stockageMemoire() → stockage` (tests).
  - `stockageIndexedDB(nom = 'scopus-flux') → stockage`.
  - Contrat d'un `stockage` : `meta(): Promise<Array<[cle, {taille, acces}]>>`, `get(cle): Promise<?Uint8Array>`, `put(cle, octets, meta): Promise`, `putMeta(cle, meta): Promise`, `del(cle): Promise`.

- [ ] **Step 1: Tests qui échouent**

Créer `test/cache-disque.test.js` :

```js
// Cache disque des octets compressés : le moins récemment lu part d'abord,
// sous un quota. Un stockage défaillant (navigation privée) ne doit jamais
// faire échouer un chargement : le cache se tait, le réseau sert.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { CACHE_DISQUE } = chargerScripts(['cache-disque.js']);
const octets = (n, v = 1) => new Uint8Array(n).fill(v);

test('écrit, relit, et survit à une nouvelle instance sur le même stockage', async () => {
  const s = CACHE_DISQUE.stockageMemoire();
  const c = CACHE_DISQUE.creer(s, 1000);
  await c.ecrire('a', octets(10, 7));
  assert.deepEqual([...(await c.lire('a'))], [...octets(10, 7)]);
  const c2 = CACHE_DISQUE.creer(s, 1000);
  assert.equal((await c2.lire('a')).length, 10);
  assert.equal(await c2.lire('absent'), null);
});

test('au-delà du quota, le moins récemment lu part d’abord', async () => {
  let t = 0;
  const c = CACHE_DISQUE.creer(CACHE_DISQUE.stockageMemoire(), 30, () => ++t);
  await c.ecrire('a', octets(10));
  await c.ecrire('b', octets(10));
  await c.ecrire('c', octets(10));
  await c.lire('a');                 // a redevient le plus récent
  await c.ecrire('d', octets(10));   // b, le plus ancien, part
  assert.equal(await c.lire('b'), null);
  assert.ok(await c.lire('a'));
  assert.ok(await c.lire('d'));
  assert.ok(c.total() <= 30);
});

test('un bloc plus gros que le quota n’est pas gardé', async () => {
  const c = CACHE_DISQUE.creer(CACHE_DISQUE.stockageMemoire(), 5);
  await c.ecrire('gros', octets(10));
  assert.equal(await c.lire('gros'), null);
});

test('un stockage qui échoue rend le cache muet, jamais une erreur', async () => {
  const casse = { meta: async () => { throw new Error('IndexedDB refusé'); }, get: async () => { throw new Error('x'); }, put: async () => { throw new Error('x'); }, putMeta: async () => {}, del: async () => {} };
  const c = CACHE_DISQUE.creer(casse, 100);
  await c.ecrire('a', octets(3));
  assert.equal(await c.lire('a'), null);
});
```

- [ ] **Step 2: Constater l'échec**

Run: `node --test test/cache-disque.test.js`
Expected: FAIL — fichier absent.

- [ ] **Step 3: Implémenter**

Créer `src/cache-disque.js` :

```js
// Cache disque des octets compressés des blocs COPC.
//
// Une zone déjà vue ne doit plus coûter de réseau, même le lendemain : le
// débit de l'IGN (~4 dalles/s au niveau 0, ~4 Mo/s au-delà) est la seule
// limite qu'on ne contrôle pas. On garde les octets **compressés** (5 à 10
// octets par point), sous un quota, le moins récemment lu effacé d'abord.
//
// Le cache ne fait jamais échouer un chargement : navigation privée,
// IndexedDB refusé ou quota du navigateur atteint, il se tait et le réseau
// sert tout.

const CACHE_DISQUE = (() => {
  function creer(stockage, quotaOctets, maintenant = Date.now) {
    let meta = null;   // Map<cle, {taille, acces}>
    let total = 0;
    let enPanne = false;

    async function ouvrir() {
      if (meta || enPanne) return;
      try {
        const m = new Map();
        let t = 0;
        for (const [cle, v] of await stockage.meta()) { m.set(cle, v); t += v.taille; }
        meta = m;
        total = t;
      } catch {
        enPanne = true;
      }
    }

    async function lire(cle) {
      await ouvrir();
      if (enPanne || !meta.has(cle)) return null;
      try {
        const o = await stockage.get(cle);
        if (!o) { total -= meta.get(cle).taille; meta.delete(cle); return null; }
        const v = meta.get(cle);
        v.acces = maintenant();
        stockage.putMeta(cle, v).catch(() => {});
        return o;
      } catch {
        return null;
      }
    }

    async function ecrire(cle, octets) {
      await ouvrir();
      if (enPanne || octets.byteLength > quotaOctets || meta.has(cle)) return;
      try {
        const parAge = [...meta.entries()].sort((a, b) => a[1].acces - b[1].acces);
        while (total + octets.byteLength > quotaOctets && parAge.length) {
          const [vieux, v] = parAge.shift();
          await stockage.del(vieux);
          meta.delete(vieux);
          total -= v.taille;
        }
        const v = { taille: octets.byteLength, acces: maintenant() };
        await stockage.put(cle, octets, v);
        meta.set(cle, v);
        total += v.taille;
      } catch {
        // Quota du navigateur, disque plein : on continue sans ce bloc.
      }
    }

    return { lire, ecrire, total: () => total };
  }

  function stockageMemoire() {
    const octets = new Map();
    const metas = new Map();
    return {
      meta: async () => [...metas.entries()].map(([k, v]) => [k, { ...v }]),
      get: async (cle) => octets.get(cle) || null,
      put: async (cle, o, v) => { octets.set(cle, o.slice()); metas.set(cle, { ...v }); },
      putMeta: async (cle, v) => { if (metas.has(cle)) metas.set(cle, { ...v }); },
      del: async (cle) => { octets.delete(cle); metas.delete(cle); },
    };
  }

  function stockageIndexedDB(nom = 'scopus-flux') {
    let base = null;
    const ouvrir = () => base || (base = new Promise((ok, ko) => {
      const r = indexedDB.open(nom, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore('octets');
        r.result.createObjectStore('meta');
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    }));
    const requete = async (magasin, mode, action) => {
      const db = await ouvrir();
      return new Promise((ok, ko) => {
        const tx = db.transaction(magasin, mode);
        const r = action(tx.objectStore(magasin));
        tx.oncomplete = () => ok(r?.result);
        tx.onerror = () => ko(tx.error);
        tx.onabort = () => ko(tx.error);
      });
    };
    return {
      async meta() {
        const db = await ouvrir();
        return new Promise((ok, ko) => {
          const out = [];
          const r = db.transaction('meta', 'readonly').objectStore('meta').openCursor();
          r.onsuccess = () => { const c = r.result; if (!c) { ok(out); return; } out.push([c.key, c.value]); c.continue(); };
          r.onerror = () => ko(r.error);
        });
      },
      get: async (cle) => {
        const v = await requete('octets', 'readonly', (s) => s.get(cle));
        return v ? new Uint8Array(v) : null;
      },
      put: async (cle, o, v) => {
        await requete('octets', 'readwrite', (s) => s.put(o.slice().buffer, cle));
        await requete('meta', 'readwrite', (s) => s.put(v, cle));
      },
      putMeta: (cle, v) => requete('meta', 'readwrite', (s) => s.put(v, cle)),
      del: async (cle) => {
        await requete('octets', 'readwrite', (s) => s.delete(cle));
        await requete('meta', 'readwrite', (s) => s.delete(cle));
      },
    };
  }

  return { creer, stockageMemoire, stockageIndexedDB };
})();
```

Dans `index.html`, ajouter `<script src="src/cache-disque.js"></script>` juste après `<script src="src/reseau.js"></script>`.

- [ ] **Step 4: Tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cache-disque.js test/cache-disque.test.js index.html
git commit -m "Cache disque des octets compressés, sous quota, le moins récemment lu d'abord

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: L'orchestrateur FLUX

**Files:**
- Create: `src/flux.js`
- Create: `test/flux.test.js`
- Modify: `index.html` (après `nuage.js`)

**Interfaces:**
- Consumes: `COPC.lireFin`, `COPC.lireEntrees`, `COPC.lireEnteteLot`, `COPC.lotDepuisUrl`, `COPC.grouperPlages` (tâche 1) ; `RESEAU.recuperer` avec `fin` (tâche 2) ; charge de décodage avec `entiers` (tâche 3) ; `FLUX_CHOIX.*` (tâche 4) ; cache `{lire, ecrire}` (tâche 5).
- Produces:
  - `FLUX.creer(deps) → flux` avec `deps = { chercherDalles(zone) → Promise<Array<{url, emprise, nom}>>, recuperer(url, opts), decoder(charge), cache, config, surBloc(bloc), surLibere(cle), surEtat(etat) }`.
  - `flux.majVue({ xmin, xmax, ymin, ymax, largeurPx })` — rectangle Lambert-93 de la vue et largeur de l'écran en pixels.
  - `flux.attendreCalme() → Promise<void>` — résout quand plus aucune ouverture ni aucun bloc n'est en cours.
  - `flux.arreter()` — abandonne tout.
  - Bloc émis : `{ cle, url, niveau, emprise, origineCm:[xcm, ycm, 0], points: { nbPoints, xc: Int32Array, yc: Int32Array, zc: Int32Array, cls: Uint8Array } }`.
  - État émis : `{ attente: number, charges: number, points: number, dallesOuvertes: number, tropLarge: boolean }`.

- [ ] **Step 1: Tests qui échouent**

Créer `test/flux.test.js` :

```js
// Orchestrateur du chargement piloté par la vue, avec un faux réseau : les
// dalles d'une grille 3 × 3, des fins de fichier fabriquées, un décodeur qui
// rend des points synthétiques. Ce qui s'éprouve : l'ordre, le nombre de
// requêtes, l'abandon, le cache.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';
import { fabriquerFin, fabriquerEntete } from './copc-fin.js';

const ctx = chargerScripts(['config.js', 'copc.js', 'flux-choix.js', 'cache-disque.js', 'flux.js']);
const { FLUX, CACHE_DISQUE, CONFIG } = ctx;

const TAILLE = 200_000_000;            // taille de chaque faux fichier
const LOT = 'NUALHD_1-0__LAZ_LAMB93_XX_2026-01-01';
const url = (x, y) => `https://ign/${LOT}/LHD_FXX_${x}_${y}.copc.laz`;

/** Fin de fichier : niveau 0 dans le dernier Mo, niveau 1 (4 blocs contigus) avant. */
function finDeFichier() {
  const racine = TAILLE - 600_000;
  const entrees = [{ n: 0, offset: racine, taille: 500_000, nbPoints: 60_000 }];
  for (let k = 0; k < 4; k++) entrees.push({ n: 1, x: k >> 1, y: k & 1, offset: racine - 4_000_000 + k * 1_000_000, taille: 1_000_000, nbPoints: 225_000 });
  const fin = fabriquerFin({ entrees, avant: 1_000_000 - 60 - entrees.length * 32 - 830 });
  return fin;
}

function monter({ cache = CACHE_DISQUE.creer(CACHE_DISQUE.stockageMemoire(), 1e9) } = {}) {
  const appels = [];
  const blocs = [];
  const liberes = [];
  const flux = FLUX.creer({
    chercherDalles: async () => {
      const out = [];
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) out.push({ url: url(x, y), nom: `${x}_${y}`, emprise: { xmin: x * 1000, xmax: x * 1000 + 1000, ymin: y * 1000, ymax: y * 1000 + 1000 } });
      return out;
    },
    recuperer: async (u, opts) => {
      appels.push({ u, opts });
      if (opts.fin) return { octets: finDeFichier(), total: TAILLE };
      if (opts.plage && opts.plage[0] === 0) return fabriquerEntete();
      // Un vrai délai (tâche macro) : sans lui, tout se finirait en
      // microtâches avant que le test ne déplace la vue, et l'abandon ne
      // serait jamais éprouvé.
      await new Promise((r) => setTimeout(r, 5));
      if (opts.signal?.aborted) throw new DOMException('abandon', 'AbortError');
      return new Uint8Array(opts.plage[1] - opts.plage[0] + 1);
    },
    decoder: async (charge) => ({ nbPoints: charge.nbPoints, xc: new Int32Array(1), yc: new Int32Array(1), zc: new Int32Array(1), cls: new Uint8Array(1) }),
    cache,
    config: { ...CONFIG.flux, budgetPoints: 1e9 },
    surBloc: (b) => blocs.push(b),
    surLibere: (c) => liberes.push(c),
  });
  return { flux, appels, blocs, liberes };
}

// Vue de 3 km sur 1400 px : pas ~2,1 m, niveau 1 visé (0,96 pt/m² ≥ 4/4,5).
const VUE = { xmin: 0, xmax: 3000, ymin: 0, ymax: 3000, largeurPx: 1400 };

test('une vue trop large ne demande rien', async () => {
  const { flux, appels } = monter();
  await flux.majVue({ xmin: 0, xmax: 20_000, ymin: 0, ymax: 20_000, largeurPx: 1400 });
  await flux.attendreCalme();
  assert.equal(appels.length, 0);
});

test('les dalles s’ouvrent du centre vers les bords, un en-tête par lot', async () => {
  const { flux, appels } = monter();
  await flux.majVue(VUE);
  await flux.attendreCalme();
  const fins = appels.filter((a) => a.opts.fin).map((a) => a.u);
  assert.equal(fins.length, 9);
  assert.equal(fins[0], url(1, 1), 'la dalle du centre d’abord');
  assert.equal(appels.filter((a) => a.opts.plage?.[0] === 0).length, 1, 'un seul en-tête pour le lot');
});

test('le niveau 0 sort de la fin de fichier, sans autre requête ; le niveau 1 en une plage par dalle', async () => {
  const { flux, appels, blocs } = monter();
  await flux.majVue(VUE);
  await flux.attendreCalme();
  assert.equal(blocs.filter((b) => b.niveau === 0).length, 9);
  const plages = appels.filter((a) => a.opts.plage && a.opts.plage[0] !== 0);
  assert.equal(plages.length, 9, 'les 4 blocs contigus du niveau 1 fusionnés en une requête par dalle');
  assert.equal(blocs.filter((b) => b.niveau === 1).length, 36);
  assert.deepEqual([...blocs[0].origineCm], [100_000, 100_000, 0], 'centimètres de la dalle du centre');
});

test('une deuxième visite sert tout depuis le cache disque', async () => {
  const cache = CACHE_DISQUE.creer(CACHE_DISQUE.stockageMemoire(), 1e9);
  const a = monter({ cache });
  await a.flux.majVue(VUE);
  await a.flux.attendreCalme();
  const b = monter({ cache });
  await b.flux.majVue(VUE);
  await b.flux.attendreCalme();
  assert.equal(b.appels.filter((x) => x.opts.plage && x.opts.plage[0] !== 0).length, 0);
});

test('déplacer la vue abandonne ce qui n’est plus visible, sans bloc émis après coup', async () => {
  const { flux, appels, blocs } = monter();
  flux.majVue(VUE);
  await new Promise((r) => setImmediate(r));
  await flux.majVue({ xmin: 50_000, xmax: 53_000, ymin: 50_000, ymax: 53_000, largeurPx: 1400 });
  await flux.attendreCalme();
  const signaux = appels.map((a) => a.opts.signal).filter(Boolean);
  assert.ok(signaux.some((s) => s.aborted), 'au moins une requête abandonnée');
  assert.ok(blocs.every((b) => b.emprise.xmin < 3000), 'aucun bloc hors de la première zone n’existe ici');
});

test('un index plus gros que le dernier Mo : relecture avec la fin de secours', async () => {
  const { flux, appels } = monter();
  let premier = true;
  const recup = flux._deps.recuperer;
  flux._deps.recuperer = async (u, opts) => {
    if (opts.fin && premier) { premier = false; appels.push({ u, opts }); return { octets: new Uint8Array(1000), total: TAILLE }; }
    return recup(u, opts);
  };
  await flux.majVue({ ...VUE, xmin: 1000, xmax: 2000, ymin: 1000, ymax: 2000 });
  await flux.attendreCalme();
  assert.ok(appels.some((a) => a.opts.fin === CONFIG.flux.octetsFinSecours));
});
```

- [ ] **Step 2: Constater l'échec**

Run: `node --test test/flux.test.js`
Expected: FAIL — `flux.js` absent.

- [ ] **Step 3: Implémenter**

Créer `src/flux.js` :

```js
// Chargement piloté par la vue : les points des dalles visibles, du grossier
// au fin, sans rien choisir ni charger à la main.
//
// À chaque vue : les dalles du rectangle (WFS), ouvertes d'une requête chacune
// — la fin du fichier ramène l'index et le niveau 0 —, puis les blocs plus fins
// que le zoom demande, groupés en plages contiguës, lus du cache disque avant
// le réseau, décompressés en centimètres entiers dans les workers. Voir la
// spec docs/superpowers/specs/2026-09-26-flux-vue-design.md et « Le chargement
// piloté par la vue » dans CLAUDE.md.
//
// Les dépendances sont injectées (`FLUX.creer`) : l'orchestration se teste
// avec un faux réseau, et `app.js` branche les vraies.

const FLUX = (() => {
  const coupe = (e, v) => e.xmax > v.xmin && e.xmin < v.xmax && e.ymax > v.ymin && e.ymin < v.ymax;
  const agrandi = (v, m) => ({ xmin: v.xmin - m, xmax: v.xmax + m, ymin: v.ymin - m, ymax: v.ymax + m });
  const contient = (a, b) => a.xmin <= b.xmin && a.xmax >= b.xmax && a.ymin <= b.ymin && a.ymax >= b.ymax;
  const centreDist = (e, v) => Math.hypot((e.xmin + e.xmax - v.xmin - v.xmax) / 2, (e.ymin + e.ymax - v.ymin - v.ymax) / 2);

  function creer(deps) {
    const config = deps.config || CONFIG.flux;
    const dalles = new Map();   // url → { dalle, etat, ctrl, index, fin, debutFin, entete }
    const lots = new Map();     // lot → Promise<entête>
    const blocs = new Map();    // cle → { etat, ctrl, niveau, nbPoints, emprise }
    const zones = [];           // rectangles déjà demandés au WFS
    let vue = null;
    let enCours = 0;
    let attenteCalme = [];

    // Suivi des tâches en vol, pour `attendreCalme`.
    const suivre = (p) => {
      enCours++;
      return p.finally(() => {
        enCours--;
        if (!enCours) { const a = attenteCalme; attenteCalme = []; a.forEach((f) => f()); }
      });
    };

    function publierEtat(tropLarge = false) {
      let attente = 0, charges = 0, points = 0;
      for (const b of blocs.values()) {
        if (b.etat === 'attente') attente++;
        else { charges++; points += b.nbPoints; }
      }
      const dallesOuvertes = [...dalles.values()].filter((d) => d.etat === 'ouverte').length;
      deps.surEtat?.({ attente, charges, points, dallesOuvertes, tropLarge });
    }

    function entetePourLot(url) {
      const lot = COPC.lotDepuisUrl(url);
      if (!lots.has(lot)) {
        const p = deps.recuperer(url, { plage: [0, 255] }).then(COPC.lireEnteteLot);
        p.catch(() => lots.delete(lot));   // un échec ne condamne pas le lot
        lots.set(lot, p);
      }
      return lots.get(lot);
    }

    async function ouvrir(d) {
      d.etat = 'ouverture';
      d.ctrl = new AbortController();
      const signal = d.ctrl.signal;
      try {
        let lu = null, fin = null, debut = 0;
        for (const n of [config.octetsFin, config.octetsFinSecours]) {
          const r = await deps.recuperer(d.dalle.url, { fin: n, signal });
          fin = r.octets;
          debut = r.total - r.octets.length;
          lu = COPC.lireFin(fin, debut);
          if (lu || r.octets.length >= r.total) break;
        }
        if (!lu) throw new Error(`index introuvable dans la fin de ${d.dalle.nom || d.dalle.url}`);
        const noeuds = new Map(lu.noeuds);
        for (const [offset, taille] of lu.sousPages) {
          const page = await deps.recuperer(d.dalle.url, { plage: [offset, offset + taille - 1], signal });
          const sp = COPC.lireEntrees(page);
          for (const [k, v] of sp.noeuds) noeuds.set(k, v);
        }
        d.entete = await entetePourLot(d.dalle.url);
        if (signal.aborted) return;
        Object.assign(d, { index: noeuds, fin, debutFin: debut, etat: 'ouverte' });
        planifier();
      } catch (e) {
        if (signal.aborted) { d.etat = 'inconnue'; return; }
        d.etat = 'echec';
        console.warn('Flux : dalle non ouverte —', e.message);
      }
    }

    const cleCache = (url, noeud) => `${url}#${noeud.offset}`;

    async function telechargerDalle(d, lot) {
      const ctrl = new AbortController();
      for (const b of lot) blocs.set(b.cle, { etat: 'attente', ctrl, niveau: b.niveau, nbPoints: b.noeud.nbPoints, emprise: b.emprise });
      const signal = ctrl.signal;
      try {
        // Du plus immédiat au plus lent : la fin de fichier déjà reçue, le
        // cache disque, puis le réseau en plages contiguës.
        const octetsDe = new Map();
        const aDemander = [];
        for (const b of lot) {
          const n = b.noeud;
          if (n.offset >= d.debutFin && n.offset + n.taille <= d.debutFin + d.fin.length) {
            octetsDe.set(b.cle, d.fin.subarray(n.offset - d.debutFin, n.offset - d.debutFin + n.taille));
            continue;
          }
          const o = await deps.cache?.lire(cleCache(d.dalle.url, n));
          if (o) octetsDe.set(b.cle, o); else aDemander.push(b);
        }
        for (const plage of COPC.grouperPlages(aDemander.map((b) => ({ ...b.noeud, bloc: b })))) {
          const o = await deps.recuperer(d.dalle.url, { plage: [plage.debut, plage.fin - 1], signal });
          for (const n of plage.noeuds) {
            const tranche = o.subarray(n.offset - plage.debut, n.offset - plage.debut + n.taille);
            octetsDe.set(n.bloc.cle, tranche);
            // Suivie comme le reste : une seconde visite juste après doit la trouver.
            if (deps.cache) suivre(deps.cache.ecrire(cleCache(d.dalle.url, n), tranche.slice()));
          }
        }
        const origineCm = [Math.round(d.dalle.emprise.xmin * 100), Math.round(d.dalle.emprise.ymin * 100), 0];
        for (const b of lot) {
          if (signal.aborted || !blocs.has(b.cle)) continue;
          const points = await deps.decoder({
            type: 'decoder', octets: octetsDe.get(b.cle).slice().buffer, nbPoints: b.noeud.nbPoints,
            formatPoint: d.entete.formatPoint, longueurPoint: d.entete.longueurPoint,
            echelle: d.entete.echelle, decalage: d.entete.decalage, origine: [0, 0, 0], entiers: origineCm,
          });
          const suivi = blocs.get(b.cle);
          if (signal.aborted || !suivi) continue;
          suivi.etat = 'charge';
          deps.surBloc?.({ cle: b.cle, url: d.dalle.url, niveau: b.niveau, emprise: b.emprise, origineCm, points });
          publierEtat();
        }
      } catch (e) {
        if (!signal.aborted) console.warn('Flux : blocs non chargés —', e.message);
        for (const b of lot) if (blocs.get(b.cle)?.etat === 'attente') blocs.delete(b.cle);
      }
      liberer();
    }

    let voulues = new Set();

    function planifier() {
      if (!vue) return;
      const marge = agrandi(vue, 1000);
      const visibles = [...dalles.values()].filter((d) => coupe(d.dalle.emprise, vue));

      // Ouvrir ce qui est visible, du centre vers les bords (la file réseau
      // sert dans l'ordre de demande) ; abandonner ce qui est sorti de la marge.
      visibles.filter((d) => d.etat === 'inconnue')
        .sort((a, b) => centreDist(a.dalle.emprise, vue) - centreDist(b.dalle.emprise, vue))
        .forEach((d) => suivre(ouvrir(d)));
      for (const d of dalles.values()) {
        if (d.etat === 'ouverture' && !coupe(d.dalle.emprise, marge)) d.ctrl.abort();
      }

      const pas = FLUX_CHOIX.pasPourVue(vue.xmax - vue.xmin, vue.largeurPx, config.pasMinM);
      const ouvertes = visibles.filter((d) => d.etat === 'ouverte');
      const voulus = FLUX_CHOIX.blocsPourVue(
        ouvertes.map((d) => ({ url: d.dalle.url, emprise: d.dalle.emprise, index: d.index })),
        vue, pas, config.pointsParCase, config.budgetPoints,
      );
      voulues = new Set(voulus.map((b) => b.cle));

      // Abandonner les blocs en attente qui ne sont plus voulus.
      for (const [cle, b] of blocs) {
        if (b.etat === 'attente' && !voulues.has(cle)) { b.ctrl.abort(); blocs.delete(cle); }
      }
      // Demander les nouveaux, un lot par dalle, dans l'ordre de `voulus`.
      const parDalle = new Map();
      for (const b of voulus) {
        if (blocs.has(b.cle)) continue;
        if (!parDalle.has(b.url)) parDalle.set(b.url, []);
        parDalle.get(b.url).push(b);
      }
      for (const [u, lot] of parDalle) suivre(telechargerDalle(dalles.get(u), lot));
      liberer();
      publierEtat();
    }

    function liberer() {
      if (!vue) return;
      const charges = [];
      for (const [cle, b] of blocs) if (b.etat === 'charge') charges.push({ cle, niveau: b.niveau, nbPoints: b.nbPoints, emprise: b.emprise });
      for (const cle of FLUX_CHOIX.aLiberer(charges, voulues, config.budgetPoints, vue)) {
        blocs.delete(cle);
        deps.surLibere?.(cle);
      }
    }

    // Toute la mise à jour est suivie d'un bloc : sans ça, `attendreCalme`
    // pouvait se résoudre dans l'intervalle entre la réponse du WFS et la
    // planification, alors que rien n'était encore demandé.
    const majVue = (v) => suivre(majVueInterne(v));

    async function majVueInterne(v) {
      vue = v;
      if (v.xmax - v.xmin > config.largeurMaxPointsM) {
        for (const d of dalles.values()) if (d.etat === 'ouverture') d.ctrl.abort();
        for (const [cle, b] of blocs) if (b.etat === 'attente') { b.ctrl.abort(); blocs.delete(cle); }
        publierEtat(true);
        return;
      }
      const zone = agrandi(v, 1000);
      if (!zones.some((z) => contient(z, zone))) {
        zones.push(zone);
        const trouvees = await deps.chercherDalles(zone).catch((e) => {
          zones.pop();
          console.warn('Flux : dalles introuvables —', e.message);
          return [];
        });
        for (const dl of trouvees) if (!dalles.has(dl.url)) dalles.set(dl.url, { dalle: dl, etat: 'inconnue' });
      }
      if (vue === v) planifier();
    }

    function attendreCalme() {
      if (!enCours) return Promise.resolve();
      return new Promise((r) => attenteCalme.push(r));
    }

    function arreter() {
      for (const d of dalles.values()) d.ctrl?.abort();
      for (const b of blocs.values()) b.ctrl?.abort();
      blocs.clear();
      vue = null;
    }

    return { majVue, attendreCalme, arreter, _deps: deps };
  }

  return { creer };
})();
```

Dans `index.html`, ajouter `<script src="src/flux.js"></script>` juste après `<script src="src/nuage.js"></script>`.

- [ ] **Step 4: Tests**

Run: `npm test`
Expected: PASS, les 6 tests de `test/flux.test.js` compris. Si « niveau 1 en une plage par dalle » échoue par un nombre de plages différent, vérifier que `grouperPlages` reçoit les nœuds avec leur `offset`/`taille` et que la tolérance par défaut (1 Mo) couvre l'écart nul entre les quatre blocs fabriqués.

- [ ] **Step 5: Commit**

```bash
git add src/flux.js test/flux.test.js index.html
git commit -m "Flux : ouverture des dalles par la fin, blocs du grossier au fin, abandon, cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Calque de contrôle et vérification sur données réelles

**Files:**
- Create: `src/flux-calque.js`
- Modify: `src/app.js` (fin de l'IIFE, avant le suivi du lien)
- Modify: `index.html` (après `carte.js`)

**Interfaces:**
- Consumes: `FLUX.creer`, `IGN.dalles(sud, ouest, nord, est)`, `RESEAU.recuperer`, `NUAGE.decoder`, `CACHE_DISQUE`, `PROJ.versLambert93`/`versWGS84`, `GRILLE.contourEmprise`, `carte.map`.
- Produces: `CalqueFlux` — `new CalqueFlux()` est un `L.LayerGroup` avec `ajouter(bloc)` et `retirer(cle)` ; contour coloré par niveau. Activé seulement par `?flux` dans l'adresse (`location.search`), sans effet sur le reste de l'application.

- [ ] **Step 1: Écrire le calque**

Créer `src/flux-calque.js` :

```js
// Calque de contrôle du chargement piloté par la vue : le contour de chaque
// bloc chargé, coloré par niveau. Provisoire — il rend visible le plan 1
// (chargement) avant que le relief (plan 2) n'existe. Activé par « ?flux »
// dans l'adresse.

const CalqueFlux = L.LayerGroup.extend({
  initialize() {
    L.LayerGroup.prototype.initialize.call(this);
    this._parCle = new Map();
  },
  ajouter(bloc) {
    const couleurs = ['#5ec8f0', '#4ade80', '#ffd24a', '#ff9f43', '#ff6b52', '#c084fc'];
    const forme = L.polygon(GRILLE.contourEmprise(bloc.emprise), {
      color: couleurs[Math.min(bloc.niveau, couleurs.length - 1)],
      weight: 1, fillOpacity: 0.08, interactive: false,
    });
    this._parCle.set(bloc.cle, forme);
    this.addLayer(forme);
  },
  retirer(cle) {
    const f = this._parCle.get(cle);
    if (f) { this.removeLayer(f); this._parCle.delete(cle); }
  },
});
```

Dans `index.html`, ajouter `<script src="src/flux-calque.js"></script>` juste après `<script src="src/carte.js"></script>`.

- [ ] **Step 2: Brancher derrière `?flux`**

Dans `src/app.js`, juste avant le commentaire `// Un hash non vide veut dire qu'on arrive par un lien …`, ajouter :

```js
// ── Chargement piloté par la vue (provisoire, « ?flux ») ────────────────────
//
// Le plan 1 de la spec docs/superpowers/specs/2026-09-26-flux-vue-design.md :
// les blocs de la vue se chargent et se dessinent en contours, sans relief
// encore. N'agit que si l'adresse porte « ?flux ».
if (new URLSearchParams(location.search).has('flux')) {
  const calque = new CalqueFlux().addTo(carte.map);
  const surAppareilPortatif = surMobile();
  const flux = FLUX.creer({
    chercherDalles: (z) => {
      const so = PROJ.versWGS84(z.xmin, z.ymin), ne = PROJ.versWGS84(z.xmax, z.ymax);
      return IGN.dalles(so.lat, so.lon, ne.lat, ne.lon);
    },
    recuperer: RESEAU.recuperer,
    decoder: NUAGE.decoder,
    cache: CACHE_DISQUE.creer(CACHE_DISQUE.stockageIndexedDB(), CONFIG.flux.quotaDisqueOctets),
    config: { ...CONFIG.flux, budgetPoints: surAppareilPortatif ? CONFIG.flux.budgetPointsMobile : CONFIG.flux.budgetPoints },
    surBloc: (b) => calque.ajouter(b),
    surLibere: (cle) => calque.retirer(cle),
    surEtat: (e) => statut(e.tropLarge
      ? 'Flux : vue trop large pour les points — zoomez'
      : `Flux : ${e.dallesOuvertes} dalles · ${e.charges} blocs · ${milliers(e.points)} points`
        + (e.attente ? ` · ${e.attente} en attente` : ''), e.attente ? 'travail' : undefined),
  });
  const majVueFlux = () => {
    const b = carte.map.getBounds();
    const so = PROJ.versLambert93(b.getWest(), b.getSouth());
    const ne = PROJ.versLambert93(b.getEast(), b.getNorth());
    const no = PROJ.versLambert93(b.getWest(), b.getNorth());
    const se = PROJ.versLambert93(b.getEast(), b.getSouth());
    flux.majVue({
      xmin: Math.min(so.x, no.x), xmax: Math.max(ne.x, se.x),
      ymin: Math.min(so.y, se.y), ymax: Math.max(ne.y, no.y),
      largeurPx: carte.map.getSize().x,
    });
  };
  carte.map.on('moveend', majVueFlux);
  majVueFlux();
  window.fluxDeControle = flux;   // pour la console et les harnais
}
```

(`surMobile`, `statut`, `milliers` existent déjà dans `app.js`.)

- [ ] **Step 3: Tests**

Run: `npm test`
Expected: PASS (`test/sources.test.js` vérifie le chargement de `flux-calque.js` et la syntaxe d'`app.js`).

- [ ] **Step 4: Vérifier sur données réelles, en navigateur**

Écrire un harnais jetable **hors dépôt** (dossier de travail de la session), piloté par Playwright dans le Chromium de WSL (réseau réel vers l'IGN), qui :

1. ouvre `file:///…/Scopus/index.html?flux#map=15/49.20657/5.43587` (~4 km de large sur 1400 px) ;
2. attend que `window.fluxDeControle.attendreCalme()` se résolve (délai max 120 s) ;
3. relève : nombre de dalles ouvertes, de blocs par niveau, temps jusqu'au premier bloc et jusqu'au calme, nombre de requêtes réseau vers `data.geopf.fr` par type (`Range: bytes=-…`, `bytes=0-255`, plages) ;
4. **vérifie l'hypothèse du cube** : dans un rappel `surBloc` ajouté par le harnais (par `window.fluxDeControle._deps.surBloc`, enveloppé), pour chaque bloc, que tous ses points satisfont `xmin·100 ≤ origineCm[0] + xc[i] ≤ xmax·100` et idem en y, `xmin/xmax` étant l'emprise du bloc — tolérance d'1 cm. Un seul point dehors invalide l'hypothèse ;
5. recharge la page et mesure la seconde visite : aucune requête de plage attendue (cache disque).

Expected : premier bloc en moins de 2 s ; hypothèse du cube vérifiée sur tous les blocs ; seconde visite sans requête de plage. Consigner les chiffres dans le message de commit et dans CLAUDE.md (tâche 8). **Si l'hypothèse du cube échoue**, arrêter et revenir à la spec : il faudrait lire le VLR `copc info` (centre, demi-côté) une fois par dalle.

- [ ] **Step 5: Commit**

```bash
git add src/flux-calque.js src/app.js index.html
git commit -m "Flux : calque de contrôle derrière ?flux, vérifié sur données réelles

<chiffres relevés à l'étape 4 : premier bloc, calme, requêtes, seconde visite>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documenter

**Files:**
- Modify: `CLAUDE.md` (nouvelle section après « Chargement : pourquoi COPC change tout » et ses sous-sections, avant « ## La carte »)

- [ ] **Step 1: Écrire la section**

Ajouter une section `## Le chargement piloté par la vue` qui dit, dans le style du document (pourquoi, mesures à l'appui) :

- ce que fait `flux.js` et pourquoi il remplacera « Charger la dalle » (renvoi à la spec) ;
- la fin de fichier : rangement des fichiers IGN, une requête par dalle, recherche de l'EVLR, un en-tête par lot (30 / 46 octets), secours à 4 Mo ;
- le quota IGN (10 requêtes/s par IP, ~4,5 dalles/s mesurées) et le seuil de 10 km ;
- l'ordre niveau puis distance, la troncature au budget et pourquoi (pas de va-et-vient) ;
- les centimètres entiers et l'écart de 0,03 % qu'ils suppriment ;
- l'hypothèse du cube = la dalle, **avec le résultat de la vérification de la tâche 7** ;
- le cache disque, son quota, son silence en navigation privée ;
- les chiffres relevés à la tâche 7.

- [ ] **Step 2: Vérifier**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md : le chargement piloté par la vue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Suite

- **Plan 2 — le calcul** : grille de la vue sur la carte graphique à partir des blocs émis par `FLUX` (accumulation sans `EXT_float_blend`, terrain, surface, couches), autocontrôle étendu, MNT en bouche-trou et au-delà du seuil. Écrit après le plan 1, avec ce qu'il aura appris.
- **Plan 3 — l'affichage et l'interface** : calque de relief WebGL sur Leaflet, rideau, fusion Carte/2D, retrait des anciens contrôles, contexte graphique partagé. Le calque de contrôle `?flux` disparaît alors.
