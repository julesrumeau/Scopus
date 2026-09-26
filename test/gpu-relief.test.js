// Aiguillage entre carte graphique et processeur dans relief.js.
//
// Node n'a pas de WebGL : la parité des noyaux se vérifie en navigateur, et
// gpu-relief.js se l'impose lui-même au premier usage (autocontrôle). Ce qui
// se vérifie ici, c'est le câblage — qu'un résultat de la carte graphique soit
// bien employé quand il existe, que son absence retombe sur le calcul de
// référence, et que `moteur: 'cpu'` le court-circuite. Une erreur là ne se
// verrait pas à l'écran : les deux chemins rendent des images plausibles.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

function grille() {
  const W = 60, H = 50, N = W * H, pas = 0.5;
  const mnt = new Float32Array(N), valide = new Uint8Array(N).fill(1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mnt[y * W + x] = 100 + 0.2 * x + Math.sin(y / 3);
  return { W, H, N, pas, mnt, valide };
}

/** Faux module : rend des tableaux reconnaissables, et compte ses appels. */
function faux(rendre = true) {
  const appels = [];
  const plein = (N, v) => new Float32Array(N).fill(v);
  return {
    appels,
    horizons: (t) => { appels.push('horizons'); return rendre ? { svf: plein(t.N, 0.42), ouverturePositive: plein(t.N, 80), ouvertureNegative: plein(t.N, 85) } : null; },
    ombrages: (t, s) => { appels.push('ombrages'); return rendre ? s.map(() => plein(t.N, 0.5)) : null; },
    microRelief: (t) => { appels.push('micro'); return rendre ? plein(t.N, 0.07) : null; },
  };
}

test('sans module carte graphique, relief.js calcule sur le processeur', () => {
  const { RELIEF } = chargerScripts(['config.js', 'relief.js']);
  const c = RELIEF.calculer(grille(), 'svf');
  assert.equal(c.moteur, 'cpu');
  assert.ok(Number.isFinite(c.valeurs[25 * 60 + 30]));
});

test('un résultat de la carte graphique est employé tel quel, et signalé', () => {
  const ctx = chargerScripts(['config.js', 'relief.js']);
  ctx.GPU_RELIEF = faux();
  const t = grille();
  for (const [cle, attendu] of [['svf', 0.42], ['ouverture-pos', 80], ['ouverture-neg', 85], ['ombrage', 0.5], ['microrelief', 0.07]]) {
    const c = ctx.RELIEF.calculer(t, cle);
    assert.equal(c.moteur, 'gpu', cle);
    assert.equal(c.valeurs[100], Math.fround(attendu), cle);
  }
  const rgb = ctx.RELIEF.ombrageRGB(t);
  assert.equal(rgb[0], Math.round(0.5 * 255));
  assert.equal(ctx.RELIEF.moteur(), 'gpu');
});

test('carte graphique indisponible : retour au calcul de référence', () => {
  const ctx = chargerScripts(['config.js', 'relief.js']);
  ctx.GPU_RELIEF = faux(false);
  const t = grille();
  const ref = chargerScripts(['config.js', 'relief.js']).RELIEF;
  for (const cle of ['svf', 'ombrage', 'microrelief']) {
    const c = ctx.RELIEF.calculer(t, cle);
    assert.equal(c.moteur, 'cpu', cle);
    assert.deepEqual([...c.valeurs.slice(0, 200)], [...ref.calculer(t, cle).valeurs.slice(0, 200)], cle);
  }
  assert.ok(ctx.GPU_RELIEF.appels.length >= 3, 'la carte graphique a bien été sollicitée d’abord');
});

test('moteur « cpu » et CONFIG.relief.gpu à false court-circuitent la carte graphique', () => {
  const ctx = chargerScripts(['config.js', 'relief.js']);
  ctx.GPU_RELIEF = faux();
  const t = grille();
  assert.equal(ctx.RELIEF.calculer(t, 'svf', { moteur: 'cpu' }).moteur, 'cpu');
  assert.equal(ctx.RELIEF.calculer(t, 'ombrage', { gpu: false }).moteur, 'cpu');
  assert.equal(ctx.GPU_RELIEF.appels.length, 0);
});

test('le mémo du balayage ne resert pas un résultat processeur à qui veut la carte graphique', () => {
  // Le mémo évite de refaire le balayage d'une couche à l'autre ; il ne doit
  // pas mélanger les moteurs, sans quoi l'autocontrôle comparerait la carte
  // graphique à elle-même.
  const ctx = chargerScripts(['config.js', 'relief.js']);
  ctx.GPU_RELIEF = faux();
  const t = grille();
  const cpu = ctx.RELIEF.balayerHorizons(t, { moteur: 'cpu' });
  const gpu = ctx.RELIEF.balayerHorizons(t, {});
  assert.notEqual(cpu, gpu);
  assert.equal(gpu.svf[0], Math.fround(0.42));
});
