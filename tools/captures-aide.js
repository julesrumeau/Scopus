// Génère les images de la page d'aide (`docs/aide/*.jpg`) depuis le vrai site, dans Chromium : même données, même
// interface que ce que la personne verra. À relancer quand l'interface change, plutôt que retoucher les images à la main.
//
//   node tools/captures-aide.js            (toutes les images, une vingtaine de minutes : le réseau de l'IGN est lent)
//   node tools/captures-aide.js profil 3d  (seulement celles-là)
//
// Même dépendance hors du dépôt que `tools/fumee.js` : `npm i --no-save playwright-core` et un Chromium (variable CHROME).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sortie = path.join(racine, 'docs', 'aide');
const page0 = `file://${path.join(racine, 'index.html')}`;
const VERDUN = '49.2162/5.4376';   // le fort et ses cratères, sous la forêt

function trouverChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const m of [path.join(os.homedir(), '.cache/ms-playwright/chromium-*/chrome-linux*/chrome'), '/usr/bin/chromium', '/usr/bin/google-chrome']) {
    try { const t = execSync(`ls -d ${m} 2>/dev/null | tail -1`).toString().trim(); if (t) return t; } catch (e) { /* suivant */ }
  }
  return null;
}

// La carte seule, sans l'interface (pour montrer une couche de relief pleine image).
const CSS_CARTE_SEULE = `
  .barre, #panneau, .onglets, .leaflet-control-container, #accueil, #hud-vue, .modes-carte, .localiser,
  .rideau, .rideau-flux, .rideau-flux-libelle, .rideau-poignee { display: none !important; }
  .scene { position: fixed !important; inset: 0 !important; z-index: 50; }
  #cartes, #vue-carte { height: 100vh !important; width: 100vw !important; }`;
const CSS_SANS_ETAT = '#etat, .etat { visibility: hidden !important; }';

async function main() {
  const { chromium } = require('playwright-core');
  const exe = trouverChrome();
  if (!exe) { console.error('Chromium introuvable : réglez la variable CHROME.'); process.exit(2); }
  fs.mkdirSync(sortie, { recursive: true });
  const demandes = process.argv.slice(2);
  const nav = await chromium.launch({
    executablePath: exe,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files', '--no-sandbox'],
  });

  /** Ouvre une vue dans une page neuve, à la taille voulue, et rend un petit jeu d'outils. */
  async function ouvrir(hash, { largeur = 1500, hauteur = 900, carteSeule = false } = {}) {
    const ctx = await nav.newContext({ viewport: { width: largeur, height: hauteur } });
    const p = await ctx.newPage();
    await p.goto(page0 + hash, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
    await p.waitForTimeout(2500);
    if (carteSeule) {
      await p.addStyleTag({ content: CSS_CARTE_SEULE });
      await p.setViewportSize({ width: largeur + 1, height: hauteur }); await p.waitForTimeout(300);
      await p.setViewportSize({ width: largeur, height: hauteur });
    }
    /** Le relief doit être entièrement arrivé : « Relief à jour », plus de « Affinage », pas de « ralenti ». */
    p.attendreCharge = async (maxS = 300) => {
      for (let k = 0; k < maxS; k += 3) {
        const [etat, panneau] = await p.evaluate(() => [document.getElementById('etat').textContent, document.getElementById('panneau').innerText]);
        if (/Relief à jour/.test(etat) && !/Affinage/.test(panneau) && !/ralenti/.test(etat)) { await p.waitForTimeout(4000); return; }
        await p.waitForTimeout(3000);
      }
      console.log('  attente maximale atteinte');
    };
    p.enregistrer = async (nom, options = {}) => {
      await p.addStyleTag({ content: CSS_SANS_ETAT });
      await p.screenshot({ path: path.join(sortie, `${nom}.jpg`), type: 'jpeg', quality: 82, ...options });
      console.log(`  ${nom}.jpg`);
    };
    return p;
  }

  const prises = {
    // La vue d'ensemble : la photo d'un côté, le relief de l'autre, le rideau au milieu.
    async comparer() {
      const p = await ouvrir(`#map=17/${VERDUN}&gauche=carte&droite=ombrage&rideau=50`);
      await p.attendreCharge(); await p.enregistrer('comparer'); await p.context().close();
    },
    // Une couche par image, pleine carte, au même endroit pour qu'on les compare.
    async couches() {
      for (const [cle, nom] of [['ombrage', 'couche-ombrage'], ['svf', 'couche-svf'], ['ouverture-neg', 'couche-ouverture'], ['microrelief', 'couche-microrelief']]) {
        const p = await ouvrir(`#map=17.5/${VERDUN}&gauche=${cle}&droite=${cle}&rideau=50`, { largeur: 1000, hauteur: 680, carteSeule: true });
        await p.waitForTimeout(25000); await p.enregistrer(nom); await p.context().close();
      }
    },
    async 'deux-cartes'() {
      const p = await ouvrir(`#map=17/${VERDUN}&cartes=2&gauche=carte&droite=svf`);
      await p.waitForTimeout(25000); await p.enregistrer('deux-cartes'); await p.context().close();
    },
    // Une mesure en chaîne : trois points sur le relief, le tableau dans le panneau.
    async mesure() {
      const p = await ouvrir(`#map=18/${VERDUN}&gauche=carte&droite=ombrage&rideau=50`, { hauteur: 1000 });
      await p.attendreCharge();
      await p.click('#mode-mesure');
      await p.mouse.click(1250, 520); await p.waitForTimeout(1500);
      await p.mouse.click(1380, 380); await p.waitForTimeout(1500);
      await p.mouse.click(1330, 250);
      await p.waitForFunction(() => document.querySelectorAll('#detail-mesure tbody tr').length === 2, null, { timeout: 90000 });
      await p.evaluate(() => document.getElementById('detail-mesure').scrollIntoView({ block: 'center' }));
      await p.waitForTimeout(800); await p.enregistrer('mesure'); await p.context().close();
    },
    // Le profil : une bande à travers la forêt, un arbre mesuré du sol à la cime (Maj + clic : à angle droit).
    async profil() {
      const p = await ouvrir(`#map=17/49.21556/5.43629&gauche=carte&droite=svf&rideau=50`, { largeur: 1920, hauteur: 1080 });
      await p.attendreCharge();
      await p.click('#mode-profil'); await p.mouse.click(1000, 720); await p.mouse.click(1560, 330); await p.waitForTimeout(1500);
      await p.click('#profil-valider');
      const pret = () => p.waitForFunction(() => /point/i.test(document.getElementById('profil-etat').textContent) && !/Calcul/.test(document.getElementById('profil-etat').textContent), null, { timeout: 120000 });
      await pret();
      const c = await p.evaluate(() => { const r = document.getElementById('profil-canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      await p.mouse.move(c.x + c.w * 0.27, c.y + c.h * 0.5);
      for (let k = 0; k < 6; k++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(250); }
      await p.waitForTimeout(600);
      await p.mouse.click(933, 457);
      await p.keyboard.down('Shift'); await p.mouse.move(933, 330); await p.mouse.click(933, 330); await p.keyboard.up('Shift');
      await p.mouse.move(1700, 900); await p.waitForTimeout(800);
      await p.enregistrer('profil', { clip: { x: 400, y: 10, width: 1120, height: 1060 } }); await p.context().close();
    },
    async '3d'() {
      const p = await ouvrir(`#map=17/49.21556/5.43629&gauche=carte&droite=svf&rideau=50`);
      await p.attendreCharge();
      await p.click('#onglet-3d'); await p.waitForTimeout(35000);
      await p.enregistrer('3d'); await p.context().close();
    },
    // La fenêtre d'export de la mesure.
    async export() {
      const p = await ouvrir(`#map=18/${VERDUN}&gauche=carte&droite=ombrage&rideau=50`);
      await p.attendreCharge();
      await p.click('#mode-mesure');
      await p.mouse.click(1250, 520); await p.waitForTimeout(1500); await p.mouse.click(1380, 380);
      await p.waitForFunction(() => document.querySelectorAll('#detail-mesure tbody tr').length === 1, null, { timeout: 90000 });
      await p.click('#btn-mesure-exporter'); await p.waitForTimeout(500);
      await p.locator('#dlg-export-mesure').screenshot({ path: path.join(sortie, 'export.jpg'), type: 'jpeg', quality: 85 });
      console.log('  export.jpg'); await p.context().close();
    },
    // « Point sélectionné » : altitude et date d'acquisition de la dalle.
    async date() {
      const p = await ouvrir(`#map=18/${VERDUN}&gauche=carte&droite=ombrage&rideau=50`);
      await p.attendreCharge();
      await p.click('#mode-selection'); await p.mouse.click(1250, 480); await p.waitForTimeout(3000);
      const bloc = p.locator('#detail-selection');
      await p.addStyleTag({ content: CSS_SANS_ETAT });
      await bloc.screenshot({ path: path.join(sortie, 'date.jpg'), type: 'jpeg', quality: 85 });
      console.log('  date.jpg'); await p.context().close();
    },
    // Une erreur de classification de l'IGN : un terrain de sport classé « eau » (Labège), vu en 3D.
    async eau() {
      const p = await ouvrir('#map=19/43.553357/1.502716&gauche=carte&droite=svf&rideau=50');
      await p.attendreCharge();
      await p.click('#onglet-3d'); await p.waitForTimeout(40000);
      await p.enregistrer('eau'); await p.context().close();
    },
  };

  const noms = demandes.length ? demandes : Object.keys(prises);
  for (const nom of noms) {
    if (!prises[nom]) { console.error(`Inconnue : ${nom} (${Object.keys(prises).join(', ')})`); continue; }
    console.log(nom);
    try { await prises[nom](); } catch (e) { console.error(`  ECHEC ${nom} : ${String(e.message).split('\n')[0]}`); }
  }
  await nav.close();
}

main();
