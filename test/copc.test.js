// Lecture d'un COPC par la fin, sans l'en-tête — la requête unique par dalle
// du chargement piloté par la vue. Mesuré sur 12 dalles de toute la France :
// l'index et le niveau 0 tiennent dans le dernier Mo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';
import { fabriquerFin, fabriquerEntete, fabriquerBloc } from './copc-fin.js';

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

test('lireFin situe le morceau dans le fichier sans en connaître la taille (table des blocs)', () => {
  // En navigateur, la taille du fichier (Content-Range) est masquée par CORS.
  // Juste après le dernier bloc, la table des blocs LAZ commence par 4 octets
  // nuls puis le nombre de blocs : vérifié sur 7 dalles réelles.
  const entrees = [
    { n: 0, offset: 5_300_000, taille: 600_000, nbPoints: 58_881 },   // finit à 5 900 000, le plus loin
    { n: 1, offset: 4_000_000, taille: 1_300_000, nbPoints: 216_000 },
  ];
  // Morceau commençant à 5 000 000 : la table est à 900 000 dans le morceau.
  const octets = fabriquerFin({ entrees, avant: 950_000, tableBlocs: { position: 900_000, nombre: 2 } });
  const r = COPC.lireFin(octets, null);
  assert.equal(r.debutMorceau, 5_000_000);
});

test('lireFin sans table des blocs reconnaissable : position inconnue, index quand même lu', () => {
  const octets = fabriquerFin({ entrees: [{ n: 0, offset: 5_300_000, taille: 600_000, nbPoints: 3 }], avant: 2000 });
  const r = COPC.lireFin(octets, null);
  assert.equal(r.noeuds.size, 1);
  assert.equal(r.debutMorceau, null);
});

test('lireFin garde la position fournie quand on la connaît', () => {
  const octets = fabriquerFin({ entrees: [{ n: 0, offset: 10, taille: 5, nbPoints: 3 }] });
  assert.equal(COPC.lireFin(octets, 1234).debutMorceau, 1234);
});

// ── Blocs réduits aux couches lues ──────────────────────────────────────────
// Format 6, 30 octets : neuf couches (XY, Z, classe, drapeaux, intensité,
// angle, utilisateur, source, temps GPS). Avec 16 octets supplémentaires
// (46 octets, lot d'avril 2026), seize couches de plus.
const TAILLES_6 = [400, 150, 20, 5, 170, 110, 0, 1, 150];

test('tailleUtileBloc : en-tête du bloc, puis XY, Z, classe et drapeaux', () => {
  const b = fabriquerBloc({ longueurPoint: 30, tailles: TAILLES_6 });
  assert.equal(COPC.tailleUtileBloc(b, 6, 30), 30 + 4 + 4 * 9 + 400 + 150 + 20 + 5);
  const b46 = fabriquerBloc({ longueurPoint: 46, tailles: [...TAILLES_6, ...new Array(16).fill(3)] });
  assert.equal(COPC.tailleUtileBloc(b46, 6, 46), 46 + 4 + 4 * 25 + 575);
  // L'en-tête suffit : pas besoin du bloc entier pour savoir où couper.
  assert.equal(COPC.tailleUtileBloc(b.subarray(0, 30 + 4 + 36), 6, 30), 30 + 4 + 36 + 575);
});

test('tailleUtileBloc : null si l’en-tête manque ou si le format n’est pas en couches', () => {
  const b = fabriquerBloc({ longueurPoint: 30, tailles: TAILLES_6 });
  assert.equal(COPC.tailleUtileBloc(b.subarray(0, 50), 6, 30), null);
  assert.equal(COPC.tailleUtileBloc(b, 3, 30), null);
  assert.equal(COPC.tailleUtileBloc(b, 6, 20), null, 'plus court qu’un point de format 6');
});

test('reduireBloc : les couches lues gardées, les autres déclarées vides', () => {
  const b = fabriquerBloc({ longueurPoint: 30, tailles: TAILLES_6 });
  const utile = COPC.tailleUtileBloc(b, 6, 30);
  // Depuis le bloc entier comme depuis un début de bloc assez long.
  for (const source of [b, b.subarray(0, utile + 17)]) {
    const r = COPC.reduireBloc(source, 6, 30);
    assert.equal(r.length, utile);
    const dv = new DataView(r.buffer, r.byteOffset);
    assert.deepEqual(Array.from({ length: 9 }, (_, i) => dv.getUint32(34 + 4 * i, true)), [400, 150, 20, 5, 0, 0, 0, 0, 0]);
    assert.deepEqual([...r.subarray(0, utile)], [...b.subarray(0, 34), ...r.subarray(34, 70), ...b.subarray(70, utile)]);
  }
});

test('reduireBloc : null si les couches lues ne sont pas toutes là', () => {
  const b = fabriquerBloc({ longueurPoint: 30, tailles: TAILLES_6 });
  assert.equal(COPC.reduireBloc(b.subarray(0, COPC.tailleUtileBloc(b, 6, 30) - 1), 6, 30), null);
});
