// Le geste sur le graphique du profil : un appui saisit un point de la chaîne (souris : tout de suite ;
// doigt : après un appui long, pour ne pas le confondre avec un déplacement du graphique), sinon c'est le
// clic ou le glissé d'avant. Une machine à états pure, avec un minuteur injecté : pas de navigateur ici.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chargerScripts } from './charger.js';

const { creerGesteProfil } = chargerScripts(['profil-geste.js']);

/** Un geste branché sur un journal ; `point` : l'indice saisissable sous (x, y), ou -1. */
function banc({ point = () => -1, delaiMs = 400 } = {}) {
  const journal = [];
  const minuteurs = new Map();
  let n = 0;
  const g = creerGesteProfil({
    saisir: (x, y, type) => point(x, y, type),
    delaiMs,
    minuteur: {
      demarrer: (f, ms) => { minuteurs.set(++n, { f, ms }); return n; },
      annuler: (id) => minuteurs.delete(id),
    },
    actions: {
      saisi: (i) => journal.push(['saisi', i]),
      deplacerPoint: (i, x, y) => journal.push(['point', i, x, y]),
      pose: (i) => journal.push(['pose', i]),
      clic: (x, y) => journal.push(['clic', x, y]),
      deplacerVue: (dx, dy) => journal.push(['vue', dx, dy]),
    },
  });
  /** Laisse passer le délai : déclenche les minuteurs encore armés. */
  const ecouler = () => { for (const [id, m] of [...minuteurs]) { minuteurs.delete(id); m.f(); } };
  return { g, journal, minuteurs, ecouler };
}
const sur = (i, x0 = 100, y0 = 50) => (x, y) => (Math.hypot(x - x0, y - y0) <= 10 ? i : -1);

test('souris sur un point : saisi tout de suite, il suit le curseur, posé au relâchement, aucun clic', () => {
  const { g, journal } = banc({ point: sur(2) });
  g.appui(100, 50, 'mouse');
  assert.deepEqual(journal, [['saisi', 2]]);
  g.deplacement(120, 60);
  g.relache(120, 60);
  assert.deepEqual(journal, [['saisi', 2], ['point', 2, 120, 60], ['pose', 2]]);
});

test('souris sur un point sans bouger : le point est posé là où il était, sans clic (pas de point en double)', () => {
  const { g, journal } = banc({ point: sur(0) });
  g.appui(100, 50, 'mouse');
  g.relache(100, 50);
  assert.ok(!journal.some((j) => j[0] === 'clic'));
});

test('souris hors d’un point : un appui court est un clic', () => {
  const { g, journal } = banc();
  g.appui(300, 80, 'mouse');
  g.deplacement(302, 81);   // moins de 4 px : encore un clic
  g.relache(302, 81);
  assert.deepEqual(journal, [['clic', 302, 81]]);
});

test('souris hors d’un point : au-delà de 4 px, le graphique se déplace, sans clic', () => {
  const { g, journal } = banc();
  g.appui(300, 80, 'mouse');
  g.deplacement(310, 80);
  g.deplacement(320, 85);
  g.relache(320, 85);
  assert.deepEqual(journal, [['vue', 10, 0], ['vue', 10, 5]]);
});

test('doigt sur un point : pas de saisie avant le délai, un minuteur est armé', () => {
  const { g, journal, minuteurs } = banc({ point: sur(1), delaiMs: 400 });
  g.appui(100, 50, 'touch');
  assert.deepEqual(journal, []);
  assert.equal(minuteurs.size, 1);
  assert.equal([...minuteurs.values()][0].ms, 400);
});

test('doigt : le délai écoulé saisit le point (retour visuel), puis il suit le doigt et se pose', () => {
  const { g, journal, ecouler } = banc({ point: sur(1) });
  g.appui(100, 50, 'touch');
  ecouler();
  assert.deepEqual(journal, [['saisi', 1]]);
  g.deplacement(140, 70);
  g.relache(140, 70);
  assert.deepEqual(journal, [['saisi', 1], ['point', 1, 140, 70], ['pose', 1]]);
});

test('doigt : un doigt qui se lève avant le délai ne pose rien (toucher un point n’en ajoute pas un second)', () => {
  const { g, journal, minuteurs } = banc({ point: sur(1) });
  g.appui(100, 50, 'touch');
  g.relache(100, 50);
  assert.deepEqual(journal, []);
  assert.equal(minuteurs.size, 0, 'le minuteur est annulé');
});

test('doigt : un doigt qui glisse avant le délai déplace le graphique, il ne saisit rien', () => {
  const { g, journal, minuteurs, ecouler } = banc({ point: sur(1) });
  g.appui(100, 50, 'touch');
  g.deplacement(112, 50);               // plus de 8 px : c'est un glissé du graphique
  assert.equal(minuteurs.size, 0, 'le minuteur est annulé');
  ecouler();
  assert.ok(!journal.some((j) => j[0] === 'saisi'));
  assert.deepEqual(journal, [['vue', 12, 0]]);
  g.relache(112, 50);
});

test('doigt : un léger tremblement (moins de 8 px) ne fait pas perdre l’appui long', () => {
  const { g, journal, ecouler } = banc({ point: sur(1) });
  g.appui(100, 50, 'touch');
  g.deplacement(104, 52);
  ecouler();
  assert.deepEqual(journal, [['saisi', 1]]);
});

test('doigt hors d’un point : comme à la souris, clic bref ou glissé, et aucun minuteur', () => {
  const { g, journal, minuteurs } = banc();
  g.appui(300, 80, 'touch');
  assert.equal(minuteurs.size, 0);
  g.relache(300, 80);
  assert.deepEqual(journal, [['clic', 300, 80]]);
});

test('le stylet se traite comme la souris : saisie immédiate', () => {
  const { g, journal } = banc({ point: sur(3) });
  g.appui(100, 50, 'pen');
  assert.deepEqual(journal, [['saisi', 3]]);
});

test('annuler (appui interrompu) arme plus rien et ne pose rien', () => {
  const { g, journal, minuteurs, ecouler } = banc({ point: sur(1) });
  g.appui(100, 50, 'touch');
  g.annuler();
  ecouler();
  assert.equal(minuteurs.size, 0);
  assert.deepEqual(journal, []);
  g.relache(100, 50);                    // un relâchement tardif ne fait rien
  assert.deepEqual(journal, []);
});

test('un nouvel appui pendant un geste repart de zéro (pas d’état qui traîne)', () => {
  const { g, journal, ecouler } = banc({ point: sur(1) });
  g.appui(100, 50, 'touch');
  g.appui(300, 80, 'touch');             // autre appui : le premier minuteur ne doit plus rien saisir
  ecouler();
  assert.ok(!journal.some((j) => j[0] === 'saisi'));
});

test('le type d’appui est passé à la recherche du point (zone plus large au doigt)', () => {
  const vus = [];
  const { g } = banc({ point: (x, y, type) => { vus.push(type); return -1; } });
  g.appui(1, 1, 'touch');
  g.appui(1, 1, 'mouse');
  assert.deepEqual(vus, ['touch', 'mouse']);
});

// ── Le pincement à deux doigts : zoomer et déplacer le graphique ────────────

const { creerPincementProfil } = chargerScripts(['profil-geste.js']);

function pincement() {
  const appels = [];
  const p = creerPincementProfil({
    surZoom: (x, y, f) => appels.push(['zoom', x, y, Number(f.toFixed(4))]),
    surDeplacer: (dx, dy) => appels.push(['vue', dx, dy]),
  });
  return { p, appels };
}

test('pincement : écarter les doigts zoome, autour du milieu des deux doigts', () => {
  const { p, appels } = pincement();
  p.debut({ x: 100, y: 100 }, { x: 200, y: 100 });
  p.deplacement({ x: 50, y: 100 }, { x: 250, y: 100 });      // l'écart double, le milieu ne bouge pas
  assert.deepEqual(appels, [['zoom', 150, 100, 2]]);
});

test('pincement : rapprocher les doigts dézoome', () => {
  const { p, appels } = pincement();
  p.debut({ x: 50, y: 100 }, { x: 250, y: 100 });
  p.deplacement({ x: 100, y: 100 }, { x: 200, y: 100 });
  assert.deepEqual(appels, [['zoom', 150, 100, 0.5]]);
});

test('pincement : déplacer les deux doigts ensemble déplace le graphique, sans zoomer', () => {
  const { p, appels } = pincement();
  p.debut({ x: 100, y: 100 }, { x: 200, y: 100 });
  p.deplacement({ x: 130, y: 120 }, { x: 230, y: 120 });
  assert.deepEqual(appels, [['vue', 30, 20]]);
});

test('pincement : zoomer et déplacer à la fois, et chaque mouvement part du précédent (incrémental)', () => {
  const { p, appels } = pincement();
  p.debut({ x: 100, y: 100 }, { x: 200, y: 100 });
  p.deplacement({ x: 90, y: 100 }, { x: 210, y: 100 });      // ×1,2
  p.deplacement({ x: 90, y: 100 }, { x: 210, y: 100 });      // rien de plus
  assert.deepEqual(appels, [['zoom', 150, 100, 1.2]]);
});

test('pincement : deux doigts au même endroit ne divisent pas par zéro', () => {
  const { p, appels } = pincement();
  p.debut({ x: 100, y: 100 }, { x: 100, y: 100 });
  p.deplacement({ x: 100, y: 100 }, { x: 140, y: 100 });
  assert.ok(!appels.some((a) => a[0] === 'zoom' && !Number.isFinite(a[3])));
});

test('pincement : après la fin, plus rien ne bouge ; enCours le dit', () => {
  const { p, appels } = pincement();
  assert.equal(p.enCours(), false);
  p.debut({ x: 100, y: 100 }, { x: 200, y: 100 });
  assert.equal(p.enCours(), true);
  p.fin();
  assert.equal(p.enCours(), false);
  p.deplacement({ x: 0, y: 0 }, { x: 300, y: 300 });
  assert.deepEqual(appels, []);
});
