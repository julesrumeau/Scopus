// Le test de fumée : ouvre le vrai site dans Chromium et déroule le parcours principal (accueil, exemple, boutons,
// mesure, profil, exports). Il attrape ce que les tests par morceaux ne voient pas : une page figée, un bouton caché,
// une erreur de console. À lancer à la main avant une publication, jamais dans `npm test` (il lui faut un navigateur
// et le réseau : la carte et les données viennent de l'IGN).
//
//   node tools/fumee.js                 (page locale : index.html, en file://)
//   node tools/fumee.js https://julesrumeau.github.io/Scopus/     (le site publié)
//
// Dépendance de développement, hors du dépôt : `npm i --no-save playwright-core` (ou NODE_PATH vers une installation),
// et un Chromium (variable CHROME, sinon recherche dans les emplacements usuels). Rien de tout cela n'est livré.
// Sortie : une ligne par vérification, code de retour 1 au premier échec.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);   // honore NODE_PATH, ce que `import` ne fait pas

function trouverChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const motifs = [
    path.join(os.homedir(), '.cache/ms-playwright/chromium-*/chrome-linux*/chrome'),
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ];
  for (const m of motifs) {
    try {
      const t = execSync(`ls -d ${m} 2>/dev/null | tail -1`).toString().trim();
      if (t) return t;
    } catch (e) { /* motif suivant */ }
  }
  return null;
}

function chargerPlaywright() {
  try { return require('playwright-core'); } catch (e) {
    console.error('playwright-core introuvable : lancez `npm i --no-save playwright-core` (ou réglez NODE_PATH).');
    process.exit(2);
  }
}

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cible = process.argv[2] || `file://${path.join(racine, 'index.html')}`;
const verifications = [];
let echec = false;

/** Une vérification : son nom, puis une fonction qui lève si elle échoue. Le premier échec arrête le parcours. */
async function verifier(nom, fn) {
  if (echec) return;
  const t = Date.now();
  try {
    await fn();
    verifications.push({ nom, ok: true });
    console.log(`  ok   ${nom} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  } catch (e) {
    echec = true;
    verifications.push({ nom, ok: false });
    console.log(`  ECHEC ${nom} : ${String(e.message).split('\n')[0]}`);
  }
}

(async () => {
  const { chromium } = chargerPlaywright();
  const exe = trouverChrome();
  if (!exe) { console.error('Chromium introuvable : réglez la variable CHROME.'); process.exit(2); }
  const nav = await chromium.launch({
    executablePath: exe,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--no-sandbox'],
  });
  const page = await (await nav.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(`exception : ${e.message}`));
  page.on('console', (m) => {
    // Les ressources distantes qui échouent (tuiles, réseau) ne disent rien du code : on ne garde que ses erreurs.
    if (m.type() === 'error' && !/Failed to load resource|net::ERR|AbortError|Leaflet/.test(m.text())) erreurs.push(`console : ${m.text()}`);
  });
  const visible = (id) => page.locator(`#${id}`).isVisible();
  const exiger = async (id) => { if (!(await visible(id))) throw new Error(`#${id} n'est pas visible`); };
  const sansErreur = () => { if (erreurs.length) throw new Error(erreurs[0]); };

  console.log(`Test de fumée : ${cible}`);

  await verifier('la page se charge et l’accueil s’affiche', async () => {
    await page.goto(cible);
    await page.waitForSelector('#accueil:not([hidden])', { timeout: 20000 });
    await exiger('btn-exemple');
    sansErreur();
  });

  await verifier('« Voir un exemple » ferme l’accueil et cadre la carte', async () => {
    await page.click('#btn-exemple');
    await page.waitForSelector('#accueil', { state: 'hidden', timeout: 20000 });
    await page.waitForFunction(() => /map=/.test(location.hash), null, { timeout: 20000 });
    await page.waitForTimeout(2500);   // la page ne doit pas se figer : la carte répond encore
    await page.mouse.move(700, 450);
    sansErreur();
  });

  await verifier('les boutons principaux sont visibles', async () => {
    for (const id of ['mode-deplacement', 'mode-selection', 'mode-mesure', 'mode-profil', 'mode-carte-double', 'btn-localiser', 'onglet-carte', 'onglet-3d']) await exiger(id);
  });

  await verifier('le lien « Aide » est dans la barre, et la page d’aide tient sur un téléphone', async () => {
    if (!(await page.locator('.lien-aide').isVisible())) throw new Error('le lien « Aide » n’est pas visible');
    const tel = await (await nav.newContext({ viewport: { width: 390, height: 800 } })).newPage();
    await tel.goto(new URL('aide.html', cible).href);
    await tel.waitForSelector('main h1', { timeout: 20000 });
    const debord = await tel.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (debord > 0) throw new Error(`la page d’aide déborde de ${debord} px sur 390 px de large`);
    await tel.close();
  });

  await verifier('la mesure : deux points, un tableau, l’export s’ouvre', async () => {
    await page.click('#mode-mesure');
    await page.mouse.click(520, 520);
    await page.waitForTimeout(1500);
    await page.mouse.click(800, 400);
    await page.waitForFunction(() => document.querySelectorAll('#detail-mesure tbody tr').length === 1, null, { timeout: 90000 });
    await page.click('#btn-mesure-exporter');
    await page.waitForSelector('#dlg-export-mesure[open]', { timeout: 5000 });
    await page.click('#exm-fermer');
    sansErreur();
  });

  await verifier('un point de la mesure se glisse sur la carte', async () => {
    const avant = await page.evaluate(() => document.querySelector('#detail-mesure td').nextElementSibling.textContent);
    const q = await page.evaluate(() => { const r = document.querySelectorAll('.point-mesure i')[1].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.move(q[0], q[1]);
    await page.mouse.down();
    await page.mouse.move(q[0] + 50, q[1] + 60, { steps: 5 });
    await page.mouse.up();
    await page.waitForFunction((a) => document.querySelector('#detail-mesure td').nextElementSibling.textContent !== a, avant, { timeout: 10000 });
  });

  await verifier('le profil : une bande, la coupe, une mesure, le curseur jaune et l’export', async () => {
    await page.click('#btn-mesure-effacer');
    await page.click('#mode-profil');
    await page.mouse.click(520, 520);
    await page.mouse.click(820, 400);
    await page.waitForFunction(() => !document.getElementById('profil-valider').disabled, null, { timeout: 10000 });
    await page.click('#profil-valider');
    await page.waitForFunction(() => /point/i.test(document.getElementById('profil-etat').textContent) && !/Calcul/.test(document.getElementById('profil-etat').textContent), null, { timeout: 120000 });
    if (!(await page.locator('#profil-pos').isHidden())) throw new Error('le curseur jaune est visible sans mesure');
    const c = await page.evaluate(() => { const r = document.getElementById('profil-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    await page.mouse.click(c.x + c.w * 0.3, c.y + c.h * 0.5);
    await page.mouse.click(c.x + c.w * 0.6, c.y + c.h * 0.4);
    await page.waitForSelector('#profil-pos:not([hidden])', { timeout: 5000 });
    await page.click('#profil-mesure-exporter');
    await page.waitForSelector('#dlg-export-mesure[open]', { timeout: 5000 });
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#exm-telecharger')]);
    const f = path.join(os.tmpdir(), `fumee-${Date.now()}.geojson`);
    await dl.saveAs(f);
    const g = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.unlinkSync(f);
    if (g.type !== 'FeatureCollection' || g.features.length < 3) throw new Error('GeoJSON du profil incomplet');
    sansErreur();
  });

  await verifier('aucune erreur de script pendant tout le parcours', async () => { sansErreur(); });

  await nav.close();
  const ok = verifications.filter((v) => v.ok).length;
  console.log(echec ? `\nECHEC : ${ok} vérification(s) sur ${verifications.length} avant l’arrêt.` : `\nTout est bon : ${ok} vérifications.`);
  process.exit(echec ? 1 : 0);
})();
