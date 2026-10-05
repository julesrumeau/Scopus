// Les listes de couches du rideau, rangées par famille (des <optgroup>). La règle qui compte : une
// couche qu'on ajoute un jour sans la classer ne doit **jamais disparaître** de la liste.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { CHOIX_COUCHES } = chargerScripts(['choix-couches.js']);

/** Toutes les couches connues de la vue normale, dans un désordre volontaire. */
const TOUTES = [
  'svf', 'mns-ign', 'carte', 'ombrage-rgb', 'osm', 'ouverture-pos', 'plan', 'ombrage', 'trou',
  'microrelief', 'mnt-ign', 'hauteur', 'ouverture-neg', 'ombrage-simple',
].map((cle) => ({ cle, libelle: `Libellé de ${cle}` }));

// Les tableaux du contexte `vm` n'ont pas les prototypes d'ici : on compare leur JSON.
const plat = (v) => JSON.parse(JSON.stringify(v));
const cles = (g) => plat(g.couches.map((c) => c.cle));

test('les couches sont rangées en familles, dans l’ordre voulu', () => {
  const g = CHOIX_COUCHES.groupes(TOUTES);
  assert.deepEqual(plat(g.map((x) => x.titre)), [
    'Fonds de carte', 'Relief : lumière et ombres', 'Relief : formes du terrain',
    'Relief : mesures du sol', 'Relief de l’IGN',
  ]);
});

test('chaque famille contient ses couches, dans l’ordre de la famille et non de la liste reçue', () => {
  const g = CHOIX_COUCHES.groupes(TOUTES);
  assert.deepEqual(cles(g[0]), ['carte', 'plan', 'osm']);
  assert.deepEqual(cles(g[1]), ['ombrage', 'ombrage-simple', 'ombrage-rgb']);
  assert.deepEqual(cles(g[2]), ['svf', 'ouverture-pos', 'ouverture-neg', 'microrelief']);
  assert.deepEqual(cles(g[3]), ['hauteur', 'trou']);
  assert.deepEqual(cles(g[4]), ['mnt-ign', 'mns-ign']);
});

test('aucune couche n’est perdue ni dédoublée', () => {
  const g = CHOIX_COUCHES.groupes(TOUTES);
  const vues = plat(g).flatMap((x) => x.couches.map((c) => c.cle)).sort();
  assert.deepEqual(vues, TOUTES.map((c) => c.cle).sort());
});

test('un libellé reste celui de la couche : le groupe ne le change pas', () => {
  const g = CHOIX_COUCHES.groupes(TOUTES);
  assert.equal(g[0].couches[0].libelle, 'Libellé de carte');
});

test('une couche inconnue tombe dans « Autres », en dernier : elle ne disparaît pas', () => {
  const g = CHOIX_COUCHES.groupes([...TOUTES, { cle: 'nouvelle', libelle: 'Une nouvelle couche' }]);
  const dernier = g[g.length - 1];
  assert.equal(dernier.titre, 'Autres');
  assert.deepEqual(cles(dernier), ['nouvelle']);
});

test('une famille sans couche n’apparaît pas', () => {
  const g = CHOIX_COUCHES.groupes(TOUTES.filter((c) => c.cle !== 'mnt-ign' && c.cle !== 'mns-ign'));
  assert.ok(!g.some((x) => x.titre === 'Relief de l’IGN'));
  assert.ok(!g.some((x) => x.titre === 'Autres'), 'et pas de groupe « Autres » vide');
});
