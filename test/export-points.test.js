// Ce que la fenêtre d'export des points décide (`SORTIE.resumerExport`,
// `SORTIE.exporterPoints`) : quoi écrire, sous quel nom, et si le bouton de
// téléchargement est actif.
//
// LAS : toujours tous les points — la classe y est un champ, on trie ensuite
// dans l'outil. PLY : les classes cochées seulement, pour qui veut une couche
// à la fois (FreeCAD ignore la classe).

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { SORTIE, LAS, PLY } = chargerScripts(['las.js', 'ply.js', 'sortie.js']);

const nuage = {
  n: 6,
  x: Float32Array.from([0, 1, 2, 3, 4, 5]),
  y: Float32Array.from([0, 0, 0, 0, 0, 0]),
  z: Float32Array.from([0, 0, 0, 0, 0, 0]),
  cls: Uint8Array.from([2, 2, 6, 6, 6, 64]),
};

test('sans format choisi : rien à télécharger, et on le dit', () => {
  const r = SORTIE.resumerExport(nuage, null, new Set());
  assert.equal(r.actif, false);
  assert.match(r.message, /format/i);
});

test('LAS : tous les points, quelles que soient les classes décochées', () => {
  const r = SORTIE.resumerExport(nuage, 'las', new Set([2, 6, 64]));
  assert.equal(r.actif, true);
  assert.equal(r.n, 6);
  assert.equal(r.octets, LAS.compter(nuage).octets);
  const e = SORTIE.exporterPoints(nuage, 'las', new Set([2, 6, 64]));
  assert.equal(e.n, 6);
  assert.equal(e.nom, 'scopus_nuage_3d.las');
});

test('PLY : seules les classes cochées entrent dans le fichier', () => {
  const exclues = new Set([2]);
  const r = SORTIE.resumerExport(nuage, 'ply', exclues);
  assert.equal(r.actif, true);
  assert.equal(r.n, 4);
  assert.equal(r.octets, PLY.compter(nuage, exclues).octets);
  const e = SORTIE.exporterPoints(nuage, 'ply', exclues);
  assert.equal(e.n, 4);
  assert.equal(e.nom, 'scopus_nuage_3d.ply');
});

test('PLY avec toutes les classes décochées : bouton inactif, message explicite', () => {
  const r = SORTIE.resumerExport(nuage, 'ply', new Set([2, 6, 64]));
  assert.equal(r.actif, false);
  assert.equal(r.n, 0);
  assert.match(r.message, /classe/i);
});

test('un format inconnu est refusé plutôt que deviné', () => {
  assert.throws(() => SORTIE.exporterPoints(nuage, 'obj', new Set()), /format/i);
});
