// La date d'acquisition d'une dalle, telle que l'IGN la publie : une plage de
// jours (`date_debut_acquisition` → `date_fin_acquisition`), pas un instant. Le
// « Point sélectionné » la montre pour la dalle où le point se trouve.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const ctx = chargerScripts(['config.js', 'proj.js', 'ign.js']);
const { IGN } = ctx;

test('formaterAcquisition : un seul jour, une plage dans le mois, à cheval sur deux mois ou deux années', () => {
  const f = (d, e) => IGN.formaterAcquisition(d, e);
  assert.equal(f('2022-07-13', '2022-07-13'), '13 juillet 2022');
  assert.equal(f('2022-07-12', '2022-07-13'), '12–13 juillet 2022');
  assert.equal(f('2022-06-28', '2022-07-02'), '28 juin – 2 juillet 2022');
  assert.equal(f('2022-12-30', '2023-01-02'), '30 décembre 2022 – 2 janvier 2023');
  assert.equal(f('2023-12-01', '2023-12-01'), '1er décembre 2023');   // le premier du mois s'écrit « 1er »
});

test('formaterAcquisition : un bout manquant garde l’autre, rien ne s’invente', () => {
  const f = (d, e) => IGN.formaterAcquisition(d, e);
  assert.equal(f(null, '2022-07-14'), '14 juillet 2022');
  assert.equal(f('2022-07-12', null), '12 juillet 2022');
  assert.equal(f(null, null), null);
  assert.equal(f('', undefined), null);
  assert.equal(f('pas une date', '2022-13-45'), null);   // mois ou jour impossible : pas de date
});

test('formaterAcquisition : des bornes inversées sont remises dans l’ordre', () => {
  assert.equal(IGN.formaterAcquisition('2022-07-14', '2022-07-12'), '12–14 juillet 2022');
});

test('dalles : la plage d’acquisition (début et fin) vient des métadonnées de chaque dalle', async () => {
  ctx.RESEAU = {
    recuperer: async () => ({
      features: [{
        id: 'a', geometry: null,
        properties: {
          url_npl: 'https://ign/LHD_FXX_0541_6198_PTS_LAMB93_IGN69.copc.laz',
          metadata: JSON.stringify({ date_debut_acquisition: '2022-07-12', date_fin_acquisition: '2022-07-13', nombre_points: 5 }),
        },
      }, {
        id: 'b', geometry: null,
        properties: { url_npl: 'https://ign/LHD_FXX_0542_6198_PTS_LAMB93_IGN69.copc.laz', metadata: '{}' },
      }],
    }),
  };
  const liste = await IGN.dalles(42.8, 1.0, 42.9, 1.1);
  assert.equal(liste[0].dateDebutAcquisition, '2022-07-12');
  assert.equal(liste[0].dateAcquisition, '2022-07-13');
  assert.equal(liste[1].dateDebutAcquisition, null);   // métadonnée absente : null, pas une date inventée
  assert.equal(liste[1].dateAcquisition, null);
});

// Le format réel du service depuis octobre 2026 (relevé sur data.geopf.fr) : plus de champ `metadata` en JSON, les
// champs sont directement des propriétés de la dalle, et les dates portent un Z final (« 2025-02-01Z »).

test('formaterAcquisition : une date de l’IGN avec le Z final (2025-02-01Z) se lit comme les autres', () => {
  const f = (d, e) => IGN.formaterAcquisition(d, e);
  assert.equal(f('2025-02-01Z', '2025-02-01Z'), '1er février 2025');
  assert.equal(f('2022-07-12Z', '2022-07-13Z'), '12–13 juillet 2022');
  assert.equal(f('2022-07-12T00:00:00Z', null), '12 juillet 2022');   // et une heure éventuelle
});

test('dalles : les dates d’acquisition et le reste se lisent aussi en propriétés directes (sans champ metadata)', async () => {
  ctx.RESEAU = {
    recuperer: async () => ({
      features: [{
        id: 'v', geometry: null,
        properties: {
          url_npl: 'https://ign/LHD_FXX_0877_6905_PTS_LAMB93_IGN69.copc.laz',
          date_debut_acquisition: '2025-02-01Z', date_fin_acquisition: '2025-02-01Z', nombre_points: 7, systeme_altimetrique: 'IGN69',
        },
      }, {
        id: 'w', geometry: null,
        properties: { url_npl: 'https://ign/LHD_FXX_0878_6905_PTS_LAMB93_IGN69.copc.laz' },
      }],
    }),
  };
  const liste = await IGN.dalles(49.2, 5.4, 49.3, 5.5);
  assert.equal(liste[0].dateDebutAcquisition, '2025-02-01Z');
  assert.equal(liste[0].dateAcquisition, '2025-02-01Z');
  assert.equal(liste[0].nbPoints, 7);
  assert.equal(liste[0].systemeAltimetrique, 'IGN69');
  assert.equal(IGN.formaterAcquisition(liste[0].dateDebutAcquisition, liste[0].dateAcquisition), '1er février 2025');
  assert.equal(liste[1].dateDebutAcquisition, null);   // sans date publiée : null, jamais inventée
});
