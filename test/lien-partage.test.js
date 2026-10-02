// Le lien du profil (R2) : la coupe, ses points, ses classes et la sélection
// dans le fragment, après `map=`, comme osm.org y ajoute `&layers=`.
//
// Ce qui compte ici : (1) un lien écrit se relit à l'identique ; (2) il se lit
// juste **chez les autres** — osm.org ignore ce qu'il ne connaît pas — et reste
// cliquable dans un forum (pas de virgule, de parenthèse, de guillemet ni de
// `+`) ; (3) un paramètre abîmé est ignoré **en bloc**, jamais à moitié : un
// profil à demi lu serait pire qu'un profil absent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { LIEN } = chargerScripts(['lien.js']);

// Les objets du contexte `vm` n'ont pas les prototypes d'ici : on compare leur JSON.
const plat = (v) => JSON.parse(JSON.stringify(v));

const A = { lat: 42.857552, lon: 1.052198 };
const B = { lat: 42.859801, lon: 1.057456 };

/** Un état complet : coupe ouverte, mesure, référence, sélection. */
const complet = () => ({
  profil: { a: A, b: B, largeur: 3 },
  coupe: true,
  classes: [6, 2, 5],
  mesure: [{ s: 12.3, z: 1500.1 }, { s: 25.5, z: 1503.2 }],
  ref: { s: 0, z: 1500.1 },
  sel: { lat: 42.857536, lon: 1.061833 },
});

const EXEMPLE = '&profil=42.857552/1.052198/42.859801/1.057456/3&coupe=1&classes=2.5.6'
  + '&mesure=12.3/1500.1/25.5/1503.2&ref=0/1500.1&sel=42.857536/1.061833';

// ── Écrire ───────────────────────────────────────────────────────────────────

test('ecrirePartage : rien à dire, rien d’écrit', () => {
  assert.equal(LIEN.ecrirePartage({}), '');
  assert.equal(LIEN.ecrirePartage(undefined), '');
  assert.equal(LIEN.ecrirePartage(null), '');
});

test('ecrirePartage : la bande seule — deux points et la largeur', () => {
  assert.equal(LIEN.ecrirePartage({ profil: { a: A, b: B, largeur: 3 } }), '&profil=42.857552/1.052198/42.859801/1.057456/3');
});

test('ecrirePartage : l’état complet, dans l’ordre fixe, classes triées', () => {
  assert.equal(LIEN.ecrirePartage(complet()), EXEMPLE);
});

test('ecrirePartage : les nombres sont arrondis et sans zéros de queue ni « -0 »', () => {
  const s = LIEN.ecrirePartage({
    profil: { a: { lat: 42.85755264, lon: 1.0521980 }, b: { lat: 42.859801, lon: -0.0000001 }, largeur: 2.50 },
    coupe: true,
    mesure: [{ s: 12.30, z: 1500.104 }],
    ref: { s: -0.001, z: 1500 },
  });
  assert.match(s, /profil=42\.857553\/1\.052198\/42\.859801\/0\/2\.5/);   // 6 décimales, 1 pour la largeur, -1e-7 → 0
  assert.match(s, /mesure=12\.3\/1500\.1(&|$)/);                            // 2 décimales
  assert.match(s, /ref=0\/1500(&|$)/);                                       // -0.001 → 0, jamais « -0 »
  assert.doesNotMatch(s, /-0(\/|&|$)/);
});

test('ecrirePartage : sans bande, la coupe, les classes, la mesure et la référence n’ont aucun sens', () => {
  const { profil, ...sansBande } = complet();
  assert.equal(LIEN.ecrirePartage(sansBande), '&sel=42.857536/1.061833');   // seule la sélection reste
});

test('ecrirePartage : modale fermée, ni classes ni mesure ni référence', () => {
  const e = { ...complet(), coupe: false };
  assert.equal(LIEN.ecrirePartage(e), '&profil=42.857552/1.052198/42.859801/1.057456/3&sel=42.857536/1.061833');
});

test('ecrirePartage : des classes vides ne s’écrivent pas, des doublons s’écrivent une fois', () => {
  assert.doesNotMatch(LIEN.ecrirePartage({ ...complet(), classes: [] }), /classes=/);
  assert.match(LIEN.ecrirePartage({ ...complet(), classes: new Set([5, 2, 5]) }), /classes=2\.5(&|$)/);
});

test('ecrirePartage : les classes du sol, quand on les donne', () => {
  assert.equal(LIEN.ecrirePartage({ sol: [9, 2, 6] }), '&sol=2.6.9');
});

test('ecrirePartage : une mesure démesurée est coupée à 40 points, le lien reste court', () => {
  const mesure = Array.from({ length: 200 }, (_, i) => ({ s: i, z: 1500 + i }));
  const s = LIEN.ecrirePartage({ ...complet(), mesure });
  const nombres = /mesure=([^&]*)/.exec(s)[1].split('/');
  assert.equal(nombres.length, 80);
  assert.ok(s.length < 700, `${s.length} caractères`);
});

test('sansDefaut : les classes du sol n’entrent dans le lien que si elles diffèrent du défaut', () => {
  assert.equal(LIEN.sansDefaut([9, 2], [2, 9]), undefined);          // mêmes, quel que soit l'ordre
  assert.equal(LIEN.sansDefaut(new Set([2, 9]), [2, 9]), undefined);
  assert.deepEqual(plat(LIEN.sansDefaut([2, 9, 6], [2, 9])), [2, 6, 9]);
  assert.deepEqual(plat(LIEN.sansDefaut([2], [2, 9])), [2]);
  assert.equal(LIEN.sansDefaut(undefined, [2, 9]), undefined);
});

// ── Dans le forum et chez osm.org ────────────────────────────────────────────

test('le lien complet n’emploie que des caractères sûrs : ni virgule, ni parenthèse, ni guillemet, ni « + »', () => {
  const f = LIEN.ecrire({ zoom: 18, lat: 42.857536, lon: 1.061833 }) + LIEN.ecrirePartage({ ...complet(), sol: [2, 6] });
  assert.match(f, /^[A-Za-z0-9._~/=&-]+$/);
  for (const interdit of [',', '(', ')', '"', "'", '+', ' ', ';', '|', '[', ']']) {
    assert.ok(!f.includes(interdit), `« ${interdit} » dans ${f}`);
  }
});

test('osm.org lit toujours la même position, les paramètres en plus sont ignorés', () => {
  // Reprise d'`OSM.parseHash` : `map=` seul, trois champs.
  const osm = (hash) => {
    const m = (new URLSearchParams(hash.slice(hash.indexOf('#') + 1)).get('map') || '').split('/');
    return { zoom: parseInt(m[0], 10), lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  };
  const h = '#' + LIEN.ecrire({ zoom: 18, lat: 42.857536, lon: 1.061833 }) + LIEN.ecrirePartage(complet());
  assert.deepEqual(osm(h), { zoom: 18, lat: 42.857536, lon: 1.061833 });
});

test('LIEN.lire garde sa lecture de la vue : les paramètres du profil ne la gênent pas', () => {
  const lu = LIEN.lire('#' + LIEN.ecrire({ zoom: 18, lat: 42.857536, lon: 1.061833 }) + LIEN.ecrirePartage(complet()));
  assert.equal(lu.zoom, 18);
  assert.equal(lu.lat, 42.857536);
  assert.equal(lu.lon, 1.061833);
});

// ── Lire ─────────────────────────────────────────────────────────────────────

test('lirePartage : rend ce qu’ecrirePartage a produit', () => {
  const lu = LIEN.lirePartage('#map=18/42.857536/1.061833' + EXEMPLE);
  assert.deepEqual(plat(lu), plat({
    profil: { a: A, b: B, largeur: 3 },
    coupe: true,
    classes: [2, 5, 6],
    mesure: [{ s: 12.3, z: 1500.1 }, { s: 25.5, z: 1503.2 }],
    ref: { s: 0, z: 1500.1 },
    sel: { lat: 42.857536, lon: 1.061833 },
  }));
});

test('lirePartage : un fragment sans rien de tout cela rend un objet vide, jamais null', () => {
  assert.deepEqual(plat(LIEN.lirePartage('#map=18/42.857536/1.061833')), {});
  assert.deepEqual(plat(LIEN.lirePartage('')), {});
  assert.deepEqual(plat(LIEN.lirePartage(undefined)), {});
  assert.deepEqual(plat(LIEN.lirePartage('#d=877,6904')), {});   // un ancien lien de dalle
});

test('lirePartage : les classes du sol et la sélection seules, sans bande', () => {
  assert.deepEqual(plat(LIEN.lirePartage('#map=18/42.8/1.0&sol=2.6.9&sel=42.857536/1.061833')),
    { sol: [2, 6, 9], sel: { lat: 42.857536, lon: 1.061833 } });
});

test('lirePartage : sans bande valide, la coupe, les classes, la mesure et la référence sont ignorées', () => {
  const h = '#map=18/42.8/1.0&coupe=1&classes=2.5&mesure=12.3/1500.1&ref=0/1500.1&sel=42.857536/1.061833';
  assert.deepEqual(plat(LIEN.lirePartage(h)), { sel: { lat: 42.857536, lon: 1.061833 } });
});

test('lirePartage : une bande abîmée est ignorée en bloc, et ce qui en dépend avec elle', () => {
  const abimees = [
    'profil=42.857552/1.052198/42.859801/1.057456',            // la largeur manque
    'profil=42.857552/1.052198/42.859801/1.057456/3/9',        // un champ de trop
    'profil=42.857552/1.052198/42.859801/abc/3',               // un nombre illisible
    'profil=42.857552/1.052198/42.859801/1.057456/0',          // largeur nulle
    'profil=42.857552/1.052198/42.859801/1.057456/-3',         // largeur négative
    'profil=95/1.052198/42.859801/1.057456/3',                 // latitude impossible
    'profil=42.857552/200/42.859801/1.057456/3',               // longitude impossible
    'profil=42.857552/1.052198/42.857552/1.052198/3',          // A et B confondus
    'profil=1e1/1.052198/42.859801/1.057456/3',                // notation exponentielle refusée
    'profil=42.857552/1.052198/+42.859801/1.057456/3',         // un « + » : lu comme une espace ailleurs
    'profil=',
  ];
  for (const a of abimees) {
    assert.deepEqual(plat(LIEN.lirePartage(`#map=18/42.8/1.0&${a}&coupe=1&classes=2.5`)), {}, a);
  }
});

test('lirePartage : chaque paramètre abîmé tombe seul, les autres restent', () => {
  const base = '#map=18/42.8/1.0&profil=42.857552/1.052198/42.859801/1.057456/3&coupe=1';
  const lu = (reste) => plat(LIEN.lirePartage(base + reste));
  assert.equal(lu('&classes=2.x.6').classes, undefined);
  assert.equal(lu('&classes=2.300').classes, undefined);        // une classe tient sur un octet
  assert.equal(lu('&classes=').classes, undefined);
  assert.equal(lu('&mesure=12.3/1500.1/25.5').mesure, undefined);   // un nombre de trop : pas de paire
  assert.equal(lu('&mesure=12.3/abc').mesure, undefined);
  assert.equal(lu('&mesure=').mesure, undefined);
  assert.equal(lu('&ref=0').ref, undefined);
  assert.equal(lu('&ref=0/1500/9').ref, undefined);
  assert.equal(lu('&sel=95/1').sel, undefined);
  assert.equal(lu('&sel=42.8').sel, undefined);
  assert.equal(lu('&sol=2.x').sol, undefined);
  assert.equal(plat(LIEN.lirePartage(base.replace('coupe=1', 'coupe=2'))).coupe, undefined);   // seul « 1 » ouvre la coupe
  // Et la bande, elle, survit à tous ces abîmés.
  assert.equal(lu('&classes=x').profil.largeur, 3);
});

test('lirePartage : une mesure démesurée est refusée en bloc, pas tronquée', () => {
  const nombres = Array.from({ length: 200 }, (_, i) => i).join('/');
  const lu = plat(LIEN.lirePartage(`#map=18/42.8/1.0&profil=42.857552/1.052198/42.859801/1.057456/3&coupe=1&mesure=${nombres}`));
  assert.equal(lu.mesure, undefined);
});

test('lirePartage : des classes en double se lisent une fois, un paramètre inconnu est ignoré', () => {
  const lu = plat(LIEN.lirePartage('#map=18/42.8/1.0&profil=42.857552/1.052198/42.859801/1.057456/3&coupe=1&classes=5.2.5&layers=C&autre=1'));
  assert.deepEqual(lu.classes, [2, 5]);
  assert.equal(lu.layers, undefined);
});
