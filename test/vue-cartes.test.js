// La gestion des cartes de la vue normale : les volets (une carte, son calque, ses côtés), le passage d'un
// mode à l'autre (scindée, une seule, deux cartes synchronisées) et les crédits réunis. La fabrique ne
// connaît ni le DOM ni Leaflet : tout lui est passé (dépendances explicites) — d'où des cartes factices.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { creerVueCartes, creerCreditsReunis, VOLETS, MODE_CARTE, SYNCHRO } = chargerScripts(['mode-carte.js', 'volets.js', 'synchro.js', 'vue-cartes.js']);

/** Une carte Leaflet factice : écouteurs, vue, couches, cadre de crédits. */
function carteLeaflet(nom, centre = { lat: 49.3, lng: 5.4 }, zoom = 16) {
  const ecouteurs = {};
  const credits = new Map();
  const cadre = { style: { display: '' } };
  const c = {
    nom, centre, zoom, couches: [], taille: 0, cadre, credits,
    on(evs, f) { for (const e of evs.split(' ')) (ecouteurs[e] ||= []).push(f); return c; },
    off(evs, f) { for (const e of evs.split(' ')) ecouteurs[e] = (ecouteurs[e] || []).filter((g) => g !== f); return c; },
    emettre(e, arg) { for (const f of [...(ecouteurs[e] || [])]) f(arg); },
    nbEcouteurs(e) { return (ecouteurs[e] || []).length; },
    getCenter() { return c.centre; }, getZoom() { return c.zoom; },
    setView(ctr, z) { c.centre = ctr; c.zoom = z; c.emettre('move'); },
    invalidateSize() { c.taille++; },
    eachLayer(f) { c.couches.forEach(f); },
    attributionControl: {
      getContainer: () => cadre,
      addAttribution: (t) => credits.set(t, (credits.get(t) || 0) + 1),
      removeAttribution: (t) => credits.set(t, (credits.get(t) || 0) - 1),
    },
  };
  return c;
}
const couche = (credit) => ({ getAttribution: () => credit });

/** Un calque de relief factice : ce qu'on lui a demandé. */
function calque(nom) {
  const c = { nom, unique: undefined, appels: [], definirUnique(v) { c.unique = v; c.appels.push(['unique', v]); }, definirFond(cote, f) { c.appels.push(['fond', cote, f]); }, vider(cote) { c.appels.push(['vider', cote]); } };
  return c;
}

/** Les dépendances, et la trace de ce que la fabrique en a fait. */
function monde() {
  const trace = { apres: [], oublies: [], secondaires: 0, montrer: [], marques: [], curseurs: [], deplacements: 0, cacher: 0 };
  const principale = carteLeaflet('A');
  const calqueA = calque('A');
  let calqueB = null, secondaire = null;
  const deps = {
    carte: { map: principale, invalider: () => { trace.invalide = (trace.invalide || 0) + 1; } },
    calquePrincipal: calqueA,
    creerCarteSecondaire: (vue) => { trace.secondaires++; secondaire = carteLeaflet('B', vue.centre, vue.zoom); return secondaire; },
    creerCalque: () => { calqueB = calque('B'); return calqueB; },
    creerRepere: () => ({ deplacer() { trace.deplacements++; }, cacher() { trace.cacher++; } }),
    brancherCurseur: (map, volet) => trace.curseurs.push([map.nom, volet.cotes.join('+')]),
    surDeplacement: () => { trace.deplacements++; },
    affichage: { montrerSecondaire: (v) => trace.montrer.push(v), marquerMode: (m) => trace.marques.push(m) },
    oublierFond: (cote) => trace.oublies.push(cote),
    apres: (mode) => trace.apres.push(mode),
    VOLETS, MODE_CARTE, SYNCHRO,
  };
  return { deps, trace, principale, calqueA, calqueB: () => calqueB, secondaire: () => secondaire };
}

test('au départ : carte scindée, un seul volet qui porte les deux côtés', () => {
  const m = monde();
  const v = creerVueCartes(m.deps);
  assert.equal(v.mode(), 'scinde');
  assert.equal(v.volets().length, 1);
  assert.equal(v.voletDe('gauche'), v.voletDe('droite'));
  assert.deepEqual([...v.voletDe('gauche').cotes], ['gauche', 'droite']);
});

test('une seule carte : la gauche en entier, un seul volet, la carte redimensionnée, le reste prévenu', () => {
  const m = monde();
  const v = creerVueCartes(m.deps);
  v.changerMode('unique');
  assert.equal(v.mode(), 'unique');
  assert.equal(m.calqueA.unique, 'gauche');
  assert.equal(v.volets().length, 1);
  assert.equal(m.trace.secondaires, 0, 'aucune seconde carte');
  assert.equal(m.trace.invalide, 1);
  assert.deepEqual(m.trace.apres, ['unique']);
  assert.deepEqual(m.trace.marques, ['unique']);
});

test('deux cartes : la seconde est créée une fois, un côté par volet', () => {
  const m = monde();
  const v = creerVueCartes(m.deps);
  v.changerMode('double');
  assert.equal(m.trace.secondaires, 1);
  assert.equal(v.volets().length, 2);
  assert.equal(v.voletDe('gauche').calque, m.calqueA);
  assert.equal(v.voletDe('droite').calque, m.calqueB());
  assert.deepEqual([...v.voletDe('gauche').cotes], ['gauche']);
  assert.deepEqual([...v.voletDe('droite').cotes], ['droite']);
  assert.equal(m.calqueA.unique, 'gauche');
  assert.equal(m.calqueB().unique, 'droite');
  assert.deepEqual(m.trace.montrer, [true]);
  // La seconde carte naît à la vue de la première.
  assert.deepEqual({ ...m.secondaire().centre }, { lat: 49.3, lng: 5.4 });
  assert.equal(m.secondaire().taille, 1, 'redimensionnée');
  // Le curseur est branché sur la seconde carte, avec son volet.
  assert.deepEqual(m.trace.curseurs, [['B', 'droite']]);
});

test('deux cartes : revenir en deux cartes ne recrée rien et ne double aucun écouteur', () => {
  const m = monde();
  const v = creerVueCartes(m.deps);
  v.changerMode('double');
  v.changerMode('scinde');
  v.changerMode('double');
  assert.equal(m.trace.secondaires, 1);
  assert.equal(m.trace.curseurs.length, 1, 'le curseur n’est branché qu’une fois');
  assert.equal(m.principale.nbEcouteurs('layeradd'), 1, 'les crédits ne sont écoutés qu’une fois');
});

test('deux cartes : le déplacement de l’une se retrouve sur l’autre', () => {
  const m = monde();
  const v = creerVueCartes(m.deps);
  v.changerMode('double');
  m.principale.centre = { lat: 48.1, lng: 2.2 }; m.principale.zoom = 18; m.principale.emettre('move');
  assert.equal(m.secondaire().getCenter().lat, 48.1);
  assert.equal(m.secondaire().getZoom(), 18);
});

test('retour en carte scindée : un volet, les deux côtés, plus de synchro, repères cachés, seconde carte masquée', () => {
  const m = monde();
  const v = creerVueCartes(m.deps);
  v.changerMode('double');
  v.changerMode('scinde');
  assert.equal(v.volets().length, 1);
  assert.deepEqual([...v.voletDe('droite').cotes], ['gauche', 'droite']);
  assert.equal(m.calqueA.unique, null);
  assert.deepEqual(m.trace.montrer, [true, false]);
  assert.ok(m.trace.cacher >= 2, 'les repères des deux cartes sont cachés');
  m.principale.centre = { lat: 10, lng: 10 }; m.principale.emettre('move');
  assert.notEqual(m.secondaire().getCenter().lat, 10, 'la synchro est défaite');
});

test('à chaque changement de mode : les fonds et les images repartent à blanc, côté par côté, avant le calque', () => {
  const m = monde();
  const v = creerVueCartes(m.deps);
  v.changerMode('double');
  assert.deepEqual(m.trace.oublies, ['gauche', 'droite']);
  // En carte scindée le volet unique porte les deux côtés : le calque principal les remet à blanc tous les deux.
  assert.deepEqual(m.calqueA.appels.filter((a) => a[0] !== 'unique').map((a) => a.map(String).join(':')), ['fond:gauche:null', 'vider:gauche', 'fond:droite:null', 'vider:droite']);
  m.calqueA.appels.length = 0;
  v.changerMode('scinde');   // maintenant 'droite' est porté par le calque de la seconde carte
  assert.deepEqual(m.calqueB().appels.filter((a) => a[0] !== 'unique').map((a) => a.map(String).join(':')), ['fond:droite:null', 'vider:droite']);
});

test('un mode inconnu est refusé : rien ne change', () => {
  const m = monde();
  const v = creerVueCartes(m.deps);
  v.changerMode('bidon');
  assert.equal(v.mode(), 'scinde');
  assert.deepEqual(m.trace.apres, []);
});

// ── Les crédits, une seule fois ─────────────────────────────────────────────

test('crédits réunis : le cadre de la première est masqué, la seconde porte tout, sans doublon', () => {
  const a = carteLeaflet('A'), b = carteLeaflet('B');
  a.couches = [couche('IGN'), couche('OSM')];
  const credits = creerCreditsReunis(a, () => b);
  credits.reunir(true);
  assert.equal(a.cadre.style.display, 'none');
  assert.equal(b.credits.get('IGN'), 1);
  assert.equal(b.credits.get('OSM'), 1);
  // Une couche qui arrive, une couche qui part.
  a.emettre('layeradd', { layer: couche('IGN') });
  assert.equal(b.credits.get('IGN'), 2, 'Leaflet compte les doublons et n’en affiche qu’un');
  a.emettre('layerremove', { layer: couche('OSM') });
  assert.equal(b.credits.get('OSM'), 0);
});

test('crédits réunis : une couche sans crédit est ignorée', () => {
  const a = carteLeaflet('A'), b = carteLeaflet('B');
  const credits = creerCreditsReunis(a, () => b);
  credits.reunir(true);
  a.emettre('layeradd', { layer: { getAttribution: () => '' } });
  a.emettre('layeradd', { layer: {} });
  assert.equal(b.credits.size, 0);
});

test('crédits défaits : le cadre de la première revient, la seconde est nettoyée, plus d’écouteurs', () => {
  const a = carteLeaflet('A'), b = carteLeaflet('B');
  a.couches = [couche('IGN')];
  const credits = creerCreditsReunis(a, () => b);
  credits.reunir(true);
  a.emettre('layeradd', { layer: couche('IGN') });
  credits.reunir(false);
  assert.equal(a.cadre.style.display, '');
  assert.equal(b.credits.get('IGN'), 0);
  assert.equal(a.nbEcouteurs('layeradd'), 0);
  assert.equal(a.nbEcouteurs('layerremove'), 0);
});
