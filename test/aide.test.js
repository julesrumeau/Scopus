// La page d'aide (`aide.html`) : un document statique avec ses images (`docs/aide/*.jpg`). Rien ne l'exécute, donc rien
// ne se plaint d'un lien cassé, d'une image oubliée ou d'une ancre sans cible : ces contrôles-là sont mécaniques.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chargerScripts } from './charger.js';

const RACINE = new URL('../', import.meta.url);
const lire = (nom) => readFileSync(fileURLToPath(new URL(nom, RACINE)), 'utf8');
const aide = lire('aide.html');
const sansCommentaires = aide.replace(/<!--[\s\S]*?-->/g, '');
const visible = sansCommentaires.replace(/<(script|style)[\s\S]*?<\/\1>/g, '');

test('la page d’aide existe, en français, avec un titre et un seul h1', () => {
  assert.match(aide, /<html lang="fr">/);
  assert.match(aide, /<title>[^<]+<\/title>/);
  assert.equal((aide.match(/<h1[ >]/g) || []).length, 1);
});

test('toutes les images existent, ont un texte alternatif et restent légères', () => {
  const imgs = [...aide.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 10, `seulement ${imgs.length} images`);
  for (const img of imgs) {
    const src = /src="([^"]+)"/.exec(img)?.[1];
    assert.ok(src && !/^https?:/.test(src), `image distante ou sans src : ${img.slice(0, 60)}`);
    const f = fileURLToPath(new URL(src, RACINE));
    assert.ok(existsSync(f), `image absente : ${src}`);
    assert.ok(statSync(f).size < 600_000, `${src} pèse ${statSync(f).size} octets : trop pour une page d'aide`);
    assert.match(img, /alt="[^"]{12,}"/, `texte alternatif trop court : ${src}`);
  }
});

test('chaque ancre du sommaire mène à une section, et chaque section est au sommaire', () => {
  const ids = new Set([...visible.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const ancres = [...visible.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  for (const a of ancres) assert.ok(ids.has(a), `ancre sans cible : #${a}`);
  const sections = [...visible.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  const nav = visible.match(/<nav[\s\S]*?<\/nav>/)[0];
  for (const s of sections) assert.ok(nav.includes(`href="#${s}"`), `section absente du sommaire : ${s}`);
});

test('les liens locaux existent et rien n’est chargé depuis un autre site', () => {
  for (const m of visible.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
    const url = m[1];
    if (/^(https?:|mailto:)/.test(url)) continue;
    assert.ok(existsSync(fileURLToPath(new URL(url, RACINE))), `lien local cassé : ${url}`);
  }
  assert.ok(!/<script[^>]+src=/.test(visible), 'aucun script externe');
  assert.ok(!/<link[^>]+rel="stylesheet"/.test(visible), 'aucune feuille de style externe : tout est dans la page');
});

test('aucun tiret cadratin dans le texte visible (convention du projet)', () => {
  const lignes = visible.split('\n').filter((l) => l.includes('—')).map((l) => l.trim().slice(0, 70));
  assert.deepEqual(lignes, []);
});

test('le don est discret : un lien au sommaire et un encadré à la fin, aux adresses de la configuration', () => {
  const { CONFIG } = chargerScripts(['config.js']);
  assert.ok(CONFIG.soutien.kofi && CONFIG.soutien.liberapay);
  assert.ok(aide.includes(`href="${CONFIG.soutien.kofi}"`), 'lien Ko-fi');
  assert.ok(aide.includes(`href="${CONFIG.soutien.liberapay}"`), 'lien Liberapay');
  const nav = visible.match(/<nav[\s\S]*?<\/nav>/)[0];
  assert.ok(nav.includes('href="#soutenir"'));
  // Rien au-dessus du premier titre de section : pas de quête avant d'avoir aidé.
  const avant = visible.slice(0, visible.indexOf('<section id="demarrer"'));
  assert.ok(!/ko-fi|liberapay|don\b/i.test(avant.replace(/<nav[\s\S]*?<\/nav>/, '')), 'aucun appel au don en haut de page');
});

test('l’outil renvoie vers l’aide depuis sa barre du haut, et l’aide renvoie vers l’outil', () => {
  const index = lire('index.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.match(index, /<header class="barre">[\s\S]*?<a [^>]*href="aide\.html"[^>]*>[\s\S]*?<\/header>/);
  assert.match(aide, /href="index\.html"/);
});
