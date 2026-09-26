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
