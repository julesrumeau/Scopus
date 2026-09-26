// Lien partageable : `#map=zoom/lat/lon[/orientation[/inclinaison]]`.
//
// Le format n'est pas le nôtre : c'est celui d'osm.org pour les trois premiers
// champs, et celui de MapLibre pour les deux derniers. Ce qui compte donc ici,
// c'est qu'un lien écrit par Scopus soit lu juste **par les autres** — d'où la
// lecture façon osm.org rejouée plus bas, et les conventions d'angle éprouvées
// contre le vrai repère caméra (`Vue3D._repere`), pas contre une formule
// recopiée dans le test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const ctx = chargerScripts(['lien.js', 'vue3d.js']);
const { LIEN, Vue3D } = ctx;

const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg} : ${a} au lieu de ${b}`);

test('une vue de carte s’écrit comme sur osm.org, sans champ en trop', () => {
  assert.equal(LIEN.ecrire({ zoom: 15, lat: 49.21041, lon: 5.43125 }), 'map=15/49.21041/5.43125');
});

test('orientation et inclinaison ne s’écrivent que si elles ne sont pas nulles', () => {
  assert.equal(LIEN.ecrire({ zoom: 17, lat: 48.27, lon: -4.58, orientation: 70, inclinaison: 50 }),
    'map=17/48.27/-4.58/70/50');
  // Comme MapLibre : une orientation seule garde sa place, une inclinaison
  // seule force l'orientation à 0 pour rester à la cinquième position.
  assert.equal(LIEN.ecrire({ zoom: 17, lat: 48.27, lon: -4.58, orientation: 70 }), 'map=17/48.27/-4.58/70');
  assert.equal(LIEN.ecrire({ zoom: 17, lat: 48.27, lon: -4.58, inclinaison: 40 }), 'map=17/48.27/-4.58/0/40');
});

test('la précision suit le zoom : assez pour le demi-pixel, pas plus', () => {
  const loin = LIEN.ecrire({ zoom: 6, lat: 46.123456789, lon: 2.123456789 });
  const pres = LIEN.ecrire({ zoom: 19, lat: 46.123456789, lon: 2.123456789 });
  assert.equal(loin, 'map=6/46.12/2.12');
  assert.equal(pres, 'map=19/46.123457/2.123457');
});

test('un zoom fractionnaire garde deux décimales, un zoom entier aucune', () => {
  assert.equal(LIEN.ecrire({ zoom: 16.4567, lat: 45, lon: 1 }).split('/')[0], 'map=16.46');
  assert.equal(LIEN.ecrire({ zoom: 16.0001, lat: 45, lon: 1 }).split('/')[0], 'map=16');
});

test('l’orientation est ramenée dans [0, 360)', () => {
  assert.equal(LIEN.ecrire({ zoom: 17, lat: 45, lon: 1, orientation: -90, inclinaison: 30 }).split('/')[3], '270');
  assert.equal(LIEN.ecrire({ zoom: 17, lat: 45, lon: 1, orientation: 360, inclinaison: 30 }).split('/')[3], '0');
});

test('lire rend ce qu’écrire a produit', () => {
  const v = { zoom: 17.25, lat: 48.2700695, lon: -4.5799863, orientation: 70, inclinaison: 50 };
  const lu = LIEN.lire('#' + LIEN.ecrire(v));
  assert.equal(lu.zoom, 17.25);
  proche(lu.lat, v.lat, 1e-6, 'latitude');
  proche(lu.lon, v.lon, 1e-6, 'longitude');
  assert.equal(lu.orientation, 70);
  assert.equal(lu.inclinaison, 50);
});

test('lire accepte les liens des autres : osm.org, MapLibre, paramètres en plus', () => {
  assert.deepEqual({ ...LIEN.lire('#map=19/48.2700695/-4.5799863') },
    { zoom: 19, lat: 48.2700695, lon: -4.5799863, orientation: 0, inclinaison: 0 });
  // osm.org ajoute `&layers=` ; un greffon peut en ajouter d'autres.
  assert.equal(LIEN.lire('#map=12/45.5/1.2&layers=C').zoom, 12);
  assert.equal(LIEN.lire('#layers=C&map=12/45.5/1.2').lat, 45.5);
});

test('lire refuse ce qui n’est pas une position, au lieu de viser n’importe où', () => {
  for (const h of ['', '#', '#map=', '#map=12/45', '#map=a/b/c', '#map=12/95/1', '#map=12/45/200',
    '#map=99/45/1', '#autre=1']) {
    assert.equal(LIEN.lire(h), null, h);
  }
});

test('les anciens liens `#d=x,y` restent lisibles', () => {
  assert.deepEqual({ ...LIEN.lire('#d=877,6904').dalle }, { x: 877, y: 6904 });
  assert.equal(LIEN.lire('#d=877'), null);
});

test('un lien Scopus se lit comme osm.org le lit', () => {
  // Reprise d'`OSM.parseHash` (openstreetmap-website, osm.js.erb) : seuls les
  // trois premiers champs, zoom par `parseInt`. Tout ce qui suit est ignoré.
  const osm = (hash) => {
    const m = (new URLSearchParams(hash.slice(hash.indexOf('#') + 1)).get('map') || '').split('/');
    return { zoom: parseInt(m[0], 10), lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  };
  const h = '#' + LIEN.ecrire({ zoom: 17.6, lat: 49.2104, lon: 5.4312, orientation: 70, inclinaison: 50 });
  assert.deepEqual(osm(h), { zoom: 17, lat: 49.2104, lon: 5.4312 });
});

test('zoom et résolution au sol : aller-retour, et la convention Leaflet', () => {
  // Zoom 0 : un monde de 256 px, soit 156 543 m/px à l'équateur.
  proche(LIEN.resolutionDepuisZoom(0, 0), 156543.034, 1e-3, 'zoom 0 à l’équateur');
  // À 60° de latitude la résolution est divisée par deux.
  proche(LIEN.resolutionDepuisZoom(10, 60), 156543.034 / 1024 / 2, 1e-6, 'zoom 10 à 60°');
  for (const z of [3, 11.5, 19]) {
    proche(LIEN.zoomDepuisResolution(LIEN.resolutionDepuisZoom(z, 46), 46), z, 1e-9, `zoom ${z}`);
  }
});

/** Direction de visée horizontale de la vraie caméra, en (est, nord). */
function visee(azimut, elevation) {
  const cam = Object.create(Vue3D.prototype);
  cam.cam = { cible: [0, 0, 0], distance: 100, azimut, elevation };
  const { avant } = cam._repere();
  // Repère de la scène : X vers l'est, Z vers le sud (voir boussole.js).
  return { est: avant[0], nord: -avant[2], bas: -avant[1] };
}

test('orientation 90 : la caméra regarde vers l’est', () => {
  const { azimut, elevation } = LIEN.cameraDepuisOrientation(90, 45);
  const v = visee(azimut, elevation);
  assert.ok(v.est > 0.5 && Math.abs(v.nord) < 1e-9, JSON.stringify(v));
});

test('orientation 0 : vers le nord ; 180 : vers le sud', () => {
  let c = LIEN.cameraDepuisOrientation(0, 45);
  assert.ok(visee(c.azimut, c.elevation).nord > 0.5);
  c = LIEN.cameraDepuisOrientation(180, 45);
  assert.ok(visee(c.azimut, c.elevation).nord < -0.5);
});

test('inclinaison : 0 regarde à la verticale, 60 regarde à 30° sous l’horizon', () => {
  let c = LIEN.cameraDepuisOrientation(0, 0);
  assert.ok(visee(c.azimut, c.elevation).bas > 0.999);
  c = LIEN.cameraDepuisOrientation(0, 60);
  proche(visee(c.azimut, c.elevation).bas, Math.sin(30 * Math.PI / 180), 1e-9, 'pente de visée');
});

test('caméra → lien → caméra : les angles reviennent', () => {
  for (const [a, e] of [[-Math.PI / 4, 0.55], [1.2, 0.3], [2.9, -0.4], [0, 1.0]]) {
    const o = LIEN.orientationDepuisCamera(a, e);
    const c = LIEN.cameraDepuisOrientation(o.orientation, o.inclinaison);
    const v1 = visee(a, e), v2 = visee(c.azimut, c.elevation);
    for (const k of ['est', 'nord', 'bas']) proche(v2[k], v1[k], 1e-9, k);
  }
});

test('la vue de dessus de Scopus s’écrit sans inclinaison', () => {
  // `vueDeDessus` s'arrête à 1,553 rad, un poil sous la verticale : écrire
  // « /1 » au bout de chaque lien de vue de dessus serait du bruit.
  assert.equal(LIEN.orientationDepuisCamera(0, 1.553).inclinaison, 0);
});
