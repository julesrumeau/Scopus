// Orchestrateur du chargement piloté par la vue, avec un faux réseau : les
// dalles d'une grille 3 × 3, des fins de fichier fabriquées, un décodeur qui
// rend des points synthétiques. Ce qui s'éprouve : l'ordre, le nombre de
// requêtes, l'abandon, le cache.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';
import { fabriquerFin, fabriquerEntete, fabriquerBloc } from './copc-fin.js';

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
  // Comme les vrais fichiers : la table des blocs LAZ juste après le dernier
  // bloc (le niveau 0 finit à TAILLE - 100 000, soit 900 000 dans le morceau).
  const fin = fabriquerFin({ entrees, avant: 1_000_000 - 60 - entrees.length * 32 - 830, tableBlocs: { position: 900_000, nombre: entrees.length } });
  return fin;
}

function monter({ cache = CACHE_DISQUE.creer(CACHE_DISQUE.stockageMemoire(), 1e9), delaiPlage = 5, config = {} } = {}) {
  const appels = [];
  const blocs = [];
  const liberes = [];
  const decodes = [];
  const flux = FLUX.creer({
    chercherDalles: async () => {
      const out = [];
      for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) out.push({ url: url(x, y), nom: `${x}_${y}`, emprise: { xmin: x * 1000, xmax: x * 1000 + 1000, ymin: y * 1000, ymax: y * 1000 + 1000 } });
      return out;
    },
    recuperer: async (u, opts) => {
      appels.push({ u, opts });
      // Comme en navigateur : Content-Range masqué par CORS, taille inconnue.
      if (opts.fin) return { octets: finDeFichier(), total: null };
      if (opts.plage && opts.plage[0] === 0) return fabriquerEntete();
      // Un vrai délai (tâche macro) : sans lui, tout se finirait en
      // microtâches avant que le test ne déplace la vue, et l'abandon ne
      // serait jamais éprouvé.
      await new Promise((r) => setTimeout(r, delaiPlage));
      if (opts.signal?.aborted) throw new DOMException('abandon', 'AbortError');
      return new Uint8Array(opts.plage[1] - opts.plage[0] + 1);
    },
    decoder: async (charge) => (decodes.push(charge), { nbPoints: charge.nbPoints, xc: new Int32Array(1), yc: new Int32Array(1), zc: new Int32Array(1), cls: new Uint8Array(1) }),
    cache,
    config: { ...CONFIG.flux, budgetPoints: 1e9, delaiReessaiMs: 20, ...config },
    surBloc: (b) => blocs.push(b),
    surLibere: (c) => liberes.push(c),
  });
  return { flux, appels, blocs, liberes, decodes, cache };
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
  // Blocs groupés : la coupe des gros blocs (plus bas) désactivée.
  const { flux, appels, blocs } = monter({ config: { coupeMinOctets: Infinity } });
  await flux.majVue(VUE);
  await flux.attendreCalme();
  assert.equal(blocs.filter((b) => b.niveau === 0).length, 9);
  // Les blocs contigus se groupent, mais une requête ne dépasse pas
  // plageMaxOctets : les blocs arrivent un à un, du centre vers les bords.
  const plages = appels.filter((a) => a.opts.plage && a.opts.plage[0] !== 0);
  assert.ok(plages.every((a) => a.opts.plage[1] - a.opts.plage[0] + 1 <= CONFIG.flux.plageMaxOctets));
  assert.ok(plages.length < 36, 'des blocs contigus sont groupés');
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
    if (opts.fin && premier) { premier = false; appels.push({ u, opts }); return { octets: new Uint8Array(1000), total: null }; }
    return recup(u, opts);
  };
  await flux.majVue({ ...VUE, xmin: 1000, xmax: 2000, ymin: 1000, ymax: 2000 });
  await flux.attendreCalme();
  assert.ok(appels.some((a) => a.opts.fin === CONFIG.flux.octetsFinSecours));
});

test('l’en-tête du lot part dès la première ouverture, pas derrière toutes les fins de fichier', async () => {
  // Mesuré sur données réelles : demandé après la première réponse, il se
  // retrouvait en queue de la file réseau derrière les 14 autres fins de
  // fichier, et aucun bloc ne se décodait avant ~11 s.
  const { flux, appels } = monter();
  await flux.majVue(VUE);
  await flux.attendreCalme();
  const iEntete = appels.findIndex((a) => a.opts.plage?.[0] === 0);
  const iFins = appels.map((a, i) => (a.opts.fin ? i : -1)).filter((i) => i >= 0);
  assert.ok(iEntete < iFins[1], `en-tête demandé en position ${iEntete}, deuxième fin en ${iFins[1]}`);
});

test('une deuxième visite relit aussi les index du disque, sans aucune fin de fichier', async () => {
  const cache = CACHE_DISQUE.creer(CACHE_DISQUE.stockageMemoire(), 1e9);
  const a = monter({ cache });
  await a.flux.majVue(VUE);
  await a.flux.attendreCalme();
  const b = monter({ cache });
  await b.flux.majVue(VUE);
  await b.flux.attendreCalme();
  assert.equal(b.appels.filter((x) => x.opts.fin).length, 0);
  assert.equal(b.blocs.length, a.blocs.length);
});

test('le niveau 0, déjà dans la fin de fichier, est émis sans attendre les plages plus fines', async () => {
  // Mesuré sur données réelles : le niveau 0 du centre attendait les 7,4 Mo du
  // niveau 1 de sa dalle, eux-mêmes en file derrière les autres dalles.
  const { flux, blocs } = monter({ delaiPlage: 300 });
  flux.majVue(VUE);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(blocs.some((b) => b.niveau === 0), 'un niveau 0 émis pendant que les plages sont en vol');
  assert.ok(!blocs.some((b) => b.niveau === 1), 'aucune plage encore servie');
  await flux.attendreCalme();
});

// ── Défauts relevés par la relecture de la branche ──────────────────────────

/** Entrées de hiérarchie brutes (32 octets chacune), pour une sous-page. */
function entreesBrutes(entrees) {
  const o = new Uint8Array(entrees.length * 32);
  const dv = new DataView(o.buffer);
  entrees.forEach((e, k) => {
    const p = k * 32;
    dv.setInt32(p, e.n, true); dv.setInt32(p + 4, e.x ?? 0, true); dv.setInt32(p + 8, e.y ?? 0, true);
    dv.setBigUint64(p + 16, BigInt(e.offset), true); dv.setInt32(p + 24, e.taille, true); dv.setInt32(p + 28, e.nbPoints, true);
  });
  return o;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('un léger déplacement n’abandonne pas les blocs encore voulus de la même plage', async () => {
  const { flux, blocs } = monter({ delaiPlage: 80 });
  flux.majVue(VUE);
  await pause(20);   // fins de fichier servies, plages du niveau 1 en vol
  // 600 m vers l'est : les blocs x=0 des dalles de gauche sortent de la vue,
  // leurs voisins x=1 (même plage réseau) y restent.
  await flux.majVue({ ...VUE, xmin: 600, xmax: 3600 });
  await flux.attendreCalme();
  const gauche = blocs.filter((b) => b.niveau === 1 && b.emprise.xmin === 500);
  // Deux blocs x=1 (bas et haut) par dalle de gauche, trois dalles : 6.
  assert.equal(gauche.length, 6, 'les blocs x=1 des trois dalles de gauche sont bien arrivés');
});

test('une dalle abandonnée pendant l’attente de l’en-tête se rouvre au retour', async () => {
  const { flux, blocs } = monter();
  const recup = flux._deps.recuperer;
  flux._deps.recuperer = async (u, o) => {
    if (o.plage && o.plage[0] === 0) await pause(80);   // en-tête du lot lent
    return recup(u, o);
  };
  const ICI = { xmin: 1000, xmax: 2000, ymin: 1000, ymax: 2000, largeurPx: 1400 };
  flux.majVue(ICI);
  await pause(20);   // fin de fichier reçue, en-tête en attente
  await flux.majVue({ xmin: 50_000, xmax: 51_000, ymin: 50_000, ymax: 51_000, largeurPx: 1400 });
  await flux.majVue(ICI);
  await flux.attendreCalme();
  await pause(100);
  await flux.attendreCalme();
  assert.ok(blocs.some((b) => b.url === url(1, 1)), 'la dalle (1,1) a fini par livrer ses blocs');
});

test('une vue changée pendant la réponse du WFS est quand même planifiée', async () => {
  const { flux, blocs } = monter();
  const chercher = flux._deps.chercherDalles;
  flux._deps.chercherDalles = async (z) => { await pause(50); return chercher(z); };
  flux.majVue(VUE);
  await pause(5);
  await flux.majVue({ ...VUE, xmin: 1200, xmax: 1800, ymin: 1200, ymax: 1800 });   // contenue dans la zone déjà demandée
  await flux.attendreCalme();
  assert.ok(blocs.length > 0);
});

test('les sous-pages de l’index sont suivies sur plusieurs niveaux', async () => {
  const { flux, blocs } = monter();
  const P1 = 150_000_000, P2 = 151_000_000;
  const page1 = entreesBrutes([{ n: 2, offset: 140_000_000, taille: 100, nbPoints: 230_000 }, { n: 1, offset: P2, taille: 64, nbPoints: -1 }]);
  const page2 = entreesBrutes([{ n: 1, x: 1, y: 1, offset: 141_000_000, taille: 100, nbPoints: 225_000 }]);
  flux._deps.recuperer = async (u, o) => {
    if (o.fin) return { octets: fabriquerFin({ entrees: [{ n: 0, offset: TAILLE - 600_000, taille: 500_000, nbPoints: 60_000 }, { n: 1, offset: P1, taille: 64, nbPoints: -1 }] }), total: null };
    if (o.plage[0] === 0) return fabriquerEntete();
    if (o.plage[0] === P1) return page1;
    if (o.plage[0] === P2) return page2;
    return new Uint8Array(o.plage[1] - o.plage[0] + 1);
  };
  await flux.majVue({ xmin: 1000, xmax: 2000, ymin: 1000, ymax: 2000, largeurPx: 1400 });
  await flux.attendreCalme();
  assert.ok(blocs.some((b) => b.niveau === 1 && b.emprise.xmin === 1500 && b.emprise.ymin === 1500), 'le nœud de la sous-page de second niveau est chargé');
});

test('une dalle en échec est réessayée, et l’échec est signalé', async () => {
  const etats = [];
  const { flux, blocs } = monter();
  let premier = true;
  const recup = flux._deps.recuperer;
  flux._deps.recuperer = async (u, o) => {
    if (o.fin && premier) { premier = false; throw new Error('HTTP 503 sur ' + u); }
    return recup(u, o);
  };
  flux._deps.surEtat = (e) => etats.push(e);
  await flux.majVue({ xmin: 1000, xmax: 2000, ymin: 1000, ymax: 2000, largeurPx: 1400 });
  await flux.attendreCalme();
  assert.ok(etats.some((e) => e.echecs >= 1 && e.erreur), 'l’échec remonte dans l’état');
  await pause(80);
  await flux.attendreCalme();
  assert.ok(blocs.some((b) => b.url === url(1, 1)), 'la dalle a été rouverte après le délai');
});

test('le seuil porte sur la surface : une vue large et basse sous le seuil charge quand même', async () => {
  // 12 km × 3 km = 36 km² : trop large pour l'ancien seuil de 10 km de large,
  // sous le seuil de surface. Ce qui fixe le nombre de dalles, c'est la surface.
  const { flux, appels } = monter();
  await flux.majVue({ xmin: 0, xmax: 12_000, ymin: 0, ymax: 3000, largeurPx: 1400 });
  await flux.attendreCalme();
  assert.ok(appels.some((a) => a.opts.fin));
});

test('l’état dit la surface affichée', async () => {
  const etats = [];
  const { flux } = monter();
  flux._deps.surEtat = (e) => etats.push(e);
  await flux.majVue({ ...VUE, xmin: 0, xmax: 20_000, ymin: 0, ymax: 20_000 });
  assert.equal(etats.at(-1).surfaceKm2, 400);
  assert.equal(etats.at(-1).tropLarge, true);
});

test('les blocs fins se téléchargent du centre vers les bords, un à un', async () => {
  // Retour d'usage : l'arrivée semblait aléatoire, sous-bloc par sous-bloc.
  // Les quatre quarts d'une dalle partaient en une seule plage, et les
  // dalles dans l'ordre où elles s'ouvraient, pas selon le centre de l'écran.
  // Faux blocs d'1 Mo : borne à 1 Mo pour qu'ils partent un par un, comme les
  // vrais quarts de dalle (~1,7 Mo) sous la borne de 2 Mo.
  const { flux, appels } = monter({ delaiPlage: 10, config: { plageMaxOctets: 1_000_000 } });
  await flux.majVue(VUE);
  await flux.attendreCalme();
  const plages = appels.filter((a) => a.opts.plage && a.opts.plage[0] !== 0);
  const premieres = plages.slice(0, 4).map((a) => a.u);
  assert.deepEqual(premieres, [url(1, 1), url(1, 1), url(1, 1), url(1, 1)], 'les quatre quarts de la dalle du centre d’abord, chacun sa requête');
});

test('voulues() : les blocs que la vue demande, en copie', async () => {
  const { flux } = monter();
  await flux.majVue(VUE);
  await flux.attendreCalme();
  const v = flux.voulues();
  assert.ok(v.size > 0);
  v.clear();
  assert.ok(flux.voulues().size > 0);
});

// ── Blocs coupés aux couches lues ───────────────────────────────────────────
// Les faux blocs de niveau 1 font 1 Mo, au-dessus de coupeMinOctets : chacun
// part seul, et seul son début est demandé.

test('un gros bloc part seul, et seul son début est demandé', async () => {
  const { flux, appels } = monter();
  await flux.majVue(VUE);
  await flux.attendreCalme();
  const plages = appels.filter((a) => a.opts.plage && a.opts.plage[0] !== 0);
  assert.equal(plages.length, 36, 'un bloc de niveau 1 par requête');
  const attendu = Math.ceil(1_000_000 * CONFIG.flux.fractionCoupe);
  assert.ok(plages.every((a) => a.opts.plage[1] - a.opts.plage[0] + 1 === attendu), 'le début du bloc, pas le bloc entier');
});

test('le décodeur et le cache reçoivent le bloc réduit aux couches lues', async () => {
  // Chaque plage rend un bloc dont les couches lues font 300 000 octets.
  const bloc = fabriquerBloc({ longueurPoint: 30, tailles: [200_000, 90_000, 9_000, 1_000, 150_000, 100_000, 0, 0, 150_000] });
  const { flux, decodes, cache } = monter({ config: {} });
  const recup = flux._deps.recuperer;
  flux._deps.recuperer = async (u, o) => (o.plage && o.plage[0] !== 0 ? bloc.slice(0, o.plage[1] - o.plage[0] + 1) : recup(u, o));
  await flux.majVue(VUE);
  await flux.attendreCalme();
  const niveau1 = decodes.filter((c) => c.nbPoints === 225_000);
  assert.equal(niveau1.length, 36);
  assert.ok(niveau1.every((c) => c.octets.byteLength === 300_070), 'en-tête (70) + couches lues');
  const garde = await cache.lire(`${url(1, 1)}#${200_000_000 - 600_000 - 4_000_000}`);
  assert.equal(garde.length, 300_070, 'le cache garde le bloc réduit');
});

test('si le début demandé ne suffit pas, le reste des couches lues est redemandé', async () => {
  // Couches lues : 900 000 octets, plus que les 68 % d'1 Mo demandés.
  const bloc = fabriquerBloc({ longueurPoint: 30, tailles: [700_000, 150_000, 40_000, 10_000, 30_000, 0, 0, 0, 0] });
  const { flux, appels, decodes } = monter();
  const recup = flux._deps.recuperer;
  flux._deps.recuperer = async (u, o) => {
    if (!o.plage || o.plage[0] === 0) return recup(u, o);
    appels.push({ u, opts: o });
    const debutBloc = [0, 1, 2, 3].map((k) => 200_000_000 - 600_000 - 4_000_000 + k * 1_000_000).find((d) => o.plage[0] >= d && o.plage[0] < d + 1_000_000);
    return bloc.slice(o.plage[0] - debutBloc, o.plage[1] - debutBloc + 1);
  };
  await flux.majVue({ xmin: 1000, xmax: 2000, ymin: 1000, ymax: 2000, largeurPx: 1400 });
  await flux.attendreCalme();
  const niveau1 = decodes.filter((c) => c.nbPoints === 225_000);
  assert.ok(niveau1.length > 0);
  assert.ok(niveau1.every((c) => c.octets.byteLength === 900_070));
  const suites = appels.filter((a) => a.opts.plage && a.opts.plage[0] !== 0 && (a.opts.plage[0] - (200_000_000 - 4_600_000)) % 1_000_000 !== 0);
  assert.equal(suites.length, niveau1.length, 'une requête de complément par bloc');
});

// ── Un niveau entier avant le suivant ───────────────────────────────────────
// Retour d'usage (calque &debug) : du vert (niveau 1) arrivait avant la fin du
// bleu (niveau 0), et au moindre déplacement ce détail était perdu.

test('aucun bloc de niveau 1 n’est demandé avant que toutes les dalles visibles aient livré leur niveau 0', async () => {
  const { flux, appels } = monter();
  // Fins de fichier lentes : sans barrière, les blocs des premières dalles
  // ouvertes partiraient pendant que les autres attendent encore la leur.
  const recup = flux._deps.recuperer;
  flux._deps.recuperer = async (u, o) => {
    if (o.fin) await pause(u === url(1, 1) ? 5 : 40);
    const r = await recup(u, o);
    if (o.fin) appels.push({ u, opts: { finRecue: true } });
    return r;
  };
  await flux.majVue(VUE);
  await flux.attendreCalme();
  const derniereFin = appels.map((a, i) => (a.opts.finRecue ? i : -1)).filter((i) => i >= 0).pop();
  const premierBloc = appels.findIndex((a) => a.opts.plage && a.opts.plage[0] !== 0);
  assert.ok(premierBloc > derniereFin, `premier bloc demandé en ${premierBloc}, dernière fin de fichier reçue en ${derniereFin}`);
});

test('le niveau 2 attend que tout le niveau 1 soit arrivé, même avec des places libres', async () => {
  const { flux, appels } = monter({ delaiPlage: 20 });
  const racine = TAILLE - 600_000;
  const entrees = [{ n: 0, offset: racine, taille: 500_000, nbPoints: 60_000 }];
  for (let k = 0; k < 4; k++) entrees.push({ n: 1, x: k >> 1, y: k & 1, offset: racine - 4_000_000 + k * 1_000_000, taille: 1_000_000, nbPoints: 225_000 });
  for (let k = 0; k < 16; k++) entrees.push({ n: 2, x: k >> 2, y: k & 3, offset: 150_000_000 + k * 1000, taille: 1000, nbPoints: 900_000 });
  const fin = fabriquerFin({ entrees, avant: 1_000_000 - 60 - entrees.length * 32 - 830, tableBlocs: { position: 900_000, nombre: entrees.length } });
  const recup = flux._deps.recuperer;
  const recus = [];
  flux._deps.recuperer = async (u, o) => {
    if (o.fin) { appels.push({ u, opts: o }); return { octets: fin, total: null }; }
    const r = await recup(u, o);
    if (o.plage && o.plage[0] !== 0) recus.push(o.plage[0]);
    return r;
  };
  // 1 km sur 1400 px : pas ~0,7 m, le niveau 2 est voulu.
  await flux.majVue({ xmin: 1000, xmax: 2000, ymin: 1000, ymax: 2000, largeurPx: 1400 });
  await flux.attendreCalme();
  const demandes = appels.filter((a) => a.opts.plage && a.opts.plage[0] !== 0).map((a) => a.opts.plage[0]);
  const niveau2 = (o) => o >= 150_000_000 && o < 151_000_000;
  const premierN2 = demandes.findIndex(niveau2);
  assert.ok(premierN2 > 0, 'le niveau 2 est demandé');
  const recusAvant = recus.slice(0, recus.findIndex(niveau2));
  assert.equal(recusAvant.filter((o) => !niveau2(o)).length, 4, 'les quatre blocs du niveau 1 reçus avant le premier du niveau 2');
});

// ── Pas de LiDAR dans la vue ────────────────────────────────────────────────

test('sans aucune dalle dans la vue, l’état le dit ; pas avant la réponse du WFS, ni sur un échec', async () => {
  const etats = [];
  const { flux } = monter();
  flux._deps.surEtat = (e) => etats.push(e);
  let repondre;
  flux._deps.chercherDalles = () => new Promise((r) => { repondre = r; });
  const fini = flux.majVue({ xmin: 50_000, xmax: 51_000, ymin: 50_000, ymax: 51_000, largeurPx: 1400 });
  await pause(5);
  assert.ok(!etats.some((e) => e.sansLidar), 'rien d’affirmé avant la réponse');
  repondre([]);
  await fini;
  assert.equal(etats.at(-1).sansLidar, true);

  // Un échec du WFS n'est pas une absence de LiDAR.
  const b = monter();
  const vus = [];
  b.flux._deps.surEtat = (e) => vus.push(e);
  b.flux._deps.chercherDalles = async () => { throw new Error('panne'); };
  await b.flux.majVue({ xmin: 60_000, xmax: 61_000, ymin: 60_000, ymax: 61_000, largeurPx: 1400 });
  assert.ok(!vus.some((e) => e.sansLidar));
});

test('des dalles dans la vue : pas de « sans LiDAR »', async () => {
  const etats = [];
  const { flux } = monter();
  flux._deps.surEtat = (e) => etats.push(e);
  await flux.majVue(VUE);
  await flux.attendreCalme();
  assert.ok(etats.length && etats.every((e) => !e.sansLidar));
});
