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
