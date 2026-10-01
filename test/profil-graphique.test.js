// Le graphique du profil : l'accrochage des repères et la mesure en deux
// clics. Le dessin lui-même se vérifie à l'œil dans le navigateur ; ici, un
// canevas factice dont le contexte avale tous les appels.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { ProfilGraphique } = chargerScripts(['config.js', 'profil.js', 'profil-graphique.js']);

function canevasFactice() {
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  return {
    width: 0, height: 0, style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 300 }),
    addEventListener() {},
  };
}

/** Trois points : deux sol à 300 m, une cime à 325 m au milieu d'un axe de 100 m. */
const donnees = () => ({ n: 3, s: Float32Array.of(0, 50, 100), z: Float32Array.of(300, 325, 300), cls: Uint8Array.of(2, 5, 2), longueur: 100 });

test('un clic près d’un point s’y accroche : la cime, pas la souris (Review Focus 5)', () => {
  const vus = [];
  const g = new ProfilGraphique(canevasFactice(), (p, q) => vus.push([p, q]));
  g.definir(donnees());
  const { x, y } = g.px(50, 325);
  g.clic(x + 4, y - 3);
  const [p] = vus.at(-1);
  assert.equal(p.s, 50);
  assert.equal(p.z, 325);
});

test('un clic loin de tout point pose un repère à la position du curseur, sans erreur', () => {
  const vus = [];
  const g = new ProfilGraphique(canevasFactice(), (p, q) => vus.push([p, q]));
  g.definir(donnees());
  const { x, y } = g.px(25, 312);
  g.clic(x, y);
  const [p] = vus.at(-1);
  assert.ok(Math.abs(p.s - 25) < 0.5, `s = ${p.s}`);
  assert.ok(Math.abs(p.z - 312) < 0.5, `z = ${p.z}`);
});

test('deux clics donnent deux repères, le troisième recommence', () => {
  const vus = [];
  const g = new ProfilGraphique(canevasFactice(), (p, q) => vus.push([p, q]));
  g.definir(donnees());
  const a = g.px(0, 300), b = g.px(50, 325), c = g.px(100, 300);
  g.clic(a.x, a.y);
  assert.equal(vus.at(-1)[1], null);   // un seul repère
  g.clic(b.x, b.y);
  assert.equal(vus.at(-1)[0].s, 0);
  assert.equal(vus.at(-1)[1].s, 50);
  g.clic(c.x, c.y);                    // recommence
  assert.equal(vus.at(-1)[0].s, 100);
  assert.equal(vus.at(-1)[1], null);
});

test('une classe décochée ne peut pas être visée', () => {
  const vus = [];
  const g = new ProfilGraphique(canevasFactice(), (p, q) => vus.push([p, q]));
  // Un point de végétation (classe 5) à 3 cm au-dessus d'un point de sol, à la même abscisse.
  g.definir({ n: 4, s: Float32Array.of(0, 50, 50, 100), z: Float32Array.of(300, 300, 300.03, 300), cls: Uint8Array.of(2, 2, 5, 2), longueur: 100 });
  const { x, y } = g.px(50, 300.03);
  g.clic(x, y);
  assert.equal(vus.at(-1)[0].z, Math.fround(300.03));   // visible : le plus proche est la végétation
  g.effacerMesure();
  g.definirVisibles(new Set([2]));                      // végétation décochée
  const v = g.px(50, 300.03);
  g.clic(v.x, v.y);
  assert.equal(vus.at(-1)[0].z, 300);                   // masquée : il s'accroche au sol, pas à elle
});

test('le tronçon recadre l’abscisse : un point hors portée n’est pas visé', () => {
  const vus = [];
  const g = new ProfilGraphique(canevasFactice(), (p, q) => vus.push([p, q]));
  g.definir(donnees());
  g.definirPortee(40, 100);
  const { x, y } = g.px(50, 325);
  g.clic(x, y);
  assert.equal(vus.at(-1)[0].s, 50);
  // 0 est hors du tronçon : il n'est plus à l'écran, donc impossible à viser.
  assert.ok(g.px(0, 300).x < 56);
});

test('definir(null) vide le graphique sans erreur et efface la mesure', () => {
  const vus = [];
  const g = new ProfilGraphique(canevasFactice(), (p, q) => vus.push([p, q]));
  g.definir(donnees());
  const { x, y } = g.px(50, 325);
  g.clic(x, y);
  g.definir(null);
  assert.deepEqual(vus.at(-1).map((v) => v ?? null), [null, null]);
  g.clic(100, 100);   // clic sur un graphique vide : rien, pas d'exception
});

// ── Le coût d'un cran de curseur (relecture finale) ──────────────────────────

/** Un canevas dont on compte les dessins (clearRect) et les écritures de taille. */
function canevasCompte() {
  const c = { clear: 0, largeurEcrite: 0, hauteurEcrite: 0, _w: 0, _h: 0, style: {}, addEventListener() {} };
  const ctx = new Proxy({}, { get: (_, nom) => (nom === 'clearRect' ? () => { c.clear++; } : () => {}), set: () => true });
  Object.defineProperty(c, 'width', { get: () => c._w, set: (v) => { c._w = v; c.largeurEcrite++; } });
  Object.defineProperty(c, 'height', { get: () => c._h, set: (v) => { c._h = v; c.hauteurEcrite++; } });
  c.getContext = () => ctx;
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 300 });
  return c;
}

test('plusieurs changements dans la même image ne dessinent qu’une fois', () => {
  const page = chargerScripts(['config.js', 'profil.js', 'profil-graphique.js']);
  const file = [];
  page.requestAnimationFrame = (f) => { file.push(f); return file.length; };
  const c = canevasCompte();
  const g = new page.ProfilGraphique(c, () => {});
  g.definir(donnees());
  c.clear = 0;
  g.definirPortee(10, 90);
  g.definirPortee(20, 80);
  g.definirVisibles(null);
  assert.equal(c.clear, 0);          // rien n'est dessiné avant l'image
  assert.equal(file.length, 1);      // une seule image demandée
  file[0]();
  assert.equal(c.clear, 1);          // et un seul dessin
  g.definirPortee(30, 70);           // l'image suivante peut en demander une autre
  assert.equal(file.length, 2);
});

test('la taille du canevas n’est refixée que si elle change', () => {
  const c = canevasCompte();
  const g = new ProfilGraphique(c, () => {});
  g.definir(donnees());
  const l = c.largeurEcrite, h = c.hauteurEcrite;
  g.rendre();
  g.rendre();
  assert.equal(c.largeurEcrite, l);
  assert.equal(c.hauteurEcrite, h);
});
