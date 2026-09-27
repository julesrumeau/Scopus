// Le linéaire de la BD TOPO (routes de toute nature et cours d'eau), vérité
// terrain du banc des tracés. Un faux réseau rend les pages du WFS.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

function monter(pages) {
  const ctx = chargerScripts(['config.js', 'proj.js', 'ign.js']);
  const urls = [];
  ctx.RESEAU = {
    recuperer: async (url) => {
      urls.push(new URL(url));
      const u = new URL(url);
      const couche = u.searchParams.get('TYPENAMES');
      const debut = Number(u.searchParams.get('STARTINDEX'));
      return { features: (pages[couche] || [])[debut / 1000] || [] };
    },
  };
  return { ctx, urls };
}
const ligne = (nature, coords) => ({ properties: { nature }, geometry: { type: 'LineString', coordinates: coords } });
const E = { xmin: 536000, xmax: 537000, ymin: 6213000, ymax: 6214000 };

test('lineaire : routes et cours d’eau, toutes les pages', async () => {
  const mille = Array.from({ length: 1000 }, (_, i) => ligne('Chemin', [[536000 + i * 0.5, 6213100], [536000 + i * 0.5, 6213200]]));
  const { ctx } = monter({
    'BDTOPO_V3:troncon_de_route': [mille, [ligne('Sentier', [[536100, 6213100], [536200, 6213300]]), ligne('Route empierrée', [[536000, 6213000], [536500, 6213500]]), ligne('Chemin', [[1, 2], [3, 4]])]],
    'BDTOPO_V3:troncon_hydrographique': [[ligne('Ecoulement naturel', [[536300, 6213000], [536300, 6214000]])]],
  });
  const l = await ctx.IGN.lineaire(E);
  assert.equal(l.length, 1004);
  assert.equal(l.filter((x) => x.famille === 'eau').length, 1);
  assert.equal(l.find((x) => x.nature === 'Sentier').famille, 'route');
  assert.deepEqual(JSON.parse(JSON.stringify(l.find((x) => x.nature === 'Sentier').points)), [[536100, 6213100], [536200, 6213300]]);
});

test('lineaire : un MultiLineString donne une ligne par partie', async () => {
  const { ctx } = monter({
    'BDTOPO_V3:troncon_de_route': [[{ properties: { nature: 'Chemin' }, geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] } }]],
  });
  assert.equal((await ctx.IGN.lineaire(E)).length, 2);
});

test('lineaire : la BBOX couvre les quatre coins du carré Lambert-93, en EPSG:2154', async () => {
  const { ctx, urls } = monter({});
  await ctx.IGN.lineaire(E);
  const u = urls[0];
  assert.equal(u.searchParams.get('SRSNAME'), 'EPSG:2154');
  const [s, o, n, e] = u.searchParams.get('BBOX').split(',').map(Number);
  for (const [x, y] of [[E.xmin, E.ymin], [E.xmax, E.ymin], [E.xmin, E.ymax], [E.xmax, E.ymax]]) {
    const g = ctx.PROJ.versWGS84(x, y);
    assert.ok(g.lat >= s && g.lat <= n && g.lon >= o && g.lon <= e, `coin ${x},${y} hors de la BBOX`);
  }
});
