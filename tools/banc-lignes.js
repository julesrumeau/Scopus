// Banc synthétique : quelle couche, à quel pas, sur quelle surface ?
//
// Ce banc ne teste rien — il **mesure**, et son résultat décide de la forme de
// la chaîne d'extraction à écrire. Quatre questions sont ouvertes, et aucune ne
// se tranche par le raisonnement :
//
//  1. **Le pas.** 25 cm rend un mur de 50 cm sur deux cellules, mais une cellule
//     n'y reçoit que 0,6 point : plus de la moitié sont vides. 50 cm en reçoit
//     deux ou trois. Le gain de finesse vaut-il le bruit d'échantillonnage ?
//  2. **La couche.** Ouverture négative, positive, SVF, micro-relief.
//  3. **La surface d'entrée.** Le classement IGN décide du sort d'un tas de
//     pierres : classé 1 ou 6, il est **retiré du MNT** et comblé — la crête
//     n'existe alors plus dans le MNT du tout. Classé 2, il *est* le terrain.
//     Une chaîne qui ne lit que le MNT est aveugle au premier cas.
//  4. **Le seuil**, et surtout ce qu'il fait passer : un champ de blocs produit
//     exactement la même signature convexe qu'un mur ruiné. C'est le risque
//     numéro un relevé par la littérature (Trier & Pilø 2012 : sur terrain
//     accidenté, « a large number of false positives »).
//
// D'où la mesure faite ici : le seuil est calibré **sur l'orri** — celui qui
// retient 90 % des cellules de sa couronne — puis appliqué tel quel aux scènes
// négatives. Le taux de cellules qui le franchissent sur un chaos rocheux ou un
// versant nu est le vrai chiffre à connaître avant d'écrire quoi que ce soit.
//
// Lancer : `npm run banc`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Chargé dans le contexte natif, et non dans un `vm.createContext` comme les
// tests : les boucles de balayage y tournent sept fois plus lentement, ce qui
// rendrait toute mesure de temps mensongère (cf. CLAUDE.md).
const SRC = new URL('../src/', import.meta.url);
for (const f of ['config.js', 'proj.js', 'raster.js', 'detection.js', 'relief.js', 'lignes.js']) {
  vm.runInThisContext(readFileSync(fileURLToPath(new URL(f, SRC)), 'utf8'));
}
const RELIEF = vm.runInThisContext('RELIEF');
const RASTER = vm.runInThisContext('RASTER');
const LIGNES = vm.runInThisContext('LIGNES');

// Réexportés pour que `lignes.test.js` juge exactement le même code, chargé une
// seule fois : un banc qui mesure autre chose que ce que les tests vérifient ne
// prouverait rien. Et le contexte natif leur épargne le facteur sept du `vm`.
export const MODULES = { RELIEF, LIGNES, RASTER, DETECTION: vm.runInThisContext('DETECTION') };

// ── Le terrain synthétique ──────────────────────────────────────────────────

/** Générateur reproductible : un banc dont le résultat change à chaque
 * exécution ne permet pas de comparer deux versions du code. */
function alea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scène de 80 m de côté, et non 40. Ce n'est pas du confort : le micro-relief
// écarte une marge de **trois rayons de lissage** — la portée cumulée de trois
// flous de boîte enchaînés — soit 18 m de chaque côté au rayon retenu ici. Sur
// 40 m il ne restait pas une seule cellule exploitable, et la couche sortait
// vide sans que rien ne le dise.
export const COTE = 80;
const DENSITE = 10;       // points sol au m², densité annoncée du LiDAR HD
const BRUIT_Z = 0.05;     // écart-type vertical, 5 cm

/**
 * Une scène : le sol naturel, ce que la structure ajoute, et la vérité.
 *
 * `structure(x, y)` rend la hauteur ajoutée en mètres ; `cible(x, y)` dit si la
 * cellule fait partie de ce qu'on veut détecter. Les deux diffèrent : pour un
 * orri, la cible est la **couronne**, pas l'intérieur.
 */
export const SCENES = [
  {
    cle: 'orri',
    libelle: 'Orri — anneau Ø 4 m, mur 1 m d’épaisseur, 60 cm de haut, versant 20°',
    reference: true,
    sol: (x) => 800 + Math.tan(20 * Math.PI / 180) * x,
    structure: (x, y) => (Math.abs(Math.hypot(x - 40, y - 40) - 2) < 0.5 ? 0.6 : 0),
    cible: (x, y) => Math.abs(Math.hypot(x - 40, y - 40) - 2) < 0.5,
  },
  {
    cle: 'cabane',
    libelle: 'Cabane — rectangle 6 × 4 m, murs 80 cm d’épaisseur, 70 cm de haut, versant 15°',
    sol: (x) => 900 + Math.tan(15 * Math.PI / 180) * x,
    structure: (x, y) => (mur(x, y) ? 0.7 : 0),
    cible: (x, y) => mur(x, y),
  },
  {
    // Les deux scènes décisives pour départager l'ouverture du micro-relief.
    //
    // Sur un plan, les deux marchent : le micro-relief soustrait un plan
    // exactement, l'ouverture l'annule par symétrie. La différence n'apparaît
    // que là où le terrain **courbe** — croupe ou combe — parce que la moyenne
    // locale du micro-relief y laisse un résidu du relief général, qui se
    // superpose au signal cherché. L'ouverture, elle, ne soustrait rien : elle
    // mesure un angle.
    //
    // Le terrain de prospection est fait de croupes et de combes. Un banc qui
    // n'en contient pas conclurait à tort que les deux couches se valent.
    cle: 'croupe',
    libelle: 'Orri sur une croupe convexe (rayon de courbure 40 m), versant 17°',
    sol: (x, y) => 1000 + Math.tan(17 * Math.PI / 180) * x - ((y - 40) ** 2) / 80,
    structure: (x, y) => (Math.abs(Math.hypot(x - 40, y - 40) - 2) < 0.5 ? 0.6 : 0),
    cible: (x, y) => Math.abs(Math.hypot(x - 40, y - 40) - 2) < 0.5,
  },
  {
    cle: 'combe',
    libelle: 'Orri dans une combe concave (rayon de courbure 40 m), versant 17°',
    sol: (x, y) => 1000 + Math.tan(17 * Math.PI / 180) * x + ((y - 40) ** 2) / 80,
    structure: (x, y) => (Math.abs(Math.hypot(x - 40, y - 40) - 2) < 0.5 ? 0.6 : 0),
    cible: (x, y) => Math.abs(Math.hypot(x - 40, y - 40) - 2) < 0.5,
  },
  {
    // Le faux positif que la géométrie seule ne peut pas écarter : le rebord
    // d'une plateforme est un anneau parfait. Seul l'intérieur les sépare — celui
    // d'une cabane est fermé au ciel, celui-ci ne l'est pas du tout.
    cle: 'plateforme',
    libelle: 'Plateforme pleine Ø 5 m à bords francs, 60 cm (négatif)',
    sol: (x) => 1000 + Math.tan(20 * Math.PI / 180) * x,
    structure: (x, y) => (Math.hypot(x - 40, y - 40) < 2.5 ? 0.6 : 0),
    cible: () => false,
  },
  {
    // Une bosse pleine à pente douce : elle ne franchit même pas le seuil
    // d'ouverture, l'openness ne marquant qu'une convexité franche.
    cle: 'bloc',
    libelle: 'Bosse pleine Ø 5 m à pente douce, 60 cm (négatif)',
    sol: (x) => 1000 + Math.tan(20 * Math.PI / 180) * x,
    structure: (x, y) => {
      const d = Math.hypot(x - 40, y - 40);
      return d < 2.5 ? 0.6 * Math.cos(d / 2.5 * Math.PI / 2) : 0;
    },
    cible: () => false,
  },
  {
    cle: 'terrasse',
    libelle: 'Terrasse — talus rectiligne de 60 cm, en travers du versant (négatif)',
    sol: (x, y) => 700 + Math.tan(18 * Math.PI / 180) * x + (y > 40 ? 0.6 : 0),
    structure: () => 0,
    cible: () => false,
  },
  {
    cle: 'chemin',
    libelle: 'Chemin creux — 40 cm de creux, 2 m de large, de niveau (négatif)',
    sol: (x, y) => 650 + Math.tan(18 * Math.PI / 180) * x
      - (Math.abs(y - 40) < 1 ? 0.4 : 0),
    structure: () => 0,
    cible: () => false,
  },
  {
    cle: 'chaos',
    libelle: 'Chaos rocheux — 240 blocs de 0,4 à 1,2 m, versant 22° (le générateur de faux positifs)',
    sol: chaosRocheux(),
    structure: () => 0,
    cible: () => false,
  },
  {
    cle: 'nu',
    libelle: 'Versant nu à 25° (contrôle négatif absolu)',
    sol: (x) => 1100 + Math.tan(25 * Math.PI / 180) * x,
    structure: () => 0,
    cible: () => false,
  },
];

/** Murs d'un rectangle 6 × 4 m centré, épaisseur 80 cm. */
function mur(x, y) {
  const dx = Math.abs(x - 40), dy = Math.abs(y - 40);
  const dedans = dx <= 3 && dy <= 2;
  const creux = dx <= 3 - 0.8 && dy <= 2 - 0.8;
  return dedans && !creux;
}

/** Versant parsemé de blocs : la forme convexe qui ressemble le plus à un mur. */
function chaosRocheux() {
  const r = alea(7);
  const blocs = [];
  for (let i = 0; i < 240; i++) {
    blocs.push({ x: r() * COTE, y: r() * COTE, rayon: 0.5 + r() * 0.6, h: 0.4 + r() * 0.8 });
  }
  return (x, y) => {
    let z = 1000 + Math.tan(22 * Math.PI / 180) * x;
    for (const b of blocs) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < b.rayon) z += b.h * Math.cos(d / b.rayon * Math.PI / 2);
    }
    return z;
  };
}

// ── Du nuage aux grilles ────────────────────────────────────────────────────

/**
 * Échantillonne la scène comme le ferait un vol LiDAR, puis rastérise.
 *
 * C'est la partie qui décide de la réponse à la question du pas, donc elle ne
 * peut pas être escamotée : on tire des points de Poisson à 10 /m², on les
 * bruite verticalement, et **les cellules sans point restent vides** — comblées
 * ensuite comme le fait `raster.js`, par propagation des bords vers l'intérieur.
 * À 25 cm, 53 % des cellules ne reçoivent aucun point ; à 50 cm, 8 %.
 *
 * `classement` : `'sol'` si la structure est classée 2 — elle *est* le terrain
 * et entre dans le MNT ; `'bati'` si elle est classée 1 ou 6 — ses points sont
 * retirés du MNT, le trou est comblé, et sa hauteur part dans `hauteur`.
 */
export function rasteriser(scene, pas, classement, graine = 1) {
  const r = alea(graine);

  // Le nuage d'abord, la grille ensuite — et par `raster.js`, pas à la main.
  //
  // La première version de ce banc rastérisait directement au pas voulu, en
  // moyennant les points de chaque cellule. C'était optimiste, et le
  // branchement l'a montré : le vrai MNT retient le **Z minimum** des points
  // sol, ce qui est juste pour un modèle de terrain mais **érode le mur d'une
  // cellule de chaque côté** — une cellule qui chevauche l'arête prend le sol,
  // pas la pierre. Sur un mur d'un mètre à 25 cm, il ne reste que la moitié de
  // la largeur, et le creux d'ouverture mesuré tombe de 25° à 15,6°. Un banc
  // qui ne passe pas par la même chaîne que l'application calibre des seuils
  // qui ne valent que pour lui.
  const points = Math.round(COTE * COTE * DENSITE);
  const xs = new Float32Array(points), ys = new Float32Array(points);
  const zs = new Float32Array(points), cls = new Uint8Array(points);
  const origine = [0, 0, 0];
  let n = 0;

  for (let i = 0; i < points; i++) {
    const x = r() * COTE, y = r() * COTE;
    const h = scene.structure(x, y);
    const bruit = (r() + r() - 1) * BRUIT_Z * 1.73;

    // Sous une masse de pierre, le laser ne rend aucun écho sol : le point de
    // structure remplace le point de sol, il ne s'y ajoute pas. C'est ce qui
    // fait qu'une ruine creuse un trou dans la classe sol — le plus physique des
    // indices de toute la détection.
    xs[n] = x; ys[n] = y;
    zs[n] = scene.sol(x, y) + h + bruit;
    // Classée 2, la structure *est* le terrain ; classée 6, elle est retirée du
    // MNT et le trou est comblé. Les deux cas existent dans la donnée réelle et
    // ne se ressemblent pas.
    cls[n] = h > 0 && classement === 'bati' ? 6 : 2;
    n++;
  }

  const nuage = {
    n, origine, emprise: { xmin: 0, ymin: 0, xmax: COTE, ymax: COTE },
    x: xs, y: ys, z: zs, cls,
    intensite: new Uint16Array(n), retour: new Uint8Array(n),
    zmin: 0, zmax: 0,
  };

  const fine = RASTER.rasteriser(nuage);
  const g = RELIEF.preparer(fine, { inclureBati: true });
  // `creerGrilles` n'expose pas de champ `N` — seulement `W` et `H`. Diviser
  // par `fine.N` (undefined) rendait « NaN % » et, pire, empêchait la boucle
  // de tourner du tout (`i < undefined` est faux d'emblée), donc `vides`
  // restait à 0 en silence.
  const nFine = fine.W * fine.H;
  let vides = 0;
  for (let i = 0; i < nFine; i++) if (!fine.solN[i]) vides++;
  g.partVide = vides / nFine;
  g.fine = fine;
  return g;
}

// ── Mesure ──────────────────────────────────────────────────────────────────

const COUCHES = [
  { cle: 'ouv−', calc: (t, o) => RELIEF.ouverture(t, o, 'negative'), sens: -1 },
  { cle: 'ouv+', calc: (t, o) => RELIEF.ouverture(t, o, 'positive'), sens: -1 },
  { cle: 'svf', calc: (t, o) => RELIEF.svf(t, o), sens: -1 },
  { cle: 'micro', calc: (t) => RELIEF.microRelief(t, RAYON_MICRO_M), sens: +1 },
];

const OPT = {};   // réglages de production : c'est eux qu'on calibre
// Marge commune à toutes les couches, prise sur la plus exigeante — le
// micro-relief et ses trois rayons. Les comparer sur des domaines différents
// n'aurait pas de sens.
const RAYON_MICRO_M = 6;
const MARGE_M = 3 * RAYON_MICRO_M;

const mediane = (v) => {
  const a = Float64Array.from(v).sort();
  return a.length ? a[a.length >> 1] : NaN;
};
/** Écart absolu médian, ramené à l'écart-type d'une gaussienne. */
const mad = (v) => {
  const m = mediane(v);
  return 1.4826 * mediane(Array.from(v, (x) => Math.abs(x - m))) || 1e-6;
};
const centile = (v, p) => {
  const a = Float64Array.from(v).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
};

/** Sépare les valeurs d'une couche en « cible » et « fond », hors marge. */
function partager(scene, t, valeurs) {
  const cible = [], fond = [];
  const m = Math.round(MARGE_M / t.pas);
  for (let y = m; y < t.H - m; y++) {
    for (let x = m; x < t.W - m; x++) {
      const px = (x + 0.5) * t.pas, py = (y + 0.5) * t.pas;
      const v = valeurs[y * t.W + x];
      if (!Number.isFinite(v)) continue;
      if (scene.cible(px, py)) cible.push(v);
      // Une couronne de 1,5 m autour de la cible n'est ni cible ni fond : le
      // pied d'un mur porte encore son signal, le compter comme fond
      // fabriquerait un faux positif qui n'en est pas un.
      else if (!procheCible(scene, px, py)) fond.push(v);
    }
  }
  return { cible, fond };
}

function procheCible(scene, x, y) {
  for (let a = 0; a < 8; a++) {
    const t = a / 8 * Math.PI * 2;
    if (scene.cible(x + Math.cos(t) * 1.5, y + Math.sin(t) * 1.5)) return true;
  }
  return false;
}

function main() {
  const surfaces = [
    { cle: 'MNT', bati: false },
    { cle: 'MNT+haut', bati: true },
  ];

  for (const pas of [0.25, 0.5]) {
    for (const surface of surfaces) {
      // Grilles de toutes les scènes, pour ce pas et cette surface.
      const grilles = new Map();
      for (const scene of SCENES) {
        for (const classement of ['sol', 'bati']) {
          const g = rasteriser(scene, pas, classement);
          if (surface.bati) {
            // Surface enveloppe : le MNT relevé de ce qui se dresse dessus.
            // C'est le seul moyen de voir une structure classée bâtiment, dont
            // le MNT ne porte plus la trace.
            const mnt = Float32Array.from(g.mnt);
            for (let i = 0; i < g.N; i++) mnt[i] += g.hauteur[i];
            grilles.set(`${scene.cle}/${classement}`, { ...g, mnt });
          } else {
            grilles.set(`${scene.cle}/${classement}`, g);
          }
        }
      }

      const vide = grilles.get('orri/sol').partVide;
      console.log(`\n${'═'.repeat(94)}`);
      console.log(`  pas ${pas} m · surface ${surface.cle} · ${(vide * 100).toFixed(0)} % de cellules sans aucun point`);
      console.log('═'.repeat(94));
      console.log('couche  classement │  cible    fond   dispersion   d′  │ seuil │ % du fond qui le franchit');
      console.log('                   │                                   │       │ orri cabane croupe combe platef bloc terras chemin chaos   nu');
      console.log('─'.repeat(94));

      for (const couche of COUCHES) {
        for (const classement of ['sol', 'bati']) {
          const valeurs = new Map();
          for (const scene of SCENES) {
            const g = grilles.get(`${scene.cle}/${classement}`);
            valeurs.set(scene.cle, couche.calc(g, OPT));
          }

          // Étalonnage sur l'orri : le seuil qui retient 90 % de sa couronne.
          const orri = SCENES.find((s) => s.cle === 'orri');
          const p = partager(orri, grilles.get('orri/' + classement), valeurs.get('orri'));
          if (!p.cible.length) continue;
          const seuil = couche.sens < 0 ? centile(p.cible, 0.9) : centile(p.cible, 0.1);
          const d = Math.abs(mediane(p.cible) - mediane(p.fond)) / mad(p.fond);

          const franchit = SCENES.map((scene) => {
            const g = grilles.get(`${scene.cle}/${classement}`);
            const q = partager(scene, g, valeurs.get(scene.cle));
            const n = q.fond.filter((v) => (couche.sens < 0 ? v <= seuil : v >= seuil)).length;
            return q.fond.length ? n / q.fond.length : 0;
          });

          console.log(
            `${couche.cle.padEnd(6)} ${classement.padEnd(10)} │ `
            + `${mediane(p.cible).toFixed(2).padStart(6)} ${mediane(p.fond).toFixed(2).padStart(7)} `
            + `${mad(p.fond).toFixed(3).padStart(10)} ${d.toFixed(1).padStart(5)}  │ `
            + `${seuil.toFixed(2).padStart(6)} │ `
            + franchit.map((f) => `${(f * 100).toFixed(1).padStart(5)}%`).join(' '));
        }
      }
    }
  }

  chaine();

  console.log(`\nLecture : d′ est l'écart cible/fond en nombre de dispersions du fond — au-dessous`);
  console.log(`de 2 environ, aucun seuil ne sépare quoi que ce soit. Les colonnes de droite sont`);
  console.log(`le prix à payer : la part du fond de chaque scène qui franchit le seuil réglé pour`);
  console.log(`attraper 90 % de la couronne de l'orri. « chaos » est celle qui décide.\n`);
  for (const s of SCENES) console.log(`  ${s.cle.padEnd(9)} ${s.libelle}`);
}

if (process.argv[1]?.endsWith('banc-lignes.js')) main();

// ── La chaîne complète, jugée scène par scène ───────────────────────────────

/**
 * Ce que le banc mesure ici n'est plus la séparabilité d'une couche mais le
 * **résultat** : combien de structures fermées la chaîne rend sur chaque scène,
 * et si celle qu'on a plantée en fait partie.
 *
 * Une scène négative doit rendre zéro. Le chaos rocheux est la seule qui
 * compte vraiment : c'est lui qui dira si la topologie fait le tri que le seuil
 * ne sait pas faire.
 */
function chaine() {
  for (const mode of ['seuil', 'frangi']) {
  console.log(`\n${'═'.repeat(94)}`);
  console.log(`  Chaîne complète — LIGNES.extraire, mode « ${mode} », pas 0,5 m, surface enveloppe`);
  console.log('═'.repeat(94));
  console.log('scène      classement │ masque │ fermées │ trouvée │ écart au centre │ ouvertes │  durée');
  console.log('─'.repeat(94));

  for (const scene of SCENES) {
    for (const classement of ['sol', 'bati']) {
      const g = rasteriser(scene, 0.5, classement);
      const t0 = performance.now();
      const r = LIGNES.extraire(g, { mode });
      const ms = performance.now() - t0;

      // La vérité est au centre de la scène quand il y en a une.
      const attendue = scene.cible(COTE / 2, COTE / 2 + 2);
      let trouvee = '—', ecart = '—';
      if (attendue) {
        const proche = r.structures
          .map((s) => ({ s, d: Math.hypot(s.cx - COTE / 2, s.cy - COTE / 2) }))
          .sort((a, b) => a.d - b.d)[0];
        trouvee = proche && proche.d < 3 ? 'oui' : 'NON';
        ecart = proche ? `${proche.d.toFixed(2)} m` : '—';
      }

      console.log(
        `${scene.cle.padEnd(10)} ${classement.padEnd(10)} │ `
        + `${(r.partMasque * 100).toFixed(1).padStart(5)}% │ `
        + `${String(r.structures.length).padStart(7)} │ `
        + `${trouvee.padStart(7)} │ ${ecart.padStart(15)} │ `
        + `${String(r.ouvertes.length).padStart(8)} │ ${ms.toFixed(0).padStart(5)} ms`);
    }
  }
  }
  console.log('\nUne scène négative doit rendre 0 fermée. « chaos » est celle qui décide.');
}
