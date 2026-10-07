// L'export de la mesure de la carte : une liste de points (longitude, latitude, et si on veut l'altitude du sol)
// en GeoJSON, GPX ou OSM XML. Des fonctions pures : ni DOM ni réseau.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { EXPORT_MESURE } = chargerScripts(['export-mesure.js']);

const A = { lat: 49.2154, lon: 5.4352, sol: 381.64, hauteur: 0 };
const B = { lat: 49.2158, lon: 5.4361, sol: 383.1, hauteur: 12.4 };
const C = { lat: 49.2161, lon: 5.4366, sol: 380.02, hauteur: 0 };
const json = (s) => JSON.parse(s);

// ── GeoJSON ──

test('GeoJSON : une ligne et un point par sommet ; coordonnées [longitude, latitude], rien d’autre par défaut', () => {
  const g = json(EXPORT_MESURE.versGeoJSON([A, B, C], { altitude: false }));
  assert.equal(g.type, 'FeatureCollection');
  const ligne = g.features.find((f) => f.geometry.type === 'LineString');
  assert.deepEqual(ligne.geometry.coordinates, [[5.4352, 49.2154], [5.4361, 49.2158], [5.4366, 49.2161]]);
  const points = g.features.filter((f) => f.geometry.type === 'Point');
  assert.equal(points.length, 3);
  assert.deepEqual(points.map((f) => f.properties.name), ['A', 'B', 'C']);
  assert.deepEqual(points[0].geometry.coordinates, [5.4352, 49.2154], 'longitude d’abord');
  assert.ok(!('ele' in points[0].properties), 'pas d’altitude demandée');
});

test('GeoJSON : avec l’altitude, un troisième nombre (le sol) à chaque position, et la hauteur à part quand il y en a une', () => {
  const g = json(EXPORT_MESURE.versGeoJSON([A, B], { altitude: true }));
  const ligne = g.features.find((f) => f.geometry.type === 'LineString');
  assert.deepEqual(ligne.geometry.coordinates, [[5.4352, 49.2154, 381.64], [5.4361, 49.2158, 383.1]]);
  const [pa, pb] = g.features.filter((f) => f.geometry.type === 'Point');
  assert.deepEqual(pa.geometry.coordinates, [5.4352, 49.2154, 381.64]);
  assert.ok(!('height' in pa.properties), 'pas de sursol en A');
  assert.equal(pb.properties.height, 12.4);
});

test('GeoJSON : un seul point, pas de ligne (une LineString en demande deux au moins)', () => {
  const g = json(EXPORT_MESURE.versGeoJSON([A], { altitude: false }));
  assert.equal(g.features.filter((f) => f.geometry.type === 'LineString').length, 0);
  assert.equal(g.features.filter((f) => f.geometry.type === 'Point').length, 1);
});

test('GeoJSON : les coordonnées sont arrondies au centimètre (7 décimales), pas de bruit de flottant', () => {
  const g = json(EXPORT_MESURE.versGeoJSON([{ lat: 49.215400000000004, lon: 5.435199999999999, sol: 1, hauteur: 0 }], { altitude: false }));
  assert.deepEqual(g.features[0].geometry.coordinates, [5.4352, 49.2154]);
});

// ── GPX ──

test('GPX : un tracé, un segment, un point par sommet, latitude et longitude en attributs', () => {
  const x = EXPORT_MESURE.versGPX([A, B], { altitude: false });
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(x, /<gpx version="1\.1" creator="Scopus" xmlns="http:\/\/www\.topografix\.com\/GPX\/1\/1">/);
  assert.equal((x.match(/<trk>/g) || []).length, 1);
  assert.equal((x.match(/<trkseg>/g) || []).length, 1);
  assert.equal((x.match(/<trkpt /g) || []).length, 2);
  assert.match(x, /<trkpt lat="49\.2154" lon="5\.4352"/);
  assert.ok(!x.includes('<ele>'), 'pas d’altitude demandée');
});

test('GPX : avec l’altitude, une balise <ele> par point, dans l’ordre du schéma (ele avant le reste)', () => {
  const x = EXPORT_MESURE.versGPX([A, B], { altitude: true });
  assert.match(x, /<trkpt lat="49\.2154" lon="5\.4352"><ele>381\.64<\/ele><\/trkpt>/);
  assert.match(x, /<ele>383\.1<\/ele>/);
});

// ── OSM XML ──

test('OSM XML : un nœud par sommet (identifiants négatifs), un chemin qui les relie, jamais de nom ni d’étiquette inventée', () => {
  const x = EXPORT_MESURE.versOSM([A, B, C], { altitude: false });
  assert.match(x, /^<\?xml version='1\.0' encoding='UTF-8'\?>/);
  assert.match(x, /<osm version='0\.6' generator='Scopus' upload='false'>/);
  assert.deepEqual([...x.matchAll(/<node id='(-\d+)'/g)].map((m) => m[1]), ['-1', '-2', '-3']);
  assert.match(x, /<node id='-1' visible='true' lat='49\.2154' lon='5\.4352'/);
  assert.deepEqual([...x.matchAll(/<nd ref='(-\d+)'\/>/g)].map((m) => m[1]), ['-1', '-2', '-3']);
  assert.match(x, /<way id='-4' visible='true'>/);
  assert.ok(!x.includes('<tag'), 'aucune étiquette sans l’altitude : un nom ou un tag inventé pollue OSM');
});

test('OSM XML : avec l’altitude, ele (le sol) et height (le sursol) sur le nœud', () => {
  const x = EXPORT_MESURE.versOSM([A, B], { altitude: true });
  assert.match(x, /<node id='-1'[^>]*><tag k='ele' v='381\.64'\/><\/node>/);
  assert.match(x, /<node id='-2'[^>]*><tag k='ele' v='383\.1'\/><tag k='height' v='12\.4'\/><\/node>/);
});

test('OSM XML : un seul point, un nœud et pas de chemin', () => {
  const x = EXPORT_MESURE.versOSM([A], { altitude: false });
  assert.equal((x.match(/<node /g) || []).length, 1);
  assert.ok(!x.includes('<way'));
});

// ── Altitude, nom, types ──

test('altitudeDisponible : vraie seulement si TOUS les points ont une altitude du sol', () => {
  assert.equal(EXPORT_MESURE.altitudeDisponible([A, B, C]), true);
  assert.equal(EXPORT_MESURE.altitudeDisponible([A, { ...B, sol: null }, C]), false);
  assert.equal(EXPORT_MESURE.altitudeDisponible([{ ...A, sol: undefined }]), false);
  assert.equal(EXPORT_MESURE.altitudeDisponible([]), false);
});

test('une altitude demandée mais incomplète n’est jamais écrite à moitié : aucun point n’en porte', () => {
  const pts = [A, { ...B, sol: null }];
  assert.ok(!EXPORT_MESURE.versGeoJSON(pts, { altitude: true }).includes('381.64'));
  assert.ok(!EXPORT_MESURE.versGPX(pts, { altitude: true }).includes('<ele>'));
  assert.ok(!EXPORT_MESURE.versOSM(pts, { altitude: true }).includes("k='ele'"));
});

test('nomFichier : scopus-mesure-AAAA-MM-JJ avec l’extension du format', () => {
  const d = new Date(2026, 9, 7);
  assert.equal(EXPORT_MESURE.nomFichier('geojson', d), 'scopus-mesure-2026-10-07.geojson');
  assert.equal(EXPORT_MESURE.nomFichier('gpx', d), 'scopus-mesure-2026-10-07.gpx');
  assert.equal(EXPORT_MESURE.nomFichier('osm', d), 'scopus-mesure-2026-10-07.osm');
});

test('formats : les trois, avec leur type MIME ; GeoJSON en premier (le défaut)', () => {
  assert.equal(EXPORT_MESURE.formats.map((f) => f.cle).join(), 'geojson,gpx,osm');
  assert.equal(EXPORT_MESURE.formats[0].type, 'application/geo+json');
});

test('exporter : le contenu, le nom et le type d’un format donné', () => {
  const f = EXPORT_MESURE.exporter('gpx', [A, B], { altitude: true }, new Date(2026, 9, 7));
  assert.equal(f.nom, 'scopus-mesure-2026-10-07.gpx');
  assert.equal(f.type, 'application/gpx+xml');
  assert.match(f.contenu, /<gpx /);
  assert.throws(() => EXPORT_MESURE.exporter('shp', [A], {}), /format/i);
});

// ── Ce que la fenêtre affiche ──

test('resumer : le nombre de points, s’il y a un tracé, et si l’altitude est disponible', () => {
  const r = EXPORT_MESURE.resumer([A, B, C]);
  assert.equal(r.n, 3);
  assert.equal(r.tracé, true);
  assert.equal(r.altitudeDisponible, true);
  assert.match(r.texte, /3 points/);
  assert.match(r.texte, /tracé/);
});

test('resumer : un point, pas de tracé, singulier', () => {
  const r = EXPORT_MESURE.resumer([A]);
  assert.equal(r.tracé, false);
  assert.match(r.texte, /1 point\b/);
  assert.ok(!/points/.test(r.texte));
});

test('resumer : une altitude manquante est dite en clair, jamais devinée', () => {
  const r = EXPORT_MESURE.resumer([A, { ...B, sol: null }]);
  assert.equal(r.altitudeDisponible, false);
  assert.match(r.raisonAltitude, /altitude|inconnue/i);
  assert.equal(EXPORT_MESURE.resumer([A, B]).raisonAltitude, '');
});

// ── Les lecteurs légers (uMap lit le .osm avec osm2geojson) n'aiment pas un élément vide à balise fermante ──

test('OSM : un nœud sans étiquette s’écrit auto-fermé (<node ... />), jamais <node ...></node> que uMap ne sait pas lire', () => {
  const x = EXPORT_MESURE.versOSM([A, B, C], { altitude: false });
  assert.match(x, /<node id='-1' visible='true' lat='49\.2154' lon='5\.4352'\/>/);
  assert.ok(!/><\/node>/.test(x), 'aucun nœud vide à balise fermante');
});

test('OSM : un nœud avec étiquettes garde ses enfants et sa balise fermante', () => {
  const x = EXPORT_MESURE.versOSM([A, B], { altitude: true });
  assert.match(x, /<node id='-1' visible='true' lat='49\.2154' lon='5\.4352'><tag k='ele' v='381\.64'\/><\/node>/);
});

test('GPX : un point sans altitude s’écrit aussi auto-fermé (<trkpt ... />)', () => {
  const x = EXPORT_MESURE.versGPX([A, B], { altitude: false });
  assert.match(x, /<trkpt lat="49\.2154" lon="5\.4352"\/>/);
  assert.ok(!/><\/trkpt>/.test(x));
});
