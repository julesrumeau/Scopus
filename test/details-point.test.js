// La logique de « Détails du point » : trouver le point chargé le plus proche, aller chercher son bloc entier, en lire
// l'enregistrement, en faire des lignes. Le DOM n'y est pas ; tout est injecté.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { ATTRIBUTS_POINT, DETAILS_POINT } = chargerScripts(['attributs-point.js', 'details-point.js']);

function enregistrement() {
  const o = new Uint8Array(30), v = new DataView(o.buffer);
  v.setInt32(0, 100, true); v.setInt32(4, 200, true); v.setInt32(8, 30000, true);
  v.setUint16(12, 77, true); v.setUint8(14, 0x11); v.setUint8(16, 2); v.setFloat64(22, 422453057.89562845, true);
  return o;
}
const DESC = { cle: 'k', url: 'https://ign/x.copc.laz', offset: 1000, taille: 500, nbPoints: 10, niveau: 3, nomDalle: 'LHD_FXX_0877_6905_PTS_LAMB93_IGN69.copc.laz',
  formatPoint: 6, longueurPoint: 30, echelle: [0.01, 0.01, 0.01], decalage: [0, 0, 0] };

function monter(sur = {}) {
  const appels = { recuperer: [], decoder: [] };
  const d = DETAILS_POINT.creer({
    pointProche: async () => ({ cle: 'k', indice: 4, classe: 2, xCm: 100, yCm: 200, zCm: 30000 }),
    descripteurBloc: () => DESC,
    recuperer: async (u, o) => { appels.recuperer.push([u, o]); return new Uint8Array(500); },
    decoder: async (c) => { appels.decoder.push(c); return { enregistrement: enregistrement() }; },
    ATTRIBUTS_POINT, nomsClasses: { 2: 'sol' },
    ...sur,
  });
  return { d, appels };
}

test('lire : le bloc entier est demandé à sa place exacte, décodé au bon rang, et mis en lignes', async () => {
  const { d, appels } = monter();
  const r = await d.lire({ x: 1.0, y: 2.0, z: 300 });
  assert.equal(appels.recuperer.length, 1);
  assert.equal(appels.recuperer[0][0], DESC.url);
  assert.equal(JSON.stringify(appels.recuperer[0][1].plage), '[1000,1499]');
  const c = appels.decoder[0];
  assert.equal(c.type, 'point'); assert.equal(c.indice, 4); assert.equal(c.nbPoints, 10); assert.equal(c.longueurPoint, 30);
  assert.ok(r.lignes.some((l) => l.libelle === 'Date et heure (UTC)' && l.valeur.startsWith('2025-02-01 13:50:39')));
  assert.ok(r.lignes.some((l) => l.libelle === 'Classe' && l.valeur === '2 : sol'));
  assert.match(r.contexte, /0877_6905/);
});

test('lire : aucun point chargé alentour, ou bloc devenu introuvable : un message, pas d’exception', async () => {
  let r = await monter({ pointProche: async () => null }).d.lire({ x: 0, y: 0, z: null });
  assert.match(r.erreur, /aucun point/i);
  r = await monter({ descripteurBloc: () => null }).d.lire({ x: 0, y: 0, z: null });
  assert.match(r.erreur, /plus chargé|zoomez/i);
});

test('lire : un échec réseau ou de décodage devient un message en clair, sans URL', async () => {
  const r = await monter({ recuperer: async () => { throw new Error('https://secret/x 503'); } }).d.lire({ x: 0, y: 0, z: null });
  assert.ok(r.erreur && !/https?:/.test(r.erreur), r.erreur);
});

test('lire : le point visé est celui du clic, au niveau du sol de la sélection (z passé tel quel)', async () => {
  let vu;
  await monter({ pointProche: async (x, y, z) => (vu = [x, y, z], null) }).d.lire({ x: 877500, y: 6903500, z: 312.5 });
  assert.equal(JSON.stringify(vu), '[877500,6903500,312.5]');
});
