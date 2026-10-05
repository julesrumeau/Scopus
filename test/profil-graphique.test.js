// Le graphique du profil : l'accrochage des repères, la chaîne de mesure et la
// tranche de largeur. Le dessin lui-même se vérifie à l'œil dans le navigateur ;
// ici, un canevas factice dont le contexte avale tous les appels.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { ProfilGraphique } = chargerScripts(['config.js', 'profil.js', 'profil-geste.js', 'profil-graphique.js']);

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

test('definir(null) vide le graphique sans erreur ; un clic sur un graphique vide ne pose rien', () => {
  const { g, vus } = graphique();
  g.definir(donnees());
  const { x, y } = g.px(50, 325);
  g.clic(x, y);
  g.definir(null);
  const avant = vus.length;
  g.clic(100, 100);   // clic sur un graphique vide : rien, pas d'exception
  assert.equal(vus.length, avant);
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
  const page = chargerScripts(['config.js', 'profil.js', 'profil-geste.js', 'profil-graphique.js']);
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

// ── Les outils et le point de référence (R6) ─────────────────────────────────

/** Un graphique avec ses deux rappels : la chaîne de mesure, et la référence (un point, ou null). */
function avecReference(canevas = canevasFactice()) {
  const mesures = [], refs = [];
  const g = new ProfilGraphique(
    canevas,
    (pts) => mesures.push(JSON.parse(JSON.stringify(pts.map((p) => ({ s: p.s, z: p.z }))))),
    (p) => refs.push(p ? { s: p.s, z: p.z } : null),
  );
  return { g, mesures, refs };
}

/** Trois points, dont un à mi-hauteur : sol à 300 m, un point à 312 m, une cime à 325 m. */
const donneesRef = () => ({
  n: 3, s: Float32Array.of(0, 50, 100), z: Float32Array.of(300, 312, 325),
  d: new Float32Array(3), cls: Uint8Array.of(2, 5, 5), longueur: 100,
});

test('outil : la mesure par défaut, comme avant — un clic pose un point de mesure', () => {
  const { g, mesures } = avecReference();
  g.definir(donneesRef());
  assert.equal(g.outil, 'mesure');
  const { x, y } = g.px(50, 312);
  g.clic(x, y);
  assert.deepEqual(mesures.at(-1), [{ s: 50, z: 312 }]);
});

test('outil Déplacement : un clic ne pose ni point de mesure ni référence', () => {
  const { g, mesures, refs } = avecReference();
  g.definir(donneesRef());
  g.definirOutil('deplacement');
  const { x, y } = g.px(50, 312);
  g.debutGeste(x, y);
  g.finGeste(x, y);                 // un appui sans bouger : un clic, qui ne fait rien ici
  assert.deepEqual(mesures.at(-1), []);   // seul le definir() initial a appelé le rappel
  assert.equal(mesures.length, 1);
  assert.equal(refs.length, 0);
  assert.equal(g.reference, null);
});

test('outil Déplacement : le glisser déplace quand même la vue', () => {
  const { g } = avecReference();
  g.definir(donneesRef());
  g.definirOutil('deplacement');
  const { x, y } = g.px(50, 312);
  g.zoomer(x, y, 4);
  const avant = g.px(50, 312);
  g.debutGeste(100, 100);
  g.deplacerGeste(140, 100);
  g.finGeste(140, 100);
  assert.ok(Math.abs(g.px(50, 312).x - (avant.x + 40)) < 0.5);
});

test('outil Point de référence : le clic s’accroche au point le plus proche et le pose', () => {
  const { g, mesures, refs } = avecReference();
  g.definir(donneesRef());
  g.definirOutil('reference');
  const { x, y } = g.px(50, 312);
  g.clic(x + 4, y - 3);
  assert.deepEqual(refs.at(-1), { s: 50, z: 312 });
  assert.equal(g.reference.z, 312);
  assert.equal(mesures.length, 1);          // la mesure n'a pas bougé (le definir() initial seulement)
});

test('un seul point de référence : le clic suivant remplace le précédent', () => {
  const { g, refs } = avecReference();
  g.definir(donneesRef());
  g.definirOutil('reference');
  const a = g.px(0, 300), b = g.px(100, 325);
  g.clic(a.x, a.y);
  g.clic(b.x, b.y);
  assert.deepEqual(refs, [{ s: 0, z: 300 }, { s: 100, z: 325 }]);
  assert.equal(g.reference.z, 325);
});

test('effacerReference : retire le point et le dit ; sans référence, ne dit rien', () => {
  const { g, refs } = avecReference();
  g.definir(donneesRef());
  g.effacerReference();
  assert.equal(refs.length, 0);             // rien à effacer : pas d'appel
  g.definirOutil('reference');
  const { x, y } = g.px(50, 312);
  g.clic(x, y);
  g.effacerReference();
  assert.equal(refs.at(-1), null);
  assert.equal(g.reference, null);
});

test('la référence ET la mesure survivent à un recalcul de la même ligne (largeur changée, fenêtre rouverte)', () => {
  const { g, mesures, refs } = avecReference();
  g.definir(donneesRef());
  const p = g.px(50, 312);
  g.clic(p.x, p.y);                          // une mesure
  g.definirOutil('reference');
  g.clic(p.x, p.y);                          // une référence
  g.definir(donneesRef());                   // la largeur a changé : mêmes distances, mêmes altitudes
  assert.equal(g.reference.z, 312);          // la référence est gardée
  assert.equal(refs.at(-1) !== null, true);
  assert.deepEqual(mesures.at(-1), [{ s: 50, z: 312 }]);   // la chaîne aussi, et l'appelant la reçoit
});

test('avec une référence, les graduations se lisent depuis elle : 0 en son point, négatives en bas et à gauche', () => {
  const c = canevasTextes(1000, 400);
  const { g } = avecReference(c);
  g.definir(donneesRef());
  assert.ok(c.textes.includes('300 m'), 'sans référence : des altitudes');
  assert.ok(!c.textes.some((t) => t.startsWith('-')), 'sans référence : rien de négatif');
  g.definirOutil('reference');
  const { x, y } = g.px(50, 312);
  g.clic(x, y);
  c.textes.length = 0;
  g.rendre();
  assert.ok(c.textes.includes('0 m'), '0 au point de référence');
  assert.ok(c.textes.includes('-10 m'), 'en dessous de la référence : négatif');
  assert.ok(c.textes.includes('10 m'), 'au-dessus : positif');
  assert.ok(c.textes.includes('-50 m') && c.textes.includes('50 m'), 'à gauche et à droite de la référence');
  assert.ok(!c.textes.includes('300 m'), 'plus d’altitudes absolues');
  g.effacerReference();
  c.textes.length = 0;
  g.rendre();
  assert.ok(c.textes.includes('300 m') && !c.textes.some((t) => t.startsWith('-')), 'effacée : on retrouve les altitudes');
});

test('un outil inconnu est refusé : on garde l’outil courant', () => {
  const { g } = avecReference();
  g.definirOutil('reference');
  g.definirOutil('nimporte');
  assert.equal(g.outil, 'reference');
});

// ── Échelles égales ──────────────────────────────────────────────────────────

/** Mètres par pixel en X (distance) et en Z (altitude), lus sur le graphique lui-même. */
const metresParPixel = (g) => {
  const a = g.px(0, 300), b = g.px(100, 300), c = g.px(0, 325);
  return { x: 100 / (b.x - a.x), z: 25 / (a.y - c.y) };
};

test('échelles égales par défaut : autant de mètres par pixel en X qu’en Z', () => {
  const { g } = graphique();
  g.definir(donnees());
  const m = metresParPixel(g);
  assert.ok(Math.abs(m.x - m.z) / m.x < 1e-6, `X ${m.x} m/px, Z ${m.z} m/px`);
});

test('sans les échelles égales, l’ancienne vue : la hauteur est ajustée aux points', () => {
  const { g } = graphique();
  g.definirEgales(false);
  g.definir(donnees());
  const m = metresParPixel(g);
  assert.ok(m.z < m.x * 0.7, `X ${m.x}, Z ${m.z} : l'étendue verticale n'aurait pas dû suivre l'horizontale`);
});

test('échelles égales : un profil haut tient tout entier dans la zone de tracé, vide de part et d’autre', () => {
  const { g } = graphique();
  g.definir({ n: 3, s: Float32Array.of(0, 50, 100), z: Float32Array.of(300, 400, 300), d: Float32Array.of(0, 0, 0), cls: Uint8Array.of(2, 5, 2), longueur: 100 });
  const m = g.marge, W = 600, H = 300;
  for (const [s, z] of [[0, 300], [100, 300], [50, 400]]) {
    const p = g.px(s, z);
    assert.ok(p.x >= m.g - 0.5 && p.x <= W - m.d + 0.5, `x ${p.x} pour (${s}, ${z})`);
    assert.ok(p.y >= m.h - 0.5 && p.y <= H - m.b + 0.5, `y ${p.y} pour (${s}, ${z})`);
  }
  const a = g.px(0, 300), b = g.px(100, 300);
  assert.ok(a.x > m.g + 20, 'le profil est plus étroit que la zone : de l’espace de chaque côté');
  assert.ok(b.x < W - m.d - 20);
});

test('échelles égales : zoomer garde l’égalité et le point sous le curseur en place', () => {
  const { g } = graphique();
  g.definir(donnees());
  const avant = g.px(50, 325);
  g.zoomer(avant.x, avant.y, 2);
  const apres = g.px(50, 325);
  assert.ok(Math.abs(apres.x - avant.x) < 0.5 && Math.abs(apres.y - avant.y) < 0.5, `(${avant.x}, ${avant.y}) → (${apres.x}, ${apres.y})`);
  const m = metresParPixel(g);
  assert.ok(Math.abs(m.x - m.z) / m.x < 1e-6, `X ${m.x}, Z ${m.z}`);
});

test('échelles égales : déplacer la vue garde l’égalité', () => {
  const { g } = graphique();
  g.definir(donnees());
  const p = g.px(50, 312);
  g.zoomer(p.x, p.y, 3);
  g.deplacer(40, -25);
  const m = metresParPixel(g);
  assert.ok(Math.abs(m.x - m.z) / m.x < 1e-6, `X ${m.x}, Z ${m.z}`);
});

test('définirEgales rebascule et recadre : le profil entier, à la nouvelle échelle', () => {
  const { g } = graphique();
  g.definirEgales(false);
  g.definir(donnees());
  g.definirEgales(true);
  const m = metresParPixel(g);
  assert.ok(Math.abs(m.x - m.z) / m.x < 1e-6, `X ${m.x}, Z ${m.z}`);
  const a = g.px(0, 300), b = g.px(100, 300);
  assert.ok(a.x >= g.marge.g - 0.5 && b.x <= 600 - g.marge.d + 0.5);
});

// ── Ce qui reste d'une ouverture à l'autre (R18) ─────────────────────────────

test('definir garde la chaîne de mesure et la redit à l’appelant (la fenêtre rouverte la retrouve)', () => {
  const { g, vus } = graphique();
  g.definir(donnees());
  const a = g.px(0, 300), b = g.px(50, 325);
  g.clic(a.x, a.y);
  g.clic(b.x, b.y);
  g.definir(donnees());
  assert.deepEqual(vus.at(-1), [{ s: 0, z: 300 }, { s: 50, z: 325 }]);
  g.clic(g.px(100, 300).x, g.px(100, 300).y);
  assert.equal(vus.at(-1).length, 3, 'la suite de la chaîne continue après la reprise');
});

test('definir(d, { garder }) garde la vue zoomée ; sans « garder », la vue entière', () => {
  const { g } = graphique();
  g.definir(donnees());
  g.zoomer(300, 150, 4);
  const [s0, s1] = [g.s0, g.s1];
  assert.ok(s1 - s0 < 100);
  g.definir(donnees(), { garder: true });
  assert.deepEqual([g.s0, g.s1], [s0, s1]);
  g.definir(donnees());
  assert.deepEqual([g.s0, g.s1], [0, 100]);
});

test('reinitialiser efface la chaîne, la référence, la tranche et le zoom, et le dit', () => {
  const mesures = [], refs = [];
  const g = new ProfilGraphique(canevasFactice(), (p) => mesures.push(p.length), (r) => refs.push(r));
  g.definir(donnees());
  const p = g.px(50, 325);
  g.clic(p.x, p.y);
  g.definirOutil('reference');
  g.clic(p.x, p.y);
  g.definirLateral(-1, 1);
  g.zoomer(300, 150, 4);
  g.reinitialiser();
  assert.equal(g.mesure.length, 0);
  assert.equal(g.reference, null);
  assert.equal(mesures.at(-1), 0);
  assert.equal(refs.at(-1), null);
  assert.deepEqual([g.s0, g.s1], [0, 100]);
  assert.equal(g.lat.min, -Infinity);
});

test('reinitialiser sur un graphique vide ne lève pas', () => {
  const { g } = graphique();
  assert.doesNotThrow(() => g.reinitialiser());
});

// ── Modifier la chaîne : saisir, déplacer, supprimer un point (R18 n°2) ──────

/** Un graphique avec trois points de mesure posés : A (0 m), B (50 m, cime), C (100 m). */
function avecTroisPoints() {
  const r = graphique();
  r.g.definir(donnees());
  for (const [s, z] of [[0, 300], [50, 325], [100, 300]]) { const p = r.g.px(s, z); r.g.clic(p.x, p.y); }
  return r;
}

test('pointMesureProche : l’indice du point de la chaîne sous le curseur, -1 sinon', () => {
  const { g } = avecTroisPoints();
  const b = g.px(50, 325);
  assert.equal(g.pointMesureProche(b.x + 3, b.y - 4, 'mouse'), 1);
  assert.equal(g.pointMesureProche(b.x + 40, b.y, 'mouse'), -1);
  assert.equal(graphique().g.pointMesureProche(10, 10, 'mouse'), -1, 'chaîne vide');
});

test('pointMesureProche : la zone de saisie est plus large au doigt qu’à la souris', () => {
  const { g } = avecTroisPoints();
  const b = g.px(50, 325);
  assert.equal(g.pointMesureProche(b.x + 18, b.y, 'mouse'), -1);
  assert.equal(g.pointMesureProche(b.x + 18, b.y, 'touch'), 1);
});

test('pointMesureProche : de deux points proches, le plus proche gagne', () => {
  const r = graphique();
  r.g.definir(donnees());
  const a = r.g.px(48, 325), b = r.g.px(52, 325);
  r.g.mesure = [{ s: 48, z: 325 }, { s: 52, z: 325 }];
  assert.equal(r.g.pointMesureProche(b.x - 1, b.y, 'mouse'), 1);
  assert.equal(r.g.pointMesureProche(a.x + 1, a.y, 'mouse'), 0);
});

test('deplacerPoint : le point suit le curseur, accroché au point visible le plus proche, et l’appelant le sait', () => {
  const { g, vus } = avecTroisPoints();
  const cible = g.px(50, 325);
  g.deplacerPoint(0, cible.x + 3, cible.y + 2);          // près de la cime
  assert.deepEqual(vus.at(-1)[0], { s: 50, z: 325 });
  assert.equal(vus.at(-1).length, 3, 'les autres points ne bougent pas, aucun ajout');
  const libre = g.px(20, 310);
  g.deplacerPoint(2, libre.x, libre.y);                  // loin de tout : à la position du curseur
  assert.ok(Math.abs(vus.at(-1)[2].s - 20) < 0.5 && Math.abs(vus.at(-1)[2].z - 310) < 0.5);
});

test('deplacerPoint : un indice hors chaîne ne fait rien et ne lève pas', () => {
  const { g, vus } = avecTroisPoints();
  const avant = vus.length;
  g.deplacerPoint(7, 100, 100);
  g.deplacerPoint(-1, 100, 100);
  assert.equal(vus.length, avant);
});

test('retirerPoint : retire ce point et le dit ; les autres gardent leur ordre', () => {
  const { g, vus } = avecTroisPoints();
  g.retirerPoint(1);
  assert.deepEqual(vus.at(-1), [{ s: 0, z: 300 }, { s: 100, z: 300 }]);
  g.retirerPoint(5);                                     // hors chaîne : rien
  assert.equal(vus.at(-1).length, 2);
});

test('le geste : souris sur un point, glisser, relâcher déplace ce point et ne pose rien', () => {
  const { g, vus } = avecTroisPoints();
  const b = g.px(50, 325), cible = g.px(25, 312);
  g.debutGeste(b.x, b.y);                                // saisi tout de suite à la souris
  g.deplacerGeste(cible.x, cible.y);
  g.finGeste(cible.x, cible.y);
  assert.equal(vus.at(-1).length, 3);
  assert.ok(Math.abs(vus.at(-1)[1].s - 25) < 1);
});

test('le geste : souris hors des points, glisser déplace toujours le graphique (comme avant)', () => {
  const { g, vus } = avecTroisPoints();
  g.zoomer(300, 150, 4);
  const [s0] = [g.s0];
  const avant = vus.length;
  g.debutGeste(500, 20);
  g.deplacerGeste(560, 20);
  g.finGeste(560, 20);
  assert.notEqual(g.s0, s0);
  assert.equal(vus.length, avant, 'aucun point posé ni déplacé');
});

test('saisi et survolé : le point grossi est connu pour le dessin, et se libère', () => {
  const { g } = avecTroisPoints();
  const b = g.px(50, 325);
  g.survoler(b.x, b.y);
  assert.equal(g.survole, 1);
  g.survoler(5, 5);
  assert.equal(g.survole, -1);
  g.debutGeste(b.x, b.y);
  assert.equal(g.saisi, 1);
  g.finGeste(b.x, b.y);
  assert.equal(g.saisi, -1);
});

// ── Le pincement sur le vrai graphique ───────────────────────────────────────

test('pincer écarte la fenêtre : la vue zoome et le point sous le milieu des doigts reste en place', () => {
  const { g } = graphique();
  g.definir(donnees());
  const sous = g.px(50, 312);
  const avant = [g.s0, g.s1];
  g.pincement.debut({ x: sous.x - 40, y: sous.y }, { x: sous.x + 40, y: sous.y });
  g.pincement.deplacement({ x: sous.x - 80, y: sous.y }, { x: sous.x + 80, y: sous.y });
  assert.ok(g.s1 - g.s0 < avant[1] - avant[0], 'la fenêtre est plus étroite');
  const apres = g.px(50, 312);
  assert.ok(Math.abs(apres.x - sous.x) < 1, 'le point sous les doigts n’a pas bougé');
});

test('pincer deux doigts annule la saisie d’un point en cours (on ne déplace pas un point en zoomant)', () => {
  const { g, vus } = avecTroisPoints();
  const b = g.px(50, 325);
  g.debutGeste(b.x, b.y);                                // la souris saisit B
  assert.equal(g.saisi, 1);
  g.annulerGeste();                                      // un second doigt arrive
  assert.equal(g.saisi, -1);
  assert.equal(g.gesteur.enCours(), false);
  const avant = vus.length;
  g.deplacerGeste(b.x + 50, b.y);                        // le doigt restant ne déplace rien
  assert.equal(vus.length, avant);
});
