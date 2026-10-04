// Le lien du profil (R2) : la bande, la sélection, la règle, le sol et la vue
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

/** Un état complet : la bande et la sélection. */
const complet = () => ({
  profil: { a: A, b: B, largeur: 3 },
  sel: { lat: 42.857536, lon: 1.061833 },
});

const EXEMPLE = '&profil=42.857552/1.052198/42.859801/1.057456/3&sel=42.857536/1.061833';

// ── Écrire ───────────────────────────────────────────────────────────────────

test('ecrirePartage : rien à dire, rien d’écrit', () => {
  assert.equal(LIEN.ecrirePartage({}), '');
  assert.equal(LIEN.ecrirePartage(undefined), '');
  assert.equal(LIEN.ecrirePartage(null), '');
});

test('ecrirePartage : la bande seule — deux points et la largeur', () => {
  assert.equal(LIEN.ecrirePartage({ profil: { a: A, b: B, largeur: 3 } }), '&profil=42.857552/1.052198/42.859801/1.057456/3');
});

test('ecrirePartage : l’état complet, dans l’ordre fixe', () => {
  assert.equal(LIEN.ecrirePartage(complet()), EXEMPLE);
});

test('ecrirePartage : les nombres sont arrondis et sans zéros de queue ni « -0 »', () => {
  const s = LIEN.ecrirePartage({
    profil: { a: { lat: 42.85755264, lon: 1.0521980 }, b: { lat: 42.859801, lon: -0.0000001 }, largeur: 2.50 },
  });
  assert.match(s, /profil=42\.857553\/1\.052198\/42\.859801\/0\/2\.5/);   // 6 décimales, 1 pour la largeur, -1e-7 → 0
  assert.doesNotMatch(s, /-0(\/|&|$)/);
});

test('ecrirePartage : sans bande, il ne reste que la sélection', () => {
  const { profil, ...sansBande } = complet();
  assert.equal(LIEN.ecrirePartage(sansBande), '&sel=42.857536/1.061833');
});

test('ecrirePartage : la modale du profil n’est pas dans le lien (ni coupe, ni classes, ni mesure, ni référence)', () => {
  const e = { ...complet(), coupe: true, classes: [2, 5], mesure: [{ s: 1, z: 2 }], ref: { s: 0, z: 1 } };
  assert.equal(LIEN.ecrirePartage(e), EXEMPLE);
});

test('ecrirePartage : les classes du sol, quand on les donne', () => {
  assert.equal(LIEN.ecrirePartage({ sol: [9, 2, 6] }), '&sol=2.6.9');
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

test('lirePartage : les anciens paramètres de la modale sont ignorés, la bande reste', () => {
  const h = '#map=18/42.8/1.0&profil=42.857552/1.052198/42.859801/1.057456/3&coupe=1&classes=2.5&mesure=12.3/1500.1&ref=0/1500.1';
  assert.deepEqual(plat(LIEN.lirePartage(h)), { profil: { a: A, b: B, largeur: 3 } });
});

test('lirePartage : une bande abîmée est ignorée en bloc', () => {
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
    assert.deepEqual(plat(LIEN.lirePartage(`#map=18/42.8/1.0&${a}&sel=95/1`)), {}, a);
  }
});

test('lirePartage : chaque paramètre abîmé tombe seul, les autres restent', () => {
  const base = '#map=18/42.8/1.0&profil=42.857552/1.052198/42.859801/1.057456/3';
  const lu = (reste) => plat(LIEN.lirePartage(base + reste));
  assert.equal(lu('&sel=95/1').sel, undefined);
  assert.equal(lu('&sel=42.8').sel, undefined);
  assert.equal(lu('&sol=2.x').sol, undefined);
  assert.equal(lu('&layers=C&autre=1').layers, undefined);   // un paramètre inconnu est ignoré
  // Et la bande, elle, survit à tous ces abîmés.
  assert.equal(lu('&sol=x').profil.largeur, 3);
});

test('sansDefaut : une classe absente de la zone ne fait pas passer le défaut pour un choix', () => {
  // Le sol par défaut est 2 + 9, mais la zone n'a pas d'eau : la liste de cases ne propose pas
  // la 9, et l'état reconstruit depuis les cases est {2} — fonctionnellement le défaut.
  assert.equal(LIEN.sansDefaut([2], [2, 9], [1, 2, 3, 5]), undefined);
  // Un vrai choix reste un choix.
  assert.deepEqual(plat(LIEN.sansDefaut([2, 3], [2, 9], [1, 2, 3, 5])), [2, 3]);
  // Dans une zone qui a de l'eau, {2} sans {9} est bien différent du défaut.
  assert.deepEqual(plat(LIEN.sansDefaut([2], [2, 9], [1, 2, 9])), [2]);
  // Sans liste de classes présentes (pas encore arrivée), on compare tel quel, comme avant.
  assert.deepEqual(plat(LIEN.sansDefaut([2], [2, 9])), [2]);
  assert.deepEqual(plat(LIEN.sansDefaut([2], [2, 9], [])), [2]);
});

// ── Les réglages de la vue dans le lien (R2b) ────────────────────────────────
//
// Le plus possible de ce qui change ce qu'on voit : les couches de chaque côté du
// rideau, sa position, le contraste, les réglages du SVF, le lissage, puis ceux de la 3D
// (couleur, plafond de points, ombrage de profondeur, classes cachées) et l'onglet. Le
// lien n'écrit que ce qu'on lui donne — l'appelant ne donne que ce qui diffère du défaut,
// pour qu'un lien reste court — et chaque paramètre se lit seul : un abîmé tombe, les
// autres restent.

const VUE_COMPLETE = () => ({
  gauche: 'ombrage', droite: 'ouverture-neg', rideau: 30, contraste: 1.5,
  svf: { directions: 12, rayon: 15 }, soleil: { azimut: 100, hauteur: 25 }, lisse: false,
  couleur: 'hauteur', plafond: 8, edl: false, cachees: [5, 3, 4],
});

const EXEMPLE_VUE = '&gauche=ombrage&droite=ouverture-neg&rideau=30&contraste=1.5&svf=12/15&soleil=100/25&lisse=0'
  + '&couleur=hauteur&plafond=8&edl=0&cachees=3.4.5';

test('ecrirePartage : une vue vide n’écrit rien', () => {
  assert.equal(LIEN.ecrirePartage({ vue: {} }), '');
  assert.equal(LIEN.ecrirePartage({ vue: undefined }), '');
});

test('ecrirePartage : tous les réglages de la vue, dans l’ordre fixe', () => {
  assert.equal(LIEN.ecrirePartage({ vue: VUE_COMPLETE() }), EXEMPLE_VUE);
});

test('ecrirePartage : chaque réglage s’écrit seul, et se glisse après le reste', () => {
  assert.equal(LIEN.ecrirePartage({ vue: { rideau: 70 } }), '&rideau=70');
  assert.equal(LIEN.ecrirePartage({ vue: { lisse: false } }), '&lisse=0');
  assert.equal(LIEN.ecrirePartage({ vue: { edl: false } }), '&edl=0');
  assert.equal(LIEN.ecrirePartage({ vue: { couleur: 'relief' } }), '&couleur=relief');
  // `lisse: true` et `edl: true` sont les défauts : jamais écrits.
  assert.equal(LIEN.ecrirePartage({ vue: { lisse: true, edl: true } }), '');
  // Après la coupe et la sélection.
  assert.equal(LIEN.ecrirePartage({ ...complet(), sol: [2], vue: { rideau: 70 } }), EXEMPLE + '&sol=2&rideau=70');
});

test('ecrirePartage : les nombres de la vue sont arrondis et sans zéros de queue', () => {
  assert.match(LIEN.ecrirePartage({ vue: { contraste: 1.50, plafond: 5.0, rideau: 29.6 } }), /&rideau=30&contraste=1\.5&plafond=5$/);
  assert.match(LIEN.ecrirePartage({ vue: { contraste: 2.04, plafond: 7.46 } }), /contraste=2&plafond=7\.5/);
  // Un rideau hors de [0, 100] est ramené dedans.
  assert.match(LIEN.ecrirePartage({ vue: { rideau: 140 } }), /rideau=100/);
  assert.match(LIEN.ecrirePartage({ vue: { rideau: -5 } }), /rideau=0/);
});

test('ecrirePartage : une couche ou une couleur aux caractères douteux n’entre pas dans le lien', () => {
  assert.equal(LIEN.ecrirePartage({ vue: { gauche: 'a b' } }), '');
  assert.equal(LIEN.ecrirePartage({ vue: { gauche: '<script>', droite: 'x,y' } }), '');
  assert.equal(LIEN.ecrirePartage({ vue: { couleur: 'inconnue' } }), '');
  // L'onglet n'est jamais écrit : ouvrir un lien ne doit pas lancer la 3D (nuage de millions de points).
  assert.equal(LIEN.ecrirePartage({ vue: { onglet: '3d' } }), '');
});

test('le lien avec tous les réglages reste sûr dans le forum et court', () => {
  const f = LIEN.ecrire({ zoom: 18, lat: 42.857536, lon: 1.061833 })
    + LIEN.ecrirePartage({ ...complet(), sol: [2, 6], vue: VUE_COMPLETE() });
  assert.match(f, /^[A-Za-z0-9._~/=&-]+$/);
  assert.ok(f.length < 400, `${f.length} caractères`);
});

test('lirePartage : rend les réglages de la vue qu’ecrirePartage a produits', () => {
  const lu = plat(LIEN.lirePartage('#map=18/42.8/1.0' + EXEMPLE_VUE));
  assert.deepEqual(lu, { vue: {
    gauche: 'ombrage', droite: 'ouverture-neg', rideau: 30, contraste: 1.5,
    svf: { directions: 12, rayon: 15 }, soleil: { azimut: 100, hauteur: 25 }, lisse: false,
    couleur: 'hauteur', plafond: 8, edl: false, cachees: [3, 4, 5],
  } });
});

test('lirePartage : la vue n’a pas besoin d’une bande, la bande n’a pas besoin de la vue', () => {
  assert.deepEqual(plat(LIEN.lirePartage('#map=18/42.8/1.0&rideau=70')), { vue: { rideau: 70 } });
  const avecBande = plat(LIEN.lirePartage('#map=18/42.8/1.0' + EXEMPLE.replace('&sel=42.857536/1.061833', '') + '&rideau=70'));
  assert.equal(avecBande.vue.rideau, 70);
  assert.equal(avecBande.profil.largeur, 3);
});

test('lirePartage : chaque réglage abîmé tombe seul, les autres de la vue restent', () => {
  const lu = (reste) => plat(LIEN.lirePartage('#map=18/42.8/1.0&rideau=30&' + reste)).vue;
  const garde = (v) => v && v.rideau === 30;
  for (const abime of ['gauche=a%20b', 'gauche=<b>', 'gauche=', 'gauche=1carte', 'droite=x,y', 'droite=' + 'a'.repeat(40)]) {
    const v = lu(abime); assert.ok(garde(v) && v.gauche === undefined && v.droite === undefined, abime);
  }
  for (const abime of ['rideau=101', 'rideau=-1', 'rideau=abc', 'rideau=1.5', 'rideau=']) {
    const v = plat(LIEN.lirePartage('#map=18/42.8/1.0&contraste=1.5&' + abime)).vue;
    assert.ok(v && v.contraste === 1.5 && v.rideau === undefined, abime);
  }
  for (const abime of ['contraste=0', 'contraste=99', 'contraste=abc', 'contraste=1e1', 'contraste=-1']) assert.equal(lu(abime).contraste, undefined, abime);
  for (const abime of ['svf=8', 'svf=8/10/3', 'svf=0/10', 'svf=8/0', 'svf=8/abc', 'svf=100/10', 'svf=8/500', 'svf=1.5/10']) assert.equal(lu(abime).svf, undefined, abime);
  for (const abime of ['soleil=100', 'soleil=100/25/3', 'soleil=360/25', 'soleil=100/0', 'soleil=100/90', 'soleil=abc/25', 'soleil=100/2.5', 'soleil=-5/25']) assert.equal(lu(abime).soleil, undefined, abime);
  for (const abime of ['lisse=1', 'lisse=oui', 'lisse=']) assert.equal(lu(abime).lisse, undefined, abime);
  for (const abime of ['edl=1', 'edl=non']) assert.equal(lu(abime).edl, undefined, abime);
  for (const abime of ['couleur=inconnue', 'couleur=', 'couleur=Hauteur', 'couleur=intensite']) assert.equal(lu(abime).couleur, undefined, abime);
  for (const abime of ['plafond=0', 'plafond=21', 'plafond=abc', 'plafond=1e1', 'plafond=-3']) assert.equal(lu(abime).plafond, undefined, abime);
  for (const abime of ['cachees=3.x', 'cachees=300', 'cachees=', 'cachees=3,4']) assert.equal(lu(abime).cachees, undefined, abime);
  for (const autre of ['onglet=3d', 'onglet=carte', 'onglet=']) assert.deepEqual(lu(autre), { rideau: 30 }, autre);   // ignoré, jamais lu : le reste de la vue demeure
});

test('lirePartage : une vue sans aucun réglage valide n’a pas de clé « vue »', () => {
  assert.deepEqual(plat(LIEN.lirePartage('#map=18/42.8/1.0&rideau=999&couleur=x')), {});
});

test('lirePartage : le rideau lu est un entier de 0 à 100, jamais plus', () => {
  assert.equal(plat(LIEN.lirePartage('#map=18/42.8/1.0&rideau=0')).vue.rideau, 0);
  assert.equal(plat(LIEN.lirePartage('#map=18/42.8/1.0&rideau=100')).vue.rideau, 100);
});

// ── La règle de la carte (mesure A→B→C posée sur la carte, hors profil) ─────

const REGLE = [{ lat: 42.857536, lon: 1.061833 }, { lat: 42.8581, lon: 1.0625 }, { lat: 42.8586, lon: 1.0631 }];

test('ecrirePartage : la règle s’écrit en paires lat/lon, après la sélection, indépendamment de la bande', () => {
  assert.equal(LIEN.ecrirePartage({ regle: REGLE }), '&regle=42.857536/1.061833/42.8581/1.0625/42.8586/1.0631');
  assert.equal(LIEN.ecrirePartage({ regle: [REGLE[0]] }), '&regle=42.857536/1.061833');
  assert.equal(LIEN.ecrirePartage({ regle: [] }), '');
  assert.equal(LIEN.ecrirePartage({ sel: { lat: 1, lon: 2 }, regle: [REGLE[0]] }), '&sel=1/2&regle=42.857536/1.061833');
});

test('ecrirePartage : la règle ne garde que des points valides, en nombre borné', () => {
  assert.equal(LIEN.ecrirePartage({ regle: [{ lat: 95, lon: 1 }, { lat: NaN, lon: 1 }] }), '');
  const beaucoup = Array.from({ length: 100 }, (_, i) => ({ lat: 42 + i / 1000, lon: 1 }));
  const n = LIEN.ecrirePartage({ regle: beaucoup }).slice('&regle='.length).split('/').length / 2;
  assert.equal(n, 40);
});

test('lirePartage : rend la règle écrite, et la tient pour abîmée en bloc au moindre doute', () => {
  const lu = (reste) => plat(LIEN.lirePartage('#map=18/42.8/1.0' + reste));
  assert.deepEqual(lu('&regle=42.857536/1.061833/42.8581/1.0625/42.8586/1.0631').regle, REGLE);
  assert.deepEqual(lu('&regle=42.857536/1.061833').regle, [REGLE[0]]);
  for (const a of ['&regle=42.8/1.0/43', '&regle=42.8/abc', '&regle=', '&regle=95/1', '&regle=42.8/200']) {
    assert.equal(lu(a).regle, undefined, a);
  }
  const trop = Array.from({ length: 200 }, (_, i) => `42.${i}/1`).join('/');
  assert.equal(lu(`&regle=${trop}`).regle, undefined);   // refusée, pas tronquée
  // Sans bande ni coupe, la règle vit seule ; et abîmée, elle n'emporte rien d'autre.
  assert.equal(lu('&regle=x&sel=42.8/1.0').sel.lat, 42.8);
});
