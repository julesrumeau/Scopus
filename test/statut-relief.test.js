// Ce que le statut dit de l'état du relief : une phrase pour l'utilisateur, plus un détail chiffré en
// diagnostic (« &debug », « &chrono »). Pures : l'état arrive en paramètre.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { STATUT_RELIEF } = chargerScripts(['statut-relief.js']);

const base = { e: { attente: 0, tropLarge: false, echecs: 0, sansLidar: false }, lenteIGN: false, erreurRelief: '',
  texteRelief: 'relief x', diagnostic: false, reliefAffiche: true, sansLidar: '', surfaceMaxKm2: 60, milliers: String };
const dire = (o) => STATUT_RELIEF.message({ ...base, ...o, e: { ...base.e, ...(o.e || {}) } });

test('tout est à jour', () => {
  assert.deepEqual({ ...dire({}) }, { texte: 'Relief à jour', genre: undefined });
});

test('pas encore de texte de relief : en calcul', () => {
  assert.equal(dire({ texteRelief: '' }).texte, 'Relief en calcul…');
});

test('des blocs attendus : en cours d’affinage, en « travail »', () => {
  const r = dire({ e: { attente: 3 } });
  assert.equal(r.texte, 'Relief en cours d’affinage…');
  assert.equal(r.genre, 'travail');
});

test('des blocs attendus pendant une lenteur de l’IGN : « Chargement ralenti »', () => {
  assert.equal(dire({ e: { attente: 3 }, lenteIGN: true }).texte, 'Chargement ralenti');
});

test('trop large : zoomez, seulement si un côté porte du relief', () => {
  assert.equal(dire({ e: { tropLarge: true } }).texte, 'Zoomez pour calculer le relief');
  assert.equal(dire({ e: { tropLarge: true }, reliefAffiche: false }).texte, 'Aucune couche de relief affichée');
});

test('aucune couche de relief affichée', () => {
  assert.equal(dire({ reliefAffiche: false }).texte, 'Aucune couche de relief affichée');
});

test('des dalles en échec : le nombre (au pluriel s’il le faut), la raison, et le genre « erreur »', () => {
  const un = dire({ e: { echecs: 1, erreur: 'réseau' } });
  assert.equal(un.texte, '1 dalle en échec, réessai en cours : réseau');
  assert.equal(un.genre, 'erreur');
  assert.equal(dire({ e: { echecs: 2, erreur: 'x' } }).texte, '2 dalles en échec, réessai en cours : x');
});

test('une erreur du calcul du relief passe avant « à jour », et le genre est « erreur »', () => {
  const r = dire({ erreurRelief: 'boom' });
  assert.equal(r.texte, 'Le relief n’a pas pu être calculé : boom');
  assert.equal(r.genre, 'erreur');
});

test('pas de LiDAR : la phrase passe avant tout le reste', () => {
  assert.equal(dire({ sansLidar: 'Pas de LiDAR HD ici', e: { echecs: 1, erreur: 'x' } }).texte, 'Pas de LiDAR HD ici');
});

test('diagnostic : le détail chiffré', () => {
  const r = dire({ diagnostic: true, e: { surfaceKm2: 1.234, dallesOuvertes: 2, charges: 14, points: 1234567, attente: 0 }, texteRelief: 'relief g 1 s' });
  assert.equal(r.texte, 'Flux : 1.2 km² · 2 dalles · 14 blocs · 1234567 points · relief g 1 s');
});

test('diagnostic, trop large : la surface et le seuil', () => {
  const r = dire({ diagnostic: true, texteRelief: '', e: { tropLarge: true, surfaceKm2: 120.4 } });
  assert.equal(r.texte, 'Flux : 120 km² affichés, trop pour les points (seuil 60 km²) : zoomez');
});

test('la ligne d’état du panneau : blocs attendus, au pluriel s’il le faut ; vide si trop large', () => {
  assert.equal(STATUT_RELIEF.ligneAttente({ attente: 1, tropLarge: false }), 'Affinage… 1 bloc attendu');
  assert.equal(STATUT_RELIEF.ligneAttente({ attente: 4, tropLarge: false }), 'Affinage… 4 blocs attendus');
  assert.equal(STATUT_RELIEF.ligneAttente({ attente: 4, tropLarge: true }), '');
  assert.equal(STATUT_RELIEF.ligneAttente({ attente: 0, tropLarge: false }), '');
});
