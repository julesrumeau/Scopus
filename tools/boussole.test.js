// Conventions de la boussole 3D.
//
// Une erreur de signe dans cette projection ne casse rien : elle produit une
// rose parfaitement plausible, où le nord est simplement au mauvais endroit. On
// s'en apercevrait au premier export GPX, longtemps après. D'où ces contrôles,
// qui font tourner le vrai code — `Vue3D._repere` compris, la seule source du
// repère caméra — contre des orientations dont on connaît la réponse.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SRC = new URL('../src/', import.meta.url);
const lire = (nom) => readFileSync(fileURLToPath(new URL(nom, SRC)), 'utf8');

/**
 * DOM minuscule : la boussole ne fait que créer des nœuds SVG, leur poser des
 * attributs et les réordonner. Rien ici n'a besoin d'un navigateur.
 */
function faireDocument() {
  const creer = (nom) => ({
    nom,
    attributs: {},
    enfants: [],
    textContent: '',
    setAttribute(k, v) { this.attributs[k] = v; },
    getAttribute(k) { return this.attributs[k]; },
    // Réattacher un nœud déjà présent le déplace en fin de liste, comme le vrai
    // DOM : c'est ce qui donne son ordre au dessin.
    appendChild(e) {
      const i = this.enfants.indexOf(e);
      if (i >= 0) this.enfants.splice(i, 1);
      this.enfants.push(e);
      return e;
    },
    addEventListener() {},
    classList: {
      _c: new Set(),
      toggle(c, actif) { if (actif) this._c.add(c); else this._c.delete(c); },
      contains(c) { return this._c.has(c); },
    },
  });
  return { createElementNS: (_ns, nom) => creer(nom) };
}

function charger() {
  const contexte = vm.createContext({
    document: faireDocument(),
    performance,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  });
  vm.runInContext(lire('boussole.js'), contexte);
  vm.runInContext(lire('vue3d.js'), contexte);
  return vm.runInContext('({ Boussole, Vue3D })', contexte);
}

/**
 * Une vue3D sans WebGL : le constructeur veut un canevas et des shaders, mais
 * la géométrie de la caméra n'en dépend pas.
 */
function faireVue(Vue3D, azimut, elevation) {
  const v = Object.create(Vue3D.prototype);
  v.cam = { cible: [0, 0, 0], distance: 100, azimut, elevation };
  v.actif = false;          // `invalider()` rend la main aussitôt
  v._animation = 0;
  v.boussole = null;
  return v;
}

/** Conteneur d'accueil, réduit à ce que la boussole en attend. */
function faireHote() {
  return {
    enfants: [],
    setAttribute() {},
    appendChild(e) {
      const i = this.enfants.indexOf(e);
      if (i >= 0) this.enfants.splice(i, 1);
      this.enfants.push(e);
      return e;
    },
  };
}

const poignees = (hote) => Object.fromEntries(
  hote.enfants.filter((e) => e.nom === 'g').map((g) => {
    const [x, y] = g.attributs.transform.match(/-?[\d.]+/g).map(Number);
    return [g.enfants.find((e) => e.nom === 'text').textContent, { x, y, g }];
  }));

test('la rose place les cardinaux là où la caméra les voit', () => {
  const { Boussole, Vue3D } = charger();

  // Caméra tournée vers le nord, inclinée de 28,6° au-dessus de l'horizontale.
  const hote = faireHote();
  new Boussole(hote, () => {}).orienter(faireVue(Vue3D, 0, 0.5)._repere());

  const p = poignees(hote);

  // Regarder vers le nord met le nord en haut de l'écran, et donc au fond.
  assert.ok(Math.abs(p.N.x) < 0.5, `N décalé horizontalement : ${p.N.x}`);
  assert.ok(p.N.y < -5, `N devrait être en haut de la rose, y = ${p.N.y}`);
  assert.ok(p.N.g.classList.contains('loin'), 'N devrait être du côté opposé');

  assert.ok(p.S.y > 5, `S devrait être en bas, y = ${p.S.y}`);
  assert.ok(!p.S.g.classList.contains('loin'), 'S devrait être de notre côté');

  // L'est est à droite quand on regarde le nord — pas l'inverse.
  assert.ok(p.E.x > 30, `E devrait être à droite, x = ${p.E.x}`);
  assert.ok(p.O.x < -30, `O devrait être à gauche, x = ${p.O.x}`);
  assert.ok(Math.abs(p.E.y) < 0.5 && Math.abs(p.O.y) < 0.5, 'E et O sur la ligne d’horizon');

  // Le haut est en haut, quelle que soit l'inclinaison.
  assert.ok(p['↑'].y < -20, `↑ devrait être en haut, y = ${p['↑'].y}`);
  assert.ok(p['↓'].y > 20, `↓ devrait être en bas, y = ${p['↓'].y}`);

  // Ordre du peintre : les poignées lointaines d'abord.
  const ordre = hote.enfants.filter((e) => e.nom === 'g');
  assert.ok(ordre.indexOf(p.N.g) < ordre.indexOf(p.S.g),
    'le nord, plus lointain, doit être dessiné avant le sud');
});

test('la rose suit l’azimut', () => {
  const { Boussole, Vue3D } = charger();
  const hote = faireHote();

  // Quart de tour : en regardant vers l'est, c'est le sud qui passe à droite.
  new Boussole(hote, () => {}).orienter(faireVue(Vue3D, -Math.PI / 2, 0.5)._repere());
  const p = poignees(hote);
  assert.ok(p.E.y < -5, `E devrait être au fond, y = ${p.E.y}`);
  assert.ok(p.S.x > 30, `S devrait être à droite, x = ${p.S.x}`);
  assert.ok(p.N.x < -30, `N devrait être à gauche, x = ${p.N.x}`);
});

test('cliquer un cardinal amène cette direction en haut de l’écran', () => {
  const { Vue3D } = charger();

  // Direction monde → axe de visée attendu, en (x, z). Nord = −Z.
  const cas = [
    ['N', [0, 0, -1]],
    ['E', [1, 0, 0]],
    ['S', [0, 0, 1]],
    ['O', [-1, 0, 0]],
  ];

  for (const [nom, v] of cas) {
    const vue = faireVue(Vue3D, 2.4, 0);   // azimut quelconque, vue horizontale
    let demande = null;
    vue._animerVers = (azimut, elevation) => { demande = { azimut, elevation }; };
    vue.orienterVers(v);

    assert.equal(demande.elevation, 0, `${nom} : l'inclinaison ne doit pas bouger`);
    vue.cam.azimut = demande.azimut;
    const { avant } = vue._repere();
    for (const i of [0, 1, 2]) {
      assert.ok(Math.abs(avant[i] - v[i]) < 1e-9,
        `${nom} : la caméra devrait regarder vers [${v}], elle regarde [${avant.map((c) => c.toFixed(3))}]`);
    }
  }
});

test('cliquer haut ou bas change le point de vue, pas le cap', () => {
  const { Vue3D } = charger();

  for (const [v, signe] of [[[0, 1, 0], 1], [[0, -1, 0], -1]]) {
    const vue = faireVue(Vue3D, 2.4, 0.3);
    let demande = null;
    vue._animerVers = (azimut, elevation) => { demande = { azimut, elevation }; };
    vue.orienterVers(v);

    assert.equal(demande.azimut, 2.4, 'le cap doit être conservé');
    assert.ok(Math.sign(demande.elevation) === signe && Math.abs(demande.elevation) > 1.5,
      `inclinaison attendue quasi verticale, obtenue ${demande.elevation}`);
    // Bornée sous 90° : au zénith exact, lookAt dégénère.
    assert.ok(Math.abs(demande.elevation) < Math.PI / 2, 'jamais le zénith exact');
  }
});

test('la boussole reste lisible aux inclinaisons extrêmes', () => {
  const { Vue3D } = charger();

  // Au ras du sol comme à la verticale, la rose s'écraserait sur un trait et
  // deux poignées opposées se superposeraient au centre : l'inclinaison de
  // dessin est bornée, l'azimut jamais.
  for (const e of [0, 0.05, 1.553, -1.553]) {
    const vue = faireVue(Vue3D, 0.7, e);
    const rep = vue._repereBoussole();
    const versLeHaut = rep.haut[1];               // = cos(inclinaison dessinée)
    const aplatissement = Math.abs(rep.avant[1]); // = |sin(inclinaison dessinée)|
    assert.ok(versLeHaut > 0.25, `axe vertical écrasé à e=${e} : ${versLeHaut}`);
    assert.ok(aplatissement > 0.25, `horizon écrasé à e=${e} : ${aplatissement}`);
    // Le cap, lui, doit rester exact : c'est ce qu'on lit sur la rose.
    assert.ok(Math.abs(rep.droite[0] - Math.cos(0.7)) < 1e-9, 'azimut altéré');
  }
});
