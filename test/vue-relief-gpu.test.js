// Aiguillage de VUE_RELIEF entre carte graphique et processeur. Node n'a pas
// de WebGL : un faux GPU_RELIEF tient lieu de carte, et ce qui se vérifie ici
// est le câblage — l'autocontrôle décide, et un refus retombe sur le
// processeur sans perdre les blocs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

function monter(fausser) {
  const ctx = chargerScripts(['config.js', 'vue-grille.js', 'raster.js', 'relief.js', 'vue-relief.js']);
  const gardes = new Map();
  const appels = [];
  ctx.GPU_RELIEF = {
    disponible: () => true,
    raison: () => '',
    coteMax: () => 8192,
    // Les couches passent ensuite par RELIEF.calculer, qui interroge aussi la
    // carte : `null` le renvoie au processeur, comme une carte qui refuse.
    horizons: () => null,
    ombrages: () => null,
    microRelief: () => null,
    ajouterBloc: (cle, p) => { gardes.set(cle, p); return true; },
    retirerBloc: (cle) => { gardes.delete(cle); },
    surfaceVue: (geo, blocs, zRefCm, spanCm, r) => {
      appels.push(blocs.length);
      const t = ctx.VUE_RELIEF.surfaceCPU(geo, blocs.map((b) => ({ ...gardes.get(b.cle), origineCm: b.origineCm })), zRefCm, r);
      if (typeof fausser === 'function') fausser(t);
      else if (fausser) for (let i = 0; i < t.N; i++) t.mnt[i] += 1;
      return t;
    },
  };
  return { ctx, gardes, appels };
}

function bloc(cle) {
  const n = 400;
  const xc = new Int32Array(n), yc = new Int32Array(n), zc = new Int32Array(n), cls = new Uint8Array(n).fill(2);
  for (let i = 0; i < n; i++) { xc[i] = (i % 20) * 50 + 10; yc[i] = Math.floor(i / 20) * 50 + 10; zc[i] = 30000 + i; }
  return { cle, emprise: { xmin: 0, ymin: 0, xmax: 10, ymax: 10 }, origineCm: [0, 0, 0], points: { nbPoints: n, xc, yc, zc, cls } };
}

test('autocontrôle accepté : la surface vient de la carte graphique', () => {
  const { ctx, gardes, appels } = monter(false);
  assert.equal(ctx.VUE_RELIEF.controleGPU(), '');
  const m = ctx.VUE_RELIEF.creer();
  assert.equal(m.moteur, 'gpu');
  m.ajouter(bloc('a'));
  assert.ok(gardes.has('a'));
  const geo = ctx.VUE_GRILLE.definir({ xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, 0.5, 0, 4096);
  const c = m.calculer(geo, 'ombrage');
  assert.equal(c.moteurSurface, 'gpu');
  assert.equal(appels.at(-1), 1);
  m.retirer('a');
  assert.equal(gardes.has('a'), false);
});

test('autocontrôle refusé : le processeur calcule', () => {
  const { ctx, gardes } = monter(true);
  assert.match(ctx.VUE_RELIEF.controleGPU(), /altitude/);
  const m = ctx.VUE_RELIEF.creer();
  assert.equal(m.moteur, 'cpu');
  m.ajouter(bloc('a'));
  assert.equal(gardes.has('a'), false);
  const geo = ctx.VUE_GRILLE.definir({ xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, 0.5, 0, 4096);
  assert.equal(m.calculer(geo, 'ombrage').moteurSurface, 'cpu');
});

// Les cases complétées par le non classé portent des sommes sur 16 bits : leur
// altitude diffère de quelques millimètres (2,4 mm mesurés sur la carte AMD),
// et une case dont la hauteur tombe pile au plafond de 3 m peut basculer d'un
// côté ou de l'autre. Ni l'un ni l'autre n'est un défaut de la carte.
test('autocontrôle : quelques millimètres partout, accepté', () => {
  const { ctx } = monter((t) => { for (let i = 0; i < t.N; i++) t.mnt[i] += 0.005; });
  assert.equal(ctx.VUE_RELIEF.controleGPU(), '');
});

test('autocontrôle : de rares cases qui basculent au plafond, accepté', () => {
  const { ctx } = monter((t) => { t.mnt[100] += 3; t.mnt[5000] -= 3; });
  assert.equal(ctx.VUE_RELIEF.controleGPU(), '');
});

test('autocontrôle : des écarts nombreux, refusé', () => {
  const { ctx } = monter((t) => { for (let i = 0; i < t.N; i += 50) t.mnt[i] += 1; });
  assert.match(ctx.VUE_RELIEF.controleGPU(), /altitude/);
});

test('couches sur la carte graphique, surface au processeur', () => {
  const { ctx } = monter(false);
  ctx.GPU_RELIEF.horizons = (t) => ({ svf: new Float32Array(t.N).fill(0.42), ouverturePositive: new Float32Array(t.N), ouvertureNegative: new Float32Array(t.N) });
  const m = ctx.VUE_RELIEF.creer({ moteur: 'cpu', couches: 'gpu' });
  assert.equal(m.moteur, 'cpu');
  m.ajouter(bloc('a'));
  const geo = ctx.VUE_GRILLE.definir({ xmin: 0, xmax: 10, ymin: 0, ymax: 10 }, 0.5, 0, 4096);
  const c = m.calculer(geo, 'svf');
  assert.equal(c.moteurSurface, 'cpu');
  assert.equal(c.moteurCouche, 'gpu');
  assert.equal(c.valeurs[0], Math.fround(0.42));
});
