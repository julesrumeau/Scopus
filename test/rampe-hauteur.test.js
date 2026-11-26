// La rampe de couleur « Hauteur/sol » de la 3D : un état (mode, limites en mètres, une couleur par tranche), sa texture de 1024
// couleurs lue par le shader, sa légende et son écriture dans le lien. Pur : aucun DOM ; le shader et la page sont lus comme du texte.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargerScripts } from './charger.js';

const { RAMPE_HAUTEUR: R } = chargerScripts(['rampe-hauteur.js']);
const A = (x) => JSON.parse(JSON.stringify(x));   // les objets du contexte du script n'ont pas le prototype de ceux du test
const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const rgb255 = (c) => A(R.couleur(c.h, c.etat).map((v) => Math.round(v * 255)));

test('classique : l’ancienne rampe (sombre, jaune à 35 % de la borne, rouge à la borne), 8 m par défaut', () => {
  const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  const ancienne = (h) => { const t = Math.min(1, Math.max(0, h / 8)); return t < 0.35 ? mix([0.18, 0.19, 0.22], [0.90, 0.72, 0.28], t / 0.35) : mix([0.90, 0.72, 0.28], [0.95, 0.35, 0.25], (t - 0.35) / 0.65); };
  const e = R.classique();
  assert.equal(e.mode, 'degrade');
  assert.equal(e.bornes.length, 2);
  for (const h of [0, 0.5, 1, 2.8, 4, 6, 8, 20]) {
    R.couleur(h, e).forEach((v, i) => assert.ok(Math.abs(v - ancienne(h)[i]) < 0.003, `h=${h} canal ${i} : ${v} contre ${ancienne(h)[i]}`));
  }
});

test('classique(h) : la borne est entière dans [5, 50] et le jaune reste à 35 %', () => {
  assert.equal(R.classique(35).bornes[1], 35);
  assert.equal(R.classique(2).bornes[1], 5);
  assert.equal(R.classique(200).bornes[1], 50);
  assert.equal(R.classique(NaN).bornes[1], 8);
  assert.ok(Math.abs(R.classique(35).bornes[0] - 12.25) < 1e-9);
});

test('paliers : une couleur par tranche, des marches franches aux limites', () => {
  const e = { mode: 'paliers', bornes: [5, 12], couleurs: ['#111111', '#222222', '#333333'] };
  const c = (h) => rgb255({ h, etat: e });
  assert.deepEqual(c(0), [17, 17, 17]);
  assert.deepEqual(c(4.99), [17, 17, 17]);
  assert.deepEqual(c(5), [34, 34, 34]);
  assert.deepEqual(c(11.99), [34, 34, 34]);
  assert.deepEqual(c(12), [51, 51, 51]);
  assert.deepEqual(c(80), [51, 51, 51]);
});

test('dégradé : chaque couleur est atteinte à sa limite, avec une transition douce entre deux', () => {
  const e = { mode: 'degrade', bornes: [10], couleurs: ['#000000', '#ff0000'] };
  assert.deepEqual(rgb255({ h: 0, etat: e }), [0, 0, 0]);
  assert.deepEqual(rgb255({ h: 5, etat: e }), [128, 0, 0]);
  assert.deepEqual(rgb255({ h: 10, etat: e }), [255, 0, 0]);
  assert.deepEqual(rgb255({ h: 30, etat: e }), [255, 0, 0]);
});

test('texels : 1024 couleurs opaques de 0 à 50 m, qui redonnent la couleur de chaque hauteur', () => {
  const e = R.preset('arc-en-ciel');
  const t = R.texels(e);
  assert.equal(t.length, 1024 * 4);
  assert.ok(t instanceof Uint8Array);
  for (let i = 3; i < t.length; i += 4) assert.equal(t[i], 255);
  for (const h of [0.3, 4, 17.7, 33, 49.9]) {
    const i = Math.floor(h / 50 * 1024);
    const attendu = A(R.couleur((i + 0.5) / 1024 * 50, e).map((v) => Math.round(v * 255)));
    assert.deepEqual(A([...t.slice(i * 4, i * 4 + 3)]), attendu, `h=${h}`);
  }
});

test('texels en paliers : la marche tombe à la limite, à 5 cm près', () => {
  const e = { mode: 'paliers', bornes: [22], couleurs: ['#e6b847', '#f25940'] };
  const t = R.texels(e);
  const px = (h) => A([...t.slice(Math.floor(h / 50 * 1024) * 4, Math.floor(h / 50 * 1024) * 4 + 3)]);
  assert.deepEqual(px(21.9), [0xe6, 0xb8, 0x47]);
  assert.deepEqual(px(22.1), [0xf2, 0x59, 0x40]);
});

test('normaliser : trie, borne à [0,5 ; 50] par pas de 0,5, écarte les doublons, refait les couleurs fausses, garde 1 à 11 limites', () => {
  const n = A(R.normaliser({ mode: 'paliers', bornes: [30, 5, 5.2, 60, -1], couleurs: ['#ABCDEF', 'rouge', '#123456', 'x', '#654321', '#000'] }));
  assert.deepEqual(n.bornes, [0.5, 5, 30, 50]);   // -1 est ramené à 0,5 (la tranche du sol) ; 5,2 tombe sur 5 ; 60 est ramené à 50
  assert.equal(n.couleurs.length, 5);
  for (const c of n.couleurs) assert.match(c, /^#[0-9a-f]{6}$/);
  assert.equal(n.couleurs[0], '#abcdef');
  assert.ok(n.couleurs.every((c) => /^#[0-9a-f]{6}$/.test(c)));
  assert.deepEqual(A(R.normaliser({ mode: 'x', bornes: [], couleurs: [] })), A(R.classique()));
  assert.deepEqual(A(R.normaliser(null)), A(R.classique()));
  const trop = R.normaliser({ mode: 'paliers', bornes: Array.from({ length: 30 }, (_, i) => i + 1), couleurs: [] });
  assert.equal(trop.bornes.length, 11);
  assert.equal(trop.couleurs.length, 12);
});

test('ajouterBorne : coupe la tranche ; refuse près d’une limite existante ; la 12e est refusée', () => {
  const e = { mode: 'paliers', bornes: [10], couleurs: ['#111111', '#222222'] };
  const a = A(R.ajouterBorne(e, 20));
  assert.deepEqual(a.bornes, [10, 20]);
  assert.equal(a.couleurs.length, 3);
  assert.equal(a.couleurs[0], '#111111');
  assert.equal(a.couleurs[1], '#222222');
  assert.match(a.couleurs[2], /^#[0-9a-f]{6}$/);
  assert.deepEqual(A(R.ajouterBorne(e, 10.2)).bornes, [10]);
  assert.deepEqual(A(R.ajouterBorne(e, 0.2)).bornes, [0.5, 10]);   // ramenée à 0,5 m : la tranche du sol
  let g = e;
  for (let h = 11; h < 40; h += 1) g = R.ajouterBorne(g, h);
  assert.equal(g.bornes.length, 11);
});

test('ajouterBorne en dégradé : la nouvelle limite garde la couleur que la rampe avait à cet endroit', () => {
  const e = { mode: 'degrade', bornes: [10], couleurs: ['#000000', '#ff0000'] };
  const a = R.ajouterBorne(e, 5);
  assert.deepEqual(A(a.bornes), [5, 10]);
  assert.equal(a.couleurs[1], '#800000');
});

test('retirerBorne : fusionne deux tranches, jamais la dernière limite', () => {
  const e = { mode: 'paliers', bornes: [5, 12], couleurs: ['#111111', '#222222', '#333333'] };
  const r = A(R.retirerBorne(e, 0));
  assert.deepEqual(r.bornes, [12]);
  assert.deepEqual(r.couleurs, ['#111111', '#333333']);
  assert.deepEqual(A(R.retirerBorne(R.retirerBorne(e, 0), 0)), A(R.retirerBorne(e, 0)));
});

test('deplacerBorne : arrondie à 0,5 m, bloquée entre ses voisines (écart d’au moins 0,5 m), dans [0,5 ; 50]', () => {
  const e = { mode: 'paliers', bornes: [5, 12, 30], couleurs: ['#111111', '#222222', '#333333', '#444444'] };
  assert.deepEqual(A(R.deplacerBorne(e, 1, 20.26)).bornes, [5, 20.5, 30]);
  assert.deepEqual(A(R.deplacerBorne(e, 1, 99)).bornes, [5, 29.5, 30]);
  assert.deepEqual(A(R.deplacerBorne(e, 1, 0)).bornes, [5, 5.5, 30]);
  assert.deepEqual(A(R.deplacerBorne(e, 0, 0)).bornes, [0.5, 12, 30]);
  assert.deepEqual(A(R.deplacerBorne(e, 2, 80)).bornes, [5, 12, 50]);
});

test('colorerBande : une couleur valide, sinon rien ne change', () => {
  const e = R.classique();
  assert.equal(R.colorerBande(e, 1, '#ABCDEF').couleurs[1], '#abcdef');
  assert.deepEqual(A(R.colorerBande(e, 1, 'rouge')), A(e));
  assert.deepEqual(A(R.colorerBande(e, 9, '#abcdef')), A(e));
});

test('changerMode et préréglages : tous valides, le classique est le défaut', () => {
  assert.equal(R.changerMode(R.classique(), 'paliers').mode, 'paliers');
  assert.equal(R.changerMode(R.classique(), 'x').mode, 'degrade');
  for (const nom of ['classique', 'seuil', 'arc-en-ciel', 'daltonien']) {
    const p = R.preset(nom);
    assert.deepEqual(A(R.normaliser(p)), A(p), nom);
  }
  assert.ok(R.estDefaut(R.preset('classique')));
  assert.ok(!R.estDefaut(R.preset('seuil')));
  assert.equal(R.preset('seuil').mode, 'paliers');
  assert.equal(R.preset('arc-en-ciel').mode, 'paliers');
  assert.equal(R.preset('inconnu').mode, 'degrade');
});

test('arcEnCiel : bleu en bas, rouge en haut', () => {
  assert.match(R.arcEnCiel(0), /^#[0-9a-f]{6}$/);
  const [r0, , b0] = [1, 3, 5].map((i) => parseInt(R.arcEnCiel(0).slice(i, i + 2), 16));
  const [r1, , b1] = [1, 3, 5].map((i) => parseInt(R.arcEnCiel(50).slice(i, i + 2), 16));
  assert.ok(b0 > r0, 'bleu à 0 m');
  assert.ok(r1 > b1, 'rouge à 50 m');
});

test('lien : écriture et lecture se renvoient, seuls des caractères sûrs pour le forum', () => {
  for (const nom of ['classique', 'seuil', 'arc-en-ciel', 'daltonien']) {
    const e = R.preset(nom);
    const t = R.ecrire(e);
    assert.match(t, /^[dp]_[0-9a-f]{6}(_\d{1,2}(\.\d)?-[0-9a-f]{6}){1,11}$/, nom);
    assert.deepEqual(A(R.lire(t)), A(R.normaliser(e)), nom);
  }
  assert.equal(R.ecrire({ mode: 'paliers', bornes: [5, 12.5], couleurs: ['#111111', '#222222', '#333333'] }), 'p_111111_5-222222_12.5-333333');
});

test('lire : tout ce qui est abîmé tombe (null), jamais à moitié', () => {
  for (const mauvais of ['', 'x', 'd_zzzzzz_5-111111', 'p_111111', 'p_111111_5-11111', 'p_111111_x-111111', 'p_111111_60-222222', 'p_111111_5-222222_5-333333', null, undefined, 3]) {
    assert.equal(R.lire(mauvais), null, String(mauvais));
  }
});

test('legendeHtml : les tranches (paliers) ou les couleurs atteintes (dégradé), avec des virgules françaises', () => {
  const p = R.legendeHtml({ mode: 'paliers', bornes: [5, 12.5], couleurs: ['#111111', '#222222', '#333333'] });
  assert.match(p, /0 à 5 m/);
  assert.match(p, /5 à 12,5 m/);
  assert.match(p, /12,5 m et plus/);
  assert.match(p, /background:#111111/);
  const d = R.legendeHtml(R.classique());
  assert.match(d, /0 m/);
  assert.match(d, /2,8 m/);
  assert.match(d, /8 m/);
  assert.ok(!/—/.test(p + d));
});

test('le shader lit la texture de rampe, plus de formule ni de borne en dur', () => {
  const s = lire('src/shaders.js');
  const rampe = s.slice(s.indexOf('vec3 rampeHauteur'), s.indexOf('}', s.indexOf('vec3 rampeHauteur')));
  assert.match(rampe, /u_rampe/);
  assert.ok(!/h \/ 8\.0|u_hmaxRampe/.test(rampe));
  assert.match(s, /uniform sampler2D u_rampe;/);
  assert.match(lire('src/vue3d.js'), /u_rampe/);
  assert.match(lire('src/gl.js'), /textureRampe/);
});

test('la configuration porte l’état classique, identique à celui du module', () => {
  const { CONFIG } = chargerScripts(['config.js']);
  assert.deepEqual(A(CONFIG.rendu.rampe), A(R.classique()));
});

test('la page : un bouton de paramètres, un éditeur masqué (mode, préréglage, jauge, arbre, tranches)', () => {
  const html = lire('index.html');
  for (const id of ['champ-rampe', 'btn-rampe', 'editeur-rampe', 'rampe-mode', 'rampe-preset', 'rampe-jauge', 'rampe-arbre', 'rampe-tranches', 'rampe-ajouter']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /id="champ-rampe"[^>]*hidden/);
  assert.match(html, /id="editeur-rampe"[^>]*hidden/);
  assert.match(html, /data-mode="degrade"/);
  assert.match(html, /data-mode="paliers"/);
  assert.ok(!/id="vue-hmax"/.test(html), 'l’ancien curseur est remplacé');
  for (const f of ['rampe-hauteur', 'arbre-exemple', 'editeur-rampe']) assert.match(html, new RegExp(`src="src/${f}\\.js"`), f);
});

test('la jauge n’ajoute plus de limite au clic (un clic raté en créait une) : seuls le bouton, le double-clic sur une limite et les champs changent le nombre de limites', () => {
  const src = lire('src/editeur-rampe.js');
  assert.ok(!/ajouterBorne\(etat\(\), pointerSurJauge/.test(src), 'plus d’ajout au clic dans la jauge');
  assert.ok(!/cursor: copy/.test(lire('styles.css')), 'le curseur de la jauge ne promet plus une copie');
  assert.ok(!/Cliquez dans la barre pour ajouter/.test(lire('index.html')));
  assert.match(lire('src/editeur-rampe.js'), /rampe-ajouter/);
});
