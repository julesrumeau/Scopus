// Cache d'octets compressés (`nuage.js`, § CLAUDE.md « Octets compressés
// retenus ») — la seule partie de ce module qui se prête à un test Node : le
// reste (Worker, WASM, `fetch` réel) est éprouvé en navigateur réel, pas ici
// (voir `.tmp/test-cache-octets.html`, non versionné, qui a mesuré 5262 ms
// puis 841 ms sur la vraie dalle de Beille avant que ce mécanisme ne soit
// fusionné dans main).
//
// Le worker et le réseau sont donc remplacés par des relevés déterministes :
// `RESEAU.recuperer` compte ses appels au lieu de faire un vrai `fetch`, et
// `grappe.decoder` rend des points synthétiques au lieu de décompresser du
// LAZ. Ce qui reste à éprouver — la clé de cache, la décision
// resservir/redemander, `octetsResservis` — est alors purement local.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = new URL('../src/', import.meta.url);
const lire = (nom) => readFileSync(fileURLToPath(new URL(nom, SRC)), 'utf8');

/**
 * Charge `nuage.js` dans un contexte isolé, avec `RESEAU`, `COPC` et la
 * grappe de workers remplacés par des relevés déterministes.
 *
 * `grappe` est atteignable après coup parce que `chargerScripts` (voir
 * `charger.js`) réexporte tout déclaration de premier niveau — ici recopié à
 * la main pour ajouter les stubs `RESEAU`/`COPC` avant que `nuage.js` ne
 * s'exécute, ce que `chargerScripts` ne permet pas d'intercaler.
 */
function charger() {
  const base = {};
  for (const nom of Object.getOwnPropertyNames(globalThis)) {
    if (nom === 'globalThis') continue;
    const desc = Object.getOwnPropertyDescriptor(globalThis, nom);
    if (desc) Object.defineProperty(base, nom, desc);
  }
  // `NB_WORKERS` (premier niveau de nuage.js) lit `navigator` à l'exécution
  // du script : sans lui, le chargement échoue avant même d'atteindre le
  // code qu'on veut éprouver.
  base.navigator = { hardwareConcurrency: 2 };
  const contexte = vm.createContext(base);
  contexte.globalThis = contexte;

  const appelsReseau = [];
  vm.runInContext(`
    var appelsReseau = [];
    var RESEAU = {
      async recuperer(url, opts) {
        appelsReseau.push({ url, plage: opts.plage });
        const taille = opts.plage[1] - opts.plage[0] + 1;
        return new Uint8Array(taille).fill(7);
      },
    };
    var COPC = { empriseNoeud: () => ({ xmin: 0, xmax: 0, ymin: 0, ymax: 0 }) };
  `, contexte);

  vm.runInContext(lire('config.js'), contexte);
  const source = lire('nuage.js');
  const noms = [...source.matchAll(/^(?:const|class|function|async function)\s+([A-Za-z_$][\w$]*)/gm)]
    .map((m) => m[1]);
  const reexport = noms.map((n) => `try { globalThis.${n} = ${n}; } catch (e) {}`).join('\n');
  vm.runInContext(`${source}\n${reexport}`, contexte, { filename: fileURLToPath(new URL('nuage.js', SRC)) });

  // Ni Worker ni WASM : la grappe rend des points synthétiques, un par octet
  // de la charge reçue — suffisant pour compter, pas pour lire une position.
  contexte.grappe.demarrer = async () => {};
  contexte.grappe.decoder = async (charge) => ({
    nbPoints: charge.nbPoints,
    x: new Float32Array(charge.nbPoints),
    y: new Float32Array(charge.nbPoints),
    z: new Float32Array(charge.nbPoints),
    cls: new Uint8Array(charge.nbPoints),
    intensite: new Uint16Array(charge.nbPoints),
    retour: new Uint8Array(charge.nbPoints),
  });

  return { NUAGE: contexte.NUAGE, appelsReseau: contexte.appelsReseau };
}

const EMPRISE = { xmin: -1e9, xmax: 1e9, ymin: -1e9, ymax: 1e9 };   // tout est « dedans »

/** Deux nœuds contigus : `grouperPlages` doit les fondre en une seule plage. */
function deuxNoeudsContigus() {
  return [
    { cle: { n: 0 }, offset: 0, taille: 100, nbPoints: 5 },
    { cle: { n: 0 }, offset: 100, taille: 100, nbPoints: 5 },
  ];
}

test('un second chargement de la même dalle resert tous les octets, sans nouvel appel réseau', async () => {
  const { NUAGE, appelsReseau } = charger();
  const entete = { url: 'http://test/dalle-a.copc.laz', bbox: { zmin: 0 } };

  let dernier;
  await NUAGE.charger(entete, deuxNoeudsContigus(), EMPRISE, {
    surAvancement: (a) => { dernier = a; },
  });
  assert.equal(appelsReseau.length, 1, 'une seule plage groupée doit produire un seul appel réseau');
  assert.equal(dernier.octetsResservis, 0, 'rien à resservir au tout premier chargement');
  const octetsPremierTour = dernier.octets;

  await NUAGE.charger(entete, deuxNoeudsContigus(), EMPRISE, {
    surAvancement: (a) => { dernier = a; },
  });
  assert.equal(appelsReseau.length, 1, 'même dalle, mêmes plages : aucun appel réseau de plus');
  assert.equal(dernier.octetsResservis, octetsPremierTour, 'tous les octets doivent être resservis');
  assert.equal(dernier.octets, octetsPremierTour, 'le volume total ne change pas d’un tour à l’autre');
});

test('une dalle différente ne profite pas du cache de la précédente', async () => {
  const { NUAGE, appelsReseau } = charger();
  const a = { url: 'http://test/dalle-a.copc.laz', bbox: { zmin: 0 } };
  const b = { url: 'http://test/dalle-b.copc.laz', bbox: { zmin: 0 } };

  await NUAGE.charger(a, deuxNoeudsContigus(), EMPRISE, {});
  assert.equal(appelsReseau.length, 1);

  let dernier;
  await NUAGE.charger(b, deuxNoeudsContigus(), EMPRISE, { surAvancement: (x) => { dernier = x; } });
  assert.equal(appelsReseau.length, 2, 'une dalle différente doit redemander ses octets au réseau');
  assert.equal(dernier.octetsResservis, 0);
});

test('viderCacheOctets() efface le cache : un rechargement de la même dalle redemande tout', async () => {
  const { NUAGE, appelsReseau } = charger();
  const entete = { url: 'http://test/dalle-a.copc.laz', bbox: { zmin: 0 } };

  await NUAGE.charger(entete, deuxNoeudsContigus(), EMPRISE, {});
  assert.equal(appelsReseau.length, 1);

  NUAGE.viderCacheOctets();

  let dernier;
  await NUAGE.charger(entete, deuxNoeudsContigus(), EMPRISE, { surAvancement: (a) => { dernier = a; } });
  assert.equal(appelsReseau.length, 2, 'le cache vidé, même la dalle déjà vue redemande ses octets');
  assert.equal(dernier.octetsResservis, 0);
});

test('des plages différentes (nœuds non contigus) ne se resservent pas entre elles', async () => {
  const { NUAGE, appelsReseau } = charger();
  const entete = { url: 'http://test/dalle-a.copc.laz', bbox: { zmin: 0 } };

  // Un trou de 10 Mo entre les deux nœuds dépasse la tolérance de
  // regroupement (1 Mo par défaut) : deux plages distinctes, donc deux appels.
  const noeuds = [
    { cle: { n: 0 }, offset: 0, taille: 100, nbPoints: 5 },
    { cle: { n: 0 }, offset: 100 + 10 * 1024 * 1024, taille: 100, nbPoints: 5 },
  ];

  await NUAGE.charger(entete, noeuds, EMPRISE, {});
  assert.equal(appelsReseau.length, 2, 'deux plages non contiguës doivent produire deux appels réseau');

  let dernier;
  await NUAGE.charger(entete, noeuds, EMPRISE, { surAvancement: (a) => { dernier = a; } });
  assert.equal(appelsReseau.length, 2, 'les deux plages, déjà vues, doivent toutes deux être resservies');
  assert.equal(dernier.octetsResservis, dernier.octets);
});
