// Le référencement de base : ce que les moteurs de recherche lisent. Le nom « Scopus » est aussi celui de la base
// bibliographique d'Elsevier : titre et description disent donc toujours ce que c'est (LiDAR HD, IGN).
// Pas de robots.txt : un site GitHub Pages de projet vit sous /Scopus/, or un robots.txt n'est lu qu'à la racine du domaine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const index = lire('index.html');
const aide = lire('aide.html');
const BASE = 'https://julesrumeau.github.io/Scopus/';

const balise = (html, re) => (re.exec(html) || [])[1];
const titre = (html) => balise(html, /<title>([^<]*)<\/title>/);
const description = (html) => balise(html, /<meta name="description" content="([^"]*)"/);

test('le titre de la page dit ce qu’est Scopus, sans se confondre avec la base d’Elsevier', () => {
  const t = titre(index);
  assert.match(t, /Scopus/);
  assert.match(t, /LiDAR HD/);
  assert.ok(t.length <= 70, `titre trop long : ${t.length}`);
  assert.ok(!/—/.test(t));
});

test('la description cite le LiDAR HD de l’IGN et reste lisible dans un résultat de recherche', () => {
  const d = description(index);
  assert.match(d, /LiDAR HD/);
  assert.match(d, /IGN/);
  assert.ok(d.length >= 70 && d.length <= 170, `description de ${d.length} caractères`);
  assert.ok(!/—/.test(d));
});

test('la page d’aide a un titre et une description qui nomment aussi le LiDAR HD', () => {
  assert.match(titre(aide), /LiDAR HD/);
  assert.match(description(aide), /LiDAR HD/);
});

test('chaque page a une adresse canonique absolue', () => {
  assert.equal(balise(index, /<link rel="canonical" href="([^"]*)"/), BASE);
  assert.equal(balise(aide, /<link rel="canonical" href="([^"]*)"/), `${BASE}aide.html`);
});

test('des données structurées : une application web gratuite, en français, valides en JSON', () => {
  const brut = balise(index, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(brut, 'pas de JSON-LD dans index.html');
  const d = JSON.parse(brut);
  assert.equal(d['@context'], 'https://schema.org');
  assert.equal(d['@type'], 'WebApplication');
  assert.equal(d.name, 'Scopus');
  assert.equal(d.url, BASE);
  assert.equal(d.inLanguage, 'fr');
  assert.equal(d.isAccessibleForFree, true);
  assert.ok(d.description.length > 40);
  assert.ok(!/—/.test(brut));
});

test('sitemap.xml : les deux pages publiques, en adresses absolues, vers des fichiers qui existent', () => {
  assert.ok(existsSync(new URL('../sitemap.xml', import.meta.url)), 'sitemap.xml manque');
  const s = lire('sitemap.xml');
  assert.match(s, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(s, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  const urls = [...s.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(urls.join(' | '), `${BASE} | ${BASE}aide.html`);
  for (const u of urls) {
    const fichier = u === BASE ? 'index.html' : u.slice(BASE.length);
    assert.ok(existsSync(new URL(`../${fichier}`, import.meta.url)), fichier);
  }
});

test('pas de robots.txt inutile à la racine du dépôt', () => {
  assert.ok(!existsSync(new URL('../robots.txt', import.meta.url)));
});
