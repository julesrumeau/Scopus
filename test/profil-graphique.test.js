// Le graphique du profil : l'accrochage des repères, la chaîne de mesure et la
// tranche de largeur. Le dessin lui-même se vérifie à l'œil dans le navigateur ;
// ici, un canevas factice dont le contexte avale tous les appels.

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

/** Un graphique et la liste de ce que le rappel a reçu (la chaîne de points, à chaque changement). */
function graphique(Classe = ProfilGraphique, canevas = canevasFactice()) {
  const vus = [];
  // Copie par JSON : les tableaux du contexte `vm` n'ont pas les prototypes d'ici.
  const g = new Classe(canevas, (pts) => vus.push(JSON.parse(JSON.stringify(pts.map((p) => ({ s: p.s, z: p.z }))))));
  return { g, vus };
}

/** Trois points : deux sol à 300 m, une cime à 325 m au milieu d'un axe de 100 m. */
const donnees = () => ({
  n: 3, s: Float32Array.of(0, 50, 100), z: Float32Array.of(300, 325, 300),
  d: Float32Array.of(0, 0, 0), cls: Uint8Array.of(2, 5, 2), longueur: 100,
});

test('un clic près d’un point s’y accroche : la cime, pas la souris (Review Focus 5)', () => {
  const { g, vus } = graphique();
  g.definir(donnees());
  const { x, y } = g.px(50, 325);
  g.clic(x + 4, y - 3);
  assert.deepEqual(vus.at(-1), [{ s: 50, z: 325 }]);
});

test('un clic loin de tout point pose un repère à la position du curseur, sans erreur', () => {
  const { g, vus } = graphique();
  g.definir(donnees());
  const { x, y } = g.px(25, 312);
  g.clic(x, y);
  const [p] = vus.at(-1);
  assert.ok(Math.abs(p.s - 25) < 0.5, `s = ${p.s}`);
  assert.ok(Math.abs(p.z - 312) < 0.5, `z = ${p.z}`);
});

test('la mesure s’enchaîne comme sur la carte : A, B, C… sans recommencer', () => {
  const { g, vus } = graphique();
  g.definir(donnees());
  const a = g.px(0, 300), b = g.px(50, 325), c = g.px(100, 300);
  g.clic(a.x, a.y);
  g.clic(b.x, b.y);
  g.clic(c.x, c.y);
  assert.deepEqual(vus.at(-1), [{ s: 0, z: 300 }, { s: 50, z: 325 }, { s: 100, z: 300 }]);
});

test('retirerDernier ôte le dernier point de la chaîne, effacerMesure les vide tous', () => {
  const { g, vus } = graphique();
  g.definir(donnees());
  const a = g.px(0, 300), b = g.px(50, 325);
  g.clic(a.x, a.y);
  g.clic(b.x, b.y);
  g.retirerDernier();
  assert.deepEqual(vus.at(-1), [{ s: 0, z: 300 }]);
  g.retirerDernier();
  assert.deepEqual(vus.at(-1), []);
  g.retirerDernier();                       // rien à retirer : pas d'exception
  g.clic(a.x, a.y);
  g.effacerMesure();
  assert.deepEqual(vus.at(-1), []);
});

test('une classe décochée ne peut pas être visée', () => {
  const { g, vus } = graphique();
  // Un point de végétation (classe 5) à 3 cm au-dessus d'un point de sol, à la même abscisse.
  g.definir({
    n: 4, s: Float32Array.of(0, 50, 50, 100), z: Float32Array.of(300, 300, 300.03, 300),
    d: new Float32Array(4), cls: Uint8Array.of(2, 2, 5, 2), longueur: 100,
  });
  const { x, y } = g.px(50, 300.03);
  g.clic(x, y);
  assert.equal(vus.at(-1)[0].z, Math.fround(300.03));   // visible : le plus proche est la végétation
  g.effacerMesure();
  g.definirVisibles(new Set([2]));                      // végétation décochée
  const v = g.px(50, 300.03);
  g.clic(v.x, v.y);
  assert.equal(vus.at(-1)[0].z, 300);                   // masquée : il s'accroche au sol, pas à elle
});

test('la tranche de largeur écarte les points hors de la tranche : ni vus, ni visés', () => {
  const { g, vus } = graphique();
  // Un point de sol sur l'axe, une cime à 1,5 m à gauche de l'axe, à la même abscisse.
  g.definir({
    n: 3, s: Float32Array.of(0, 50, 50), z: Float32Array.of(300, 300, 325),
    d: Float32Array.of(0, 0, 1.5), cls: Uint8Array.of(2, 2, 5), longueur: 100,
  });
  const cime = g.px(50, 325);
  g.clic(cime.x, cime.y);
  assert.equal(vus.at(-1)[0].z, 325);                   // toute la bande : la cime est visée
  g.effacerMesure();
  g.definirLateral(-1, 1);                              // tranche centrale : la cime est dehors
  const c2 = g.px(50, 300);
  g.clic(c2.x, c2.y);
  assert.equal(vus.at(-1)[0].z, 300);
  g.effacerMesure();
  g.definirLateral(-Infinity, Infinity);                // toute la bande à nouveau
  const c3 = g.px(50, 325);
  g.clic(c3.x, c3.y);
  assert.equal(vus.at(-1)[0].z, 325);
});

test('definir(null) vide le graphique sans erreur et efface la mesure', () => {
  const { g, vus } = graphique();
  g.definir(donnees());
  const { x, y } = g.px(50, 325);
  g.clic(x, y);
  g.definir(null);
  assert.deepEqual(vus.at(-1), []);
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
  const { g } = graphique(page.ProfilGraphique, c);
  g.definir(donnees());
  c.clear = 0;
  g.definirLateral(-1, 1);
  g.definirLateral(-0.5, 0.5);
  g.definirVisibles(null);
  assert.equal(c.clear, 0);          // rien n'est dessiné avant l'image
  assert.equal(file.length, 1);      // une seule image demandée
  file[0]();
  assert.equal(c.clear, 1);          // et un seul dessin
  g.definirLateral(-1, 1);           // l'image suivante peut en demander une autre
  assert.equal(file.length, 2);
});

test('la taille du canevas n’est refixée que si elle change', () => {
  const c = canevasCompte();
  const { g } = graphique(ProfilGraphique, c);
  g.definir(donnees());
  const l = c.largeurEcrite, h = c.hauteurEcrite;
  g.rendre();
  g.rendre();
  assert.equal(c.largeurEcrite, l);
  assert.equal(c.hauteurEcrite, h);
});

// ── Le zoom ──────────────────────────────────────────────────────────────────

const proche = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);

test('zoomer garde en place le point sous le curseur et agrandit l’échelle', () => {
  const { g } = graphique();
  g.definir(donnees());
  const avant = g.px(50, 312), ref = g.px(60, 312);
  g.zoomer(avant.x, avant.y, 2);
  const apres = g.px(50, 312), ref2 = g.px(60, 312);
  proche(apres.x, avant.x); proche(apres.y, avant.y);
  proche(ref2.x - apres.x, 2 * (ref.x - avant.x));   // 10 m couvrent deux fois plus de pixels
});

test('zoomer puis dézoomer revient à la vue entière', () => {
  const { g } = graphique();
  g.definir(donnees());
  const a0 = g.px(0, 300), a1 = g.px(100, 325);
  const { x, y } = g.px(50, 312);
  g.zoomer(x, y, 2);
  g.zoomer(x, y, 0.5);
  proche(g.px(0, 300).x, a0.x); proche(g.px(100, 325).y, a1.y);
});

test('on ne peut pas dézoomer au-delà de la bande, ni zoomer sans fin', () => {
  const { g } = graphique();
  g.definir(donnees());
  const a0 = g.px(0, 300);
  g.zoomer(300, 150, 0.1);                       // dézoom immense : la vue entière, pas moins
  proche(g.px(0, 300).x, a0.x);
  for (let i = 0; i < 60; i++) g.zoomer(300, 150, 2);
  assert.ok(g.s1 - g.s0 >= 0.5 - 1e-9, `tronçon ${g.s1 - g.s0}`);   // pas de zoom infini
});

test('deplacer fait glisser le contenu avec la main, sans sortir de la bande', () => {
  const { g } = graphique();
  g.definir(donnees());
  const { x, y } = g.px(50, 312);
  g.zoomer(x, y, 4);
  const avant = g.px(50, 312);
  g.deplacer(40, 0);
  proche(g.px(50, 312).x, avant.x + 40);          // le contenu suit la main
  g.deplacer(1e6, 0);                              // trop loin : arrêté au bord de la bande
  assert.ok(g.s0 >= 0 - 1e-9);
  g.deplacer(0, 25);
  proche(g.px(50, 312).y, avant.y + 25);
});

test('recadrer rend la vue entière', () => {
  const { g } = graphique();
  g.definir(donnees());
  const a0 = g.px(0, 300);
  const { x, y } = g.px(50, 312);
  g.zoomer(x, y, 4);
  g.deplacer(30, 10);
  g.recadrer();
  proche(g.px(0, 300).x, a0.x); proche(g.px(0, 300).y, a0.y);
});

test('un geste court est un clic (point de mesure), un geste long déplace sans poser de point', () => {
  const { g, vus } = graphique();
  g.definir(donnees());
  const { x, y } = g.px(50, 325);
  g.debutGeste(x, y);
  g.deplacerGeste(x + 2, y + 1);                   // sous le seuil : encore un clic
  g.finGeste(x + 2, y + 1);
  assert.equal(vus.length, 2);                     // [] à definir(), puis un point
  const avant = g.px(50, 325);
  g.zoomer(avant.x, avant.y, 4);
  const p0 = g.px(50, 325);
  g.debutGeste(100, 100);
  g.deplacerGeste(140, 100);                       // assez loin : on déplace
  g.finGeste(140, 100);
  assert.equal(vus.length, 2);                     // aucun point de plus
  proche(g.px(50, 325).x, p0.x + 40);
});

test('hors de l’écran, un point n’est pas visé et un clic au bord ne lui est pas accroché', () => {
  const { g, vus } = graphique();
  g.definir(donnees());
  const a = g.px(0, 300);
  g.zoomer(g.px(100, 300).x, g.px(100, 300).y, 8);   // on zoome sur le bout de l'axe : s = 0 sort de l'écran
  g.clic(70, 150);
  assert.notEqual(vus.at(-1)[0].s, 0);
  assert.ok(a.x > 0);
});

// ── Les graduations suivent la place disponible (vu sur téléphone : « 0 m5 m10 m15 m… ») ──

/** Un canevas de la largeur donnée, dont on relève les textes écrits. */
function canevasTextes(largeur, hauteur) {
  const textes = [];
  const ctx = new Proxy({}, { get: (_, nom) => (nom === 'fillText' ? (t) => { textes.push(t); } : () => {}), set: () => true });
  return {
    textes, width: 0, height: 0, style: {}, addEventListener() {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: largeur, height: hauteur }),
  };
}

test('moins de place, moins de graduations : celles de l’axe horizontal ne se chevauchent pas', () => {
  const large = canevasTextes(1000, 400), etroit = canevasTextes(300, 400);
  graphique(ProfilGraphique, large).g.definir(donnees());
  graphique(ProfilGraphique, etroit).g.definir(donnees());
  const enM = (c) => c.textes.filter((t) => /^\d+ m$/.test(t));
  assert.ok(enM(etroit).length < enM(large).length, `${enM(etroit).length} ≥ ${enM(large).length}`);
  // Sur 300 px (230 utiles), chaque graduation de l'axe horizontal garde au moins ~60 px.
  const horizontales = etroit.textes.filter((t) => /^(0|20|40|60|80|100) m$/.test(t));
  assert.ok(horizontales.length * 60 <= 300, `${horizontales.length} graduations sur 300 px`);
});
