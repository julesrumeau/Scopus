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
