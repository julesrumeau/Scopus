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
